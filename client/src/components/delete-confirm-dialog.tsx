import { Button } from "@/components/ui/button";
import { Trash2, X } from "lucide-react";

interface DeleteConfirmDialogProps {
  open: boolean;
  onClose: () => void;
  onDeleteOne: () => void;
  onDeleteAll: () => void;
  taskTitle: string;
  seriesCount: number;
}

export function DeleteConfirmDialog({ 
  open, 
  onClose, 
  onDeleteOne, 
  onDeleteAll, 
  taskTitle,
  seriesCount 
}: DeleteConfirmDialogProps) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div 
        className="bg-zinc-900 border border-zinc-800 rounded-xl max-w-md w-full p-6"
        onClick={(e) => e.stopPropagation()}
        data-testid="delete-confirm-dialog"
      >
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-lg font-bold text-white flex items-center gap-2">
            <Trash2 className="w-5 h-5 text-zinc-400" />
            Eliminar evento
          </h2>
          <button
            onClick={onClose}
            className="text-zinc-400 hover:text-white p-1"
            data-testid="button-close-delete-dialog"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <p className="text-zinc-300 mb-2">
          <span className="font-medium text-white">"{taskTitle}"</span>
        </p>
        
        <p className="text-zinc-400 text-sm mb-6">
          Este evento se repite {seriesCount} veces. ¿Qué deseas hacer?
        </p>

        <div className="space-y-3">
          <Button
            onClick={onDeleteOne}
            variant="outline"
            className="w-full justify-start border-zinc-700 hover:bg-zinc-800 text-zinc-200"
            data-testid="button-delete-one"
          >
            <Trash2 className="w-4 h-4 mr-2" />
            Eliminar solo este evento
          </Button>
          
          <Button
            onClick={onDeleteAll}
            variant="destructive"
            className="w-full justify-start bg-zinc-800 hover:bg-zinc-800"
            data-testid="button-delete-all"
          >
            <Trash2 className="w-4 h-4 mr-2" />
            Eliminar todos los eventos ({seriesCount})
          </Button>
        </div>

        <Button
          onClick={onClose}
          variant="ghost"
          className="w-full mt-4 text-zinc-400 hover:text-white"
          data-testid="button-cancel-delete"
        >
          Cancelar
        </Button>
      </div>
    </div>
  );
}
