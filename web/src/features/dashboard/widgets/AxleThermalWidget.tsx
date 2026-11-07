import { Gauge } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { deriveDataState, knownNumber } from '@/api/dataState';
import { useVehicleLiveSignals } from '@/api/hooks/useTelemetry';
import { useVehicles } from '@/api/hooks/useVehicles';
import { KVList } from '@/components/data-display';
import { SourceContent } from '@/components/layout';
import { Badge, Caption, Code, MetricLabel, PanelTitle, Text } from '@/components/ui';
import { useDataState } from '@/hooks/useDataState';
import { useDateFormat } from '@/hooks/useDateFormat';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';
import { useTicker } from '@/hooks/useTicker';
import { useUnits } from '@/hooks/useUnits';
import { isLiveFieldFresh, liveFieldAge, LIVE_FRESHNESS_MS } from '@/hooks/useVehicleLive';
import { cn } from '@/lib/cn';
import { INTERVALS } from '@/lib/constants';
import { formatObservationAge } from '@/lib/observationAge';
import { normalizeSignalKind } from '@/lib/signalKind';
import { sourceBoundaryState } from '../components/continuation-dashboard-1/sourceBoundary';
import InstrumentPresentation from './designPacks/InstrumentPresentation';
import { usePackPresentation } from './designPacks/PackBoundary';
import { WidgetBigNumber } from './shared';
import { WidgetShell } from './WidgetShell';
import VehicleStudio from './vehicle-instruments/VehicleStudio';
import type { WidgetProps } from './types';

const STATES = ['Unknown', 'Unavailable', 'Standby', 'Fault', 'Abort', 'Enable'] as const;
type ReadingMode = 'temperature' | 'torque' | 'state';

function readEvidence(raw: unknown, mode: ReadingMode, now: number, receivedAt: number) {
  const entry = raw != null && typeof raw === 'object' && !Array.isArray(raw) ? raw as Record<string, unknown> : {};
  const kind = normalizeSignalKind(entry.kind);
  const number = knownNumber(entry.value);
  const token = typeof entry.value === 'string' ? entry.value.replace(/^DriveInverterState/, '') : '';
  const enumValue = (kind === 'int' || kind === 'string') && typeof entry.value === 'string'
    ? STATES.find(state => state === token)
    : kind === 'int' && number != null && Number.isInteger(number) ? STATES[number] : undefined;
  const value = mode === 'state' ? enumValue ?? null
    : (kind === 'float' || kind === 'int') && number != null && (kind !== 'int' || Number.isSafeInteger(number))
      && (mode !== 'temperature' || number >= -273.15) ? number : null;
  const timestamp = entry.ts ?? entry.timestamp;
  const parsed = typeof timestamp === 'string' ? Date.parse(timestamp) : Number.NaN;
  const at = Number.isFinite(parsed) && parsed > 0 && parsed <= now ? parsed : null;
  const age = knownNumber(entry.age_ms);
  const source = typeof entry.source === 'string' ? entry.source : 'unknown';
  const provenance = { observedAtMs: at, receivedAtMs: receivedAt, ageMs: age, source };
  const elapsed = liveFieldAge(provenance, now);
  return { value, at, source, stale: source === 'stale' || (elapsed != null && elapsed > LIVE_FRESHNESS_MS),
    fresh: value != null && (entry.age_ms == null || (age != null && age >= 0)) && isLiveFieldFresh(provenance, now) };
}

export default function AxleThermalWidget({ vehicleId, config, size }: WidgetProps) {
  const { t } = useTranslation('dashboard');
  const { t: commonT } = useTranslation();
  const { formatTemperature } = useUnits();
  const { fmtNumber } = useNumberFormatting();
  const { formatDateTime } = useDateFormat();
  const vehiclesQuery = useVehicles();
  const vehiclesState = useDataState(vehiclesQuery);
  const selected = vehicleId ?? config?.vehicleId ?? vehiclesQuery.data?.[0]?.id;
  const id = typeof selected === 'number' && Number.isSafeInteger(selected) && selected > 0 ? selected : 0;
  const vehicle = vehiclesQuery.data?.find(item => item.id === id);
  const model = vehicle?.model?.toLowerCase().replace(/[\s_-]/g, '') ?? '';
  const hasIllustration = /^(?:model|m)?[3sxy]$/.test(model);
  // The unflattened reader keeps enum strings and source/age evidence from the same /signals/{id}/live endpoint.
  const query = useVehicleLiveSignals(id || undefined, { refetchInterval: INTERVALS.REALTIME });
  useTicker(id > 0);
  const pack = usePackPresentation();
  const now = Date.now();
  const compact = size.cols <= 1;
  const unknown = t('common.unknown', 'Unknown');
  const mismatch = query.data != null && query.data.vehicle_id !== id;
  const snapshot = !mismatch && id ? query.data : undefined;
  const read = (field: string, mode: ReadingMode) => readEvidence(snapshot?.signals?.[field], mode, now, query.dataUpdatedAt || now);
  const metrics = [
    { prefix: 'DiStatorTemp', label: t('dashboardWidgets.vehicle.axleThermal.stator', 'Stator temperature'), mode: 'temperature' },
    { prefix: 'DiInverterT', label: t('dashboardWidgets.vehicle.axleThermal.inverter', 'Inverter temperature'), mode: 'temperature' },
    { prefix: 'DiTorqueActual', label: t('dashboardWidgets.vehicle.axleThermal.torque', 'Torque'), mode: 'torque' },
    { prefix: 'DiState', label: t('dashboardWidgets.vehicle.axleThermal.driveState', 'Drive state'), mode: 'state' },
  ] satisfies Array<{ prefix: string; label: string; mode: ReadingMode }>;
  const axles = [
    { suffix: 'F', label: t('dashboardWidgets.vehicle.axleThermal.front', 'Front axle'), additional: false },
    { suffix: 'R', label: t('dashboardWidgets.vehicle.axleThermal.rear', 'Rear axle'), additional: false },
    { suffix: 'REL', label: t('dashboardWidgets.vehicle.axleThermal.rearLeft', 'Rear-left motor'), additional: true },
    { suffix: 'RER', label: t('dashboardWidgets.vehicle.axleThermal.rearRight', 'Rear-right motor'), additional: true },
  ].map(axle => ({ ...axle, rows: (axle.additional ? metrics.slice(0, 1) : metrics).map(metric => ({
    ...metric, field: `${metric.prefix}${axle.suffix}`, ...read(`${metric.prefix}${axle.suffix}`, metric.mode),
  })) })).filter(axle => !axle.additional || axle.rows.some(row => row.value != null && row.at != null));
  const rows = axles.flatMap(axle => axle.rows);
  const hasEvidence = rows.some(row => row.value != null && row.at != null);
  const scopeError = t('dashboardWidgets.vehicle.axleThermal.scopeError', 'Signal response does not match the selected vehicle.');
  const state = deriveDataState({ ...query, data: snapshot,
    error: mismatch ? new Error(scopeError) : query.error,
  }, { provenance: 'live', maxAgeMs: LIVE_FRESHNESS_MS, partial: rows.some(row => !row.fresh), unavailable: snapshot != null && !hasEvidence });
  const retained = state.status === 'stale' || state.isRefreshBlocked;
  const fresh = rows.every(row => row.fresh) && !retained;
  const sourceAt = fresh ? Math.min(...rows.map(row => row.at ?? 0)) : 0;
  const refresh = () => { if (id) void query.refetch(); void vehiclesQuery.refetch(); };
  const labels = {
    Unknown: unknown, Unavailable: t('dashboardWidgets.vehicle.axleThermal.unavailable', 'Unavailable'),
    Standby: t('dashboardWidgets.vehicle.axleThermal.standby', 'Standby'), Fault: t('dashboardWidgets.vehicle.axleThermal.fault', 'Fault'),
    Abort: t('dashboardWidgets.vehicle.axleThermal.abort', 'Abort'), Enable: t('dashboardWidgets.vehicle.axleThermal.enabled', 'Enabled'),
  };
  const display = (row: typeof rows[number]) => typeof row.value === 'number'
    ? row.mode === 'temperature' ? formatTemperature(row.value) : `${fmtNumber(row.value)} ${t('widget.motorPerformance.nm', 'Nm')}`
    : row.value != null ? labels[row.value] : unknown;
  const rear = read('DiStatorTempR', 'temperature');
  const headline = <WidgetBigNumber animated={false} value={typeof rear.value === 'number' ? formatTemperature(rear.value) : null}
    nullDisplay={unknown} label={t('dashboardWidgets.vehicle.axleThermal.rearStator', 'Rear stator temperature')}
    subtitle={t('dashboardWidgets.vehicle.axleThermal.lastReported', 'Last reported; check each signal’s freshness.')} />;
  const sourceLabel = t('dashboardWidgets.vehicle.axleThermal.source', 'Live axle evidence');
  const context = <section aria-label={sourceLabel} className="min-w-0">
    <SourceContent state={!id ? vehiclesState.fatalError ? 'error' : vehiclesState.status === 'initial' ? 'loading' : 'empty'
      : sourceBoundaryState(state, hasEvidence)} label={sourceLabel}
      emptyMessage={!id ? t('widget.selectVehicle', 'Select a vehicle') : t('dashboardWidgets.vehicle.axleThermal.empty', 'No valid timestamped axle signals have been reported for this vehicle.')}
      errorMessage={mismatch ? scopeError : t('dashboardWidgets.vehicle.axleThermal.loadError', 'Axle signal evidence is unavailable.')}
      error={!id ? vehiclesState.fatalError : state.fatalError} errorRecovery={{ onRetry: refresh }}>
      <Caption as="p">{sourceLabel}</Caption>
    </SourceContent>
  </section>;
  const matrixLabel = t('dashboardWidgets.vehicle.axleThermal.matrix', 'Powertrain axle matrix');
  const graphicLabel = t('dashboardWidgets.vehicle.axleThermal.vehicle', 'Selected vehicle illustration');
  const instrument = <section aria-label={matrixLabel} className="min-w-0 space-y-3">
    <PanelTitle>{matrixLabel}</PanelTitle>
    <div data-axle-layout={compact ? 'compact' : 'full'} className={cn('grid min-w-0 items-start gap-3',
      !compact && '@md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)]')}>
      <div className={cn('min-w-0', !compact && '@md:col-start-2 @md:row-start-1 @md:self-center')}>
        <SourceContent state={sourceBoundaryState(vehiclesState, hasIllustration)} label={graphicLabel}
          emptyMessage={model ? t('dashboardWidgets.vehicle.axleThermal.modelUnavailable', 'No matching vehicle illustration is available for the reported model.')
            : t('dashboardWidgets.vehicle.axleThermal.modelUnknown', 'Vehicle model not reported.')}
          errorMessage={t('dashboardWidgets.vehicle.axleThermal.vehicleError', 'Vehicle illustration could not be loaded.')}
          error={vehiclesState.fatalError} errorRecovery={{ onRetry: () => { void vehiclesQuery.refetch(); } }}>
          {vehicle && hasIllustration && <VehicleStudio vehicle={vehicle} compact={compact} bounded={size.rows <= 4} />}
        </SourceContent>
      </div>
      {axles.map(axle => <section key={axle.suffix} aria-label={axle.label} data-axle={axle.suffix}
        className={cn('min-w-0 space-y-3', !compact && (axle.suffix === 'F' ? '@md:col-start-1 @md:row-start-1'
          : axle.suffix === 'R' ? '@md:col-start-3 @md:row-start-1' : '@md:col-span-3'))}>
        <MetricLabel>{axle.label}</MetricLabel>
        {axle.rows.map(row => <div key={row.field} role="group" aria-label={`${axle.label}: ${row.label}`}
          className={cn('min-w-0 space-y-1 break-words border-b border-[var(--border-subtle)] pb-2', pack === 'v7' && 'border-dashed')}>
          <Caption as="p">{row.label}</Caption>
          <Text as="p" variant="body" className="tabular-nums">{display(row)}</Text>
          <Code as="p" className="break-all">{row.field}</Code>
          <Badge size="sm" variant={row.stale || retained ? 'warning' : 'neutral'}>
            {row.value == null ? t('dashboardWidgets.vehicle.axleThermal.invalid', 'No valid reading') : retained ? t('dashboardWidgets.vehicle.axleThermal.retained', 'Retained observation')
              : row.stale ? t('dashboardWidgets.vehicle.axleThermal.stale', 'Stale observation') : row.fresh ? t('dashboardWidgets.vehicle.axleThermal.fresh', 'Fresh observation')
                : t('dashboardWidgets.vehicle.axleThermal.unknownFreshness', 'Freshness unknown')}
          </Badge>
          <Caption as="p">{row.at == null ? t('dashboardWidgets.vehicle.axleThermal.timeUnknown', 'Observation time unknown')
            : <><time dateTime={new Date(row.at).toISOString()}>{formatDateTime(new Date(row.at))}</time>{' · '}{formatObservationAge(row.at, commonT, now)}</>}</Caption>
          <Caption as="p">{t('dashboardWidgets.vehicle.axleThermal.signalSource', 'Source: {{source}}', { source: row.source === 'unknown' ? unknown : row.source })}</Caption>
        </div>)}
      </section>)}
    </div>
    <Caption as="p">{t('dashboardWidgets.vehicle.axleThermal.additionalNote', 'Additional motor rows appear only with valid timestamped reports. Signed torque is shown as reported; drive activity is not inferred.')}</Caption>
  </section>;
  const limitsLabel = t('dashboardWidgets.vehicle.axleThermal.limits', 'Configuration & evidence limits');
  const details = <section aria-label={limitsLabel} className="min-w-0 space-y-2">
    <PanelTitle>{limitsLabel}</PanelTitle>
    <KVList wrap layout={compact ? 'stacked' : 'responsive'} items={[
      { id: 'desired', label: t('dashboardWidgets.vehicle.axleThermal.desired', 'Desired subscription'), value: unknown },
      { id: 'applied', label: t('dashboardWidgets.vehicle.axleThermal.applied', 'Applied to vehicle'), value: unknown },
      { id: 'supported', label: t('dashboardWidgets.vehicle.axleThermal.supported', 'Vehicle support'), value: unknown },
    ]} />
    <Caption as="p">{t('dashboardWidgets.vehicle.axleThermal.noHistory', 'These axle signals have no established signal-log history. This view shows live-source observations only.')}</Caption>
    <Caption as="p">{t('dashboardWidgets.vehicle.axleThermal.noInference', 'Routing and server intent do not prove vehicle support or applied configuration. Missing evidence remains unknown; reported temperatures are not a thermal safety assessment.')}</Caption>
  </section>;
  const body = <InstrumentPresentation family="axle-map" compact={compact} icon={<Gauge aria-hidden="true" />}
    headline={headline} context={context} instrument={instrument} details={details}>
    <div className="min-w-0 space-y-3">{context}{headline}{instrument}{details}</div>
  </InstrumentPresentation>;
  const shellState = id ? state : vehiclesState;
  return <WidgetShell title={matrixLabel} icon={<Gauge />} dataState={{ ...shellState, fatalError: null }} loadingContent={body}
    updatedAt={sourceAt} isFetching={query.isFetching || vehiclesQuery.isFetching} isStale={!fresh}
    isError={shellState.fatalError != null || shellState.refreshError != null} onRefresh={refresh} refreshIntervalMs={INTERVALS.REALTIME}
    footer={<Link to="/signals" className="text-[var(--accent-primary)] hover:underline">
      <Caption className="text-inherit">{t('dashboardWidgets.vehicle.axleThermal.inspect', 'Inspect signals')}</Caption>
    </Link>}>{body}</WidgetShell>;
}
