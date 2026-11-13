import { useState } from "react";
import { format, addDays, startOfWeek, isSameDay, subWeeks, addWeeks, isBefore, startOfDay } from "date-fns";
import { motion, AnimatePresence } from "framer-motion";
import { Check, Clock, AlertCircle, AlertTriangle, Edit2, Trash2, Calendar, ChevronLeft, ChevronRight, Repeat } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { SwipeableTaskCard } from "./swipeable-task-card";

interface Task {
  id: string;
  title: string;
  description?: string | null;
  date: Date;
  endDate?: Date | null;
  priority: string;
  completed: boolean;
  type: string;
  isRecurring?: boolean;
  externalSource?: string | null;
  originalDate?: Date | null;
}

interface ScheduleViewProps {
  tasks: Task[];
  onToggleTask: (id: string) => void;
  onEditTask: (task: any) => void;
  onDeleteTask: (id: string) => void;
  onViewTask?: (task: any) => void;
  onMoveTask?: (taskId: string, newDate: Date) => void;
}

export function ScheduleView({ tasks, onToggleTask, onEditTask, onDeleteTask, onViewTask, onMoveTask }: ScheduleViewProps) {
  const [currentWeekStart, setCurrentWeekStart] = useState(() => startOfWeek(new Date(), { weekStartsOn: 1 }));
  const [dragOverDay, setDragOverDay] = useState<number | null>(null);
  const weekDays = Array.from({ length: 7 }, (_, i) => addDays(currentWeekStart, i));

  const goToPreviousWeek = () => setCurrentWeekStart(prev => subWeeks(prev, 1));
  const goToNextWeek = () => setCurrentWeekStart(prev => addWeeks(prev, 1));
  const goToToday = () => setCurrentWeekStart(startOfWeek(new Date(), { weekStartsOn: 1 }));

  const isCurrentWeek = isSameDay(currentWeekStart, startOfWeek(new Date(), { weekStartsOn: 1 }));

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-light tracking-tight text-white">Weekly Overview</h2>
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={goToPreviousWeek}
            className="text-zinc-400 hover:text-white hover:bg-zinc-800"
            data-testid="button-prev-week"
          >
            <ChevronLeft className="w-4 h-4" />
          </Button>
          <button
            onClick={goToToday}
            className={cn(
              "text-xs font-mono px-3 py-1 rounded transition-colors",
              isCurrentWeek 
                ? "text-zinc-600 cursor-default" 
                : "text-zinc-400 hover:text-white hover:bg-zinc-800"
            )}
            disabled={isCurrentWeek}
            data-testid="button-today"
          >
            {format(currentWeekStart, "MMM d")} - {format(addDays(currentWeekStart, 6), "MMM d")}
          </button>
          <Button
            variant="ghost"
            size="sm"
            onClick={goToNextWeek}
            className="text-zinc-400 hover:text-white hover:bg-zinc-800"
            data-testid="button-next-week"
          >
            <ChevronRight className="w-4 h-4" />
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-7 md:gap-0 md:border-y md:border-white/10 min-h-[400px]">
        {weekDays.map((day, i) => {
          const isToday = isSameDay(day, new Date());
          const todayStart = startOfDay(new Date());
          
          // Get regular tasks for this day
          const regularTasks = tasks.filter((task) => isSameDay(new Date(task.date), day));
          
          // Get the start of the current week (Monday)
          const currentWeekStartDay = startOfWeek(new Date(), { weekStartsOn: 1 });
          
          // Mark tasks as overdue/rescheduled if they have an originalDate that's before today
          // Distinguish between weekly rollover (from previous weeks) and daily overdue (from earlier this week)
          const dayTasks = regularTasks.map(task => {
            if (!task.originalDate || task.completed) {
              return { ...task, isOverdue: false, isWeeklyRollover: false };
            }
            
            const originalDateStart = startOfDay(new Date(task.originalDate));
            const isRescheduled = isBefore(originalDateStart, todayStart);
            
            // Check if the original date is from a previous week (before the current week started)
            const isFromPreviousWeek = isBefore(originalDateStart, currentWeekStartDay);
            
            return { 
              ...task, 
              isOverdue: isRescheduled && !isFromPreviousWeek,
              isWeeklyRollover: isFromPreviousWeek
            };
          });

          const handleDragOver = (e: React.DragEvent) => {
            e.preventDefault();
            setDragOverDay(i);
          };

          const handleDragLeave = () => {
            setDragOverDay(null);
          };

          const handleDrop = (e: React.DragEvent) => {
            e.preventDefault();
            setDragOverDay(null);
            const taskId = e.dataTransfer.getData("taskId");
            if (taskId && onMoveTask) {
              const originalTask = tasks.find(t => t.id === taskId);
              if (originalTask) {
                const originalTime = new Date(originalTask.date);
                const newDate = new Date(day);
                newDate.setHours(originalTime.getHours(), originalTime.getMinutes(), originalTime.getSeconds());
                onMoveTask(taskId, newDate);
              }
            }
          };

          return (
            <div
              key={i}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
              className={cn(
                "flex flex-col gap-3 p-3 min-h-[150px] md:min-h-[400px] transition-colors md:border-r md:border-white/10 last:border-r-0",
                isToday 
                  ? "bg-zinc-800/[0.04]"
                  : "bg-transparent hover:bg-white/[0.02]",
                dragOverDay === i && "bg-zinc-900/20"
              )}
              data-testid={`day-column-${i}`}
            >
              <div className="text-center pb-2 border-b border-white/5">
                <div className={cn("text-xs uppercase font-bold mb-1", isToday ? "text-white" : "text-zinc-500")}>
                  {format(day, "EEE")}
                </div>
                <div className={cn("text-lg font-mono", isToday ? "text-white" : "text-zinc-400")}>
                  {format(day, "d")}
                </div>
              </div>

              <div className="flex flex-col gap-2 mt-2 flex-1">
                <AnimatePresence>
                  {dayTasks.map((task) => (
                    <SwipeableTaskCard
                      key={task.id}
                      task={task as any}
                      onEdit={onEditTask}
                      onDelete={onDeleteTask}
                      onToggle={onToggleTask}
                    >
                      <div
                        draggable
                        onDragStart={(e) => {
                          e.dataTransfer.setData("taskId", task.id);
                          e.dataTransfer.effectAllowed = "move";
                        }}
                        className={cn(
                          "group relative p-2 rounded text-xs border transition-all hover:border-zinc-600 overflow-hidden cursor-grab active:cursor-grabbing",
                          task.completed
                            ? "bg-zinc-900/50 border-zinc-900 text-zinc-600"
                            : task.isWeeklyRollover
                              ? "bg-zinc-900/50 border-zinc-700 text-zinc-400"
                              : task.isOverdue
                                ? "bg-zinc-900/30 border-white/10 text-zinc-400"
                                : task.externalSource === 'google' 
                                  ? "bg-zinc-900/30 border-white/10 text-zinc-400"
                                  : "bg-zinc-900 border-zinc-800 text-zinc-300",
                          task.priority === 'high' && !task.completed && !task.isOverdue && !task.isWeeklyRollover && "border-l-2 border-l-zinc-500"
                        )}
                        data-testid={`task-card-${task.id}`}
                      >
                        <div className="flex items-start justify-between gap-1">
                          <div className="flex-1 min-w-0">
                            <div className="font-medium leading-tight flex items-start gap-1">
                              {task.isWeeklyRollover && (
                                <AlertTriangle className="w-3 h-3 text-zinc-400 flex-shrink-0 mt-0.5" />
                              )}
                              {task.isOverdue && !task.isWeeklyRollover && (
                                <AlertCircle className="w-3 h-3 text-zinc-400 flex-shrink-0 mt-0.5" />
                              )}
                              {task.externalSource === 'google' && !task.isOverdue && !task.isWeeklyRollover && (
                                <Calendar className="w-3 h-3 text-zinc-400 flex-shrink-0 mt-0.5" />
                              )}
                              {task.isRecurring && !task.isOverdue && !task.isWeeklyRollover && (
                                <span title="Tarea semanal">
                                  <Repeat className="w-3 h-3 text-zinc-400 flex-shrink-0 mt-0.5" />
                                </span>
                              )}
                              <span className="break-words hyphens-auto">{task.title}</span>
                            </div>
                            <div className="flex items-center gap-1 mt-1 text-[10px] opacity-60 font-mono">
                              <Clock className="w-3 h-3" />
                              {task.externalSource === 'google' 
                                ? (new Date(task.date).getHours() === 0 && new Date(task.date).getMinutes() === 0
                                  ? 'Todo el día'
                                  : format(new Date(task.date), 'HH:mm'))
                                : task.priority}
                            </div>
                            {task.description && (
                              <div className="text-[10px] text-zinc-300 mt-2 p-2 bg-zinc-800/70 rounded border-l-2 border-white/10 space-y-1 overflow-hidden max-w-full">
                                {task.description
                                  .replace(/<[^>]*>/g, '')
                                  .split('\n')
                                  .map(line => line.replace(/https?:\/\/[^\s]+/g, '').trim())
                                  .filter(line => line.length > 0)
                                  .map((line, idx) => (
                                    <div key={idx} className="break-all overflow-hidden text-ellipsis">
                                      {line}
                                    </div>
                                  ))}
                              </div>
                            )}
                          </div>
                          {task.completed && (
                            <div className="text-zinc-500 flex-shrink-0">
                              <Check className="w-3 h-3" />
                            </div>
                          )}
                        </div>

                        <div className="absolute top-1 right-1 opacity-0 group-hover:opacity-100 transition-opacity flex gap-1 md:flex hidden">
                          <button
                            onClick={(e) => { e.stopPropagation(); onEditTask(task); }}
                            className="p-1 bg-zinc-800 hover:bg-zinc-700 rounded text-zinc-400 hover:text-white"
                            title="Editar"
                          >
                            <Edit2 className="w-3 h-3" />
                          </button>
                          <button
                            onClick={(e) => { e.stopPropagation(); onDeleteTask(task.id); }}
                            className="p-1 bg-zinc-900/20 hover:bg-zinc-800/30 rounded text-zinc-400 hover:text-white"
                            title="Borrar"
                          >
                            <Trash2 className="w-3 h-3" />
                          </button>
                        </div>
                      </div>
                    </SwipeableTaskCard>
                  ))}
                  {dayTasks.length === 0 && (
                    <div className="text-[10px] text-zinc-700 text-center py-4">
                      No tasks
                    </div>
                  )}
                </AnimatePresence>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
