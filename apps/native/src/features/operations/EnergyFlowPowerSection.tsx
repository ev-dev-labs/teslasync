import React, { useMemo } from 'react';
import { StyleSheet, View } from 'react-native';

import type {
  EnergyStats,
  RegenAnalytics,
  Vehicle,
  VehicleState,
} from '../../api/types';
import {
  ChartSummary,
  type ChartSummaryDatum,
} from '../../components/charts/ChartSummary';
import { KeyValueRow } from '../../components/data/KeyValueRow';
import { ListRow } from '../../components/data/ListRow';
import {
  MetricGrid,
  type MetricGridItem,
} from '../../components/data/MetricGrid';
import { ScreenSection } from '../../components/data/ScreenSection';
import { formatPower } from '../../lib/format';
import { spacing } from '../../theme/tokens';
import { formatDistanceM, formatEnergyWh } from './formatOperationsValue';
import { OperationsMessage } from './OperationsMessage';

interface EnergyFlowPowerSectionProps {
  vehicle: Vehicle | null;
  state: VehicleState | undefined;
  energy: EnergyStats | undefined;
  regen: RegenAnalytics | undefined;
  isLoading: boolean;
  hasError: boolean;
}

export function EnergyFlowPowerSection({
  vehicle,
  state,
  energy,
  regen,
  isLoading,
  hasError,
}: EnergyFlowPowerSectionProps) {
  const chargedWh = energy?.total_energy_charged_wh ?? energy?.total_wh;
  const usedWh = energy?.total_energy_used_wh;
  const regenWh = regen?.total_regen_wh;
  const chartData = useMemo<ChartSummaryDatum[]>(
    () =>
      [
        {
          id: 'charged',
          label: 'Charged',
          value: chargedWh ?? 0,
          formattedValue: formatEnergyWh(chargedWh),
          icon: 'batteryCharging' as const,
        },
        {
          id: 'used',
          label: 'Used',
          value: usedWh ?? 0,
          formattedValue: formatEnergyWh(usedWh),
          icon: 'battery' as const,
        },
        {
          id: 'regen',
          label: 'Regen',
          value: regenWh ?? 0,
          formattedValue: formatEnergyWh(regenWh),
          icon: 'recycle' as const,
        },
      ].filter(point => point.value > 0),
    [chargedWh, regenWh, usedWh],
  );
  const metrics = useMemo<MetricGridItem[]>(
    () => [
      {
        id: 'power-flow-live',
        label: 'Live power',
        value: formatPower(state?.power_w),
        helper: state?.is_charging ? 'Charging input' : 'Vehicle state power',
        tone: state?.is_charging ? 'success' : 'neutral',
        icon: 'powerShare',
      },
      {
        id: 'energy-flow-charged',
        label: 'Charged',
        value: formatEnergyWh(chargedWh),
        helper: '30 day energy in',
        tone: 'success',
        icon: 'batteryCharging',
      },
      {
        id: 'energy-flow-used',
        label: 'Used',
        value: formatEnergyWh(usedWh),
        helper: `Distance ${formatDistanceM(energy?.total_distance_m)}`,
        tone: 'warning',
        icon: 'battery',
      },
      {
        id: 'energy-flow-regen',
        label: 'Regen',
        value: formatEnergyWh(regenWh),
        helper: 'Recovered drive energy',
        tone: 'accent',
        icon: 'recycle',
      },
    ],
    [
      chargedWh,
      energy?.total_distance_m,
      regenWh,
      state?.is_charging,
      state?.power_w,
      usedWh,
    ],
  );

  return (
    <ScreenSection
      title="Energy flow and power flow"
      subtitle="Energy-products, energy-flow, and power-flow routes render native summaries from vehicle energy, regen, and live power state without web animation embedding."
    >
      {!vehicle ? (
        <OperationsMessage
          title="Energy flow waiting for a vehicle"
          message="Power-flow evidence requires a selected vehicle before reading energy totals and vehicle state."
          tone="empty"
          icon="powerShare"
        />
      ) : isLoading && !energy && !regen && !state ? (
        <OperationsMessage
          title="Loading energy flow"
          message="Fetching /vehicles/{id}/energy, /analytics/regen, and /vehicles/{id}/state."
          tone="loading"
          icon="loading"
        />
      ) : hasError && !energy && !regen && !state ? (
        <OperationsMessage
          title="Energy flow unavailable"
          message="Energy and power-flow summaries will render when vehicle energy or state endpoints recover."
          tone="error"
          icon="warning"
        />
      ) : (
        <View style={styles.stack}>
          <MetricGrid items={metrics} />
          <ChartSummary
            title="Energy flow summary"
            subtitle="Accessible native flow summary of charged, used, and regenerative energy."
            metricLabel="Live power"
            metricValue={formatPower(state?.power_w)}
            data={chartData}
            emptyLabel="Energy flow bars will appear when vehicle energy or regen totals are returned."
            icon="workflow"
            sourceLabel="React Native energy-flow summary from typed API data; no WebView animation"
            dataTableLabel="Energy flow values"
          />
          <View style={styles.list}>
            <ListRow
              title="Energy products route"
              subtitle="Tesla Energy site inventory is not exposed by the native API contract; the route remains visible with an explicit unavailable state."
              meta="/energy-products"
              icon="home"
              detail={
                <View>
                  <KeyValueRow
                    label="Vehicle"
                    value={vehicle.display_name ?? `Vehicle ${vehicle.id}`}
                  />
                  <KeyValueRow label="Site endpoint" value="Unavailable" />
                </View>
              }
            />
            <ListRow
              title="Energy flow route"
              subtitle="Native energy flow summarizes actual charged, used, and regen totals returned by TeslaSync."
              meta="/energy-flow"
              icon="workflow"
              detail={
                <View>
                  <KeyValueRow
                    label="Charged"
                    value={formatEnergyWh(chargedWh)}
                  />
                  <KeyValueRow label="Used" value={formatEnergyWh(usedWh)} />
                </View>
              }
            />
            <ListRow
              title="Power flow route"
              subtitle="Live power-flow is rendered as static native data, not a browser or WebView animation."
              meta="/power-flow"
              icon="powerShare"
              detail={
                <View>
                  <KeyValueRow
                    label="Charging"
                    value={
                      state?.is_charging == null
                        ? '-'
                        : state.is_charging
                        ? 'Yes'
                        : 'No'
                    }
                  />
                  <KeyValueRow label="No WebView" value="Not used" />
                </View>
              }
            />
          </View>
        </View>
      )}
    </ScreenSection>
  );
}

const styles = StyleSheet.create({
  stack: {
    gap: spacing.lg,
  },
  list: {
    gap: spacing.sm,
  },
});
