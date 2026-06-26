// Native parity port of web/src/features/dashboard/hooks/useKioskMode.ts.
//
// useKioskMode owns the dashboard "kiosk" experience: a persisted KioskConfig,
// the isKiosk / isDimmed / isCursorHidden state machine, auto-rotation through
// the user's saved dashboards, and inactivity-driven cursor-hide + screen-dim
// (burn-in prevention). The web hook leans on several browser-only primitives
// that are absent from the React Native parity manifest (contract rules 4, 5 &
// 7); each is replaced with a native-safe equivalent and documented here + in
// the sidecar:
//
//   - `localStorage` (web L32, L36, L44): the single 'teslasync-kiosk-config'
//     slot becomes a module-scoped in-memory store keyed by KIOSK_CONFIG_KEY.
//     The exact load / merge-over-defaults / save code paths (JSON round-trip +
//     try/catch graceful degradation) are preserved; only cold-restart
//     persistence is lost -- the same single-process degradation other
//     web-parity ports use (useChartLegendState / useVehiclePaint).
//   - Fullscreen API `document.documentElement.requestFullscreen()` /
//     `document.exitFullscreen()` / `document.fullscreenElement` (web L86,
//     L94-95): React Native has no Fullscreen API. enterKiosk / exitKiosk keep
//     their full state-machine behaviour; the fullscreen request itself
//     degrades to a no-op exactly like the web try/catch "Fullscreen not
//     available -- still enable kiosk features" branch already documents.
//   - `fullscreenchange` DOM event (web L106-114): there is no fullscreen to
//     leave on native, so the "external exit -> exitKiosk" intent maps to the
//     platform's real escape affordance -- Android's hardware Back button via
//     `BackHandler` (the same analogue NavigationGuardProvider uses). On
//     iOS / macOS / Windows there is no hardware Back, so the listener is inert.
//   - global window 'mousemove' / 'touchstart' / 'keydown' activity listeners
//     (web L143-144, L167-169): React Native has no global input event stream,
//     so user activity is fed in by the host kiosk screen via the exported
//     `notifyKioskActivity()` (e.g. a root onTouchStart / PanResponder). The
//     cursor-hide + dim inactivity timers and their reset semantics are
//     otherwise preserved verbatim, including the cursorTimeout * 1000 and
//     dimAfter * 60 * 1000 math.
//   - URL auto-kiosk `window.location.search` + URLSearchParams + `URL` +
//     `window.history.replaceState` (web L183-189): native has no document URL,
//     query string, or History API. The "?kiosk=true launches into kiosk, then
//     strip the param" one-shot intent maps to the exported
//     `requestKioskLaunch()` flag a host deep-link handler can set; the mount
//     effect consumes it once and clears it so it never re-triggers (mirroring
//     the param cleanup).
//
// No DOM-only modules, browser HTML elements, Recharts, Leaflet, or web UI
// components are imported -- only react and the react-native BackHandler
// primitive.

import {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {BackHandler} from 'react-native';

// ── ../widgets/types SavedDashboard (web L2) ──
// The native dashboard feature has no widgets/types.ts yet and this hook only
// reads each dashboard's `id`, so the structural subset it consumes is ported
// inline rather than dragging in the full widget / react-grid-layout / lucide
// type tree (none of which are in the native parity manifest). Callers passing
// the full SavedDashboard shape stay structurally compatible.
interface SavedDashboard {
  id: string;
}

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

// Native analogue of the single browser localStorage slot keyed by
// KIOSK_CONFIG_KEY. React Native has no localStorage, so the kiosk config
// persists for the current app process only; cold-restart persistence is
// unavailable.
const kioskConfigStore = new Map<string, string>();

function loadKioskConfig(): KioskConfig {
  try {
    const saved = kioskConfigStore.get(KIOSK_CONFIG_KEY);
    if (saved) {
      return {
        ...DEFAULT_KIOSK_CONFIG,
        ...(JSON.parse(saved) as Partial<KioskConfig>),
      };
    }
  } catch {
    /* ignore */
  }
  return DEFAULT_KIOSK_CONFIG;
}

function saveKioskConfig(config: KioskConfig): void {
  try {
    kioskConfigStore.set(KIOSK_CONFIG_KEY, JSON.stringify(config));
  } catch {
    /* ignore */
  }
}

// ── Activity bus: native analogue of the global window activity listeners ──
// The web hook reset its cursor-hide + dim timers on window 'mousemove' /
// 'touchstart' / 'keydown'. React Native has no global input event stream, so
// the host kiosk screen forwards user activity by calling notifyKioskActivity()
// (e.g. from a root-level onTouchStart / PanResponder); every mounted kiosk
// hook instance resets its inactivity timers.
type KioskActivityListener = () => void;
const kioskActivityListeners = new Set<KioskActivityListener>();

export function notifyKioskActivity(): void {
  for (const fn of kioskActivityListeners) {
    fn();
  }
}

function subscribeKioskActivity(fn: KioskActivityListener): () => void {
  kioskActivityListeners.add(fn);
  return () => {
    kioskActivityListeners.delete(fn);
  };
}

// ── Launch intent: native analogue of the ?kiosk=true URL launch param ──
// The web hook auto-entered kiosk when launched with ?kiosk=true and then
// stripped the param so it never re-fired. Native has no document URL / query
// string, so a host deep-link handler requests auto-kiosk via
// requestKioskLaunch(); the mount effect consumes the flag once and clears it.
let kioskLaunchRequested = false;

export function requestKioskLaunch(): void {
  kioskLaunchRequested = true;
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

  // Web typed these `useRef<ReturnType<typeof setTimeout>>()` and cleared them
  // unguarded; React Native's clearTimeout/clearInterval require a non-optional
  // handle, so the established native idiom is `| null` refs + a truthy guard
  // before clearing (clearing a null/unset timer was already a no-op on web).
  const cursorTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dimTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const rotateTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  // Sanitize dashboardIds against actual dashboards
  const validIds = useMemo(() => {
    const existingIds = new Set(dashboards.map(d => d.id));
    const filtered = config.dashboardIds.filter(id => existingIds.has(id));
    return filtered.length > 0 ? filtered : dashboards.map(d => d.id);
  }, [config.dashboardIds, dashboards]);

  // Derive current rotation index from activeId
  const rotateIndex = useMemo(() => {
    const idx = validIds.indexOf(activeId);
    return idx >= 0 ? idx : 0;
  }, [validIds, activeId]);

  const updateConfig = useCallback((updates: Partial<KioskConfig>) => {
    setConfig(prev => {
      const updated = {...prev, ...updates};
      saveKioskConfig(updated);
      return updated;
    });
  }, []);

  /* ─── Enter / Exit ─── */
  const enterKiosk = useCallback(async () => {
    try {
      // Web requested `document.documentElement.requestFullscreen()` here.
      // React Native has no Fullscreen API; awaiting a resolved no-op keeps
      // enterKiosk async (Promise<void> signature) and preserves the web
      // "attempt fullscreen, ignore failure, still enable kiosk" structure.
      await Promise.resolve();
    } catch {
      // Fullscreen not available — still enable kiosk features
    }
    setIsKiosk(true);
  }, []);

  const exitKiosk = useCallback(() => {
    // No document.exitFullscreen() on native — there is nothing to leave.
    setIsKiosk(false);
    setIsDimmed(false);
    setIsCursorHidden(false);
    if (rotateTimer.current) {
      clearInterval(rotateTimer.current);
    }
    if (cursorTimer.current) {
      clearTimeout(cursorTimer.current);
    }
    if (dimTimer.current) {
      clearTimeout(dimTimer.current);
    }
  }, []);

  // Detect an external request to leave kiosk. Web listened for the browser
  // leaving fullscreen (Esc handled by the browser); native's analogue is the
  // Android hardware Back button. iOS/macOS/Windows have no hardware Back, so
  // this listener is inert there.
  useEffect(() => {
    if (!isKiosk) {
      return;
    }
    const subscription = BackHandler.addEventListener(
      'hardwareBackPress',
      () => {
        exitKiosk();
        return true;
      },
    );
    return () => subscription.remove();
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

    return () => {
      if (rotateTimer.current) {
        clearInterval(rotateTimer.current);
      }
    };
  }, [isKiosk, config.rotateInterval, validIds, activeId, switchDashboard]);

  /* ─── Cursor auto-hide ─── */
  useEffect(() => {
    if (!isKiosk || !config.hideCursor) {
      return;
    }

    const resetCursor = () => {
      setIsCursorHidden(false);
      if (cursorTimer.current) {
        clearTimeout(cursorTimer.current);
      }
      cursorTimer.current = setTimeout(() => {
        setIsCursorHidden(true);
      }, config.cursorTimeout * 1000);
    };

    // Web bound window 'mousemove' + 'touchstart'; native forwards activity
    // through the in-process bus instead.
    const unsubscribe = subscribeKioskActivity(resetCursor);
    resetCursor();

    return () => {
      unsubscribe();
      if (cursorTimer.current) {
        clearTimeout(cursorTimer.current);
      }
      setIsCursorHidden(false);
    };
  }, [isKiosk, config.hideCursor, config.cursorTimeout]);

  /* ─── Screen dim (burn-in prevention) ─── */
  useEffect(() => {
    if (!isKiosk || config.dimAfter <= 0) {
      return;
    }

    const resetDim = () => {
      setIsDimmed(false);
      if (dimTimer.current) {
        clearTimeout(dimTimer.current);
      }
      dimTimer.current = setTimeout(() => {
        setIsDimmed(true);
      }, config.dimAfter * 60 * 1000);
    };

    // Web bound window 'mousemove' + 'touchstart' + 'keydown'; native forwards
    // activity through the in-process bus instead.
    const unsubscribe = subscribeKioskActivity(resetDim);
    resetDim();

    return () => {
      unsubscribe();
      if (dimTimer.current) {
        clearTimeout(dimTimer.current);
      }
      setIsDimmed(false);
    };
  }, [isKiosk, config.dimAfter]);

  /* ─── Launch-param auto-kiosk ─── */
  useEffect(() => {
    if (kioskLaunchRequested) {
      enterKiosk();
      // Clear the one-shot flag so it never re-triggers (web stripped the
      // ?kiosk=true URL param via history.replaceState for the same reason).
      kioskLaunchRequested = false;
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
