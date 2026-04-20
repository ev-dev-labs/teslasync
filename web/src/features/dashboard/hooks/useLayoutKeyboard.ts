import { useEffect } from 'react';

interface KeyboardOptions {
  editMode: boolean;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
}

/**
 * Keyboard shortcuts for undo/redo in dashboard edit mode.
 * Supports Ctrl+Z / Ctrl+Y (Windows/Linux) and Cmd+Z / Cmd+Shift+Z (Mac).
 * Skips events when focus is inside form inputs.
 */
export function useLayoutKeyboard({
  editMode, canUndo, canRedo, onUndo, onRedo,
}: KeyboardOptions) {
  useEffect(() => {
    if (!editMode) return;

    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) {
        return;
      }

      const isCtrlOrMeta = e.ctrlKey || e.metaKey;
      if (!isCtrlOrMeta) return;

      if (e.key === 'z' && !e.shiftKey && canUndo) {
        e.preventDefault();
        onUndo();
      } else if ((e.key === 'y' || (e.key === 'z' && e.shiftKey)) && canRedo) {
        e.preventDefault();
        onRedo();
      }
    };

    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [editMode, canUndo, canRedo, onUndo, onRedo]);
}
