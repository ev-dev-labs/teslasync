import React, { useMemo } from 'react';
import { StyleSheet, View } from 'react-native';

import type {
  SleepAnalytics,
  TemperatureImpactData,
  Vehicle,
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
import { spacing } from '../../theme/tokens';
import {
  formatCount,
  formatCurrency,
  formatDateTime,
  formatNumber,
  formatPercent,
  formatTemperatureC,
} from './formatOperationsValue';
import { OperationsMessage } from './OperationsMessage';

interface VampireDrainAnalyticsSectionProps {
  vehicle: Vehicle | null;
  sleep: SleepAnalytics | undefined;
  temperature: TemperatureImpactData | undefined;
  isLoading: boolean;
  hasError: boolean;
}

function formatDrainRate(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) {
    return '-';
  }

  return `${formatNumber(value, 2)}%/h`;
}

export function VampireDrainAnalyticsSection({
  vehicle,
  sleep,
  temperature,
  isLoading,
  hasError,
}: VampireDrainAnalyticsSectionProps) {
  const recentEvents = useMemo(
    () => sleep?.recent_events ?? [],
    [sleep?.recent_events],
  );
  const sentryComparison = useMemo(
    () => sleep?.sentry_comparison ?? [],
    [sleep?.sentry_comparison],
  );
  const tempDrainBuckets = useMemo(
    () => temperature?.vampire_drain ?? [],
    [temperature?.vampire_drain],
  );
  const chartData = useMemo<ChartSummaryDatum[]>(() => {
    const eventPoints = recentEvents.slice(-8).map(event => ({
      id: String(event.id),
      label: formatDateTime(event.start_date),
      value: event.battery_lost,
      formattedValue: formatPercent(event.battery_lost, 1),
      icon: 'moon' as const,
    }));

    if (eventPoints.length > 0) {
      return eventPoints;
    }

    return tempDrainBuckets.slice(0, 8).map(bucket => ({
      id: bucket.temp_bucket,
      label: bucket.temp_bucket,
      value: bucket.avg_drain_rate,
      formattedValue: formatDrainRate(bucket.avg_drain_rate),
      icon: 'weather' as const,
    }));
  }, [recentEvents, tempDrainBuckets]);
  const metrics = useMemo<MetricGridItem[]>(
    () => [
      {
        id: 'vampire-sleep-efficiency',
        label: 'Sleep efficiency',
        value: formatPercent(sleep?.sleep_efficiency_pct, 1),
        helper: 'From /analytics/sleep',
        tone: (sleep?.sleep_efficiency_pct ?? 0) >= 85 ? 'success' : 'warning',
        icon: 'moon',
      },
      {
        id: 'vampire-events',
        label: 'Drain events',
        value: formatCount(sleep?.total_events ?? recentEvents.length),
        helper: 'Returned idle/sleep events',
        tone: 'accent',
        icon: 'history',
      },
      {
        id: 'vampire-sentry-extra',
        label: 'Sentry delta',
        value: formatDrainRate(sleep?.sentry_extra_drain_rate),
        helper: 'Extra drain rate when returned',
        tone: 'warning',
        icon: 'guard',
      },
      {
        id: 'vampire-monthly-cost',
        label: 'Monthly cost',
        value: formatCurrency(sleep?.sentry_extra_monthly_cost),
        helper: 'Backend-provided estimate',
        tone: 'neutral',
        icon: 'receipt',
      },
    ],
    [
      recentEvents.length,
      sleep?.sentry_extra_drain_rate,
      sleep?.sentry_extra_monthly_cost,
      sleep?.sleep_efficiency_pct,
      sleep?.total_events,
    ],
  );

  return (
    <ScreenSection
      title="Vampire drain analytics"
      subtitle="Vampire-drain parity uses sleep analytics and temperature drain buckets only; no drain is inferred from unrelated charging or trip rows."
    >
      {!vehicle ? (
        <OperationsMessage
          title="Vampire drain waiting for a vehicle"
          message="The vampire-drain route requires a selected vehicle_id before querying sleep analytics."
          tone="empty"
          icon="moon"
        />
      ) : isLoading && !sleep && !temperature ? (
        <OperationsMessage
          title="Loading vampire drain"
          message="Fetching /analytics/sleep and /analytics/temperature-impact before rendering drain evidence."
          tone="loading"
          icon="loading"
        />
      ) : hasError && !sleep && !temperature ? (
        <OperationsMessage
          title="Vampire drain unavailable"
          message="Drain analytics will render when the sleep or temperature impact endpoints recover."
          tone="error"
          icon="warning"
        />
      ) : (
        <View style={styles.stack}>
          <MetricGrid items={metrics} />
          <ChartSummary
            title="Vampire drain trend"
            subtitle="Accessible native summary of returned drain events or temperature drain buckets."
            metricLabel="Sentry off drain"
            metricValue={formatDrainRate(sleep?.sentry_off_drain_rate)}
            data={chartData}
            emptyLabel="Vampire drain points will appear when /analytics/sleep returns recent_events or /analytics/temperature-impact returns vampire_drain buckets."
            icon="moon"
            sourceLabel="Vampire drain chart from backend analytics only; no synthetic idle loss is generated"
            dataTableLabel="Vampire drain points"
          />
          {recentEvents.length > 0 ? (
            <View style={styles.list}>
              {recentEvents.slice(0, 4).map(event => (
                <ListRow
                  key={event.id}
                  title={`Drain event #${event.id}`}
                  subtitle={`${formatPercent(
                    event.battery_lost,
                    1,
                  )} lost · ${formatDrainRate(event.drain_rate)}`}
                  meta={event.sentry_mode ? 'Sentry on' : 'Sentry off'}
                  icon="moon"
                  detail={
                    <View>
                      <KeyValueRow
                        label="Duration"
                        value={`${formatNumber(event.duration_hours, 1)} h`}
                      />
                      <KeyValueRow
                        label="Outside temp"
                        value={formatTemperatureC(event.outside_temp)}
                      />
                    </View>
                  }
                />
              ))}
            </View>
          ) : sentryComparison.length > 0 ? (
            <View style={styles.list}>
              {sentryComparison.map(row => (
                <ListRow
                  key={row.sentry_mode ? 'sentry-on' : 'sentry-off'}
                  title={
                    row.sentry_mode ? 'Sentry on drain' : 'Sentry off drain'
                  }
                  subtitle={`${formatCount(
                    row.count,
                  )} events · ${formatDrainRate(row.avg_drain_rate)}`}
                  meta={formatPercent(row.avg_battery_lost, 1)}
                  icon="guard"
                />
              ))}
            </View>
          ) : (
            <OperationsMessage
              title="No vampire drain rows"
              message="The section stays visible until sleep analytics returns drain events, sentry comparison, or temperature buckets."
              tone="empty"
              icon="moon"
            />
          )}
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
