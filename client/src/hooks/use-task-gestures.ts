import { useState, useCallback, useRef } from 'react';

interface UseTaskGesturesOptions {
  onLongPress?: () => void;
  onSwipeRight?: () => void;
  onSwipeLeft?: () => void;
  longPressDelay?: number;
  swipeThreshold?: number;
}

interface UseTaskGesturesReturn {
  isLongPressing: boolean;
  swipeX: number;
  isSwipedRight: boolean;
  isSwipedLeft: boolean;
  handlers: {
    onPointerDown: (e: React.PointerEvent) => void;
    onPointerUp: () => void;
    onPointerCancel: () => void;
    onPointerLeave: () => void;
  };
  resetSwipe: () => void;
}

export function useTaskGestures({
  onLongPress,
  onSwipeRight,
  onSwipeLeft,
  longPressDelay = 500,
  swipeThreshold = 80,
}: UseTaskGesturesOptions = {}): UseTaskGesturesReturn {
  const [isLongPressing, setIsLongPressing] = useState(false);
  const [swipeX, setSwipeX] = useState(0);
  const [isSwipedRight, setIsSwipedRight] = useState(false);
  const [isSwipedLeft, setIsSwipedLeft] = useState(false);
  
  const longPressTimer = useRef<NodeJS.Timeout | null>(null);
  const startX = useRef<number>(0);
  const startY = useRef<number>(0);
  const isDragging = useRef(false);

  const clearTimer = useCallback(() => {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
  }, []);

  const triggerHaptic = useCallback(() => {
    if (navigator.vibrate) {
      navigator.vibrate(50);
    }
  }, []);

  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    startX.current = e.clientX;
    startY.current = e.clientY;
    isDragging.current = false;
    setIsLongPressing(false);

    longPressTimer.current = setTimeout(() => {
      setIsLongPressing(true);
      triggerHaptic();
      onLongPress?.();
    }, longPressDelay);
  }, [longPressDelay, onLongPress, triggerHaptic]);

  const handlePointerUp = useCallback(() => {
    clearTimer();
    setIsLongPressing(false);
    
    if (swipeX > swipeThreshold) {
      setIsSwipedRight(true);
      triggerHaptic();
      onSwipeRight?.();
    } else if (swipeX < -swipeThreshold) {
      setIsSwipedLeft(true);
      triggerHaptic();
      onSwipeLeft?.();
    }
    
    setSwipeX(0);
    isDragging.current = false;
  }, [clearTimer, swipeX, swipeThreshold, onSwipeRight, onSwipeLeft, triggerHaptic]);

  const handlePointerCancel = useCallback(() => {
    clearTimer();
    setIsLongPressing(false);
    setSwipeX(0);
    isDragging.current = false;
  }, [clearTimer]);

  const resetSwipe = useCallback(() => {
    setIsSwipedRight(false);
    setIsSwipedLeft(false);
    setSwipeX(0);
  }, []);

  return {
    isLongPressing,
    swipeX,
    isSwipedRight,
    isSwipedLeft,
    handlers: {
      onPointerDown: handlePointerDown,
      onPointerUp: handlePointerUp,
      onPointerCancel: handlePointerCancel,
      onPointerLeave: handlePointerCancel,
    },
    resetSwipe,
  };
}
