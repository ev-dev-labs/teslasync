// Native parity port of web/src/components/ui/ThemePicker.tsx.
//
// The web `ThemePicker` is the single source of truth for the theme + display
// mode + custom-colour UI, used by the Appearance settings page, the top-bar
// quick-switcher popover (`compact`, `showCustom={false}`) and the first-run
// dashboard banner. It renders (a) an optional Display Mode grid of `ghost`
// <Button>s — each a preview tile with a lucide mode glyph in a tinted box, the
// mode name, a 4-chip surface-swatch strip and a CheckCircle when selected —
// and (b) an Accent Color grid of `ghost` <Button>s — each a primary/accent
// gradient dot + name + corner CheckCircle — plus an optional "Custom" tile and,
// when the custom theme is active, two `<Input type="color">` editors (Primary /
// Accent) showing live hex. Every pick fires `setTheme`/`setMode`/
// `setCustomColors` on the `useTheme()` context, a `toast.info`, and the
// `onChange`/`onModeChange` callbacks. It is reproduced here with React Native
// primitives:
//
//   - The DOM `<div>`s become `View`s; the `ghost` <Button> tiles reuse the
//     already-ported native ./Button (variant="ghost", size="auto"), with the
//     Tailwind tile chrome (border/bg/radius/padding/layout) supplied via the
//     native `style` prop merged LAST so it wins over Button's base styles
//     (the same "last className wins" precedence cn() gave). The web `onClick`
//     is expressed as RN `onPress`.
//   - ./ThemeProvider is NOT yet ported to native parity, so `useTheme()` plus
//     `ThemeId`/`ModeId`/`ColorTheme`/`ModeTheme` are reproduced here as a
//     native-safe in-process theme store: the `themes`/`modes` data tables are
//     ported VERBATIM (every id/name/colour) from ThemeProvider, and a tiny
//     `useSyncExternalStore`-backed store provides `themeId`/`modeId`/
//     `setTheme`/`setMode`/`setCustomColors`/`themes`/`modes` so taps actually
//     update the selection across mounted pickers (mirroring the web context).
//     The web's localStorage seeding, backend `/settings` persistence, cross-tab
//     `broadcast`/`subscribe`, `window.matchMedia` auto-mode and `document`
//     CSS-var application are all browser-only and have no native analog — they
//     are dropped; the store is in-memory only (documented in the sidecar). The
//     CSS-var look (`--surface-2/3`, `--glass-border`, `--text-*`,
//     `--theme-primary`) is reproduced by reading the SELECTED mode's surfaces
//     from the store (the native analog of the vars applied to :root), with
//     `auto` resolving to the dark mode since system detection is unavailable.
//   - The two web `useState` values seeded from `localStorage` (customPrimary /
//     customAccent) are replaced by reading the store's live `custom` theme
//     entry (the same source of truth the provider exposes) — there is no
//     localStorage and, without a colour picker, nothing drives local input
//     state. The state NAMES are preserved as derived consts.
//   - ./Input `type="color"` has no core-RN analog (no colour picker without an
//     extra dependency), so each editor renders a read-only colour swatch (the
//     same coloured square a browser draws for `<input type=color>`) plus the
//     live hex string — the `setCustomPrimary`/`setCustomAccent` + `handleCustom`
//     onChange path is unavailable and dropped (documented). The custom colours
//     are still applied via the "Custom" tile, which calls the SAME
//     `handleCustom(customPrimary, customAccent)`.
//   - lucide-react glyphs (Sun/Moon/Monitor/Sparkles/CheckCircle) -> decorative
//     Unicode glyphs (☀ ☾ ▢ ✦ ✓) in `AppText` (`importantForAccessibility="no"`),
//     the same approach the Lightbox/DataTableBulkBar ports took; the mode name
//     and the tile's `accessibilityLabel` carry the accessible meaning.
//   - The CSS `linear-gradient(135deg, primary, accent)` accent dot -> a circular
//     two-tone swatch (left half primary, right half accent) since core RN has no
//     gradient; the selected-state `box-shadow` glow has no RN analog and is
//     dropped — selection is already conveyed by the tile border + CheckCircle
//     exactly as the web also set the border to the primary colour.
//   - react-i18next `useTranslation` is unavailable in native parity; a local
//     `useNativeTranslationFallback()` t() shim returns the English fallback copy
//     verbatim, preserving every i18n key. `useToast()` is unavailable; a local
//     `useNativeToast()` shim surfaces `toast.info(message)` via `Alert.alert`,
//     the established native feedback primitive (see api/hooks/_toastHelpers.ts).
//   - `cn()`/Tailwind class strings are dropped; the `compact` density is
//     preserved as the section gap (space-y-4 16 / space-y-6 24). The web's
//     responsive `sm:`/`lg:` grid escalation (2->4 modes, 2->3->6 themes) has no
//     native breakpoint analog; the mobile BASE of 2 columns is used for both
//     grids (documented). The web `className` is retained on props for source
//     compatibility (ignored on native) and replaced by a `style` prop merged
//     last onto the outer container.

import React, {useCallback, useMemo, useSyncExternalStore} from 'react';
import {
  Alert,
  StyleSheet,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import {AppText} from '../../../components/ui/AppText';
import {Button} from './Button';

// ---------------------------------------------------------------------------
// Theme types + data — ported VERBATIM from web/src/components/ui/ThemeProvider
// (the not-yet-ported native dependency of this picker).
// ---------------------------------------------------------------------------

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

const DEFAULT_CUSTOM_PRIMARY = '#00b4d8';
const DEFAULT_CUSTOM_ACCENT = '#e63946';

function hexToRGB(hex: string): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `${r}, ${g}, ${b}`;
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

const BASE_THEMES: Record<Exclude<ThemeId, 'custom'>, ColorTheme> = {
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
};

const MODES: Record<ModeId, ModeTheme> = {
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

// ---------------------------------------------------------------------------
// Native-safe in-process theme store (stands in for the unported ThemeProvider
// React context). In-memory only: no localStorage, no backend `/settings`, no
// cross-tab broadcast and no system-preference auto mode — all browser-only.
// ---------------------------------------------------------------------------

interface ThemeStoreSnapshot {
  themeId: ThemeId;
  modeId: ModeId;
  customPrimary: string;
  customAccent: string;
}

let snapshot: ThemeStoreSnapshot = {
  themeId: 'neon-cyan',
  modeId: 'dark',
  customPrimary: DEFAULT_CUSTOM_PRIMARY,
  customAccent: DEFAULT_CUSTOM_ACCENT,
};

const listeners = new Set<() => void>();

function emit(): void {
  listeners.forEach(listener => listener());
}

function subscribeToStore(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getStoreSnapshot(): ThemeStoreSnapshot {
  return snapshot;
}

function storeSetTheme(id: ThemeId): void {
  snapshot = {...snapshot, themeId: id};
  emit();
}

function storeSetMode(id: ModeId): void {
  snapshot = {...snapshot, modeId: id};
  emit();
}

function storeSetCustomColors(primary: string, accent: string): void {
  snapshot = {
    ...snapshot,
    themeId: 'custom',
    customPrimary: primary,
    customAccent: accent,
  };
  emit();
}

interface ThemeContextValue {
  themeId: ThemeId;
  modeId: ModeId;
  theme: ColorTheme;
  mode: ModeTheme;
  setTheme: (id: ThemeId) => void;
  setMode: (id: ModeId) => void;
  setCustomColors: (primary: string, accent: string) => void;
  themes: Record<ThemeId, ColorTheme>;
  modes: Record<ModeId, ModeTheme>;
}

/**
 * Native-safe analog of the web ThemeProvider's `useTheme()`. Subscribes to the
 * in-process store so every mounted picker re-renders on a theme/mode change,
 * mirroring the shared React context the web used.
 */
export function useTheme(): ThemeContextValue {
  const snap = useSyncExternalStore(
    subscribeToStore,
    getStoreSnapshot,
    getStoreSnapshot,
  );
  const themes = useMemo<Record<ThemeId, ColorTheme>>(
    () => ({
      ...BASE_THEMES,
      custom: buildCustomTheme(snap.customPrimary, snap.customAccent),
    }),
    [snap.customPrimary, snap.customAccent],
  );
  const theme = themes[snap.themeId];
  // `auto` resolves to dark — system colour-scheme detection is browser-only.
  const mode = MODES[snap.modeId === 'auto' ? 'dark' : snap.modeId];
  return {
    themeId: snap.themeId,
    modeId: snap.modeId,
    theme,
    mode,
    setTheme: storeSetTheme,
    setMode: storeSetMode,
    setCustomColors: storeSetCustomColors,
    themes,
    modes: MODES,
  };
}

// ---------------------------------------------------------------------------
// react-i18next + Toast shims (unavailable in native parity).
// ---------------------------------------------------------------------------

type NativeTFunction = (key: string, fallback: string) => string;

// react-i18next is unavailable in native parity; this shim returns the English
// fallback copy verbatim while preserving the i18n keys.
function useNativeTranslationFallback(): NativeTFunction {
  return useCallback((_key, fallback) => fallback, []);
}

interface NativeToast {
  info: (message: string) => void;
}

// useToast() is unavailable in native parity; the transient web toast becomes an
// `Alert.alert`, the established native feedback primitive (_toastHelpers.ts).
function useNativeToast(): NativeToast {
  return useMemo(
    () => ({
      info: (message: string) => {
        Alert.alert(message);
      },
    }),
    [],
  );
}

// ---------------------------------------------------------------------------
// lucide-react glyphs -> decorative Unicode (mode preview icons + check mark).
// ---------------------------------------------------------------------------

const CHECK_GLYPH = '\u2713'; // ✓  (lucide CheckCircle)

const modeGlyphs: Record<string, string> = {
  dark: '\u263E', // ☾  Moon
  light: '\u2600', // ☀  Sun
  oled: '\u25A2', // ▢  Monitor
  midnight: '\u2726', // ✦  Sparkles
  auto: '\u25A2', // ▢  Monitor
  sunset: '\u2600', // ☀  Sun
  nord: '\u2726', // ✦  Sparkles
};

// ---------------------------------------------------------------------------
// ThemePicker
// ---------------------------------------------------------------------------

export interface ThemePickerProps {
  /** Render the mode (light/dark/oled/etc.) selector. Default true. */
  showMode?: boolean;
  /** Render the custom-colour builder. Default true. */
  showCustom?: boolean;
  /** Compact layout — denser spacing — for popover use. */
  compact?: boolean;
  /** Optional callback fired after the user picks any theme. */
  onChange?: (themeId: ThemeId) => void;
  /** Optional callback fired after the user picks any mode. */
  onModeChange?: (modeId: ModeId) => void;
  /** Web Tailwind override; retained for source compatibility, ignored on native. */
  className?: string;
  /** Native replacement for the web `className`; merged last so callers win. */
  style?: StyleProp<ViewStyle>;
  /** Native test id for the outer container. */
  testID?: string;
}

/** Circular two-tone swatch — the native analog of the web's primary/accent
 * `linear-gradient(135deg, …)` accent dot (core RN has no gradient). */
function ThemeSwatch({primary, accent}: {primary: string; accent: string}) {
  return (
    <View style={styles.swatchDot}>
      <View style={[styles.swatchHalf, {backgroundColor: primary}]} />
      <View style={[styles.swatchHalf, {backgroundColor: accent}]} />
    </View>
  );
}

export function ThemePicker({
  showMode = true,
  showCustom = true,
  compact = false,
  onChange,
  onModeChange,
  className: _className,
  style,
  testID,
}: ThemePickerProps) {
  const t = useNativeTranslationFallback();
  const toast = useNativeToast();
  const {
    themeId,
    modeId,
    setTheme,
    setMode,
    setCustomColors,
    themes: allThemes,
    modes: allModes,
  } = useTheme();

  // The web seeded these from localStorage and mutated them via <input
  // type=color>; native has neither, so they are read from the store's live
  // `custom` theme entry (the same source of truth the provider exposes).
  const customPrimary = allThemes.custom?.primary ?? DEFAULT_CUSTOM_PRIMARY;
  const customAccent = allThemes.custom?.accent ?? DEFAULT_CUSTOM_ACCENT;

  const handleTheme = (id: ThemeId, name: string) => {
    setTheme(id);
    toast.info(`${t('theme.theme', 'Theme')}: ${name}`);
    onChange?.(id);
  };

  const handleMode = (id: ModeId, name: string) => {
    setMode(id);
    toast.info(`${t('theme.mode', 'Mode')}: ${name}`);
    onModeChange?.(id);
  };

  const handleCustom = (primary: string, accent: string) => {
    setCustomColors(primary, accent);
    onChange?.('custom');
  };

  // `compact` density -> section gap (space-y-4 16 / space-y-6 24). The web's
  // responsive grid escalation has no native breakpoint analog; both grids use
  // the mobile base of 2 columns.
  const sectionSpacing = compact ? 16 : 24;

  // CSS-var look: reproduce `--surface-*`/`--glass-border`/`--text-*` from the
  // selected mode's surfaces (`auto` -> dark, system detection unavailable).
  const activeMode = allModes[modeId === 'auto' ? 'dark' : modeId];
  // `--theme-primary` is the active colour theme's primary.
  const themePrimary = allThemes[themeId].primary;

  return (
    <View style={[{gap: sectionSpacing}, style]} testID={testID}>
      {showMode && (
        <View style={styles.section}>
          <AppText
            style={[styles.sectionLabel, {color: activeMode.textMuted}]}>
            {t('theme.displayMode', 'Display Mode')}
          </AppText>
          <View style={styles.grid}>
            {Object.values(allModes).map(m => {
              const selected = modeId === m.id;
              return (
                <Button
                  key={m.id}
                  variant="ghost"
                  size="auto"
                  onPress={() => handleMode(m.id, m.name)}
                  accessibilityLabel={m.name}
                  accessibilityState={{selected}}
                  testID={`theme-picker-mode-${m.id}`}
                  style={[
                    styles.tile,
                    styles.modeTile,
                    {
                      backgroundColor: selected
                        ? activeMode.surface3
                        : activeMode.surface2,
                      borderColor: selected
                        ? themePrimary
                        : activeMode.glassBorder,
                    },
                  ]}>
                  <View
                    style={[
                      styles.modeIconBox,
                      {
                        backgroundColor: m.surface3,
                        borderColor: m.glassBorder,
                      },
                    ]}>
                    <AppText
                      importantForAccessibility="no"
                      style={[styles.modeGlyph, {color: m.textPrimary}]}>
                      {modeGlyphs[m.id]}
                    </AppText>
                  </View>
                  <View style={styles.modeTextCol}>
                    <AppText
                      style={[styles.modeName, {color: activeMode.textPrimary}]}>
                      {m.name}
                    </AppText>
                    <View style={styles.modeSwatchRow}>
                      {[m.bg, m.surface1, m.surface2, m.surface3].map((c, i) => (
                        <View
                          key={i}
                          style={[
                            styles.modeSwatch,
                            {
                              backgroundColor: c,
                              borderColor: activeMode.glassBorder,
                            },
                          ]}
                        />
                      ))}
                    </View>
                  </View>
                  {selected && (
                    <AppText
                      importantForAccessibility="no"
                      style={[styles.modeCheck, {color: themePrimary}]}>
                      {CHECK_GLYPH}
                    </AppText>
                  )}
                </Button>
              );
            })}
          </View>
        </View>
      )}

      <View style={styles.section}>
        <AppText style={[styles.sectionLabel, {color: activeMode.textMuted}]}>
          {t('theme.accentColor', 'Accent Color')}
        </AppText>
        <View style={styles.grid}>
          {Object.values(allThemes)
            .filter(thm => thm.id !== 'custom')
            .map(thm => {
              const selected = themeId === thm.id;
              return (
                <Button
                  key={thm.id}
                  variant="ghost"
                  size="auto"
                  onPress={() => handleTheme(thm.id, thm.name)}
                  accessibilityLabel={thm.name}
                  accessibilityState={{selected}}
                  testID={`theme-picker-theme-${thm.id}`}
                  style={[
                    styles.tile,
                    styles.themeTile,
                    {
                      backgroundColor: selected
                        ? activeMode.surface3
                        : activeMode.surface2,
                      borderColor: selected
                        ? thm.primary
                        : activeMode.glassBorder,
                    },
                  ]}>
                  <ThemeSwatch primary={thm.primary} accent={thm.accent} />
                  <AppText
                    style={[styles.themeName, {color: activeMode.textPrimary}]}>
                    {thm.name}
                  </AppText>
                  {selected && (
                    <AppText
                      importantForAccessibility="no"
                      style={[styles.themeCheck, {color: thm.primary}]}>
                      {CHECK_GLYPH}
                    </AppText>
                  )}
                </Button>
              );
            })}

          {showCustom && (
            <Button
              variant="ghost"
              size="auto"
              onPress={() => {
                handleCustom(customPrimary, customAccent);
                toast.info(
                  `${t('theme.theme', 'Theme')}: ${t('theme.custom', 'Custom')}`,
                );
              }}
              accessibilityLabel={t('theme.custom', 'Custom')}
              accessibilityState={{selected: themeId === 'custom'}}
              testID="theme-picker-theme-custom"
              style={[
                styles.tile,
                styles.themeTile,
                {
                  backgroundColor:
                    themeId === 'custom'
                      ? activeMode.surface3
                      : activeMode.surface2,
                  borderColor:
                    themeId === 'custom'
                      ? customPrimary
                      : activeMode.glassBorder,
                },
              ]}>
              <ThemeSwatch primary={customPrimary} accent={customAccent} />
              <AppText
                style={[styles.themeName, {color: activeMode.textPrimary}]}>
                {t('theme.custom', 'Custom')}
              </AppText>
              {themeId === 'custom' && (
                <AppText
                  importantForAccessibility="no"
                  style={[styles.themeCheck, {color: customPrimary}]}>
                  {CHECK_GLYPH}
                </AppText>
              )}
            </Button>
          )}
        </View>

        {showCustom && themeId === 'custom' && (
          <View
            style={[
              styles.customEditor,
              {
                backgroundColor: activeMode.surface2,
                borderColor: activeMode.glassBorder,
              },
            ]}>
            <View style={styles.customRow}>
              <AppText
                style={[
                  styles.customLabel,
                  {color: activeMode.textSecondary},
                ]}>
                {t('theme.primary', 'Primary')}
              </AppText>
              {/* `<Input type="color">` has no core-RN analog — read-only swatch + hex. */}
              <View
                style={[
                  styles.colorSwatch,
                  {
                    backgroundColor: customPrimary,
                    borderColor: activeMode.glassBorder,
                  },
                ]}
              />
              <AppText
                style={[styles.customHex, {color: activeMode.textMuted}]}>
                {customPrimary}
              </AppText>
            </View>
            <View style={styles.customRow}>
              <AppText
                style={[
                  styles.customLabel,
                  {color: activeMode.textSecondary},
                ]}>
                {t('theme.accent', 'Accent')}
              </AppText>
              <View
                style={[
                  styles.colorSwatch,
                  {
                    backgroundColor: customAccent,
                    borderColor: activeMode.glassBorder,
                  },
                ]}
              />
              <AppText
                style={[styles.customHex, {color: activeMode.textMuted}]}>
                {customAccent}
              </AppText>
            </View>
          </View>
        )}
      </View>
    </View>
  );
}

ThemePicker.displayName = 'ThemePicker';

const styles = StyleSheet.create({
  section: {
    gap: 12,
  },
  sectionLabel: {
    fontSize: 12,
    fontWeight: '500',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
  },
  // Two-up mobile base (the web grids' smallest breakpoint).
  tile: {
    flexBasis: '47%',
    flexGrow: 1,
    borderRadius: 12,
    borderWidth: 1,
  },
  modeTile: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-start',
    gap: 12,
    padding: 14,
  },
  modeIconBox: {
    width: 32,
    height: 32,
    borderRadius: 8,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modeGlyph: {
    fontSize: 16,
    lineHeight: 18,
  },
  modeTextCol: {
    flexShrink: 1,
  },
  modeName: {
    fontSize: 14,
    fontWeight: '500',
  },
  modeSwatchRow: {
    flexDirection: 'row',
    gap: 4,
    marginTop: 4,
  },
  modeSwatch: {
    width: 16,
    height: 8,
    borderRadius: 2,
    borderWidth: 1,
  },
  modeCheck: {
    marginLeft: 'auto',
    fontSize: 16,
    fontWeight: '700',
  },
  themeTile: {
    flexDirection: 'column',
    alignItems: 'flex-start',
    justifyContent: 'flex-start',
    gap: 12,
    padding: 16,
  },
  swatchDot: {
    width: 24,
    height: 24,
    borderRadius: 12,
    overflow: 'hidden',
    flexDirection: 'row',
  },
  swatchHalf: {
    flex: 1,
  },
  themeName: {
    fontSize: 12,
    fontWeight: '500',
  },
  themeCheck: {
    position: 'absolute',
    top: 10,
    right: 10,
    fontSize: 16,
    fontWeight: '700',
  },
  customEditor: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 24,
    marginTop: 16,
    padding: 16,
    borderRadius: 12,
    borderWidth: 1,
  },
  customRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  customLabel: {
    fontSize: 12,
    fontWeight: '500',
  },
  colorSwatch: {
    width: 40,
    height: 32,
    borderRadius: 8,
    borderWidth: 1,
  },
  customHex: {
    fontSize: 10,
    fontFamily: 'monospace',
  },
});
