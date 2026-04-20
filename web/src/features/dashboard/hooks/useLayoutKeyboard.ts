import { useEffect } from 'react';
import type { SavedDashboard } from '../widgets/types';

interface KeyboardOptions {
  editMode: boolean;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  dashboards: SavedDashboard[];
  switchDashboard: (id: string) => void;
}

/**
 * Keyboard shortcuts for the dashboard:
 * - Ctrl+Z / Ctrl+Y (undo/redo) in edit mode
 * - Alt+1..9 to switch between dashboards (any mode)
 * Skips events when focus is inside form inputs.
 */
export function useLayoutKeyboard({
  editMode, canUndo, canRedo, onUndo, onRedo,
  dashboards, switchDashboard,
}: KeyboardOptions) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      const tag = target.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable) {
        return;
      }

      // Alt+1..9 — switch dashboards
      if (e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey) {
        const num = parseInt(e.key);
        if (num >= 1 && num <= 9 && num <= dashboards.length) {
          e.preventDefault();
          switchDashboard(dashboards[num - 1].id);
          return;
        }
      }

      // Undo/Redo (edit mode only)
      if (!editMode) return;
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
  }, [editMode, canUndo, canRedo, onUndo, onRedo, dashboards, switchDashboard]);
}
