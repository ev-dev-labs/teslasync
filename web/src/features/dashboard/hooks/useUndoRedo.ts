import { useState, useCallback, useRef } from 'react';

interface UndoRedoState<T> {
  current: T;
  canUndo: boolean;
  canRedo: boolean;
  undoCount: number;
  set: (value: T) => void;
  undo: () => T | undefined;
  redo: () => T | undefined;
  reset: (value: T) => void;
}

const MAX_HISTORY = 50;

/**
 * Generic undo/redo history hook.
 * Uses refs for stacks so undo/redo return the new value synchronously,
 * with a version counter to trigger re-renders.
 */
export function useUndoRedo<T>(initialValue: T): UndoRedoState<T> {
  const [, forceRender] = useState(0);
  const currentRef = useRef<T>(initialValue);
  const undoStack = useRef<T[]>([]);
  const redoStack = useRef<T[]>([]);

  const set = useCallback((value: T) => {
    undoStack.current.push(currentRef.current);
    if (undoStack.current.length > MAX_HISTORY) {
      undoStack.current.shift();
    }
    redoStack.current = [];
    currentRef.current = value;
    forceRender((v) => v + 1);
  }, []);

  const undo = useCallback((): T | undefined => {
    // Guard on stack length, not on the popped value: T may legitimately
    // include `undefined`, so a popped `undefined` is a real prior state to
    // restore rather than an empty-stack sentinel.
    if (undoStack.current.length === 0) return undefined;
    const previous = undoStack.current.pop() as T;
    redoStack.current.push(currentRef.current);
    currentRef.current = previous;
    forceRender((v) => v + 1);
    return previous;
  }, []);

  const redo = useCallback((): T | undefined => {
    if (redoStack.current.length === 0) return undefined;
    const next = redoStack.current.pop() as T;
    undoStack.current.push(currentRef.current);
    currentRef.current = next;
    forceRender((v) => v + 1);
    return next;
  }, []);

  const reset = useCallback((value: T) => {
    undoStack.current = [];
    redoStack.current = [];
    currentRef.current = value;
    forceRender((v) => v + 1);
  }, []);

  return {
    current: currentRef.current,
    canUndo: undoStack.current.length > 0,
    canRedo: redoStack.current.length > 0,
    undoCount: undoStack.current.length,
    set,
    undo,
    redo,
    reset,
  };
}
