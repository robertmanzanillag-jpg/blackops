import { useState, useEffect } from "react";
import { format } from "date-fns";
import { es } from "date-fns/locale";
import { Calendar, Clock, Repeat } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Calendar as CalendarComponent } from "@/components/ui/calendar";
import { cn } from "@/lib/utils";

interface Task {
  id: string;
  title: string;
  date: Date;
  priority: string;
  completed: boolean;
  type: string;
  isRecurring?: boolean;
}

interface TaskEditDialogProps {
  task: Task | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (task: Task) => void;
}

export function TaskEditDialog({
  task,
  open,
  onOpenChange,
  onSave,
}: TaskEditDialogProps) {
  const [title, setTitle] = useState(task?.title || "");
  const [date, setDate] = useState<Date>(task?.date ? new Date(task.date) : new Date());
  const [priority, setPriority] = useState(task?.priority || "normal");
  const [isRecurring, setIsRecurring] = useState(task?.isRecurring ?? false);

  // Sync state when a different task is opened in the dialog
  useEffect(() => {
    if (task) {
      setTitle(task.title || "");
      setDate(task.date ? new Date(task.date) : new Date());
      setPriority(task.priority || "normal");
      setIsRecurring(task.isRecurring ?? false);
    }
  }, [task?.id, open]);

  const handleSave = () => {
    if (title.trim() && task) {
      onSave({
        ...task,
        title: title.trim(),
        date: new Date(date),
        priority,
        isRecurring,
      } as any);
      onOpenChange(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-zinc-950 border-zinc-800 text-zinc-100">
        <DialogHeader>
          <DialogTitle>Editar Tarea</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <Label htmlFor="title" className="text-zinc-400">
              Título
            </Label>
            <Input
              id="title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="bg-zinc-900 border-zinc-800 text-zinc-100 focus:ring-zinc-700"
              placeholder="Nombre de la tarea"
            />
          </div>

          <div className="space-y-2">
            <Label className="text-zinc-400">Fecha</Label>
            <Popover>
              <PopoverTrigger asChild>
                <Button
                  variant="outline"
                  className={cn(
                    "w-full justify-start text-left font-normal bg-zinc-900 border-zinc-800 text-zinc-100 hover:bg-zinc-800",
                    !date && "text-muted-foreground"
                  )}
                >
                  <Calendar className="mr-2 h-4 w-4" />
                  {format(date, "PPP", { locale: es })}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0 bg-zinc-950 border-zinc-800">
                <CalendarComponent
                  mode="single"
                  selected={date}
                  onSelect={(d) => d && setDate(d)}
                  className="text-zinc-100"
                />
              </PopoverContent>
            </Popover>
          </div>

          <div className="space-y-2">
            <Label htmlFor="priority" className="text-zinc-400">
              Prioridad
            </Label>
            <Select value={priority} onValueChange={setPriority}>
              <SelectTrigger className="bg-zinc-900 border-zinc-800 text-zinc-100">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="bg-zinc-950 border-zinc-800 text-zinc-100">
                <SelectItem value="high">Alta - Urgente</SelectItem>
                <SelectItem value="normal">Normal</SelectItem>
                <SelectItem value="low">Baja - Puede esperar</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="flex items-center gap-2 pt-1">
            <Checkbox
              id="isRecurring"
              checked={isRecurring}
              onCheckedChange={(v) => setIsRecurring(v === true)}
              className="border-zinc-600 data-[state=checked]:bg-zinc-800"
              data-testid="checkbox-task-recurring"
            />
            <label htmlFor="isRecurring" className="text-sm text-zinc-400 cursor-pointer flex items-center gap-1">
              <Repeat className="w-3 h-3" />
              Tarea semanal (no se reagenda automáticamente)
            </label>
          </div>
        </div>

        <DialogFooter className="gap-2">
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            className="bg-zinc-900 border-zinc-800 text-zinc-300 hover:bg-zinc-800"
          >
            Cancelar
          </Button>
          <Button
            onClick={handleSave}
            className="bg-zinc-100 text-zinc-950 hover:bg-zinc-300"
          >
            Guardar Cambios
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
