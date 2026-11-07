import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { RefreshCw, Shield } from 'lucide-react';
import { useVehicles } from '@/api/hooks/useVehicles';
import { useSignalHistory, useVehicleLiveSignals } from '@/api/hooks/useTelemetry';
import type { DataState } from '@/api/dataState';
import { SourceContent, type SourceState } from '@/components/layout';
import { Timeline } from '@/components/data-display';
import { Button, Caption, PanelTitle, Select, Text } from '@/components/ui';
import { useDataState } from '@/hooks/useDataState';
import { useDateFormat } from '@/hooks/useDateFormat';
import { useRangeState } from '@/hooks/useRangeState';
import { WidgetShell } from './WidgetShell';
import { WidgetDetailCard } from './shared';
import InstrumentPresentation from './designPacks/InstrumentPresentation';
import type { WidgetProps } from './types';
const SETTINGS = [
  { field: 'AutomaticEmergencyBrakingOff', key: 'braking', label: 'Emergency braking', kind: 'ValueKindBool' },
  { field: 'LaneDepartureAvoidance', key: 'lane', label: 'Lane departure', kind: 'ValueKindEnum' },
  { field: 'AutomaticBlindSpotCamera', key: 'camera', label: 'Blind-spot camera', kind: 'ValueKindBool' },
  { field: 'CruiseFollowDistance', key: 'follow', label: 'Follow distance', kind: 'ValueKindEnum' },
  { field: 'BlindSpotCollisionWarningChime', key: 'chime', label: 'Blind-spot warning chime', kind: 'ValueKindBool' },
  { field: 'ForwardCollisionWarning', key: 'collision', label: 'Forward collision warning', kind: 'ValueKindEnum' },
  { field: 'EmergencyLaneDepartureAvoidance', key: 'emergencyLane', label: 'Emergency lane departure avoidance', kind: 'ValueKindBool' },
  { field: 'AutomaticEmergencyBrakingState', key: 'brakingState', label: 'Reported emergency braking state', kind: 'ValueKindEnum' },
] as const;
type Setting = typeof SETTINGS[number];
type Field = Setting['field'];
type SettingValue = boolean | string | null;
const ENUMS: Partial<Record<Field, readonly string[]>> = {
  LaneDepartureAvoidance: ['None', 'Warning', 'Assist'],
  ForwardCollisionWarning: ['Off', 'Late', 'Average', 'Early'],
  CruiseFollowDistance: ['1', '2', '3', '4', '5', '6', '7'],
  AutomaticEmergencyBrakingState: ['Unavailable', 'Standby', 'Enabled', 'Standstill'],
};
const ENUM_COPY: Record<string, readonly [string, string]> = {
  None: ['none', 'None'], Warning: ['warning', 'Warning'], Assist: ['assist', 'Assist'],
  Off: ['off', 'Off'], Late: ['late', 'Late'], Average: ['average', 'Average'], Early: ['early', 'Early'],
  Unavailable: ['unavailable', 'Unavailable'], Standby: ['standby', 'Standby'],
  Enabled: ['enabled', 'Enabled'], Standstill: ['standstill', 'Standstill'],
};
function settingValue(setting: Setting, kind: unknown, value: unknown): SettingValue {
  if (kind !== setting.kind) return null;
  if (setting.kind === 'ValueKindBool') return typeof value === 'boolean' ? value : null;
  return typeof value === 'string' && ENUMS[setting.field]?.includes(value) ? value : null;
}
function instant(value: unknown): number | null {
  const at = typeof value === 'string' ? Date.parse(value) : Number.NaN;
  return Number.isFinite(at) && at > 0 && at <= Date.now() ? at : null;
}
function sourceState(state: DataState<unknown>, hasContent = true): SourceState {
  if (state.fatalError) return 'error';
  if (state.status === 'initial') return 'loading';
  return state.refreshError || state.isRefreshBlocked || state.status === 'stale'
    ? 'retained' : hasContent ? 'ready' : 'empty';
}
export default function DriverAssistWidget({ vehicleId, size, config }: WidgetProps) {
  const { t } = useTranslation('dashboard');
  const { formatDateTime } = useDateFormat();
  const range = useRangeState();
  const vehicleQuery = useVehicles();
  const vehicleState = useDataState(vehicleQuery);
  const requestedId = vehicleId ?? config?.vehicleId ?? vehicleQuery.data?.[0]?.id ?? 0;
  const id = Number.isSafeInteger(requestedId) && requestedId > 0 ? requestedId : 0;
  const compact = size.cols <= 1;
  const [field, setField] = useState<Field>('AutomaticEmergencyBrakingOff');
  const selected = SETTINGS.find(setting => setting.field === field) ?? SETTINGS[0];
  const liveQuery = useVehicleLiveSignals(id || undefined, { refetchInterval: 5_000 });
  const historyQuery = useSignalHistory(id, field, 24, range);
  const liveState = useDataState(liveQuery, { provenance: 'live', maxAgeMs: 120_000 });
  const historyState = useDataState(historyQuery, { provenance: 'historical' });
  const unknown = t('common.unknown', 'Unknown');
  const settingsLabel = t('dashboardWidgets.driving.driverAssist.settings', 'Reported settings');
  const historyLabel = t('dashboardWidgets.driving.driverAssist.history', 'Reported changes and samples');
  const label = (setting: Setting) => t(`dashboardWidgets.driving.driverAssist.${setting.key}`, setting.label);
  function displayValue(setting: Setting, value: SettingValue): string {
    if (value == null) return unknown;
    if (typeof value === 'boolean') {
      const enabled = setting.field === 'AutomaticEmergencyBrakingOff' ? !value : value;
      return enabled ? t('widget.safety.enabled', 'Enabled') : t('widget.safety.disabled', 'Disabled');
    }
    const copy = ENUM_COPY[value];
    return copy ? t(`dashboardWidgets.driving.driverAssist.values.${copy[0]}`, copy[1]) : value;
  }
  const time = (value: unknown) => {
    const at = instant(value);
    return at == null ? unknown : formatDateTime(at);
  };
  const entries = SETTINGS.map(setting => {
    const raw = liveQuery.data?.signals?.[setting.field];
    const signal = raw != null && typeof raw === 'object' ? raw as Record<string, unknown> : {};
    const value = settingValue(setting, signal.kind, signal.value);
    const at = instant(signal.ts ?? signal.timestamp);
    const source = typeof signal.source === 'string' ? signal.source : unknown;
    const ageValid = signal.age_ms === undefined || (typeof signal.age_ms === 'number'
      && Number.isFinite(signal.age_ms) && signal.age_ms >= 0);
    let freshness = t('dashboardWidgets.driving.signalExplorer.freshnessUnknown', 'Freshness unknown');
    if (value != null && at != null && ageValid) {
      if (liveState.refreshError || liveState.isRefreshBlocked || liveState.status === 'stale') {
        freshness = t('dashboardWidgets.driving.signalExplorer.retained', 'Retained snapshot');
      } else if (source === 'log') freshness = t('dashboardWidgets.driving.signalExplorer.historical', 'Historical fallback');
      else if (source === 'stale' || Date.now() - at > 120_000
        || (typeof signal.age_ms === 'number' && signal.age_ms > 120_000)) {
        freshness = t('dashboardWidgets.driving.signalExplorer.stale', 'Stale observation');
      } else if (source === 'l1' || source === 'l2') freshness = t('dashboardWidgets.driving.signalExplorer.fresh', 'Fresh observation');
    }
    return {
      id: setting.field, label: label(setting), value: displayValue(setting, value), sublabel: freshness, hasValue: value != null,
      hint: t('dashboardWidgets.driving.driverAssist.observation', 'Observed: {{time}} · Source: {{source}}', {
        time: at == null ? unknown : formatDateTime(at), source,
      }),
    };
  });
  const samples = useMemo(() => {
    let previous: { value: Exclude<SettingValue, null>; at: number } | null = null;
    return (historyQuery.data?.data ?? []).map(point => {
      const value = settingValue(selected, point.kind, point.value);
      const at = instant(point.ts);
      const before = previous && at != null && at > previous.at && value != null && value !== previous.value
        ? previous.value : null;
      previous = value != null && at != null ? { value, at } : null;
      return { ...point, value, before };
    }).reverse();
  }, [historyQuery.data, selected]);
  function refresh() {
    if (id > 0) { void liveQuery.refetch(); void historyQuery.refetch(); }
    else void vehicleQuery.refetch();
  }
  const settings = (
    <section aria-label={settingsLabel} className="min-w-0 space-y-3">
      <PanelTitle>{settingsLabel}</PanelTitle>
      <SourceContent state={id > 0 ? sourceState(liveState)
        : vehicleState.fatalError ? 'error' : vehicleQuery.isLoading ? 'loading' : 'empty'}
        label={settingsLabel} error={id > 0 ? liveState.fatalError : vehicleState.fatalError}
        errorMessage={t('dashboardWidgets.driving.driverAssist.liveError', 'Reported settings could not be loaded.')}
        emptyMessage={t('dashboardWidgets.driving.driverAssist.vehicleRequired', 'Select a vehicle to inspect reported driver-assistance settings.')}
        errorRecovery={{ onRetry: () => { if (id > 0) void liveQuery.refetch(); else void vehicleQuery.refetch(); } }}>
        <div className={compact ? 'max-h-64 overflow-y-auto' : 'max-h-96 overflow-y-auto'}><WidgetDetailCard entries={entries} /></div>
        {!entries.some(entry => entry.hasValue) && <Caption className="block">
          {t('dashboardWidgets.driving.driverAssist.empty', 'No valid reported settings in this snapshot. Missing evidence does not mean disabled or unsupported.')}
        </Caption>}
      </SourceContent>
    </section>
  );
  const history = (
    <section aria-label={historyLabel} className="min-w-0 space-y-3">
      <PanelTitle>{historyLabel}</PanelTitle>
      <Select label={t('dashboardWidgets.driving.driverAssist.historySetting', 'History setting')} value={field}
        options={SETTINGS.map(setting => ({ value: setting.field, label: label(setting) }))}
        onChange={event => {
          const setting = SETTINGS.find(item => item.field === event.target.value);
          if (setting) setField(setting.field);
        }} />
      <Caption className="block">{formatDateTime(range.startInstant)} — {formatDateTime(range.endInstantExclusive)}</Caption>
      <SourceContent state={id > 0 ? sourceState(historyState, samples.length > 0) : 'empty'}
        label={historyLabel} error={historyState.fatalError}
        errorMessage={t('dashboardWidgets.driving.signalExplorer.historyError', 'Signal history could not be loaded.')}
        emptyMessage={id > 0 ? t('dashboardWidgets.driving.signalExplorer.historyEmpty', 'No recorded samples in the selected workspace range.')
          : t('dashboardWidgets.driving.driverAssist.vehicleRequired', 'Select a vehicle to inspect reported driver-assistance settings.')}
        errorRecovery={{ onRetry: () => { if (id > 0) void historyQuery.refetch(); } }}>
        <div className={compact ? 'max-h-56 overflow-y-auto' : 'max-h-80 overflow-y-auto'}>
          <Timeline label={historyLabel} items={samples.map(point => ({
            title: point.before != null
              ? t('dashboardWidgets.driving.driverAssist.change', '{{before}} → {{after}}', {
                before: displayValue(selected, point.before), after: displayValue(selected, point.value),
              }) : t('dashboardWidgets.driving.driverAssist.reported', 'Reported: {{value}}', { value: displayValue(selected, point.value) }),
            time: time(point.ts),
            subtitle: t('dashboardWidgets.driving.signalExplorer.historyProvenance', 'Origin: {{origin}} · Emitted: {{emitted}} · Received: {{received}}', {
              origin: point.ingest_origin ?? unknown, emitted: time(point.source_emitted_at), received: time(point.received_at),
            }),
          }))} />
        </div>
      </SourceContent>
      <Caption className="block">{historyState.hasData
        ? t('dashboardWidgets.driving.signalExplorer.samples', '{{count}} recorded samples returned. Server limits may truncate the selected range.', { count: samples.length })
        : t('dashboardWidgets.driving.driverAssist.historyUnknown', 'Recorded sample count is unknown until history loads.')}</Caption>
      <Caption className="block">{t('dashboardWidgets.driving.driverAssist.historyNote', 'Changes compare adjacent valid reports only. Unknown samples break comparisons; repeated reports are not changes. History does not prove a live observation.')}</Caption>
    </section>
  );
  const headline = <div className="min-w-0">
    <Text variant="metricValue" className="block break-words">{t('dashboardWidgets.driving.driverAssist.configuration', 'Configuration')}</Text>
    <Caption>{t('dashboardWidgets.driving.driverAssist.assistance', 'Driver assistance')}</Caption>
  </div>;
  const context = <div className="space-y-2">
    <Caption className="block">{t('dashboardWidgets.driving.driverAssist.note', 'Configuration and change history are not evidence of system activations.')}</Caption>
    <Caption className="block">{t('dashboardWidgets.driving.driverAssist.evidence', 'Vehicle support and desired/applied telemetry configuration are unknown. Reported values are separate from configured or routed signals. Follow distance is a setting, not a measured distance.')}</Caption>
  </div>;
  return (
    <WidgetShell title={t('dashboardWidgets.driving.driverAssist.title', 'Driver-assist settings')} icon={<Shield aria-hidden="true" className="size-4" />}
      updatedAt={liveState.updatedAt ?? 0} isFetching={liveQuery.isFetching || historyQuery.isFetching}
      isStale={liveState.status === 'stale'} isError={liveQuery.isError} onRefresh={refresh}
      actions={<Button variant="ghost" size="sm" className="min-h-11 md:min-h-9" onClick={refresh}
        disabled={liveQuery.isFetching || historyQuery.isFetching || (id === 0 && vehicleQuery.isFetching)}
        aria-label={t('dashboardWidgets.driving.driverAssist.refresh', 'Refresh driver-assistance evidence')}><RefreshCw aria-hidden="true" className="size-4" /></Button>}>
      <InstrumentPresentation family="status" compact={compact} headline={headline}
        icon={<Shield aria-hidden="true" className="size-6" />} context={context} instrument={settings} details={history}>
        <div className="min-w-0 space-y-4">{headline}{context}{settings}{history}</div>
      </InstrumentPresentation>
    </WidgetShell>
  );
}
