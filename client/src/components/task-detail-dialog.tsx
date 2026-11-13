import { format } from "date-fns";
import { es } from "date-fns/locale";
import { Calendar, Clock, MapPin, Tag, ExternalLink, Edit, Trash2, CheckCircle } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

interface Task {
  id: string;
  title: string;
  description?: string | null;
  date: Date | string;
  endDate?: Date | string | null;
  priority: string;
  completed: boolean;
  type: string;
  externalId?: string | null;
  externalSource?: string | null;
}

interface TaskDetailDialogProps {
  task: Task | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onEdit: (task: Task) => void;
  onDelete: (id: string) => void;
  onToggle: (id: string) => void;
}

export function TaskDetailDialog({
  task,
  open,
  onOpenChange,
  onEdit,
  onDelete,
  onToggle,
}: TaskDetailDialogProps) {
  if (!task) return null;

  const taskDate = new Date(task.date);
  const isAllDay = taskDate.getHours() === 0 && taskDate.getMinutes() === 0;
  const hasEndDate = task.endDate && new Date(task.endDate).getTime() !== taskDate.getTime();
  
  const getSourceInfo = () => {
    if (task.externalSource === 'google') {
      return { name: 'Google Calendar', color: 'bg-zinc-900/20 text-zinc-400 border-white/10', icon: '📅' };
    }
    if (task.externalSource === 'zoho') {
      return { name: 'Zoho Calendar', color: 'bg-zinc-900/20 text-zinc-400 border-white/10', icon: '📆' };
    }
    return null;
  };

  const sourceInfo = getSourceInfo();

  const getPriorityInfo = () => {
    switch (task.priority) {
      case 'high':
        return { label: 'Alta', color: 'bg-zinc-900/20 text-zinc-400 border-white/10' };
      case 'medium':
        return { label: 'Media', color: 'bg-zinc-900/20 text-zinc-400 border-white/10' };
      default:
        return { label: 'Normal', color: 'bg-zinc-500/20 text-zinc-400 border-zinc-500/30' };
    }
  };

  const priorityInfo = getPriorityInfo();

  const parseDescription = (desc: string) => {
    const lines = desc.split('\n').filter(line => line.trim());
    const location = lines.find(l => l.startsWith('📍'));
    const time = lines.find(l => l.startsWith('⏰'));
    const otherLines = lines.filter(l => !l.startsWith('📍') && !l.startsWith('⏰'));
    return { location, time, description: otherLines.join('\n') };
  };

  const descriptionParts = task.description ? parseDescription(task.description) : null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-zinc-950 border-zinc-800 text-zinc-100 max-w-md" data-testid="task-detail-dialog">
        <DialogHeader>
          <div className="flex items-start gap-3">
            {sourceInfo && (
              <span className="text-2xl">{sourceInfo.icon}</span>
            )}
            <div className="flex-1">
              <DialogTitle className={cn(
                "text-xl font-semibold leading-tight",
                task.completed && "line-through text-zinc-500"
              )}>
                {task.title}
              </DialogTitle>
              <div className="flex flex-wrap gap-2 mt-2">
                {sourceInfo && (
                  <Badge variant="outline" className={cn("text-xs", sourceInfo.color)}>
                    {sourceInfo.name}
                  </Badge>
                )}
                <Badge variant="outline" className={cn("text-xs", priorityInfo.color)}>
                  Prioridad: {priorityInfo.label}
                </Badge>
                {task.type === 'event' && (
                  <Badge variant="outline" className="text-xs bg-zinc-900/20 text-zinc-400 border-white/10">
                    Evento
                  </Badge>
                )}
                {task.completed && (
                  <Badge variant="outline" className="text-xs bg-zinc-900/20 text-zinc-400 border-white/10">
                    Completado
                  </Badge>
                )}
              </div>
            </div>
          </div>
        </DialogHeader>

        <div className="space-y-4 py-4">
          <div className="flex items-center gap-3 p-3 bg-zinc-900/50 rounded-lg border border-zinc-800">
            <Calendar className="w-5 h-5 text-zinc-400" />
            <div>
              <div className="text-sm font-medium">
                {format(taskDate, "EEEE, d 'de' MMMM yyyy", { locale: es })}
              </div>
              {!isAllDay && (
                <div className="text-xs text-zinc-400 flex items-center gap-1 mt-1">
                  <Clock className="w-3 h-3" />
                  {format(taskDate, "HH:mm")}
                  {hasEndDate && task.endDate && (
                    <span> - {format(new Date(task.endDate), "HH:mm")}</span>
                  )}
                </div>
              )}
              {isAllDay && (
                <div className="text-xs text-zinc-500 mt-1">Todo el día</div>
              )}
            </div>
          </div>

          {descriptionParts?.location && (
            <div className="flex items-center gap-3 p-3 bg-zinc-900/50 rounded-lg border border-zinc-800">
              <MapPin className="w-5 h-5 text-zinc-400" />
              <div className="text-sm">
                {descriptionParts.location.replace('📍 ', '')}
              </div>
            </div>
          )}

          {descriptionParts?.time && (
            <div className="flex items-center gap-3 p-3 bg-zinc-900/50 rounded-lg border border-zinc-800">
              <Clock className="w-5 h-5 text-zinc-400" />
              <div className="text-sm">
                {descriptionParts.time.replace('⏰ ', '')}
              </div>
            </div>
          )}

          {descriptionParts?.description && (
            <div className="p-3 bg-zinc-900/50 rounded-lg border border-zinc-800">
              <div className="text-xs text-zinc-500 uppercase font-medium mb-2">Descripción</div>
              <div className="text-sm text-zinc-300 whitespace-pre-wrap">
                {descriptionParts.description}
              </div>
            </div>
          )}

          {task.externalId && (
            <div className="flex items-center gap-2 text-xs text-zinc-600">
              <ExternalLink className="w-3 h-3" />
              ID externo: {task.externalId.substring(0, 20)}...
            </div>
          )}
        </div>

        <DialogFooter className="flex gap-2 sm:gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              onToggle(task.id);
              onOpenChange(false);
            }}
            className={cn(
              "flex-1 gap-2",
              task.completed 
                ? "bg-zinc-800 border-zinc-700 text-zinc-300 hover:bg-zinc-700"
                : "bg-zinc-900/20 border-white/10 text-zinc-400 hover:bg-zinc-800/30"
            )}
            data-testid="toggle-task-btn"
          >
            <CheckCircle className="w-4 h-4" />
            {task.completed ? 'Desmarcar' : 'Completar'}
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              onEdit(task);
              onOpenChange(false);
            }}
            className="gap-2 bg-zinc-800 border-zinc-700 text-zinc-300 hover:bg-zinc-700"
            data-testid="edit-task-btn"
          >
            <Edit className="w-4 h-4" />
            Editar
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              onDelete(task.id);
              onOpenChange(false);
            }}
            className="gap-2 bg-zinc-900/20 border-white/10 text-zinc-400 hover:bg-zinc-800/30"
            data-testid="delete-task-btn"
          >
            <Trash2 className="w-4 h-4" />
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
