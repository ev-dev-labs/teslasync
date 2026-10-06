import { StaleRefreshWarning, QueryError } from '@/components/feedback'
import { ComputedMetricEditor } from '../ComputedMetricEditor'
import { PlaceRuleFields } from '../PlaceRuleFields'
import { SystemComponentRuleFields } from '../SystemComponentRuleFields'
import { SignalOperandFields } from './SignalOperandFields'
import type { AlertRuleEditorController } from '../../hooks/useAlertRuleEditorController'

export function ConditionFields({ controller }: { controller: AlertRuleEditorController }) {
  const { t, editor, setEditor, metricsState, computedMetricsQuery, computedMetrics } = controller
  if (editor.kind === 'system_component') {
    return (
      <SystemComponentRuleFields
        component={editor.component_name}
        transition={editor.transition}
        onChange={(component_name, transition) => setEditor(s => ({ ...s, component_name, transition }))}
      />
    )
  }
  if (editor.kind === 'place') {
    return (
      <PlaceRuleFields
        placeId={editor.place_id}
        transition={editor.transition}
        onChange={(place_id, transition) => setEditor(s => ({ ...s, place_id, transition }))}
      />
    )
  }
  if (editor.kind === 'computed_metric') {
    return (
      <>
        <StaleRefreshWarning state={metricsState} label={t('notifications.alertStudio.computedMetric.metric', 'Metric')} />
        {metricsState.fatalError && <QueryError error={metricsState.fatalError} onRetry={() => { void computedMetricsQuery.refetch(); }} />}
        <ComputedMetricEditor
          value={{
            metric_id: editor.metric_id,
            metric_window: editor.metric_window,
            metric_op: editor.metric_op,
            metric_threshold: editor.metric_threshold,
            vehicle_id: editor.vehicle_selection.kind === 'specific' && editor.vehicle_selection.vehicle_ids.length > 0
              ? editor.vehicle_selection.vehicle_ids[0] : null,
          }}
          onChange={next => setEditor(s => ({
            ...s,
            metric_id: next.metric_id,
            metric_window: next.metric_window,
            metric_op: next.metric_op,
            metric_threshold: next.metric_threshold,
          }))}
          metrics={computedMetrics}
          loading={computedMetricsQuery.isLoading && !metricsState.hasData}
        />
      </>
    )
  }
  return <SignalOperandFields controller={controller} />
}
