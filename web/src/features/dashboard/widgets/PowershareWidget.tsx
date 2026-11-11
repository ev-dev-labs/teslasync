import { useTranslation } from 'react-i18next';
import { Car, PlugZap } from 'lucide-react';
import { useVehicleLiveSignals } from '@/api/hooks/useTelemetry';
import { knownNumber } from '@/api/dataState';
import { useDataState } from '@/hooks/useDataState';
import { useTicker } from '@/hooks/useTicker';
import { Caption, Code, Subhead } from '@/components/ui';
import { KVList } from '@/components/data-display';
import { EmptyState, QueryError, Skeleton } from '@/components/feedback';
import { WidgetShell } from './WidgetShell';
import { SignalObservation, WidgetBigNumber, WidgetFlowDiagram, type FlowNode } from './shared';
import InstrumentPresentation from './designPacks/InstrumentPresentation';
import type { WidgetProps } from './types';

const SIGNALS = [
  ['PowershareStatus', ['Unknown', 'Inactive', 'Handshaking', 'Init', 'Enabled', 'EnabledReconnectingSoon', 'Stopped']],
  ['PowershareInstantaneousPowerKW', null],
  ['PowershareHoursLeft', null],
  ['PowershareStopReason', ['Unknown', 'None', 'SOCTooLow', 'Retry', 'Fault', 'User', 'Reconnecting', 'Authentication']],
  ['PowershareType', ['Unknown', 'None', 'Load', 'Home']],
  ['PowerTransferStatus', ['Unknown', 'Standby', 'Faulted', 'EmergencyShutdown', 'ExtEvseTestAllowed', 'ExtPrechargeAllowed', 'ChargeEnabling', 'ChargeEnabled', 'GracefulShutdown', 'Blocked']],
] as const;

function readSignal(raw: unknown, name: string, values: readonly string[] | null, now: number) {
  const entry = raw != null && typeof raw === 'object' && 'value' in raw ? raw : null;
  const value: unknown = entry ? entry.value : raw;
  const number = knownNumber(value);
  const valid = values ? typeof value === 'string' && values.includes(value) && value !== 'Unknown'
    : number != null && (name !== 'PowershareHoursLeft' || number >= 0);
  const timestamp = entry && 'timestamp' in entry && typeof entry.timestamp === 'string'
    ? entry.timestamp : entry && 'ts' in entry ? entry.ts : null;
  const parsed = typeof timestamp === 'string' ? Date.parse(timestamp) : Number.NaN;
  const observedAt = Number.isFinite(parsed) && parsed > 0 && parsed <= now ? parsed : null;
  const source = entry && 'source' in entry && typeof entry.source === 'string' ? entry.source : null;
  const age = entry && 'age_ms' in entry ? knownNumber(entry.age_ms) : null;
  const stale = source === 'stale' || (observedAt != null && now - observedAt >= 120_000) || (age != null && age >= 120_000);
  return { name, value, valid, observedAt, source, stale,
    tracked: valid && observedAt != null && (source === 'l1' || source === 'l2' || source === 'stale'),
    rawText: number != null ? String(number) : typeof value === 'string' && value.trim() ? value : '—' };
}

export default function PowershareWidget({ vehicleId, config, size }: WidgetProps) {
  const { t } = useTranslation('dashboard');
  const selected = vehicleId ?? config?.vehicleId;
  const id = typeof selected === 'number' && Number.isSafeInteger(selected) && selected > 0 ? selected : undefined;
  const query = useVehicleLiveSignals(id, { refetchInterval: 5_000 });
  useTicker(id != null);
  const compact = size.cols <= 1;
  const now = Date.now();
  const rows = SIGNALS.map(([name, values]) => readSignal(query.data?.signals?.[name], name, values, now));
  const observed = rows.some((row) => row.valid && row.observedAt != null);
  const state = useDataState(query, { provenance: 'live', partial: observed && rows.some((row) => !row.tracked) });
  const unknown = t('dashboardWidgets.energy.powershare.unknown', 'Unknown');
  const lastReported = (index: number) => rows[index].valid && rows[index].observedAt != null
    ? String(rows[index].value) : unknown;
  const updatedAt = rows.reduce((latest, row) => Math.max(latest, row.tracked ? row.observedAt ?? 0 : 0), 0);
  const stale = rows.some((row) => row.stale) || state.status === 'stale';
  const refresh = () => { if (id) void query.refetch(); };
  const powerLabel = t('dashboardWidgets.energy.powershare.powerTransfer', 'Power transfer');
  const unitsNote = t('dashboardWidgets.energy.powershare.unitsUnverified', 'Power and remaining-time units are not verified by the signal contract. Raw observations are shown below without unit assumptions.');

  // Both numeric signals are UnitKindNone and bypass SI normalization. Do not
  // reinterpret their name suffixes as W/s, or introduce a second wire converter.
  const headline = <WidgetBigNumber value={null} label={powerLabel} animated={false} />;
  const nodes: FlowNode[] = [
    { id: 'vehicle', label: t('dashboardWidgets.energy.powershare.vehicle', 'Vehicle'), value: null,
      formattedValue: lastReported(0), icon: <Car aria-hidden="true" />, position: 'left' },
    { id: 'output', label: t('dashboardWidgets.energy.powershare.output', 'Output'), value: null,
      formattedValue: '—', icon: <PlugZap aria-hidden="true" />, position: 'right' },
  ];
  const flow = (
    <div className="widget-flow-frame h-40 min-w-0" data-motion-suppressed="true">
      <WidgetFlowDiagram nodes={nodes}
        // A neutral connection is topology only, not a measured zero or flow.
        arrows={[{ from: 'vehicle', to: 'output', value: null, active: false }]}
        ariaLabel={t('dashboardWidgets.energy.powershare.flowDescription', 'Vehicle to output. Transfer magnitude and direction are unverified.')}
      />
    </div>
  );
  const overview = (
    <KVList layout={compact ? 'stacked' : 'responsive'} wrap items={[
      { id: 'remaining', label: t('dashboardWidgets.energy.powershare.remaining', 'Remaining'), value: '—' },
      { id: 'status', label: t('dashboardWidgets.energy.powershare.status', 'Last reported status'), value: <Code>{lastReported(0)}</Code> },
      { id: 'stop', label: t('dashboardWidgets.energy.powershare.stopReason', 'Stop reason'), value: <Code>{lastReported(3)}</Code> },
      { id: 'type', label: t('dashboardWidgets.energy.powershare.type', 'Transfer type'), value: <Code>{lastReported(4)}</Code> },
      { id: 'transfer', label: t('dashboardWidgets.energy.powershare.transferStatus', 'Power transfer status'), value: <Code>{lastReported(5)}</Code> },
      { id: 'capability', label: t('dashboardWidgets.energy.powershare.support', 'Vehicle support'), value: unknown },
    ]} />
  );
  const context = (
    <div className="space-y-2">
      {!id ? <EmptyState variant="informational"
        message={t('dashboardWidgets.energy.powershare.selectVehicle', 'Select a vehicle to inspect Powershare telemetry.')} />
        : state.fatalError ? <QueryError compact error={state.fatalError} onRetry={refresh} />
          : query.isLoading ? <Skeleton className="h-8 w-full" />
            : !observed ? <EmptyState variant="informational"
              message={t('dashboardWidgets.energy.powershare.noEvidence', 'No timestamped Powershare observations for this vehicle.')}
              description={t('dashboardWidgets.energy.powershare.noEvidenceHint', 'Missing reports do not establish that the vehicle is unsupported.')} /> : null}
      <Caption as="p">{unitsNote}</Caption>
    </div>
  );
  const evidence = (
    <section className="min-w-0 space-y-2" aria-label={t('dashboardWidgets.energy.powershare.evidence', 'Signal evidence')}>
      <Subhead>{t('dashboardWidgets.energy.powershare.evidence', 'Signal evidence')}</Subhead>
      <ul data-app-part="list" className="space-y-2">
        {rows.map((row) => (
          <li key={row.name} className="min-w-0 border-b border-[var(--border-subtle)] pb-2 last:border-b-0">
            <div className="flex min-w-0 items-start justify-between gap-2">
              <Code className="min-w-0 break-all">{row.name}</Code>
            </div>
            {query.isLoading ? <Skeleton className="h-5 w-24" /> : <Code className="break-all">{row.rawText}</Code>}
            <SignalObservation observedAt={row.observedAt}
              source={row.source ?? t('dashboardWidgets.energy.powershare.sourceUnknown', 'Source unknown')}
              unknown={!row.tracked} stale={row.stale}
              retained={state.status === 'stale'} />
          </li>
        ))}
      </ul>
      <Caption as="p">{t('dashboardWidgets.energy.powershare.trustNote', 'Values are last reported observations, not proof of vehicle capability or applied configuration. Missing, stale or invalid evidence never starts flow animation.')}</Caption>
    </section>
  );
  const instrument = <div className="min-w-0 space-y-3">{flow}{evidence}</div>;
  const body = (
    <InstrumentPresentation family="flow" compact={compact} icon={<PlugZap aria-hidden="true" />}
      headline={headline} context={context} instrument={instrument} details={overview}>
      <div className="min-w-0 space-y-3">{context}{headline}{flow}{overview}{evidence}</div>
    </InstrumentPresentation>
  );
  return (
    <WidgetShell title={t('dashboardWidgets.energy.powershare.title', 'Powershare overview')} icon={<PlugZap />}
      dataState={{ ...state, status: !id ? 'unavailable' : stale && state.hasData ? 'stale' : state.status, fatalError: null }}
      loadingContent={body} updatedAt={updatedAt} isFetching={query.isFetching}
      isStale={stale}
      isError={query.isError} onRefresh={id ? refresh : undefined} refreshIntervalMs={5_000}>
      {body}
    </WidgetShell>
  );
}
