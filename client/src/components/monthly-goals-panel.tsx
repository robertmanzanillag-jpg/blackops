import { useState, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { motion, AnimatePresence } from "framer-motion";
import { format, startOfMonth, isSameMonth } from "date-fns";
import { es } from "date-fns/locale";
import { Target, Plus, Trash2, Check, Clock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import type { MonthlyGoal } from "@shared/schema";

function groupByMonth(goals: MonthlyGoal[]): { monthKey: string; monthDate: Date; goals: MonthlyGoal[] }[] {
  const map = new Map<string, { monthDate: Date; goals: MonthlyGoal[] }>();
  for (const goal of goals) {
    const d = new Date(goal.month);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    if (!map.has(key)) {
      map.set(key, { monthDate: startOfMonth(d), goals: [] });
    }
    map.get(key)!.goals.push(goal);
  }
  return Array.from(map.entries()).map(([monthKey, v]) => ({ monthKey, ...v }));
}

export function MonthlyGoalsPanel() {
  const queryClient = useQueryClient();
  const [newGoal, setNewGoal] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const currentMonth = startOfMonth(new Date());

  const { data: allGoals = [], isLoading } = useQuery<MonthlyGoal[]>({
    queryKey: ["/api/monthly-goals/all"],
    queryFn: async () => {
      const res = await fetch("/api/monthly-goals/all");
      if (!res.ok) throw new Error("Failed to fetch");
      return res.json();
    },
  });

  const createMutation = useMutation({
    mutationFn: async (title: string) => {
      const res = await fetch("/api/monthly-goals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, month: currentMonth.toISOString() }),
      });
      if (!res.ok) throw new Error("Failed to create");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/monthly-goals/all"] });
      setNewGoal("");
      setTimeout(() => inputRef.current?.focus(), 50);
    },
  });

  const toggleMutation = useMutation({
    mutationFn: async ({ id, completed }: { id: string; completed: boolean }) => {
      const res = await fetch(`/api/monthly-goals/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ completed }),
      });
      if (!res.ok) throw new Error("Failed to update");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/monthly-goals/all"] });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/monthly-goals/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Failed to delete");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/monthly-goals/all"] });
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (newGoal.trim()) {
      createMutation.mutate(newGoal.trim());
    }
  };

  const monthGroups = groupByMonth(allGoals);
  const hasCurrentMonth = monthGroups.some(g => isSameMonth(g.monthDate, currentMonth));

  // Past months only (excludes current month — we render current month separately below)
  const pastGroups = monthGroups.filter(g => !isSameMonth(g.monthDate, currentMonth));
  const currentGroup = monthGroups.find(g => isSameMonth(g.monthDate, currentMonth));
  const currentGoals = currentGroup?.goals ?? [];

  const currentCompleted = currentGoals.filter(g => g.completed).length;
  const currentProgress = currentGoals.length > 0 ? Math.round((currentCompleted / currentGoals.length) * 100) : 0;

  return (
    <div className="bg-zinc-900/50 border border-zinc-800 rounded-xl p-4">
      <div className="flex items-center gap-2 mb-4">
        <Target className="w-5 h-5 text-zinc-400" />
        <h3 className="text-lg font-medium text-white">Metas Mensuales</h3>
      </div>

      {isLoading ? (
        <div className="text-zinc-500 text-sm">Cargando...</div>
      ) : (
        <div className="space-y-6 max-h-96 overflow-y-auto pr-1">
          {/* Past months — read-only history */}
          <AnimatePresence initial={false}>
            {pastGroups.map(({ monthKey, monthDate, goals }) => {
              const completedCount = goals.filter(g => g.completed).length;
              const progress = goals.length > 0 ? Math.round((completedCount / goals.length) * 100) : 0;

              return (
                <motion.div
                  key={monthKey}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -8 }}
                >
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-1.5">
                      <Clock className="w-3 h-3 text-zinc-500" />
                      <span className="text-sm font-semibold capitalize text-zinc-500">
                        {format(monthDate, "MMMM yyyy", { locale: es })}
                        <span className="ml-1 text-xs font-normal">(historial)</span>
                      </span>
                    </div>
                    <span className="text-xs text-zinc-600">{completedCount}/{goals.length} ({progress}%)</span>
                  </div>

                  <div className="space-y-1.5 mb-2">
                    {goals.map((goal) => (
                      <div
                        key={goal.id}
                        className={cn(
                          "group flex items-center gap-3 p-2.5 rounded-lg border transition-all",
                          goal.completed
                            ? "bg-zinc-900/10 border-white/10"
                            : "bg-zinc-800/30 border-zinc-800"
                        )}
                      >
                        <button
                          onClick={() => toggleMutation.mutate({ id: goal.id, completed: !goal.completed })}
                          className={cn(
                            "w-5 h-5 rounded-full border-2 flex items-center justify-center transition-all flex-shrink-0",
                            goal.completed
                              ? "bg-zinc-900/60 border-white/10 text-white"
                              : "border-zinc-700 hover:border-zinc-700"
                          )}
                          data-testid={`button-toggle-goal-${goal.id}`}
                        >
                          {goal.completed && <Check className="w-3 h-3" />}
                        </button>

                        <span
                          className={cn(
                            "flex-1 text-sm",
                            goal.completed ? "text-zinc-600 line-through" : "text-zinc-500"
                          )}
                        >
                          {goal.title}
                        </span>

                        <button
                          onClick={() => deleteMutation.mutate(goal.id)}
                          className="opacity-0 group-hover:opacity-100 p-1 text-zinc-400/60 hover:text-white rounded transition-all"
                          data-testid={`button-delete-goal-${goal.id}`}
                        >
                          <Trash2 className="w-3 h-3" />
                        </button>
                      </div>
                    ))}
                  </div>

                  {goals.length > 0 && (
                    <div className="h-1 bg-zinc-800 rounded-full overflow-hidden">
                      <div className="h-full bg-zinc-600" style={{ width: `${progress}%` }} />
                    </div>
                  )}
                </motion.div>
              );
            })}
          </AnimatePresence>

          {/* Current month — always rendered, always interactive */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-semibold capitalize text-zinc-400">
                {format(currentMonth, "MMMM yyyy", { locale: es })}
              </span>
              {currentGoals.length > 0 && (
                <span className="text-xs text-zinc-400">{currentCompleted}/{currentGoals.length} ({currentProgress}%)</span>
              )}
            </div>

            {currentGoals.length === 0 ? (
              <div className="text-zinc-600 text-xs text-center py-3">
                No hay metas para este mes. Agrega una abajo.
              </div>
            ) : (
              <div className="space-y-1.5 mb-2">
                <AnimatePresence>
                  {currentGoals.map((goal) => (
                    <motion.div
                      key={goal.id}
                      initial={{ opacity: 0, x: -10 }}
                      animate={{ opacity: 1, x: 0 }}
                      exit={{ opacity: 0, x: 10 }}
                      className={cn(
                        "group flex items-center gap-3 p-2.5 rounded-lg border transition-all",
                        goal.completed
                          ? "bg-zinc-900/20 border-white/10"
                          : "bg-zinc-800/50 border-zinc-700 hover:border-zinc-600"
                      )}
                    >
                      <button
                        onClick={() => toggleMutation.mutate({ id: goal.id, completed: !goal.completed })}
                        className={cn(
                          "w-5 h-5 rounded-full border-2 flex items-center justify-center transition-all flex-shrink-0",
                          goal.completed
                            ? "bg-zinc-800 border-zinc-700 text-white"
                            : "border-zinc-600 hover:border-zinc-700"
                        )}
                        data-testid={`button-toggle-goal-${goal.id}`}
                      >
                        {goal.completed && <Check className="w-3 h-3" />}
                      </button>

                      <span
                        className={cn(
                          "flex-1 text-sm transition-all",
                          goal.completed ? "text-zinc-500 line-through" : "text-zinc-200"
                        )}
                      >
                        {goal.title}
                      </span>

                      <button
                        onClick={() => deleteMutation.mutate(goal.id)}
                        className="opacity-0 group-hover:opacity-100 p-1 text-zinc-400 hover:text-white hover:bg-zinc-800/10 rounded transition-all"
                        data-testid={`button-delete-goal-${goal.id}`}
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    </motion.div>
                  ))}
                </AnimatePresence>
              </div>
            )}

            {currentGoals.length > 0 && (
              <div className="h-1.5 bg-zinc-800 rounded-full overflow-hidden mb-3">
                <motion.div
                  initial={{ width: 0 }}
                  animate={{ width: `${currentProgress}%` }}
                  className="h-full bg-gradient-to-r from-zinc-950 to-zinc-900"
                />
              </div>
            )}

            {/* Add-goal input lives inside the current month section */}
            <form onSubmit={handleSubmit} className="flex gap-2 mt-2">
              <Input
                ref={inputRef}
                value={newGoal}
                onChange={(e) => setNewGoal(e.target.value)}
                placeholder="Nueva meta..."
                className="bg-zinc-800 border-zinc-700 text-sm"
                data-testid="input-new-goal"
              />
              <Button
                type="submit"
                size="sm"
                disabled={!newGoal.trim() || createMutation.isPending}
                className="bg-zinc-800 hover:bg-zinc-800"
                data-testid="button-add-goal"
              >
                <Plus className="w-4 h-4" />
              </Button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
