import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { motion, AnimatePresence } from "framer-motion";
import { Rocket, Plus, Trash2, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import type { YearlyGoal } from "@shared/schema";

interface YearlyGoalsPanelProps {
  year?: string;
}

export function YearlyGoalsPanel({ year = "2026" }: YearlyGoalsPanelProps) {
  const queryClient = useQueryClient();
  const [newGoal, setNewGoal] = useState("");

  const { data: goals = [], isLoading } = useQuery<YearlyGoal[]>({
    queryKey: ["/api/yearly-goals", year],
    queryFn: async () => {
      const res = await fetch(`/api/yearly-goals?year=${year}`);
      if (!res.ok) throw new Error("Failed to fetch");
      return res.json();
    },
  });

  const createMutation = useMutation({
    mutationFn: async (title: string) => {
      const res = await fetch("/api/yearly-goals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, year }),
      });
      if (!res.ok) throw new Error("Failed to create");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/yearly-goals"] });
      setNewGoal("");
    },
  });

  const toggleMutation = useMutation({
    mutationFn: async ({ id, completed }: { id: string; completed: boolean }) => {
      const res = await fetch(`/api/yearly-goals/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ completed }),
      });
      if (!res.ok) throw new Error("Failed to update");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/yearly-goals"] });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/yearly-goals/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Failed to delete");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/yearly-goals"] });
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (newGoal.trim()) {
      createMutation.mutate(newGoal.trim());
    }
  };

  const completedCount = goals.filter(g => g.completed).length;
  const progress = goals.length > 0 ? Math.round((completedCount / goals.length) * 100) : 0;

  return (
    <div className="bg-zinc-900/50 border border-zinc-800 rounded-xl p-4">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Rocket className="w-5 h-5 text-zinc-400" />
          <h3 className="text-lg font-medium text-white">
            Metas {year}
          </h3>
        </div>
        {goals.length > 0 && (
          <div className="text-sm text-zinc-400">
            {completedCount}/{goals.length} ({progress}%)
          </div>
        )}
      </div>

      <form onSubmit={handleSubmit} className="flex gap-2 mb-4">
        <Input
          value={newGoal}
          onChange={(e) => setNewGoal(e.target.value)}
          placeholder="Nueva meta anual..."
          className="bg-zinc-800 border-zinc-700 text-sm"
          data-testid="input-new-yearly-goal"
        />
        <Button
          type="submit"
          size="sm"
          disabled={!newGoal.trim() || createMutation.isPending}
          className="bg-zinc-800 hover:bg-zinc-800"
          data-testid="button-add-yearly-goal"
        >
          <Plus className="w-4 h-4" />
        </Button>
      </form>

      {isLoading ? (
        <div className="text-zinc-500 text-sm">Cargando...</div>
      ) : goals.length === 0 ? (
        <div className="text-zinc-500 text-sm text-center py-4">
          No hay metas para {year}. Agrega una arriba.
        </div>
      ) : (
        <div className="space-y-2">
          <AnimatePresence>
            {goals.map((goal) => (
              <motion.div
                key={goal.id}
                initial={{ opacity: 0, x: -10 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 10 }}
                className={cn(
                  "group flex items-center gap-3 p-3 rounded-lg border transition-all",
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
                  data-testid={`button-toggle-yearly-goal-${goal.id}`}
                >
                  {goal.completed && <Check className="w-3 h-3" />}
                </button>
                
                <span
                  className={cn(
                    "flex-1 text-sm transition-all",
                    goal.completed
                      ? "text-zinc-500 line-through"
                      : "text-zinc-200"
                  )}
                >
                  {goal.title}
                </span>

                <button
                  onClick={() => deleteMutation.mutate(goal.id)}
                  className="opacity-0 group-hover:opacity-100 p-1 text-zinc-400 hover:text-white hover:bg-zinc-800/10 rounded transition-all"
                  data-testid={`button-delete-yearly-goal-${goal.id}`}
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
      )}

      {goals.length > 0 && (
        <div className="mt-4 h-2 bg-zinc-800 rounded-full overflow-hidden">
          <motion.div
            initial={{ width: 0 }}
            animate={{ width: `${progress}%` }}
            className="h-full bg-gradient-to-r from-zinc-950 to-zinc-900"
          />
        </div>
      )}
    </div>
  );
}
