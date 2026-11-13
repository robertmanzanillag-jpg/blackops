import { useState, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { motion, AnimatePresence } from "framer-motion";
import {
  TrendingUp,
  TrendingDown,
  Plus,
  Trash2,
  Search,
  DollarSign,
  Bitcoin,
  BarChart3,
  RefreshCw,
  ArrowLeft,
  Eye,
  Bell,
  PieChart,
  LineChart,
  Send,
  Newspaper,
  ExternalLink,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { queryClient } from "@/lib/queryClient";
import { Link } from "wouter";
import type { Investment, WatchlistItem } from "@shared/schema";

interface PriceData {
  symbol: string;
  name: string;
  price: number;
  change24h: number;
  changePercent24h: number;
}

interface MarketOverview {
  stocks: { name: string; symbol: string; price: number; change: number }[];
  crypto: { name: string; symbol: string; price: number; change: number }[];
}

interface PortfolioSummary {
  totalValue: number;
  equity: number;
  marginUsed: number;
  marginTotal: number;
  dailyChange: number;
  dailyChangePercent: number;
  totalGain: number;
  gainPercent: number;
  stocksValue: number;
  etfsValue: number;
  cryptoValue: number;
  distribution: { type: string; value: number; percent: number }[];
  topGainers: { symbol: string; change: number; gain: number; gainPercent: number }[];
  topLosers: { symbol: string; change: number; gain: number; gainPercent: number }[];
  topDailyGainers: { symbol: string; dailyChange: number }[];
  topDailyLosers: { symbol: string; dailyChange: number }[];
}

interface PeriodGains {
  topGainers: { symbol: string; changePercent: number }[];
  topLosers: { symbol: string; changePercent: number }[];
}

interface PortfolioHistoryItem {
  id: string;
  date: string;
  totalValue: string;
  stocksValue: string;
  etfsValue: string;
  cryptoValue: string;
  dailyChange: string | null;
  dailyChangePercent: string | null;
}

interface NewsItem {
  id: string;
  headline: string;
  summary: string;
  url: string;
  source: string;
  datetime: string;
  related: string;
  image?: string;
}

type InvestmentTypeFilter = "all" | "stock" | "etf" | "crypto" | "bond" | "fund";
type GainPeriod = "day" | "week" | "month" | "year" | "all";

export default function Portfolio() {
  const [searchQuery, setSearchQuery] = useState("");
  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const [selectedType, setSelectedType] = useState<InvestmentTypeFilter>("all");
  const [gainPeriod, setGainPeriod] = useState<GainPeriod>("all");
  const [newInvestment, setNewInvestment] = useState({
    symbol: "",
    name: "",
    type: "stock" as "stock" | "crypto" | "etf",
    quantity: "",
    avgBuyPrice: "",
  });

  const { data: investments = [], isLoading: investmentsLoading } = useQuery<Investment[]>({
    queryKey: ["investments"],
    queryFn: () => fetch("/api/investments").then((r) => r.json()),
  });

  const { data: watchlist = [] } = useQuery<WatchlistItem[]>({
    queryKey: ["watchlist"],
    queryFn: () => fetch("/api/watchlist").then((r) => r.json()),
  });

  const { data: market, isLoading: marketLoading } = useQuery<MarketOverview>({
    queryKey: ["market"],
    queryFn: () => fetch("/api/finance/market").then((r) => r.json()),
    refetchInterval: 60000,
  });

  const { data: portfolioSummary } = useQuery<PortfolioSummary>({
    queryKey: ["portfolioSummary"],
    queryFn: () => fetch("/api/portfolio/summary").then((r) => r.json()),
    refetchInterval: 60000,
  });

  const { data: portfolioHistory = [] } = useQuery<PortfolioHistoryItem[]>({
    queryKey: ["portfolioHistory"],
    queryFn: () => fetch("/api/portfolio/history?days=30").then((r) => r.json()),
  });

  const { data: periodGains, isLoading: periodGainsLoading } = useQuery<PeriodGains>({
    queryKey: ["periodGains", gainPeriod],
    queryFn: () => fetch(`/api/portfolio/gains/${gainPeriod}`).then((r) => r.json()),
    enabled: gainPeriod !== "all" && gainPeriod !== "day",
  });

  const { data: portfolioNews = [], isLoading: newsLoading } = useQuery<NewsItem[]>({
    queryKey: ["portfolioNews"],
    queryFn: () => fetch("/api/finance/news").then((r) => r.json()),
    refetchInterval: 300000,
  });

  const sendTestNotification = useMutation({
    mutationFn: () =>
      fetch("/api/portfolio/test-notification", { method: "POST" }).then((r) => r.json()),
  });

  const { data: searchResults = [] } = useQuery({
    queryKey: ["search", searchQuery],
    queryFn: () =>
      searchQuery.length >= 2
        ? fetch(`/api/finance/search?q=${searchQuery}`).then((r) => r.json())
        : [],
    enabled: searchQuery.length >= 2,
  });

  const createInvestment = useMutation({
    mutationFn: (investment: typeof newInvestment) =>
      fetch("/api/investments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(investment),
      }).then((r) => r.json()),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["investments"] });
      setAddDialogOpen(false);
      setNewInvestment({ symbol: "", name: "", type: "stock", quantity: "", avgBuyPrice: "" });
    },
  });

  const deleteInvestment = useMutation({
    mutationFn: (id: string) =>
      fetch(`/api/investments/${id}`, { method: "DELETE" }).then((r) => r.json()),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["investments"] }),
  });

  const addToWatchlist = useMutation({
    mutationFn: (item: { symbol: string; name: string; type: string }) =>
      fetch("/api/watchlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(item),
      }).then((r) => r.json()),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["watchlist"] }),
  });

  const removeFromWatchlist = useMutation({
    mutationFn: (id: string) =>
      fetch(`/api/watchlist/${id}`, { method: "DELETE" }).then((r) => r.json()),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["watchlist"] }),
  });

  // Use equity (real value after margin) from portfolio summary if available
  const equity = portfolioSummary?.equity ?? 0;
  const totalValue = portfolioSummary?.totalValue ?? investments.reduce((sum, inv) => {
    return sum + parseFloat(inv.quantity) * parseFloat(inv.avgBuyPrice);
  }, 0);
  const marginUsed = portfolioSummary?.marginUsed ?? 0;
  const marginTotal = portfolioSummary?.marginTotal ?? 0;

  const distribution = useMemo(() => {
    if (portfolioSummary && portfolioSummary.distribution) {
      const total = portfolioSummary.totalValue || 0;
      const distMap: Record<string, { value: number; percent: number }> = {};
      portfolioSummary.distribution.forEach((d: { type: string; value: number; percent: number }) => {
        distMap[d.type] = { value: d.value, percent: d.percent };
      });
      return {
        stocks: distMap.stock || { value: 0, percent: 0 },
        etfs: distMap.etf || { value: 0, percent: 0 },
        crypto: distMap.crypto || { value: 0, percent: 0 },
        bonds: distMap.bond || { value: 0, percent: 0 },
        funds: distMap.fund || { value: 0, percent: 0 },
        total,
      };
    }
    const byType = { stocks: 0, etfs: 0, crypto: 0, bonds: 0, funds: 0 };
    investments.forEach((inv) => {
      const value = parseFloat(inv.quantity) * parseFloat(inv.avgBuyPrice);
      if (inv.type === "stock") byType.stocks += value;
      else if (inv.type === "etf") byType.etfs += value;
      else if (inv.type === "crypto") byType.crypto += value;
      else if (inv.type === "bond") byType.bonds += value;
      else if (inv.type === "fund") byType.funds += value;
    });
    const total = byType.stocks + byType.etfs + byType.crypto + byType.bonds + byType.funds;
    return {
      stocks: { value: byType.stocks, percent: total > 0 ? (byType.stocks / total) * 100 : 0 },
      etfs: { value: byType.etfs, percent: total > 0 ? (byType.etfs / total) * 100 : 0 },
      crypto: { value: byType.crypto, percent: total > 0 ? (byType.crypto / total) * 100 : 0 },
      bonds: { value: byType.bonds, percent: total > 0 ? (byType.bonds / total) * 100 : 0 },
      funds: { value: byType.funds, percent: total > 0 ? (byType.funds / total) * 100 : 0 },
      total,
    };
  }, [investments, portfolioSummary]);

  const formatCurrency = (value: number) =>
    new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(value);

  const formatPercent = (value: number) =>
    `${value >= 0 ? "+" : ""}${value.toFixed(2)}%`;

  return (
    <div className="min-h-screen bg-black text-zinc-100">
      <header className="sticky top-0 z-40 border-b border-zinc-900/50 bg-black/95 backdrop-blur-xl">
        <div className="container flex h-16 items-center gap-4 px-4">
          <Link href="/">
            <Button variant="ghost" size="icon" className="hover:bg-zinc-900">
              <ArrowLeft className="h-5 w-5" />
            </Button>
          </Link>
          <div>
            <h1 className="text-xl font-bold bg-gradient-to-r from-zinc-950 to-zinc-900 bg-clip-text text-transparent">Portfolio</h1>
            <p className="text-xs text-zinc-600">Gestiona tus inversiones</p>
          </div>
          <div className="ml-auto flex items-center gap-2">
            <Button variant="ghost" size="icon" className="hover:bg-zinc-900" onClick={() => queryClient.invalidateQueries()}>
              <RefreshCw className="h-4 w-4 text-zinc-400" />
            </Button>
          </div>
        </div>
      </header>

      <main className="container px-4 py-8 space-y-8">
        <div className="grid gap-4 md:grid-cols-3">
          <Card className="bg-gradient-to-br from-zinc-900 to-black border-zinc-800/50 shadow-xl shadow-black/20">
            <CardHeader className="pb-2">
              <CardTitle className="text-xs font-medium text-zinc-500 uppercase tracking-wider flex items-center gap-2">
                <DollarSign className="h-3 w-3" /> {marginUsed > 0 ? "Equity" : "Valor Total"}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold text-white">{formatCurrency(marginUsed > 0 ? equity : totalValue)}</div>
              {marginUsed > 0 ? (
                <p className="text-xs text-zinc-600 mt-1">
                  Valor bruto: {formatCurrency(totalValue)} | Margen: {formatCurrency(marginUsed)}
                </p>
              ) : (
                <p className="text-xs text-zinc-600 mt-1">Actualizado en tiempo real</p>
              )}
            </CardContent>
          </Card>
          <Card className="bg-gradient-to-br from-zinc-900 to-black border-zinc-800/50 shadow-xl shadow-black/20">
            <CardHeader className="pb-2">
              <CardTitle className="text-xs font-medium text-zinc-500 uppercase tracking-wider flex items-center gap-2">
                <BarChart3 className="h-3 w-3" /> Inversiones
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold text-white">{investments.length}</div>
              <p className="text-xs text-zinc-600 mt-1">Activos en portafolio</p>
            </CardContent>
          </Card>
          <Card className="bg-gradient-to-br from-zinc-900 to-black border-zinc-800/50 shadow-xl shadow-black/20">
            <CardHeader className="pb-2">
              <CardTitle className="text-xs font-medium text-zinc-500 uppercase tracking-wider flex items-center gap-2">
                <Eye className="h-3 w-3" /> Watchlist
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold text-white">{watchlist.length}</div>
              <p className="text-xs text-zinc-600 mt-1">Símbolos seguidos</p>
            </CardContent>
          </Card>
        </div>

        <Tabs defaultValue="portfolio" className="space-y-6">
          <TabsList className="bg-zinc-950 border border-zinc-800/50 p-1 rounded-xl w-full flex flex-wrap gap-1 h-auto">
            <TabsTrigger value="portfolio" className="data-[state=active]:bg-zinc-800 data-[state=active]:text-white rounded-lg flex-1 min-w-[70px] text-xs sm:text-sm">Portafolio</TabsTrigger>
            <TabsTrigger value="analytics" className="data-[state=active]:bg-zinc-800 data-[state=active]:text-white rounded-lg flex-1 min-w-[70px] text-xs sm:text-sm">Analytics</TabsTrigger>
            <TabsTrigger value="market" className="data-[state=active]:bg-zinc-800 data-[state=active]:text-white rounded-lg flex-1 min-w-[70px] text-xs sm:text-sm">Mercado</TabsTrigger>
            <TabsTrigger value="watchlist" className="data-[state=active]:bg-zinc-800 data-[state=active]:text-white rounded-lg flex-1 min-w-[70px] text-xs sm:text-sm">Watchlist</TabsTrigger>
          </TabsList>

          <TabsContent value="portfolio" className="space-y-6">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-xl font-bold text-white">Mis Inversiones</h2>
                <p className="text-sm text-zinc-600">Tu cartera de activos</p>
              </div>
              <Dialog open={addDialogOpen} onOpenChange={setAddDialogOpen}>
                <DialogTrigger asChild>
                  <Button size="sm" className="bg-zinc-800 hover:bg-zinc-800">
                    <Plus className="h-4 w-4 mr-1" /> Agregar
                  </Button>
                </DialogTrigger>
                <DialogContent className="bg-zinc-900 border-zinc-800">
                  <DialogHeader>
                    <DialogTitle>Agregar Inversión</DialogTitle>
                  </DialogHeader>
                  <div className="space-y-4">
                    <div className="space-y-2">
                      <Label>Buscar Símbolo</Label>
                      <Input
                        placeholder="Buscar... (ej: AAPL, BTC)"
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        className="bg-zinc-800 border-zinc-700"
                      />
                      {searchResults.length > 0 && (
                        <div className="bg-zinc-800 rounded-lg border border-zinc-700 max-h-40 overflow-y-auto">
                          {searchResults.map((result: any) => (
                            <button
                              key={result.symbol}
                              className="w-full px-3 py-2 text-left hover:bg-zinc-700 flex items-center justify-between"
                              onClick={() => {
                                setNewInvestment({
                                  ...newInvestment,
                                  symbol: result.symbol,
                                  name: result.name,
                                  type: result.type,
                                });
                                setSearchQuery("");
                              }}
                            >
                              <span className="font-medium">{result.symbol}</span>
                              <span className="text-sm text-zinc-400">{result.name}</span>
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <Label>Símbolo</Label>
                        <Input
                          value={newInvestment.symbol}
                          onChange={(e) =>
                            setNewInvestment({ ...newInvestment, symbol: e.target.value.toUpperCase() })
                          }
                          className="bg-zinc-800 border-zinc-700"
                        />
                      </div>
                      <div className="space-y-2">
                        <Label>Tipo</Label>
                        <Select
                          value={newInvestment.type}
                          onValueChange={(v) => setNewInvestment({ ...newInvestment, type: v as any })}
                        >
                          <SelectTrigger className="bg-zinc-800 border-zinc-700">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="stock">Acción</SelectItem>
                            <SelectItem value="crypto">Crypto</SelectItem>
                            <SelectItem value="etf">ETF</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                    <div className="space-y-2">
                      <Label>Nombre</Label>
                      <Input
                        value={newInvestment.name}
                        onChange={(e) => setNewInvestment({ ...newInvestment, name: e.target.value })}
                        className="bg-zinc-800 border-zinc-700"
                      />
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <Label>Cantidad</Label>
                        <Input
                          type="number"
                          step="any"
                          value={newInvestment.quantity}
                          onChange={(e) => setNewInvestment({ ...newInvestment, quantity: e.target.value })}
                          className="bg-zinc-800 border-zinc-700"
                        />
                      </div>
                      <div className="space-y-2">
                        <Label>Precio Promedio</Label>
                        <Input
                          type="number"
                          step="any"
                          value={newInvestment.avgBuyPrice}
                          onChange={(e) => setNewInvestment({ ...newInvestment, avgBuyPrice: e.target.value })}
                          className="bg-zinc-800 border-zinc-700"
                        />
                      </div>
                    </div>
                    <Button
                      className="w-full bg-zinc-800 hover:bg-zinc-800"
                      onClick={() => createInvestment.mutate(newInvestment)}
                      disabled={!newInvestment.symbol || !newInvestment.quantity || !newInvestment.avgBuyPrice}
                    >
                      Agregar Inversión
                    </Button>
                  </div>
                </DialogContent>
              </Dialog>
            </div>

            {investmentsLoading ? (
              <div className="text-center py-8 text-zinc-500">Cargando...</div>
            ) : investments.length === 0 ? (
              <Card className="bg-zinc-900 border-zinc-800">
                <CardContent className="py-8 text-center text-zinc-500">
                  <DollarSign className="h-12 w-12 mx-auto mb-4 opacity-50" />
                  <p>No tienes inversiones registradas</p>
                  <p className="text-sm">Agrega tu primera inversión para empezar</p>
                </CardContent>
              </Card>
            ) : (
              <div className="space-y-3">
                {investments.map((inv) => (
                  <motion.div
                    key={inv.id}
                    layout
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                  >
                    <Card className="bg-gradient-to-r from-zinc-950 to-zinc-900 border-zinc-800/30 hover:border-zinc-700/50 transition-all duration-300 cursor-pointer group shadow-lg shadow-black/30">
                      <CardContent className="p-4 sm:p-5">
                        <div className="flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-0 sm:justify-between">
                          <Link href={`/portfolio/${inv.symbol}`} className="flex items-center gap-3 sm:gap-4 flex-1" data-testid={`link-investment-${inv.symbol}`}>
                            <div className={`h-10 w-10 sm:h-12 sm:w-12 rounded-xl flex items-center justify-center transition-transform group-hover:scale-105 flex-shrink-0 ${
                              inv.type === "crypto" 
                                ? "bg-gradient-to-br from-zinc-950/20 to-zinc-900/10 border border-white/10"
                                : inv.type === "etf"
                                ? "bg-gradient-to-br from-zinc-950/20 to-zinc-900/10 border border-white/10"
                                : "bg-gradient-to-br from-zinc-950/20 to-zinc-900/10 border border-white/10"
                            }`}>
                              {inv.type === "crypto" ? (
                                <Bitcoin className="h-5 w-5 sm:h-6 sm:w-6 text-zinc-400" />
                              ) : inv.type === "etf" ? (
                                <PieChart className="h-5 w-5 sm:h-6 sm:w-6 text-zinc-400" />
                              ) : (
                                <BarChart3 className="h-5 w-5 sm:h-6 sm:w-6 text-zinc-400" />
                              )}
                            </div>
                            <div className="min-w-0">
                              <div className="font-bold text-white text-base sm:text-lg">{inv.symbol}</div>
                              <div className="text-xs sm:text-sm text-zinc-500 truncate">{inv.name}</div>
                            </div>
                          </Link>
                          <div className="flex items-center justify-between sm:justify-end gap-3 pl-13 sm:pl-0">
                            <Link href={`/portfolio/${inv.symbol}`} className="text-right">
                              <div className="font-bold text-white text-lg sm:text-xl">
                                {formatCurrency(parseFloat(inv.quantity) * parseFloat(inv.avgBuyPrice))}
                              </div>
                              <div className="text-xs sm:text-sm text-zinc-500">
                                {parseFloat(inv.quantity).toLocaleString()} @ {formatCurrency(parseFloat(inv.avgBuyPrice))}
                              </div>
                            </Link>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="text-zinc-600 hover:text-white hover:bg-zinc-800/10 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity flex-shrink-0"
                              onClick={(e) => {
                                e.preventDefault();
                                e.stopPropagation();
                                deleteInvestment.mutate(inv.id);
                              }}
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  </motion.div>
                ))}
              </div>
            )}
          </TabsContent>

          <TabsContent value="analytics" className="space-y-6">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-xl font-bold text-white">Analytics del Portafolio</h2>
                <p className="text-sm text-zinc-600">Análisis y distribución de activos</p>
              </div>
              <Button
                size="sm"
                variant="outline"
                className="border-white/10 text-zinc-400 hover:bg-zinc-800/10 bg-zinc-900/5"
                onClick={() => sendTestNotification.mutate()}
                disabled={sendTestNotification.isPending}
              >
                <Send className="h-4 w-4 mr-1" />
                {sendTestNotification.isPending ? "Enviando..." : "Probar Notificación"}
              </Button>
            </div>

            <div className="grid gap-6 md:grid-cols-2">
              <Card className="bg-gradient-to-br from-zinc-950 to-zinc-900 border-zinc-800/30 shadow-xl shadow-black/20">
                <CardHeader>
                  <CardTitle className="text-sm flex items-center gap-2 text-zinc-300">
                    <PieChart className="h-4 w-4 text-zinc-400" /> Distribución del Portafolio
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="relative w-48 h-48 mx-auto mb-4">
                    <svg viewBox="0 0 100 100" className="w-full h-full -rotate-90">
                      {(() => {
                        const segments = [
                          { key: "stock", label: "Acciones", color: "#f4f4f5", percent: distribution.stocks.percent },
                          { key: "etf", label: "ETFs", color: "#d4d4d8", percent: distribution.etfs.percent },
                          { key: "crypto", label: "Crypto", color: "#a1a1aa", percent: distribution.crypto.percent },
                          { key: "bond", label: "Bonos", color: "#71717a", percent: distribution.bonds.percent },
                          { key: "fund", label: "Fondos", color: "#52525b", percent: distribution.funds.percent },
                        ].filter(s => s.percent > 0);
                        
                        let offset = 0;
                        return segments.map((seg, i) => {
                          const circumference = 2 * Math.PI * 40;
                          const dashLength = (seg.percent / 100) * circumference;
                          const dashOffset = -offset * circumference / 100;
                          offset += seg.percent;
                          
                          return (
                            <circle
                              key={seg.key}
                              cx="50"
                              cy="50"
                              r="40"
                              fill="none"
                              stroke={seg.color}
                              strokeWidth="20"
                              strokeDasharray={`${dashLength} ${circumference}`}
                              strokeDashoffset={dashOffset}
                              className={`cursor-pointer transition-all duration-200 ${selectedType === seg.key ? "opacity-100" : "opacity-80 hover:opacity-100"}`}
                              style={{ filter: selectedType === seg.key ? "brightness(1.2)" : "none" }}
                              onClick={() => setSelectedType(selectedType === seg.key ? "all" : seg.key as InvestmentTypeFilter)}
                              data-testid={`chart-segment-${seg.key}`}
                            />
                          );
                        });
                      })()}
                      <circle cx="50" cy="50" r="30" fill="#09090b" className="cursor-pointer" onClick={() => setSelectedType("all")} />
                    </svg>
                    <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                      <div className="text-lg font-bold">{formatCurrency(marginUsed > 0 ? equity : distribution.total)}</div>
                      <div className="text-xs text-zinc-500">{marginUsed > 0 ? "Equity" : "Total"}</div>
                    </div>
                  </div>
                  
                  <div className="space-y-2">
                    {distribution.stocks.percent > 0 && (
                      <button 
                        className={`w-full flex items-center justify-between p-2 rounded-lg transition-all ${selectedType === "stock" ? "bg-zinc-900/20 border border-white/10" : "hover:bg-zinc-800"}`}
                        onClick={() => setSelectedType(selectedType === "stock" ? "all" : "stock")}
                        data-testid="filter-stocks"
                      >
                        <div className="flex items-center gap-2">
                          <div className="w-3 h-3 rounded-full bg-zinc-800" />
                          <span className="text-sm">Acciones</span>
                        </div>
                        <div className="text-sm">
                          <span className="font-medium">{distribution.stocks.percent.toFixed(1)}%</span>
                          <span className="text-zinc-500 ml-2">{formatCurrency(distribution.stocks.value)}</span>
                        </div>
                      </button>
                    )}
                    {distribution.etfs.percent > 0 && (
                      <button 
                        className={`w-full flex items-center justify-between p-2 rounded-lg transition-all ${selectedType === "etf" ? "bg-zinc-900/20 border border-white/10" : "hover:bg-zinc-800"}`}
                        onClick={() => setSelectedType(selectedType === "etf" ? "all" : "etf")}
                        data-testid="filter-etfs"
                      >
                        <div className="flex items-center gap-2">
                          <div className="w-3 h-3 rounded-full bg-zinc-800" />
                          <span className="text-sm">ETFs</span>
                        </div>
                        <div className="text-sm">
                          <span className="font-medium">{distribution.etfs.percent.toFixed(1)}%</span>
                          <span className="text-zinc-500 ml-2">{formatCurrency(distribution.etfs.value)}</span>
                        </div>
                      </button>
                    )}
                    {distribution.crypto.percent > 0 && (
                      <button 
                        className={`w-full flex items-center justify-between p-2 rounded-lg transition-all ${selectedType === "crypto" ? "bg-zinc-900/20 border border-white/10" : "hover:bg-zinc-800"}`}
                        onClick={() => setSelectedType(selectedType === "crypto" ? "all" : "crypto")}
                        data-testid="filter-crypto"
                      >
                        <div className="flex items-center gap-2">
                          <div className="w-3 h-3 rounded-full bg-zinc-800" />
                          <span className="text-sm">Crypto</span>
                        </div>
                        <div className="text-sm">
                          <span className="font-medium">{distribution.crypto.percent.toFixed(1)}%</span>
                          <span className="text-zinc-500 ml-2">{formatCurrency(distribution.crypto.value)}</span>
                        </div>
                      </button>
                    )}
                    {distribution.bonds.percent > 0 && (
                      <button 
                        className={`w-full flex items-center justify-between p-2 rounded-lg transition-all ${selectedType === "bond" ? "bg-zinc-900/20 border border-white/10" : "hover:bg-zinc-800"}`}
                        onClick={() => setSelectedType(selectedType === "bond" ? "all" : "bond")}
                        data-testid="filter-bonds"
                      >
                        <div className="flex items-center gap-2">
                          <div className="w-3 h-3 rounded-full bg-zinc-800" />
                          <span className="text-sm">Bonos</span>
                        </div>
                        <div className="text-sm">
                          <span className="font-medium">{distribution.bonds.percent.toFixed(1)}%</span>
                          <span className="text-zinc-500 ml-2">{formatCurrency(distribution.bonds.value)}</span>
                        </div>
                      </button>
                    )}
                    {distribution.funds.percent > 0 && (
                      <button 
                        className={`w-full flex items-center justify-between p-2 rounded-lg transition-all ${selectedType === "fund" ? "bg-zinc-900/20 border border-white/10" : "hover:bg-zinc-800"}`}
                        onClick={() => setSelectedType(selectedType === "fund" ? "all" : "fund")}
                        data-testid="filter-funds"
                      >
                        <div className="flex items-center gap-2">
                          <div className="w-3 h-3 rounded-full bg-zinc-800" />
                          <span className="text-sm">Fondos</span>
                        </div>
                        <div className="text-sm">
                          <span className="font-medium">{distribution.funds.percent.toFixed(1)}%</span>
                          <span className="text-zinc-500 ml-2">{formatCurrency(distribution.funds.value)}</span>
                        </div>
                      </button>
                    )}
                  </div>

                  {selectedType !== "all" && (
                    <div className="mt-4 pt-4 border-t border-zinc-800">
                      <div className="flex items-center justify-between mb-3">
                        <h4 className="text-sm font-medium text-zinc-300">
                          {selectedType === "stock" ? "Acciones" : selectedType === "etf" ? "ETFs" : selectedType === "crypto" ? "Criptomonedas" : selectedType === "bond" ? "Bonos" : "Fondos"}
                        </h4>
                        <button onClick={() => setSelectedType("all")} className="text-xs text-zinc-500 hover:text-zinc-300">
                          Ver todo
                        </button>
                      </div>
                      <div className="space-y-2 max-h-48 overflow-y-auto">
                        {investments.filter(inv => inv.type === selectedType).map((inv) => (
                          <Link 
                            key={inv.id} 
                            href={`/portfolio/${inv.symbol}`}
                            className="flex items-center justify-between p-2 rounded-lg bg-zinc-800/50 hover:bg-zinc-800 transition-colors"
                            data-testid={`filtered-investment-${inv.symbol}`}
                          >
                            <div className="flex items-center gap-2">
                              <div className={`h-8 w-8 rounded-lg flex items-center justify-center ${
                                inv.type === "crypto" ? "bg-zinc-900/20" : inv.type === "etf" ? "bg-zinc-900/20" : "bg-zinc-900/20"
                              }`}>
                                {inv.type === "crypto" ? (
                                  <Bitcoin className="h-4 w-4 text-zinc-400" />
                                ) : inv.type === "etf" ? (
                                  <PieChart className="h-4 w-4 text-zinc-400" />
                                ) : (
                                  <BarChart3 className="h-4 w-4 text-zinc-400" />
                                )}
                              </div>
                              <div>
                                <div className="font-medium text-sm">{inv.symbol}</div>
                                <div className="text-xs text-zinc-500">{inv.name}</div>
                              </div>
                            </div>
                            <div className="text-right">
                              <div className="font-medium text-sm">
                                {formatCurrency(parseFloat(inv.quantity) * parseFloat(inv.avgBuyPrice))}
                              </div>
                              <div className="text-xs text-zinc-500">
                                {parseFloat(inv.quantity).toLocaleString()} unidades
                              </div>
                            </div>
                          </Link>
                        ))}
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>

              <Card className="bg-zinc-900 border-zinc-800">
                <CardHeader>
                  <CardTitle className="text-sm flex items-center gap-2">
                    <LineChart className="h-4 w-4 text-zinc-400" /> Rendimiento Histórico
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  {portfolioHistory.length > 0 ? (
                    <div className="h-48 relative">
                      <svg viewBox="0 0 300 100" className="w-full h-full" preserveAspectRatio="none">
                        {(() => {
                          const values = portfolioHistory.map(h => parseFloat(h.totalValue));
                          const min = Math.min(...values) * 0.95;
                          const max = Math.max(...values) * 1.05;
                          const range = max - min || 1;
                          
                          const points = values.map((v, i) => {
                            const x = (i / (values.length - 1 || 1)) * 300;
                            const y = 100 - ((v - min) / range) * 100;
                            return `${x},${y}`;
                          }).join(" ");
                          
                          const areaPoints = `0,100 ${points} 300,100`;
                          
                          return (
                            <>
                              <defs>
                                <linearGradient id="chartGradient" x1="0%" y1="0%" x2="0%" y2="100%">
                                  <stop offset="0%" stopColor="#d4d4d8" stopOpacity="0.3" />
                                  <stop offset="100%" stopColor="#d4d4d8" stopOpacity="0" />
                                </linearGradient>
                              </defs>
                              <polygon points={areaPoints} fill="url(#chartGradient)" />
                              <polyline
                                points={points}
                                fill="none"
                                stroke="#d4d4d8"
                                strokeWidth="2"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                              />
                            </>
                          );
                        })()}
                      </svg>
                      <div className="absolute bottom-0 left-0 right-0 flex justify-between text-xs text-zinc-500 px-2">
                        <span>{portfolioHistory.length > 0 ? new Date(portfolioHistory[0].date).toLocaleDateString("es-ES", { month: "short", day: "numeric" }) : ""}</span>
                        <span>{portfolioHistory.length > 0 ? new Date(portfolioHistory[portfolioHistory.length - 1].date).toLocaleDateString("es-ES", { month: "short", day: "numeric" }) : ""}</span>
                      </div>
                    </div>
                  ) : (
                    <div className="h-48 flex items-center justify-center text-zinc-500">
                      <div className="text-center">
                        <LineChart className="h-8 w-8 mx-auto mb-2 opacity-50" />
                        <p>Sin datos históricos aún</p>
                        <p className="text-xs">Los datos se guardarán diariamente</p>
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>

            {portfolioSummary && (
              <div className="space-y-4">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-xs text-zinc-500">Período:</span>
                  {[
                    { key: "day" as GainPeriod, label: "Día" },
                    { key: "week" as GainPeriod, label: "Semana" },
                    { key: "month" as GainPeriod, label: "Mes" },
                    { key: "year" as GainPeriod, label: "Año" },
                    { key: "all" as GainPeriod, label: "Desde compra" },
                  ].map((period) => (
                    <button
                      key={period.key}
                      onClick={() => setGainPeriod(period.key)}
                      className={`px-3 py-1 text-xs rounded-full transition-all ${
                        gainPeriod === period.key
                          ? "bg-zinc-900/20 text-zinc-400 border border-white/10"
                          : "bg-zinc-800 text-zinc-400 hover:bg-zinc-700"
                      }`}
                      data-testid={`period-${period.key}`}
                    >
                      {period.label}
                    </button>
                  ))}
                </div>
                <div className="grid gap-4 md:grid-cols-2">
                  <Card className="bg-zinc-900 border-zinc-800">
                    <CardHeader className="pb-2">
                      <CardTitle className="text-sm flex items-center gap-2 text-zinc-400">
                        <TrendingUp className="h-4 w-4" /> Mayores Ganancias
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-2">
                      {gainPeriod === "all" ? (
                        portfolioSummary.topGainers.length > 0 ? (
                          portfolioSummary.topGainers.map((g) => (
                            <div key={g.symbol} className="flex items-center justify-between">
                              <span className="font-medium">{g.symbol}</span>
                              <span className="text-zinc-400">+{g.gainPercent?.toFixed(2) ?? '0.00'}%</span>
                            </div>
                          ))
                        ) : (
                          <p className="text-xs text-zinc-500">Sin datos</p>
                        )
                      ) : gainPeriod === "day" ? (
                        portfolioSummary.topDailyGainers?.filter(g => g.dailyChange > 0).length > 0 ? (
                          portfolioSummary.topDailyGainers.filter(g => g.dailyChange > 0).map((g) => (
                            <div key={g.symbol} className="flex items-center justify-between">
                              <span className="font-medium">{g.symbol}</span>
                              <span className="text-zinc-400">+{g.dailyChange?.toFixed(2) ?? '0.00'}%</span>
                            </div>
                          ))
                        ) : (
                          <p className="text-xs text-zinc-500">Sin ganancias hoy</p>
                        )
                      ) : periodGainsLoading ? (
                        <p className="text-xs text-zinc-500">Cargando datos...</p>
                      ) : periodGains?.topGainers && periodGains.topGainers.length > 0 ? (
                        periodGains.topGainers.map((g) => (
                          <div key={g.symbol} className="flex items-center justify-between">
                            <span className="font-medium">{g.symbol}</span>
                            <span className="text-zinc-400">+{g.changePercent?.toFixed(2) ?? '0.00'}%</span>
                          </div>
                        ))
                      ) : (
                        <p className="text-xs text-zinc-500">Sin ganancias en este período</p>
                      )}
                    </CardContent>
                  </Card>
                  <Card className="bg-zinc-900 border-zinc-800">
                    <CardHeader className="pb-2">
                      <CardTitle className="text-sm flex items-center gap-2 text-zinc-400">
                        <TrendingDown className="h-4 w-4" /> Mayores Pérdidas
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-2">
                      {gainPeriod === "all" ? (
                        portfolioSummary.topLosers.length > 0 ? (
                          portfolioSummary.topLosers.map((l) => (
                            <div key={l.symbol} className="flex items-center justify-between">
                              <span className="font-medium">{l.symbol}</span>
                              <span className="text-zinc-400">{l.gainPercent?.toFixed(2) ?? '0.00'}%</span>
                            </div>
                          ))
                        ) : (
                          <p className="text-xs text-zinc-500">Sin datos</p>
                        )
                      ) : gainPeriod === "day" ? (
                        portfolioSummary.topDailyLosers?.filter(l => l.dailyChange < 0).length > 0 ? (
                          portfolioSummary.topDailyLosers.filter(l => l.dailyChange < 0).map((l) => (
                            <div key={l.symbol} className="flex items-center justify-between">
                              <span className="font-medium">{l.symbol}</span>
                              <span className="text-zinc-400">{l.dailyChange?.toFixed(2) ?? '0.00'}%</span>
                            </div>
                          ))
                        ) : (
                          <p className="text-xs text-zinc-500">Sin pérdidas hoy</p>
                        )
                      ) : periodGainsLoading ? (
                        <p className="text-xs text-zinc-500">Cargando datos...</p>
                      ) : periodGains?.topLosers && periodGains.topLosers.length > 0 ? (
                        periodGains.topLosers.map((l) => (
                          <div key={l.symbol} className="flex items-center justify-between">
                            <span className="font-medium">{l.symbol}</span>
                            <span className="text-zinc-400">{l.changePercent?.toFixed(2) ?? '0.00'}%</span>
                          </div>
                        ))
                      ) : (
                        <p className="text-xs text-zinc-500">Sin pérdidas en este período</p>
                      )}
                    </CardContent>
                  </Card>
                </div>
              </div>
            )}

            <Card className="bg-gradient-to-br from-zinc-950 to-zinc-900 border-zinc-800/30 shadow-xl shadow-black/20">
              <CardHeader>
                <CardTitle className="text-sm flex items-center gap-2 text-zinc-300">
                  <Newspaper className="h-4 w-4 text-zinc-400" /> Noticias de tu Portafolio
                </CardTitle>
              </CardHeader>
              <CardContent>
                {newsLoading ? (
                  <div className="flex items-center justify-center py-8">
                    <RefreshCw className="h-5 w-5 animate-spin text-zinc-400" />
                    <span className="ml-2 text-zinc-500">Cargando noticias...</span>
                  </div>
                ) : portfolioNews.length === 0 ? (
                  <div className="text-center py-8 text-zinc-500">
                    <Newspaper className="h-8 w-8 mx-auto mb-2 opacity-50" />
                    <p>No hay noticias disponibles</p>
                    <p className="text-xs mt-1">Configura tu API key de Finnhub para ver noticias</p>
                  </div>
                ) : (
                  <div className="space-y-4 max-h-96 overflow-y-auto">
                    {portfolioNews.map((news) => (
                      <a
                        key={news.id}
                        href={news.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="block p-3 rounded-lg bg-zinc-800/50 hover:bg-zinc-800 transition-colors group"
                        data-testid={`news-item-${news.id}`}
                      >
                        <div className="flex items-start gap-3">
                          {news.image && (
                            <img
                              src={news.image}
                              alt=""
                              className="w-16 h-16 object-cover rounded-lg flex-shrink-0"
                              onError={(e) => (e.currentTarget.style.display = "none")}
                            />
                          )}
                          <div className="flex-1 min-w-0">
                            <h4 className="font-medium text-sm text-white group-hover:text-white transition-colors line-clamp-2">
                              {news.headline}
                            </h4>
                            <p className="text-xs text-zinc-500 mt-1 line-clamp-2">{news.summary}</p>
                            <div className="flex items-center gap-2 mt-2 text-xs text-zinc-600">
                              <span className="bg-zinc-700/50 px-2 py-0.5 rounded">{news.related}</span>
                              <span>{news.source}</span>
                              <span>•</span>
                              <span>{new Date(news.datetime).toLocaleDateString("es-ES", { month: "short", day: "numeric" })}</span>
                              <ExternalLink className="h-3 w-3 ml-auto opacity-0 group-hover:opacity-100 transition-opacity" />
                            </div>
                          </div>
                        </div>
                      </a>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="market" className="space-y-4">
            <div>
              <h2 className="text-xl font-bold text-white">Mercado</h2>
              <p className="text-sm text-zinc-600">Precios en tiempo real</p>
            </div>
            {marketLoading ? (
              <div className="text-center py-12 text-zinc-500">
                <RefreshCw className="h-6 w-6 mx-auto mb-3 animate-spin text-zinc-400" />
                <p>Cargando datos del mercado...</p>
              </div>
            ) : (
              <div className="grid gap-6 md:grid-cols-2">
                <Card className="bg-gradient-to-br from-zinc-950 to-zinc-900 border-zinc-800/30 shadow-xl shadow-black/20">
                  <CardHeader>
                    <CardTitle className="text-sm flex items-center gap-2 text-zinc-300">
                      <BarChart3 className="h-4 w-4 text-zinc-400" /> Acciones Populares
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-1">
                    {market?.stocks.map((stock) => (
                      <Link
                        key={stock.symbol}
                        href={`/portfolio/${stock.symbol}`}
                        className="flex items-center justify-between py-3 border-b border-zinc-800/30 last:border-0 hover:bg-zinc-800/30 rounded-lg px-3 -mx-3 transition-all"
                        data-testid={`link-market-${stock.symbol}`}
                      >
                        <div className="flex items-center gap-3">
                          <div className="h-8 w-8 rounded-lg bg-zinc-900/10 border border-white/10 flex items-center justify-center">
                            <BarChart3 className="h-4 w-4 text-zinc-400" />
                          </div>
                          <div>
                            <div className="font-bold text-white">{stock.symbol}</div>
                            <div className="text-xs text-zinc-600">{stock.name}</div>
                          </div>
                        </div>
                        <div className="text-right">
                          <div className="font-bold text-white">{formatCurrency(stock.price)}</div>
                          <div className={`text-xs flex items-center justify-end gap-1 ${stock.change >= 0 ? "text-zinc-400" : "text-zinc-400"}`}>
                            {stock.change >= 0 ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
                            {formatPercent(stock.change)}
                          </div>
                        </div>
                      </Link>
                    ))}
                  </CardContent>
                </Card>

                <Card className="bg-gradient-to-br from-zinc-950 to-zinc-900 border-zinc-800/30 shadow-xl shadow-black/20">
                  <CardHeader>
                    <CardTitle className="text-sm flex items-center gap-2 text-zinc-300">
                      <Bitcoin className="h-4 w-4 text-zinc-400" /> Criptomonedas
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-1">
                    {market?.crypto.map((coin) => (
                      <Link
                        key={coin.symbol}
                        href={`/portfolio/${coin.symbol}`}
                        className="flex items-center justify-between py-3 border-b border-zinc-800/30 last:border-0 hover:bg-zinc-800/30 rounded-lg px-3 -mx-3 transition-all"
                        data-testid={`link-market-${coin.symbol}`}
                      >
                        <div className="flex items-center gap-3">
                          <div className="h-8 w-8 rounded-lg bg-zinc-900/10 border border-white/10 flex items-center justify-center">
                            <Bitcoin className="h-4 w-4 text-zinc-400" />
                          </div>
                          <div>
                            <div className="font-bold text-white">{coin.symbol}</div>
                            <div className="text-xs text-zinc-600">{coin.name}</div>
                          </div>
                        </div>
                        <div className="text-right">
                          <div className="font-bold text-white">{formatCurrency(coin.price)}</div>
                          <div className={`text-xs flex items-center justify-end gap-1 ${coin.change >= 0 ? "text-zinc-400" : "text-zinc-400"}`}>
                            {coin.change >= 0 ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
                            {formatPercent(coin.change)}
                          </div>
                        </div>
                      </Link>
                    ))}
                  </CardContent>
                </Card>
              </div>
            )}
          </TabsContent>

          <TabsContent value="watchlist" className="space-y-6">
            <div>
              <h2 className="text-xl font-bold text-white">Watchlist</h2>
              <p className="text-sm text-zinc-600">Símbolos que estás siguiendo</p>
            </div>
            {watchlist.length === 0 ? (
              <Card className="bg-gradient-to-br from-zinc-950 to-zinc-900 border-zinc-800/30 shadow-xl shadow-black/20">
                <CardContent className="py-12 text-center">
                  <div className="h-16 w-16 rounded-2xl bg-zinc-800/50 flex items-center justify-center mx-auto mb-4">
                    <Eye className="h-8 w-8 text-zinc-600" />
                  </div>
                  <p className="text-zinc-400 font-medium">Tu watchlist está vacía</p>
                  <p className="text-sm text-zinc-600 mt-1">Busca símbolos y agrégalos para seguirlos</p>
                </CardContent>
              </Card>
            ) : (
              <div className="space-y-3">
                {watchlist.map((item) => (
                  <Card key={item.id} className="bg-gradient-to-r from-zinc-950 to-zinc-900 border-zinc-800/30 hover:border-zinc-700/50 transition-all duration-300 cursor-pointer group shadow-lg shadow-black/30">
                    <CardContent className="p-5">
                      <div className="flex items-center justify-between">
                        <Link href={`/portfolio/${item.symbol}`} className="flex items-center gap-4 flex-1" data-testid={`link-watchlist-${item.symbol}`}>
                          <div className={`h-12 w-12 rounded-xl flex items-center justify-center transition-transform group-hover:scale-105 ${
                            item.type === "crypto"
                              ? "bg-gradient-to-br from-zinc-950/20 to-zinc-900/10 border border-white/10"
                              : "bg-gradient-to-br from-zinc-950/20 to-zinc-900/10 border border-white/10"
                          }`}>
                            {item.type === "crypto" ? (
                              <Bitcoin className="h-6 w-6 text-zinc-400" />
                            ) : (
                              <BarChart3 className="h-6 w-6 text-zinc-400" />
                            )}
                          </div>
                          <div>
                            <div className="font-bold text-white text-lg">{item.symbol}</div>
                            <div className="text-sm text-zinc-500">{item.name}</div>
                          </div>
                        </Link>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="text-zinc-600 hover:text-white hover:bg-zinc-800/10 opacity-0 group-hover:opacity-100 transition-opacity"
                          onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            removeFromWatchlist.mutate(item.id);
                          }}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </TabsContent>
        </Tabs>
      </main>
    </div>
  );
}
