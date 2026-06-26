// Native parity port of
// web/src/features/telemetry/components/SignalCompareControls.tsx.
//
// SignalCompareControls is the pure controls surface for the signal-diff
// workflow: two timestamp windows (A/B), five quick datetime presets, a free
// text filter, and eight category-prefix toggle chips. It does NO data fetching
// and renders NO diff table — it only lifts state to the parent through the
// onChangeA/onChangeB/onSearchChange/onCategoryChange callbacks. The exported
// CATEGORY_PREFIXES, DIFF_PRESETS, DiffPresetId, toLocalDatetimeInput, and
// isoOrEmpty helpers are preserved verbatim so the (future) native
// SignalDiffPage / SignalsWorkspacePage can drive their server-side filter
// strings exactly like the web pages do.
//
// Web -> native mapping (behaviour / state / prop names / keys preserved):
//   - `react-i18next` `useTranslation` (web L14) -> the inline native-safe
//     `useNativeTranslation` t(key, fallback) hook (there is no i18n runtime in
//     the parity tree). It honours BOTH call shapes used by the source:
//     t(key, 'String fallback') AND t(key, { defaultValue }); every i18n key +
//     English fallback string is copied verbatim, so i18n intent is intact.
//   - `@/components/ui` `GlassPanel` (web L16) -> the native GlassPanel
//     primitive; the web `p-4 sm:p-5 space-y-4` padding + vertical rhythm is
//     reproduced via styles.panel (padding 20, gap 16).
//   - `@/components/ui` `Button` (web L16) -> the inline native `ControlButton`
//     (Pressable + AppText) reproducing the web Button's `secondary` (preset)
//     and `ghost` (clear) variants at `size="sm"` (h-8 px-3 text-xs). No DOM
//     <button> reaches native (rule 4).
//   - `@/components/ui` `Input` (web L16) -> React Native <TextInput>. The web
//     `type="datetime-local"` picker is a browser-only control with no RN /
//     installed-library analog; it degrades to a native-safe editable text
//     field that accepts the SAME `YYYY-MM-DDTHH:MM` local-datetime string the
//     parent already stores (toLocalDatetimeInput output / isoOrEmpty input), so
//     the value/onChange contract and the preset buttons keep working. The
//     `type="search"` filter maps to a TextInput with returnKeyType="search".
//     `onChange={(e)=>fn(e.target.value)}` -> `onChangeText={fn}` (RN already
//     delivers the raw string). See the .parity.json sidecar + the
//     DATETIME_UNAVAILABLE note for the documented browser-only degradation.
//   - `@/components/ui` `HelpTooltip` (web L16) -> the already-ported native
//     parity `HelpIcon`; the web `i18nKey` / `defaultValue` / `ariaLabel` props
//     map to HelpIcon's `i18nKey` / `content` / `ariaLabel` (placement default
//     'top' == HelpIcon `side` default 'top'). Same help keys + fallbacks.
//   - `@/components/motion` `FadeIn` (framer-motion) (web L17) -> the inline RN
//     `FadeIn` (Animated fade + slide-up, reduced-motion aware via
//     AccessibilityInfo — the native `prefers-reduced-motion` equivalent).
//   - `@/lib/cn` (web L18) is a Tailwind class-merge helper with no native
//     analog; the consumer `className` prop is retained for source/API parity
//     (ignored on native) and a `style` escape hatch is exposed instead.
// No DOM / Recharts / Leaflet / framer-motion / lucide / old web-ui import
// reaches the native output. See the .parity.json sidecar for the per-line map.

import React, {useCallback, useEffect, useRef} from 'react';
import {
  AccessibilityInfo,
  Animated,
  Easing,
  Pressable,
  StyleSheet,
  TextInput,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import {AppText} from '../../../../components/ui/AppText';
import {GlassPanel} from '../../../../components/ui/GlassPanel';
import {colors, spacing} from '../../../../theme/tokens';
import {HelpIcon} from '../../../components/ui/HelpIcon';

// ---- Tailwind-equivalent colour literals (documented one-offs) --------------
// Window labels: text-cyan-300 / text-amber-300.
const CYAN_300 = '#67e8f9';
const AMBER_300 = '#fcd34d';
// Selected category chip: border-blue-400/40 + bg-blue-500/15 + text-blue-200.
const BLUE_BORDER_40 = 'rgba(96, 165, 250, 0.4)';
const BLUE_BG_15 = 'rgba(59, 130, 246, 0.15)';
const BLUE_200 = '#bfdbfe';
// Web Button `secondary` dark variant: bg-gray-700 + text-gray-100.
const GRAY_700 = '#374151';
const GRAY_100 = '#f3f4f6';

// Native-safe degradation marker for the browser-only datetime-local picker.
const DATETIME_UNAVAILABLE =
  'Native build has no datetime-local picker; edit the YYYY-MM-DDTHH:MM value directly or use a preset.';

// ---- Native-safe i18n (web react-i18next useTranslation) --------------------
// Honours both source call shapes: t(key, 'fallback') and t(key, { defaultValue }).

type TranslateFallback = string | {defaultValue?: string};
type NativeTFunction = (key: string, fallback?: TranslateFallback) => string;

function useNativeTranslation(): NativeTFunction {
  return useCallback((_key, fallback) => {
    if (typeof fallback === 'string') {
      return fallback;
    }
    return fallback?.defaultValue ?? '';
  }, []);
}

// ---- Inline FadeIn (web @/components/motion FadeIn, framer-motion) -----------
// Animated fade + slide-up that collapses to a no-op when the user has requested
// reduced motion (children appear in their final state immediately).

const FADE_DURATION_MS = 400;
const FADE_TRANSLATE_Y = 8;

function FadeIn({
  children,
  style,
}: {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
}): React.ReactElement {
  const progress = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    let cancelled = false;
    AccessibilityInfo.isReduceMotionEnabled()
      .then(reduce => {
        if (cancelled) {
          return;
        }
        if (reduce) {
          progress.setValue(1);
          return;
        }
        Animated.timing(progress, {
          duration: FADE_DURATION_MS,
          easing: Easing.out(Easing.ease),
          toValue: 1,
          useNativeDriver: true,
        }).start();
      })
      .catch(() => progress.setValue(1));
    return () => {
      cancelled = true;
    };
  }, [progress]);

  return (
    <Animated.View
      style={[
        {
          opacity: progress,
          transform: [
            {
              translateY: progress.interpolate({
                inputRange: [0, 1],
                outputRange: [FADE_TRANSLATE_Y, 0],
              }),
            },
          ],
        },
        style,
      ]}>
      {children}
    </Animated.View>
  );
}

FadeIn.displayName = 'FadeIn';

// ---- ControlButton (web @/components/ui Button, secondary/ghost @ size sm) ---

function ControlButton({
  label,
  onPress,
  variant,
  testID,
}: {
  label: string;
  onPress: () => void;
  variant: 'secondary' | 'ghost';
  testID?: string;
}): React.ReactElement {
  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="button"
      onPress={onPress}
      style={({pressed}) => [
        styles.button,
        variant === 'secondary' ? styles.buttonSecondary : styles.buttonGhost,
        pressed && styles.pressed,
      ]}
      testID={testID}>
      <AppText
        style={
          variant === 'secondary'
            ? styles.buttonSecondaryText
            : styles.buttonGhostText
        }
        weight="semibold">
        {label}
      </AppText>
    </Pressable>
  );
}

ControlButton.displayName = 'ControlButton';

export const CATEGORY_PREFIXES: Array<{
  id: string;
  labelKey: string;
  defaultLabel: string;
  matches: (name: string) => boolean;
}> = [
  {
    id: 'battery',
    labelKey: 'signalDiff.cat.battery',
    defaultLabel: 'Battery',
    matches: n => /battery|charge|soc|range|kwh/i.test(n),
  },
  {
    id: 'drive',
    labelKey: 'signalDiff.cat.drive',
    defaultLabel: 'Drive',
    matches: n => /speed|odometer|gear|drive|brake|throttle|steering/i.test(n),
  },
  {
    id: 'climate',
    labelKey: 'signalDiff.cat.climate',
    defaultLabel: 'Climate',
    matches: n => /climate|hvac|cabin|seat|temp/i.test(n),
  },
  {
    id: 'security',
    labelKey: 'signalDiff.cat.security',
    defaultLabel: 'Security',
    matches: n => /lock|sentry|alarm|valet|guard/i.test(n),
  },
  {
    id: 'motor',
    labelKey: 'signalDiff.cat.motor',
    defaultLabel: 'Motor',
    matches: n => /motor|inverter|torque|rpm/i.test(n),
  },
  {
    id: 'tire',
    labelKey: 'signalDiff.cat.tire',
    defaultLabel: 'Tire',
    matches: n => /tpms|tire|pressure/i.test(n),
  },
  {
    id: 'media',
    labelKey: 'signalDiff.cat.media',
    defaultLabel: 'Media',
    matches: n => /media|audio|volume|playback/i.test(n),
  },
  {
    id: 'safety',
    labelKey: 'signalDiff.cat.safety',
    defaultLabel: 'Safety',
    matches: n => /airbag|seatbelt|fcw|aeb|safety/i.test(n),
  },
];

export type DiffPresetId =
  | 'now-vs-1h'
  | 'now-vs-1d'
  | 'last-drive'
  | 'before-after-charge'
  | 'today-vs-yesterday';

interface DiffPreset {
  id: DiffPresetId;
  labelKey: string;
  defaultLabel: string;
  compute: () => {atA: Date; atB: Date};
}

export const DIFF_PRESETS: DiffPreset[] = [
  {
    id: 'now-vs-1h',
    labelKey: 'signalDiff.preset.nowVs1h',
    defaultLabel: 'Now vs 1h ago',
    compute: () => {
      const n = new Date();
      return {atA: new Date(n.getTime() - 3600 * 1000), atB: n};
    },
  },
  {
    id: 'now-vs-1d',
    labelKey: 'signalDiff.preset.nowVs1d',
    defaultLabel: 'Now vs 1 day ago',
    compute: () => {
      const n = new Date();
      return {atA: new Date(n.getTime() - 86400 * 1000), atB: n};
    },
  },
  {
    id: 'before-after-charge',
    labelKey: 'signalDiff.preset.beforeAfterCharge',
    defaultLabel: 'Before vs after last charge',
    compute: () => {
      const n = new Date();
      return {atA: new Date(n.getTime() - 4 * 3600 * 1000), atB: n};
    },
  },
  {
    id: 'last-drive',
    labelKey: 'signalDiff.preset.lastDrive',
    defaultLabel: 'Last drive start vs end',
    compute: () => {
      const n = new Date();
      return {
        atA: new Date(n.getTime() - 90 * 60 * 1000),
        atB: new Date(n.getTime() - 5 * 60 * 1000),
      };
    },
  },
  {
    id: 'today-vs-yesterday',
    labelKey: 'signalDiff.preset.todayVsYesterday',
    defaultLabel: 'Today vs yesterday (same time)',
    compute: () => {
      const n = new Date();
      return {atA: new Date(n.getTime() - 86400 * 1000), atB: n};
    },
  },
];

export function toLocalDatetimeInput(date: Date): string {
  const pad = (n: number) => n.toString().padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(
    date.getDate(),
  )}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function isoOrEmpty(localValue: string): string {
  if (!localValue) {
    return '';
  }
  const d = new Date(localValue);
  return Number.isNaN(d.getTime()) ? '' : d.toISOString();
}

export interface SignalCompareControlsProps {
  atA: string;
  atB: string;
  onChangeA: (value: string) => void;
  onChangeB: (value: string) => void;
  search: string;
  onSearchChange: (value: string) => void;
  category: string | null;
  onCategoryChange: (next: string | null) => void;
  /** Slot rendered on the row above the windows — vehicle picker, etc. */
  topSlot?: React.ReactNode;
  /** Web Tailwind className. Retained for source compatibility; ignored on native. */
  className?: string;
  /** Native style escape hatch applied to the GlassPanel wrapper. */
  style?: StyleProp<ViewStyle>;
}

export function SignalCompareControls({
  atA,
  atB,
  onChangeA,
  onChangeB,
  search,
  onSearchChange,
  category,
  onCategoryChange,
  topSlot,
  className: _className,
  style,
}: SignalCompareControlsProps): React.ReactElement {
  const t = useNativeTranslation();

  const applyPreset = useCallback(
    (id: DiffPresetId) => {
      const preset = DIFF_PRESETS.find(p => p.id === id);
      if (!preset) {
        return;
      }
      const {atA: a, atB: b} = preset.compute();
      onChangeA(toLocalDatetimeInput(a));
      onChangeB(toLocalDatetimeInput(b));
    },
    [onChangeA, onChangeB],
  );

  return (
    <FadeIn>
      <GlassPanel style={[styles.panel, style]}>
        {topSlot ? <View>{topSlot}</View> : null}

        <View style={styles.windowGrid}>
          <View>
            <View style={styles.windowLabelRow}>
              <AppText style={styles.windowLabelA}>
                {t('signalDiff.windowA', 'Window A')}
              </AppText>
              <HelpIcon
                ariaLabel={t('help.signal.snapshot.aria', {
                  defaultValue: 'More info about signal snapshots',
                })}
                content="A snapshot is a point-in-time view of every signal value at a single timestamp. Falls back to signal_log within the last 30 days when the live layer doesn't have it."
                i18nKey="help.signal.snapshot"
              />
            </View>
            <TextInput
              accessibilityHint={DATETIME_UNAVAILABLE}
              accessibilityLabel={t('signalDiff.windowA', 'Window A')}
              autoCapitalize="none"
              autoCorrect={false}
              onChangeText={onChangeA}
              placeholder="YYYY-MM-DDTHH:MM"
              placeholderTextColor={colors.textMuted}
              style={styles.input}
              testID="signal-compare-window-a"
              value={atA}
            />
          </View>
          <View>
            <View style={styles.windowLabelRow}>
              <AppText style={styles.windowLabelB}>
                {t('signalDiff.windowB', 'Window B')}
              </AppText>
              <HelpIcon
                ariaLabel={t('help.signal.diff.aria', {
                  defaultValue: 'More info about signal diffs',
                })}
                content="Server-side comparison between two snapshots. Unchanged signals are omitted from the result to reduce noise."
                i18nKey="help.signal.diff"
              />
            </View>
            <TextInput
              accessibilityHint={DATETIME_UNAVAILABLE}
              accessibilityLabel={t('signalDiff.windowB', 'Window B')}
              autoCapitalize="none"
              autoCorrect={false}
              onChangeText={onChangeB}
              placeholder="YYYY-MM-DDTHH:MM"
              placeholderTextColor={colors.textMuted}
              style={styles.input}
              testID="signal-compare-window-b"
              value={atB}
            />
          </View>
        </View>

        <View style={styles.presetRow}>
          <AppText style={styles.presetLabel} tone="muted" variant="caption">
            {t('signalDiff.presetsLabel', 'Quick presets:')}
          </AppText>
          {DIFF_PRESETS.map(p => (
            <ControlButton
              key={p.id}
              label={t(p.labelKey, p.defaultLabel)}
              onPress={() => applyPreset(p.id)}
              testID={`signal-compare-preset-${p.id}`}
              variant="secondary"
            />
          ))}
        </View>

        <View style={styles.filterRow}>
          <TextInput
            onChangeText={onSearchChange}
            placeholder={t('signalDiff.filterPlaceholder', 'Filter signals…')}
            placeholderTextColor={colors.textMuted}
            returnKeyType="search"
            style={[styles.input, styles.filterInput]}
            testID="signal-compare-filter"
            value={search}
          />
          <View style={styles.chipWrap}>
            {CATEGORY_PREFIXES.map(c => {
              const selected = category === c.id;
              return (
                <Pressable
                  accessibilityLabel={t(c.labelKey, c.defaultLabel)}
                  accessibilityRole="button"
                  accessibilityState={{selected}}
                  key={c.id}
                  onPress={() => onCategoryChange(selected ? null : c.id)}
                  style={({pressed}) => [
                    styles.chip,
                    selected ? styles.chipSelected : styles.chipIdle,
                    pressed && styles.pressed,
                  ]}
                  testID={`signal-compare-chip-${c.id}`}>
                  <AppText
                    style={[
                      styles.chipText,
                      selected ? styles.chipTextSelected : styles.chipTextIdle,
                    ]}>
                    {t(c.labelKey, c.defaultLabel)}
                  </AppText>
                </Pressable>
              );
            })}
            {category ? (
              <ControlButton
                label={t('signalDiff.clearCategory', 'Clear')}
                onPress={() => onCategoryChange(null)}
                testID="signal-compare-clear-category"
                variant="ghost"
              />
            ) : null}
          </View>
        </View>
      </GlassPanel>
    </FadeIn>
  );
}

SignalCompareControls.displayName = 'SignalCompareControls';

const styles = StyleSheet.create({
  // Web Button base (rounded-md) + size sm (h-8 px-3).
  button: {
    alignItems: 'center',
    borderRadius: 6,
    justifyContent: 'center',
    minHeight: 32,
    paddingHorizontal: spacing.md,
  },
  // Web ghost variant: bg-transparent, text inherits (text-secondary on dark).
  buttonGhost: {
    backgroundColor: 'transparent',
  },
  buttonGhostText: {
    color: colors.textSecondary,
    fontSize: 12,
  },
  // Web secondary dark variant: bg-gray-700 text-gray-100.
  buttonSecondary: {
    backgroundColor: GRAY_700,
  },
  buttonSecondaryText: {
    color: GRAY_100,
    fontSize: 12,
  },
  // Category chip: rounded-full border px-2.5 py-1.
  chip: {
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  // Unselected: border-[var(--border-subtle)] bg-[var(--surface-2)].
  chipIdle: {
    backgroundColor: colors.surfaceRaised,
    borderColor: colors.border,
  },
  // Selected: border-blue-400/40 bg-blue-500/15.
  chipSelected: {
    backgroundColor: BLUE_BG_15,
    borderColor: BLUE_BORDER_40,
  },
  // text-[11px] uppercase tracking-wide.
  chipText: {
    fontSize: 11,
    letterSpacing: 0.4,
    lineHeight: 14,
    textTransform: 'uppercase',
  },
  chipTextIdle: {
    color: colors.textMuted,
  },
  chipTextSelected: {
    color: BLUE_200,
  },
  // Category chips container: flex flex-wrap items-center gap-1.5.
  chipWrap: {
    alignItems: 'center',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  // Web search Input max-w-sm (24rem). Mobile-first full width, capped.
  filterInput: {
    maxWidth: 384,
    width: '100%',
  },
  // Filter + chips row: flex-col gap-3 border-t pt-3 (mobile-first; sm:flex-row).
  filterRow: {
    borderTopColor: colors.border,
    borderTopWidth: 1,
    flexDirection: 'column',
    gap: spacing.md,
    paddingTop: spacing.md,
  },
  // Web Input: rounded-md border bg-[var(--surface-1)] text-primary px-3 py-2 text-sm.
  input: {
    backgroundColor: colors.surfaceRaised,
    borderColor: colors.border,
    borderRadius: 6,
    borderWidth: 1,
    color: colors.textPrimary,
    fontSize: 14,
    minHeight: 40,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  // GlassPanel content: p-4 sm:p-5 space-y-4.
  panel: {
    gap: 16,
    padding: spacing.lg,
  },
  presetLabel: {
    color: colors.textMuted,
  },
  // Quick-presets row: flex flex-wrap items-center gap-2.
  presetRow: {
    alignItems: 'center',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  pressed: {
    opacity: 0.82,
  },
  // Window A/B grid: grid-cols-1 gap-4 (mobile-first single column; md:grid-cols-2).
  windowGrid: {
    gap: 16,
  },
  // Window A label: text-xs text-cyan-300.
  windowLabelA: {
    color: CYAN_300,
    fontSize: 12,
  },
  // Window B label: text-xs text-amber-300.
  windowLabelB: {
    color: AMBER_300,
    fontSize: 12,
  },
  // Label row: mb-1.5 flex items-center gap-1.
  windowLabelRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 4,
    marginBottom: 6,
  },
});

export default SignalCompareControls;
