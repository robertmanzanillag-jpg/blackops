import { motion, AnimatePresence } from "framer-motion";
import { format } from "date-fns";
import { es } from "date-fns/locale";
import { CheckCircle2, Clock, Trash2, Edit2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { SwipeableTaskCard } from "./swipeable-task-card";

interface Task {
  id: string;
  title: string;
  date: Date;
  priority: string;
  completed: boolean;
  type: string;
}

interface HistoryPanelProps {
  tasks: Task[];
  onDeleteTask: (id: string) => void;
  onEditTask: (task: any) => void;
}

export function HistoryPanel({ tasks, onDeleteTask, onEditTask }: HistoryPanelProps) {
  const now = new Date();
  
  const completedTasks = tasks.filter(t => t.completed);
  const upcomingTasks = tasks.filter(t => !t.completed && new Date(t.date) > now);
  const pastIncompleteTasks = tasks.filter(t => !t.completed && new Date(t.date) <= now);

  const completedToday = completedTasks.filter(
    t => new Date(t.date).toDateString() === now.toDateString()
  );

  const thisWeekCompleted = completedTasks.filter(t => {
    const taskDate = new Date(t.date);
    const daysAgo = (now.getTime() - taskDate.getTime()) / (1000 * 60 * 60 * 24);
    return daysAgo >= 0 && daysAgo <= 7;
  });

  const renderTaskItem = (task: Task) => (
    <SwipeableTaskCard
      key={task.id}
      task={task as any}
      onEdit={onEditTask}
      onDelete={onDeleteTask}
    >
      <div
        className="flex items-start justify-between gap-3 p-3 bg-zinc-900/50 rounded-lg border border-zinc-800/50 hover:border-zinc-700/50 transition-colors group"
        data-testid={`history-task-${task.id}`}
      >
        <div className="flex-1 min-w-0">
          <div className={`font-medium text-sm ${task.completed ? "line-through text-zinc-600" : "text-zinc-200"}`}>
            {task.title}
          </div>
          <div className="flex gap-2 items-center mt-1">
            <span className="text-xs text-zinc-500">
              {format(new Date(task.date), "PPP", { locale: es })}
            </span>
            {task.priority === "high" && (
              <span className="text-xs px-1.5 py-0.5 bg-zinc-900/20 text-zinc-400 rounded">
                Urgente
              </span>
            )}
          </div>
        </div>

        <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity md:flex hidden">
          <Button
            variant="ghost"
            size="sm"
            onClick={(e) => { e.stopPropagation(); onEditTask(task); }}
            className="text-zinc-600 hover:text-white hover:bg-zinc-800"
          >
            <Edit2 className="w-4 h-4" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={(e) => { e.stopPropagation(); onDeleteTask(task.id); }}
            className="text-zinc-600 hover:text-white hover:bg-zinc-800/10"
          >
            <Trash2 className="w-4 h-4" />
          </Button>
        </div>
      </div>
    </SwipeableTaskCard>
  );

  return (
    <div className="bg-zinc-900/30 rounded-xl border border-zinc-800/50 overflow-hidden">
      <Tabs defaultValue="upcoming" className="w-full">
        <TabsList className="w-full justify-start bg-zinc-950/50 border-b border-zinc-800/50 px-0 rounded-none">
          <TabsTrigger
            value="upcoming"
            className="rounded-none border-b-2 border-transparent data-[state=active]:border-white data-[state=active]:bg-transparent"
          >
            <Clock className="w-4 h-4 mr-2" />
            A Futuro
          </TabsTrigger>
          <TabsTrigger
            value="completed"
            className="rounded-none border-b-2 border-transparent data-[state=active]:border-white data-[state=active]:bg-transparent"
          >
            <CheckCircle2 className="w-4 h-4 mr-2" />
            Completadas ({completedTasks.length})
          </TabsTrigger>
          <TabsTrigger
            value="overdue"
            className="rounded-none border-b-2 border-transparent data-[state=active]:border-white data-[state=active]:bg-transparent"
          >
            <span className="w-2 h-2 bg-zinc-800 rounded-full mr-2" />
            Pendientes
          </TabsTrigger>
        </TabsList>

        <div className="p-4 max-h-[400px] overflow-y-auto">
          {/* Upcoming Tab */}
          <TabsContent value="upcoming" className="space-y-3 mt-0">
            {upcomingTasks.length === 0 ? (
              <div className="text-center py-8 text-zinc-600">
                No hay tareas futuras
              </div>
            ) : (
              <AnimatePresence>
                {upcomingTasks
                  .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())
                  .map(renderTaskItem)}
              </AnimatePresence>
            )}
          </TabsContent>

          {/* Completed Tab */}
          <TabsContent value="completed" className="space-y-3 mt-0">
            {completedTasks.length === 0 ? (
              <div className="text-center py-8 text-zinc-600">
                No hay tareas completadas aún
              </div>
            ) : (
              <div className="space-y-4">
                <div>
                  <div className="text-xs font-bold text-zinc-500 uppercase mb-2">Hoy ({completedToday.length})</div>
                  <div className="space-y-2">
                    <AnimatePresence>
                      {completedToday.map(renderTaskItem)}
                    </AnimatePresence>
                  </div>
                </div>

                {thisWeekCompleted.length > completedToday.length && (
                  <div>
                    <div className="text-xs font-bold text-zinc-500 uppercase mb-2">
                      Esta Semana ({thisWeekCompleted.length})
                    </div>
                    <div className="space-y-2">
                      <AnimatePresence>
                        {thisWeekCompleted
                          .filter(t => !completedToday.includes(t))
                          .map(renderTaskItem)}
                      </AnimatePresence>
                    </div>
                  </div>
                )}

                {completedTasks.length > thisWeekCompleted.length && (
                  <div>
                    <div className="text-xs font-bold text-zinc-500 uppercase mb-2">
                      Anterior ({completedTasks.length - thisWeekCompleted.length})
                    </div>
                    <div className="space-y-2">
                      <AnimatePresence>
                        {completedTasks
                          .filter(t => !thisWeekCompleted.includes(t))
                          .slice(0, 5)
                          .map(renderTaskItem)}
                      </AnimatePresence>
                    </div>
                  </div>
                )}
              </div>
            )}
          </TabsContent>

          {/* Overdue Tab */}
          <TabsContent value="overdue" className="space-y-3 mt-0">
            {pastIncompleteTasks.length === 0 ? (
              <div className="text-center py-8 text-zinc-600">
                ¡Sin tareas pendientes! 🎉
              </div>
            ) : (
              <AnimatePresence>
                {pastIncompleteTasks
                  .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
                  .map(renderTaskItem)}
              </AnimatePresence>
            )}
          </TabsContent>
        </div>
      </Tabs>
    </div>
  );
}
