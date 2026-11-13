import { useState } from "react";
import { format, getDaysInMonth, startOfMonth, addMonths, isSameDay } from "date-fns";
import { es } from "date-fns/locale";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { motion } from "framer-motion";

interface Task {
  id: string;
  title: string;
  description?: string | null;
  date: Date;
  endDate?: Date | null;
  priority: string;
  completed: boolean;
  type: string;
  externalSource?: string | null;
}

interface MonthViewProps {
  tasks: Task[];
  onTaskClick: (taskId: string) => void;
  onEditTask: (task: any) => void;
  onDeleteTask: (id: string) => void;
  onViewTask?: (task: any) => void;
}

export function MonthView({ tasks, onTaskClick, onEditTask, onDeleteTask, onViewTask }: MonthViewProps) {
  const [currentMonth, setCurrentMonth] = useState(new Date());

  const monthStart = startOfMonth(currentMonth);
  const daysInMonth = getDaysInMonth(currentMonth);
  const startDate = new Date(monthStart);
  startDate.setDate(1);

  const monthDays = Array.from({ length: daysInMonth }, (_, i) => {
    const date = new Date(monthStart);
    date.setDate(i + 1);
    return date;
  });

  const prevMonth = () => setCurrentMonth(addMonths(currentMonth, -1));
  const nextMonth = () => setCurrentMonth(addMonths(currentMonth, 1));

  const getTasksForDay = (day: Date) => {
    return tasks.filter(task => {
      const taskDate = new Date(task.date);
      return isSameDay(taskDate, day);
    });
  };

  const weekDayNames = ["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"];

  return (
    <div className="bg-zinc-900/30 p-6 rounded-xl border border-zinc-800/50 space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-light tracking-tight text-white">
          {format(currentMonth, "MMMM yyyy", { locale: es })}
        </h2>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={prevMonth}
            className="bg-zinc-950/50 border-zinc-800 text-zinc-400 hover:text-white hover:bg-zinc-900"
          >
            <ChevronLeft className="w-4 h-4" />
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={nextMonth}
            className="bg-zinc-950/50 border-zinc-800 text-zinc-400 hover:text-white hover:bg-zinc-900"
          >
            <ChevronRight className="w-4 h-4" />
          </Button>
        </div>
      </div>

      {/* Weekday Headers */}
      <div className="grid grid-cols-7 gap-2 mb-2">
        {weekDayNames.map((day) => (
          <div
            key={day}
            className="text-center text-xs font-bold text-zinc-500 uppercase py-2"
          >
            {day}
          </div>
        ))}
      </div>

      {/* Calendar Grid */}
      <div className="grid grid-cols-7 gap-2 auto-rows-[100px]">
        {/* Empty cells for days before month starts */}
        {Array.from({
          length: new Date(monthStart).getDay() || 6,
        }).map((_, i) => (
          <div key={`empty-${i}`} className="bg-transparent" />
        ))}

        {/* Month Days */}
        {monthDays.map((day, index) => {
          const dayTasks = getTasksForDay(day);
          const isToday = isSameDay(day, new Date());

          return (
            <motion.div
              key={index}
              className={`p-2 rounded-lg border text-xs flex flex-col cursor-pointer transition-all overflow-hidden group ${
                isToday
                  ? "bg-zinc-900/80 border-zinc-700 ring-1 ring-zinc-700"
                  : "bg-zinc-950/30 border-zinc-900 hover:border-zinc-800"
              }`}
              whileHover={{ scale: 1.02 }}
            >
              <div className={`font-bold mb-1 ${isToday ? "text-white" : "text-zinc-400"}`}>
                {format(day, "d")}
              </div>

              <div className="space-y-1 overflow-y-auto flex-1">
                {dayTasks.slice(0, 2).map((task) => (
                  <motion.div
                    key={task.id}
                    className={`px-1 py-0.5 rounded text-[10px] truncate group/item relative ${
                      task.completed
                        ? "bg-zinc-900/50 text-zinc-600"
                        : task.externalSource === 'google'
                        ? "bg-zinc-900/20 text-zinc-400"
                        : task.priority === "high"
                        ? "bg-zinc-900/20 text-zinc-400 font-semibold"
                        : "bg-zinc-800/50 text-zinc-300"
                    }`}
                    whileHover={{ scale: 1.05 }}
                  >
                    <div 
                      onClick={() => onTaskClick(task.id)}
                      className="cursor-pointer flex items-center gap-0.5"
                    >
                      {task.externalSource === 'google' && <span className="text-zinc-400">📅</span>}
                      {task.title}
                    </div>
                    <div className="absolute right-0 top-0 opacity-0 group-hover/item:opacity-100 transition-opacity flex gap-0.5 -mr-1 -mt-1">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          onEditTask(task);
                        }}
                        className="p-0.5 bg-zinc-800 rounded text-[8px] text-zinc-400 hover:text-white"
                      >
                        ✎
                      </button>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          onDeleteTask(task.id);
                        }}
                        className="p-0.5 bg-zinc-900/20 rounded text-[8px] text-zinc-400"
                      >
                        ✕
                      </button>
                    </div>
                  </motion.div>
                ))}
                {dayTasks.length > 2 && (
                  <div className="text-[9px] text-zinc-600 px-1">
                    +{dayTasks.length - 2} más
                  </div>
                )}
              </div>
            </motion.div>
          );
        })}
      </div>
    </div>
  );
}
