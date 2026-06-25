// Native parity port of web/src/components/forms/RangePicker.tsx.
//
// The web component is a single-trigger date-range filter: a compact DOM
// <button> (lucide <Calendar/> + active-preset label + a `hidden sm:inline`
// formatted range + lucide <ChevronDown/>) that opens a shared
// `@/components/ui/Popover` containing a preset `<ul role="listbox">`, a
// two-month `react-day-picker` <DayPicker mode="range"> calendar, and a footer
// with an optional `<input type="checkbox">` compare toggle plus Cancel / Apply
// `@/components/ui/Button`s. React Native ships none of those primitives -- no
// DOM popover/anchor, no lucide SVG set, no `react-day-picker` calendar grid,
// and the shared web Popover/Button/cn/datePresets modules are not part of the
// native bundle. This port therefore:
//   * renders the trigger as a <Pressable>. The lucide calendar glyph and the
//     `hidden sm:inline` formatted-range span are omitted to match the web's
//     phone rendering (the same `hidden sm:*` drop precedent used by the
//     DateRangeFilter port); the formatted range + day count survive as the
//     trigger's accessibilityHint (the web `title`). A text "\u25BE" chevron
//     stands in for lucide <ChevronDown/>.
//   * renders the Popover as a bottom-pinned <Modal> sheet -- exactly the
//     "below md breakpoint = bottom-pinned sheet" mobile behavior documented in
//     the web header. The web `align` (horizontal popover anchor) and DOM
//     `className` props have no bottom-sheet analog; they remain on the public
//     RangePickerProps type for API parity but are intentionally not consumed.
//   * replaces the DOM <DayPicker> calendar with two controlled <TextInput>
//     YYYY-MM-DD fields that stage a range (identical "calendar pick stages
//     internally; only Apply commits" contract). The OS-native two-month grid,
//     showOutsideDays, numberOfMonths window-width logic, and weekStartsOn are
//     browser/date-picker-only affordances unavailable without a date-picker
//     dependency; a bounds hint approximates the calendar's fromDate/toDate
//     min/max enforcement (see parity sidecar).
//   * inlines a faithful, DOM-free copy of DATE_PRESETS, DEFAULT_PRESET_IDS,
//     getDatePreset, resolveAllTimeStart, and matchPresetId so presets resolve
//     identical ISO ranges without importing the not-yet-ported web lib.
//   * keeps the react-i18next intent via a local fallback `t` (the native
//     bundle has no react-i18next) that preserves every key + English fallback
//     and performs `{{count}}` interpolation so summaries read "5 days".
//
// Behavior preserved verbatim: preset press applies immediately + closes +
// fires onChange(range, presetId); the staged range only commits on Apply
// (with the start <= end guard); Cancel / backdrop / hardware-back discard the
// staged range; the compare toggle fires onCompareChange; the trigger's
// accessible name tracks the active preset. State names (open, staged) and all
// helper functions (isoFromDate, dateFromIso, diffDaysInclusive, formatRange)
// are carried across unchanged.

import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';

import {AppText} from '../../../components/ui/AppText';
import {colors, shadows, spacing, typography} from '../../../theme/tokens';

type TVars = Record<string, string | number>;
type TFunc = (key: string, fallback: string, vars?: TVars) => string;

/** Minimal `{{var}}` interpolation mirroring react-i18next's default syntax. */
function interpolate(template: string, vars?: TVars): string {
  if (!vars) {
    return template;
  }
  return template.replace(/\{\{(\w+)\}\}/g, (_match, key: string) =>
    Object.prototype.hasOwnProperty.call(vars, key)
      ? String(vars[key])
      : `{{${key}}}`,
  );
}

// Native stand-in for react-i18next's useTranslation: the native bundle ships
// no i18n runtime, so `t` returns the (interpolated) English fallback while
// preserving the translation key at every call site, and `i18n.language`
// defaults to 'en' to feed formatRange + the locale-aware summaries.
function useTranslation(): {t: TFunc; i18n: {language: string}} {
  const t = useCallback<TFunc>(
    (_key, fallback, vars) => interpolate(fallback, vars),
    [],
  );
  return {t, i18n: {language: 'en'}};
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

/** Format a Date as YYYY-MM-DD using LOCAL calendar fields. */
function iso(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

// Faithful inline copy of web/src/lib/datePresets.ts DATE_PRESETS -- pure,
// DOM-free range math so the preset list resolves identical ISO ranges.
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

/** Default preset set rendered when callers do not pass `presetIds`. */
const DEFAULT_PRESET_IDS = [
  'today',
  '7d',
  '30d',
  'mtd',
  'ytd',
  'all',
] as const;

/** Lookup a preset by id (returns undefined when unknown). */
function getDatePreset(id: string): DatePreset | undefined {
  return DATE_PRESETS.find(p => p.id === id);
}

/**
 * Resolve the start date for the "All time" preset. Defaults to `'2015-01-01'`
 * but can be clamped to a smarter floor -- typically the user's first data
 * point -- so a user whose data starts in 2024 doesn't see years of empty
 * buckets.
 */
function resolveAllTimeStart(minDate?: string): string {
  const baseline = '2015-01-01';
  if (!minDate) {
    return baseline;
  }
  return minDate > baseline ? minDate : baseline;
}

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

/** Staged calendar range -- the native analog of react-day-picker's DateRange. */
interface StagedRange {
  from?: Date;
  to?: Date;
}

const ISO_RE = /^\d{4}-\d{2}-\d{2}$/;

export interface RangePickerValue {
  start: string;
  end: string;
}

export interface RangePickerProps {
  /** Current ISO range (`YYYY-MM-DD` strings, inclusive). */
  value: RangePickerValue;
  /** Called whenever the range is committed (preset press or Apply). */
  onChange: (value: RangePickerValue, presetId?: string) => void;
  /** Subset of preset ids to render. Defaults to {@link DEFAULT_PRESET_IDS}. */
  presetIds?: readonly string[];
  /**
   * Floor for the "All time" preset and for any user-selectable date.
   * Pass the user's first data point for a smarter "All time" semantic.
   * Falls back to `2015-01-01`.
   */
  minDate?: string;
  /** Upper bound (inclusive) for selectable dates. Defaults to today. */
  maxDate?: string;
  /** When true, show "Compare to previous period" toggle in the footer. */
  enableCompare?: boolean;
  /** Current value of the compare flag. */
  compare?: boolean;
  /** Called when the compare toggle is flipped. */
  onCompareChange?: (next: boolean) => void;
  /** Trigger size matches the web Button size scale. */
  size?: 'sm' | 'md';
  /**
   * Popover alignment relative to the trigger. Accepted for web API parity;
   * the native port renders a full-width bottom sheet with no horizontal
   * anchor, so this prop has no native effect.
   */
  align?: 'start' | 'end';
  /**
   * Optional className on the trigger element. Accepted for web API parity;
   * React Native has no DOM className, so this prop has no native effect.
   */
  className?: string;
  /** Test id forwarded to the trigger. */
  triggerTestId?: string;
  /**
   * When true, hide the staged-range fields and footer Apply/Cancel buttons.
   * Use this for pages whose backend only accepts trailing-period queries
   * (e.g. `?days=N`) and cannot honor an arbitrary custom range.
   */
  presetsOnly?: boolean;
}

function isoFromDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function dateFromIso(s: string): Date {
  // Local-day construction so YYYY-MM-DD doesn't shift across timezones.
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, (m ?? 1) - 1, d ?? 1);
}

function diffDaysInclusive(start: string, end: string): number {
  const s = dateFromIso(start).getTime();
  const e = dateFromIso(end).getTime();
  return Math.max(1, Math.round((e - s) / 86_400_000) + 1);
}

function formatRange(start: string, end: string, locale: string): string {
  const s = dateFromIso(start);
  const e = dateFromIso(end);
  const sameYear = s.getFullYear() === e.getFullYear();
  const sameDay = start === end;
  const fmt = (d: Date, withYear: boolean) =>
    new Intl.DateTimeFormat(locale, {
      month: 'short',
      day: 'numeric',
      ...(withYear ? {year: 'numeric'} : {}),
    }).format(d);
  if (sameDay) {
    return fmt(s, true);
  }
  return `${fmt(s, !sameYear)} \u2013 ${fmt(e, true)}`;
}

export function RangePicker({
  value,
  onChange,
  presetIds = DEFAULT_PRESET_IDS,
  minDate,
  maxDate,
  enableCompare = false,
  compare = false,
  onCompareChange,
  size = 'sm',
  triggerTestId,
  presetsOnly = false,
}: RangePickerProps) {
  const {t, i18n} = useTranslation();
  const triggerRef = useRef<View>(null);
  const [open, setOpen] = useState(false);

  // Staged range -- what the field shows but hasn't applied yet.
  const [staged, setStaged] = useState<StagedRange | undefined>(undefined);
  // Raw editing buffers for the staged-range text fields (the native analog of
  // the calendar's in-progress selection); reconciled into `staged` when valid.
  const [startDraft, setStartDraft] = useState('');
  const [endDraft, setEndDraft] = useState('');

  // Reset staged state on open.
  useEffect(() => {
    if (open) {
      setStaged({from: dateFromIso(value.start), to: dateFromIso(value.end)});
      setStartDraft(value.start);
      setEndDraft(value.end);
    }
  }, [open, value.start, value.end]);

  const activePresetId = useMemo(
    () => matchPresetId(value.start, value.end),
    [value.start, value.end],
  );
  const activePreset = activePresetId
    ? getDatePreset(activePresetId)
    : undefined;
  const activeLabel = activePreset
    ? t(activePreset.i18nKey, activePreset.fallback)
    : t('date.range.pickRange', 'Custom range');

  const presets = useMemo(
    () => DATE_PRESETS.filter(p => presetIds.includes(p.id)),
    [presetIds],
  );

  const handlePreset = (id: string) => {
    const preset = getDatePreset(id);
    if (!preset) {
      return;
    }
    const r =
      preset.id === 'all'
        ? {start: resolveAllTimeStart(minDate), end: preset.resolve().end}
        : preset.resolve();
    onChange(r, preset.id);
    setOpen(false);
  };

  const handleStartText = (text: string) => {
    setStartDraft(text);
    if (ISO_RE.test(text)) {
      setStaged(prev => ({...(prev ?? {}), from: dateFromIso(text)}));
    }
  };

  const handleEndText = (text: string) => {
    setEndDraft(text);
    if (ISO_RE.test(text)) {
      setStaged(prev => ({...(prev ?? {}), to: dateFromIso(text)}));
    }
  };

  const handleApply = () => {
    if (!staged?.from || !staged?.to) {
      return;
    }
    const start = isoFromDate(staged.from);
    const end = isoFromDate(staged.to);
    if (start > end) {
      return;
    }
    onChange({start, end});
    setOpen(false);
  };

  const handleCancel = () => {
    setStaged(undefined);
    setStartDraft('');
    setEndDraft('');
    setOpen(false);
  };

  const stagedDirty =
    !!staged?.from &&
    !!staged?.to &&
    (isoFromDate(staged.from) !== value.start ||
      isoFromDate(staged.to) !== value.end);

  const stagedDays =
    staged?.from && staged?.to
      ? diffDaysInclusive(isoFromDate(staged.from), isoFromDate(staged.to))
      : null;

  const triggerLabel = activeLabel;
  const triggerSubLabel = formatRange(
    value.start,
    value.end,
    i18n.language || 'en',
  );
  const totalDays = diffDaysInclusive(value.start, value.end);
  const dayCount = t('date.range.summaryDays', '{{count}} days', {
    count: totalDays,
  });

  const minDateObj = minDate ? dateFromIso(minDate) : undefined;
  const maxDateObj = maxDate ? dateFromIso(maxDate) : new Date();
  const boundsHint = t('date.range.bounds', 'Selectable {{min}} \u2013 {{max}}', {
    min: minDateObj ? isoFromDate(minDateObj) : '\u2026',
    max: isoFromDate(maxDateObj),
  });

  return (
    <>
      <Pressable
        accessibilityHint={`${triggerSubLabel} \u00B7 ${dayCount}`}
        accessibilityLabel={t('date.range.trigger', 'Date range')}
        accessibilityRole="button"
        accessibilityState={{expanded: open}}
        onPress={() => setOpen(o => !o)}
        ref={triggerRef}
        style={({pressed}) => [
          styles.trigger,
          size === 'md' ? styles.triggerMd : styles.triggerSm,
          pressed && styles.pressed,
        ]}
        testID={triggerTestId}>
        <AppText
          numberOfLines={1}
          style={[
            styles.triggerLabel,
            size === 'md' ? styles.triggerLabelMd : styles.triggerLabelSm,
          ]}
          weight="semibold">
          {triggerLabel}
        </AppText>
        <AppText
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          style={styles.triggerChevron}>
          {'\u25BE'}
        </AppText>
      </Pressable>

      <Modal
        animationType="fade"
        onRequestClose={() => setOpen(false)}
        transparent
        visible={open}>
        <View style={styles.overlay}>
          <Pressable
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
            onPress={() => setOpen(false)}
            style={styles.backdrop}
          />

          <View
            accessibilityLabel={t('date.range.popoverLabel', 'Date range picker')}
            style={styles.sheet}
            testID="range-picker-popover">
            <View style={styles.column}>
              {/* Preset list */}
              <ScrollView
                accessibilityLabel={t('date.preset.label', 'Quick date range')}
                contentContainerStyle={styles.presetRow}
                horizontal
                showsHorizontalScrollIndicator={false}
                style={styles.presetScroll}>
                {presets.map(p => {
                  const active = p.id === activePresetId;
                  return (
                    <Pressable
                      accessibilityLabel={t(p.i18nKey, p.fallback)}
                      accessibilityRole="button"
                      accessibilityState={{selected: active}}
                      hitSlop={6}
                      key={p.id}
                      onPress={() => handlePreset(p.id)}
                      style={({pressed}) => [
                        styles.preset,
                        active ? styles.presetActive : styles.presetGhost,
                        pressed && styles.pressed,
                      ]}
                      testID={`range-preset-${p.id}`}>
                      <AppText
                        style={
                          active
                            ? styles.presetActiveText
                            : styles.presetGhostText
                        }
                        variant="caption"
                        weight="semibold">
                        {t(p.i18nKey, p.fallback)}
                      </AppText>
                    </Pressable>
                  );
                })}
              </ScrollView>

              {/* Staged-range fields + footer */}
              {!presetsOnly && (
                <View style={styles.body}>
                  <View style={styles.calendarSub}>
                    <DateField
                      label={t('date.range.start', 'Start date')}
                      onChangeText={handleStartText}
                      testID="range-picker-start"
                      value={startDraft}
                    />
                    <AppText style={styles.arrow}>{'\u2192'}</AppText>
                    <DateField
                      label={t('date.range.end', 'End date')}
                      onChangeText={handleEndText}
                      testID="range-picker-end"
                      value={endDraft}
                    />
                  </View>

                  <AppText
                    style={styles.boundsHint}
                    testID="range-picker-bounds"
                    variant="caption">
                    {boundsHint}
                  </AppText>

                  <View style={styles.footer}>
                    {enableCompare ? (
                      <Pressable
                        accessibilityLabel={t(
                          'date.range.compare',
                          'Compare to previous period',
                        )}
                        accessibilityRole="checkbox"
                        accessibilityState={{checked: compare}}
                        onPress={() => onCompareChange?.(!compare)}
                        style={styles.compareRow}
                        testID="range-picker-compare">
                        <View
                          style={[
                            styles.checkbox,
                            compare && styles.checkboxChecked,
                          ]}>
                          {compare ? (
                            <AppText style={styles.checkboxMark} weight="bold">
                              {'\u2713'}
                            </AppText>
                          ) : null}
                        </View>
                        <AppText style={styles.compareText} variant="caption">
                          {t(
                            'date.range.compare',
                            'Compare to previous period',
                          )}
                        </AppText>
                      </Pressable>
                    ) : (
                      <AppText
                        style={styles.daysText}
                        testID="range-picker-days"
                        variant="caption">
                        {stagedDays
                          ? t('date.range.summaryDays', '{{count}} days', {
                              count: stagedDays,
                            })
                          : ''}
                      </AppText>
                    )}

                    <View style={styles.footerActions}>
                      <FooterButton
                        label={t('date.range.cancel', 'Cancel')}
                        onPress={handleCancel}
                        testID="range-picker-cancel"
                        variant="ghost"
                      />
                      <FooterButton
                        disabled={!stagedDirty}
                        label={t('date.range.apply', 'Apply')}
                        onPress={handleApply}
                        testID="range-picker-apply"
                        variant="primary"
                      />
                    </View>
                  </View>
                </View>
              )}
            </View>
          </View>
        </View>
      </Modal>
    </>
  );
}
RangePicker.displayName = 'RangePicker';

function DateField({
  label,
  onChangeText,
  testID,
  value,
}: {
  label: string;
  onChangeText: (text: string) => void;
  testID: string;
  value: string;
}) {
  return (
    <View style={styles.field}>
      <TextInput
        accessibilityLabel={label}
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="numbers-and-punctuation"
        maxLength={10}
        onChangeText={onChangeText}
        placeholder="YYYY-MM-DD"
        placeholderTextColor={colors.textMuted}
        style={styles.input}
        testID={testID}
        value={value}
      />
    </View>
  );
}

function FooterButton({
  disabled = false,
  label,
  onPress,
  testID,
  variant,
}: {
  disabled?: boolean;
  label: string;
  onPress: () => void;
  testID: string;
  variant: 'primary' | 'ghost';
}) {
  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="button"
      accessibilityState={{disabled}}
      disabled={disabled}
      onPress={onPress}
      style={({pressed}) => [
        styles.footerButton,
        variant === 'primary' ? styles.primaryButton : styles.ghostButton,
        disabled && styles.disabled,
        pressed && !disabled && styles.pressed,
      ]}
      testID={testID}>
      <AppText
        style={
          variant === 'primary'
            ? styles.primaryButtonText
            : styles.ghostButtonText
        }
        variant="caption"
        weight="semibold">
        {label}
      </AppText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  arrow: {
    color: colors.textMuted,
    fontSize: typography.caption,
    paddingHorizontal: spacing.xs,
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
  },
  body: {
    gap: spacing.md,
  },
  boundsHint: {
    color: colors.textMuted,
  },
  calendarSub: {
    alignItems: 'center',
    backgroundColor: colors.surfaceRaised,
    borderColor: colors.border,
    borderRadius: 12,
    borderWidth: 1,
    flexDirection: 'row',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  checkbox: {
    alignItems: 'center',
    borderColor: colors.border,
    borderRadius: 6,
    borderWidth: 1,
    height: 20,
    justifyContent: 'center',
    width: 20,
  },
  checkboxChecked: {
    backgroundColor: colors.accent,
    borderColor: colors.accent,
  },
  checkboxMark: {
    color: colors.background,
    fontSize: 12,
    lineHeight: 14,
  },
  column: {
    gap: spacing.md,
  },
  compareRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
  },
  compareText: {
    color: colors.textSecondary,
  },
  daysText: {
    color: colors.textMuted,
  },
  disabled: {
    opacity: 0.48,
  },
  field: {
    flex: 1,
  },
  footer: {
    borderTopColor: colors.border,
    borderTopWidth: 1,
    gap: spacing.sm,
    paddingTop: spacing.sm,
  },
  footerActions: {
    flexDirection: 'row',
    gap: spacing.sm,
    justifyContent: 'flex-end',
  },
  footerButton: {
    alignItems: 'center',
    borderRadius: 12,
    justifyContent: 'center',
    minHeight: 40,
    minWidth: 96,
    paddingHorizontal: spacing.md,
  },
  ghostButton: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
  },
  ghostButtonText: {
    color: colors.textPrimary,
  },
  input: {
    color: colors.textPrimary,
    flex: 1,
    fontSize: typography.caption,
    minWidth: 0,
    paddingVertical: 2,
  },
  overlay: {
    backgroundColor: 'rgba(0, 0, 0, 0.62)',
    flex: 1,
    justifyContent: 'flex-end',
  },
  preset: {
    alignItems: 'center',
    borderRadius: 999,
    borderWidth: 1,
    justifyContent: 'center',
    minHeight: 32,
    paddingHorizontal: spacing.md,
  },
  presetActive: {
    backgroundColor: colors.accent,
    borderColor: colors.accent,
  },
  presetActiveText: {
    color: colors.background,
  },
  presetGhost: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
  },
  presetGhostText: {
    color: colors.textPrimary,
  },
  presetRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.xs,
    paddingVertical: spacing.xs,
  },
  presetScroll: {
    flexGrow: 0,
  },
  pressed: {
    opacity: 0.82,
  },
  primaryButton: {
    backgroundColor: colors.accent,
    borderColor: colors.accent,
    borderWidth: 1,
  },
  primaryButtonText: {
    color: colors.background,
  },
  sheet: {
    backgroundColor: colors.surface,
    borderColor: colors.borderAccent,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    borderWidth: 1,
    gap: spacing.md,
    maxHeight: '88%',
    padding: spacing.lg,
    ...shadows.panel,
  },
  trigger: {
    alignItems: 'center',
    alignSelf: 'flex-start',
    backgroundColor: colors.surfaceRaised,
    borderColor: colors.border,
    borderRadius: 12,
    borderWidth: 1,
    flexDirection: 'row',
    gap: spacing.xs,
  },
  triggerChevron: {
    color: colors.textMuted,
    fontSize: 12,
  },
  triggerLabel: {
    color: colors.textPrimary,
    flexShrink: 1,
  },
  triggerLabelMd: {
    fontSize: typography.body,
  },
  triggerLabelSm: {
    fontSize: typography.caption,
  },
  triggerMd: {
    minHeight: 40,
    paddingHorizontal: spacing.md,
  },
  triggerSm: {
    minHeight: 32,
    paddingHorizontal: spacing.sm,
  },
});
