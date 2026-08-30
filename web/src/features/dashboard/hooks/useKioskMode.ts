import { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import type { SavedDashboard } from '../widgets/types';
import {
  notifyPresentationConfigChanged,
  setPresentationRotation,
  usePresentationMode,
} from '@/hooks/usePresentationMode';

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
    notifyPresentationConfigChanged();
  } catch { /* ignore */ }
}

export function useKioskMode(
  dashboards: SavedDashboard[],
  activeId: string,
  switchDashboard: (id: string) => void,
) {
  const [config, setConfig] = useState<KioskConfig>(loadKioskConfig);
  const {
    mode,
    enterKiosk: enterPresentationKiosk,
    exitPresentation,
    isDimmed,
    isCursorHidden,
  } = usePresentationMode();
  const isKiosk = mode === 'kiosk';

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

  useEffect(() => {
    setPresentationRotation(
      isKiosk
        ? {
            dashboardCount: validIds.length,
            currentIndex: rotateIndex,
            enabled: config.rotateInterval > 0,
          }
        : null,
    );
  }, [config.rotateInterval, isKiosk, rotateIndex, validIds.length]);

  useEffect(() => () => setPresentationRotation(null), []);

  const updateConfig = useCallback((updates: Partial<KioskConfig>) => {
    setConfig((prev) => {
      const updated = { ...prev, ...updates };
      saveKioskConfig(updated);
      return updated;
    });
  }, []);

  /* ─── Enter / Exit ─── */
  const enterKiosk = useCallback(async () => {
    await enterPresentationKiosk();
  }, [enterPresentationKiosk]);

  const exitKiosk = useCallback(() => {
    exitPresentation();
    clearInterval(rotateTimer.current);
  }, [exitPresentation]);

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

  /* ─── URL param auto-kiosk ─── */
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('kiosk') === 'true') {
      void enterKiosk();
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
