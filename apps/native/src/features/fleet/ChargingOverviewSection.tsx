import React, {useMemo} from 'react';

import type {ChargingSession} from '../../api/types';
import {MetricGrid, type MetricGridItem} from '../../components/data/MetricGrid';
import {ScreenSection} from '../../components/data/ScreenSection';
import {formatEnergy, formatPower} from './formatFleetValue';

interface ChargingOverviewSectionProps {
  sessions: ChargingSession[];
  isLoading: boolean;
  hasError: boolean;
}

export function ChargingOverviewSection({
  sessions,
  isLoading,
  hasError,
}: ChargingOverviewSectionProps) {
  const totalEnergyWh = sessions.reduce(
    (sum, session) => sum + (session.total_energy_added_wh ?? 0),
    0,
  );
  const peakPowerW = Math.max(...sessions.map(session => session.peak_power_w ?? 0), 0);
  const liveSessions = sessions.filter(session => session.live || !session.ended_at).length;
  const metrics = useMemo<MetricGridItem[]>(
    () => [
      {
        id: 'sessions',
        label: 'Sessions',
        value: isLoading && sessions.length === 0 ? '-' : sessions.length,
        helper: hasError ? 'Charging API unavailable' : 'Recent /charging rows',
        tone: hasError ? 'warning' : 'accent',
        icon: 'charging',
      },
      {
        id: 'energy',
        label: 'Energy added',
        value: sessions.length === 0 ? '-' : formatEnergy(totalEnergyWh),
        helper: 'Sum of returned session energy',
        tone: 'success',
        icon: 'batteryCharging',
      },
      {
        id: 'peak',
        label: 'Peak power',
        value: sessions.length === 0 ? '-' : formatPower(peakPowerW),
        helper: 'Highest returned session peak',
        tone: 'warning',
        icon: 'bolt',
      },
      {
        id: 'live',
        label: 'Open sessions',
        value: sessions.length === 0 ? '-' : liveSessions,
        helper: 'Live or missing end timestamp',
        tone: liveSessions > 0 ? 'success' : 'neutral',
        icon: 'charger',
      },
    ],
    [hasError, isLoading, liveSessions, peakPowerW, sessions.length, totalEnergyWh],
  );

  return (
    <ScreenSection
      title="Charging overview"
      subtitle="Native charging session parity with energy and power converted from SI values at render.">
      <MetricGrid items={metrics} />
    </ScreenSection>
  );
}
