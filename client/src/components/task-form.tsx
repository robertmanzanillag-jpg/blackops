import { useState } from "react";
import { Zap, Send, Repeat } from "lucide-react";
import { format, addDays, startOfWeek } from "date-fns";
import { es } from "date-fns/locale";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "@/hooks/use-toast";
import { parseTaskInput } from "@/lib/parse-task";

interface TaskFormProps {
  onAddTask: (task: any) => void;
}

export function TaskForm({ onAddTask }: TaskFormProps) {
  const [input, setInput] = useState("");
  const [isProcessing, setIsProcessing] = useState(false);
  const [isRecurring, setIsRecurring] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!input.trim()) return;

    setIsProcessing(true);

    // Parse the natural language input
    const parsed = parseTaskInput(input);

    if (parsed) {
      if (parsed.isRecurring && parsed.recurrencePattern) {
        // Crear múltiples tareas
        const tasksToCreate: any[] = [];

        if (parsed.recurrencePattern === "weekly") {
          // Todos los jueves, viernes, etc. por 52 semanas (1 año)
          const today = new Date();
          for (let week = 0; week < (parsed.recurrenceWeeks || 4); week++) {
            for (const dayOfWeek of (parsed.recurringDays || [])) {
              const weekStart = startOfWeek(today, { weekStartsOn: 1 });
              const taskDate = addDays(weekStart, dayOfWeek + week * 7);
              taskDate.setHours(parsed.hour || 9, parsed.minute || 0, 0, 0);
              
              tasksToCreate.push({
                title: parsed.title,
                date: taskDate,
                priority: parsed.priority,
                completed: false,
                type: "task",
              });
            }
          }
        } else if (parsed.recurrencePattern === "daily") {
          // Todos los días por 52 semanas (1 año)
          const today = new Date();
          for (let i = 0; i < (parsed.recurrenceWeeks || 4) * 7; i++) {
            const taskDate = addDays(today, i);
            taskDate.setHours(parsed.hour || 9, parsed.minute || 0, 0, 0);
            tasksToCreate.push({
              title: parsed.title,
              date: taskDate,
              priority: parsed.priority,
              completed: false,
              type: "task",
            });
          }
        } else if (parsed.recurrencePattern === "weekly_except") {
          // Todos los días MENOS ciertos días
          const today = new Date();
          for (let i = 0; i < (parsed.recurrenceWeeks || 4) * 7; i++) {
            const taskDate = addDays(today, i);
            const dayOfWeek = taskDate.getDay();
            const adjustedDay = dayOfWeek === 0 ? 6 : dayOfWeek - 1; // Convertir a 0-6 (lun-dom)
            
            if (!(parsed.recurringDays || []).includes(adjustedDay)) {
              taskDate.setHours(parsed.hour || 9, parsed.minute || 0, 0, 0);
              tasksToCreate.push({
                title: parsed.title,
                date: taskDate,
                priority: parsed.priority,
                completed: false,
                type: "task",
              });
            }
          }
        }

        // Enviar todas las tareas en secuencia
        for (const task of tasksToCreate) {
          try {
            await new Promise(resolve => {
              onAddTask(task);
              // pequeña pausa para evitar race conditions
              setTimeout(resolve, 50);
            });
          } catch (e) {
            console.error("Error creating recurring task:", e);
          }
        }

        toast({
          title: "✓ Tareas recurrentes añadidas",
          description: `Se crearon ${tasksToCreate.length} tareas de "${parsed.title}"`,
        });
      } else {
        // Tarea única
        const newTask = {
          title: parsed.title,
          date: parsed.date,
          priority: parsed.priority,
          completed: false,
          type: "task",
          isRecurring,
        };

        onAddTask(newTask);

        // Format the date in Spanish for feedback
        const dayName = format(parsed.date, "EEEE", { locale: es });
        const timeStr = `${String(parsed.hour).padStart(2, "0")}:${String(parsed.minute).padStart(2, "0")}`;

        toast({
          title: "✓ Tarea añadida",
          description: `"${parsed.title}" - ${dayName.charAt(0).toUpperCase() + dayName.slice(1)} a las ${timeStr}`,
        });
      }

      setInput("");
      setIsRecurring(false);
    } else {
      toast({
        title: "Error",
        description: "No pude entender la tarea. Intenta: 'Reunión el jueves a las 5'",
        variant: "destructive",
      });
    }

    setIsProcessing(false);
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-3 bg-zinc-900/50 p-6 rounded-xl border border-zinc-800/50 backdrop-blur-sm">
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-sm font-semibold text-zinc-300 flex items-center gap-2">
          <Zap className="w-4 h-4 text-zinc-400" />
          Lenguaje Natural
        </h3>
        <span className="text-xs text-zinc-600">ej: "Reunión el jueves a las 5"</span>
      </div>

      <div className="flex gap-2">
        <Input
          placeholder="describe una tarea..."
          value={input}
          onChange={(e) => setInput(e.target.value)}
          className="bg-zinc-950/50 border-zinc-800 text-zinc-100 placeholder:text-zinc-600 focus:ring-zinc-700"
          disabled={isProcessing}
        />
        <Button
          type="submit"
          className="bg-zinc-100 text-zinc-950 hover:bg-zinc-200 transition-colors px-4"
          disabled={isProcessing || !input.trim()}
        >
          <Send className="w-4 h-4" />
        </Button>
      </div>

      <div className="flex items-center gap-2 pt-1">
        <Checkbox
          id="form-isRecurring"
          checked={isRecurring}
          onCheckedChange={(v) => setIsRecurring(v === true)}
          className="border-zinc-600 data-[state=checked]:bg-zinc-800"
          data-testid="checkbox-form-recurring"
        />
        <label htmlFor="form-isRecurring" className="text-xs text-zinc-500 cursor-pointer flex items-center gap-1">
          <Repeat className="w-3 h-3 text-zinc-400" />
          Tarea semanal (no se reagenda automáticamente)
        </label>
      </div>

      <div className="text-xs text-zinc-600 space-y-1 pt-2 border-t border-zinc-800/30">
        <div>Ejemplos:</div>
        <ul className="list-disc list-inside space-y-0.5">
          <li>"Proyecto urgente el viernes a las 3pm"</li>
          <li>"Gym session mañana" → dentro de 24 horas</li>
          <li>"Llamar doctor el lunes a las 9"</li>
        </ul>
      </div>
    </form>
  );
}
