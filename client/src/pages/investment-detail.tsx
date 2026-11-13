import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useRoute, Link } from "wouter";
import { motion } from "framer-motion";
import {
  ArrowLeft,
  TrendingUp,
  TrendingDown,
  RefreshCw,
  BarChart3,
  Bitcoin,
  Clock,
  DollarSign,
  Activity,
  Layers,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { queryClient } from "@/lib/queryClient";
import type { Investment } from "@shared/schema";

interface HistoricalDataPoint {
  timestamp: number;
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

interface HistoricalPriceData {
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

const PERIODS = ["1D", "1W", "1M", "3M", "6M", "1Y", "YTD", "ALL"] as const;

const CRYPTO_SYMBOLS = ["BTC", "ETH", "SOL", "XRP", "ADA", "DOGE", "DOT", "AVAX", "MATIC", "LINK", "LTC", "UNI", "ATOM", "XLM", "ALGO", "NEAR", "FTM", "SAND", "MANA", "AXS", "SHIB", "CRO", "VET", "THETA", "APE", "FIL", "EGLD", "ICP", "HBAR", "EOS", "XMR", "NEO", "WAVES", "ZEC", "DASH", "CAKE", "AAVE", "MKR", "COMP", "SUSHI", "YFI", "SNX", "CRV", "BAL", "RUNE", "1INCH", "ENS", "LDO", "GMX", "OP", "ARB", "APT", "SUI", "INJ", "TIA", "SEI", "PEPE", "BONK", "WIF", "JUP"];

function detectAssetType(symbol: string): "stock" | "etf" | "crypto" {
  const upperSymbol = symbol.toUpperCase();
  if (CRYPTO_SYMBOLS.includes(upperSymbol)) return "crypto";
  if (upperSymbol.endsWith("-USD") || upperSymbol.endsWith("USDT")) return "crypto";
  return "stock";
}

export default function InvestmentDetail() {
  const [, params] = useRoute("/portfolio/:symbol");
  const symbol = params?.symbol?.toUpperCase() || "";
  const [selectedPeriod, setSelectedPeriod] = useState<string>("1M");

  const { data: investments = [] } = useQuery<Investment[]>({
    queryKey: ["investments"],
    queryFn: () => fetch("/api/investments").then((r) => r.json()),
  });

  const investment = investments.find((inv) => inv.symbol.toUpperCase() === symbol);
  const investmentType = investment?.type || detectAssetType(symbol);

  // Get current price in real-time (separate from historical data)
  const { data: currentPriceData } = useQuery<{
    symbol: string;
    name: string;
    price: number;
    change24h: number;
    changePercent24h: number;
    high24h?: number;
    low24h?: number;
    volume24h?: number;
    marketCap?: number;
  }>({
    queryKey: ["price", symbol, investmentType],
    queryFn: async () => {
      const res = await fetch(`/api/finance/price/${symbol}?type=${investmentType}`);
      if (!res.ok) return null;
      return res.json();
    },
    enabled: !!symbol,
    refetchInterval: 60000, // Refresh every minute
  });

  const { data: historicalData, isLoading } = useQuery<HistoricalPriceData>({
    queryKey: ["historical", symbol, investmentType, selectedPeriod],
    queryFn: () =>
      fetch(`/api/finance/history/${symbol}?type=${investmentType}&period=${selectedPeriod}`).then((r) =>
        r.json()
      ),
    enabled: !!symbol,
    refetchInterval: selectedPeriod === "1D" ? 60000 : undefined,
  });

  // Use current price as primary source, historical as fallback
  const displayPrice = currentPriceData?.price || historicalData?.currentPrice || 0;
  const displayChange = currentPriceData?.change24h || historicalData?.change || 0;
  const displayChangePercent = currentPriceData?.changePercent24h || historicalData?.changePercent || 0;
  const displayName = currentPriceData?.name || historicalData?.name || investment?.name || symbol;
  const displayHigh = currentPriceData?.high24h || historicalData?.high || 0;
  const displayLow = currentPriceData?.low24h || historicalData?.low || 0;
  const displayVolume = currentPriceData?.volume24h || historicalData?.volume || 0;
  const displayMarketCap = currentPriceData?.marketCap || historicalData?.marketCap;

  const formatCurrency = (value: number | undefined | null) => {
    if (value === undefined || value === null || isNaN(value)) return "$0.00";
    return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(value);
  };

  const formatNumber = (value: number | undefined | null) => {
    if (value === undefined || value === null || isNaN(value)) return "0";
    return new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 2 }).format(value);
  };

  const formatPercent = (value: number | undefined | null) => {
    if (value === undefined || value === null || isNaN(value)) return "0.00%";
    return `${value >= 0 ? "+" : ""}${value.toFixed(2)}%`;
  };

  const pnl = useMemo(() => {
    if (!investment || displayPrice <= 0) return null;
    const quantity = parseFloat(investment.quantity);
    const avgBuyPrice = parseFloat(investment.avgBuyPrice);
    const costBasis = quantity * avgBuyPrice;
    const currentValue = quantity * displayPrice;
    const gain = currentValue - costBasis;
    const gainPercent = costBasis > 0 ? (gain / costBasis) * 100 : 0;
    return { costBasis, currentValue, gain, gainPercent };
  }, [investment, displayPrice]);

  const chartData = useMemo(() => {
    if (!historicalData?.data?.length) return null;
    const data = historicalData.data;
    const avgBuyPrice = investment ? parseFloat(investment.avgBuyPrice) : null;
    
    // Include avgBuyPrice in min/max calculation if we have an investment
    const pricesForRange = data.map((d) => d.close);
    if (avgBuyPrice && avgBuyPrice > 0) {
      pricesForRange.push(avgBuyPrice);
    }
    
    const minPrice = Math.min(...pricesForRange);
    const maxPrice = Math.max(...pricesForRange);
    const range = maxPrice - minPrice || 1;
    const width = 100;
    const height = 100;
    const padding = 5;

    const points = data.map((d, i) => {
      const x = (i / (data.length - 1)) * (width - padding * 2) + padding;
      const y = height - padding - ((d.close - minPrice) / range) * (height - padding * 2);
      return `${x},${y}`;
    });

    // Calculate Y position for buy price line
    let buyPriceY: number | null = null;
    if (avgBuyPrice && avgBuyPrice > 0) {
      buyPriceY = height - padding - ((avgBuyPrice - minPrice) / range) * (height - padding * 2);
    }

    return {
      path: `M ${points.join(" L ")}`,
      gradient: historicalData.changePercent >= 0,
      minPrice,
      maxPrice,
      buyPriceY,
      avgBuyPrice,
    };
  }, [historicalData, investment]);

  const isPositive = displayChangePercent >= 0;

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100">
      <header className="sticky top-0 z-40 border-b border-zinc-800 bg-zinc-950/95 backdrop-blur">
        <div className="container flex h-14 items-center gap-4 px-4">
          <Link href="/portfolio">
            <Button variant="ghost" size="icon" data-testid="button-back">
              <ArrowLeft className="h-5 w-5" />
            </Button>
          </Link>
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-lg bg-zinc-800 flex items-center justify-center">
              {investmentType === "crypto" ? (
                <Bitcoin className="h-5 w-5 text-zinc-400" />
              ) : (
                <BarChart3 className="h-5 w-5 text-zinc-400" />
              )}
            </div>
            <div>
              <h1 className="text-lg font-semibold">{symbol}</h1>
              <p className="text-sm text-zinc-500">{displayName}</p>
            </div>
          </div>
          <div className="ml-auto">
            <Button
              variant="ghost"
              size="icon"
              onClick={() => queryClient.invalidateQueries({ queryKey: ["historical", symbol] })}
              data-testid="button-refresh"
            >
              <RefreshCw className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </header>

      <main className="container px-4 py-6 space-y-6">
        {isLoading && !currentPriceData ? (
          <div className="text-center py-12 text-zinc-500">
            <RefreshCw className="h-8 w-8 mx-auto mb-4 animate-spin" />
            <p>Cargando datos...</p>
          </div>
        ) : (
          <>
            <div className="space-y-2">
              <div className="flex items-baseline gap-4">
                <span className="text-4xl font-bold" data-testid="text-current-price">
                  {formatCurrency(displayPrice)}
                </span>
                <span
                  className={`text-lg font-medium flex items-center gap-1 ${
                    isPositive ? "text-zinc-400" : "text-zinc-400"
                  }`}
                  data-testid="text-change-percent"
                >
                  {isPositive ? <TrendingUp className="h-4 w-4" /> : <TrendingDown className="h-4 w-4" />}
                  {formatPercent(displayChangePercent)}
                </span>
              </div>
              <p className="text-sm text-zinc-500">
                {formatCurrency(displayChange)} hoy
              </p>
            </div>

            <Card className="bg-zinc-900 border-zinc-800">
              <CardContent className="p-4">
                <div className="flex gap-2 mb-4 overflow-x-auto pb-2">
                  {PERIODS.map((period) => (
                    <Button
                      key={period}
                      size="sm"
                      variant={selectedPeriod === period ? "default" : "ghost"}
                      className={
                        selectedPeriod === period
                          ? "bg-zinc-800 hover:bg-zinc-800"
                          : "text-zinc-400 hover:text-zinc-100"
                      }
                      onClick={() => setSelectedPeriod(period)}
                      data-testid={`button-period-${period}`}
                    >
                      {period}
                    </Button>
                  ))}
                </div>

                {chartData && (
                  <div className="relative h-48 mb-4">
                    <svg
                      viewBox="0 0 100 100"
                      preserveAspectRatio="none"
                      className="w-full h-full"
                    >
                      <defs>
                        <linearGradient id={`gradient-${symbol}`} x1="0" y1="0" x2="0" y2="1">
                          <stop
                            offset="0%"
                            stopColor={chartData.gradient ? "#d4d4d8" : "#71717a"}
                            stopOpacity="0.3"
                          />
                          <stop
                            offset="100%"
                            stopColor={chartData.gradient ? "#d4d4d8" : "#71717a"}
                            stopOpacity="0"
                          />
                        </linearGradient>
                      </defs>
                      <path
                        d={`${chartData.path} L 95,95 L 5,95 Z`}
                        fill={`url(#gradient-${symbol})`}
                      />
                      <path
                        d={chartData.path}
                        fill="none"
                        stroke={chartData.gradient ? "#d4d4d8" : "#71717a"}
                        strokeWidth="0.8"
                        vectorEffect="non-scaling-stroke"
                      />
                      {chartData.buyPriceY !== null && (
                        <line
                          x1="5"
                          y1={chartData.buyPriceY}
                          x2="95"
                          y2={chartData.buyPriceY}
                          stroke="#a1a1aa"
                          strokeWidth="0.5"
                          strokeDasharray="2,2"
                          vectorEffect="non-scaling-stroke"
                        />
                      )}
                    </svg>
                    <div className="absolute top-2 left-2 text-xs text-zinc-500">
                      {formatCurrency(chartData.maxPrice)}
                    </div>
                    <div className="absolute bottom-2 left-2 text-xs text-zinc-500">
                      {formatCurrency(chartData.minPrice)}
                    </div>
                    {chartData.buyPriceY !== null && chartData.avgBuyPrice && (
                      <div 
                        className="absolute right-2 text-xs text-zinc-400 font-medium bg-zinc-900/80 px-1 rounded"
                        style={{ top: `${(chartData.buyPriceY / 100) * 100}%`, transform: 'translateY(-50%)' }}
                      >
                        Compra: {formatCurrency(chartData.avgBuyPrice)}
                      </div>
                    )}
                  </div>
                )}

                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                  <div>
                    <p className="text-zinc-500">Máximo 24h</p>
                    <p className="font-medium text-zinc-400">{formatCurrency(displayHigh)}</p>
                  </div>
                  <div>
                    <p className="text-zinc-500">Mínimo 24h</p>
                    <p className="font-medium text-zinc-400">{formatCurrency(displayLow)}</p>
                  </div>
                  <div>
                    <p className="text-zinc-500">Volumen 24h</p>
                    <p className="font-medium">{formatNumber(displayVolume)}</p>
                  </div>
                  <div>
                    <p className="text-zinc-500">Market Cap</p>
                    <p className="font-medium">{displayMarketCap ? formatNumber(displayMarketCap) : "N/A"}</p>
                  </div>
                </div>
              </CardContent>
            </Card>

            {pnl && investment && (
              <Card className="bg-zinc-900 border-zinc-800">
                <CardHeader>
                  <CardTitle className="text-sm flex items-center gap-2">
                    <DollarSign className="h-4 w-4 text-zinc-400" /> Tu Posición
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <p className="text-sm text-zinc-500">Cantidad</p>
                      <p className="text-xl font-bold">{investment.quantity}</p>
                    </div>
                    <div>
                      <p className="text-sm text-zinc-500">Precio Promedio</p>
                      <p className="text-xl font-bold">{formatCurrency(parseFloat(investment.avgBuyPrice))}</p>
                    </div>
                  </div>

                  <div className="h-px bg-zinc-800" />

                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <p className="text-sm text-zinc-500">Costo Base</p>
                      <p className="text-lg font-medium">{formatCurrency(pnl.costBasis)}</p>
                    </div>
                    <div>
                      <p className="text-sm text-zinc-500">Valor Actual</p>
                      <p className="text-lg font-medium">{formatCurrency(pnl.currentValue)}</p>
                    </div>
                  </div>

                  <div
                    className={`p-4 rounded-lg ${
                      pnl.gain >= 0 ? "bg-zinc-900/10 border border-white/10" : "bg-zinc-900/10 border border-white/10"
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-sm text-zinc-400">Ganancia / Pérdida</p>
                        <p
                          className={`text-2xl font-bold ${pnl.gain >= 0 ? "text-zinc-400" : "text-zinc-400"}`}
                          data-testid="text-pnl-value"
                        >
                          {formatCurrency(pnl.gain)}
                        </p>
                      </div>
                      <div
                        className={`text-right ${pnl.gain >= 0 ? "text-zinc-400" : "text-zinc-400"}`}
                      >
                        {pnl.gainPercent >= 0 ? (
                          <TrendingUp className="h-8 w-8 mb-1" />
                        ) : (
                          <TrendingDown className="h-8 w-8 mb-1" />
                        )}
                        <p className="text-lg font-bold" data-testid="text-pnl-percent">
                          {formatPercent(pnl.gainPercent)}
                        </p>
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            )}

            <Card className="bg-zinc-900 border-zinc-800">
              <CardHeader>
                <CardTitle className="text-sm flex items-center gap-2">
                  <Activity className="h-4 w-4 text-zinc-400" /> Estadísticas
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 gap-4 text-sm">
                  {displayMarketCap && displayMarketCap > 0 && (
                    <div>
                      <p className="text-zinc-500">Market Cap</p>
                      <p className="font-medium">${formatNumber(displayMarketCap)}</p>
                    </div>
                  )}
                  <div>
                    <p className="text-zinc-500">Tipo</p>
                    <p className="font-medium capitalize">
                      {investmentType === "crypto" ? "Criptomoneda" : investmentType === "etf" ? "ETF" : "Acción"}
                    </p>
                  </div>
                  <div>
                    <p className="text-zinc-500">Rango 24h</p>
                    <p className="font-medium">
                      {formatCurrency(displayLow)} - {formatCurrency(displayHigh)}
                    </p>
                  </div>
                  <div>
                    <p className="text-zinc-500">Cambio 24h</p>
                    <p className={`font-medium ${isPositive ? "text-zinc-400" : "text-zinc-400"}`}>
                      {formatCurrency(displayChange)}
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </>
        )}
      </main>
    </div>
  );
}
