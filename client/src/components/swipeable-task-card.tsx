import { useState, useRef } from 'react';
import { motion, useMotionValue, useTransform, PanInfo } from 'framer-motion';
import { Trash2, Edit2 } from 'lucide-react';
import type { Task } from '@shared/schema';

interface SwipeableTaskCardProps {
  task: Task;
  children: React.ReactNode;
  onEdit: (task: Task) => void;
  onDelete: (taskId: string) => void;
  onToggle?: (taskId: string) => void;
}

export function SwipeableTaskCard({
  task,
  children,
  onEdit,
  onDelete,
  onToggle,
}: SwipeableTaskCardProps) {
  const [isDeleting, setIsDeleting] = useState(false);
  const [showActions, setShowActions] = useState(false);
  const x = useMotionValue(0);
  const longPressTimer = useRef<NodeJS.Timeout | null>(null);
  const isLongPress = useRef(false);

  const background = useTransform(
    x,
    [-100, 0, 100],
    ['rgba(239, 68, 68, 0.3)', 'transparent', 'rgba(59, 130, 246, 0.3)']
  );

  const deleteOpacity = useTransform(x, [0, 80], [0, 1]);
  const editOpacity = useTransform(x, [-80, 0], [1, 0]);

  const handleDragEnd = (_: any, info: PanInfo) => {
    const threshold = 80;
    
    if (info.offset.x > threshold) {
      if (navigator.vibrate) navigator.vibrate(50);
      onEdit(task);
    } else if (info.offset.x < -threshold) {
      if (navigator.vibrate) navigator.vibrate(50);
      setIsDeleting(true);
      setTimeout(() => {
        onDelete(task.id);
      }, 200);
    }
    
    setShowActions(false);
  };

  const handleDrag = (_: any, info: PanInfo) => {
    if (Math.abs(info.offset.x) > 20) {
      setShowActions(true);
    }
  };

  const handlePointerDown = () => {
    isLongPress.current = false;
    longPressTimer.current = setTimeout(() => {
      isLongPress.current = true;
      if (navigator.vibrate) navigator.vibrate(50);
      setIsDeleting(true);
      setTimeout(() => {
        onDelete(task.id);
      }, 200);
    }, 600);
  };

  const handlePointerUp = () => {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
  };

  const handleClick = () => {
    if (!isLongPress.current && onToggle) {
      onToggle(task.id);
    }
  };

  return (
    <motion.div
      className="relative overflow-hidden rounded-lg touch-pan-y"
      style={{ background }}
      initial={false}
      animate={isDeleting ? { opacity: 0, height: 0, marginBottom: 0 } : {}}
      transition={{ duration: 0.2 }}
    >
      <motion.div
        className="absolute inset-y-0 left-0 flex items-center justify-start pl-4 pointer-events-none"
        style={{ opacity: deleteOpacity }}
      >
        <div className="flex items-center gap-2 text-zinc-400">
          <Edit2 className="w-5 h-5" />
          <span className="text-sm font-medium">Editar</span>
        </div>
      </motion.div>

      <motion.div
        className="absolute inset-y-0 right-0 flex items-center justify-end pr-4 pointer-events-none"
        style={{ opacity: editOpacity }}
      >
        <div className="flex items-center gap-2 text-zinc-400">
          <span className="text-sm font-medium">Borrar</span>
          <Trash2 className="w-5 h-5" />
        </div>
      </motion.div>

      <motion.div
        drag="x"
        dragConstraints={{ left: 0, right: 0 }}
        dragElastic={0.2}
        onDrag={handleDrag}
        onDragEnd={handleDragEnd}
        style={{ x }}
        className="relative bg-zinc-900 cursor-grab active:cursor-grabbing"
        onPointerDown={handlePointerDown}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        onPointerLeave={handlePointerUp}
        onClick={handleClick}
        whileTap={{ scale: 0.98 }}
        data-testid={`swipeable-task-${task.id}`}
      >
        {children}
      </motion.div>

      {showActions && (
        <div className="absolute bottom-1 left-1/2 transform -translate-x-1/2 text-[10px] text-zinc-500 pointer-events-none">
          Desliza para editar/borrar
        </div>
      )}
    </motion.div>
  );
}
