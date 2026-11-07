import { useTranslation } from 'react-i18next';
import { Armchair, Fan, RefreshCw, Thermometer } from 'lucide-react';
import { useVehicles } from '@/api/hooks/useVehicles';
import { useVehicleLiveSignals } from '@/api/hooks/useTelemetry';
import { Button, Caption, Icon, PanelTitle, Text } from '@/components/ui';
import { QueryError, Skeleton, StaleRefreshWarning } from '@/components/feedback';
import { useDataState } from '@/hooks/useDataState';
import { useUnits } from '@/hooks/useUnits';
import { useDateFormat } from '@/hooks/useDateFormat';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';
import { TELEMETRY_STALE_AFTER_MS } from '@/hooks/useTelemetryFreshness';
import { normalizeSignalKind } from '@/lib/signalKind';
import { cn } from '@/lib/cn';
import { WidgetShell } from './WidgetShell';
import { WidgetBigNumber } from './shared';
import WidgetClimateReadout from './shared/WidgetClimateReadout';
import InstrumentPresentation from './designPacks/InstrumentPresentation';
import type { WidgetProps } from './types';

type ReadingType = 'temperature' | 'level' | 'occupancy' | 'belt';

function observation(raw: unknown, type: ReadingType) {
  const entry = raw != null && typeof raw === 'object' && 'value' in raw
    ? raw as Record<string, unknown> : null;
  const kind = normalizeSignalKind(entry?.kind);
  const value = entry?.value;
  const valid = type === 'belt' || type === 'occupancy' ? kind === 'bool' && typeof value === 'boolean'
      : (kind === 'float' || kind === 'int') && typeof value === 'number' && Number.isFinite(value)
        && (kind !== 'int' || Number.isInteger(value)) && value >= (type === 'temperature' ? -273.15 : 0);
  const timestamp = entry?.ts ?? entry?.timestamp;
  const instant = typeof timestamp === 'string' ? Date.parse(timestamp) : Number.NaN;
  return {
    value: valid && (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') ? value : null,
    at: Number.isFinite(instant) && instant > 0 && instant <= Date.now() ? instant : null,
    source: typeof entry?.source === 'string' ? entry.source : null,
    age: typeof entry?.age_ms === 'number' && Number.isFinite(entry.age_ms) && entry.age_ms >= 0 ? entry.age_ms : null,
  };
}

export default function CabinComfortWidget({ vehicleId, config, size }: WidgetProps) {
  const { t } = useTranslation('dashboard');
  const vehiclesQuery = useVehicles();
  const requestedId = vehicleId ?? config?.vehicleId ?? vehiclesQuery.data?.[0]?.id ?? 0;
  const id = Number.isSafeInteger(requestedId) && requestedId > 0 ? requestedId : 0;
  const liveQuery = useVehicleLiveSignals(id || undefined, { refetchInterval: 5_000 });
  const liveState = useDataState(liveQuery, { provenance: 'live' });
  const vehiclesState = useDataState(vehiclesQuery);
  const { formatTemperature } = useUnits();
  const { formatDateTime } = useDateFormat();
  const { fmtNumber } = useNumberFormatting();
  const compact = size.cols <= 1 || size.rows <= 2;
  // Never accept another vehicle's retained snapshot as the selected vehicle's evidence.
  const signals = liveQuery.data?.vehicle_id === id ? liveQuery.data.signals ?? {} : {};
  const hasCabinSignals = ['InsideTemp', 'OutsideTemp', 'DriverSeatOccupied', 'DriverSeatBelt', 'PassengerSeatBelt',
    'SeatHeaterLeft', 'SeatHeaterRight', 'ClimateSeatCoolingFrontLeft', 'ClimateSeatCoolingFrontRight', 'HvacFanSpeed']
    .some(field => signals[field] != null);
  const unknown = t('common.unknown', 'Unknown');
  const busy = id > 0 ? liveQuery.isFetching : vehiclesQuery.isFetching;
  const sourceState = id > 0 ? liveState : vehiclesState;
  const loading = sourceState.status === 'initial' && (id > 0 || vehiclesQuery.isPending);
  const refresh = () => { if (id > 0) void liveQuery.refetch(); else void vehiclesQuery.refetch(); };

  function freshness(reading: ReturnType<typeof observation>) {
    if (reading.value == null) return t('dashboardWidgets.climate.cabinComfort.unreported', 'Unknown or invalid reading');
    if (liveState.refreshError || liveState.isRefreshBlocked) return t('dashboardWidgets.climate.cabinComfort.retained', 'Retained reading');
    if (reading.at == null || reading.source == null || reading.source === 'unknown') {
      return t('dashboardWidgets.climate.cabinComfort.freshnessUnknown', 'Freshness unknown');
    }
    if (reading.source === 'log') return t('dashboardWidgets.climate.cabinComfort.historical', 'Historical fallback');
    if (reading.source === 'stale' || Date.now() - reading.at > TELEMETRY_STALE_AFTER_MS
      || (reading.age ?? 0) > TELEMETRY_STALE_AFTER_MS) return t('dashboardWidgets.climate.cabinComfort.stale', 'Stale reading');
    return reading.source === 'l1' || reading.source === 'l2'
      ? t('dashboardWidgets.climate.cabinComfort.fresh', 'Fresh observation') : t('dashboardWidgets.climate.cabinComfort.freshnessUnknown', 'Freshness unknown');
  }

  function reading(field: string, label: string, type: ReadingType, primary = false) {
    const item = observation(signals[field], type);
    let value = unknown;
    if (typeof item.value === 'number') value = type === 'temperature' ? formatTemperature(item.value)
      : t('dashboardWidgets.climate.cabinComfort.level', 'Level {{value}}', { value: fmtNumber(item.value) });
    if (typeof item.value === 'boolean') value = type === 'belt'
      ? item.value ? t('dashboardWidgets.climate.cabinComfort.buckled', 'Buckled')
        : t('dashboardWidgets.climate.cabinComfort.unbuckled', 'Unbuckled')
      : item.value ? t('dashboardWidgets.climate.cabinComfort.occupied', 'Occupied')
        : t('dashboardWidgets.climate.cabinComfort.unoccupied', 'Unoccupied');
    return <div key={field} data-cabin-signal={field} className="min-w-0 space-y-1 py-2">
      {primary ? <WidgetClimateReadout><WidgetBigNumber value={value} label={label} animated={false} /></WidgetClimateReadout> : (
        <div className="flex min-w-0 flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
          <Text variant="bodySm">{label}</Text><Text variant="bodySm" mono data-cabin-value>{value}</Text>
        </div>
      )}
      <Caption className="block">{freshness(item)}</Caption>
      <Caption className="block break-words">{t('dashboardWidgets.climate.cabinComfort.observed', 'Observed: {{time}} · Source: {{source}}', {
        time: item.at == null ? unknown : formatDateTime(item.at), source: item.source ?? unknown,
      })}</Caption>
    </div>;
  }

  const temperaturesLabel = t('dashboardWidgets.climate.cabinComfort.temperatures', 'Reported temperatures');
  const seatsLabel = t('dashboardWidgets.climate.cabinComfort.seats', 'Front seat climate');
  const occupantsLabel = t('dashboardWidgets.climate.cabinComfort.occupants', 'Occupancy and belts');
  const ventilationLabel = t('dashboardWidgets.climate.cabinComfort.ventilation', 'Ventilation');
  const evidenceLabel = t('dashboardWidgets.climate.cabinComfort.evidence', 'Observation limits');
  const temperatures = <section aria-label={temperaturesLabel} className="min-w-0 space-y-2">
    <PanelTitle>{temperaturesLabel}</PanelTitle>
    {reading('InsideTemp', t('dashboardWidgets.climate.cabinComfort.cabinTemperature', 'Cabin temperature'), 'temperature', true)}
    {reading('OutsideTemp', t('widget.outside', 'Outside'), 'temperature')}
  </section>;
  const seats = <section aria-label={seatsLabel} className="min-w-0 space-y-3">
    <PanelTitle>{seatsLabel}</PanelTitle>
    <div className={cn('grid min-w-0 gap-4', compact ? 'grid-cols-1' : 'grid-cols-2')}>
      {([
        ['left', t('dashboardWidgets.climate.cabinComfort.frontLeft', 'Front left'), 'SeatHeaterLeft', 'ClimateSeatCoolingFrontLeft'],
        ['right', t('dashboardWidgets.climate.cabinComfort.frontRight', 'Front right'), 'SeatHeaterRight', 'ClimateSeatCoolingFrontRight'],
      ] as const).map(([position, label, heater, cooler]) => (
        <div key={position} role="group" aria-label={label} data-seat-position={position}
          className="min-w-0 space-y-2 border-t border-[var(--border-subtle)] pt-3">
          <div className="flex items-center gap-2"><Icon icon={Armchair} size="xl" /><Text variant="label">{label}</Text></div>
          {reading(heater, t('dashboardWidgets.climate.cabinComfort.seatHeat', 'Seat heat'), 'level')}
          {reading(cooler, t('dashboardWidgets.climate.cabinComfort.seatCooling', 'Seat cooling'), 'level')}
        </div>
      ))}
    </div>
  </section>;
  const details = <div className="min-w-0 space-y-5">
    <section aria-label={occupantsLabel} className="min-w-0 space-y-2">
      <PanelTitle>{occupantsLabel}</PanelTitle>
      {reading('DriverSeatOccupied', t('dashboardWidgets.climate.cabinComfort.driverSeat', 'Driver seat'), 'occupancy')}
      {reading('DriverSeatBelt', t('dashboardWidgets.climate.cabinComfort.driverBelt', 'Driver belt'), 'belt')}
      {reading('PassengerSeatBelt', t('dashboardWidgets.climate.cabinComfort.passengerBelt', 'Passenger belt'), 'belt')}
      <Caption className="block">{t('dashboardWidgets.climate.cabinComfort.noPassengerInference', 'Passenger occupancy is unknown; a belt or seat-climate reading does not establish occupancy.')}</Caption>
    </section>
    <section aria-label={ventilationLabel} className="min-w-0 space-y-2">
      <PanelTitle><Icon icon={Fan} className="me-2 inline-block" />{ventilationLabel}</PanelTitle>
      {reading('HvacFanSpeed', t('dashboardWidgets.climate.cabinComfort.fanSpeed', 'Reported fan speed'), 'level')}
    </section>
    <section aria-label={evidenceLabel} className="min-w-0 space-y-2">
      <PanelTitle>{evidenceLabel}</PanelTitle>
      <Caption as="p">{t('dashboardWidgets.climate.cabinComfort.limits', 'Read-only observations, not command confirmation. Desired or routed signals do not prove applied configuration or vehicle support; both remain unknown.')}</Caption>
      <Caption as="p">{t('dashboardWidgets.climate.cabinComfort.noHistory', 'Seat, belt, occupancy and fan history is not available from these live readings.')}</Caption>
    </section>
  </div>;
  const context = <div className="min-w-0 space-y-2">
    {loading && <div role="status"><Skeleton className="h-6 w-2/3" /><Caption>{t('dashboardWidgets.climate.cabinComfort.loading', 'Loading cabin observations…')}</Caption></div>}
    {sourceState.fatalError && <QueryError error={sourceState.fatalError} onRetry={refresh} />}
    <StaleRefreshWarning state={sourceState} />
    {!loading && !sourceState.fatalError && (!id || !hasCabinSignals) && <Text as="p" variant="bodySm">
      {id > 0 ? t('dashboardWidgets.climate.cabinComfort.empty', 'No reported cabin signals. Missing readings remain unknown.')
        : t('dashboardWidgets.climate.cabinComfort.selectVehicle', 'Select a vehicle to view reported cabin observations.')}
    </Text>}
  </div>;

  return <WidgetShell title={t('dashboardWidgets.climate.cabinComfort.title', 'Cabin comfort & occupancy')} icon={<Icon icon={Thermometer} />}
    updatedAt={id > 0 ? liveState.updatedAt ?? 0 : 0} refreshIntervalMs={5_000}
    isFetching={busy} isStale={sourceState.status === 'stale'}
    isError={sourceState.fatalError != null || sourceState.refreshError != null}
    actions={<Button variant="ghost" size="sm" className="min-h-11 min-w-11" disabled={busy} onClick={refresh}
      aria-label={t('dashboardWidgets.climate.cabinComfort.refresh', 'Refresh cabin observations')}><Icon icon={RefreshCw} /></Button>}>
    <div className="h-full min-h-0 overflow-y-auto" aria-busy={busy} data-cabin-compact={compact}>
      <InstrumentPresentation family="climate" compact={compact} icon={<Icon icon={Thermometer} />}
        headline={temperatures} context={context} instrument={seats} details={details}>
        <div className="min-w-0 space-y-5">{context}{temperatures}{seats}{details}</div>
      </InstrumentPresentation>
    </div>
  </WidgetShell>;
}
