import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Car } from 'lucide-react';
import { EmptyState } from '@/components/feedback';
import { INTERVALS } from '@/lib/constants';
import {
  resolveVehicleStateFreshness,
  useVehicles,
  useVehicleState,
} from '@/api/hooks/useVehicles';
import type { VerifiedVehicleStateField } from '@/api/hooks/useVehicles';
import { TELEMETRY_STALE_AFTER_MS } from '@/hooks/useTelemetryFreshness';
import { useUnits } from '@/hooks/useUnits';
import {
  convertDistanceFromSI,
  convertSpeedFromSI,
  convertTempFromSI,
} from '@/lib/unitConversion';
import { useVehicleLive } from '@/hooks/useVehicleLive';
import { VehicleHero } from '../components/VehicleHero';
import { WidgetShell } from './WidgetShell';
import type { WidgetProps } from './types';
import type { Vehicle, VehicleState } from '../types';

/** Stable identity so an unresolved read never re-renders VehicleHero. */
const EMPTY_VERIFIED_FIELDS: readonly VerifiedVehicleStateField[] = [];

export default function VehicleHeroWidget({ vehicleId }: WidgetProps) {
  const { t } = useTranslation('dashboard');
  const { data: vehicles, isLoading: vehiclesLoading } = useVehicles();
  const vehicle = vehicleId
    ? vehicles?.find((v) => v.id === vehicleId) ?? vehicles?.[0]
    : vehicles?.[0];

  const id = vehicle?.id ?? 0;
  /* The fleet batch (`useFleetStates`) seeds `vehicleKeys.state(id)` on every
   * successful poll, so an ambient per-vehicle poll on top of it is pure
   * duplication — the exact N+1 the batch endpoint exists to remove.
   *
   * The per-vehicle read therefore polls only as BOUNDED RECOVERY: it stands
   * down while the seeded reading is confirmed fresh, and resumes the moment
   * that reading ages out (batch not mounted on this surface, or failing).
   * Manual refresh and SSE reconnect recovery are unaffected. */
  const [recoveryInterval, setRecoveryInterval] = useState<number | false>(INTERVALS.STANDARD);
  const { data: stateData, isFetching, isError, refetch } = useVehicleState(id, {
    refetchInterval: recoveryInterval,
  });
  const { state: live } = useVehicleLive(vehicle?.id);
  /* Freshness must describe the OBSERVATION, not the request.
   *
   * `dataUpdatedAt` is when the fetch completed, so a vehicle that has not
   * emitted telemetry in an hour still rendered "updated just now" on every
   * poll — and after a failed poll TanStack keeps the previous data while the
   * timestamp of the *next* success moves again. `observedAt` comes from the
   * backend's newest real live signal and never advances on a failed read. */
  const observedAt = stateData?.observedAt ?? undefined;
  const [freshnessClock, setFreshnessClock] = useState(0);
  const freshness = useMemo(
    () => resolveVehicleStateFreshness(
      stateData?.freshness,
      observedAt ?? null,
    ),
    [stateData?.freshness, observedAt, freshnessClock],
  );
  const trusted = freshness === 'fresh';
  useEffect(() => {
    if (stateData?.freshness !== 'fresh' || observedAt == null) return undefined;
    const remaining = observedAt + TELEMETRY_STALE_AFTER_MS - Date.now();
    if (remaining <= 0) return undefined;
    const timer = window.setTimeout(
      () => setFreshnessClock((version) => version + 1),
      remaining + 1,
    );
    return () => window.clearTimeout(timer);
  }, [stateData?.freshness, observedAt]);
  useEffect(() => {
    setRecoveryInterval(trusted ? false : INTERVALS.STANDARD);
  }, [trusted]);
  /* State values arrive in SI units: range/odometer in meters, speed in m/s,
   * and temperatures in °C. Wrap SI-aware converters so VehicleHero receives
   * display-unit values without changing its component contract. The callbacks
   * are memoised on their unit preference so a background re-render (the state
   * query polls) doesn't hand VehicleHero fresh function identities each time. */
  const { unitPrefs } = useUnits();

  const distanceUnit = unitPrefs.distance;
  const speedUnit = unitPrefs.speed;
  const tempUnit = unitPrefs.temperature;
  const toDistanceDisplay = useCallback(
    (meters: number) => convertDistanceFromSI(meters, distanceUnit),
    [distanceUnit],
  );
  const toSpeedDisplay = useCallback(
    (mps: number) => convertSpeedFromSI(mps, speedUnit),
    [speedUnit],
  );
  const toTemperatureDisplay = useCallback(
    (celsius: number) => convertTempFromSI(celsius, tempUnit),
    [tempUnit],
  );
  const handleRefresh = useCallback(() => {
    void refetch();
  }, [refetch]);

  // Live-progress firmware (SSE) wins over the last persisted state snapshot;
  // fall back to an em-dash so the tile never renders an empty string.
  const firmwareVersion =
    live.version || live.swUpdateVersion || stateData?.state?.software_version || '—';

  return (
    <WidgetShell
      loading={vehiclesLoading}
      noPadding
      // `0` means "no verified observation" to WidgetShell (it renders the
      // freshness control with a null timestamp). Passing `undefined` would
      // HIDE the freshness + refresh control entirely — exactly when the user
      // most needs it.
      updatedAt={observedAt ?? 0}
      isFetching={isFetching}
      isStale={!trusted}
      isError={isError}
      onRefresh={handleRefresh}
    >
      {vehicle ? (
        <VehicleHero
          vehicle={vehicle as unknown as Vehicle}
          state={(stateData?.state ?? null) as VehicleState | null}
          firmwareVersion={firmwareVersion}
          observedAt={observedAt}
          freshness={freshness}
          verifiedFields={stateData?.verifiedFields ?? EMPTY_VERIFIED_FIELDS}
          toDistanceDisplay={toDistanceDisplay}
          toSpeedDisplay={toSpeedDisplay}
          toTemperatureDisplay={toTemperatureDisplay}
          distanceUnit={distanceUnit}
          speedUnit={speedUnit}
          tempUnit={tempUnit}
        />
      ) : (
        <EmptyState /* no-action: transient empty state — surfaces when no vehicle is linked; no specific recovery action available */
          icon={<Car className="h-5 w-5" />}
          message={t('widget.noVehicle', 'No vehicle data')}
          className="py-4"
        />
      )}
    </WidgetShell>
  );
}
