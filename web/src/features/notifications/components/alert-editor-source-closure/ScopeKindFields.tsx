import type { AlertRuleKind } from '@/api/types'
import { HelpIcon, Tabs, HelperText } from '@/components/ui'
import { VehicleMultiSelect } from '@/components/forms'
import { StaleRefreshWarning, QueryError } from '@/components/feedback'
import { fieldLabelRowCls } from './inputValues'
import type { AlertRuleEditorController } from '../../hooks/useAlertRuleEditorController'

export function ScopeKindFields({ controller }: { controller: AlertRuleEditorController }) {
  const { t, editor, setEditor, vehicles, vehiclesState, vehiclesQuery } = controller
  return (
    <div className="mb-4 grid grid-cols-1 gap-4 sm:grid-cols-3">
      {editor.kind !== 'system_component' && <div>
        <label className={fieldLabelRowCls} htmlFor="alert-vehicle-picker">
          {t('notifications.alertStudio.editor.vehiclesLabel', 'Vehicles')}
          <HelpIcon i18nKey="help.fields.alertStudio.vehicles" content="Choose 'All vehicles' to apply this rule to your entire fleet, including any cars you add later. Otherwise pick a specific subset." for="alert-vehicle-picker" />
        </label>
        <VehicleMultiSelect
          id="alert-vehicle-picker"
          value={editor.vehicle_selection}
          onChange={next => setEditor(s => ({ ...s, vehicle_selection: next }))}
          vehicles={vehicles}
          errorKey={
            editor.vehicle_selection.kind === 'specific' && editor.vehicle_selection.vehicle_ids.length === 0
              ? 'notifications.alertStudio.editor.vehiclesEmptyError' : null
          }
        />
        <StaleRefreshWarning state={vehiclesState} label={t('notifications.alertStudio.editor.vehiclesLabel', 'Vehicles')} />
        {vehiclesState.fatalError && <QueryError error={vehiclesState.fatalError} onRetry={() => { void vehiclesQuery.refetch(); }} />}
      </div>}
      <div className="sm:col-span-2">
        <div className={fieldLabelRowCls}>
          <span id="alert-kind-label">{t('notifications.alertStudio.editor.kindLabel', 'Rule type')}</span>
          <HelpIcon i18nKey="help.fields.alertStudio.kind" content="Choose a live signal, computed metric, system health transition, or place arrival/departure to monitor." for="alert-kind-label" />
        </div>
        <Tabs
          ariaLabel={t('notifications.alertStudio.editor.kindLabel', 'Rule type')}
          activeTab={editor.kind}
          onChange={key => setEditor(s => ({
            ...s,
            kind: key as AlertRuleKind,
            transition: key === 'place' ? 'enter' : key === 'system_component' ? 'outage' : s.transition,
            vehicle_selection: key === 'system_component' ? { kind: 'all_sticky' } : s.vehicle_selection,
          }))}
          tabs={[
            { key: 'signal', label: t('notifications.alertStudio.kind.signal', 'Signal threshold') },
            { key: 'computed_metric', label: t('notifications.alertStudio.kind.computedMetric', 'Computed metric') },
            { key: 'system_component', label: t('notifications.alertStudio.kind.system', 'System service') },
            { key: 'place', label: t('notifications.alertStudio.kind.place', 'Place event') },
          ]}
        />
        <HelperText className="mt-1">
          {editor.kind === 'computed_metric'
            ? t('notifications.alertStudio.kind.computedMetricHint', 'Aggregate metric (cost, kWh, distance) over a time window.')
            : editor.kind === 'system_component'
              ? t('notifications.alertStudio.kind.systemHint', 'Notify when a monitored system service fails or recovers.')
              : editor.kind === 'place'
                ? t('notifications.alertStudio.kind.placeHint', 'Notify when a vehicle arrives at or departs from a saved place.')
                : t('notifications.alertStudio.kind.signalHint', 'Fires when a raw telemetry signal crosses a threshold.')}
        </HelperText>
      </div>
    </div>
  )
}
