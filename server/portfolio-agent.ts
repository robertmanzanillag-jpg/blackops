import { storage } from "./storage";
import { sendTelegramMessage } from "./telegram";
import { getPrice, getBatchCryptoPrices, getStockHistoricalData, getCryptoHistoricalData } from "./finance";
import { format } from "date-fns";
import { es } from "date-fns/locale";
import { getSystemUserId } from "./user-context";
import { hasRealValue } from "./ceo-doctor-cli";

function getTelegramBotToken(): string | null {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  return hasRealValue(token) ? token : null;
}

interface PortfolioSummary {
  totalValue: number;
  equity: number;
  marginUsed: number;
  marginTotal: number;
  totalGain: number;
  gainPercent: number;
  distribution: { type: string; value: number; percent: number }[];
  topGainers: { symbol: string; gain: number; gainPercent: number }[];
  topLosers: { symbol: string; gain: number; gainPercent: number }[];
  topDailyGainers: { symbol: string; dailyChange: number }[];
  topDailyLosers: { symbol: string; dailyChange: number }[];
}

interface RebalanceRecommendation {
  action: "buy" | "sell" | "hold";
  symbol: string;
  reason: string;
  priority: "high" | "medium" | "low";
  currentPercent: number;
  targetPercent?: number;
}

interface PriceOpportunity {
  symbol: string;
  name: string;
  currentPrice: number;
  reason: string;
  type: "dip" | "recovery" | "alert";
}

// Map frontend period to Yahoo Finance period format
const periodToYahooFormat: Record<string, string> = {
  day: "1D",
  week: "1W",
  month: "1M",
  year: "1Y",
  all: "ALL",
};

export interface PeriodGains {
  topGainers: { symbol: string; changePercent: number }[];
  topLosers: { symbol: string; changePercent: number }[];
}

export async function getGainsByPeriod(period: string, userId = getSystemUserId()): Promise<PeriodGains> {
  const investments = await storage.getInvestments(userId);
  const gains: { symbol: string; changePercent: number }[] = [];
  const yahooFormat = periodToYahooFormat[period] || "1M";

  for (const inv of investments) {
    try {
      let changePercent = 0;
      
      if (inv.type === 'crypto') {
        const historicalData = await getCryptoHistoricalData(inv.symbol, yahooFormat);
        if (historicalData && historicalData.changePercent !== undefined) {
          changePercent = historicalData.changePercent;
        }
      } else {
        const historicalData = await getStockHistoricalData(inv.symbol, yahooFormat);
        if (historicalData && historicalData.changePercent !== undefined) {
          changePercent = historicalData.changePercent;
        }
      }
      
      gains.push({ symbol: inv.symbol, changePercent });
    } catch (e) {
      console.error(`Error getting historical data for ${inv.symbol}:`, e);
      gains.push({ symbol: inv.symbol, changePercent: 0 });
    }
  }

  const sorted = [...gains].sort((a, b) => b.changePercent - a.changePercent);
  const topGainers = sorted.filter(g => g.changePercent > 0).slice(0, 3);
  const topLosers = sorted.filter(g => g.changePercent < 0).slice(-3).reverse();

  return { topGainers, topLosers };
}

export async function getPortfolioSummary(userId = getSystemUserId()): Promise<PortfolioSummary> {
  const investments = await storage.getInvestments(userId);
  
  let totalValue = 0;
  let totalCost = 0;
  const byType: Record<string, number> = {};
  const gains: { symbol: string; gain: number; gainPercent: number; value: number; dailyChange: number }[] = [];

  // Pre-fetch all crypto prices in one batch call to avoid rate limiting
  const cryptoSymbols = investments
    .filter(inv => inv.type === 'crypto')
    .map(inv => inv.symbol);
  
  const cryptoPrices = cryptoSymbols.length > 0 
    ? await getBatchCryptoPrices(cryptoSymbols)
    : new Map();

  for (const inv of investments) {
    const quantity = parseFloat(inv.quantity);
    const avgPrice = parseFloat(inv.avgBuyPrice);
    
    let currentPrice = avgPrice;
    let dailyChangePercent = 0;
    try {
      if (inv.type === 'crypto') {
        // Use batch-fetched crypto prices
        const cryptoPrice = cryptoPrices.get(inv.symbol);
        if (cryptoPrice) {
          currentPrice = cryptoPrice.price;
          dailyChangePercent = cryptoPrice.changePercent24h || 0;
        }
      } else {
        // Fetch stock/ETF prices individually (Yahoo Finance doesn't rate limit as aggressively)
        const priceData = await getPrice(inv.symbol, inv.type);
        if (priceData) {
          currentPrice = priceData.price;
          dailyChangePercent = priceData.changePercent24h || 0;
        }
      }
    } catch (e) {
      console.error(`Error getting price for ${inv.symbol}:`, e);
    }

    const value = quantity * currentPrice;
    const cost = quantity * avgPrice;
    const gain = value - cost;
    const gainPercent = avgPrice > 0 ? ((currentPrice - avgPrice) / avgPrice) * 100 : 0;

    totalValue += value;
    totalCost += cost;
    byType[inv.type] = (byType[inv.type] || 0) + value;
    gains.push({ symbol: inv.symbol, gain, gainPercent, value, dailyChange: dailyChangePercent });
  }

  const distribution = Object.entries(byType).map(([type, value]) => ({
    type,
    value,
    percent: totalValue > 0 ? (value / totalValue) * 100 : 0,
  }));

  // Sort by total gains (since purchase)
  const sortedGains = [...gains].sort((a, b) => b.gainPercent - a.gainPercent);
  const topGainers = sortedGains.slice(0, 3);
  const topLosers = sortedGains.slice(-3).reverse();
  
  // Sort by daily change
  const sortedByDaily = [...gains].sort((a, b) => b.dailyChange - a.dailyChange);
  const topDailyGainers = sortedByDaily.slice(0, 3);
  const topDailyLosers = sortedByDaily.slice(-3).reverse();

  // Get margin configuration
  const portfolioConfig = await storage.getPortfolioConfig(userId);
  const marginUsed = portfolioConfig ? parseFloat(portfolioConfig.marginUsed) : 0;
  const marginTotal = portfolioConfig ? parseFloat(portfolioConfig.marginTotal) : 0;
  
  // Equity = Total Value - Margin Used
  const equity = totalValue - marginUsed;

  return {
    totalValue,
    equity,
    marginUsed,
    marginTotal,
    totalGain: totalValue - totalCost,
    gainPercent: totalCost > 0 ? ((totalValue - totalCost) / totalCost) * 100 : 0,
    distribution,
    topGainers,
    topLosers,
    topDailyGainers: topDailyGainers.map(g => ({ symbol: g.symbol, dailyChange: g.dailyChange })),
    topDailyLosers: topDailyLosers.map(g => ({ symbol: g.symbol, dailyChange: g.dailyChange })),
  };
}

export async function analyzeRebalancing(userId = getSystemUserId()): Promise<RebalanceRecommendation[]> {
  const investments = await storage.getInvestments(userId);
  const recommendations: RebalanceRecommendation[] = [];

  if (investments.length === 0) {
    return [];
  }

  let totalValue = 0;
  for (const inv of investments) {
    const quantity = parseFloat(inv.quantity);
    const price = parseFloat(inv.avgBuyPrice);
    totalValue += quantity * price;
  }

  const byType: Record<string, number> = {};
  for (const inv of investments) {
    const quantity = parseFloat(inv.quantity);
    const price = parseFloat(inv.avgBuyPrice);
    const value = quantity * price;
    byType[inv.type] = (byType[inv.type] || 0) + value;
  }

  const idealAllocation: Record<string, { min: number; max: number }> = {
    stock: { min: 30, max: 50 },
    etf: { min: 20, max: 40 },
    crypto: { min: 5, max: 20 },
    bond: { min: 10, max: 30 },
    fund: { min: 10, max: 30 },
  };

  for (const [type, value] of Object.entries(byType)) {
    const percent = (value / totalValue) * 100;
    const limits = idealAllocation[type];

    if (limits) {
      if (percent > limits.max) {
        recommendations.push({
          action: "sell",
          symbol: type.toUpperCase(),
          reason: `${type} representa ${percent.toFixed(1)}% del portfolio (máximo recomendado: ${limits.max}%)`,
          priority: percent > limits.max + 10 ? "high" : "medium",
          currentPercent: percent,
          targetPercent: limits.max,
        });
      } else if (percent < limits.min) {
        recommendations.push({
          action: "buy",
          symbol: type.toUpperCase(),
          reason: `${type} representa solo ${percent.toFixed(1)}% del portfolio (mínimo recomendado: ${limits.min}%)`,
          priority: percent < limits.min - 5 ? "high" : "medium",
          currentPercent: percent,
          targetPercent: limits.min,
        });
      }
    }
  }

  for (const inv of investments) {
    const avgPrice = parseFloat(inv.avgBuyPrice);
    let currentPrice = avgPrice;
    
    try {
      const priceData = await getPrice(inv.symbol, inv.type);
      if (priceData) {
        currentPrice = priceData.price;
      }
    } catch (e) {
    }

    const gainPercent = avgPrice > 0 ? ((currentPrice - avgPrice) / avgPrice) * 100 : 0;

    if (gainPercent > 50) {
      recommendations.push({
        action: "sell",
        symbol: inv.symbol,
        reason: `${inv.symbol} ha subido ${gainPercent.toFixed(1)}% - considera tomar ganancias`,
        priority: gainPercent > 100 ? "high" : "medium",
        currentPercent: gainPercent,
      });
    } else if (gainPercent < -30) {
      recommendations.push({
        action: "hold",
        symbol: inv.symbol,
        reason: `${inv.symbol} ha caído ${Math.abs(gainPercent).toFixed(1)}% - evalúa si mantener o promediar`,
        priority: gainPercent < -50 ? "high" : "low",
        currentPercent: gainPercent,
      });
    }
  }

  return recommendations.sort((a, b) => {
    const priorityOrder = { high: 0, medium: 1, low: 2 };
    return priorityOrder[a.priority] - priorityOrder[b.priority];
  });
}

export async function checkPriceOpportunities(userId = getSystemUserId()): Promise<PriceOpportunity[]> {
  const watchlist = await storage.getWatchlist(userId);
  const alerts = await storage.getPriceAlerts(userId);
  const opportunities: PriceOpportunity[] = [];

  for (const item of watchlist) {
    try {
      const priceData = await getPrice(item.symbol, item.type);
      if (!priceData) continue;

      const changePercent = priceData.change24h || 0;

      if (changePercent < -10) {
        opportunities.push({
          symbol: item.symbol,
          name: item.name,
          currentPrice: priceData.price,
          reason: `Caída de ${Math.abs(changePercent).toFixed(1)}% en 24h - posible oportunidad de compra`,
          type: "dip",
        });
      } else if (changePercent > 15) {
        opportunities.push({
          symbol: item.symbol,
          name: item.name,
          currentPrice: priceData.price,
          reason: `Subida de ${changePercent.toFixed(1)}% en 24h - momentum positivo`,
          type: "recovery",
        });
      }
    } catch (error) {
    }
  }

  for (const alert of alerts.filter(a => a.enabled)) {
    try {
      const priceData = await getPrice(alert.symbol, alert.type || "stock");
      if (!priceData) continue;

      const currentPrice = priceData.price;
      const targetPrice = parseFloat(alert.targetPrice);
      
      if (alert.condition === "above" && currentPrice >= targetPrice) {
        opportunities.push({
          symbol: alert.symbol,
          name: alert.symbol,
          currentPrice,
          reason: `Precio superó objetivo de $${targetPrice} - alerta activada`,
          type: "alert",
        });
      } else if (alert.condition === "below" && currentPrice <= targetPrice) {
        opportunities.push({
          symbol: alert.symbol,
          name: alert.symbol,
          currentPrice,
          reason: `Precio cayó por debajo de $${targetPrice} - alerta activada`,
          type: "alert",
        });
      }
    } catch (error) {
    }
  }

  return opportunities;
}

export async function generateWeeklyReport(userId = getSystemUserId()): Promise<string> {
  const summary = await getPortfolioSummary(userId);
  const recommendations = await analyzeRebalancing(userId);
  const opportunities = await checkPriceOpportunities(userId);

  const dateStr = format(new Date(), "d 'de' MMMM", { locale: es });

  let report = `📊 *Reporte Semanal - ${dateStr}*\n\n`;

  report += `💰 *Resumen del Portfolio*\n`;
  report += `• Valor total: $${summary.totalValue.toLocaleString("en-US", { minimumFractionDigits: 2 })}\n`;
  report += `• Ganancia/Pérdida: ${summary.totalGain >= 0 ? "+" : ""}$${summary.totalGain.toLocaleString("en-US", { minimumFractionDigits: 2 })} (${summary.gainPercent >= 0 ? "+" : ""}${summary.gainPercent.toFixed(2)}%)\n\n`;

  if (summary.distribution.length > 0) {
    report += `📈 *Distribución*\n`;
    for (const d of summary.distribution) {
      report += `• ${d.type}: ${d.percent.toFixed(1)}%\n`;
    }
    report += `\n`;
  }

  if (summary.topGainers.length > 0 && summary.topGainers[0].gainPercent > 0) {
    report += `🚀 *Top Ganadores*\n`;
    for (const g of summary.topGainers.filter(x => x.gainPercent > 0)) {
      report += `• ${g.symbol}: +${g.gainPercent.toFixed(1)}%\n`;
    }
    report += `\n`;
  }

  if (summary.topLosers.length > 0 && summary.topLosers[0].gainPercent < 0) {
    report += `📉 *Mayores Pérdidas*\n`;
    for (const l of summary.topLosers.filter(x => x.gainPercent < 0)) {
      report += `• ${l.symbol}: ${l.gainPercent.toFixed(1)}%\n`;
    }
    report += `\n`;
  }

  if (recommendations.length > 0) {
    const highPriority = recommendations.filter(r => r.priority === "high");
    if (highPriority.length > 0) {
      report += `⚠️ *Recomendaciones Urgentes*\n`;
      for (const r of highPriority.slice(0, 3)) {
        const emoji = r.action === "buy" ? "🟢" : r.action === "sell" ? "🔴" : "🟡";
        report += `${emoji} ${r.reason}\n`;
      }
      report += `\n`;
    }
  }

  if (opportunities.length > 0) {
    report += `🎯 *Oportunidades Detectadas*\n`;
    for (const o of opportunities.slice(0, 3)) {
      const emoji = o.type === "dip" ? "💎" : o.type === "recovery" ? "🚀" : "🔔";
      report += `${emoji} ${o.symbol}: ${o.reason}\n`;
    }
  }

  return report;
}

export async function sendWeeklyPortfolioReport(userId = getSystemUserId()): Promise<{ sent: boolean; message: string }> {
  try {
    const telegramConfig = await storage.getTelegramConfig(userId);
    const botToken = getTelegramBotToken();
    if (!telegramConfig || !telegramConfig.chatId || !botToken) {
      return { sent: false, message: "Telegram no configurado" };
    }

    const report = await generateWeeklyReport(userId);
    const sent = await sendTelegramMessage(botToken, telegramConfig.chatId, report);
    return { sent, message: sent ? "Reporte semanal enviado" : "No se pudo enviar el reporte" };
  } catch (error) {
    console.error("Error sending weekly report:", error);
    return { sent: false, message: "Error al generar el reporte" };
  }
}
