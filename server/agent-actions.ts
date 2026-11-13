import { storage } from "./storage";
import { sendTelegramMessage } from "./telegram";
import { analyzeRadioEvents, sendRadioSlotsSummary, importDjsFromRadioHistory } from "./radio-agent";
import { getPortfolioSummary, analyzeRebalancing, checkPriceOpportunities, sendWeeklyPortfolioReport } from "./portfolio-agent";
import { getPrice } from "./finance";
import { format, addDays, startOfDay, endOfDay } from "date-fns";
import { es } from "date-fns/locale";
import { getSystemUserId } from "./user-context";
import { hasRealValue } from "./ceo-doctor-cli";

function getTelegramBotToken(): string | null {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  return hasRealValue(token) ? token : null;
}

export interface AgentAction {
  id: string;
  name: string;
  description: string;
  category: "radio" | "portfolio" | "tasks" | "notifications" | "system";
  execute: (userId: string) => Promise<AgentActionResult>;
}

export interface AgentActionResult {
  success: boolean;
  message: string;
  data?: any;
}

export interface ScheduledAction {
  actionId: string;
  cronExpression: string;
  enabled: boolean;
  lastRun?: Date;
  nextRun?: Date;
}

async function sendNotification(userId: string, message: string): Promise<boolean> {
  const telegramConfig = await storage.getTelegramConfig(userId);
  const botToken = getTelegramBotToken();
  if (!telegramConfig || !telegramConfig.chatId || !botToken) {
    console.log("Telegram not configured for notifications");
    return false;
  }
  return await sendTelegramMessage(botToken, telegramConfig.chatId, message);
}

export const availableActions: AgentAction[] = [
  {
    id: "radio_analyze",
    name: "Analizar eventos de Radio",
    description: "Detecta slots vacíos en los próximos eventos de Radio",
    category: "radio",
    execute: async (userId) => {
      const analysis = await analyzeRadioEvents(userId);
      const emptyCount = analysis.slotsToFill.reduce((acc, e) => acc + e.slots.length, 0);
      return {
        success: true,
        message: `Analizados ${analysis.totalEvents} eventos, ${emptyCount} slots vacíos detectados`,
        data: analysis,
      };
    },
  },
  {
    id: "radio_notify_slots",
    name: "Notificar slots vacíos",
    description: "Envía un resumen de slots vacíos por Telegram",
    category: "radio",
    execute: async (userId) => {
      const result = await sendRadioSlotsSummary(userId);
      return {
        success: result.sent,
        message: result.message,
        data: result,
      };
    },
  },
  {
    id: "radio_import_djs",
    name: "Importar DJs del historial",
    description: "Importa DJs que han participado en eventos anteriores",
    category: "radio",
    execute: async (userId) => {
      const result = await importDjsFromRadioHistory(userId);
      return {
        success: true,
        message: `Importados ${result.imported} DJs nuevos, ${result.skipped} ya existían`,
        data: result,
      };
    },
  },
  {
    id: "portfolio_summary",
    name: "Resumen del portfolio",
    description: "Obtiene el resumen actual del portfolio con precios en tiempo real",
    category: "portfolio",
    execute: async (userId) => {
      const summary = await getPortfolioSummary(userId);
      return {
        success: true,
        message: `Portfolio: $${summary.totalValue.toFixed(2)} (${summary.gainPercent >= 0 ? "+" : ""}${summary.gainPercent.toFixed(2)}%)`,
        data: summary,
      };
    },
  },
  {
    id: "portfolio_rebalance",
    name: "Analizar rebalanceo",
    description: "Sugiere rebalanceo del portfolio basado en distribución ideal",
    category: "portfolio",
    execute: async (userId) => {
      const recommendations = await analyzeRebalancing(userId);
      const highPriority = recommendations.filter(r => r.priority === "high");
      return {
        success: true,
        message: `${recommendations.length} recomendaciones, ${highPriority.length} urgentes`,
        data: recommendations,
      };
    },
  },
  {
    id: "portfolio_opportunities",
    name: "Detectar oportunidades",
    description: "Revisa watchlist y alertas para detectar oportunidades de mercado",
    category: "portfolio",
    execute: async (userId) => {
      const opportunities = await checkPriceOpportunities(userId);
      return {
        success: true,
        message: `${opportunities.length} oportunidades detectadas`,
        data: opportunities,
      };
    },
  },
  {
    id: "portfolio_weekly_report",
    name: "Enviar reporte semanal",
    description: "Genera y envía el reporte semanal del portfolio por Telegram",
    category: "portfolio",
    execute: async (userId) => {
      const result = await sendWeeklyPortfolioReport(userId);
      return {
        success: result.sent,
        message: result.message,
        data: result,
      };
    },
  },
  {
    id: "tasks_today_summary",
    name: "Resumen de tareas de hoy",
    description: "Lista las tareas pendientes para hoy",
    category: "tasks",
    execute: async (userId) => {
      const tasks = await storage.getTasks(userId);
      const today = new Date();
      const todayStart = startOfDay(today);
      const todayEnd = endOfDay(today);
      
      const todayTasks = tasks.filter(t => {
        const taskDate = new Date(t.date);
        return taskDate >= todayStart && taskDate <= todayEnd && !t.completed;
      });
      
      return {
        success: true,
        message: `${todayTasks.length} tareas pendientes para hoy`,
        data: todayTasks,
      };
    },
  },
  {
    id: "tasks_overdue",
    name: "Detectar tareas atrasadas",
    description: "Lista tareas que ya pasaron su fecha y no se completaron",
    category: "tasks",
    execute: async (userId) => {
      const tasks = await storage.getTasks(userId);
      const today = startOfDay(new Date());
      
      const overdue = tasks.filter(t => {
        const taskDate = new Date(t.date);
        return taskDate < today && !t.completed;
      });
      
      if (overdue.length > 0) {
        const message = `⚠️ *Tareas Atrasadas (${overdue.length})*\n\n` +
          overdue.slice(0, 5).map(t => 
            `• ${t.title} (${format(new Date(t.date), "d MMM", { locale: es })})`
          ).join("\n");
        await sendNotification(userId, message);
      }
      
      return {
        success: true,
        message: `${overdue.length} tareas atrasadas`,
        data: overdue,
      };
    },
  },
  {
    id: "tasks_week_summary",
    name: "Resumen de la semana",
    description: "Lista tareas para los próximos 7 días",
    category: "tasks",
    execute: async (userId) => {
      const tasks = await storage.getTasks(userId);
      const today = startOfDay(new Date());
      const weekEnd = addDays(today, 7);
      
      const weekTasks = tasks.filter(t => {
        const taskDate = new Date(t.date);
        return taskDate >= today && taskDate <= weekEnd && !t.completed;
      });
      
      return {
        success: true,
        message: `${weekTasks.length} tareas para esta semana`,
        data: weekTasks,
      };
    },
  },
  {
    id: "create_video_edit_task",
    name: "Crear tarea de edición de video",
    description: "Crea automáticamente una tarea de edición de video después de un evento de Radio",
    category: "tasks",
    execute: async (userId) => {
      const tasks = await storage.getTasks(userId);
      const yesterday = addDays(new Date(), -1);
      const yesterdayStart = startOfDay(yesterday);
      const yesterdayEnd = endOfDay(yesterday);
      
      const pastRadioEvents = tasks.filter(t => {
        const taskDate = new Date(t.date);
        return t.title === "Radio" && 
               taskDate >= yesterdayStart && 
               taskDate <= yesterdayEnd;
      });
      
      let created = 0;
      for (const event of pastRadioEvents) {
        const existingEditTask = tasks.find(t => 
          t.title.includes("Editar video Radio") && 
          t.date === event.date
        );
        
        if (!existingEditTask) {
          const dueDate = addDays(new Date(event.date), 3);
          await storage.createTask(userId, {
            title: `Editar video Radio - ${format(new Date(event.date), "d MMM")}`,
            date: dueDate,
            priority: "medium",
            type: "regular",
          });
          created++;
        }
      }
      
      return {
        success: true,
        message: created > 0 ? `Creada(s) ${created} tarea(s) de edición` : "No hay nuevas tareas de edición necesarias",
        data: { created },
      };
    },
  },
  {
    id: "update_investment_prices",
    name: "Actualizar precios de inversiones",
    description: "Actualiza los precios actuales de todas las inversiones",
    category: "portfolio",
    execute: async (userId) => {
      const investments = await storage.getInvestments(userId);
      let updated = 0;
      let errors = 0;
      
      for (const inv of investments) {
        try {
          const priceData = await getPrice(inv.symbol, inv.type);
          if (priceData) {
            updated++;
          }
        } catch (e) {
          errors++;
        }
      }
      
      return {
        success: errors === 0,
        message: `${updated} precios actualizados, ${errors} errores`,
        data: { updated, errors },
      };
    },
  },
  {
    id: "morning_briefing",
    name: "Briefing matutino",
    description: "Envía un resumen matutino con tareas del día y estado del portfolio",
    category: "notifications",
    execute: async (userId) => {
      const tasks = await storage.getTasks(userId);
      const today = new Date();
      const todayStart = startOfDay(today);
      const todayEnd = endOfDay(today);
      
      const todayTasks = tasks.filter(t => {
        const taskDate = new Date(t.date);
        return taskDate >= todayStart && taskDate <= todayEnd && !t.completed;
      });
      
      let message = `☀️ *Buenos días! ${format(today, "EEEE d 'de' MMMM", { locale: es })}*\n\n`;
      
      if (todayTasks.length > 0) {
        message += `📋 *Tareas de hoy (${todayTasks.length})*\n`;
        for (const t of todayTasks.slice(0, 5)) {
          const priority = t.priority === "high" ? "🔴" : t.priority === "medium" ? "🟡" : "⚪";
          message += `${priority} ${t.title}\n`;
        }
        if (todayTasks.length > 5) {
          message += `_...y ${todayTasks.length - 5} más_\n`;
        }
      } else {
        message += `✅ No hay tareas pendientes para hoy\n`;
      }
      
      try {
        const portfolio = await getPortfolioSummary(userId);
        message += `\n💰 *Portfolio*: $${portfolio.totalValue.toLocaleString("en-US", { minimumFractionDigits: 2 })}`;
        message += ` (${portfolio.gainPercent >= 0 ? "+" : ""}${portfolio.gainPercent.toFixed(2)}%)\n`;
      } catch (e) {
      }
      
      const sent = await sendNotification(userId, message);
      return {
        success: sent,
        message: sent ? "Briefing matutino enviado" : "No se pudo enviar el briefing",
      };
    },
  },
  {
    id: "evening_review",
    name: "Revisión vespertina",
    description: "Envía resumen de tareas incompletas del día",
    category: "notifications",
    execute: async (userId) => {
      const tasks = await storage.getTasks(userId);
      const today = new Date();
      const todayStart = startOfDay(today);
      const todayEnd = endOfDay(today);
      
      const incompleteTasks = tasks.filter(t => {
        const taskDate = new Date(t.date);
        return taskDate >= todayStart && taskDate <= todayEnd && !t.completed;
      });
      
      if (incompleteTasks.length === 0) {
        const message = `🌙 *Excelente día!*\nCompletaste todas las tareas de hoy. Descansa bien.`;
        const sent = await sendNotification(userId, message);
        return { success: sent, message: "Felicitación enviada" };
      }
      
      let message = `🌙 *Revisión del día*\n\n`;
      message += `⏰ *Tareas pendientes (${incompleteTasks.length})*\n`;
      for (const t of incompleteTasks) {
        message += `• ${t.title}\n`;
      }
      message += `\n_Puedes completarlas mañana o marcarlas como hechas._`;
      
      const sent = await sendNotification(userId, message);
      return {
        success: sent,
        message: sent ? "Revisión vespertina enviada" : "No se pudo enviar",
      };
    },
  },
];

export function getActionById(id: string): AgentAction | undefined {
  return availableActions.find(a => a.id === id);
}

export function getActionsByCategory(category: string): AgentAction[] {
  return availableActions.filter(a => a.category === category);
}

export async function executeAction(actionId: string, userId = getSystemUserId()): Promise<AgentActionResult> {
  const action = getActionById(actionId);
  if (!action) {
    return { success: false, message: `Acción "${actionId}" no encontrada` };
  }
  
  try {
    console.log(`Executing action: ${action.name}`);
    const result = await action.execute(userId);
    
    const agentAction = await storage.createAgentAction(userId, {
      type: action.category === "radio" ? "radio_dj_search" : 
            action.category === "portfolio" ? "portfolio_analysis" : 
            action.category === "notifications" ? "task_reminder" : "weekly_report",
      description: `${action.name}: ${result.message}`,
      output: result.data,
    });
    
    await storage.updateAgentAction(agentAction.id, {
      status: result.success ? "completed" : "failed",
      executedAt: new Date(),
    });
    
    return result;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    console.error(`Action ${actionId} failed:`, error);
    
    const agentAction = await storage.createAgentAction(userId, {
      type: "task_reminder",
      description: `${actionId} failed: ${errorMessage}`,
    });
    
    await storage.updateAgentAction(agentAction.id, {
      status: "failed",
      executedAt: new Date(),
    });
    
    return { success: false, message: `Error: ${errorMessage}` };
  }
}

export async function executeMultipleActions(actionIds: string[], userId = getSystemUserId()): Promise<AgentActionResult[]> {
  const results: AgentActionResult[] = [];
  for (const actionId of actionIds) {
    const result = await executeAction(actionId, userId);
    results.push(result);
  }
  return results;
}

export function listAllActions(): { id: string; name: string; description: string; category: string }[] {
  return availableActions.map(a => ({
    id: a.id,
    name: a.name,
    description: a.description,
    category: a.category,
  }));
}
