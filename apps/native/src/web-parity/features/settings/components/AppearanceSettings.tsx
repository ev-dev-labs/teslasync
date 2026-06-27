import {Glyph} from '../../../../components/icons/Glyph';
// Native parity port of
// web/src/features/settings/components/AppearanceSettings.tsx.
//
// `AppearanceSettings` is the Settings → Appearance glass card. It bundles eight
// stacked sections inside a single GlassPanel: a header (Palette IconBox +
// title/subtitle), the shared <ThemePicker showMode showCustom />, an
// information-density picker (with a live preview that reflows by the selected
// density), a sidebar-style picker (with miniature CSS swatches), a default
// time-format picker, a chart-palette picker (with colour swatches), a
// status-bar toggle group, an achievement-celebration toggle group, and a
// product-tours replay/reset block.
//
// Every state name + data flow is preserved verbatim: `settings` /
// `saveSettings` (useSettings / useSaveSettings), the partial-merge save pattern
// `saveSettings.mutate({ ...settings, <field>: next })` against the full-replace
// PUT /settings endpoint, the `density` / `timeFormat` / `chartPalette` derived
// values with their `?? 'comfortable' | 'relative' | 'cb_safe'` defaults, the
// `setDensity` / `setTimeFormat` / `setChartPalette` `if (!settings || next ===
// current) return` guards, the `statusBarPrefs` / `celebrationPrefs` /
// `sidebarStyle` client-side preference reads, and every `t(key, 'English')`
// i18n key + fallback. The `SidebarStyleSwatch` helper and the three choice
// arrays (`densityChoices`, `timeFormatChoices`, `chartPaletteChoices`,
// `sidebarStyleChoices`) are ported 1:1.
//
// Web modules with no native-parity surface are mapped per the conversion
// contract (rules 4-7), each documented in the parity sidecar:
//   - react-i18next `useTranslation('settings')` (L1) -> a local key-preserving
//     shim returning the inline English fallback (apps/native lacks
//     react-i18next; the established motion / ActiveOrdersSection precedent).
//   - `@/components/ui` GlassPanel/Button/Toggle (L2): GlassPanel -> the shared
//     native GlassPanel; every choice Button -> a local Pressable `ChoiceCard`
//     (active = accent border + raised surface, disabled = dimmed); Toggle -> a
//     local `ToggleRow` wrapping the RN core `Switch` (checked -> value,
//     onChange(next) -> onValueChange).
//   - `@/components/ui` IconBox color="purple" (L2) -> a local violet-tinted
//     rounded box (violetSurface fill + violetBorder ring) wrapping the
//     decorative Palette glyph.
//   - `@/components/ui` ThemePicker (L2) -> a local native-safe stand-in. The web
//     ThemePicker drives the DOM ThemeProvider (CSS-variable theme engine,
//     localStorage custom colours, <input type=color>). Native has a single
//     static token theme and no ThemeProvider, so live theme/mode/custom-colour
//     switching is UNAVAILABLE; the stand-in preserves the Display Mode + Accent
//     Color section labels and renders an explicit unavailable note. See
//     `nativeAppearanceCapabilities.themeEngineAvailable`.
//   - `@/components/ui` HelpIcon (L2) -> a decorative "?" glyph (the web tooltip
//     is hover-only and browser-bound); the i18nKey/for props have no native
//     analog and are dropped.
//   - `@/components/motion` FadeIn (L3) -> the reused web-parity motion FadeIn
//     (delay 0.15s preserved).
//   - `@/components/feedback/Toast` useToast (L4) -> a local in-panel banner host
//     preserving the `info(title)` / `success(title)` contract (the
//     ActiveOrdersSection precedent).
//   - `@/api/hooks/useSettings` useSettings/useSaveSettings (L5) -> the reused
//     web-parity api/hooks/useSettings 1:1 (same GET/PUT /settings paths + the
//     same AppSettings shape incl. ui_density / time_format_default /
//     chart_palette).
//   - `@/components/layout` useStatusBarPrefs/setStatusBarPrefs (L6) -> the reused
//     native StatusBar port's in-memory store (same { enabled, iconOnly } shape).
//   - `@/hooks/useAchievementCelebrationPrefs` (L8-10) + `@/hooks/useSidebarStyle`
//     (L16-20) -> local native-safe `useSyncExternalStore` stores mirroring the
//     web logic minus localStorage + the cross-tab `storage` event (both
//     UNAVAILABLE on native; the stores are in-memory only). Defaults, the
//     stable-snapshot cache, the `set*` patch/guard semantics, and the
//     `SidebarStyle` union are preserved. See `nativeAppearanceCapabilities`.
//   - `@/lib/cn` (L11) -> dropped (RN has no className; conditional classes
//     become StyleSheet branches / style arrays).
//   - lucide-react icons (L12) Palette/CheckCircle/Rows3/PanelBottom/Trophy/
//     Clock/Eye/PlayCircle/RotateCcw/Sidebar -> decorative emoji glyphs via
//     `Glyph` (accessibility-hidden); the adjacent translated label carries the
//     meaning (the TeslaChargingSessions / ActiveOrdersSection precedent).
//   - `@/lib/colors` CHART_COLORS_CB_SAFE / CHART_COLORS_NEON (L13) -> inlined
//     native-safe copies with identical hex values (no native lib/colors port;
//     the same values are mirrored by components/charts/chartUtils CHART_COLORS /
//     NEON_COLORS).
//   - `@/lib/tourLauncher` startTour (L14) + `@/lib/tourRegistry` resetAllTours
//     (L15) -> native-safe no-ops. The web tour state machine is driven by a
//     window CustomEvent + localStorage completion flags; React Native has no DOM
//     window/localStorage, so the guided-tour engine is UNAVAILABLE. The call
//     sites are preserved (resetAllTours still fires the success toast, exactly
//     as the web does after the reset). See
//     `nativeAppearanceCapabilities.tourStateMachineAvailable`.
//
// Tailwind -> px (1 unit = 4px): p-6 -> 24, space-y-6 -> 24, space-y-3 -> 12,
// gap-3 -> 12, gap-2 -> 8, gap-1 -> 4, mb-3 -> 12, mt-2 -> 8, mt-4 -> 16,
// pt-3 -> 12, p-4 -> 16, p-3.5 -> 14, p-1.5 -> 6, rounded-xl -> 12,
// rounded-lg -> 8, rounded-md -> 6, rounded-full -> 999, text-base -> 16,
// text-sm -> 14, text-xs -> 12, text-[11px] -> 11, text-[10px] -> 10,
// h-8/w-8 -> 32, h-5/w-5 -> 20, h-4/w-4 -> 16, h-3/w-3 -> 12, h-12/w-9 -> 48x36.
// CSS vars: --text-primary -> colors.textPrimary, --text-secondary ->
// colors.textSecondary, --text-muted -> colors.textMuted, --theme-primary ->
// colors.accent, --glass-border -> colors.border, --surface-1 -> colors.surface,
// --surface-2 -> colors.surfaceRaised, --surface-3 -> colors.surfaceHover.
// No DOM-only modules, browser HTML elements, Recharts, Leaflet, or old web UI
// components are imported.

import React, {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react';
import {
  Pressable,
  StyleSheet,
  Switch,
  View,
  type StyleProp,
  type TextStyle,
} from 'react-native';

import {AppText} from '../../../../components/ui/AppText';
import {GlassPanel} from '../../../../components/ui/GlassPanel';
import {colors} from '../../../../theme/tokens';
import {useSaveSettings, useSettings} from '../../../api/hooks/useSettings';
import {FadeIn} from '../../../components/motion';
import {
  setStatusBarPrefs,
  useStatusBarPrefs,
} from '../../../components/layout/StatusBar';

type DensityId = 'compact' | 'comfortable' | 'spacious';
type TimeFormatId = 'relative' | 'absolute';
type ChartPaletteId = 'cb_safe' | 'neon';

/* ── chart palettes (inlined from @/lib/colors) ───────────────────── */
// Identical hex values to the web Okabe-Ito (CB-safe) + neon palettes; mirrored
// by components/charts/chartUtils CHART_COLORS / NEON_COLORS.
const CHART_COLORS_CB_SAFE = [
  '#0072B2',
  '#E69F00',
  '#009E73',
  '#F0E442',
  '#56B4E9',
  '#D55E00',
  '#CC79A7',
  '#4B4B4B',
] as const;

const CHART_COLORS_NEON = [
  '#00f0ff',
  '#10b981',
  '#a855f7',
  '#f59e0b',
  '#4f46e5',
  '#ef4444',
  '#ec4899',
  '#14b8a6',
] as const;

/**
 * Documents which web/browser capabilities have no native analog in this port.
 */
export const nativeAppearanceCapabilities = {
  // DOM ThemeProvider / CSS-variable theme engine + <input type=color> custom
  // colours are browser-only; native has a single static token theme.
  themeEngineAvailable: false,
  // The guided-tour state machine is driven by a window CustomEvent +
  // localStorage completion flags; neither exists on native.
  tourStateMachineAvailable: false,
  // localStorage persistence + the cross-tab `storage` event have no native
  // analog, so client-side preference stores are in-memory only.
  persistentPreferencesAvailable: false,
  crossTabSyncAvailable: false,
} as const;

/* ── i18n shim (web react-i18next `useTranslation`) ───────────────── */
// react-i18next is absent from the native deps; this returns the inline English
// copy while every call site still references the i18n key, preserving intent.
type TFunc = (key: string, fallback: string) => string;

function useTranslation(_namespace?: string): {t: TFunc} {
  return {t: (_key, fallback) => fallback};
}

/* ── useSidebarStyle (web @/hooks/useSidebarStyle) ────────────────── */
// Native-safe mirror of the web localStorage-backed store. localStorage + the
// cross-tab `storage` event are unavailable on native, so the store is in-memory
// only; the default ('linear'), the SidebarStyle union, the stable-snapshot
// cache (so useSyncExternalStore stays referentially stable), and the
// set/guard semantics are preserved verbatim.
export type SidebarStyle = 'legacy' | 'linear' | 'notion';

const DEFAULT_SIDEBAR_STYLE: SidebarStyle = 'linear';

function isSidebarStyle(value: unknown): value is SidebarStyle {
  return value === 'legacy' || value === 'linear' || value === 'notion';
}

let cachedSidebarStyle: SidebarStyle = DEFAULT_SIDEBAR_STYLE;
const sidebarListeners = new Set<() => void>();

function subscribeSidebarStyle(cb: () => void): () => void {
  sidebarListeners.add(cb);
  return () => {
    sidebarListeners.delete(cb);
  };
}

function getSidebarSnapshot(): SidebarStyle {
  return cachedSidebarStyle;
}

export function useSidebarStyle(): SidebarStyle {
  return useSyncExternalStore(
    subscribeSidebarStyle,
    getSidebarSnapshot,
    getSidebarSnapshot,
  );
}

export function setSidebarStyle(next: SidebarStyle): void {
  if (!isSidebarStyle(next) || next === cachedSidebarStyle) {
    return;
  }
  cachedSidebarStyle = next;
  for (const cb of sidebarListeners) {
    cb();
  }
}

/* ── useAchievementCelebrationPrefs (web @/hooks/...) ──────────────── */
// Native-safe mirror of the web localStorage-backed store (same in-memory-only
// caveat as the sidebar store). The four boolean prefs + their defaults, the
// serialized stable-snapshot cache, and the partial-patch `set*` semantics are
// preserved verbatim.
export interface AchievementCelebrationPrefs {
  showToasts: boolean;
  playSound: boolean;
  showOnDashboard: boolean;
  pushOnUnlock: boolean;
}

const defaultCelebrationPrefs: AchievementCelebrationPrefs = {
  showToasts: true,
  playSound: false,
  showOnDashboard: true,
  pushOnUnlock: true,
};

let cachedCelebrationPrefs: AchievementCelebrationPrefs = defaultCelebrationPrefs;
let cachedCelebrationSerialized = JSON.stringify(cachedCelebrationPrefs);
const celebrationListeners = new Set<() => void>();

function subscribeCelebration(cb: () => void): () => void {
  celebrationListeners.add(cb);
  return () => {
    celebrationListeners.delete(cb);
  };
}

function getCelebrationSnapshot(): AchievementCelebrationPrefs {
  return cachedCelebrationPrefs;
}

export function useAchievementCelebrationPrefs(): AchievementCelebrationPrefs {
  return useSyncExternalStore(
    subscribeCelebration,
    getCelebrationSnapshot,
    getCelebrationSnapshot,
  );
}

export function setAchievementCelebrationPrefs(
  patch: Partial<AchievementCelebrationPrefs>,
): void {
  const next: AchievementCelebrationPrefs = {...cachedCelebrationPrefs, ...patch};
  const serialized = JSON.stringify(next);
  if (serialized === cachedCelebrationSerialized) {
    return;
  }
  cachedCelebrationPrefs = next;
  cachedCelebrationSerialized = serialized;
  for (const cb of celebrationListeners) {
    cb();
  }
}

/* ── tour launcher / registry (native-safe no-ops) ────────────────── */
// The web tour engine fires a window CustomEvent (same-tab) + writes localStorage
// completion flags; neither exists on native, so these preserve the call sites
// without driving a tour. See nativeAppearanceCapabilities.tourStateMachineAvailable.
function startTour(_id: string): void {
  // No DOM tour state machine on native.
}

function resetAllTours(): void {
  // No localStorage tour-completion flags to clear on native.
}

/* ── Glyph (decorative lucide-icon stand-in) ──────────────────────── */
function GlyphLegacyUnused({children, style}: {children: string; style?: StyleProp<TextStyle>}) {
  return (
    <AppText accessibilityElementsHidden importantForAccessibility="no" style={style}>
      {children}
    </AppText>
  );
}

/* ── useToast (web @/components/feedback/Toast useToast) ───────────── */
// Lightweight in-panel banner host preserving the `info(title)` / `success(title)`
// contract; auto-dismisses after a few seconds.
interface ActiveToast {
  id: number;
  type: 'info' | 'success';
  title: string;
}

function useToast() {
  const [active, setActive] = useState<ActiveToast | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const seq = useRef(0);

  const show = useCallback((next: ActiveToast) => {
    if (timer.current) {
      clearTimeout(timer.current);
    }
    setActive(next);
    timer.current = setTimeout(() => setActive(null), 4500);
  }, []);

  useEffect(
    () => () => {
      if (timer.current) {
        clearTimeout(timer.current);
      }
    },
    [],
  );

  const info = useCallback(
    (title: string) => {
      seq.current += 1;
      show({id: seq.current, type: 'info', title});
    },
    [show],
  );

  const success = useCallback(
    (title: string) => {
      seq.current += 1;
      show({id: seq.current, type: 'success', title});
    },
    [show],
  );

  const node = active ? (
    <View style={styles.toastWrap}>
      <GlassPanel
        style={[
          styles.toast,
          active.type === 'success' ? styles.toastSuccess : styles.toastInfo,
        ]}>
        <AppText style={styles.toastTitle} weight="semibold">
          {active.title}
        </AppText>
      </GlassPanel>
    </View>
  ) : null;

  return {info, success, node};
}

/* ── SectionHeader (icon + uppercase label + optional help glyph) ─── */
function SectionHeader({
  glyph,
  label,
  help,
}: {
  glyph: string;
  label: string;
  help?: boolean;
}) {
  return (
    <View style={styles.sectionHeader}>
      <Glyph style={styles.sectionGlyph}>{glyph}</Glyph>
      <AppText style={styles.sectionLabel} tone="muted" weight="semibold">
        {label}
      </AppText>
      {help ? <Glyph style={styles.helpGlyph}>?</Glyph> : null}
    </View>
  );
}

/* ── ChoiceCard (native equivalent of the web option Button) ──────── */
function ChoiceCard({
  active,
  disabled,
  onPress,
  leading,
  label,
  help,
  children,
  radio,
  testID,
}: {
  active: boolean;
  disabled?: boolean;
  onPress: () => void;
  leading?: ReactNode;
  label: string;
  help: string;
  children?: ReactNode;
  radio?: boolean;
  testID?: string;
}) {
  return (
    <Pressable
      accessibilityRole={radio ? 'radio' : 'button'}
      accessibilityState={radio ? {checked: active, disabled} : {disabled}}
      disabled={disabled}
      onPress={onPress}
      testID={testID}
      style={({pressed}) => [
        styles.choiceCard,
        active ? styles.choiceCardActive : styles.choiceCardInactive,
        disabled && styles.choiceCardDisabled,
        pressed && !disabled && styles.choiceCardPressed,
      ]}>
      {leading}
      <View style={styles.choiceTextBlock}>
        <AppText style={styles.choiceLabel} weight="semibold">
          {label}
        </AppText>
        <AppText style={styles.choiceHelp} tone="muted">
          {help}
        </AppText>
        {children}
      </View>
      {active ? <Glyph style={styles.checkGlyph}>✓</Glyph> : null}
    </Pressable>
  );
}

/* ── DensitySwatch (the little stacked bars beside each density) ───── */
function DensitySwatch({id}: {id: DensityId}) {
  const bars =
    id === 'compact'
      ? [styles.densityBarThin, styles.densityBarThin, styles.densityBarThin, styles.densityBarThin]
      : id === 'comfortable'
        ? [styles.densityBarMid, styles.densityBarMid, styles.densityBarMid]
        : [styles.densityBarThick, styles.densityBarThick];
  return (
    <View accessibilityElementsHidden importantForAccessibility="no" style={styles.densitySwatch}>
      {bars.map((barStyle, i) => (
        <View key={i} style={[styles.densityBar, barStyle]} />
      ))}
    </View>
  );
}

/* ── ToggleRow (native equivalent of @/components/ui Toggle row) ───── */
function ToggleRow({
  title,
  help,
  checked,
  onChange,
  dim,
  topBorder,
}: {
  title: string;
  help: string;
  checked: boolean;
  onChange: (next: boolean) => void;
  dim?: boolean;
  topBorder?: boolean;
}) {
  return (
    <View style={[styles.toggleRow, topBorder ? styles.toggleRowBordered : null]}>
      <View style={styles.toggleTextBlock}>
        <AppText style={[styles.toggleTitle, dim ? styles.dim : null]} weight="semibold">
          {title}
        </AppText>
        <AppText style={[styles.toggleHelp, dim ? styles.dim : null]} tone="muted">
          {help}
        </AppText>
      </View>
      <Switch
        accessibilityLabel={title}
        ios_backgroundColor="#4b5563"
        onValueChange={onChange}
        thumbColor="#ffffff"
        trackColor={{false: '#4b5563', true: colors.accent}}
        value={checked}
      />
    </View>
  );
}

/* ── TourButton (native equivalent of the @/components/ui Button) ──── */
function TourButton({
  label,
  glyph,
  variant,
  onPress,
  testID,
}: {
  label: string;
  glyph?: string;
  variant: 'primary' | 'ghost' | 'danger';
  onPress: () => void;
  testID?: string;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      testID={testID}
      style={({pressed}) => [
        styles.tourButton,
        variant === 'primary'
          ? styles.tourButtonPrimary
          : variant === 'danger'
            ? styles.tourButtonDanger
            : styles.tourButtonGhost,
        pressed && styles.tourButtonPressed,
      ]}>
      {glyph ? (
        <Glyph
          style={
            variant === 'primary'
              ? styles.tourGlyphPrimary
              : variant === 'danger'
                ? styles.tourGlyphDanger
                : styles.tourGlyphGhost
          }>
          {glyph}
        </Glyph>
      ) : null}
      <AppText
        style={
          variant === 'primary'
            ? styles.tourLabelPrimary
            : variant === 'danger'
              ? styles.tourLabelDanger
              : styles.tourLabelGhost
        }
        weight="semibold">
        {label}
      </AppText>
    </Pressable>
  );
}

/* ── ThemePicker (native-safe stand-in for @/components/ui ThemePicker) ─ */
// The web ThemePicker drives the DOM ThemeProvider (CSS-variable theme engine,
// localStorage custom colours, <input type=color>). Native has a single static
// token theme and no ThemeProvider, so live theme/mode/custom-colour switching is
// UNAVAILABLE. This preserves the Display Mode + Accent Color section labels and
// renders an explicit unavailable note. See nativeAppearanceCapabilities.
function ThemePicker({
  showMode = true,
  showCustom: _showCustom = true,
}: {
  showMode?: boolean;
  showCustom?: boolean;
}) {
  const {t} = useTranslation();
  return (
    <View style={styles.themePicker}>
      {showMode ? (
        <View>
          <AppText style={styles.sectionLabel} tone="muted" weight="semibold">
            {t('theme.displayMode', 'Display Mode')}
          </AppText>
        </View>
      ) : null}
      <View>
        <AppText style={styles.sectionLabel} tone="muted" weight="semibold">
          {t('theme.accentColor', 'Accent Color')}
        </AppText>
        <View style={styles.themeUnavailable}>
          <AppText style={styles.themeUnavailableText} tone="muted">
            {t(
              'theme.nativeUnavailable',
              'Theme, display mode, and custom colors are managed by your device. Live theme switching is available in the web app.',
            )}
          </AppText>
        </View>
      </View>
    </View>
  );
}

export function AppearanceSettings() {
  const {t} = useTranslation('settings');
  const toast = useToast();

  // Density picker. Reads/writes the same `ui_density` server-side setting via
  // the partial-merge pattern because PUT /settings is full-replace, not patch.
  const {data: settings} = useSettings();
  const saveSettings = useSaveSettings();
  const density: DensityId =
    (settings?.ui_density as DensityId | undefined) ?? 'comfortable';

  // Time format default — drives <TimeStamp>'s visible body on the web.
  const timeFormat: TimeFormatId =
    (settings?.time_format_default as TimeFormatId | undefined) ?? 'relative';

  // Chart palette default — drives the reactive useChartPalette() hook on the web.
  const chartPalette: ChartPaletteId =
    (settings?.chart_palette as ChartPaletteId | undefined) ?? 'cb_safe';

  // Footer status-bar prefs — client-side (in-memory on native).
  const statusBarPrefs = useStatusBarPrefs();

  // Celebration prefs — client-side (in-memory on native).
  const celebrationPrefs = useAchievementCelebrationPrefs();

  function setDensity(next: DensityId) {
    if (!settings || next === density) {
      return;
    }
    saveSettings.mutate({...settings, ui_density: next});
  }

  function setTimeFormat(next: TimeFormatId) {
    if (!settings || next === timeFormat) {
      return;
    }
    saveSettings.mutate({...settings, time_format_default: next});
  }

  function setChartPalette(next: ChartPaletteId) {
    if (!settings || next === chartPalette) {
      return;
    }
    saveSettings.mutate({...settings, chart_palette: next});
  }

  const chartPaletteChoices: {
    id: ChartPaletteId;
    label: string;
    help: string;
    swatches: readonly string[];
  }[] = [
    {
      id: 'cb_safe',
      label: t('theme.chartPalette.cbSafe', 'Color-blind safe'),
      help: t(
        'theme.chartPalette.cbSafeHelp',
        'Okabe-Ito palette — distinguishable for all CVD types.',
      ),
      swatches: CHART_COLORS_CB_SAFE,
    },
    {
      id: 'neon',
      label: t('theme.chartPalette.neon', 'Stylistic neon'),
      help: t(
        'theme.chartPalette.neonHelp',
        'Bright cyan/magenta — best when colour vision is unimpaired.',
      ),
      swatches: CHART_COLORS_NEON,
    },
  ];

  const timeFormatChoices: {id: TimeFormatId; label: string; help: string}[] = [
    {
      id: 'relative',
      label: t('theme.timeFormat.relative', 'Relative (2h ago)'),
      help: t('theme.timeFormat.relativeHelp', 'Best for recent activity feeds'),
    },
    {
      id: 'absolute',
      label: t('theme.timeFormat.absolute', 'Absolute (Nov 12, 13:42)'),
      help: t(
        'theme.timeFormat.absoluteHelp',
        'Best for trip planning and event correlation',
      ),
    },
  ];

  const densityChoices: {id: DensityId; label: string; help: string}[] = [
    {
      id: 'compact',
      label: t('theme.density.compact', 'Compact'),
      help: t('theme.density.compactHelp', 'Tight rows — fits more on screen'),
    },
    {
      id: 'comfortable',
      label: t('theme.density.comfortable', 'Comfortable'),
      help: t('theme.density.comfortableHelp', 'Default sizing'),
    },
    {
      id: 'spacious',
      label: t('theme.density.spacious', 'Spacious'),
      help: t('theme.density.spaciousHelp', 'Roomy — easier to read at distance'),
    },
  ];

  // Sidebar style — client-side, instant (in-memory on native).
  const sidebarStyle = useSidebarStyle();
  const sidebarStyleChoices: {id: SidebarStyle; label: string; help: string}[] = [
    {
      id: 'linear',
      label: t('theme.sidebarStyle.linear', 'Minimal'),
      help: t(
        'theme.sidebarStyle.linearHelp',
        'Single column with section headers and a 2px accent bar on the active row. Recommended.',
      ),
    },
    {
      id: 'notion',
      label: t('theme.sidebarStyle.notion', 'Compact'),
      help: t(
        'theme.sidebarStyle.notionHelp',
        'Tighter rows with collapsible sections. Best for fitting many pages on screen.',
      ),
    },
    {
      id: 'legacy',
      label: t('theme.sidebarStyle.legacy', 'Classic'),
      help: t(
        'theme.sidebarStyle.legacyHelp',
        'Colorful icon tiles with a pill on the active item. The most visual option.',
      ),
    },
  ];

  const densityPreviewRowStyle =
    density === 'compact'
      ? styles.previewRowCompact
      : density === 'spacious'
        ? styles.previewRowSpacious
        : styles.previewRowComfortable;
  const densityPreviewTextStyle =
    density === 'compact'
      ? styles.previewTextCompact
      : density === 'spacious'
        ? styles.previewTextSpacious
        : styles.previewTextComfortable;

  const previewRows = [
    t('theme.density.previewRow1', 'Sample row — Tesla Model 3'),
    t('theme.density.previewRow2', 'Sample row — Tesla Model Y'),
    t('theme.density.previewRow3', 'Sample row — Tesla Model S'),
  ];

  return (
    <>
      <FadeIn delay={0.15}>
        <GlassPanel style={styles.panel}>
          {/* Header */}
          <View style={styles.headerRow}>
            <View style={styles.iconBox}>
              <Glyph style={styles.iconBoxGlyph}>🎨</Glyph>
            </View>
            <View style={styles.headerTitleBlock}>
              <AppText style={styles.title} weight="semibold">
                {t('theme.title', 'Appearance')}
              </AppText>
              <AppText style={styles.subtitle} tone="muted">
                {t('theme.subtitle', 'Customize colors and display mode')}
              </AppText>
            </View>
          </View>

          {/* Shared ThemePicker (native-safe stand-in) */}
          <ThemePicker showMode showCustom />

          {/* Density (information density) */}
          <View style={styles.section}>
            <SectionHeader glyph="≣" label={t('theme.density.label', 'Information density')} help />
            <View style={styles.choiceGrid}>
              {densityChoices.map(choice => (
                <ChoiceCard
                  key={choice.id}
                  active={density === choice.id}
                  disabled={!settings || saveSettings.isPending}
                  onPress={() => setDensity(choice.id)}
                  leading={<DensitySwatch id={choice.id} />}
                  label={choice.label}
                  help={choice.help}
                />
              ))}
            </View>
            <AppText style={styles.sectionHelp} tone="muted">
              {t(
                'theme.density.help',
                'Affects table rows, cards, and dashboard widgets across the app.',
              )}
            </AppText>

            {/* Live preview — reflows by the selected density. */}
            <View style={styles.preview}>
              <View style={styles.previewHeader}>
                <AppText style={styles.previewTitle} tone="secondary" weight="semibold">
                  {t('theme.density.previewTitle', 'Preview')}
                </AppText>
              </View>
              <View>
                {previewRows.map((row, i) => (
                  <View
                    key={i}
                    style={[
                      styles.previewRow,
                      densityPreviewRowStyle,
                      i > 0 ? styles.previewRowDivider : null,
                    ]}>
                    <AppText style={[styles.previewText, densityPreviewTextStyle]}>{row}</AppText>
                  </View>
                ))}
              </View>
            </View>
          </View>

          {/* Sidebar style */}
          <View style={styles.section} testID="settings-sidebar-style">
            <SectionHeader glyph="▥" label={t('theme.sidebarStyle.label', 'Sidebar style')} />
            <View
              accessibilityRole="radiogroup"
              accessibilityLabel={t('theme.sidebarStyle.label', 'Sidebar style')}
              style={styles.choiceGrid}>
              {sidebarStyleChoices.map(choice => (
                <ChoiceCard
                  key={choice.id}
                  radio
                  active={sidebarStyle === choice.id}
                  onPress={() => setSidebarStyle(choice.id)}
                  leading={<SidebarStyleSwatch style={choice.id} />}
                  label={choice.label}
                  help={choice.help}
                  testID={`sidebar-style-${choice.id}`}
                />
              ))}
            </View>
            <AppText style={styles.sectionHelp} tone="muted">
              {t(
                'theme.sidebarStyle.help',
                'Applies instantly. Saved per device — your other devices keep their own choice.',
              )}
            </AppText>
          </View>

          {/* Time format default */}
          <View style={styles.section}>
            <SectionHeader glyph="🕑" label={t('theme.timeFormat.label', 'Default time format')} help />
            <View style={styles.choiceGrid}>
              {timeFormatChoices.map(choice => (
                <ChoiceCard
                  key={choice.id}
                  active={timeFormat === choice.id}
                  disabled={!settings || saveSettings.isPending}
                  onPress={() => setTimeFormat(choice.id)}
                  label={choice.label}
                  help={choice.help}
                />
              ))}
            </View>
            <AppText style={styles.sectionHelp} tone="muted">
              {t(
                'theme.timeFormat.help',
                'Hover any timestamp to see the alternate format. Override per-surface with the format prop where needed.',
              )}
            </AppText>
          </View>

          {/* Chart palette */}
          <View style={styles.section}>
            <SectionHeader glyph="👁" label={t('theme.chartPalette.label', 'Chart palette')} help />
            <View
              accessibilityRole="radiogroup"
              accessibilityLabel={t('theme.chartPalette.label', 'Chart palette')}
              style={styles.choiceGrid}>
              {chartPaletteChoices.map(choice => (
                <ChoiceCard
                  key={choice.id}
                  radio
                  active={chartPalette === choice.id}
                  disabled={!settings || saveSettings.isPending}
                  onPress={() => setChartPalette(choice.id)}
                  label={choice.label}
                  help={choice.help}>
                  <View style={styles.swatchRow}>
                    {choice.swatches.map((hex, i) => (
                      <View
                        key={`${choice.id}-${i}`}
                        style={[styles.paletteSwatch, {backgroundColor: hex}]}
                      />
                    ))}
                  </View>
                </ChoiceCard>
              ))}
            </View>
            <AppText style={styles.sectionHelp} tone="muted">
              {t(
                'theme.chartPalette.help',
                'Defaults to the Okabe-Ito palette so series remain distinguishable for the ~8% of users with red-green colour vision deficiency.',
              )}
            </AppText>
          </View>

          {/* Footer status bar */}
          <View style={styles.section}>
            <SectionHeader glyph="▭" label={t('theme.statusBar.label', 'Status bar')} />
            <View style={styles.toggleGroup}>
              <ToggleRow
                title={t('theme.statusBar.show', 'Show status bar')}
                help={t(
                  'theme.statusBar.showHelp',
                  'Always-on footer with API health, live telemetry, vehicle, and version.',
                )}
                checked={statusBarPrefs.enabled}
                onChange={next => {
                  setStatusBarPrefs({enabled: next});
                  toast.info(
                    next
                      ? t('theme.statusBar.shownToast', 'Status bar shown')
                      : t('theme.statusBar.hiddenToast', 'Status bar hidden'),
                  );
                }}
              />
              <ToggleRow
                topBorder
                dim={!statusBarPrefs.enabled}
                title={t('theme.statusBar.iconOnly', 'Always icon-only')}
                help={t(
                  'theme.statusBar.iconOnlyHelp',
                  'Hide labels at all widths. Otherwise the bar auto-collapses on narrow screens.',
                )}
                checked={statusBarPrefs.iconOnly}
                onChange={next => setStatusBarPrefs({iconOnly: next})}
              />
            </View>
          </View>

          {/* Achievement celebrations */}
          <View style={styles.section}>
            <SectionHeader glyph="🏆" label={t('achievements.celebrationSettings', 'Celebration')} />
            <View style={styles.toggleGroup}>
              <ToggleRow
                title={t('achievements.showToasts', 'Show celebration toasts')}
                help={t(
                  'achievements.showToastsHelp',
                  'Pop a celebratory toast with confetti when you unlock an achievement.',
                )}
                checked={celebrationPrefs.showToasts}
                onChange={next => setAchievementCelebrationPrefs({showToasts: next})}
              />
              <ToggleRow
                topBorder
                title={t('achievements.playSound', 'Play sound on unlock')}
                help={t(
                  'achievements.playSoundHelp',
                  'Play a short chime alongside the celebration toast. Off by default.',
                )}
                checked={celebrationPrefs.playSound}
                onChange={next => setAchievementCelebrationPrefs({playSound: next})}
              />
              <ToggleRow
                topBorder
                title={t('achievements.showOnDashboard', 'Show recently unlocked on dashboard')}
                help={t(
                  'achievements.showOnDashboardHelp',
                  "Surface your latest unlocks in the dashboard's recently-unlocked widget.",
                )}
                checked={celebrationPrefs.showOnDashboard}
                onChange={next => setAchievementCelebrationPrefs({showOnDashboard: next})}
              />
              <ToggleRow
                topBorder
                title={t('achievements.pushOnUnlock', 'Send push notifications for achievements')}
                help={t(
                  'achievements.pushOnUnlockHelp',
                  'Deliver a web push notification when an achievement unlocks while the tab is closed.',
                )}
                checked={celebrationPrefs.pushOnUnlock}
                onChange={next => setAchievementCelebrationPrefs({pushOnUnlock: next})}
              />
            </View>
          </View>

          {/* Product tours — replay or reset onboarding tours */}
          <View style={styles.section} testID="product-tours-section">
            <SectionHeader glyph="▶" label={t('settings.tours.label', 'Product tours')} />
            <View style={styles.toursCard}>
              <View style={styles.toursTextBlock}>
                <AppText style={styles.toggleTitle} weight="semibold">
                  {t('settings.tours.title', 'Product tours')}
                </AppText>
                <AppText style={styles.toggleHelp} tone="muted">
                  {t(
                    'settings.tours.body',
                    'Re-run the guided walkthroughs that introduce major sections.',
                  )}
                </AppText>
              </View>
              <View style={styles.toursButtonRow}>
                <TourButton
                  variant="primary"
                  glyph="▶"
                  label={t('settings.tours.replayMain', 'Replay dashboard tour')}
                  onPress={() => startTour('main')}
                  testID="replay-tour-main"
                />
                <TourButton
                  variant="ghost"
                  label={t('settings.tours.replayDebugger', 'Debugger tour')}
                  onPress={() => startTour('debugger')}
                  testID="replay-tour-debugger"
                />
                <TourButton
                  variant="ghost"
                  label={t('settings.tours.replayAutomations', 'Automations tour')}
                  onPress={() => startTour('automations')}
                  testID="replay-tour-automations"
                />
                <TourButton
                  variant="danger"
                  glyph="↺"
                  label={t('settings.tours.resetAll', 'Reset all tours')}
                  onPress={() => {
                    resetAllTours();
                    toast.success(
                      t(
                        'settings.tours.resetDone',
                        'All tours reset — they will play next time you open the matching page',
                      ),
                    );
                  }}
                  testID="reset-all-tours"
                />
              </View>
            </View>
          </View>
        </GlassPanel>
      </FadeIn>
      {toast.node}
    </>
  );
}

/**
 * SidebarStyleSwatch — miniature visual preview rendered next to each
 * sidebar-style choice. Pure View bars (no real navigation) communicating the
 * silhouette: accent bar (linear) vs subtle-bg active row (notion) vs colored
 * icon tiles (legacy).
 */
function SidebarStyleSwatch({style}: {style: SidebarStyle}) {
  return (
    <View accessibilityElementsHidden importantForAccessibility="no" style={styles.sbSwatch}>
      {style === 'linear' ? (
        <>
          <View style={styles.sbRowMuted} />
          <View style={styles.sbActiveLinearRow}>
            <View style={styles.sbAccentBar} />
            <View style={styles.sbRowPrimary} />
          </View>
          <View style={styles.sbRowMutedShort} />
        </>
      ) : null}
      {style === 'notion' ? (
        <>
          <View style={styles.sbNotionRow}>
            <View style={styles.sbDotMuted} />
            <View style={styles.sbRowMutedFlex} />
          </View>
          <View style={styles.sbNotionRowActive}>
            <View style={styles.sbDotPrimary} />
            <View style={styles.sbRowPrimaryFlex} />
          </View>
          <View style={styles.sbNotionRow}>
            <View style={styles.sbDotMuted} />
            <View style={styles.sbRowMutedFlex} />
          </View>
          <View style={styles.sbNotionRow}>
            <View style={styles.sbDotMuted} />
            <View style={styles.sbRowMutedFlex} />
          </View>
        </>
      ) : null}
      {style === 'legacy' ? (
        <>
          <View style={styles.sbLegacyRow}>
            <View style={styles.sbTileCyan} />
            <View style={styles.sbRowPrimaryFlex} />
          </View>
          <View style={styles.sbLegacyRow}>
            <View style={styles.sbTileViolet} />
            <View style={styles.sbRowMutedFlex} />
          </View>
          <View style={styles.sbLegacyRow}>
            <View style={styles.sbTileEmerald} />
            <View style={styles.sbRowMutedFlex} />
          </View>
        </>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  panel: {
    padding: 24, // p-6
    gap: 24, // space-y-6
  },
  // Header
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12, // gap-3
  },
  iconBox: {
    width: 40,
    height: 40,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.violetSurface, // IconBox color="purple"
    borderWidth: 1,
    borderColor: colors.violetBorder,
  },
  iconBoxGlyph: {
    fontSize: 18,
    lineHeight: 22,
  },
  headerTitleBlock: {
    flexShrink: 1,
  },
  title: {
    fontSize: 16, // text-base
    lineHeight: 22,
    color: colors.textPrimary,
  },
  subtitle: {
    fontSize: 12, // text-xs
    lineHeight: 16,
  },
  // Section scaffolding
  section: {
    gap: 0,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8, // gap-2
    marginBottom: 12, // mb-3
  },
  sectionGlyph: {
    fontSize: 14,
    lineHeight: 18,
    color: colors.textMuted,
  },
  sectionLabel: {
    fontSize: 12, // text-xs uppercase tracking-wider
    lineHeight: 16,
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  helpGlyph: {
    fontSize: 11,
    lineHeight: 14,
    color: colors.textMuted,
  },
  sectionHelp: {
    marginTop: 8, // mt-2
    fontSize: 12,
    lineHeight: 16,
  },
  // Choice grid + card
  choiceGrid: {
    gap: 12, // grid gap-3 (mobile-first single column)
  },
  choiceCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12, // gap-3
    borderRadius: 12, // rounded-xl
    borderWidth: 1,
    padding: 14, // p-3.5
  },
  choiceCardActive: {
    borderColor: colors.accent, // border-[var(--theme-primary)]
    backgroundColor: colors.surfaceHover, // bg-[var(--surface-3)]
  },
  choiceCardInactive: {
    borderColor: colors.border, // border-[var(--glass-border)]
    backgroundColor: colors.surfaceRaised, // bg-[var(--surface-2)]
  },
  choiceCardDisabled: {
    opacity: 0.55, // disabled:opacity-50
  },
  choiceCardPressed: {
    opacity: 0.85,
  },
  choiceTextBlock: {
    flexShrink: 1,
    flexGrow: 1,
    minWidth: 0,
  },
  choiceLabel: {
    fontSize: 14, // text-sm
    lineHeight: 20,
    color: colors.textPrimary,
  },
  choiceHelp: {
    fontSize: 11, // text-[11px]
    lineHeight: 15,
  },
  checkGlyph: {
    fontSize: 16, // h-4 w-4
    lineHeight: 20,
    color: colors.accent,
  },
  // Density swatch (stacked bars)
  densitySwatch: {
    width: 32, // h-8 w-8
    height: 32,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface, // bg-[var(--surface-1)]
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
  },
  densityBar: {
    width: 16, // w-4
    borderRadius: 2,
    backgroundColor: colors.textMuted,
  },
  densityBarThin: {
    height: 2,
  },
  densityBarMid: {
    height: 3,
  },
  densityBarThick: {
    height: 5,
  },
  // Density preview
  preview: {
    marginTop: 16, // mt-4
    borderRadius: 8, // rounded-lg
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceRaised, // bg-[var(--surface-2)]
    overflow: 'hidden',
  },
  previewHeader: {
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    backgroundColor: colors.surfaceHover, // bg-[var(--surface-3)]
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  previewTitle: {
    fontSize: 14,
    lineHeight: 18,
  },
  previewRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
  },
  previewRowDivider: {
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  previewRowCompact: {
    minHeight: 28,
    paddingVertical: 4,
  },
  previewRowComfortable: {
    minHeight: 36,
    paddingVertical: 8,
  },
  previewRowSpacious: {
    minHeight: 44,
    paddingVertical: 12,
  },
  previewText: {
    color: colors.textPrimary,
  },
  previewTextCompact: {
    fontSize: 12,
    lineHeight: 16,
  },
  previewTextComfortable: {
    fontSize: 14,
    lineHeight: 18,
  },
  previewTextSpacious: {
    fontSize: 16,
    lineHeight: 22,
  },
  // Chart palette swatches
  swatchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 8,
  },
  paletteSwatch: {
    width: 12, // h-3 w-3
    height: 12,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.border,
  },
  // Toggle group / rows
  toggleGroup: {
    borderRadius: 12, // rounded-xl
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceRaised, // bg-[var(--surface-2)]
    padding: 16, // p-4
    gap: 12, // space-y-3
  },
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 16, // gap-4
  },
  toggleRowBordered: {
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingTop: 12, // pt-3
  },
  toggleTextBlock: {
    flexShrink: 1,
    flexGrow: 1,
    minWidth: 0,
  },
  toggleTitle: {
    fontSize: 14, // text-sm
    lineHeight: 20,
    color: colors.textPrimary,
  },
  toggleHelp: {
    fontSize: 12, // text-xs
    lineHeight: 16,
  },
  dim: {
    opacity: 0.5, // opacity-50
  },
  // Product tours
  toursCard: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceRaised,
    padding: 16,
    gap: 12,
  },
  toursTextBlock: {
    gap: 2,
  },
  toursButtonRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8, // gap-2
  },
  tourButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderWidth: 1,
  },
  tourButtonPrimary: {
    backgroundColor: colors.accent,
    borderColor: colors.accent,
  },
  tourButtonGhost: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
  },
  tourButtonDanger: {
    backgroundColor: colors.dangerSurface,
    borderColor: colors.dangerBorder,
  },
  tourButtonPressed: {
    opacity: 0.82,
  },
  tourGlyphPrimary: {
    fontSize: 14,
    lineHeight: 18,
    color: colors.background,
  },
  tourGlyphGhost: {
    fontSize: 14,
    lineHeight: 18,
    color: colors.textPrimary,
  },
  tourGlyphDanger: {
    fontSize: 14,
    lineHeight: 18,
    color: colors.danger,
  },
  tourLabelPrimary: {
    fontSize: 13,
    lineHeight: 18,
    color: colors.background,
  },
  tourLabelGhost: {
    fontSize: 13,
    lineHeight: 18,
    color: colors.textPrimary,
  },
  tourLabelDanger: {
    fontSize: 13,
    lineHeight: 18,
    color: colors.danger,
  },
  // ThemePicker stand-in
  themePicker: {
    gap: 16,
  },
  themeUnavailable: {
    marginTop: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceRaised,
    padding: 16,
  },
  themeUnavailableText: {
    fontSize: 12,
    lineHeight: 17,
  },
  // Sidebar style swatch
  sbSwatch: {
    width: 36, // w-9
    height: 48, // h-12
    borderRadius: 6, // rounded-md
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface, // bg-[var(--surface-1)]
    padding: 6, // p-1.5
    gap: 4, // gap-1
  },
  sbRowMuted: {
    height: 4,
    width: '100%',
    borderRadius: 2,
    backgroundColor: 'rgba(148, 163, 184, 0.3)',
  },
  sbRowMutedShort: {
    height: 4,
    width: '75%',
    borderRadius: 2,
    backgroundColor: 'rgba(148, 163, 184, 0.3)',
  },
  sbActiveLinearRow: {
    flexDirection: 'row',
    alignItems: 'center',
    height: 4,
  },
  sbAccentBar: {
    width: 2,
    height: 8,
    borderRadius: 999,
    backgroundColor: colors.accent,
    marginRight: 2,
  },
  sbRowPrimary: {
    flex: 1,
    height: 4,
    borderRadius: 2,
    backgroundColor: 'rgba(248, 250, 252, 0.8)',
  },
  sbNotionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    height: 4,
  },
  sbNotionRowActive: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    height: 4,
    borderRadius: 2,
    paddingHorizontal: 2,
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
  },
  sbDotMuted: {
    width: 4,
    height: 4,
    borderRadius: 999,
    backgroundColor: 'rgba(148, 163, 184, 0.6)',
  },
  sbDotPrimary: {
    width: 4,
    height: 4,
    borderRadius: 999,
    backgroundColor: colors.textPrimary,
  },
  sbRowMutedFlex: {
    flex: 1,
    height: 4,
    borderRadius: 2,
    backgroundColor: 'rgba(148, 163, 184, 0.3)',
  },
  sbRowPrimaryFlex: {
    flex: 1,
    height: 4,
    borderRadius: 2,
    backgroundColor: 'rgba(248, 250, 252, 0.8)',
  },
  sbLegacyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    height: 8,
  },
  sbTileCyan: {
    width: 8,
    height: 8,
    borderRadius: 2,
    backgroundColor: 'rgba(34, 211, 238, 0.7)',
    borderWidth: 1,
    borderColor: 'rgba(34, 211, 238, 0.3)',
  },
  sbTileViolet: {
    width: 8,
    height: 8,
    borderRadius: 2,
    backgroundColor: 'rgba(167, 139, 250, 0.7)',
    borderWidth: 1,
    borderColor: 'rgba(167, 139, 250, 0.3)',
  },
  sbTileEmerald: {
    width: 8,
    height: 8,
    borderRadius: 2,
    backgroundColor: 'rgba(52, 211, 153, 0.7)',
    borderWidth: 1,
    borderColor: 'rgba(52, 211, 153, 0.3)',
  },
  // Toast banner
  toastWrap: {
    marginTop: 12,
  },
  toast: {
    paddingVertical: 12,
    paddingHorizontal: 16,
  },
  toastInfo: {
    borderColor: colors.borderAccent,
  },
  toastSuccess: {
    borderColor: colors.successBorder,
  },
  toastTitle: {
    fontSize: 14,
    lineHeight: 20,
    color: colors.textPrimary,
  },
});

export default AppearanceSettings;
