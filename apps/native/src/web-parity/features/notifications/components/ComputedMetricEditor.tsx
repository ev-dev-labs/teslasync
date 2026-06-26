// Native parity port of web/src/features/notifications/components/ComputedMetricEditor.tsx.
//
// The web module is the operand panel for kind='computed_metric' alert rules:
// three dropdowns (metric / window / operator) + a numeric threshold input + a
// live-preview line that calls /alerts/test (preview path) via
// usePreviewComputedMetric() to report the current value of the metric. The
// parent owns the editor state and threads change events back through
// `onChange`; this component owns only the live-preview cache. It is built from
// the shared web UI kit (Select, Input, GlassPanel), react-i18next, the
// computed-metric API types, the usePreviewComputedMetric mutation hook, and the
// @/lib/numberFormat fmtNumber formatter.
//
// Native-safe substitutions (rule 7), documented in the parity sidecar:
//   • react-i18next useTranslation() -> a local useTranslation() hook whose
//     t(key, fallback?, values?) returns the English fallback (preserving every
//     key at the call site) and interpolates {{token}} placeholders, so the
//     previewValue copy ('Right now this metric is {{value}}{{suffix}} — would
//     {{verdict}} fire.') resolves exactly as the web copy. An empty-string
//     fallback (the `would` key) is preserved verbatim via `fallback ?? key`. A
//     stable useCallback identity keeps the [metrics, t] / [selected, t] useMemo
//     dependency arrays honest, matching the source.
//   • The shared web <Select> (DOM <select> + <option> list + placeholder option
//     with value '') -> an inlined native Select rendering wrap-flow option chips
//     (the sibling AlertStudio AutomationBuilderPage precedent). The placeholder
//     is prepended as a selectable value='' chip, mirroring the web
//     <option value="">{placeholder}</option>; `disabled` dims + blocks the whole
//     control. RN has no native popup picker here, so the dropdown affordance
//     becomes an inline chip row — same value/onChange/options/placeholder/
//     disabled contract.
//   • The shared web <Input type="number" step="any"> -> the already-ported
//     native Input (a <TextInput>) with keyboardType="numbers-and-punctuation"
//     so decimals + a leading minus (e.g. a negative %_change threshold) can be
//     typed; web onChange={e=>set(e.target.value)} becomes onChangeText={set}.
//   • The repeated web <label>/<p> 10px-uppercase-muted field captions -> a small
//     FieldLabel (AppText) wrapper with the same intent; the responsive web
//     `grid grid-cols-1 sm:grid-cols-3` folds to a vertical stack (mobile = the
//     grid-cols-1 base), and the GlassPanel + AppText tones map cyan/rose/muted
//     intent onto the native theme tokens.
//   • @/lib/numberFormat fmtNumber -> inlined faithfully (locale-aware fixed
//     decimals, non-finite -> 0, bad-locale en-US fallback). RN ships no global
//     number-format locale singleton, so the en-US default precision-2 path is
//     used, matching the web default.
// No DOM elements, react-i18next, Recharts, Leaflet, or web UI kit modules are
// imported into the native output.

import React, {useCallback, useEffect, useMemo, useState} from 'react';
import {Pressable, StyleSheet, View} from 'react-native';

import {usePreviewComputedMetric} from '../../../api/hooks/useNotifications';
import type {ComputedMetricOp, ComputedMetricSummary} from '../../../api/types';
import {Input} from '../../../components/ui/Input';
import {AppText} from '../../../../components/ui/AppText';
import {GlassPanel} from '../../../../components/ui/GlassPanel';
import {colors, spacing} from '../../../../theme/tokens';

/* ─── i18n fallback (web react-i18next useTranslation) ─────────────────── */

type TranslationValues = Record<string, string | number>;

type TFunc = (
  key: string,
  fallback?: string,
  values?: TranslationValues,
) => string;

// Native stand-in for react-i18next's useTranslation: the parity bundle ships no
// i18n runtime, so `t` returns the English fallback (or the key) while preserving
// every key at the call site and interpolating {{token}} placeholders. An
// empty-string fallback is kept verbatim (`'' ?? key` === '') so the `would` key
// collapses to "" exactly as the web copy intends. The stable useCallback
// identity keeps the metric/window/op useMemo dependency arrays honest.
function useTranslation(): {t: TFunc} {
  const t = useCallback<TFunc>((key, fallback, values) => {
    const base = fallback ?? key;
    if (!values) {
      return base;
    }
    return base.replace(/\{\{(\w+)\}\}/g, (match, token: string) =>
      values[token] === undefined ? match : String(values[token]),
    );
  }, []);
  return {t};
}

/* ─── inlined @/lib/numberFormat fmtNumber ─────────────────────────────── */

const DEFAULT_LOCALE = 'en-US';
const DEFAULT_PRECISION = 2;

function safeNumber(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

// web fmtNumber(value, decimals?, locale?): locale-aware fixed-decimal formatting
// with non-finite inputs coerced to 0; the web global precision default is 2 and
// a bad locale tag falls back to en-US so a string is always produced.
function fmtNumber(
  v: unknown,
  decimals: number = DEFAULT_PRECISION,
  locale: string = DEFAULT_LOCALE,
): string {
  try {
    return safeNumber(v).toLocaleString(locale, {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    });
  } catch {
    return safeNumber(v).toLocaleString(DEFAULT_LOCALE, {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    });
  }
}

/* ─── inlined @/components/ui Select (DOM <select> -> option chips) ─────── */

interface SelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}

interface SelectProps {
  value: string;
  onChange: (value: string) => void;
  options: SelectOption[];
  placeholder?: string;
  disabled?: boolean;
}

// Web renders a <select> with an optional leading <option value="">{placeholder}
// </option>; the native port prepends that same selectable value='' chip and
// lays the options out as a wrap-flow chip row. `disabled` dims + blocks the
// whole control, matching the web <select disabled>.
function Select({
  value,
  onChange,
  options,
  placeholder,
  disabled,
}: SelectProps): React.ReactElement {
  const rendered: SelectOption[] = placeholder
    ? [{value: '', label: placeholder}, ...options]
    : options;
  return (
    <View style={[styles.optionRow, disabled ? styles.optionRowDisabled : null]}>
      {rendered.map(opt => {
        const active = opt.value === value;
        const isDisabled = !!disabled || !!opt.disabled;
        return (
          <Pressable
            key={opt.value || '__placeholder__'}
            accessibilityRole="button"
            accessibilityState={{selected: active, disabled: isDisabled}}
            disabled={isDisabled}
            onPress={() => onChange(opt.value)}
            style={({pressed}) => [
              styles.option,
              active ? styles.optionActive : null,
              isDisabled ? styles.optionDisabled : null,
              pressed && !isDisabled ? styles.optionPressed : null,
            ]}>
            <AppText
              style={active ? styles.optionTextActive : styles.optionText}
              weight={active ? 'semibold' : 'regular'}>
              {opt.label}
            </AppText>
          </Pressable>
        );
      })}
    </View>
  );
}

/* ─── inlined web <label>/<p> field caption (10px uppercase muted) ──────── */

function FieldLabel({children}: {children: React.ReactNode}): React.ReactElement {
  return <AppText style={styles.fieldLabel}>{children}</AppText>;
}

/* ─── ComputedMetricEditor ─────────────────────────────────────────────── */

export interface ComputedMetricEditorValue {
  metric_id: string;
  metric_window: string;
  metric_op: ComputedMetricOp;
  metric_threshold: string; // raw input string for parity with the rest of the editor
  vehicle_id?: number | null;
}

interface Props {
  value: ComputedMetricEditorValue;
  onChange: (next: ComputedMetricEditorValue) => void;
  metrics: ComputedMetricSummary[];
  loading?: boolean;
}

const ALL_OPS: ComputedMetricOp[] = [
  '>',
  '>=',
  '<',
  '<=',
  '=',
  '!=',
  '%_change_>',
  '%_change_<',
];

export function ComputedMetricEditor({
  value,
  onChange,
  metrics,
  loading,
}: Props): React.ReactElement {
  const {t} = useTranslation();
  const previewMut = usePreviewComputedMetric();
  const [previewError, setPreviewError] = useState<string | null>(null);

  const selected = useMemo<ComputedMetricSummary | undefined>(
    () => metrics.find(m => m.id === value.metric_id),
    [metrics, value.metric_id],
  );

  const metricOptions = useMemo(
    () =>
      metrics.map(m => ({
        value: m.id,
        label: t(`notifications.alertStudio.metricNames.${m.id}`, m.label),
      })),
    [metrics, t],
  );

  const windowOptions = useMemo(() => {
    const list = selected?.windows ?? [];
    return list.map(w => ({
      value: w,
      label: t(`notifications.alertStudio.metricWindows.${w}`, w),
    }));
  }, [selected, t]);

  const opOptions = useMemo(() => {
    const list = selected?.ops ?? ALL_OPS;
    return list.map(op => ({
      value: op,
      label: t(`notifications.alertStudio.metricOps.${opKey(op)}`, opLabel(op)),
    }));
  }, [selected, t]);

  const handleMetric = (id: string) => {
    const def = metrics.find(m => m.id === id);
    onChange({
      ...value,
      metric_id: id,
      metric_window: def && def.windows.length > 0 ? def.windows[0] : '',
      metric_op: def && def.ops.length > 0 ? def.ops[0] : value.metric_op,
    });
    setPreviewError(null);
  };

  const ready =
    !!value.metric_id &&
    !!value.metric_window &&
    !!value.metric_op &&
    Number.isFinite(parseFloat(value.metric_threshold));

  // Refresh the preview when the selected metric/window/op/threshold changes.
  // Debounce minimally — the user has to actively choose values, so an
  // extra fetch on each change is acceptable and the registry is cheap.
  useEffect(() => {
    if (!ready) {
      return;
    }
    const threshold = parseFloat(value.metric_threshold);
    if (!Number.isFinite(threshold)) {
      return;
    }
    setPreviewError(null);
    previewMut.mutate(
      {
        metric_id: value.metric_id,
        metric_window: value.metric_window,
        metric_op: value.metric_op,
        metric_threshold: threshold,
        vehicle_id: value.vehicle_id ?? undefined,
      },
      {
        onError: (err: unknown) => {
          setPreviewError(err instanceof Error ? err.message : String(err));
        },
      },
    );
    // previewMut intentionally excluded — calling .mutate() in deps would loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    ready,
    value.metric_id,
    value.metric_window,
    value.metric_op,
    value.metric_threshold,
    value.vehicle_id,
  ]);

  const previewData = previewMut.data;
  const previewSuffix = selected ? unitSuffix(selected.unit) : '';

  return (
    <View style={styles.root}>
      <View style={styles.selectGrid}>
        <View style={styles.field}>
          <FieldLabel>
            {t('notifications.alertStudio.computedMetric.metric', 'Metric')}
          </FieldLabel>
          <Select
            value={value.metric_id}
            onChange={handleMetric}
            options={metricOptions}
            placeholder={
              loading
                ? t(
                    'notifications.alertStudio.computedMetric.loading',
                    'Loading metrics…',
                  )
                : t(
                    'notifications.alertStudio.computedMetric.metricPlaceholder',
                    'Choose a metric',
                  )
            }
            disabled={loading}
          />
        </View>
        <View style={styles.field}>
          <FieldLabel>
            {t('notifications.alertStudio.computedMetric.window', 'Window')}
          </FieldLabel>
          <Select
            value={value.metric_window}
            onChange={next => onChange({...value, metric_window: next})}
            options={windowOptions}
            placeholder={t(
              'notifications.alertStudio.computedMetric.windowPlaceholder',
              'Choose a window',
            )}
            disabled={!selected}
          />
        </View>
        <View style={styles.field}>
          <FieldLabel>
            {t('notifications.alertStudio.computedMetric.op', 'Operator')}
          </FieldLabel>
          <Select
            value={value.metric_op}
            onChange={next =>
              onChange({...value, metric_op: next as ComputedMetricOp})
            }
            options={opOptions}
            disabled={!selected}
          />
        </View>
      </View>

      <View style={styles.field}>
        <FieldLabel>
          {t('notifications.alertStudio.computedMetric.threshold', 'Threshold')}
        </FieldLabel>
        <Input
          keyboardType="numbers-and-punctuation"
          value={value.metric_threshold}
          onChangeText={next => onChange({...value, metric_threshold: next})}
          placeholder={t(
            'notifications.alertStudio.computedMetric.thresholdPlaceholder',
            'e.g. 200',
          )}
        />
      </View>

      <GlassPanel style={styles.preview}>
        <FieldLabel>
          {t('notifications.alertStudio.computedMetric.preview', 'Live preview')}
        </FieldLabel>
        {!ready && (
          <AppText style={styles.previewMuted} tone="muted" variant="caption">
            {t(
              'notifications.alertStudio.computedMetric.previewIdle',
              'Pick a metric, window, operator, and threshold to preview.',
            )}
          </AppText>
        )}
        {ready && previewMut.isPending && (
          <AppText style={styles.previewMuted} tone="muted" variant="caption">
            {t(
              'notifications.alertStudio.computedMetric.previewLoading',
              'Computing…',
            )}
          </AppText>
        )}
        {ready && previewError && (
          <AppText style={styles.previewError} tone="danger" variant="caption">
            {previewError}
          </AppText>
        )}
        {ready && !previewMut.isPending && !previewError && previewData && (
          <AppText style={styles.previewValue} variant="caption">
            {t(
              'notifications.alertStudio.computedMetric.previewValue',
              'Right now this metric is {{value}}{{suffix}} — would {{verdict}} fire.',
              {
                value: fmtNumber(previewData.value, 2),
                suffix: previewSuffix ? ` ${previewSuffix}` : '',
                verdict: previewData.would_trigger
                  ? t('notifications.alertStudio.computedMetric.would', '')
                  : t('notifications.alertStudio.computedMetric.wouldNot', 'NOT'),
              },
            )}
          </AppText>
        )}
      </GlassPanel>
    </View>
  );
}

function opLabel(op: ComputedMetricOp): string {
  switch (op) {
    case '%_change_>':
      return '% change >';
    case '%_change_<':
      return '% change <';
    default:
      return op;
  }
}

function opKey(op: ComputedMetricOp): string {
  switch (op) {
    case '>':
      return 'gt';
    case '>=':
      return 'gte';
    case '<':
      return 'lt';
    case '<=':
      return 'lte';
    case '=':
      return 'eq';
    case '!=':
      return 'neq';
    case '%_change_>':
      return 'pctGt';
    case '%_change_<':
      return 'pctLt';
    default:
      return op;
  }
}

function unitSuffix(unit: string): string {
  switch (unit) {
    case 'currency':
      return '';
    case 'currency_per_mi':
      return '/mi';
    case 'kwh':
      return 'kWh';
    case 'wh_per_mi':
      return 'Wh/mi';
    case 'mi':
      return 'mi';
    case 'km':
      return 'km';
    case 'h':
      return 'h';
    case 'count':
      return '';
    case '%':
      return '%';
    default:
      return unit;
  }
}

const styles = StyleSheet.create({
  root: {
    gap: spacing.lg,
  },
  selectGrid: {
    gap: spacing.lg,
  },
  field: {
    gap: spacing.xs,
  },
  fieldLabel: {
    color: colors.textMuted,
    fontSize: 10,
    fontWeight: '500',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
  optionRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
  },
  optionRowDisabled: {
    opacity: 0.5,
  },
  option: {
    backgroundColor: colors.surfaceRaised,
    borderColor: colors.border,
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
  },
  optionActive: {
    backgroundColor: colors.surfaceSelected,
    borderColor: colors.borderAccent,
  },
  optionDisabled: {
    opacity: 0.4,
  },
  optionPressed: {
    opacity: 0.7,
  },
  optionText: {
    color: colors.textSecondary,
    fontSize: 13,
  },
  optionTextActive: {
    color: colors.accent,
    fontSize: 13,
  },
  preview: {
    gap: spacing.xs,
    padding: spacing.md,
  },
  previewMuted: {
    color: colors.textMuted,
  },
  previewError: {
    color: colors.danger,
  },
  previewValue: {
    color: colors.textPrimary,
  },
});
