import { useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import type { SavedDashboard } from '../widgets/types';
import { useShortcut, type ShortcutDefinition } from '@/hooks/useShortcutRegistry';

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
 *
 * Also publishes the page-scoped entries to the cheatsheet registry so
 * `?` lists them under "Dashboard".
 */
export function useLayoutKeyboard({
  editMode, setEditMode, canUndo, canRedo, onUndo, onRedo,
  dashboards, switchDashboard,
}: KeyboardOptions) {
  const { t } = useTranslation();

  const dashboardShortcuts = useMemo<ShortcutDefinition[]>(() => {
    const group = t('shortcuts.groups.dashboard', 'Dashboard');
    const make = (
      id: string,
      keys: string[],
      description: string,
    ): ShortcutDefinition => ({
      id: `dashboard.${id}`,
      keys,
      description,
      group,
      scope: 'route',
      routeMatch: /^\/$/,
    });
    const base: ShortcutDefinition[] = [
      make('toggleEdit', ['E'], t('dashboard.shortcuts.toggleEdit', 'Toggle edit mode')),
    ];
    if (editMode) {
      base.push(
        make('exitEdit', ['Esc'], t('dashboard.shortcuts.exitEdit', 'Exit edit mode')),
        make('undo', ['Ctrl', 'Z'], t('dashboard.shortcuts.undo', 'Undo layout change')),
        make('redo', ['Ctrl', 'Y'], t('dashboard.shortcuts.redo', 'Redo layout change')),
      );
    }
    if (dashboards.length > 1) {
      base.push(
        make('switch', ['Alt', '1–9'], t('dashboard.shortcuts.switch', 'Switch between dashboards')),
      );
    }
    return base;
  }, [editMode, dashboards.length, t]);
  useShortcut(dashboardShortcuts);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target?.isContentEditable) {
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

      // Browsers report the *uppercase* letter while Shift is held, so
      // Ctrl+Shift+Z arrives as key "Z" (and CapsLock turns Ctrl+Z into "Z").
      // Match case-insensitively — otherwise redo-via-Ctrl+Shift+Z silently
      // never fires.
      const key = e.key.toLowerCase();
      if (key === 'z' && !e.shiftKey && canUndo) {
        e.preventDefault();
        onUndo();
      } else if ((key === 'y' || (key === 'z' && e.shiftKey)) && canRedo) {
        e.preventDefault();
        onRedo();
      }
    };

    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [editMode, setEditMode, canUndo, canRedo, onUndo, onRedo, dashboards, switchDashboard]);
}

