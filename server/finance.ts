// Finance Service - Stock and Crypto price fetching
import { hasRealValue } from "./ceo-doctor-cli";

export interface PriceData {
  symbol: string;
  name: string;
  price: number;
  change24h: number;
  changePercent24h: number;
  high24h?: number;
  low24h?: number;
  volume24h?: number;
  marketCap?: number;
  lastUpdated: Date;
}

export interface MarketNews {
  title: string;
  description: string;
  url: string;
  source: string;
  publishedAt: Date;
  sentiment?: "positive" | "negative" | "neutral";
}

// CoinGecko API for crypto prices (free, no API key needed)
const COINGECKO_API = "https://api.coingecko.com/api/v3";

// Yahoo Finance via unofficial API
const YAHOO_API = "https://query1.finance.yahoo.com/v8/finance/chart";

// Common crypto symbol to CoinGecko ID mapping
export const cryptoIdMap: Record<string, string> = {
  BTC: "bitcoin",
  ETH: "ethereum",
  SOL: "solana",
  XRP: "ripple",
  ADA: "cardano",
  DOGE: "dogecoin",
  DOT: "polkadot",
  MATIC: "matic-network",
  LINK: "chainlink",
  AVAX: "avalanche-2",
  ATOM: "cosmos",
  UNI: "uniswap",
  LTC: "litecoin",
  BCH: "bitcoin-cash",
  XLM: "stellar",
  ALGO: "algorand",
  VET: "vechain",
  FIL: "filecoin",
  AAVE: "aave",
  NEAR: "near",
  APT: "aptos",
  ARB: "arbitrum",
  OP: "optimism",
  HBAR: "hedera-hashgraph",
};

// Price cache to reduce API calls (cache for 5 minutes)
const priceCache: Map<string, { data: PriceData; timestamp: number }> = new Map();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

function getCachedPrice(symbol: string): PriceData | null {
  const cached = priceCache.get(symbol.toUpperCase());
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    return cached.data;
  }
  return null;
}

function setCachedPrice(symbol: string, data: PriceData): void {
  priceCache.set(symbol.toUpperCase(), { data, timestamp: Date.now() });
}

export async function getCryptoPrice(symbol: string): Promise<PriceData | null> {
  // Check cache first
  const cached = getCachedPrice(symbol);
  if (cached) {
    return cached;
  }

  try {
    const coinId = cryptoIdMap[symbol.toUpperCase()] || symbol.toLowerCase();
    const response = await fetch(
      `${COINGECKO_API}/coins/${coinId}?localization=false&tickers=false&community_data=false&developer_data=false`
    );
    
    if (!response.ok) {
      console.error(`CoinGecko error for ${symbol}:`, response.status);
      return null;
    }
    
    const data = await response.json();
    
    const priceData: PriceData = {
      symbol: symbol.toUpperCase(),
      name: data.name,
      price: data.market_data.current_price.usd,
      change24h: data.market_data.price_change_24h,
      changePercent24h: data.market_data.price_change_percentage_24h,
      high24h: data.market_data.high_24h.usd,
      low24h: data.market_data.low_24h.usd,
      volume24h: data.market_data.total_volume.usd,
      marketCap: data.market_data.market_cap.usd,
      lastUpdated: new Date(),
    };

    setCachedPrice(symbol, priceData);
    return priceData;
  } catch (error) {
    console.error(`Error fetching crypto price for ${symbol}:`, error);
    return null;
  }
}

export async function getStockPrice(symbol: string): Promise<PriceData | null> {
  // Check cache first
  const cached = getCachedPrice(symbol);
  if (cached) {
    return cached;
  }

  try {
    const response = await fetch(
      `${YAHOO_API}/${symbol}?interval=1d&range=1d`,
      {
        headers: {
          "User-Agent": "Mozilla/5.0",
        },
      }
    );
    
    if (!response.ok) {
      console.error(`Yahoo Finance error for ${symbol}:`, response.status);
      return null;
    }
    
    const data = await response.json();
    const result = data.chart?.result?.[0];
    
    if (!result) {
      return null;
    }
    
    const meta = result.meta;
    const quote = result.indicators?.quote?.[0];
    
    const currentPrice = meta.regularMarketPrice || meta.previousClose;
    const previousClose = meta.chartPreviousClose || meta.previousClose;
    const change = currentPrice - previousClose;
    const changePercent = (change / previousClose) * 100;
    
    const priceData: PriceData = {
      symbol: symbol.toUpperCase(),
      name: meta.shortName || meta.symbol,
      price: currentPrice,
      change24h: change,
      changePercent24h: changePercent,
      high24h: quote?.high?.[0],
      low24h: quote?.low?.[0],
      volume24h: quote?.volume?.[0],
      marketCap: meta.marketCap,
      lastUpdated: new Date(),
    };

    setCachedPrice(symbol, priceData);
    return priceData;
  } catch (error) {
    console.error(`Error fetching stock price for ${symbol}:`, error);
    return null;
  }
}

export async function getPrice(
  symbol: string,
  type: "stock" | "crypto" | "etf" | "bond" | "fund"
): Promise<PriceData | null> {
  if (type === "crypto") {
    return getCryptoPrice(symbol);
  }
  // Stocks, ETFs, bonds, and funds all use Yahoo Finance
  return getStockPrice(symbol);
}

export async function getBatchCryptoPrices(symbols: string[]): Promise<Map<string, PriceData>> {
  const results = new Map<string, PriceData>();
  
  try {
    const coinIds = symbols
      .map((s) => cryptoIdMap[s.toUpperCase()] || s.toLowerCase())
      .join(",");
    
    const response = await fetch(
      `${COINGECKO_API}/coins/markets?vs_currency=usd&ids=${coinIds}&order=market_cap_desc&sparkline=false`
    );
    
    if (!response.ok) {
      console.error("CoinGecko batch error:", response.status);
      return results;
    }
    
    const data = await response.json();
    
    for (const coin of data) {
      const symbol = Object.entries(cryptoIdMap).find(([_, id]) => id === coin.id)?.[0] || coin.symbol.toUpperCase();
      results.set(symbol, {
        symbol,
        name: coin.name,
        price: coin.current_price,
        change24h: coin.price_change_24h,
        changePercent24h: coin.price_change_percentage_24h,
        high24h: coin.high_24h,
        low24h: coin.low_24h,
        volume24h: coin.total_volume,
        marketCap: coin.market_cap,
        lastUpdated: new Date(),
      });
    }
  } catch (error) {
    console.error("Error fetching batch crypto prices:", error);
  }
  
  return results;
}

export async function getMarketOverview(): Promise<{
  stocks: { name: string; symbol: string; price: number; change: number }[];
  crypto: { name: string; symbol: string; price: number; change: number }[];
}> {
  const majorStocks = ["SPY", "QQQ", "AAPL", "MSFT", "GOOGL", "AMZN"];
  const majorCrypto = ["BTC", "ETH", "SOL", "XRP"];
  
  const stockPromises = majorStocks.map((s) => getStockPrice(s));
  const cryptoPromises = majorCrypto.map((s) => getCryptoPrice(s));
  
  const [stocks, cryptos] = await Promise.all([
    Promise.all(stockPromises),
    Promise.all(cryptoPromises),
  ]);
  
  return {
    stocks: stocks
      .filter((s): s is PriceData => s !== null)
      .map((s) => ({
        name: s.name,
        symbol: s.symbol,
        price: s.price,
        change: s.changePercent24h,
      })),
    crypto: cryptos
      .filter((c): c is PriceData => c !== null)
      .map((c) => ({
        name: c.name,
        symbol: c.symbol,
        price: c.price,
        change: c.changePercent24h,
      })),
  };
}

// Historical price data interfaces
export interface HistoricalDataPoint {
  timestamp: number;
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface HistoricalPriceData {
  symbol: string;
  name: string;
  period: string;
  data: HistoricalDataPoint[];
  currentPrice: number;
  change: number;
  changePercent: number;
  high: number;
  low: number;
  open: number;
  volume: number;
  marketCap?: number;
}

// Period to Yahoo Finance range/interval mapping
const periodConfig: Record<string, { range: string; interval: string }> = {
  "1D": { range: "1d", interval: "5m" },
  "1W": { range: "5d", interval: "15m" },
  "1M": { range: "1mo", interval: "1h" },
  "3M": { range: "3mo", interval: "1d" },
  "6M": { range: "6mo", interval: "1d" },
  "1Y": { range: "1y", interval: "1d" },
  "YTD": { range: "ytd", interval: "1d" },
  "ALL": { range: "max", interval: "1wk" },
};

export async function getStockHistoricalData(
  symbol: string,
  period: string = "1M"
): Promise<HistoricalPriceData | null> {
  try {
    const config = periodConfig[period] || periodConfig["1M"];
    const response = await fetch(
      `${YAHOO_API}/${symbol}?range=${config.range}&interval=${config.interval}`,
      { headers: { "User-Agent": "Mozilla/5.0" } }
    );

    if (!response.ok) {
      console.error(`Yahoo Finance historical error for ${symbol}:`, response.status);
      return null;
    }

    const data = await response.json();
    const result = data.chart?.result?.[0];

    if (!result) return null;

    const meta = result.meta;
    const timestamps = result.timestamp || [];
    const quote = result.indicators?.quote?.[0] || {};

    const dataPoints: HistoricalDataPoint[] = timestamps.map((ts: number, i: number) => ({
      timestamp: ts * 1000,
      date: new Date(ts * 1000).toISOString(),
      open: quote.open?.[i] || 0,
      high: quote.high?.[i] || 0,
      low: quote.low?.[i] || 0,
      close: quote.close?.[i] || 0,
      volume: quote.volume?.[i] || 0,
    })).filter((d: HistoricalDataPoint) => d.close > 0);

    if (dataPoints.length === 0) return null;

    const firstPrice = dataPoints[0].close;
    const lastPrice = dataPoints[dataPoints.length - 1].close;
    const change = lastPrice - firstPrice;
    const changePercent = (change / firstPrice) * 100;

    const allHighs = dataPoints.map((d: HistoricalDataPoint) => d.high);
    const allLows = dataPoints.map((d: HistoricalDataPoint) => d.low).filter((l: number) => l > 0);

    return {
      symbol: symbol.toUpperCase(),
      name: meta.shortName || meta.symbol,
      period,
      data: dataPoints,
      currentPrice: meta.regularMarketPrice || lastPrice,
      change,
      changePercent,
      high: Math.max(...allHighs),
      low: Math.min(...allLows),
      open: firstPrice,
      volume: dataPoints.reduce((sum: number, d: HistoricalDataPoint) => sum + d.volume, 0),
      marketCap: meta.marketCap,
    };
  } catch (error) {
    console.error(`Error fetching historical data for ${symbol}:`, error);
    return null;
  }
}

export async function getCryptoHistoricalData(
  symbol: string,
  period: string = "1M"
): Promise<HistoricalPriceData | null> {
  try {
    const coinId = cryptoIdMap[symbol.toUpperCase()] || symbol.toLowerCase();
    
    // Map periods to CoinGecko days
    const daysMap: Record<string, number | string> = {
      "1D": 1,
      "1W": 7,
      "1M": 30,
      "3M": 90,
      "6M": 180,
      "1Y": 365,
      "YTD": Math.ceil((Date.now() - new Date(new Date().getFullYear(), 0, 1).getTime()) / (1000 * 60 * 60 * 24)),
      "ALL": "max",
    };

    const days = daysMap[period] || 30;
    const response = await fetch(
      `${COINGECKO_API}/coins/${coinId}/market_chart?vs_currency=usd&days=${days}`
    );

    if (!response.ok) {
      console.error(`CoinGecko historical error for ${symbol}:`, response.status);
      return null;
    }

    const data = await response.json();
    const prices = data.prices || [];
    const volumes = data.total_volumes || [];

    if (prices.length === 0) return null;

    const dataPoints: HistoricalDataPoint[] = prices.map((p: [number, number], i: number) => ({
      timestamp: p[0],
      date: new Date(p[0]).toISOString(),
      open: p[1],
      high: p[1],
      low: p[1],
      close: p[1],
      volume: volumes[i]?.[1] || 0,
    }));

    const firstPrice = dataPoints[0].close;
    const lastPrice = dataPoints[dataPoints.length - 1].close;
    const change = lastPrice - firstPrice;
    const changePercent = (change / firstPrice) * 100;

    // Get current price info
    const priceInfo = await getCryptoPrice(symbol);

    return {
      symbol: symbol.toUpperCase(),
      name: priceInfo?.name || symbol,
      period,
      data: dataPoints,
      currentPrice: lastPrice,
      change,
      changePercent,
      high: Math.max(...dataPoints.map((d) => d.high)),
      low: Math.min(...dataPoints.map((d) => d.low)),
      open: firstPrice,
      volume: dataPoints.reduce((sum, d) => sum + d.volume, 0),
      marketCap: priceInfo?.marketCap,
    };
  } catch (error) {
    console.error(`Error fetching crypto historical data for ${symbol}:`, error);
    return null;
  }
}

export async function getHistoricalData(
  symbol: string,
  type: "stock" | "crypto" | "etf" | "bond" | "fund",
  period: string = "1M"
): Promise<HistoricalPriceData | null> {
  if (type === "crypto") {
    return getCryptoHistoricalData(symbol, period);
  }
  return getStockHistoricalData(symbol, period);
}

export async function searchSymbol(query: string): Promise<{ symbol: string; name: string; type: string }[]> {
  try {
    // Search in crypto first
    const cryptoMatch = Object.entries(cryptoIdMap).find(
      ([symbol, id]) =>
        symbol.toLowerCase().includes(query.toLowerCase()) ||
        id.toLowerCase().includes(query.toLowerCase())
    );
    
    const results: { symbol: string; name: string; type: string }[] = [];
    
    if (cryptoMatch) {
      const price = await getCryptoPrice(cryptoMatch[0]);
      if (price) {
        results.push({ symbol: cryptoMatch[0], name: price.name, type: "crypto" });
      }
    }
    
    // Search stocks via Yahoo
    const response = await fetch(
      `https://query1.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(query)}&quotesCount=5`,
      { headers: { "User-Agent": "Mozilla/5.0" } }
    );
    
    if (response.ok) {
      const data = await response.json();
      for (const quote of data.quotes || []) {
        if (quote.quoteType === "EQUITY" || quote.quoteType === "ETF") {
          results.push({
            symbol: quote.symbol,
            name: quote.shortname || quote.longname || quote.symbol,
            type: quote.quoteType.toLowerCase() === "etf" ? "etf" : "stock",
          });
        }
      }
    }
    
    return results.slice(0, 10);
  } catch (error) {
    console.error("Error searching symbols:", error);
    return [];
  }
}

// Finnhub API for financial news
const FINNHUB_API = "https://finnhub.io/api/v1";

export interface NewsItem {
  id: string;
  headline: string;
  summary: string;
  url: string;
  source: string;
  datetime: Date;
  related: string;
  image?: string;
}

export async function getCompanyNews(symbol: string, daysBack: number = 7): Promise<NewsItem[]> {
  try {
    const apiKey = process.env.FINNHUB_API_KEY;
    if (!hasRealValue(apiKey)) {
      console.error("FINNHUB_API_KEY not configured");
      return [];
    }

    const toDate = new Date();
    const fromDate = new Date();
    fromDate.setDate(fromDate.getDate() - daysBack);
    
    const from = fromDate.toISOString().split('T')[0];
    const to = toDate.toISOString().split('T')[0];

    const response = await fetch(
      `${FINNHUB_API}/company-news?symbol=${symbol}&from=${from}&to=${to}&token=${apiKey}`
    );

    if (!response.ok) {
      console.error(`Finnhub error for ${symbol}:`, response.status);
      return [];
    }

    const data = await response.json();
    
    return (data || []).slice(0, 5).map((item: any) => ({
      id: item.id?.toString() || `${symbol}-${item.datetime}`,
      headline: item.headline,
      summary: item.summary,
      url: item.url,
      source: item.source,
      datetime: new Date(item.datetime * 1000),
      related: item.related || symbol,
      image: item.image,
    }));
  } catch (error) {
    console.error(`Error fetching news for ${symbol}:`, error);
    return [];
  }
}

export async function getMarketNews(): Promise<NewsItem[]> {
  try {
    const apiKey = process.env.FINNHUB_API_KEY;
    if (!hasRealValue(apiKey)) {
      console.error("FINNHUB_API_KEY not configured");
      return [];
    }

    const response = await fetch(
      `${FINNHUB_API}/news?category=general&token=${apiKey}`
    );

    if (!response.ok) {
      console.error("Finnhub market news error:", response.status);
      return [];
    }

    const data = await response.json();
    
    return (data || []).slice(0, 10).map((item: any) => ({
      id: item.id?.toString() || `market-${item.datetime}`,
      headline: item.headline,
      summary: item.summary,
      url: item.url,
      source: item.source,
      datetime: new Date(item.datetime * 1000),
      related: item.related || "market",
      image: item.image,
    }));
  } catch (error) {
    console.error("Error fetching market news:", error);
    return [];
  }
}

export async function getPortfolioNews(symbols: string[]): Promise<NewsItem[]> {
  const stockSymbols = symbols.filter(s => !Object.keys(cryptoIdMap).includes(s.toUpperCase()));
  
  const newsPromises = stockSymbols.slice(0, 10).map(symbol => getCompanyNews(symbol, 3));
  const newsResults = await Promise.all(newsPromises);
  
  const allNews = newsResults.flat();
  
  allNews.sort((a, b) => b.datetime.getTime() - a.datetime.getTime());
  
  return allNews.slice(0, 20);
}
