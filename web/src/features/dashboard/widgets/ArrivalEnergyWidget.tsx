import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { MapPin, RefreshCw } from 'lucide-react';
import { useVehicles } from '@/api/hooks/useVehicles';
import { useVehicleLiveSignals, type VehicleLiveSignal } from '@/api/hooks/useTelemetry';
import { knownNumber } from '@/api/dataState';
import { CircleMarker, Popup } from '@/components/maps';
import { Button, Caption, Text } from '@/components/ui';
import { QueryError, Skeleton } from '@/components/feedback';
import { useDataState } from '@/hooks/useDataState';
import { useDateFormat } from '@/hooks/useDateFormat';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';
import { useTicker } from '@/hooks/useTicker';
import { useUnits } from '@/hooks/useUnits';
import { normalizeSignalKind } from '@/lib/signalKind';
import { WidgetShell } from './WidgetShell';
import { WidgetBigNumber, WidgetMapView, WidgetStatGrid } from './shared';
import InstrumentPresentation from './designPacks/InstrumentPresentation';
import type { WidgetProps } from './types';

const MAX_AGE = 120_000;

function evidence(raw: unknown, now: number, retained: boolean, fetchedAt: number) {
  const entry: VehicleLiveSignal | null = raw != null && typeof raw === 'object' && 'value' in raw ? raw : null;
  const kind = normalizeSignalKind(entry?.kind);
  const value = (kind === 'float' || kind === 'int') && typeof entry?.value === 'number' ? knownNumber(entry.value)
    : kind === 'string' && typeof entry?.value === 'string' ? entry.value.trim() || null : null;
  const parsed = Date.parse(entry?.ts || entry?.timestamp || '');
  const observedAt = Number.isFinite(parsed) && parsed > 0 && parsed <= now ? parsed : null;
  const serverAge = entry?.age_ms;
  const invalidAge = serverAge != null && (!Number.isFinite(serverAge) || serverAge < 0);
  const stale = retained || entry?.source === 'stale' || (observedAt != null && now - observedAt > MAX_AGE)
    || (serverAge != null && serverAge + Math.max(0, now - fetchedAt) > MAX_AGE);
  const tracked = observedAt != null && !invalidAge && (entry?.source === 'l1' || entry?.source === 'l2' || entry?.source === 'stale');
  return { value, observedAt, stale, fresh: tracked && !stale };
}

export default function ArrivalEnergyWidget({ vehicleId, size, config }: WidgetProps) {
  const { t } = useTranslation('dashboard');
  const { fmtNumber } = useNumberFormatting();
  const { formatDistance } = useUnits();
  const { formatDateTime } = useDateFormat();
  const vehiclesQuery = useVehicles();
  const candidate = vehicleId ?? config?.vehicleId ?? vehiclesQuery.data?.[0]?.id;
  const id = typeof candidate === 'number' && Number.isSafeInteger(candidate) && candidate > 0 ? candidate : 0;
  const query = useVehicleLiveSignals(id || undefined, { refetchInterval: 5_000 });
  const signals = query.data?.signals ?? {};
  const liveState = useDataState({ ...query, data: id ? query.data : null }, {
    provenance: 'live', unavailable: !id || Object.keys(signals).length === 0,
  });
  const discoveryState = useDataState(vehiclesQuery);
  const state = !id && candidate == null && (vehiclesQuery.isPending || vehiclesQuery.isError) ? discoveryState : liveState;
  useTicker(Boolean(query.data));
  const now = Date.now();
  const read = (name: string) => evidence(signals[name], now, liveState.status === 'stale', query.dataUpdatedAt);
  const arrival = read('ExpectedEnergyPercentAtTripArrival');
  const destination = read('DestinationName');
  const latitude = read('DestinationLocationLatitude');
  const longitude = read('DestinationLocationLongitude');
  const remaining = read('MilesToArrival');
  const eta = read('MinutesToArrival');
  const traffic = read('RouteTrafficMinutesDelay');
  const routeUpdate = read('RouteLastUpdated');
  const nonnegative = (entry: ReturnType<typeof evidence>) =>
    typeof entry.value === 'number' && entry.value >= 0 ? entry.value : null;
  const percent = nonnegative(arrival);
  const validPercent = percent != null && percent <= 100 ? percent : null;
  const lat = typeof latitude.value === 'number' ? latitude.value : null;
  const lng = typeof longitude.value === 'number' ? longitude.value : null;
  const hasCoordinates = lat != null && lng != null && Math.abs(lat) <= 90 && Math.abs(lng) <= 180
    && (lat !== 0 || lng !== 0) && latitude.observedAt != null && latitude.observedAt === longitude.observedAt;
  const center = useMemo<[number, number]>(() => [lat ?? 0, lng ?? 0], [lat, lng]);
  const name = typeof destination.value === 'string' ? destination.value : null;
  const hasRoute = (name != null && destination.fresh) || (hasCoordinates && latitude.fresh && longitude.fresh);
  const forecast = hasRoute && arrival.fresh ? validPercent : null;
  const compact = size.cols <= 1;
  const unknown = t('dashboardWidgets.maps.arrivalEnergy.unknown', 'Unknown');
  const loading = state.status === 'initial';
  const fetching = query.isFetching || (candidate == null && vehiclesQuery.isFetching);
  const sourceLabel = (entry: ReturnType<typeof evidence>) => loading
    ? t('dashboardWidgets.maps.arrivalEnergy.loading', 'Loading route evidence')
    : entry.value == null || entry.observedAt == null ? unknown
      : t('dashboardWidgets.maps.arrivalEnergy.observed', '{{status}} · {{time}}', {
        status: entry.stale ? t('dashboardWidgets.maps.arrivalEnergy.retained', 'Retained')
          : entry.fresh ? t('dashboardWidgets.maps.arrivalEnergy.reported', 'Reported') : unknown,
        time: formatDateTime(entry.observedAt),
      });
  const refresh = () => {
    if (candidate == null) void vehiclesQuery.refetch();
    if (id) void query.refetch();
  };
  // These vendor minute counters are UnitKindNone; MilesToArrival is already SI meters.
  const minutes = (entry: ReturnType<typeof evidence>) => nonnegative(entry) == null ? unknown
    : t('dashboardWidgets.maps.arrivalEnergy.minutes', '{{value}} min', { value: fmtNumber(nonnegative(entry)) });
  const routeTime = typeof routeUpdate.value === 'string' ? Date.parse(routeUpdate.value) : Number.NaN;
  const stats = [
    { label: t('widget.destinationETA.eta', 'ETA'), value: minutes(eta), sublabel: sourceLabel(eta) },
    { label: t('widget.destinationETA.remaining', 'Remaining'), value: nonnegative(remaining) == null ? unknown : formatDistance(nonnegative(remaining)), sublabel: sourceLabel(remaining) },
    { label: t('dashboardWidgets.maps.arrivalEnergy.traffic', 'Traffic delay'), value: minutes(traffic), sublabel: sourceLabel(traffic) },
  ];
  const headline = <div data-arrival-section="arrival-charge">{loading
    ? <><Caption>{t('dashboardWidgets.maps.arrivalEnergy.expected', 'Expected charge on arrival')}</Caption><Skeleton className="h-16 w-40" /></>
    : <WidgetBigNumber value={forecast == null ? null : fmtNumber(forecast)} unit="%" nullDisplay={unknown} animated={false}
      label={t('dashboardWidgets.maps.arrivalEnergy.expected', 'Expected charge on arrival')} subtitle={sourceLabel(arrival)} />}</div>;
  const context = <div className="space-y-2" data-arrival-section="route-context">
    {state.fatalError && <QueryError compact error={state.fatalError} onRetry={refresh} />}
    <Text as="p" variant="body" className="break-words">
      {t('dashboardWidgets.maps.arrivalEnergy.destination', 'Destination')}: {name ?? unknown}
    </Text>
    <Caption className="block">{sourceLabel(destination)}</Caption>
    <Caption className="block">{!id && !loading
      ? t('dashboardWidgets.maps.arrivalEnergy.selectVehicle', 'Select a vehicle to view arrival estimates.')
      : !hasRoute && !loading
        ? t('dashboardWidgets.maps.arrivalEnergy.routeUnknown', 'Current route evidence is unavailable; the arrival forecast is unknown.')
        : forecast == null && !loading
          ? t('dashboardWidgets.maps.arrivalEnergy.arrivalUnknown', 'A current arrival charge estimate is unavailable.')
          : t('dashboardWidgets.maps.arrivalEnergy.estimateNote', 'Vehicle-reported estimates, not a guarantee. Traffic delay is shown separately.')}</Caption>
  </div>;
  const map = <div className="space-y-2" data-arrival-section="destination-map">
    {loading ? <Skeleton className="h-40 w-full" /> : <WidgetMapView
      key={hasCoordinates ? `${lat}:${lng}` : 'unknown'}
      center={center} compact={compact} zoom={13} isEmpty={!hasCoordinates}
      ariaLabel={t('dashboardWidgets.maps.arrivalEnergy.map', 'Navigation destination map')}
      emptyMessage={t('dashboardWidgets.maps.arrivalEnergy.mapUnknown', 'Destination coordinates are unknown.')}>
      <CircleMarker center={center} radius={7}>
        <Popup><Text variant="bodySm">{name ?? t('dashboardWidgets.maps.arrivalEnergy.destination', 'Destination')}</Text></Popup>
      </CircleMarker>
    </WidgetMapView>}
    <Caption className="block">{t('dashboardWidgets.maps.arrivalEnergy.mapNote', 'Destination pin only; route geometry is unavailable.')}</Caption>
    <Caption className="block">{sourceLabel(latitude)} · {sourceLabel(longitude)}</Caption>
  </div>;
  const details = <div className="space-y-3" data-arrival-section="route-details">
    <WidgetStatGrid stats={stats} compact={compact} cols={3} />
    <div className="space-y-1 border-t border-[var(--border-subtle)] pt-2">
      <Caption className="block">{t('dashboardWidgets.maps.arrivalEnergy.lastEstimate', 'Last reported arrival charge')}: {validPercent == null ? unknown : `${fmtNumber(validPercent)}%`}</Caption>
      <Caption className="block">{t('dashboardWidgets.maps.arrivalEnergy.routeUpdated', 'Route last updated')}: {Number.isFinite(routeTime) && routeTime > 0 && routeTime <= now ? formatDateTime(routeTime) : unknown}</Caption>
      <Caption className="block">{sourceLabel(routeUpdate)}</Caption>
      <Caption className="block">{t('dashboardWidgets.maps.arrivalEnergy.supportNote', 'Missing signals do not establish vehicle support or an applied telemetry configuration.')}</Caption>
    </div>
  </div>;
  const body = <InstrumentPresentation family="map" compact={compact} icon={<MapPin aria-hidden="true" />}
    headline={headline} context={context} instrument={map} details={details}>
    <div className="flex min-w-0 flex-col gap-3">{context}{headline}{map}{details}</div>
  </InstrumentPresentation>;
  // Context owns the source error so the forecast, map and metric shells remain mounted.
  return <WidgetShell title={t('dashboardWidgets.maps.arrivalEnergy.title', 'Arrival energy outlook')} icon={<MapPin />}
    dataState={{ ...state, fatalError: null }} loadingContent={body}
    updatedAt={validPercent != null && (arrival.fresh || arrival.stale) ? arrival.observedAt ?? undefined : undefined}
    isFetching={fetching} isStale={arrival.stale || !hasRoute}
    isError={Boolean(state.fatalError || state.refreshError)} onRefresh={refresh} refreshIntervalMs={5_000}
    actions={<Button type="button" variant="ghost" size="sm" className="min-h-11 min-w-11" onClick={refresh}
      disabled={fetching || (!id && candidate != null)} aria-busy={fetching}
      aria-label={t('dashboardWidgets.maps.arrivalEnergy.refresh', 'Refresh arrival estimates')}
      icon={<RefreshCw className="size-4" aria-hidden="true" />} />}>
    {body}
  </WidgetShell>;
}
