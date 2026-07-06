import { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import type { SavedDashboard } from '../widgets/types';

export interface KioskConfig {
  rotateInterval: number;
  dashboardIds: string[];
  hideCursor: boolean;
  cursorTimeout: number;
  dimAfter: number;
  dimLevel: number;
  showClock: boolean;
  clockPosition: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';
  /** Widget panel opacity: 0.3 (transparent) to 1.0 (solid/readable) */
  widgetOpacity: number;
  /** Page background opacity: 0.0 (transparent) to 1.0 (solid) */
  backgroundOpacity: number;
}

export const DEFAULT_KIOSK_CONFIG: KioskConfig = {
  rotateInterval: 30,
  dashboardIds: [],
  hideCursor: true,
  cursorTimeout: 5,
  dimAfter: 0,
  dimLevel: 0.5,
  showClock: true,
  clockPosition: 'bottom-right',
  widgetOpacity: 1.0,
  backgroundOpacity: 1.0,
};

const KIOSK_CONFIG_KEY = 'teslasync-kiosk-config';

function loadKioskConfig(): KioskConfig {
  try {
    const saved = localStorage.getItem(KIOSK_CONFIG_KEY);
    if (saved) {
      const parsed = JSON.parse(saved) as unknown;
      // Only merge a genuine object. A corrupted primitive/array in storage
      // must not smuggle junk keys (e.g. array indices) into the config or
      // leave a non-array `dashboardIds` behind for the memo below.
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return { ...DEFAULT_KIOSK_CONFIG, ...(parsed as Partial<KioskConfig>) };
      }
    }
  } catch { /* ignore */ }
  return DEFAULT_KIOSK_CONFIG;
}

function saveKioskConfig(config: KioskConfig): void {
  try {
    localStorage.setItem(KIOSK_CONFIG_KEY, JSON.stringify(config));
  } catch { /* ignore */ }
}

export function useKioskMode(
  dashboards: SavedDashboard[],
  activeId: string,
  switchDashboard: (id: string) => void,
) {
  const [config, setConfig] = useState<KioskConfig>(loadKioskConfig);
  const [isKiosk, setIsKiosk] = useState(false);
  const [isDimmed, setIsDimmed] = useState(false);
  const [isCursorHidden, setIsCursorHidden] = useState(false);

  const cursorTimer = useRef<ReturnType<typeof setTimeout>>();
  const dimTimer = useRef<ReturnType<typeof setTimeout>>();
  const rotateTimer = useRef<ReturnType<typeof setInterval>>();

  // Sanitize dashboardIds against actual dashboards. Both inputs are guarded
  // before any array method runs: `dashboards` can arrive undefined before the
  // saved layouts hydrate, and `config.dashboardIds` originates from untrusted
  // localStorage and may be corrupted into a non-array.
  const validIds = useMemo(() => {
    const allIds = (Array.isArray(dashboards) ? dashboards : []).map((d) => d.id);
    const existingIds = new Set(allIds);
    const configuredIds = Array.isArray(config.dashboardIds) ? config.dashboardIds : [];
    const filtered = configuredIds.filter((id) => existingIds.has(id));
    return filtered.length > 0 ? filtered : allIds;
  }, [config.dashboardIds, dashboards]);

  // Derive current rotation index from activeId
  const rotateIndex = useMemo(() => {
    const idx = validIds.indexOf(activeId);
    return idx >= 0 ? idx : 0;
  }, [validIds, activeId]);

  const updateConfig = useCallback((updates: Partial<KioskConfig>) => {
    setConfig((prev) => {
      const updated = { ...prev, ...updates };
      saveKioskConfig(updated);
      return updated;
    });
  }, []);

  /* ─── Enter / Exit ─── */
  const enterKiosk = useCallback(async () => {
    try {
      await document.documentElement.requestFullscreen();
    } catch {
      // Fullscreen not available — still enable kiosk features
    }
    setIsKiosk(true);
  }, []);

  const exitKiosk = useCallback(() => {
    if (document.fullscreenElement) {
      document.exitFullscreen().catch(() => {});
    }
    setIsKiosk(false);
    setIsDimmed(false);
    setIsCursorHidden(false);
    clearInterval(rotateTimer.current);
    clearTimeout(cursorTimer.current);
    clearTimeout(dimTimer.current);
  }, []);

  // Detect fullscreen exit (e.g. Esc key handled by browser)
  useEffect(() => {
    const handler = () => {
      if (!document.fullscreenElement && isKiosk) {
        exitKiosk();
      }
    };
    document.addEventListener('fullscreenchange', handler);
    return () => document.removeEventListener('fullscreenchange', handler);
  }, [isKiosk, exitKiosk]);

  /* ─── Dashboard auto-rotation ─── */
  useEffect(() => {
    if (!isKiosk || config.rotateInterval <= 0 || validIds.length <= 1) {
      return;
    }

    rotateTimer.current = setInterval(() => {
      const currentIdx = validIds.indexOf(activeId);
      const nextIdx = (currentIdx + 1) % validIds.length;
      switchDashboard(validIds[nextIdx]);
    }, config.rotateInterval * 1000);

    return () => clearInterval(rotateTimer.current);
  }, [isKiosk, config.rotateInterval, validIds, activeId, switchDashboard]);

  /* ─── Cursor auto-hide ─── */
  useEffect(() => {
    if (!isKiosk || !config.hideCursor) return;

    const resetCursor = () => {
      setIsCursorHidden(false);
      clearTimeout(cursorTimer.current);
      cursorTimer.current = setTimeout(() => {
        setIsCursorHidden(true);
      }, config.cursorTimeout * 1000);
    };

    window.addEventListener('mousemove', resetCursor);
    window.addEventListener('touchstart', resetCursor);
    resetCursor();

    return () => {
      window.removeEventListener('mousemove', resetCursor);
      window.removeEventListener('touchstart', resetCursor);
      clearTimeout(cursorTimer.current);
      setIsCursorHidden(false);
    };
  }, [isKiosk, config.hideCursor, config.cursorTimeout]);

  /* ─── Screen dim (burn-in prevention) ─── */
  useEffect(() => {
    if (!isKiosk || config.dimAfter <= 0) return;

    const resetDim = () => {
      setIsDimmed(false);
      clearTimeout(dimTimer.current);
      dimTimer.current = setTimeout(() => {
        setIsDimmed(true);
      }, config.dimAfter * 60 * 1000);
    };

    window.addEventListener('mousemove', resetDim);
    window.addEventListener('touchstart', resetDim);
    window.addEventListener('keydown', resetDim);
    resetDim();

    return () => {
      window.removeEventListener('mousemove', resetDim);
      window.removeEventListener('touchstart', resetDim);
      window.removeEventListener('keydown', resetDim);
      clearTimeout(dimTimer.current);
      setIsDimmed(false);
    };
  }, [isKiosk, config.dimAfter]);

  /* ─── URL param auto-kiosk ─── */
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('kiosk') === 'true') {
      enterKiosk();
      // Clean up the URL param
      const url = new URL(window.location.href);
      url.searchParams.delete('kiosk');
      window.history.replaceState({}, '', url.pathname + url.search);
    }
  }, [enterKiosk]);

  return {
    config,
    updateConfig,
    isKiosk,
    enterKiosk,
    exitKiosk,
    isDimmed,
    isCursorHidden,
    rotateIndex,
    validIds,
  };
}
