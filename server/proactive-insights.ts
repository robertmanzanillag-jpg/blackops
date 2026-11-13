import { storage } from "./storage";
import { sendTelegramPlainMessage } from "./telegram";
import { format, startOfWeek, differenceInDays } from "date-fns";
import { es } from "date-fns/locale";
import { getSystemUserId } from "./user-context";
import { hasRealValue } from "./ceo-doctor-cli";

function getTelegramBotToken(): string | null {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  return hasRealValue(token) ? token : null;
}

interface Insight {
  type: "goal_reminder" | "task_reminder" | "radio_alert" | "portfolio_check";
  priority: "high" | "medium" | "low";
  message: string;
  emoji: string;
}

async function analyzeGoalsAndPortfolio(userId: string): Promise<Insight[]> {
  const insights: Insight[] = [];
  const yearlyGoals = await storage.getYearlyGoals(userId, new Date().getFullYear().toString());
  
  const incomeGoal = yearlyGoals.find(g => 
    g.title.toLowerCase().includes("income") || 
    g.title.toLowerCase().includes("ingreso") ||
    g.title.toLowerCase().includes("7k")
  );
  
  if (incomeGoal && !incomeGoal.completed) {
    const investments = await storage.getInvestments(userId);
    const history = await storage.getPortfolioHistory(userId, 7);
    
    if (history.length === 0 || investments.length > 0) {
      const lastCheck = history.length > 0 ? new Date(history[history.length - 1].date) : null;
      const daysSinceCheck = lastCheck ? differenceInDays(new Date(), lastCheck) : 999;
      
      if (daysSinceCheck >= 3) {
        insights.push({
          type: "portfolio_check",
          priority: "medium",
          emoji: "📊",
          message: `Tienes la meta "${incomeGoal.title}" - hace ${daysSinceCheck > 30 ? "más de un mes" : `${daysSinceCheck} días`} que no revisas tu portafolio. ¡Un buen momento para ver cómo van tus inversiones!`
        });
      }
    }
  }
  
  return insights;
}

async function analyzeWeeklyTasks(userId: string): Promise<Insight[]> {
  const insights: Insight[] = [];
  const now = new Date();
  const weekStart = startOfWeek(now, { weekStartsOn: 1 });
  
  const weeklyTasks = await storage.getWeeklyTasks(userId, weekStart);
  
  const abuelosTask = weeklyTasks.find(t => 
    t.title.toLowerCase().includes("abuelo") && !t.completed
  );
  
  if (abuelosTask) {
    const dayOfWeek = now.getDay();
    if (dayOfWeek >= 4) {
      insights.push({
        type: "task_reminder",
        priority: "high",
        emoji: "👴👵",
        message: `¡Recuerda escribirle a tus abuelos! Ya es ${format(now, "EEEE", { locale: es })} y aún no has completado esta tarea semanal.`
      });
    }
  }
  
  const incompleteTasks = weeklyTasks.filter(t => !t.completed);
  if (incompleteTasks.length > 3 && now.getDay() === 0) {
    insights.push({
      type: "task_reminder",
      priority: "medium",
      emoji: "📋",
      message: `Tienes ${incompleteTasks.length} tareas semanales pendientes y hoy es domingo. ¿Puedes completar alguna antes de que termine la semana?`
    });
  }
  
  return insights;
}

async function analyzeRadioEvents(userId: string): Promise<Insight[]> {
  const insights: Insight[] = [];
  const tasks = await storage.getTasks(userId);
  const now = new Date();
  
  const upcomingRadios = tasks.filter(t => 
    t.title === "Radio" && 
    t.externalSource === "google" &&
    new Date(t.date) > now &&
    differenceInDays(new Date(t.date), now) <= 7
  );
  
  for (const radio of upcomingRadios) {
    const description = radio.description || "";
    const lines = description.split("\n").map(l => l.trim()).filter(l => l);
    
    const emptySlots: string[] = [];
    for (const line of lines) {
      const match = line.match(/^(\d+):\s*$/);
      if (match) {
        emptySlots.push(`${match[1]}pm`);
      }
    }
    
    if (emptySlots.length > 0) {
      const radioDate = new Date(radio.date);
      const daysUntil = differenceInDays(radioDate, now);
      
      insights.push({
        type: "radio_alert",
        priority: daysUntil <= 2 ? "high" : "medium",
        emoji: "🎧",
        message: `El Radio del ${format(radioDate, "EEEE d 'de' MMMM", { locale: es })} tiene slots vacíos (${emptySlots.join(", ")}). ${daysUntil <= 2 ? "¡Es en " + daysUntil + " días!" : `Faltan ${daysUntil} días para confirmar DJs.`}`
      });
    }
  }
  
  return insights;
}

export async function generateProactiveInsights(userId = getSystemUserId()): Promise<Insight[]> {
  const allInsights: Insight[] = [];
  
  try {
    const [goalInsights, taskInsights, radioInsights] = await Promise.all([
      analyzeGoalsAndPortfolio(userId),
      analyzeWeeklyTasks(userId),
      analyzeRadioEvents(userId)
    ]);
    
    allInsights.push(...goalInsights, ...taskInsights, ...radioInsights);
    
    allInsights.sort((a, b) => {
      const priorityOrder = { high: 0, medium: 1, low: 2 };
      return priorityOrder[a.priority] - priorityOrder[b.priority];
    });
    
  } catch (error) {
    console.error("Error generating proactive insights:", error);
  }
  
  return allInsights;
}

export async function sendProactiveInsights(userId = getSystemUserId()): Promise<{ sent: boolean; insights: number }> {
  const insights = await generateProactiveInsights(userId);
  
  if (insights.length === 0) {
    return { sent: false, insights: 0 };
  }
  
  const telegramConfig = await storage.getTelegramConfig(userId);
  const botToken = getTelegramBotToken();
  if (!telegramConfig || !telegramConfig.enabled || !telegramConfig.chatId || !botToken) {
    console.log("Telegram not configured or disabled, skipping proactive insights");
    return { sent: false, insights: insights.length };
  }
  
  let message = "🧠 Insights del día\n\n";
  message += "He analizado tu calendario, metas y tareas. Aquí hay algunas sugerencias:\n\n";
  
  for (const insight of insights) {
    const priorityLabel = insight.priority === "high" ? "❗" : "";
    message += `${insight.emoji} ${priorityLabel}${insight.message}\n\n`;
  }
  
  message += "— Tu asistente BlackOps";
  
  try {
    await sendTelegramPlainMessage(botToken, telegramConfig.chatId, message);
    return { sent: true, insights: insights.length };
  } catch (error) {
    console.error("Error sending proactive insights:", error);
    return { sent: false, insights: insights.length };
  }
}
