import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { Radio, RefreshCw } from 'lucide-react';
import { useAvailableSignals } from '@/api/hooks/useSignals';
import { useFleetTelemetryCoverage } from '@/api/hooks/useFleetTelemetry';
import { useVehicleLiveSignals } from '@/api/hooks/useTelemetry';
import { useVehicles } from '@/api/hooks/useVehicles';
import { combineDataStates } from '@/api/dataState';
import { KVList } from '@/components/data-display';
import { Caption, Code, IconButton, PanelTitle } from '@/components/ui';
import { SourceContent } from '@/components/layout';
import { useDataState } from '@/hooks/useDataState';
import { useDateFormat } from '@/hooks/useDateFormat';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';
import { useTicker } from '@/hooks/useTicker';
import { normalizeSignalKind } from '@/lib/signalKind';
import { sourceBoundaryState } from '../components/continuation-dashboard-1/sourceBoundary';
import { WidgetShell } from './WidgetShell';
import { WidgetBigNumber } from './shared';
import InstrumentPresentation from './designPacks/InstrumentPresentation';
import type { WidgetProps } from './types';

function evidence(raw: unknown, now: number, charge: boolean) {
  const entry = raw != null && typeof raw === 'object' ? raw as Record<string, unknown> : {};
  const kind = normalizeSignalKind(entry.kind, entry.value);
  const value = entry.value;
  const valid = kind === 'float' || kind === 'int'
    ? typeof value === 'number' && Number.isFinite(value) && (kind !== 'int' || Number.isSafeInteger(value))
      && (!charge || (value >= 0 && value <= 100))
    : kind === 'bool' ? typeof value === 'boolean'
      : kind === 'string' ? typeof value === 'string'
        : kind === 'time' && typeof value === 'string' && Number.isFinite(Date.parse(value));
  const timestamp = entry.ts ?? entry.timestamp;
  const instant = typeof timestamp === 'string' ? Date.parse(timestamp) : Number.NaN;
  const at = valid && Number.isFinite(instant) && instant > 0 && instant <= now ? instant : null;
  const age = typeof entry.age_ms === 'number' && Number.isFinite(entry.age_ms) && entry.age_ms >= 0 ? entry.age_ms : null;
  const stale = at != null && (now - at > 120_000 || entry.source === 'stale' || (age != null && age > 120_000));
  const fresh = at != null && !stale && (entry.age_ms == null || age != null) && (entry.source === 'l1' || entry.source === 'l2');
  return { at, stale, fresh };
}

export default function SignalReadinessWidget({ vehicleId, config, size }: WidgetProps) {
  const { t } = useTranslation('dashboard');
  const { fmtInt } = useNumberFormatting();
  const { formatDateTime } = useDateFormat();
  const vehiclesQuery = useVehicles();
  const selected = vehicleId ?? config?.vehicleId ?? vehiclesQuery.data?.[0]?.id;
  const id = typeof selected === 'number' && Number.isSafeInteger(selected) && selected > 0 ? selected : 0;
  const catalogQuery = useAvailableSignals(id);
  const routingQuery = useFleetTelemetryCoverage();
  const liveQuery = useVehicleLiveSignals(id || undefined, { refetchInterval: 5_000 });
  useTicker(id > 0);
  const catalogState = useDataState(catalogQuery);
  const routingState = useDataState(routingQuery);
  const liveState = useDataState(liveQuery, { provenance: 'live', maxAgeMs: 120_000 });
  const vehiclesState = useDataState(vehiclesQuery);
  const compact = size.cols <= 1;
  const unknown = t('common.unknown', 'Unknown');
  const count = (value: number | null) => value == null ? unknown : fmtInt(value);
  const catalog = catalogQuery.data?.vehicle_id === id ? catalogQuery.data : undefined;
  const live = liveQuery.data?.vehicle_id === id ? liveQuery.data : undefined;
  const definitions = catalog?.signals ?? [];
  const routes = [...new Map((routingQuery.data?.categories ?? [])
    .flatMap(category => category.fields ?? []).map(route => [route.field, route])).values()];
  const dropped = routes.filter(route => route.destination === 'drop');
  const chargeFields = new Set(definitions.filter(field => field.unit_kind === 'charge').map(field => field.name));
  const now = Date.now();
  const readings = Object.entries(live?.signals ?? {}).map(([name, raw]) => evidence(raw, now, chargeFields.has(name)));
  const observed = readings.filter(row => row.at != null);
  const retained = liveState.status === 'stale' || liveState.isRefreshBlocked;
  const snapshotKnown = live != null && live.signals != null;
  const classified = readings.some(row => row.fresh || row.stale);
  const latest = observed.reduce((at, row) => Math.max(at, row.at ?? 0), 0);
  const note = t('dashboardWidgets.telemetry.signalReadiness.definitionNote', 'Catalog definitions are not proof that a vehicle is configured or has reported a signal.');
  const catalogLabel = t('dashboardWidgets.telemetry.signalReadiness.catalog', 'Repository signal catalog');
  const routingLabel = t('dashboardWidgets.telemetry.signalReadiness.routing', 'Server subscription and routing');
  const snapshotLabel = t('dashboardWidgets.telemetry.signalReadiness.snapshot', 'Selected vehicle snapshot');
  const configLabel = t('dashboardWidgets.telemetry.signalReadiness.configuration', 'Vehicle configuration evidence');
  const refresh = () => {
    void routingQuery.refetch();
    if (id) { void catalogQuery.refetch(); void liveQuery.refetch(); }
    else void vehiclesQuery.refetch();
  };
  const headline = <WidgetBigNumber animated={false} value={catalog ? fmtInt(definitions.length) : null}
    label={catalogLabel} unit={t('dashboardWidgets.telemetry.signalReadiness.defined', 'defined')} />;
  const catalogContent = (
    <section aria-label={catalogLabel} className="min-w-0 space-y-2">
      {headline}
      <SourceContent state={!id ? 'empty' : sourceBoundaryState(catalogState, catalog != null)}
        label={catalogLabel} emptyMessage={t('dashboardWidgets.telemetry.signalReadiness.selectVehicle', 'Select a vehicle to inspect signal readiness.')}
        errorMessage={t('dashboardWidgets.telemetry.signalReadiness.catalogError', 'Signal catalog unavailable')} error={catalogState.fatalError}
        errorRecovery={{ onRetry: () => { if (id) void catalogQuery.refetch(); else void vehiclesQuery.refetch(); } }}>
        {definitions.length === 0 && <Caption as="p">{t('dashboardWidgets.telemetry.signalReadiness.catalogEmpty', 'The catalog returned no definitions.')}</Caption>}
      </SourceContent>
      {!id && vehiclesState.fatalError && <Caption as="p">{t('dashboardWidgets.telemetry.signalReadiness.vehiclesError', 'Vehicle selection could not be loaded. Retry refresh.')}</Caption>}
      <Caption as="p">{note}</Caption>
    </section>
  );
  const routingContent = (
    <section aria-label={routingLabel} className="min-w-0 space-y-2">
      <PanelTitle>{routingLabel}</PanelTitle>
      <SourceContent state={sourceBoundaryState(routingState, routingQuery.data != null)}
        label={routingLabel} emptyMessage={t('dashboardWidgets.telemetry.signalReadiness.routingEmpty', 'No routing evidence was returned.')}
        errorMessage={t('dashboardWidgets.telemetry.signalReadiness.routingError', 'Routing evidence unavailable')} error={routingState.fatalError}
        errorRecovery={{ onRetry: () => { void routingQuery.refetch(); } }}>
        <KVList wrap layout={compact ? 'stacked' : 'responsive'} items={[
          { id: 'desired', label: t('dashboardWidgets.telemetry.signalReadiness.desired', 'Desired by server'), value: count(routes.length ? routes.filter(route => route.subscribed === true).length : null) },
          { id: 'dropped', label: t('dashboardWidgets.telemetry.signalReadiness.dropped', 'Dropped by routing'), value: count(routes.length ? dropped.length : null) },
        ]} />
        {dropped.map(route => <Code key={route.field} as="p" className="break-all">{route.field}</Code>)}
      </SourceContent>
      <Caption as="p">{t('dashboardWidgets.telemetry.signalReadiness.routingNote', 'Server intent and routing are not vehicle-applied configuration or delivery receipts.')}</Caption>
    </section>
  );
  const snapshotContent = (
    <section aria-label={snapshotLabel} className="min-w-0 space-y-2">
      <PanelTitle>{snapshotLabel}</PanelTitle>
      <SourceContent state={!id ? 'empty' : sourceBoundaryState(liveState, snapshotKnown)}
        label={snapshotLabel} emptyMessage={t('dashboardWidgets.telemetry.signalReadiness.noEvidence', 'No observed signal evidence is available for this vehicle.')}
        errorMessage={t('dashboardWidgets.telemetry.signalReadiness.liveError', 'Vehicle signal evidence unavailable')} error={liveState.fatalError}
        errorRecovery={{ onRetry: () => { if (id) void liveQuery.refetch(); } }}>
        <KVList wrap layout={compact ? 'stacked' : 'responsive'} items={[
          { id: 'observed', label: t('dashboardWidgets.telemetry.signalReadiness.observed', 'Observed in snapshot'), value: count(observed.length ? observed.length : null) },
          { id: 'fresh', label: t('dashboardWidgets.telemetry.signalReadiness.fresh', 'Fresh observations'), value: count(classified && !retained ? readings.filter(row => row.fresh).length : null) },
          { id: 'stale', label: t('dashboardWidgets.telemetry.signalReadiness.stale', 'Stale observations'), value: count(classified && !retained ? readings.filter(row => row.stale).length : null) },
          { id: 'unknown', label: t('dashboardWidgets.telemetry.signalReadiness.unknownFreshness', 'Unknown freshness or invalid evidence'), value: count(readings.length ? readings.filter(row => retained || (!row.fresh && !row.stale)).length : null) },
          { id: 'latest', label: t('dashboardWidgets.telemetry.signalReadiness.latest', 'Latest observed timestamp'), value: latest > 0 ? <time dateTime={new Date(latest).toISOString()}>{formatDateTime(new Date(latest))}</time> : unknown },
        ]} />
        {readings.length === 0 && <Caption as="p">{t('dashboardWidgets.telemetry.signalReadiness.emptySnapshot', 'This snapshot contains no reported signals; vehicle support remains unknown.')}</Caption>}
      </SourceContent>
      <Caption as="p">{t('dashboardWidgets.telemetry.signalReadiness.snapshotNote', 'Fresh means timestamped, source-classified evidence no older than two minutes. Counts refer to this snapshot, not all-time reports; compound catalog parents and live child fields are different identities.')}</Caption>
    </section>
  );
  const configurationContent = (
    <section aria-label={configLabel} className="min-w-0 space-y-2">
      <PanelTitle>{configLabel}</PanelTitle>
      <KVList wrap layout={compact ? 'stacked' : 'responsive'} items={[
        { id: 'configured', label: t('dashboardWidgets.telemetry.signalReadiness.configured', 'Configured on vehicle'), value: unknown },
        { id: 'applied', label: t('dashboardWidgets.telemetry.signalReadiness.applied', 'Applied to vehicle'), value: unknown },
        { id: 'supported', label: t('dashboardWidgets.telemetry.signalReadiness.supported', 'Vehicle-supported signals'), value: unknown },
      ]} />
    </section>
  );
  const sources = [catalogState, routingState, ...(id ? [liveState] : [vehiclesState])];
  const combined = combineDataStates(sources);
  const fetching = catalogQuery.isFetching || routingQuery.isFetching || liveQuery.isFetching || (!id && vehiclesQuery.isFetching);
  const body = <InstrumentPresentation family="status" compact={compact} icon={<Radio aria-hidden="true" />}
    headline={catalogContent} instrument={snapshotContent}
    context={routingContent} details={configurationContent}>
    <div className="min-w-0 space-y-4">{catalogContent}{routingContent}{snapshotContent}{configurationContent}</div>
  </InstrumentPresentation>;
  return (
    <WidgetShell title={t('dashboardWidgets.telemetry.signalReadiness.title', 'Signal readiness & provenance')} icon={<Radio />}
      dataState={{ ...catalogState, ...combined, fatalError: null }} loadingContent={body}
      updatedAt={classified ? latest : undefined} isFetching={fetching}
      isStale={combined.status === 'stale' || readings.some(row => row.stale)}
      isError={sources.some(source => source.fatalError != null || source.refreshError != null)}
      onRefresh={refresh} actions={!classified ? <IconButton icon={<RefreshCw aria-hidden="true" />} onClick={refresh}
        disabled={fetching} busy={fetching} label={t('common.refresh', 'Refresh')} /> : undefined}
      footer={<Link to="/signals" className="text-[var(--accent-primary)] hover:underline">
        <Caption className="text-inherit">{t('dashboardWidgets.telemetry.signalReadiness.browse', 'Inspect signals')}</Caption>
      </Link>}>
      {body}
    </WidgetShell>
  );
}
