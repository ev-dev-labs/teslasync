import React, {useMemo} from 'react';

import type {Vehicle, VehicleState} from '../../api/types';
import {MetricGrid, type MetricGridItem} from '../../components/data/MetricGrid';
import {ScreenSection} from '../../components/data/ScreenSection';
import {formatPercent, formatSpeed} from './formatFleetValue';

interface VehicleFleetOverviewSectionProps {
  vehicles: Vehicle[];
  selectedVehicle: Vehicle | null | undefined;
  liveState: VehicleState | null | undefined;
  isLoading: boolean;
  hasError: boolean;
}

export function VehicleFleetOverviewSection({
  vehicles,
  selectedVehicle,
  liveState,
  isLoading,
  hasError,
}: VehicleFleetOverviewSectionProps) {
  const metrics = useMemo<MetricGridItem[]>(
    () => [
      {
        id: 'vehicles',
        label: 'Vehicles',
        value: isLoading && vehicles.length === 0 ? '-' : vehicles.length,
        helper: hasError ? 'Vehicle API unavailable' : 'API-backed garage count',
        tone: hasError ? 'warning' : 'accent',
        icon: 'vehicle',
      },
      {
        id: 'healthy',
        label: 'Healthy',
        value:
          isLoading && vehicles.length === 0
            ? '-'
            : vehicles.filter(vehicle => vehicle.healthy).length,
        helper: 'Reported fleet health',
        tone: vehicles.some(vehicle => !vehicle.healthy) ? 'warning' : 'success',
        icon: 'success',
      },
      {
        id: 'battery',
        label: 'Selected battery',
        value: formatPercent(liveState?.battery_level),
        helper: selectedVehicle?.display_name ?? 'No selected vehicle',
        tone: liveState?.is_charging ? 'success' : 'neutral',
        icon: liveState?.is_charging ? 'batteryCharging' : 'battery',
      },
      {
        id: 'speed',
        label: 'Live speed',
        value: formatSpeed(liveState?.speed_mps),
        helper: 'SI telemetry converted at render boundary',
        tone: (liveState?.speed_mps ?? 0) > 0 ? 'accent' : 'neutral',
        icon: 'speed',
      },
    ],
    [hasError, isLoading, liveState, selectedVehicle?.display_name, vehicles],
  );

  return (
    <ScreenSection
      title="Fleet garage overview"
      subtitle="Native vehicle list/detail parity with typed live state and SI display conversion.">
      <MetricGrid items={metrics} />
    </ScreenSection>
  );
}
