// Native parity port of web/src/components/forms/DateRangeFilter.tsx.
//
// The web component renders a DOM date-range row: a rounded surface holding two
// `<input type="date">` fields with a lucide <Calendar/> glyph and a "→"
// separator, an optional Apply <Button>, and a <DatePresetChips> quick-select
// row. React Native ships none of those primitives -- there is no
// `<input type="date">` calendar popup, no lucide-react SVG set, and the shared
// web `@/components/ui/Button`, `./DatePresetChips`, and `@/lib/datePresets`
// modules are not part of the native bundle. This port therefore:
//   * swaps the browser date picker for a controlled <TextInput> accepting a
//     YYYY-MM-DD string (identical value/onChange contract). The OS-native
//     calendar overlay is the documented browser-only affordance that is
//     unavailable without a date-picker dependency (see parity sidecar).
//   * inlines a faithful, DOM-free copy of the DATE_PRESETS table,
//     DEFAULT_PRESET_IDS, and matchPresetId so the chip row resolves identical
//     ISO ranges without importing the not-yet-ported web lib.
//   * replaces the shared <Button> with internal Pressable chips / Apply button
//     mirroring the primary/ghost variants and the active-preset highlight
//     (the same internal-button precedent used by the BulkActionsToolbar port).
//   * keeps the react-i18next intent via a local fallback `t` (the native
//     bundle has no react-i18next), preserving every key + English fallback.
//
// The lucide <Calendar/> glyph carries `hidden sm:block` on the web, i.e. it is
// hidden on phone-sized viewports; the phone-first native port omits it to
// match that mobile rendering. Prop names, defaults, the onRangeChange-vs-
// onStartDateChange/onEndDateChange branch, the optional onApply call, and the
// activeId highlight are all preserved unchanged.

import React, {useCallback, useMemo} from 'react';
import {Pressable, StyleSheet, TextInput, View} from 'react-native';

import {AppText} from '../../../components/ui/AppText';
import {colors, spacing, typography} from '../../../theme/tokens';

type TFunc = (key: string, fallback: string) => string;

// Native stand-in for react-i18next's useTranslation: the native bundle ships
// no i18n runtime, so `t` returns the English fallback while preserving the
// translation key at every call site for a future native i18n layer.
function useTranslation(): {t: TFunc} {
  const t = useCallback<TFunc>((_key, fallback) => fallback, []);
  return {t};
}

interface DatePresetRange {
  start: string; // YYYY-MM-DD
  end: string; // YYYY-MM-DD
}

interface DatePreset {
  id: string;
  i18nKey: string;
  fallback: string;
  resolve: (now?: Date) => DatePresetRange;
}

interface DatePresetSelection {
  id: string;
  start: string;
  end: string;
}

/** Format a Date as YYYY-MM-DD using LOCAL calendar fields. */
function iso(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

// Faithful inline copy of web/src/lib/datePresets.ts DATE_PRESETS -- pure,
// DOM-free range math so the chip row resolves identical ISO ranges.
const DATE_PRESETS: DatePreset[] = [
  {
    id: 'today',
    i18nKey: 'date.preset.today',
    fallback: 'Today',
    resolve: (now = new Date()) => ({start: iso(now), end: iso(now)}),
  },
  {
    id: 'yesterday',
    i18nKey: 'date.preset.yesterday',
    fallback: 'Yesterday',
    resolve: (now = new Date()) => {
      const y = new Date(now);
      y.setDate(y.getDate() - 1);
      return {start: iso(y), end: iso(y)};
    },
  },
  {
    id: '7d',
    i18nKey: 'date.preset.last7',
    fallback: 'Last 7 days',
    resolve: (now = new Date()) => {
      const s = new Date(now);
      s.setDate(s.getDate() - 6);
      return {start: iso(s), end: iso(now)};
    },
  },
  {
    id: '30d',
    i18nKey: 'date.preset.last30',
    fallback: 'Last 30 days',
    resolve: (now = new Date()) => {
      const s = new Date(now);
      s.setDate(s.getDate() - 29);
      return {start: iso(s), end: iso(now)};
    },
  },
  {
    id: '90d',
    i18nKey: 'date.preset.last90',
    fallback: 'Last 90 days',
    resolve: (now = new Date()) => {
      const s = new Date(now);
      s.setDate(s.getDate() - 89);
      return {start: iso(s), end: iso(now)};
    },
  },
  {
    id: 'mtd',
    i18nKey: 'date.preset.mtd',
    fallback: 'Month to date',
    resolve: (now = new Date()) => ({
      start: iso(new Date(now.getFullYear(), now.getMonth(), 1)),
      end: iso(now),
    }),
  },
  {
    id: 'qtd',
    i18nKey: 'date.preset.qtd',
    fallback: 'Quarter to date',
    resolve: (now = new Date()) => {
      const q = Math.floor(now.getMonth() / 3) * 3;
      return {
        start: iso(new Date(now.getFullYear(), q, 1)),
        end: iso(now),
      };
    },
  },
  {
    id: 'ytd',
    i18nKey: 'date.preset.ytd',
    fallback: 'Year to date',
    resolve: (now = new Date()) => ({
      start: iso(new Date(now.getFullYear(), 0, 1)),
      end: iso(now),
    }),
  },
  {
    id: 'lastMonth',
    i18nKey: 'date.preset.lastMonth',
    fallback: 'Last month',
    resolve: (now = new Date()) => {
      const s = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      // Day 0 of the current month = last day of the previous month.
      const e = new Date(now.getFullYear(), now.getMonth(), 0);
      return {start: iso(s), end: iso(e)};
    },
  },
  {
    id: '1y',
    i18nKey: 'date.preset.last1y',
    fallback: 'Last year',
    resolve: (now = new Date()) => {
      const s = new Date(now);
      s.setFullYear(s.getFullYear() - 1);
      return {start: iso(s), end: iso(now)};
    },
  },
  {
    id: 'all',
    i18nKey: 'date.preset.all',
    fallback: 'All time',
    resolve: (now = new Date()) => ({start: '2015-01-01', end: iso(now)}),
  },
];

/** Default chip set rendered when callers do not pass `presetIds`. */
const DEFAULT_PRESET_IDS = ['today', '7d', '30d', 'mtd', 'ytd', 'all'] as const;

/**
 * Return the id of the preset whose resolved range matches (start, end), or
 * undefined if no preset matches.
 */
function matchPresetId(
  start: string,
  end: string,
  now?: Date,
): string | undefined {
  for (const preset of DATE_PRESETS) {
    const r = preset.resolve(now);
    if (r.start === start && r.end === end) {
      return preset.id;
    }
  }
  return undefined;
}

export interface DateRangeFilterProps {
  startDate: string;
  endDate: string;
  onStartDateChange: (date: string) => void;
  onEndDateChange: (date: string) => void;
  /**
   * Optional atomic-update callback. When provided, preset chip presses call
   * this instead of `onStartDateChange` + `onEndDateChange` so a single state
   * update applies both ends of the range.
   */
  onRangeChange?: (range: {start: string; end: string}) => void;
  onApply?: () => void;
  /** When false, hides the preset chip row. Defaults to true. */
  presets?: boolean;
  /** Subset of preset ids to render in the chip row. Defaults to DEFAULT_PRESET_IDS. */
  presetIds?: readonly string[];
}

/**
 * Date range picker with quick-select preset chips.
 *
 * Default chip set comes from DEFAULT_PRESET_IDS
 * (Today / 7d / 30d / MTD / YTD / All). Override via `presetIds` to surface a
 * different selection (e.g. ['7d','30d','90d','1y']).
 *
 * @deprecated Mirrors the web `DateRangeFilter`, which is itself deprecated in
 * favour of a future popover `RangePicker`. Kept for parity with consumers that
 * need the inline (non-popover) layout.
 */
export function DateRangeFilter({
  startDate,
  endDate,
  onStartDateChange,
  onEndDateChange,
  onRangeChange,
  onApply,
  presets = true,
  presetIds = DEFAULT_PRESET_IDS,
}: DateRangeFilterProps) {
  const {t} = useTranslation();

  const activeId = useMemo(
    () => matchPresetId(startDate, endDate),
    [startDate, endDate],
  );

  const handlePreset = (selection: DatePresetSelection) => {
    if (onRangeChange) {
      onRangeChange({start: selection.start, end: selection.end});
    } else {
      onStartDateChange(selection.start);
      onEndDateChange(selection.end);
    }
    onApply?.();
  };

  const ids = new Set(presetIds);
  const chips = DATE_PRESETS.filter(p => ids.has(p.id));

  return (
    <View style={styles.root} testID="date-range-filter">
      <View style={styles.dateSurface}>
        <TextInput
          accessibilityLabel={t('date.range.start', 'Start date')}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="numbers-and-punctuation"
          onChangeText={onStartDateChange}
          placeholder="YYYY-MM-DD"
          placeholderTextColor={colors.textMuted}
          style={styles.dateInput}
          testID="date-range-start"
          value={startDate}
        />
        <AppText style={styles.arrow}>{'\u2192'}</AppText>
        <TextInput
          accessibilityLabel={t('date.range.end', 'End date')}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="numbers-and-punctuation"
          onChangeText={onEndDateChange}
          placeholder="YYYY-MM-DD"
          placeholderTextColor={colors.textMuted}
          style={styles.dateInput}
          testID="date-range-end"
          value={endDate}
        />
      </View>

      {onApply ? (
        <Pressable
          accessibilityLabel={t('date.range.apply', 'Apply')}
          accessibilityRole="button"
          onPress={onApply}
          style={({pressed}) => [
            styles.applyButton,
            pressed && styles.pressed,
          ]}
          testID="date-range-apply">
          <AppText
            style={styles.applyText}
            variant="caption"
            weight="semibold">
            {t('date.range.apply', 'Apply')}
          </AppText>
        </Pressable>
      ) : null}

      {presets ? (
        <View style={styles.chipRow} testID="date-range-presets">
          {chips.map(p => {
            const active = p.id === activeId;
            return (
              <Pressable
                key={p.id}
                accessibilityLabel={t(p.i18nKey, p.fallback)}
                accessibilityRole="button"
                accessibilityState={{selected: active}}
                hitSlop={6}
                onPress={() => {
                  const r = p.resolve();
                  handlePreset({id: p.id, start: r.start, end: r.end});
                }}
                style={({pressed}) => [
                  styles.chip,
                  active ? styles.chipActive : styles.chipGhost,
                  pressed && styles.pressed,
                ]}
                testID={`date-preset-${p.id}`}>
                <AppText
                  style={active ? styles.chipActiveText : styles.chipGhostText}
                  variant="caption"
                  weight="semibold">
                  {t(p.i18nKey, p.fallback)}
                </AppText>
              </Pressable>
            );
          })}
        </View>
      ) : null}
    </View>
  );
}

DateRangeFilter.displayName = 'DateRangeFilter';

const styles = StyleSheet.create({
  applyButton: {
    alignItems: 'center',
    backgroundColor: colors.accent,
    borderColor: colors.accent,
    borderRadius: 12,
    borderWidth: 1,
    justifyContent: 'center',
    minHeight: 36,
    paddingHorizontal: spacing.md,
  },
  applyText: {
    color: colors.background,
  },
  arrow: {
    color: colors.textMuted,
    fontSize: typography.caption,
  },
  chip: {
    alignItems: 'center',
    borderRadius: 999,
    borderWidth: 1,
    justifyContent: 'center',
    minHeight: 32,
    paddingHorizontal: spacing.md,
  },
  chipActive: {
    backgroundColor: colors.accent,
    borderColor: colors.accent,
  },
  chipActiveText: {
    color: colors.background,
  },
  chipGhost: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
  },
  chipGhostText: {
    color: colors.textPrimary,
  },
  chipRow: {
    alignItems: 'center',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
  },
  dateInput: {
    color: colors.textPrimary,
    flex: 1,
    fontSize: typography.caption,
    minWidth: 0,
    paddingVertical: 2,
  },
  dateSurface: {
    alignItems: 'center',
    backgroundColor: colors.surfaceRaised,
    borderColor: colors.border,
    borderRadius: 12,
    borderWidth: 1,
    flexBasis: '100%',
    flexDirection: 'row',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
  },
  pressed: {
    opacity: 0.82,
  },
  root: {
    alignItems: 'center',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
});
