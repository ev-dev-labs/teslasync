// Native parity port of web/src/components/ui/ThemeProvider.tsx.
//
// The web module is the app-wide theme context: it owns the selected color
// theme (`ThemeId`) + display mode (`ModeId`), resolves `'auto'` against the
// system color scheme, persists the choice locally + to the backend, applies
// the palette as CSS custom properties, and mirrors changes from peer tabs.
// Every theme/mode palette, the `ThemeId`/`ModeId`/`ColorTheme`/`ModeTheme`
// shapes, the `hexToRGB` helper, the state names (`themeId`, `modeId`,
// `customColors`, `initialized`, `systemDark`), the `useTheme` guard, the
// backend settings sync, and the `setTheme`/`setMode`/`setCustomColors` API are
// preserved verbatim.
//
// DOM/web-only pieces and their native mappings:
//   - `localStorage` (theme/mode/custom-color persistence) has no React Native
//     analog and no storage dependency is installed here, so the four keys
//     (`teslasync-theme`, `teslasync-mode`, `teslasync-custom-primary`,
//     `teslasync-custom-accent`) are backed by a native-safe in-memory store
//     that mirrors the getItem/setItem string contract. Cross-restart
//     persistence is therefore UNAVAILABLE on native (documented in the
//     sidecar); within a session the read/write behavior is identical.
//   - `applyThemeCSS` writes `--theme-*`/`--surface-*`/`--text-*` custom
//     properties + a dark/light `<html>` class + a `<body>` background on
//     `document`. React Native has no document, global stylesheet, or CSS
//     custom properties; native consumers read the resolved palette from
//     `useTheme()` instead, so the function records the active palette in a
//     process-global (exposed via `getActiveNativeTheme`) rather than touching
//     the DOM.
//   - `window.matchMedia('(prefers-color-scheme: dark)')` (the `'auto'` mode
//     resolver) maps to the React Native `Appearance` API
//     (`getColorScheme()` + `addChangeListener`), preserving the `systemDark`
//     state and its live update on system theme changes.
//   - `@/lib/broadcast` (`BroadcastChannel`/`localStorage` cross-tab bus) is
//     browser-only. Native is a single JS runtime with no tabs, so it is
//     replaced by a native-safe in-process bus that preserves the
//     `theme.changed`/`theme.customColors` message contract and the web's
//     self-filtering (an emitter never receives its own message). With a single
//     ThemeProvider the cross-tab mirror is effectively inert, exactly as the
//     web "mirror changes from OTHER tabs" intent collapses on a single device.
//   - `getApiBase` (`@/lib/resilience`) + `request` (`@/api/client`) resolve to
//     the native `web-parity/api/client` equivalents; the first-mount settings
//     load keeps the web's deliberate raw `fetch` (it runs before auth context).

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {Appearance} from 'react-native';

import {getApiBase, request} from '../../api/client';

export type ThemeId =
  | 'neon-cyan'
  | 'tesla-red'
  | 'matrix-green'
  | 'royal-purple'
  | 'solar-amber'
  | 'custom';
export type ModeId =
  | 'dark'
  | 'light'
  | 'oled'
  | 'midnight'
  | 'auto'
  | 'sunset'
  | 'nord';

export interface ColorTheme {
  id: ThemeId;
  name: string;
  primary: string;
  primaryRGB: string;
  accent: string;
  accentRGB: string;
}

export interface ModeTheme {
  id: ModeId;
  name: string;
  bg: string;
  surface1: string;
  surface2: string;
  surface3: string;
  glassBg: string;
  glassBorder: string;
  textPrimary: string;
  textSecondary: string;
  textMuted: string;
  colorScheme: 'dark' | 'light';
}

// --- Native-safe replacement for the web `localStorage` persistence layer.
// No web storage / AsyncStorage dependency is installed, so the four theme keys
// live in an in-process Map that mirrors the getItem/setItem string contract.
// Values do NOT survive an app restart (persistence unavailable on native);
// within a session reads/writes behave exactly like the web localStorage path.
const themeStore = new Map<string, string>();

function readStored(key: string): string | null {
  return themeStore.get(key) ?? null;
}

function writeStored(key: string, value: string): void {
  themeStore.set(key, value);
}

function hexToRGB(hex: string): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `${r}, ${g}, ${b}`;
}

const defaultCustomPrimary = '#00b4d8';
const defaultCustomAccent = '#e63946';

function loadCustomColors(): {primary: string; accent: string} {
  const p = readStored('teslasync-custom-primary') || defaultCustomPrimary;
  const a = readStored('teslasync-custom-accent') || defaultCustomAccent;
  return {primary: p, accent: a};
}

function buildCustomTheme(primary: string, accent: string): ColorTheme {
  return {
    id: 'custom',
    name: 'Custom',
    primary,
    primaryRGB: hexToRGB(primary),
    accent,
    accentRGB: hexToRGB(accent),
  };
}

const themes: Record<ThemeId, ColorTheme> = {
  'neon-cyan': {
    id: 'neon-cyan',
    name: 'Neon Cyan',
    primary: '#00f0ff',
    primaryRGB: '0, 240, 255',
    accent: '#4f46e5',
    accentRGB: '79, 70, 229',
  },
  'tesla-red': {
    id: 'tesla-red',
    name: 'Tesla Red',
    primary: '#e31937',
    primaryRGB: '227, 25, 55',
    accent: '#ff4060',
    accentRGB: '255, 64, 96',
  },
  'matrix-green': {
    id: 'matrix-green',
    name: 'Matrix Green',
    primary: '#00ff41',
    primaryRGB: '0, 255, 65',
    accent: '#10b981',
    accentRGB: '16, 185, 129',
  },
  'royal-purple': {
    id: 'royal-purple',
    name: 'Royal Purple',
    primary: '#a855f7',
    primaryRGB: '168, 85, 247',
    accent: '#7c3aed',
    accentRGB: '124, 58, 237',
  },
  'solar-amber': {
    id: 'solar-amber',
    name: 'Solar Amber',
    primary: '#f59e0b',
    primaryRGB: '245, 158, 11',
    accent: '#d97706',
    accentRGB: '217, 119, 6',
  },
  custom: buildCustomTheme(
    loadCustomColors().primary,
    loadCustomColors().accent,
  ),
};

const modes: Record<ModeId, ModeTheme> = {
  dark: {
    id: 'dark',
    name: 'Dark',
    bg: '#0a0a0f',
    surface1: '#0f1019',
    surface2: '#151621',
    surface3: '#1a1b2e',
    glassBg: 'rgba(255, 255, 255, 0.04)',
    glassBorder: 'rgba(255, 255, 255, 0.08)',
    textPrimary: '#ffffff',
    textSecondary: '#9ca3af',
    textMuted: '#6b7280',
    colorScheme: 'dark',
  },
  light: {
    id: 'light',
    name: 'Light',
    bg: '#f8fafc',
    surface1: '#ffffff',
    surface2: '#f1f5f9',
    surface3: '#e2e8f0',
    glassBg: 'rgba(255, 255, 255, 0.8)',
    glassBorder: 'rgba(0, 0, 0, 0.08)',
    textPrimary: '#0f172a',
    textSecondary: '#475569',
    textMuted: '#94a3b8',
    colorScheme: 'light',
  },
  oled: {
    id: 'oled',
    name: 'OLED Black',
    bg: '#000000',
    surface1: '#050505',
    surface2: '#0a0a0a',
    surface3: '#111111',
    glassBg: 'rgba(255, 255, 255, 0.03)',
    glassBorder: 'rgba(255, 255, 255, 0.05)',
    textPrimary: '#ffffff',
    textSecondary: '#9ca3af',
    textMuted: '#6b7280',
    colorScheme: 'dark',
  },
  midnight: {
    id: 'midnight',
    name: 'Midnight Blue',
    bg: '#0a0e1a',
    surface1: '#0f1425',
    surface2: '#141a30',
    surface3: '#1a2240',
    glassBg: 'rgba(100, 150, 255, 0.04)',
    glassBorder: 'rgba(100, 150, 255, 0.08)',
    textPrimary: '#e0e7ff',
    textSecondary: '#94a3c8',
    textMuted: '#6875a0',
    colorScheme: 'dark',
  },
  auto: {
    id: 'auto',
    name: 'Auto (System)',
    bg: '#0a0a0f',
    surface1: '#0f1019',
    surface2: '#151621',
    surface3: '#1a1b2e',
    glassBg: 'rgba(255, 255, 255, 0.04)',
    glassBorder: 'rgba(255, 255, 255, 0.08)',
    textPrimary: '#ffffff',
    textSecondary: '#9ca3af',
    textMuted: '#6b7280',
    colorScheme: 'dark',
  },
  sunset: {
    id: 'sunset',
    name: 'Sunset',
    bg: '#1a0e0a',
    surface1: '#241410',
    surface2: '#2e1a14',
    surface3: '#3a221a',
    glassBg: 'rgba(255, 160, 100, 0.04)',
    glassBorder: 'rgba(255, 160, 100, 0.10)',
    textPrimary: '#fff0e0',
    textSecondary: '#c8a894',
    textMuted: '#a07860',
    colorScheme: 'dark',
  },
  nord: {
    id: 'nord',
    name: 'Nord',
    bg: '#2e3440',
    surface1: '#3b4252',
    surface2: '#434c5e',
    surface3: '#4c566a',
    glassBg: 'rgba(136, 192, 208, 0.04)',
    glassBorder: 'rgba(136, 192, 208, 0.10)',
    textPrimary: '#eceff4',
    textSecondary: '#d8dee9',
    textMuted: '#81a1c1',
    colorScheme: 'dark',
  },
};

interface ThemeContextValue {
  themeId: ThemeId;
  modeId: ModeId;
  theme: ColorTheme;
  mode: ModeTheme;
  setTheme: (id: ThemeId) => void;
  setMode: (id: ModeId) => void;
  setCustomColors: (primary: string, accent: string) => void;
  themes: typeof themes;
  modes: typeof modes;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) {
    throw new Error('useTheme must be used within ThemeProvider');
  }
  return ctx;
}

// --- Native applied-theme registry. The web `applyThemeCSS` repaints by
// writing CSS custom properties + a dark/light class on `document` and a
// `<body>` background. React Native has no DOM, so the resolved palette reaches
// consumers through `useTheme()` context; this records the active selection in
// a process-global so debugging/telemetry can observe what would have been
// "applied", mirroring how the web records it on `documentElement`.
let activeNativeTheme: {theme: ColorTheme; mode: ModeTheme} | null = null;

/** Native-only affordance: the palette most recently passed to applyThemeCSS. */
export function getActiveNativeTheme(): {
  theme: ColorTheme;
  mode: ModeTheme;
} | null {
  return activeNativeTheme;
}

function applyThemeCSS(theme: ColorTheme, mode: ModeTheme) {
  // No DOM on native — see the header note. Record the active palette so it can
  // be inspected; consumers read the live values from useTheme() context.
  activeNativeTheme = {theme, mode};
}

// --- Native-safe in-process replacement for the web cross-tab broadcast bus.
// Preserves the two theme message shapes and the web's self-filtering (an
// emitter never receives its own message). A native app is a single JS runtime
// with no peer tabs, so with one ThemeProvider this mirror is inert; the API is
// kept so the logic stays a faithful parity of the web subscribe/broadcast.
type ThemeBroadcastMessage =
  | {type: 'theme.changed'; themeId: string; modeId: string}
  | {type: 'theme.customColors'; primary: string; accent: string};

type ThemeBroadcastListener = (
  msg: ThemeBroadcastMessage,
  from: number,
) => void;

const themeBusListeners = new Set<ThemeBroadcastListener>();
let nextThemeBusSource = 1;

function allocateThemeBusSource(): number {
  const source = nextThemeBusSource;
  nextThemeBusSource += 1;
  return source;
}

function broadcastTheme(from: number, msg: ThemeBroadcastMessage): void {
  themeBusListeners.forEach(listener => {
    listener(msg, from);
  });
}

function subscribeTheme(
  source: number,
  handler: (msg: ThemeBroadcastMessage) => void,
): () => void {
  const listener: ThemeBroadcastListener = (msg, from) => {
    if (from === source) {
      return;
    }
    handler(msg);
  };
  themeBusListeners.add(listener);
  return () => {
    themeBusListeners.delete(listener);
  };
}

interface BackendThemeSettings {
  theme?: string;
  mode?: string;
  custom_primary?: string;
  custom_accent?: string;
}

export function ThemeProvider({children}: {children: ReactNode}) {
  const [themeId, setThemeId] = useState<ThemeId>(() => {
    const saved = readStored('teslasync-theme');
    return saved && saved in themes ? (saved as ThemeId) : 'neon-cyan';
  });

  const [modeId, setModeId] = useState<ModeId>(() => {
    const saved = readStored('teslasync-mode');
    return saved && saved in modes ? (saved as ModeId) : 'dark';
  });

  const [customColors, setCustomColorsState] = useState(loadCustomColors);
  const [initialized, setInitialized] = useState(false);

  // Stable per-instance bus source so this provider never reacts to its own
  // broadcasts (the native analog of the web TAB_ID self-filter).
  const busSourceRef = useRef<number | null>(null);
  if (busSourceRef.current === null) {
    busSourceRef.current = allocateThemeBusSource();
  }
  const busSource = busSourceRef.current;
  const broadcast = useCallback(
    (msg: ThemeBroadcastMessage) => {
      broadcastTheme(busSource, msg);
    },
    [busSource],
  );

  // Load theme from backend settings on first mount.
  // Uses raw fetch intentionally — ThemeProvider mounts before auth context
  // is available, so request() (which handles 401 token refresh) may not work.
  useEffect(() => {
    fetch(`${getApiBase()}/api/v1/settings`)
      .then(r => (r.ok ? r.json() : null))
      .then((settings: BackendThemeSettings | null) => {
        if (!settings) {
          return;
        }
        if (settings.theme && settings.theme in themes) {
          setThemeId(settings.theme as ThemeId);
          writeStored('teslasync-theme', settings.theme);
        }
        if (settings.mode && settings.mode in modes) {
          setModeId(settings.mode as ModeId);
          writeStored('teslasync-mode', settings.mode);
        }
        if (settings.custom_primary && settings.custom_accent) {
          setCustomColorsState({
            primary: settings.custom_primary,
            accent: settings.custom_accent,
          });
          writeStored('teslasync-custom-primary', settings.custom_primary);
          writeStored('teslasync-custom-accent', settings.custom_accent);
        }
      })
      .catch(() => {})
      .finally(() => setInitialized(true));
  }, []);

  const currentThemes = {
    ...themes,
    custom: buildCustomTheme(customColors.primary, customColors.accent),
  };
  const theme = currentThemes[themeId];

  // Auto mode: resolve to light or dark based on system preference
  const [systemDark, setSystemDark] = useState(
    () => Appearance.getColorScheme() === 'dark',
  );
  useEffect(() => {
    const subscription = Appearance.addChangeListener(({colorScheme}) => {
      setSystemDark(colorScheme === 'dark');
    });
    return () => subscription.remove();
  }, []);

  const resolvedMode =
    modeId === 'auto' ? (systemDark ? modes.dark : modes.light) : modes[modeId];
  const mode = resolvedMode;

  useEffect(() => {
    applyThemeCSS(theme, mode);
    writeStored('teslasync-theme', themeId);
    writeStored('teslasync-mode', modeId);
  }, [theme, mode, themeId, modeId]);

  // Persist theme changes to backend (fire-and-forget)
  const saveThemeToBackend = useCallback(
    (t: ThemeId, m: ModeId, cp: string, ca: string) => {
      if (!initialized) {
        return;
      }
      request<Record<string, unknown>>('/settings')
        .then(current => {
          if (!current) {
            return;
          }
          request('/settings', {
            method: 'PUT',
            body: JSON.stringify({
              ...current,
              theme: t,
              mode: m,
              custom_primary: cp,
              custom_accent: ca,
            }),
          }).catch(() => {});
        })
        .catch(() => {});
    },
    [initialized],
  );

  const setTheme = (id: ThemeId) => {
    setThemeId(id);
    saveThemeToBackend(id, modeId, customColors.primary, customColors.accent);
    broadcast({type: 'theme.changed', themeId: id, modeId});
  };
  const setMode = (id: ModeId) => {
    setModeId(id);
    saveThemeToBackend(themeId, id, customColors.primary, customColors.accent);
    broadcast({type: 'theme.changed', themeId, modeId: id});
  };

  const setCustomColors = (primary: string, accent: string) => {
    writeStored('teslasync-custom-primary', primary);
    writeStored('teslasync-custom-accent', accent);
    setCustomColorsState({primary, accent});
    setThemeId('custom');
    saveThemeToBackend('custom', modeId, primary, accent);
    broadcast({type: 'theme.customColors', primary, accent});
    broadcast({type: 'theme.changed', themeId: 'custom', modeId});
  };

  // Cross-tab theme sync: mirror changes from other tabs without rebroadcasting
  // or re-persisting, which would loop and duplicate backend writes.
  const themesRef = useRef(themes);
  const modesRef = useRef(modes);
  themesRef.current = themes;
  modesRef.current = modes;
  useEffect(() => {
    return subscribeTheme(busSource, m => {
      if (m.type === 'theme.changed') {
        if (m.themeId in themesRef.current) {
          setThemeId(m.themeId as ThemeId);
        }
        if (m.modeId in modesRef.current) {
          setModeId(m.modeId as ModeId);
        }
      } else if (m.type === 'theme.customColors') {
        setCustomColorsState({primary: m.primary, accent: m.accent});
      }
    });
  }, [busSource]);

  return (
    <ThemeContext.Provider
      value={{
        themeId,
        modeId,
        theme,
        mode,
        setTheme,
        setMode,
        setCustomColors,
        themes: currentThemes,
        modes,
      }}>
      {children}
    </ThemeContext.Provider>
  );
}
