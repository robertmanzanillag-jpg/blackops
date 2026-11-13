import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { motion, AnimatePresence } from "framer-motion";
import { startOfWeek, format } from "date-fns";
import { es } from "date-fns/locale";
import { CalendarDays, Plus, Trash2, Check, Repeat, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";
import type { WeeklyTask } from "@shared/schema";

export function WeeklyTasksPanel() {
  const queryClient = useQueryClient();
  const [newTask, setNewTask] = useState("");
  const [isRecurring, setIsRecurring] = useState(false);
  const currentWeekStart = startOfWeek(new Date(), { weekStartsOn: 1 });

  const { data: tasks = [], isLoading } = useQuery<WeeklyTask[]>({
    queryKey: ["/api/weekly-tasks", currentWeekStart.toISOString()],
    queryFn: async () => {
      const res = await fetch(`/api/weekly-tasks?weekStart=${currentWeekStart.toISOString()}`);
      if (!res.ok) throw new Error("Failed to fetch");
      return res.json();
    },
  });

  const createMutation = useMutation({
    mutationFn: async ({ title, isRecurring }: { title: string; isRecurring: boolean }) => {
      const res = await fetch("/api/weekly-tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ 
          title, 
          weekStart: currentWeekStart.toISOString(),
          isRecurring,
        }),
      });
      if (!res.ok) throw new Error("Failed to create");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/weekly-tasks"] });
      setNewTask("");
      setIsRecurring(false);
    },
  });

  const toggleMutation = useMutation({
    mutationFn: async ({ id, completed }: { id: string; completed: boolean }) => {
      const res = await fetch(`/api/weekly-tasks/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ completed }),
      });
      if (!res.ok) throw new Error("Failed to update");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/weekly-tasks"] });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/weekly-tasks/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Failed to delete");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/weekly-tasks"] });
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (newTask.trim()) {
      createMutation.mutate({ title: newTask.trim(), isRecurring });
    }
  };

  const completedCount = tasks.filter(t => t.completed).length;
  const progress = tasks.length > 0 ? Math.round((completedCount / tasks.length) * 100) : 0;

  return (
    <div className="bg-zinc-900/50 border border-zinc-800 rounded-xl p-4">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <CalendarDays className="w-5 h-5 text-zinc-400" />
          <h3 className="text-lg font-medium text-white">
            Esta Semana
          </h3>
        </div>
        {tasks.length > 0 && (
          <div className="text-sm text-zinc-400">
            {completedCount}/{tasks.length} ({progress}%)
          </div>
        )}
      </div>

      <div className="text-xs text-zinc-500 mb-3">
        {format(currentWeekStart, "d MMM", { locale: es })} - {format(new Date(currentWeekStart.getTime() + 6 * 24 * 60 * 60 * 1000), "d MMM", { locale: es })}
      </div>

      <form onSubmit={handleSubmit} className="space-y-2 mb-4">
        <div className="flex gap-2">
          <Input
            value={newTask}
            onChange={(e) => setNewTask(e.target.value)}
            placeholder="Nueva tarea..."
            className="bg-zinc-800 border-zinc-700 text-sm"
            data-testid="input-new-weekly-task"
          />
          <Button
            type="submit"
            size="sm"
            disabled={!newTask.trim() || createMutation.isPending}
            className="bg-zinc-800 hover:bg-zinc-800"
            data-testid="button-add-weekly-task"
          >
            <Plus className="w-4 h-4" />
          </Button>
        </div>
        <div className="flex items-center gap-2">
          <Checkbox
            id="recurring"
            checked={isRecurring}
            onCheckedChange={(checked) => setIsRecurring(checked === true)}
            className="border-zinc-600 data-[state=checked]:bg-zinc-800"
            data-testid="checkbox-recurring"
          />
          <label htmlFor="recurring" className="text-xs text-zinc-400 cursor-pointer flex items-center gap-1">
            <Repeat className="w-3 h-3" />
            Repetir cada semana
          </label>
        </div>
      </form>

      {isLoading ? (
        <div className="text-zinc-500 text-sm">Cargando...</div>
      ) : tasks.length === 0 ? (
        <div className="text-zinc-500 text-sm text-center py-4">
          No hay tareas esta semana. Agrega una arriba.
        </div>
      ) : (
        <div className="space-y-2 max-h-60 overflow-y-auto">
          <AnimatePresence>
            {tasks.map((task) => (
              <motion.div
                key={task.id}
                initial={{ opacity: 0, x: -10 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 10 }}
                className={cn(
                  "group flex items-center gap-3 p-3 rounded-lg border transition-all",
                  task.completed
                    ? "bg-zinc-900/20 border-white/10"
                    : "bg-zinc-800/50 border-zinc-700 hover:border-zinc-600"
                )}
              >
                <button
                  onClick={() => toggleMutation.mutate({ id: task.id, completed: !task.completed })}
                  className={cn(
                    "w-5 h-5 rounded-full border-2 flex items-center justify-center transition-all flex-shrink-0",
                    task.completed
                      ? "bg-zinc-800 border-zinc-700 text-white"
                      : "border-zinc-600 hover:border-zinc-700"
                  )}
                  data-testid={`button-toggle-weekly-task-${task.id}`}
                >
                  {task.completed && <Check className="w-3 h-3" />}
                </button>
                
                <span
                  className={cn(
                    "flex-1 text-sm transition-all flex items-center gap-2",
                    task.completed
                      ? "text-zinc-500 line-through"
                      : "text-zinc-200"
                  )}
                >
                  {task.title}
                  {task.isRecurring && (
                    <Repeat className="w-3 h-3 text-zinc-400" />
                  )}
                  {task.carriedOver && (
                    <span className="flex items-center gap-1 text-xs text-zinc-400">
                      <ArrowRight className="w-3 h-3" />
                    </span>
                  )}
                </span>

                <button
                  onClick={() => deleteMutation.mutate(task.id)}
                  className="opacity-0 group-hover:opacity-100 p-1 text-zinc-400 hover:text-white hover:bg-zinc-800/10 rounded transition-all"
                  data-testid={`button-delete-weekly-task-${task.id}`}
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
      )}

      {tasks.length > 0 && (
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
