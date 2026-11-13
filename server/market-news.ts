import { storage } from "./storage";
import { sendTelegramMessage } from "./telegram";
import { getStockPrice, getCryptoPrice } from "./finance";
import { hasRealValue } from "./ceo-doctor-cli";

function getTelegramBotToken(): string | null {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  return hasRealValue(token) ? token : null;
}
interface PortfolioSummary {
  totalValue: number;
  dailyChange: number;
  dailyChangePercent: number;
  stocksValue: number;
  etfsValue: number;
  cryptoValue: number;
  topGainers: { symbol: string; change: number }[];
  topLosers: { symbol: string; change: number }[];
}

async function calculatePortfolioSummary(userId: string): Promise<PortfolioSummary> {
  const investments = await storage.getInvestments(userId);
  
  let stocksValue = 0;
  let etfsValue = 0;
  let cryptoValue = 0;
  const changes: { symbol: string; change: number; value: number }[] = [];

  for (const inv of investments) {
    const quantity = parseFloat(inv.quantity);
    const avgPrice = parseFloat(inv.avgBuyPrice);
    let currentPrice = avgPrice;
    let change = 0;

    try {
      if (inv.type === "crypto") {
        const priceData = await getCryptoPrice(inv.symbol);
        if (priceData) {
          currentPrice = priceData.price;
          change = priceData.changePercent24h || 0;
        }
      } else {
        const priceData = await getStockPrice(inv.symbol);
        if (priceData) {
          currentPrice = priceData.price;
          change = priceData.changePercent24h || 0;
        }
      }
    } catch (error) {
      console.error(`Error getting price for ${inv.symbol}:`, error);
    }

    const value = quantity * currentPrice;
    changes.push({ symbol: inv.symbol, change, value });

    if (inv.type === "stock") stocksValue += value;
    else if (inv.type === "etf") etfsValue += value;
    else if (inv.type === "crypto") cryptoValue += value;
  }

  const totalValue = stocksValue + etfsValue + cryptoValue;
  
  const sortedChanges = [...changes].sort((a, b) => b.change - a.change);
  const topGainers = sortedChanges.slice(0, 3).filter(c => c.change > 0);
  const topLosers = sortedChanges.slice(-3).reverse().filter(c => c.change < 0);

  const lastSnapshot = await storage.getLatestPortfolioSnapshot(userId);
  const previousValue = lastSnapshot ? parseFloat(lastSnapshot.totalValue) : totalValue;
  const dailyChange = totalValue - previousValue;
  const dailyChangePercent = previousValue > 0 ? (dailyChange / previousValue) * 100 : 0;

  return {
    totalValue,
    dailyChange,
    dailyChangePercent,
    stocksValue,
    etfsValue,
    cryptoValue,
    topGainers,
    topLosers,
  };
}

async function savePortfolioSnapshot(userId: string, summary: PortfolioSummary): Promise<void> {
  await storage.createPortfolioSnapshot(userId, {
    userId,
    date: new Date(),
    totalValue: summary.totalValue.toFixed(2),
    stocksValue: summary.stocksValue.toFixed(2),
    etfsValue: summary.etfsValue.toFixed(2),
    cryptoValue: summary.cryptoValue.toFixed(2),
    dailyChange: summary.dailyChange.toFixed(2),
    dailyChangePercent: summary.dailyChangePercent.toFixed(2),
  });
}

async function sendDailyMarketUpdateForUser(userId: string): Promise<boolean> {
  const telegramConfig = await storage.getTelegramConfig(userId);
  const botToken = getTelegramBotToken();
  if (!telegramConfig?.enabled || !telegramConfig.chatId || !botToken) {
    console.log(`[Market] Telegram not configured or disabled for ${userId}, skipping market update`);
    return false;
  }

  const summary = await calculatePortfolioSummary(userId);
  await savePortfolioSnapshot(userId, summary);

  const changeEmoji = summary.dailyChange >= 0 ? "📈" : "📉";
  const changeSign = summary.dailyChange >= 0 ? "+" : "";

  let message = `📊 *RESUMEN DIARIO DE MERCADO*\n`;
  message += `━━━━━━━━━━━━━━━━━━━━\n\n`;

  message += `💰 *Tu Portafolio*\n`;
  message += `Total: *$${summary.totalValue.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}*\n`;
  message += `${changeEmoji} Cambio: ${changeSign}$${summary.dailyChange.toFixed(2)} (${changeSign}${summary.dailyChangePercent.toFixed(2)}%)\n\n`;

  message += `📊 *Distribución*\n`;
  message += `• Acciones: $${summary.stocksValue.toLocaleString("en-US", { minimumFractionDigits: 2 })}\n`;
  message += `• ETFs: $${summary.etfsValue.toLocaleString("en-US", { minimumFractionDigits: 2 })}\n`;
  message += `• Crypto: $${summary.cryptoValue.toLocaleString("en-US", { minimumFractionDigits: 2 })}\n\n`;

  if (summary.topGainers.length > 0) {
    message += `🟢 *Top Ganadores*\n`;
    summary.topGainers.forEach(g => {
      message += `• ${g.symbol}: +${g.change.toFixed(2)}%\n`;
    });
    message += `\n`;
  }

  if (summary.topLosers.length > 0) {
    message += `🔴 *Top Perdedores*\n`;
    summary.topLosers.forEach(l => {
      message += `• ${l.symbol}: ${l.change.toFixed(2)}%\n`;
    });
    message += `\n`;
  }

  message += `⏰ ${new Date().toLocaleString("es-ES", { dateStyle: "full", timeStyle: "short" })}`;

  await sendTelegramMessage(botToken, telegramConfig.chatId, message);
  console.log(`[Market] Daily market update sent successfully for ${userId}`);
  return true;
}

async function sendDailyMarketUpdate(): Promise<void> {
  try {
    const telegramConfigs = await storage.getEnabledTelegramConfigs();
    const userIds = Array.from(new Set(telegramConfigs.map((config) => config.userId)));
    if (userIds.length === 0) {
      console.log("[Market] No enabled Telegram users, skipping market update");
      return;
    }

    const results = await Promise.all(userIds.map((userId) => sendDailyMarketUpdateForUser(userId)));
    console.log(`[Market] Daily market update processed for ${userIds.length} user(s), sent ${results.filter(Boolean).length}`);
  } catch (error) {
    console.error("Error sending daily market update:", error);
  }
}

function scheduleAt(hour: number, minute: number, callback: () => void): void {
  const now = new Date();
  let target = new Date(now);
  target.setHours(hour, minute, 0, 0);
  
  if (target <= now) {
    target.setDate(target.getDate() + 1);
  }
  
  const msUntilTarget = target.getTime() - now.getTime();
  
  console.log(`Market update scheduled for ${target.toLocaleString("es-ES")}`);
  
  setTimeout(() => {
    callback();
    setInterval(callback, 24 * 60 * 60 * 1000);
  }, msUntilTarget);
}

export function startMarketNewsScheduler(): void {
  console.log("Starting market news scheduler...");
  scheduleAt(12, 0, sendDailyMarketUpdate);
}

export { sendDailyMarketUpdate, sendDailyMarketUpdateForUser, calculatePortfolioSummary };
