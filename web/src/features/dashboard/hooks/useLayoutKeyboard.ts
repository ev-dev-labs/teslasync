import { useEffect } from 'react';
import type { SavedDashboard } from '../widgets/types';

interface KeyboardOptions {
  editMode: boolean;
  setEditMode: (next: boolean) => void;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  dashboards: SavedDashboard[];
  switchDashboard: (id: string) => void;
}

/**
 * Keyboard shortcuts for the dashboard:
 * - `E`                — toggle edit mode
 * - `Esc`              — exit edit mode
 * - `?`                — open the keyboard-shortcuts help overlay
 * - `Ctrl+Z / Ctrl+Y`  — undo/redo in edit mode
 * - `Alt+1..9`         — switch between dashboards (any mode)
 *
 * Skips events when focus is inside form inputs (INPUT/TEXTAREA/SELECT
 * or any contenteditable element).
 */
export function useLayoutKeyboard({
  editMode, setEditMode, canUndo, canRedo, onUndo, onRedo,
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

      // Bare keys (no modifiers) — toggle edit / help / exit
      if (!e.ctrlKey && !e.metaKey && !e.altKey) {
        if (e.key === 'e' || e.key === 'E') {
          if (e.shiftKey) return;
          e.preventDefault();
          setEditMode(!editMode);
          return;
        }
        if (e.key === 'Escape' && editMode) {
          e.preventDefault();
          setEditMode(false);
          return;
        }
        if (e.key === '?' || (e.shiftKey && e.key === '/')) {
          e.preventDefault();
          window.dispatchEvent(new CustomEvent('toggle-keyboard-shortcuts'));
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
  }, [editMode, setEditMode, canUndo, canRedo, onUndo, onRedo, dashboards, switchDashboard]);
}

