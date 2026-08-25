import {
  useCallback,
  useEffect,
  useState,
  useSyncExternalStore,
} from 'react';
import { useLocation, useNavigate } from 'react-router-dom';

export type PresentationMode = 'standard' | 'report' | 'kiosk';

export interface PresentationDisplayConfig {
  hideCursor: boolean;
  cursorTimeout: number;
  dimAfter: number;
  dimLevel: number;
  showClock: boolean;
  clockPosition: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';
}

export interface PresentationRotationState {
  dashboardCount: number;
  currentIndex: number;
  enabled: boolean;
}

export const DEFAULT_PRESENTATION_DISPLAY_CONFIG: PresentationDisplayConfig = {
  hideCursor: true,
  cursorTimeout: 5,
  dimAfter: 0,
  dimLevel: 0.5,
  showClock: true,
  clockPosition: 'bottom-right',
};

export const PRESENTATION_CONFIG_STORAGE_KEY = 'teslasync-kiosk-config';
const PRESENTATION_MODE_EVENT = 'teslasync:presentation-mode';
const PRESENTATION_CONFIG_EVENT = 'teslasync:presentation-config';
const EMPTY_ROTATION_STATE: PresentationRotationState = {
  dashboardCount: 0,
  currentIndex: 0,
  enabled: false,
};
let rotationState = EMPTY_ROTATION_STATE;
const rotationListeners = new Set<() => void>();

function readFiniteNumber(
  value: unknown,
  fallback: number,
  min: number,
  max: number,
): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.min(max, Math.max(min, value))
    : fallback;
}

function readDisplayConfig(): PresentationDisplayConfig {
  if (typeof window === 'undefined') return DEFAULT_PRESENTATION_DISPLAY_CONFIG;
  try {
    const raw = window.localStorage.getItem(PRESENTATION_CONFIG_STORAGE_KEY);
    if (!raw) return DEFAULT_PRESENTATION_DISPLAY_CONFIG;
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return DEFAULT_PRESENTATION_DISPLAY_CONFIG;
    }
    const value = parsed as Partial<PresentationDisplayConfig>;
    const clockPositions: PresentationDisplayConfig['clockPosition'][] = [
      'top-left',
      'top-right',
      'bottom-left',
      'bottom-right',
    ];
    return {
      hideCursor:
        typeof value.hideCursor === 'boolean'
          ? value.hideCursor
          : DEFAULT_PRESENTATION_DISPLAY_CONFIG.hideCursor,
      cursorTimeout: readFiniteNumber(
        value.cursorTimeout,
        DEFAULT_PRESENTATION_DISPLAY_CONFIG.cursorTimeout,
        1,
        60,
      ),
      dimAfter: readFiniteNumber(
        value.dimAfter,
        DEFAULT_PRESENTATION_DISPLAY_CONFIG.dimAfter,
        0,
        240,
      ),
      dimLevel: readFiniteNumber(
        value.dimLevel,
        DEFAULT_PRESENTATION_DISPLAY_CONFIG.dimLevel,
        0,
        1,
      ),
      showClock:
        typeof value.showClock === 'boolean'
          ? value.showClock
          : DEFAULT_PRESENTATION_DISPLAY_CONFIG.showClock,
      clockPosition:
        value.clockPosition && clockPositions.includes(value.clockPosition)
          ? value.clockPosition
          : DEFAULT_PRESENTATION_DISPLAY_CONFIG.clockPosition,
    };
  } catch {
    return DEFAULT_PRESENTATION_DISPLAY_CONFIG;
  }
}

function getPresentationModeFromSearch(search: string): PresentationMode {
  const params = new URLSearchParams(search);
  const value = params.get('presentation');
  if (value === 'report' || value === 'kiosk') return value;
  return params.get('kiosk') === 'true' ? 'kiosk' : 'standard';
}

export function getPresentationMode(): PresentationMode {
  if (typeof window === 'undefined') return 'standard';
  return getPresentationModeFromSearch(window.location.search);
}

function applyPresentationMode(
  params: URLSearchParams,
  mode: PresentationMode,
): URLSearchParams {
  params.delete('kiosk');
  if (mode === 'standard') {
    params.delete('presentation');
  } else {
    params.set('presentation', mode);
  }
  return params;
}

function emitPresentationModeChange(): void {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event(PRESENTATION_MODE_EVENT));
  }
}

export function notifyPresentationConfigChanged(): void {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event(PRESENTATION_CONFIG_EVENT));
  }
}

export function setPresentationRotation(
  next: PresentationRotationState | null,
): void {
  const normalized = next ?? EMPTY_ROTATION_STATE;
  if (
    normalized.dashboardCount === rotationState.dashboardCount &&
    normalized.currentIndex === rotationState.currentIndex &&
    normalized.enabled === rotationState.enabled
  ) {
    return;
  }
  rotationState = normalized;
  rotationListeners.forEach((listener) => listener());
}

function subscribePresentationRotation(listener: () => void): () => void {
  rotationListeners.add(listener);
  return () => rotationListeners.delete(listener);
}

function getPresentationRotation(): PresentationRotationState {
  return rotationState;
}

export function setPresentationMode(mode: PresentationMode): void {
  if (typeof window === 'undefined') return;
  const url = new URL(window.location.href);
  applyPresentationMode(url.searchParams, mode);
  window.history.replaceState(
    window.history.state,
    '',
    `${url.pathname}${url.search}${url.hash}`,
  );
  // replaceState does not notify BrowserRouter. Emit the corresponding
  // navigation event so later Router-owned search updates use this URL.
  window.dispatchEvent(
    new PopStateEvent('popstate', { state: window.history.state }),
  );
  emitPresentationModeChange();
}

export function subscribePresentationMode(
  listener: (mode: PresentationMode) => void,
): () => void {
  if (typeof window === 'undefined') return () => undefined;
  const handleChange = () => listener(getPresentationMode());
  window.addEventListener(PRESENTATION_MODE_EVENT, handleChange);
  window.addEventListener('popstate', handleChange);
  return () => {
    window.removeEventListener(PRESENTATION_MODE_EVENT, handleChange);
    window.removeEventListener('popstate', handleChange);
  };
}

function buildPresentationUrl(mode: Exclude<PresentationMode, 'standard'>): string {
  const url = new URL(window.location.href);
  url.searchParams.delete('kiosk');
  url.searchParams.set('presentation', mode);
  return url.toString();
}

async function copyText(value: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value);
    return;
  }
  const textarea = document.createElement('textarea');
  textarea.value = value;
  textarea.style.position = 'fixed';
  textarea.style.opacity = '0';
  document.body.appendChild(textarea);
  textarea.select();
  try {
    if (!document.execCommand('copy')) throw new Error('Clipboard unavailable');
  } finally {
    textarea.remove();
  }
}

export async function copyPresentationLink(
  mode: Exclude<PresentationMode, 'standard'>,
): Promise<void> {
  if (typeof window === 'undefined') return;
  await copyText(buildPresentationUrl(mode));
}

export function usePresentationMode() {
  const location = useLocation();
  const navigate = useNavigate();
  const mode = getPresentationModeFromSearch(location.search);
  const [config, setConfig] = useState<PresentationDisplayConfig>(
    readDisplayConfig,
  );
  const [isDimmed, setIsDimmed] = useState(false);
  const [isCursorHidden, setIsCursorHidden] = useState(false);
  const rotation = useSyncExternalStore(
    subscribePresentationRotation,
    getPresentationRotation,
    () => EMPTY_ROTATION_STATE,
  );

  useEffect(() => {
    const refreshConfig = () => setConfig(readDisplayConfig());
    const handleStorage = (event: StorageEvent) => {
      if (event.key === PRESENTATION_CONFIG_STORAGE_KEY) refreshConfig();
    };
    window.addEventListener(PRESENTATION_CONFIG_EVENT, refreshConfig);
    window.addEventListener('storage', handleStorage);
    return () => {
      window.removeEventListener(PRESENTATION_CONFIG_EVENT, refreshConfig);
      window.removeEventListener('storage', handleStorage);
    };
  }, []);

  useEffect(() => {
    if (mode !== 'kiosk' || !config.hideCursor) {
      setIsCursorHidden(false);
      return undefined;
    }
    let timer: ReturnType<typeof setTimeout> | undefined;
    const reset = () => {
      setIsCursorHidden(false);
      if (timer) clearTimeout(timer);
      timer = setTimeout(
        () => setIsCursorHidden(true),
        config.cursorTimeout * 1000,
      );
    };
    window.addEventListener('mousemove', reset);
    window.addEventListener('touchstart', reset);
    reset();
    return () => {
      window.removeEventListener('mousemove', reset);
      window.removeEventListener('touchstart', reset);
      if (timer) clearTimeout(timer);
    };
  }, [config.cursorTimeout, config.hideCursor, mode]);

  useEffect(() => {
    if (mode !== 'kiosk' || config.dimAfter <= 0) {
      setIsDimmed(false);
      return undefined;
    }
    let timer: ReturnType<typeof setTimeout> | undefined;
    const reset = () => {
      setIsDimmed(false);
      if (timer) clearTimeout(timer);
      timer = setTimeout(
        () => setIsDimmed(true),
        config.dimAfter * 60 * 1000,
      );
    };
    window.addEventListener('mousemove', reset);
    window.addEventListener('touchstart', reset);
    window.addEventListener('keydown', reset);
    reset();
    return () => {
      window.removeEventListener('mousemove', reset);
      window.removeEventListener('touchstart', reset);
      window.removeEventListener('keydown', reset);
      if (timer) clearTimeout(timer);
    };
  }, [config.dimAfter, mode]);

  const updateMode = useCallback(
    (nextMode: PresentationMode) => {
      const params = applyPresentationMode(
        new URLSearchParams(location.search),
        nextMode,
      );
      const search = params.toString();
      navigate(
        {
          pathname: location.pathname,
          search: search ? `?${search}` : '',
          hash: location.hash,
        },
        { replace: true },
      );
      emitPresentationModeChange();
    },
    [location.hash, location.pathname, location.search, navigate],
  );

  const enterReport = useCallback(() => {
    updateMode('report');
  }, [updateMode]);

  const enterKiosk = useCallback(async () => {
    try {
      await document.documentElement.requestFullscreen();
    } catch {
      // Fullscreen is optional; the chrome-free presentation still works.
    }
    updateMode('kiosk');
  }, [updateMode]);

  const exitPresentation = useCallback(() => {
    if (document.fullscreenElement) {
      void document.exitFullscreen().catch(() => undefined);
    }
    updateMode('standard');
  }, [updateMode]);

  useEffect(() => {
    if (mode !== 'kiosk') return undefined;
    const handleFullscreenChange = () => {
      if (!document.fullscreenElement) updateMode('standard');
    };
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    return () =>
      document.removeEventListener(
        'fullscreenchange',
        handleFullscreenChange,
      );
  }, [mode, updateMode]);

  return {
    mode,
    isActive: mode !== 'standard',
    isReport: mode === 'report',
    isKiosk: mode === 'kiosk',
    config,
    isDimmed,
    isCursorHidden,
    rotation,
    enterReport,
    enterKiosk,
    exitPresentation,
  };
}
