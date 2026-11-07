import { CircleDot } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { deriveDataState } from '@/api/dataState';
import { useVehicleLiveSignals } from '@/api/hooks/useTelemetry';
import { useVehicles } from '@/api/hooks/useVehicles';
import { SourceContent } from '@/components/layout';
import { Badge, Caption, MetricLabel, MetricValue, PanelTitle } from '@/components/ui';
import { useDataState } from '@/hooks/useDataState';
import { useDateFormat } from '@/hooks/useDateFormat';
import { usePressureFormat } from '@/hooks/usePressureFormat';
import { useTicker } from '@/hooks/useTicker';
import { isLiveFieldFresh, liveFieldAge, LIVE_FRESHNESS_MS } from '@/hooks/useVehicleLive';
import { cn } from '@/lib/cn';
import { INTERVALS } from '@/lib/constants';
import { formatObservationAge } from '@/lib/observationAge';
import { normalizeSignalKind } from '@/lib/signalKind';
import { sourceBoundaryState } from '../components/continuation-dashboard-1/sourceBoundary';
import InstrumentPresentation from './designPacks/InstrumentPresentation';
import { WidgetBigNumber } from './shared';
import { WidgetShell } from './WidgetShell';
import VehicleStudio from './vehicle-instruments/VehicleStudio';
import type { WidgetProps } from './types';

function evidence(raw: unknown, now: number, receivedAt: number) {
  const entry = raw != null && typeof raw === 'object' ? raw as Record<string, unknown> : {};
  const kind = normalizeSignalKind(entry.kind);
  const value = kind === 'bool' && typeof entry.value === 'boolean' ? entry.value
    : (kind === 'float' || kind === 'int') && typeof entry.value === 'number' && Number.isFinite(entry.value)
      && (kind !== 'int' || Number.isSafeInteger(entry.value)) ? entry.value : null;
  const timestamp = entry.ts ?? entry.timestamp;
  const parsed = typeof timestamp === 'string' ? Date.parse(timestamp) : Number.NaN;
  const at = Number.isFinite(parsed) && parsed > 0 && parsed <= now ? parsed : null;
  const ageValid = entry.age_ms == null || (typeof entry.age_ms === 'number' && Number.isFinite(entry.age_ms) && entry.age_ms >= 0);
  const provenance = {
    observedAtMs: at, receivedAtMs: receivedAt,
    ageMs: typeof entry.age_ms === 'number' && ageValid ? entry.age_ms : null,
    source: typeof entry.source === 'string' ? entry.source : 'unknown',
  };
  const age = liveFieldAge(provenance, now);
  return {
    value, at,
    fresh: value != null && ageValid && isLiveFieldFresh(provenance, now),
    stale: entry.source === 'stale' || (age != null && age > LIVE_FRESHNESS_MS),
  };
}
export default function TireWarningsWidget({ vehicleId, config, size }: WidgetProps) {
  const { t } = useTranslation('dashboard');
  const { t: commonT } = useTranslation();
  const vehiclesQuery = useVehicles();
  const selected = vehicleId ?? config?.vehicleId ?? vehiclesQuery.data?.[0]?.id;
  const id = typeof selected === 'number' && Number.isSafeInteger(selected) && selected > 0 ? selected : 0;
  const vehicle = vehiclesQuery.data?.find(item => item.id === id);
  const canIllustrate = Boolean(vehicle?.model && /^(?:model[\s_-]?)?[3ysx]$/i.test(vehicle.model.trim()));
  const query = useVehicleLiveSignals(id || undefined, { refetchInterval: INTERVALS.REALTIME });
  const vehiclesState = useDataState(vehiclesQuery);
  const { formatPressureValue } = usePressureFormat();
  const { formatDateTime } = useDateFormat();
  useTicker(id > 0);
  const now = Date.now();
  const compact = size.cols <= 1;
  const mismatch = query.data != null && query.data.vehicle_id !== id;
  const live = !mismatch ? query.data : undefined;
  const signals = live?.signals ?? {};
  const read = (field: string) => evidence(signals[field], now, query.dataUpdatedAt || now);
  const wheels = [
    { key: 'fl', suffix: 'Fl', corner: 'FrontLeft', label: t('dashboardWidgets.tires.tireWarnings.frontLeft', 'Front left'), position: '@md:col-start-1 @md:row-start-1' },
    { key: 'fr', suffix: 'Fr', corner: 'FrontRight', label: t('dashboardWidgets.tires.tireWarnings.frontRight', 'Front right'), position: '@md:col-start-3 @md:row-start-1' },
    { key: 'rl', suffix: 'Rl', corner: 'RearLeft', label: t('dashboardWidgets.tires.tireWarnings.rearLeft', 'Rear left'), position: '@md:col-start-1 @md:row-start-2' },
    { key: 'rr', suffix: 'Rr', corner: 'RearRight', label: t('dashboardWidgets.tires.tireWarnings.rearRight', 'Rear right'), position: '@md:col-start-3 @md:row-start-2' },
  ].map(wheel => {
    const pressure = read(`TpmsPressure${wheel.suffix}`);
    const lastSeen = read(`TpmsLastSeenPressureTime${wheel.suffix}`);
    // The tire-pressure writer defines these numeric values as Unix seconds, not envelope timestamps.
    const lastSeenAt = typeof lastSeen.value === 'number' && lastSeen.value > 0 && lastSeen.value * 1000 <= now
      ? lastSeen.value * 1000 : null;
    return {
      ...wheel, pressure, lastSeen, lastSeenAt,
      pressureValue: typeof pressure.value === 'number' && pressure.value >= 0 ? pressure.value : null,
      hard: read(`TpmsHardWarnings${wheel.corner}`), soft: read(`TpmsSoftWarnings${wheel.corner}`),
    };
  });
  const observed = wheels.filter(wheel => wheel.pressureValue != null).length;
  const warnings = wheels.flatMap(wheel => [wheel.hard, wheel.soft]);
  const hasEvidence = wheels.some(wheel => wheel.pressureValue != null || wheel.lastSeenAt != null)
    || warnings.some(warning => typeof warning.value === 'boolean');
  const complete = wheels.every(wheel => wheel.pressureValue != null && wheel.lastSeenAt != null
    && wheel.pressure.at != null && wheel.lastSeen.at != null)
    && warnings.every(warning => typeof warning.value === 'boolean' && warning.at != null);
  const state = deriveDataState({
    ...query, data: live,
    error: mismatch ? new Error(t('dashboardWidgets.tires.tireWarnings.scopeError', 'Signal response does not match the selected vehicle.')) : query.error,
  }, { provenance: 'live', partial: !complete, unavailable: live != null && !hasEvidence, maxAgeMs: LIVE_FRESHNESS_MS });
  const retained = state.status === 'stale' || state.isRefreshBlocked;
  const current = (entry: ReturnType<typeof evidence>) => entry.fresh && !retained;
  const hardReported = wheels.some(wheel => wheel.hard.value === true && current(wheel.hard));
  const softReported = wheels.some(wheel => wheel.soft.value === true && current(wheel.soft));
  const clear = warnings.every(warning => warning.value === false && current(warning));
  const unknown = t('dashboardWidgets.tires.tireWarnings.unknown', 'Unknown');
  const notReported = t('dashboardWidgets.tires.tireWarnings.notReported', 'Not reported');
  const freshness = (entry: ReturnType<typeof evidence>) => retained
    ? t('dashboardWidgets.tires.tireWarnings.retained', 'Retained')
    : entry.stale ? t('dashboardWidgets.tires.tireWarnings.stale', 'Stale')
      : entry.fresh ? t('dashboardWidgets.tires.tireWarnings.fresh', 'Fresh')
        : t('dashboardWidgets.tires.tireWarnings.unknownFreshness', 'Freshness unknown');
  const instant = (at: number | null) => at == null ? notReported
    : <time dateTime={new Date(at).toISOString()}>{formatDateTime(at)}</time>;
  const refresh = () => { if (id) void query.refetch(); void vehiclesQuery.refetch(); };
  const headline = <WidgetBigNumber animated={false} value={hasEvidence ? observed : null} unit="/4"
    label={t('dashboardWidgets.tires.tireWarnings.reportedPressures', 'Reported pressures')} />;
  const summary = <Badge variant={hardReported ? 'danger' : softReported ? 'warning' : clear ? 'success' : 'neutral'}>
    {hardReported ? t('dashboardWidgets.tires.tireWarnings.hardReported', 'Hard warning reported')
      : softReported ? t('dashboardWidgets.tires.tireWarnings.softReported', 'Soft warning reported')
        : clear ? t('dashboardWidgets.tires.tireWarnings.clear', 'No warnings reported')
          : t('dashboardWidgets.tires.tireWarnings.warningsUnknown', 'Warnings unknown')}
  </Badge>;
  const sourceLabel = t('dashboardWidgets.tires.tireWarnings.source', 'Live TPMS evidence');
  const source = <section aria-label={sourceLabel} className="min-w-0">
    <SourceContent state={!id ? vehiclesState.fatalError ? 'error' : vehiclesState.status === 'initial' ? 'loading' : 'empty'
      : sourceBoundaryState(state, hasEvidence)} label={sourceLabel}
      emptyMessage={!id ? t('dashboardWidgets.tires.tireWarnings.selectVehicle', 'Select a vehicle') : t('dashboardWidgets.tires.tireWarnings.empty', 'No tire signals have been reported for this vehicle.')}
      errorMessage={t('dashboardWidgets.tires.tireWarnings.loadError', 'Tire signal evidence is unavailable.')}
      error={!id ? vehiclesState.fatalError : state.fatalError}
      errorRecovery={{ onRetry: () => { if (id) void query.refetch(); else void vehiclesQuery.refetch(); } }}>
      <Caption as="p">{sourceLabel}</Caption>
    </SourceContent>
  </section>;
  const graphicLabel = t('dashboardWidgets.tires.tireWarnings.vehicle', 'Selected vehicle illustration');
  const instrument = <section aria-label={t('dashboardWidgets.tires.tireWarnings.perWheel', 'Per-wheel tire status')} className="min-w-0">
    <div className={cn('grid min-w-0 grid-cols-2 items-center gap-3',
      !compact && '@md:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)_minmax(0,1fr)]')}>
      <div className={cn('col-span-2 min-w-0', !compact && '@md:col-span-1 @md:col-start-2 @md:row-span-2 @md:row-start-1')}>
        <SourceContent state={sourceBoundaryState(vehiclesState, canIllustrate)} label={graphicLabel}
          emptyMessage={t('dashboardWidgets.tires.tireWarnings.modelUnknown', 'Vehicle model illustration unavailable.')}
          errorMessage={t('dashboardWidgets.tires.tireWarnings.vehicleError', 'Vehicle illustration could not be loaded.')}
          error={vehiclesState.fatalError} errorRecovery={{ onRetry: () => { void vehiclesQuery.refetch(); } }}>
          {vehicle && canIllustrate && <VehicleStudio vehicle={vehicle} compact={compact} bounded={size.rows <= 4} />}
        </SourceContent>
      </div>
      {wheels.map(wheel => {
        const sensorStale = wheel.lastSeenAt != null && now - wheel.lastSeenAt > LIVE_FRESHNESS_MS;
        const pressureTrust = {
          ...wheel.pressure,
          fresh: wheel.pressureValue != null && wheel.pressure.fresh && wheel.lastSeen.fresh && wheel.lastSeenAt != null && !sensorStale,
          stale: wheel.pressure.stale || wheel.lastSeen.stale || sensorStale,
        };
        return <div key={wheel.key} role="group" aria-label={wheel.label} data-tire-position={wheel.key}
          className={cn('widget-status-tile min-w-0 space-y-2 break-words p-2', !compact && wheel.position)}>
          <MetricLabel>{wheel.label}</MetricLabel>
          <MetricValue>{wheel.pressureValue == null ? '—' : formatPressureValue(wheel.pressureValue)}</MetricValue>
          <Caption as="p" data-pressure-trust>{freshness(pressureTrust)}</Caption>
          <Caption as="p">{t('dashboardWidgets.tires.tireWarnings.pressureObserved', 'Pressure observed')}: {instant(wheel.pressure.at)}</Caption>
          <Caption as="p">{t('dashboardWidgets.tires.tireWarnings.lastSeen', 'Last sensor report')}: {instant(wheel.lastSeenAt)}</Caption>
          <Caption as="p">{t('dashboardWidgets.tires.tireWarnings.age', 'Sensor age')}: {wheel.lastSeenAt == null ? unknown : formatObservationAge(wheel.lastSeenAt, commonT, now)}</Caption>
          {([
            { key: 'hard', label: t('dashboardWidgets.tires.tireWarnings.hard', 'Hard warning'), entry: wheel.hard, variant: 'danger' },
            { key: 'soft', label: t('dashboardWidgets.tires.tireWarnings.soft', 'Soft warning'), entry: wheel.soft, variant: 'warning' },
          ] as const).map(warning => <div key={warning.key} role="group" aria-label={warning.label} className="min-w-0 space-y-1">
            <Caption>{warning.label}</Caption>{' '}
            <Badge variant={warning.entry.value === true && current(warning.entry) ? warning.variant : 'neutral'}>
              {warning.entry.value === true ? t('dashboardWidgets.tires.tireWarnings.reported', 'Reported')
                : warning.entry.value === false ? t('dashboardWidgets.tires.tireWarnings.notActive', 'No warning reported') : notReported}
            </Badge>
            <Caption as="p">{freshness(warning.entry)} · {instant(warning.entry.at)}</Caption>
          </div>)}
        </div>;
      })}
    </div>
  </section>;
  const limitsLabel = t('dashboardWidgets.tires.tireWarnings.limits', 'Evidence limits');
  const details = <section aria-label={limitsLabel} className="min-w-0 space-y-2">
    <PanelTitle>{limitsLabel}</PanelTitle>
    {summary}
    <Caption as="p">{t('dashboardWidgets.tires.tireWarnings.noInference', 'Warnings and timestamps must be reported; no alert is inferred from a missing value.')}</Caption>
    <Caption as="p">{t('dashboardWidgets.tires.tireWarnings.freshnessNote', 'Pressure freshness requires both a timestamped signal and a sensor report no older than two minutes.')}</Caption>
    <Caption as="p">{t('dashboardWidgets.tires.tireWarnings.noHistory', 'Pressure and last-seen history are not established by this live source.')}</Caption>
    <Caption as="p">{t('dashboardWidgets.tires.tireWarnings.supportUnknown', 'Vehicle support and applied telemetry configuration remain unknown.')}</Caption>
  </section>;
  const body = <InstrumentPresentation family="tire" compact={compact} icon={<CircleDot aria-hidden="true" />}
    headline={headline} context={source} instrument={instrument} details={details}>
    <div className="min-w-0 space-y-3">{source}{headline}{instrument}{details}</div>
  </InstrumentPresentation>;
  const times = wheels.flatMap(wheel => [wheel.pressure.at, wheel.lastSeen.at, wheel.lastSeenAt, wheel.hard.at, wheel.soft.at]);
  const sourceAt = complete && times.every(at => at != null) ? Math.min(...times.filter((at): at is number => at != null)) : 0;
  const allFresh = wheels.every(wheel => wheel.pressureValue != null && current(wheel.pressure) && current(wheel.lastSeen)
    && wheel.lastSeenAt != null && now - wheel.lastSeenAt <= LIVE_FRESHNESS_MS) && warnings.every(current);
  const shellState = id ? state : vehiclesState;
  return <WidgetShell title={t('dashboardWidgets.tires.tireWarnings.title', 'Tire warnings & freshness')} icon={<CircleDot />}
    dataState={{ ...shellState, fatalError: null }} loadingContent={body}
    updatedAt={sourceAt} isFetching={query.isFetching || vehiclesQuery.isFetching}
    isStale={!sourceAt || !allFresh}
    isError={shellState.fatalError != null || shellState.refreshError != null} onRefresh={refresh}
    refreshIntervalMs={INTERVALS.REALTIME}
    footer={<Link to="/tire-pressure" className="text-[var(--accent-primary)] hover:underline">
      <Caption className="text-inherit">{t('dashboardWidgets.tires.tireWarnings.open', 'Open tire pressure')}</Caption>
    </Link>}>
    {body}
  </WidgetShell>;
}
