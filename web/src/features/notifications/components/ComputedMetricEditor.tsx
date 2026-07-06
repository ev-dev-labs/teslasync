/**
 * ComputedMetricEditor — operand panel for kind='computed_metric' alert rules.
 *
 * Wraps three dropdowns (metric / window / operator) plus a numeric threshold
 * input and a live preview line that calls /alerts/test (preview path) to
 * report the current value of the metric. Used inside AlertStudioPage when
 * the user toggles to the "Computed metric" kind.
 *
 * Props are intentionally narrow: the parent owns the editor state and
 * threads change events back through `onChange`. The component itself owns
 * only the live-preview cache.
 */

import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Select as UiSelect, Input as UiInput, GlassPanel, Text } from '@/components/ui'
import type { ComputedMetricOp, ComputedMetricSummary } from '@/api/types'
import { usePreviewComputedMetric } from '@/api/hooks/useNotifications'
import { fmtNumber } from '@/lib/numberFormat'

export interface ComputedMetricEditorValue {
  metric_id: string
  metric_window: string
  metric_op: ComputedMetricOp
  metric_threshold: string // raw input string for parity with the rest of the editor
  vehicle_id?: number | null
}

interface Props {
  value: ComputedMetricEditorValue
  onChange: (next: ComputedMetricEditorValue) => void
  metrics: ComputedMetricSummary[]
  loading?: boolean
}

const ALL_OPS: ComputedMetricOp[] = ['>', '>=', '<', '<=', '=', '!=', '%_change_>', '%_change_<']

export function ComputedMetricEditor({ value, onChange, metrics = [], loading }: Props) {
  const { t } = useTranslation()
  const previewMut = usePreviewComputedMetric()
  const [previewError, setPreviewError] = useState<string | null>(null)

  const selected = useMemo<ComputedMetricSummary | undefined>(
    () => metrics.find(m => m.id === value.metric_id),
    [metrics, value.metric_id],
  )

  const metricOptions = useMemo(
    () =>
      metrics.map(m => ({
        value: m.id,
        label: t(`notifications.alertStudio.metricNames.${m.id}`, m.label),
      })),
    [metrics, t],
  )

  const windowOptions = useMemo(() => {
    const list = selected?.windows ?? []
    return list.map(w => ({
      value: w,
      label: t(`notifications.alertStudio.metricWindows.${w}`, w),
    }))
  }, [selected, t])

  const opOptions = useMemo(() => {
    const list = selected?.ops ?? ALL_OPS
    return list.map(op => ({
      value: op,
      label: t(`notifications.alertStudio.metricOps.${opKey(op)}`, opLabel(op)),
    }))
  }, [selected, t])

  const handleMetric = (id: string) => {
    const def = metrics.find(m => m.id === id)
    // Defensive optional chaining: a malformed registry entry may omit the
    // `windows`/`ops` arrays entirely. Fall back to an empty window and the
    // caller's current operator so selecting the metric never throws.
    onChange({
      ...value,
      metric_id: id,
      metric_window: def?.windows?.[0] ?? '',
      metric_op: def?.ops?.[0] ?? value.metric_op,
    })
    setPreviewError(null)
  }

  const ready =
    !!value.metric_id &&
    !!value.metric_window &&
    !!value.metric_op &&
    Number.isFinite(parseFloat(value.metric_threshold))

  // Refresh the preview when the selected metric/window/op/threshold changes.
  // Debounce minimally — the user has to actively choose values, so an
  // extra fetch on each change is acceptable and the registry is cheap.
  useEffect(() => {
    if (!ready) return
    const threshold = parseFloat(value.metric_threshold)
    if (!Number.isFinite(threshold)) return
    setPreviewError(null)
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
          setPreviewError(err instanceof Error ? err.message : String(err))
        },
      },
    )
    // previewMut intentionally excluded — calling .mutate() in deps would loop.
  }, [
    ready,
    value.metric_id,
    value.metric_window,
    value.metric_op,
    value.metric_threshold,
    value.vehicle_id,
  ])

  const previewData = previewMut.data
  const previewSuffix = selected ? unitSuffix(selected.unit) : ''

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div>
          <Text as="label" variant="metricLabel" className="mb-1 block">
            {t('notifications.alertStudio.computedMetric.metric', 'Metric')}
          </Text>
          <UiSelect
            className="w-full"
            aria-label={t('notifications.alertStudio.computedMetric.metric', 'Metric')}
            value={value.metric_id}
            onChange={e => handleMetric(e.target.value)}
            options={metricOptions}
            placeholder={
              loading
                ? t('notifications.alertStudio.computedMetric.loading', 'Loading metrics…')
                : t('notifications.alertStudio.computedMetric.metricPlaceholder', 'Choose a metric')
            }
            disabled={loading}
          />
        </div>
        <div>
          <Text as="label" variant="metricLabel" className="mb-1 block">
            {t('notifications.alertStudio.computedMetric.window', 'Window')}
          </Text>
          <UiSelect
            className="w-full"
            aria-label={t('notifications.alertStudio.computedMetric.window', 'Window')}
            value={value.metric_window}
            onChange={e => onChange({ ...value, metric_window: e.target.value })}
            options={windowOptions}
            placeholder={t('notifications.alertStudio.computedMetric.windowPlaceholder', 'Choose a window')}
            disabled={!selected}
          />
        </div>
        <div>
          <Text as="label" variant="metricLabel" className="mb-1 block">
            {t('notifications.alertStudio.computedMetric.op', 'Operator')}
          </Text>
          <UiSelect
            className="w-full"
            aria-label={t('notifications.alertStudio.computedMetric.op', 'Operator')}
            value={value.metric_op}
            onChange={e => onChange({ ...value, metric_op: e.target.value as ComputedMetricOp })}
            options={opOptions}
            disabled={!selected}
          />
        </div>
      </div>

      <div>
        <Text as="label" variant="metricLabel" className="mb-1 block">
          {t('notifications.alertStudio.computedMetric.threshold', 'Threshold')}
        </Text>
        <UiInput
          type="number"
          className="w-full"
          aria-label={t('notifications.alertStudio.computedMetric.threshold', 'Threshold')}
          value={value.metric_threshold}
          onChange={e => onChange({ ...value, metric_threshold: e.target.value })}
          placeholder={t('notifications.alertStudio.computedMetric.thresholdPlaceholder', 'e.g. 200')}
          step="any"
        />
      </div>

      <GlassPanel className="p-3">
        <Text as="p" variant="metricLabel" className="mb-1">
          {t('notifications.alertStudio.computedMetric.preview', 'Live preview')}
        </Text>
        {!ready && (
          <p className="text-xs text-[var(--text-muted)]">
            {t(
              'notifications.alertStudio.computedMetric.previewIdle',
              'Pick a metric, window, operator, and threshold to preview.',
            )}
          </p>
        )}
        {ready && previewMut.isPending && (
          <p className="text-xs text-[var(--text-muted)]">
            {t('notifications.alertStudio.computedMetric.previewLoading', 'Computing…')}
          </p>
        )}
        {ready && previewError && (
          <p role="alert" className="text-xs text-rose-300">{previewError}</p>
        )}
        {ready && !previewMut.isPending && !previewError && !previewData && (
          <p className="text-xs text-[var(--text-muted)]">
            {t('notifications.alertStudio.computedMetric.previewEmpty', 'No preview available yet.')}
          </p>
        )}
        {ready && !previewMut.isPending && !previewError && previewData && (
          <p className="text-xs text-[var(--text-primary)]">
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
          </p>
        )}
      </GlassPanel>
    </div>
  )
}

function opLabel(op: ComputedMetricOp): string {
  switch (op) {
    case '%_change_>':
      return '% change >'
    case '%_change_<':
      return '% change <'
    default:
      return op
  }
}

function opKey(op: ComputedMetricOp): string {
  switch (op) {
    case '>':
      return 'gt'
    case '>=':
      return 'gte'
    case '<':
      return 'lt'
    case '<=':
      return 'lte'
    case '=':
      return 'eq'
    case '!=':
      return 'neq'
    case '%_change_>':
      return 'pctGt'
    case '%_change_<':
      return 'pctLt'
    default:
      return op
  }
}

function unitSuffix(unit: string): string {
  switch (unit) {
    case 'currency':
      return ''
    case 'currency_per_mi':
      return '/mi'
    case 'kwh':
      return 'kWh'
    case 'wh_per_mi':
      return 'Wh/mi'
    case 'mi':
      return 'mi'
    case 'km':
      return 'km'
    case 'h':
      return 'h'
    case 'count':
      return ''
    case '%':
      return '%'
    default:
      return unit
  }
}
