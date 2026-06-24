import React, { useMemo } from 'react';
import { View } from 'react-native';

import type { ChargingSession } from '../../api/types';
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
import { FleetMessage } from './FleetMessage';
import { fleetStyles } from './fleetStyles';
import { formatCost, formatEnergy } from './formatFleetValue';

interface ChargingHeatmapSectionProps {
  sessions: ChargingSession[];
  isLoading: boolean;
  hasError: boolean;
}

interface ChargingBucket {
  id: string;
  label: string;
  dayOrder: number;
  hour: number;
  sessions: number;
  energyWh: number;
  cost: number;
}

const weekdayFormatter = new Intl.DateTimeFormat(undefined, {
  weekday: 'short',
});

function buildChargingBuckets(sessions: ChargingSession[]): ChargingBucket[] {
  const buckets = new Map<string, ChargingBucket>();

  for (const session of sessions) {
    const startedAt = new Date(session.started_at);
    if (!Number.isFinite(startedAt.getTime())) {
      continue;
    }

    const dayOrder = startedAt.getDay();
    const hour = startedAt.getHours();
    const id = `${dayOrder}-${hour}`;
    const label = `${weekdayFormatter.format(startedAt)} ${String(
      hour,
    ).padStart(2, '0')}:00`;
    const existing =
      buckets.get(id) ??
      ({
        id,
        label,
        dayOrder,
        hour,
        sessions: 0,
        energyWh: 0,
        cost: 0,
      } satisfies ChargingBucket);

    existing.sessions += 1;
    existing.energyWh += session.total_energy_added_wh ?? 0;
    existing.cost += session.cost_decimal ?? 0;
    buckets.set(id, existing);
  }

  return [...buckets.values()].sort(
    (left, right) => left.dayOrder - right.dayOrder || left.hour - right.hour,
  );
}

export function ChargingHeatmapSection({
  sessions,
  isLoading,
  hasError,
}: ChargingHeatmapSectionProps) {
  const buckets = useMemo(() => buildChargingBuckets(sessions), [sessions]);
  const busiestBucket = buckets.reduce<ChargingBucket | null>(
    (current, bucket) =>
      !current || bucket.sessions > current.sessions ? bucket : current,
    null,
  );
  const totalEnergyWh = buckets.reduce(
    (sum, bucket) => sum + bucket.energyWh,
    0,
  );
  const totalCost = buckets.reduce((sum, bucket) => sum + bucket.cost, 0);
  const chartData = useMemo<ChartSummaryDatum[]>(
    () =>
      buckets.slice(0, 8).map(bucket => ({
        id: bucket.id,
        label: bucket.label,
        value: bucket.energyWh,
        formattedValue: formatEnergy(bucket.energyWh),
        icon: 'calendarClock' as const,
      })),
    [buckets],
  );
  const metrics = useMemo<MetricGridItem[]>(
    () => [
      {
        id: 'charging-heatmap-buckets',
        label: 'Heatmap buckets',
        value: buckets.length,
        helper: 'Distinct weekday/hour buckets',
        tone: buckets.length > 0 ? 'accent' : 'neutral',
        icon: 'calendarClock',
      },
      {
        id: 'charging-heatmap-busiest',
        label: 'Busiest slot',
        value: busiestBucket?.label ?? '-',
        helper: busiestBucket
          ? `${busiestBucket.sessions} sessions`
          : 'No sessions returned',
        tone: 'warning',
        icon: 'trends',
      },
      {
        id: 'charging-heatmap-energy',
        label: 'Heatmap energy',
        value: formatEnergy(totalEnergyWh),
        helper: 'Aggregated SI Wh added',
        tone: 'success',
        icon: 'batteryCharging',
      },
      {
        id: 'charging-heatmap-cost',
        label: 'Heatmap cost',
        value: totalCost > 0 ? formatCost(totalCost, 'USD') : '-',
        helper: 'Returned session cost total',
        tone: 'neutral',
        icon: 'receipt',
      },
    ],
    [busiestBucket, buckets.length, totalCost, totalEnergyWh],
  );

  return (
    <ScreenSection
      title="Charging heatmap"
      subtitle="Native heatmap parity aggregates returned session start times and SI energy without fabricating demand patterns."
    >
      <View style={fleetStyles.detailStack}>
        <MetricGrid items={metrics} minItemWidth={180} />
        <ChartSummary
          title="Charging heatmap energy"
          subtitle="Accessible bar summary of energy by returned weekday/hour charging buckets."
          metricLabel="Tracked energy"
          metricValue={formatEnergy(totalEnergyWh)}
          data={chartData}
          emptyLabel={
            hasError
              ? 'Charging heatmap cannot aggregate because /charging is unavailable.'
              : 'Charging heatmap buckets will appear when charging sessions are returned.'
          }
          icon="calendarClock"
          sourceLabel="Heatmap data is derived only from /charging session timestamps and energy values"
          dataTableLabel="Charging heatmap buckets"
        />
        {isLoading && sessions.length === 0 ? (
          <FleetMessage
            title="Loading charging heatmap"
            message="Fetching charging sessions before grouping heatmap buckets."
            tone="loading"
          />
        ) : hasError && sessions.length === 0 ? (
          <FleetMessage
            title="Charging heatmap unavailable"
            message="Heatmap evidence will render when /charging returns."
            tone="error"
          />
        ) : buckets.length === 0 ? (
          <FleetMessage
            title="No charging heatmap buckets"
            message="Returned sessions do not yet include valid start timestamps for heatmap grouping."
            tone="empty"
            icon="calendarClock"
          />
        ) : (
          <View style={fleetStyles.list}>
            {buckets.slice(0, 5).map(bucket => (
              <ListRow
                key={bucket.id}
                title={bucket.label}
                subtitle={`${bucket.sessions} sessions · ${formatEnergy(
                  bucket.energyWh,
                )}`}
                meta={bucket.cost > 0 ? formatCost(bucket.cost, 'USD') : '-'}
                icon="calendarClock"
                detail={
                  <View>
                    <KeyValueRow
                      label="Bucket source"
                      value="/charging started_at"
                    />
                    <KeyValueRow label="Route" value="/charging-heatmap" />
                  </View>
                }
              />
            ))}
          </View>
        )}
      </View>
    </ScreenSection>
  );
}
