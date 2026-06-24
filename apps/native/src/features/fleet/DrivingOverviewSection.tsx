import React, {useMemo} from 'react';

import type {Drive} from '../../api/types';
import {MetricGrid, type MetricGridItem} from '../../components/data/MetricGrid';
import {ScreenSection} from '../../components/data/ScreenSection';
import {formatDistance, formatEfficiency, formatEnergy} from './formatFleetValue';

interface DrivingOverviewSectionProps {
  drives: Drive[];
  isLoading: boolean;
  hasError: boolean;
}

export function DrivingOverviewSection({drives, isLoading, hasError}: DrivingOverviewSectionProps) {
  const totalDistanceM = drives.reduce((sum, drive) => sum + (drive.distance_m ?? 0), 0);
  const totalEnergyWh = drives.reduce((sum, drive) => sum + (drive.energy_used_wh ?? 0), 0);
  const avgScore =
    drives.length === 0 ? null : drives.reduce((sum, drive) => sum + (drive.score ?? 0), 0) / drives.length;
  const metrics = useMemo<MetricGridItem[]>(
    () => [
      {
        id: 'trips',
        label: 'Trips',
        value: isLoading && drives.length === 0 ? '-' : drives.length,
        helper: hasError ? 'Drive API unavailable' : 'Recent /drives rows',
        tone: hasError ? 'warning' : 'accent',
        icon: 'trip',
      },
      {
        id: 'distance',
        label: 'Distance',
        value: drives.length === 0 ? '-' : formatDistance(totalDistanceM),
        helper: 'Total returned distance',
        tone: 'accent',
        icon: 'navigation',
      },
      {
        id: 'energy',
        label: 'Energy used',
        value: drives.length === 0 ? '-' : formatEnergy(totalEnergyWh),
        helper: formatEfficiency(totalEnergyWh, totalDistanceM),
        tone: 'warning',
        icon: 'efficiency',
      },
      {
        id: 'score',
        label: 'Average score',
        value: avgScore == null ? '-' : avgScore.toFixed(0),
        helper: 'Returned drive score average',
        tone: (avgScore ?? 0) >= 90 ? 'success' : 'neutral',
        icon: 'award',
      },
    ],
    [avgScore, drives.length, hasError, isLoading, totalDistanceM, totalEnergyWh],
  );

  return (
    <ScreenSection
      title="Driving overview"
      subtitle="Recent drives and trip parity with SI distance, energy, speed, and score summaries.">
      <MetricGrid items={metrics} />
    </ScreenSection>
  );
}
