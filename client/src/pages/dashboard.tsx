import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { AnimatePresence } from "framer-motion";
import {
  Bot,
  Building2,
  Calendar as CalendarIcon,
  LayoutGrid,
  Radio,
  Wrench,
} from "lucide-react";
import { Link } from "wouter";
import { ScheduleView } from "@/components/schedule-view";
import { MonthView } from "@/components/month-view";
import { TaskEditDialog } from "@/components/task-edit-dialog";
import { TaskDetailDialog } from "@/components/task-detail-dialog";
import { DeleteConfirmDialog } from "@/components/delete-confirm-dialog";
import { WeeklyReflectionForm } from "@/components/weekly-reflection-form";
import { WeeklyReflectionHistory } from "@/components/weekly-reflection-history";
import { MonthlyGoalsPanel } from "@/components/monthly-goals-panel";
import { YearlyGoalsPanel } from "@/components/yearly-goals-panel";
import { WeeklyTasksPanel } from "@/components/weekly-tasks-panel";
import { DashboardAssistantChat } from "@/components/dashboard-assistant-chat";
import { MonthlySpendPanel } from "@/components/monthly-spend-panel";
import { PendingActionsPanel } from "@/components/pending-actions-panel";
import { Toaster } from "@/components/ui/toaster";
import { useToast } from "@/hooks/use-toast";
import { format, startOfWeek, startOfDay, isBefore } from "date-fns";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { getTasks, updateTask, deleteTask, deleteTasksByTitle, syncCalendar } from "@/lib/api";
import { queryClient } from "@/lib/queryClient";
import { Task, InsertTask, WeeklySummary } from "@shared/schema";

export default function Dashboard() {
  const [view, setView] = useState<"week" | "month" | "reflections">("week");
  const [editingTask, setEditingTask] = useState<Task | null>(null);
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [taskToDelete, setTaskToDelete] = useState<Task | null>(null);
  const [detailDialogOpen, setDetailDialogOpen] = useState(false);
  const [selectedTask, setSelectedTask] = useState<Task | null>(null);
  const [reflectionFormOpen, setReflectionFormOpen] = useState(false);
  const [editingSummary, setEditingSummary] = useState<WeeklySummary | null>(null);
  const [reflectionWeekStart, setReflectionWeekStart] = useState<Date>(startOfWeek(new Date(), { weekStartsOn: 1 }));
  const { toast } = useToast();

  // Fetch tasks
  const { data: tasksResponse, isLoading } = useQuery({
    queryKey: ["tasks"],
    queryFn: getTasks,
  });
  const tasks = Array.isArray(tasksResponse) ? tasksResponse : [];

  // Auto-reschedule overdue tasks - they chase you until completed!
  useEffect(() => {
    if (tasks && tasks.length > 0) {
      const today = startOfDay(new Date());
      
      // Find overdue NON-recurring tasks (not completed, date before today, type is 'task')
      // Recurring/weekly tasks are NOT auto-rescheduled — they stay on their original date
      const overdueTasks = tasks.filter(task => {
        const taskDate = startOfDay(new Date(task.date));
        return (
          !task.completed &&
          !task.isRecurring &&
          isBefore(taskDate, today) &&
          task.type === 'task'
        );
      });

      if (overdueTasks.length === 0) return;

      // Reschedule each overdue task to today, preserving original date for tracking
      const promises = overdueTasks.map(task => {
        const originalTime = new Date(task.date);
        const newDate = new Date();
        newDate.setHours(originalTime.getHours(), originalTime.getMinutes(), 0, 0);
        
        return updateTask(task.id, { 
          date: newDate, 
          // Keep the first originalDate (when it was originally scheduled)
          originalDate: task.originalDate || task.date
        });
      });

      Promise.all(promises)
        .then(() => {
          queryClient.invalidateQueries({ queryKey: ["tasks"] });
          toast({
            title: "Tareas pendientes",
            description: `${overdueTasks.length} tarea(s) te persiguen hasta que las completes.`,
          });
        })
        .catch(console.error);
    }
  }, [tasks]);

  // Auto-sync Google Calendar on first load
  useEffect(() => {
    const autoSync = async () => {
      try {
        const result = await syncCalendar();
        if (result.synced > 0) {
          queryClient.invalidateQueries({ queryKey: ["tasks"] });
          toast({ 
            title: "Calendario sincronizado", 
            description: `Se importaron ${result.synced} eventos de Google Calendar.` 
          });
        }
      } catch (error) {
        // Silently ignore if calendar is not connected
        console.log("Calendar sync skipped:", error);
      }
    };
    autoSync();
  }, []);

  // Update mutation with optimistic updates
  const updateMutation = useMutation({
    mutationFn: ({ id, updates }: { id: string; updates: Partial<InsertTask> }) =>
      updateTask(id, updates),
    onMutate: async ({ id, updates }) => {
      await queryClient.cancelQueries({ queryKey: ["tasks"] });
      const previousTasks = queryClient.getQueryData<Task[]>(["tasks"]);
      
      queryClient.setQueryData<Task[]>(["tasks"], (old) => {
        if (!old) return old;
        return old.map((task) =>
          task.id === id ? { ...task, ...updates } : task
        );
      });
      
      return { previousTasks };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["tasks"] });
      toast({ title: "Tarea actualizada", description: "Los cambios se guardaron." });
    },
    onError: (err, variables, context) => {
      if (context?.previousTasks) {
        queryClient.setQueryData(["tasks"], context.previousTasks);
      }
      toast({ title: "Error", description: "No se pudo actualizar. Intenta de nuevo.", variant: "destructive" });
    },
  });

  // Delete mutation
  const deleteMutation = useMutation({
    mutationFn: deleteTask,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["tasks"] });
      toast({ title: "Tarea eliminada", description: "Se removió del calendario." });
    },
    onError: () => {
      toast({ title: "Error", description: "No se pudo eliminar.", variant: "destructive" });
    },
  });

  const handleToggleTask = (id: string) => {
    const task = tasks.find(t => t.id === id);
    if (task) {
      updateMutation.mutate({
        id,
        updates: { completed: !task.completed },
      });
    }
  };

  const handleViewTask = (task: any) => {
    setSelectedTask(task);
    setDetailDialogOpen(true);
  };

  const handleEditTask = (task: any) => {
    setEditingTask(task);
    setEditDialogOpen(true);
  };

  const handleSaveTask = (updatedTask: any) => {
    updateMutation.mutate({
      id: updatedTask.id,
      updates: {
        title: updatedTask.title,
        date: updatedTask.date,
        priority: updatedTask.priority,
        isRecurring: updatedTask.isRecurring ?? false,
      },
    });
    setEditDialogOpen(false);
  };

  const handleDeleteTask = (id: string) => {
    const task = tasks.find(t => t.id === id);
    if (!task) return;
    
    // Check if there are other tasks with the same title (recurring events)
    const sameTitle = tasks.filter(t => t.title === task.title);
    
    if (sameTitle.length > 1) {
      // Show confirmation dialog
      setTaskToDelete(task);
      setDeleteDialogOpen(true);
    } else {
      // Just delete the single task
      deleteMutation.mutate(id);
    }
  };

  const handleMoveTask = (taskId: string, newDate: Date) => {
    updateMutation.mutate({
      id: taskId,
      updates: { date: newDate },
    });
  };

  const handleDeleteOne = () => {
    if (taskToDelete) {
      deleteMutation.mutate(taskToDelete.id);
      setDeleteDialogOpen(false);
      setTaskToDelete(null);
    }
  };

  const handleDeleteAll = async () => {
    if (taskToDelete) {
      try {
        const result = await deleteTasksByTitle(taskToDelete.title);
        queryClient.invalidateQueries({ queryKey: ["tasks"] });
        toast({ 
          title: "Eventos eliminados", 
          description: `Se eliminaron ${result.deleted} eventos.` 
        });
      } catch (error) {
        toast({ 
          title: "Error", 
          description: "No se pudieron eliminar los eventos.", 
          variant: "destructive" 
        });
      }
      setDeleteDialogOpen(false);
      setTaskToDelete(null);
    }
  };

  const todayTasks = tasks.filter(t => 
    new Date(t.date).toDateString() === new Date().toDateString()
  );
  
  const progress = todayTasks.length > 0
    ? Math.round((todayTasks.filter(t => t.completed).length / todayTasks.length) * 100)
    : 0;

  const incompleteToday = todayTasks.filter(t => !t.completed).length;

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-zinc-400">Cargando tareas...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background text-foreground">
      <main className="min-h-screen overflow-y-auto px-4 pb-36 pt-5 md:px-8 md:pb-40 md:pt-8">
        <header className="mb-8 border-b border-white/10 pb-6">
          <div className="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
            <div className="max-w-2xl">
              <div className="mb-3 inline-flex items-center gap-2 rounded-full bg-zinc-950 px-3 py-1 text-xs font-medium text-zinc-300">
                <Bot className="h-3.5 w-3.5" />
                Chat listo para agendar
              </div>
              <h1 className="text-3xl font-semibold tracking-tight text-white md:text-4xl">
                Buenos dias, Robert.
              </h1>
              <p className="mt-3 text-sm text-zinc-400">
                {format(new Date(), "EEEE, MMMM do, yyyy")} · {todayTasks.length} tareas hoy · {incompleteToday} pendientes
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-3 lg:justify-end">
              <div className="border-l border-white/10 pl-4">
                <div className="text-[11px] uppercase tracking-wide text-zinc-500">Progreso</div>
                <div className="text-2xl font-semibold text-white">{progress}%</div>
              </div>
              <div className="border-l border-white/10 pl-4">
                <div className="text-[11px] uppercase tracking-wide text-zinc-500">Hoy</div>
                <div className="text-2xl font-semibold text-white">{todayTasks.length}</div>
              </div>
              <Link href="/assistant">
                <Button className="h-11 rounded-full bg-zinc-100 px-5 text-zinc-950 hover:bg-white">
                  <Bot className="mr-2 h-4 w-4" />
                  Abrir asistente
                </Button>
              </Link>
              <Link href="/agents-office">
                <Button
                  variant="outline"
                  className="h-11 rounded-full border-white/10 px-5 text-zinc-200 hover:bg-zinc-900 hover:text-white"
                  data-testid="button-open-agents-office"
                >
                  <Building2 className="mr-2 h-4 w-4" />
                  Ver agentes
                </Button>
              </Link>
              <Button
                variant="outline"
                onClick={() => setView("month")}
                className="h-11 rounded-full border-white/10 px-5 text-zinc-200 hover:bg-zinc-900 hover:text-white"
                data-testid="button-open-month"
              >
                <CalendarIcon className="mr-2 h-4 w-4" />
                Ver mes
              </Button>
            </div>
          </div>
        </header>

        <div className="space-y-8">
          {/* View based on button selection */}
          {view === "week" ? (
              <div className="space-y-8">
                <MonthlySpendPanel />
                <DashboardAssistantChat />
                <PendingActionsPanel />

                {/* Weekly Schedule Overview */}
                <ScheduleView 
                  tasks={tasks} 
                  onToggleTask={handleToggleTask}
                  onEditTask={handleEditTask}
                  onDeleteTask={handleDeleteTask}
                  onViewTask={handleViewTask}
                  onMoveTask={handleMoveTask}
                />

                {/* Bottom: Panels Grid */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                  {/* Esta Semana */}
                  <div>
                    <WeeklyTasksPanel />
                  </div>

                  {/* Metas Mensuales */}
                  <div>
                    <MonthlyGoalsPanel />
                  </div>

                  {/* Metas 2026 */}
                  <div>
                    <YearlyGoalsPanel year="2026" />
                  </div>
                </div>
              </div>
          ) : view === "month" ? (
            <MonthView 
              tasks={tasks} 
              onTaskClick={handleToggleTask}
              onEditTask={handleEditTask}
              onDeleteTask={handleDeleteTask}
              onViewTask={handleViewTask}
            />
          ) : (
            <WeeklyReflectionHistory
              onSelectWeek={(summary) => {
                setEditingSummary(summary);
                setReflectionWeekStart(new Date(summary.weekStart));
                setReflectionFormOpen(true);
              }}
              onNewReflection={() => {
                setEditingSummary(null);
                setReflectionWeekStart(startOfWeek(new Date(), { weekStartsOn: 1 }));
                setReflectionFormOpen(true);
              }}
            />
          )}
        </div>
      </main>

      <nav className="fixed inset-x-0 bottom-0 z-40 border-t border-white/10 bg-black/85 px-3 py-3 shadow-2xl shadow-black backdrop-blur">
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-2">
          <div className="mr-1 hidden shrink-0 items-center gap-2 rounded-full bg-zinc-950 px-3 py-2 text-zinc-100 sm:flex">
            <Bot className="h-4 w-4" />
            <span className="text-sm font-medium">Robert</span>
          </div>

          <Button
            variant="ghost"
            onClick={() => setView("week")}
            className={cn(
              "h-12 shrink-0 flex-col gap-1 rounded-full px-4 text-xs text-zinc-400 hover:bg-zinc-900 hover:text-white",
              view === "week" && "bg-white/10 text-white"
            )}
          >
            <LayoutGrid className="h-4 w-4" />
            Inicio
          </Button>
          <Link href="/assistant" className="shrink-0">
            <Button className="h-12 rounded-full bg-zinc-100 px-4 text-zinc-950 hover:bg-white">
              <Bot className="mr-2 h-4 w-4" />
              Chat
            </Button>
          </Link>
          <Link href="/radio" className="shrink-0">
            <Button variant="ghost" className="h-12 flex-col gap-1 rounded-full px-4 text-xs text-zinc-400 hover:bg-zinc-900 hover:text-white" data-testid="button-radio">
              <Radio className="h-4 w-4" />
              Radio
            </Button>
          </Link>
          <Link href="/tools" className="shrink-0">
            <Button variant="ghost" className="h-12 flex-col gap-1 rounded-full px-4 text-xs text-zinc-400 hover:bg-zinc-900 hover:text-white" data-testid="button-tools">
              <Wrench className="h-4 w-4" />
              Herramientas
            </Button>
          </Link>
        </div>
      </nav>

      {/* Edit Dialog */}
      <TaskEditDialog
        task={editingTask}
        open={editDialogOpen}
        onOpenChange={setEditDialogOpen}
        onSave={handleSaveTask}
      />

      <TaskDetailDialog
        task={selectedTask}
        open={detailDialogOpen}
        onOpenChange={setDetailDialogOpen}
        onEdit={handleEditTask}
        onDelete={(id) => {
          const task = tasks.find(t => t.id === id);
          if (task) {
            setTaskToDelete(task);
            setDeleteDialogOpen(true);
          }
        }}
        onToggle={handleToggleTask}
      />

      {/* Delete Confirmation Dialog */}
      <DeleteConfirmDialog
        open={deleteDialogOpen}
        onClose={() => {
          setDeleteDialogOpen(false);
          setTaskToDelete(null);
        }}
        onDeleteOne={handleDeleteOne}
        onDeleteAll={handleDeleteAll}
        taskTitle={taskToDelete?.title || ""}
        seriesCount={taskToDelete ? tasks.filter(t => t.title === taskToDelete.title).length : 0}
      />

      {/* Weekly Reflection Form Modal */}
      <AnimatePresence>
        {reflectionFormOpen && (
          <WeeklyReflectionForm
            weekStart={reflectionWeekStart}
            existingSummary={editingSummary || undefined}
            onClose={() => {
              setReflectionFormOpen(false);
              setEditingSummary(null);
            }}
            onSaved={() => {
              toast({ 
                title: "Reflexión guardada", 
                description: "Tu resumen semanal se guardó correctamente." 
              });
            }}
          />
        )}
      </AnimatePresence>

      <Toaster />
    </div>
  );
}
