import { storage } from "./storage";
import { sendTelegramMessage } from "./telegram";
import { sendPushNotification } from "./push-notifications";
import type { MonitoredProject } from "@shared/schema";
import { hasRealValue } from "./ceo-doctor-cli";

const CHECK_INTERVAL_MS = 60 * 1000; // Check every minute

function getTelegramBotToken(): string | null {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  return hasRealValue(token) ? token : null;
}

interface HealthCheckResult {
  status: "online" | "offline" | "degraded";
  responseTime: number | null;
  statusCode: number | null;
  errorMessage: string | null;
}

async function checkProjectHealth(url: string): Promise<HealthCheckResult> {
  const startTime = Date.now();
  
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000); // 10 second timeout
    
    const response = await fetch(url, {
      method: "GET",
      signal: controller.signal,
      headers: {
        "User-Agent": "BlackOps-Monitor/1.0",
      },
    });
    
    clearTimeout(timeoutId);
    const responseTime = Date.now() - startTime;
    
    if (response.ok) {
      return {
        status: responseTime > 5000 ? "degraded" : "online",
        responseTime,
        statusCode: response.status,
        errorMessage: null,
      };
    } else {
      return {
        status: "offline",
        responseTime,
        statusCode: response.status,
        errorMessage: `HTTP ${response.status}: ${response.statusText}`,
      };
    }
  } catch (error: any) {
    const responseTime = Date.now() - startTime;
    return {
      status: "offline",
      responseTime: null,
      statusCode: null,
      errorMessage: error.message || "Connection failed",
    };
  }
}

async function handleStatusChange(
  project: MonitoredProject,
  result: HealthCheckResult
): Promise<void> {
  const wasNotOffline = project.status !== "offline";
  const isNowOffline = result.status === "offline";
  
  // Project went down (from any non-offline state)
  if (wasNotOffline && isNowOffline && project.notifyOnDown) {
    // Check if there's already an active incident
    const activeIncident = await storage.getActiveIncident(project.id);
    
    if (!activeIncident) {
      // Create new incident
      const incident = await storage.createIncident({
        projectId: project.id,
        startedAt: new Date(),
        notified: true,
      });
      
      // Send Telegram notification
      const telegramConfig = await storage.getTelegramConfig(project.userId);
      const botToken = getTelegramBotToken();
      if (telegramConfig?.enabled && telegramConfig.chatId && botToken) {
        const message = `🔴 *ALERTA: Proyecto Caído*\n\n` +
          `📦 *${project.name}*\n` +
          `🔗 ${project.url}\n` +
          `❌ Error: ${result.errorMessage || "Sin respuesta"}\n` +
          `⏰ ${new Date().toLocaleString("es-ES")}`;
        
        await sendTelegramMessage(botToken, telegramConfig.chatId, message);
      }

      await sendPushNotification(project.userId, {
        title: "Proyecto caido",
        body: `${project.name} no responde. ${result.errorMessage || "Sin respuesta"}`,
        url: "/projects",
        tag: `project-down-${project.id}`,
      });
    }
  }
  
  // Project came back online
  if (project.status === "offline" && result.status === "online") {
    const activeIncident = await storage.getActiveIncident(project.id);
    
    if (activeIncident) {
      const resolved = await storage.resolveIncident(activeIncident.id);
      
      // Send recovery notification
      const telegramConfig = await storage.getTelegramConfig(project.userId);
      const botToken = getTelegramBotToken();
      if (telegramConfig?.enabled && telegramConfig.chatId && botToken) {
        const durationMinutes = Math.floor((resolved.duration || 0) / 60);
        const durationSeconds = (resolved.duration || 0) % 60;
        const durationStr = durationMinutes > 0 
          ? `${durationMinutes}m ${durationSeconds}s` 
          : `${durationSeconds}s`;
        
        const message = `🟢 *Proyecto Recuperado*\n\n` +
          `📦 *${project.name}*\n` +
          `🔗 ${project.url}\n` +
          `⏱️ Tiempo de caída: ${durationStr}\n` +
          `📊 Tiempo de respuesta: ${result.responseTime}ms\n` +
          `⏰ ${new Date().toLocaleString("es-ES")}`;
        
        await sendTelegramMessage(botToken, telegramConfig.chatId, message);
      }

      await sendPushNotification(project.userId, {
        title: "Proyecto recuperado",
        body: `${project.name} volvio online en ${result.responseTime}ms.`,
        url: "/projects",
        tag: `project-recovered-${project.id}`,
      });
    }
  }
}

async function checkAllProjects(): Promise<void> {
  try {
    const projects = await storage.getAllMonitoredProjects();
    
    for (const project of projects) {
      const result = await checkProjectHealth(project.url);
      
      // Log the health check
      await storage.createHealthCheckLog({
        projectId: project.id,
        status: result.status,
        responseTime: result.responseTime,
        statusCode: result.statusCode,
        errorMessage: result.errorMessage,
      });
      
      // Handle status changes
      await handleStatusChange(project, result);
      
      // Update project status
      await storage.updateMonitoredProject(project.id, {
        status: result.status,
        lastCheck: new Date(),
        lastOnline: result.status === "online" ? new Date() : project.lastOnline,
        responseTime: result.responseTime,
      });
    }
  } catch (error) {
    console.error("Error checking projects:", error);
  }
}

export function startHealthCheckScheduler(): void {
  console.log("Health check scheduler started");
  
  // Run immediately on start
  checkAllProjects();
  
  // Then run every minute
  setInterval(checkAllProjects, CHECK_INTERVAL_MS);
}

export async function checkSingleProject(projectId: string): Promise<HealthCheckResult | null> {
  const project = await storage.getMonitoredProject(projectId);
  if (!project) return null;
  
  const result = await checkProjectHealth(project.url);
  
  // Log the health check
  await storage.createHealthCheckLog({
    projectId: project.id,
    status: result.status,
    responseTime: result.responseTime,
    statusCode: result.statusCode,
    errorMessage: result.errorMessage,
  });
  
  // Handle status changes (notifications)
  await handleStatusChange(project, result);
  
  // Update project status
  await storage.updateMonitoredProject(project.id, {
    status: result.status,
    lastCheck: new Date(),
    lastOnline: result.status === "online" ? new Date() : project.lastOnline,
    responseTime: result.responseTime,
  });
  
  return result;
}
