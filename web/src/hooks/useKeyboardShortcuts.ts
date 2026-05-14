import { useEffect, useState, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';

type ShortcutMode = 'idle' | 'goto';

interface ShortcutState {
  mode: ShortcutMode;
  showCheatSheet: boolean;
  toggleCheatSheet: () => void;
}

/** Navigation shortcuts activated by pressing g then a target key */
export const GOTO_SHORTCUTS: Record<string, { path: string; label: string }> = {
  'd': { path: '/', label: 'Dashboard' },
  'v': { path: '/vehicles', label: 'Vehicles' },
  'c': { path: '/charging', label: 'Charging' },
  'r': { path: '/drives', label: 'Drives' },
  't': { path: '/trips', label: 'Trips' },
  'b': { path: '/battery', label: 'Battery & Energy' },
  'a': { path: '/analytics', label: 'Analytics' },
  'e': { path: '/efficiency', label: 'Efficiency' },
  's': { path: '/settings', label: 'Settings' },
  'n': { path: '/notifications/inbox', label: 'Notifications' },
  'l': { path: '/live-signals', label: 'Live Signals' },
  'o': { path: '/automations', label: 'Automations' },
  'x': { path: '/commands', label: 'Commands' },
  'i': { path: '/climate', label: 'Climate' },
};

const GOTO_TIMEOUT_MS = 1500;

export function useKeyboardShortcuts(): ShortcutState {
  const navigate = useNavigate();
  const [mode, setMode] = useState<ShortcutMode>('idle');
  const [showCheatSheet, setShowCheatSheet] = useState(false);
  const timeoutRef = useRef<ReturnType<typeof setTimeout>>();

  const toggleCheatSheet = useCallback(() => {
    setShowCheatSheet(prev => !prev);
  }, []);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (
        target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.tagName === 'SELECT' ||
        target.isContentEditable
      ) {
        return;
      }

      const isCtrlOrMeta = e.ctrlKey || e.metaKey;

      // ? → toggle cheat sheet
      if (e.key === '?' && !isCtrlOrMeta) {
        e.preventDefault();
        toggleCheatSheet();
        return;
      }

      // Esc → close everything
      if (e.key === 'Escape') {
        setMode('idle');
        setShowCheatSheet(false);
        clearTimeout(timeoutRef.current);
        return;
      }

      // Ctrl+K or / → command palette
      if ((e.key === 'k' && isCtrlOrMeta) || (e.key === '/' && !isCtrlOrMeta && mode === 'idle')) {
        e.preventDefault();
        window.dispatchEvent(new CustomEvent('toggle-command-palette'));
        return;
      }

      // Enter GOTO mode
      if (mode === 'idle' && e.key === 'g' && !isCtrlOrMeta) {
        setMode('goto');
        clearTimeout(timeoutRef.current);
        timeoutRef.current = setTimeout(() => setMode('idle'), GOTO_TIMEOUT_MS);
        return;
      }

      // Handle GOTO target key
      if (mode === 'goto') {
        const shortcut = GOTO_SHORTCUTS[e.key.toLowerCase()];
        if (shortcut) {
          e.preventDefault();
          navigate(shortcut.path);
        }
        setMode('idle');
        clearTimeout(timeoutRef.current);
        return;
      }
    };

    window.addEventListener('keydown', handler);
    return () => {
      window.removeEventListener('keydown', handler);
      clearTimeout(timeoutRef.current);
    };
  }, [mode, navigate, toggleCheatSheet]);

  return { mode, showCheatSheet, toggleCheatSheet };
}
