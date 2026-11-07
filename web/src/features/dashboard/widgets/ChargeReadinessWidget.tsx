import { PlugZap } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { deriveDataState } from '@/api/dataState';
import { useVehicleLiveSignals, type VehicleLiveSignal } from '@/api/hooks/useTelemetry';
import { useVehicles } from '@/api/hooks/useVehicles';
import { Accordion, Caption, HelperText, MetricLabel, MetricValue } from '@/components/ui';
import { QueryError, StaleRefreshWarning } from '@/components/feedback';
import { useDateFormat } from '@/hooks/useDateFormat';
import { useTicker } from '@/hooks/useTicker';
import { INTERVALS } from '@/lib/constants';
import { WidgetShell } from './WidgetShell';
import { WidgetDetailCard, WidgetStatusGrid, type DetailEntry, type StatusCell } from './shared';
import InstrumentPresentation from './designPacks/InstrumentPresentation';
import type { WidgetProps } from './types';

const chargeStates = {
  Disconnected: 'Disconnected', NoPower: 'No power', Starting: 'Starting',
  Charging: 'Charging', Complete: 'Complete', Stopped: 'Stopped',
};
const fields = [
  { name: 'ChargeState', label: 'Charge state', kind: 'string', values: chargeStates },
  { name: 'DetailedChargeState', label: 'Detailed charge state', kind: 'string', values: chargeStates },
  { name: 'ChargePort', label: 'Port type', kind: 'string', values: { US: 'US', EU: 'EU', GB: 'GB', CCS: 'CCS' } },
  { name: 'ChargePortDoorOpen', label: 'Port', kind: 'bool', values: { true: 'Open', false: 'Closed' } },
  { name: 'ChargePortLatch', label: 'Latch', kind: 'string', values: { Disengaged: 'Released', Engaged: 'Engaged', Blocking: 'Blocking' } },
  { name: 'ChargingCableType', label: 'Cable', kind: 'string', values: { IEC: 'IEC', SAE: 'SAE', GB_AC: 'GB AC', GB_DC: 'GB DC' } },
  { name: 'ScheduledChargingPending', label: 'Schedule', kind: 'bool', values: { true: 'Pending', false: 'Not pending' } },
  { name: 'ChargeEnableRequest', label: 'Charge enable request', kind: 'bool', values: { true: 'Requested', false: 'Not requested' } },
] as const;
const checklistFields = ['ChargePortDoorOpen', 'ChargePortLatch', 'ChargingCableType', 'ScheduledChargingPending'];
const MAX_AGE_MS = 120_000;
const sharedValueKeys: Record<string, string> = {
  Open: 'widget.doorWindow.open', Closed: 'widget.doorWindow.closed',
  Charging: 'widget.charging', Pending: 'widget.chargingSchedule.pending',
};

function isEnvelope(value: unknown): value is VehicleLiveSignal {
  return value != null && typeof value === 'object' && 'value' in value;
}

export default function ChargeReadinessWidget({ vehicleId, config, size }: WidgetProps) {
  const { t } = useTranslation('dashboard');
  const { formatDateTime } = useDateFormat();
  const vehicles = useVehicles();
  const requestedId = vehicleId ?? config?.vehicleId ?? vehicles.data?.[0]?.id;
  const id = typeof requestedId === 'number' && Number.isSafeInteger(requestedId) && requestedId > 0 ? requestedId : 0;
  const query = useVehicleLiveSignals(id, { refetchInterval: INTERVALS.REALTIME });
  const payload = id > 0 && query.data?.vehicle_id === id ? query.data : undefined;
  useTicker(payload != null);
  const now = Date.now();
  const compact = size.cols <= 1 && size.rows <= 1;
  const unknown = t('widget.status.unknown', 'Unknown');
  const loading = id > 0 ? query.isLoading : vehicles.isLoading;
  const retained = query.isError || query.error != null || query.fetchStatus === 'paused';
  const rows = fields.map(field => {
    const entry = payload?.signals?.[field.name];
    const envelope = isEnvelope(entry) ? entry : undefined;
    const choices: Record<string, string> = field.values;
    const raw = envelope?.value;
    const token = (field.kind === 'bool' && envelope?.kind === 'ValueKindBool' && typeof raw === 'boolean')
      || (field.kind === 'string' && envelope?.kind === 'ValueKindEnum' && typeof raw === 'string')
      ? String(raw) : '';
    const known = Object.prototype.hasOwnProperty.call(choices, token);
    const timestamp = Date.parse(typeof envelope?.ts === 'string' ? envelope.ts : '');
    const dated = Number.isFinite(timestamp) && timestamp > 0 && timestamp <= now;
    const expired = (dated && now - timestamp > MAX_AGE_MS) || envelope?.source === 'stale'
      || (typeof envelope?.age_ms === 'number' && envelope.age_ms > MAX_AGE_MS);
    const fresh = known && dated && !expired && !retained;
    const observed = envelope != null;
    const evidence = !observed ? t('dashboardWidgets.charging.chargeReadiness.notObserved', 'Not observed')
      : !dated ? t('dashboardWidgets.charging.chargeReadiness.timeUnknown', 'Observation time unknown')
      : retained ? t('dashboardWidgets.charging.chargeReadiness.retained', 'Retained observation')
      : expired ? t('dashboardWidgets.charging.chargeReadiness.stale', 'Stale observation')
      : t('dashboardWidgets.charging.chargeReadiness.fresh', 'Recent observation');
    const valueField = field.name === 'DetailedChargeState' ? 'ChargeState' : field.name;
    const value = loading ? t('dashboardWidgets.charging.chargeReadiness.loading', 'Loading charge signals…')
      : known ? t(sharedValueKeys[choices[token]] ?? `dashboardWidgets.charging.chargeReadiness.values.${valueField}.${token}`, choices[token]) : unknown;
    return {
      field: field.name, token, known, observed, fresh, dated, expired, timestamp, value,
      label: t(`dashboardWidgets.charging.chargeReadiness.fields.${field.name}`, field.label),
      hint: dated ? t('dashboardWidgets.charging.chargeReadiness.observedAt', '{{evidence}} · {{time}}', {
        evidence, time: formatDateTime(timestamp),
      }) : evidence,
      raw: observed ? String(raw) : undefined,
    };
  });
  const observed = rows.some(row => row.observed);
  const stale = rows.some(row => row.observed && (!row.dated || row.expired));
  const source = id > 0 ? query : vehicles;
  const baseTrust = deriveDataState<unknown>(id > 0 ? { ...query, data: payload } : vehicles, {
    provenance: id > 0 ? 'live' : 'cached', partial: rows.some(row => !row.known),
    unavailable: id === 0 || !observed, maxAgeMs: MAX_AGE_MS,
  });
  const trust = {
    ...baseTrust,
    status: !id && !vehicles.isLoading && !baseTrust.fatalError ? 'unavailable' as const
      : stale && baseTrust.hasData && !baseTrust.refreshError ? 'stale' as const : baseTrust.status,
    provenance: stale || retained ? 'cached' as const : baseTrust.provenance,
  };
  const refresh = () => { if (id > 0) void query.refetch(); else void vehicles.refetch(); };
  const coarse = rows[0];
  const detailed = rows[1];
  const conflict = coarse.fresh && detailed.fresh && coarse.token !== detailed.token;
  const charge = detailed.fresh ? detailed : coarse.fresh ? coarse : null;
  const headlineValue = loading ? t('dashboardWidgets.charging.chargeReadiness.loading', 'Loading charge signals…')
    : !charge || conflict ? unknown
    : charge.token === 'Charging' || charge.token === 'Starting' ? charge.value
    : t('widget.notCharging', 'Not charging');
  const headline = <div className="min-w-0 space-y-1">
    <MetricLabel>{t('dashboardWidgets.charging.chargeReadiness.label', 'Charge readiness')}</MetricLabel>
    <MetricValue className="break-words">{headlineValue}</MetricValue>
  </div>;
  const cells: StatusCell[] = rows.filter(row => checklistFields.includes(row.field)).map(row => ({
    id: row.field, label: row.label, value: row.value, statusLabel: row.hint,
    status: !row.known ? 'unknown' : !row.fresh ? 'warning' : 'inactive',
  }));
  const checklist = <WidgetStatusGrid cells={cells} compact={compact} />;
  const entries: DetailEntry[] = rows.map(row => ({
    id: row.field, label: row.label, sublabel: row.field, value: row.value,
    hint: !row.known && row.raw !== undefined
      ? t('dashboardWidgets.charging.chargeReadiness.unrecognized', '{{evidence}} · Reported: {{value}}', { evidence: row.hint, value: row.raw })
      : row.hint,
    status: !row.known ? 'neutral' : !row.fresh ? 'warning' : 'info',
  }));
  entries.push({
    id: 'power', label: t('dashboardWidgets.charging.chargeReadiness.availablePower', 'Available power'), value: unknown,
    hint: t('dashboardWidgets.charging.chargeReadiness.powerUnknown', 'These state signals do not measure available power.'),
  });
  const details = <Accordion
    title={t('dashboardWidgets.charging.chargeReadiness.evidence', 'Reported signal evidence')}
    defaultOpen={!compact} className="border-0 rounded-none"
    headerClassName="min-h-11 px-0 py-2" bodyClassName="px-0 py-2"
  >
    <WidgetDetailCard entries={entries} />
    <HelperText>{t('dashboardWidgets.charging.chargeReadiness.limits', 'Cable type does not confirm connection. A charge enable request does not confirm charging or permission to operate the port. Vehicle support and applied configuration are unknown.')}</HelperText>
  </Accordion>;
  const context = <div className="min-w-0 space-y-2">
    <Caption>{t('dashboardWidgets.charging.chargeReadiness.readOnly', 'Read-only vehicle observations')}</Caption>
    {!id && !loading && <HelperText>{t('dashboardWidgets.charging.chargeReadiness.selectVehicle', 'Select a vehicle to inspect charge readiness.')}</HelperText>}
    {id > 0 && !loading && !observed && !trust.fatalError && <HelperText>{t('dashboardWidgets.charging.chargeReadiness.noEvidence', 'No charge-readiness signals have been observed for this vehicle.')}</HelperText>}
    {conflict && <HelperText>{t('dashboardWidgets.charging.chargeReadiness.conflict', 'Reported charge states differ; review each source.')}</HelperText>}
    {trust.fatalError && <QueryError error={trust.fatalError} onRetry={refresh} />}
    <StaleRefreshWarning state={trust} hideRetry />
  </div>;
  const note = <HelperText>{t('dashboardWidgets.charging.chargeReadiness.note', 'Each reported state is shown separately. This widget does not operate the charge port. A successful poll does not renew signal observation times.')}</HelperText>;

  return (
    <WidgetShell title={t('dashboardWidgets.charging.chargeReadiness.title', 'Charge-port readiness')}
      icon={<PlugZap aria-hidden="true" />} updatedAt={source.dataUpdatedAt}
      isFetching={source.isFetching} isError={source.isError}
      isStale={source.isStale || stale || trust.isRefreshBlocked}
      refreshIntervalMs={INTERVALS.REALTIME} onRefresh={refresh}
    >
      <div className="min-w-0" data-data-state={trust.status} aria-busy={loading}>
        <InstrumentPresentation family="status" compact={compact} headline={headline}
          icon={<PlugZap />} context={context} instrument={checklist} details={<>{details}{note}</>}
        >
          <div className={compact ? 'flex min-w-0 flex-col gap-2' : 'flex min-w-0 flex-col gap-4'}>
            {context}
            <div className="flex items-center justify-between gap-3">
              {headline}<PlugZap className="size-6 shrink-0 text-[var(--text-secondary)]" aria-hidden="true" />
            </div>
            {checklist}{details}{note}
          </div>
        </InstrumentPresentation>
      </div>
    </WidgetShell>
  );
}
