import React, {useMemo} from 'react';
import {View} from 'react-native';

import type {ChargeTelemetryReading, ChargingSession} from '../../api/types';
import {ChartSummary, type ChartSummaryDatum} from '../../components/charts/ChartSummary';
import {KeyValueRow} from '../../components/data/KeyValueRow';
import {MetricGrid} from '../../components/data/MetricGrid';
import {ScreenSection} from '../../components/data/ScreenSection';
import {StatusPill} from '../../components/ui/StatusPill';
import {FleetMessage} from './FleetMessage';
import {fleetStyles} from './fleetStyles';
import {
  formatChargingDuration,
  formatCost,
  formatDateTime,
  formatEnergy,
  formatPower,
} from './formatFleetValue';

interface ChargingDetailSectionProps {
  session: ChargingSession | null | undefined;
  telemetry: ChargeTelemetryReading[];
  isLoading: boolean;
  hasDetailError: boolean;
  hasTelemetryError: boolean;
}

export function ChargingDetailSection({
  session,
  telemetry,
  isLoading,
  hasDetailError,
  hasTelemetryError,
}: ChargingDetailSectionProps) {
  const chartData = useMemo<ChartSummaryDatum[]>(
    () =>
      telemetry.slice(-8).map((reading, index) => {
        const powerW = Math.max(reading.ac_charging_power_w ?? 0, reading.dc_charging_power_w ?? 0);

        return {
          id: `${reading.ts}:${index}`,
          label: formatDateTime(reading.ts),
          value: powerW,
          formattedValue: formatPower(powerW),
          icon: powerW > 0 ? 'bolt' : 'charger',
        };
      }),
    [telemetry],
  );
  const latestReading = telemetry[telemetry.length - 1];

  return (
    <ScreenSection
      title="Charge detail and telemetry"
      subtitle="Selected /charging/:id detail plus native charging-curve summary from telemetry readings.">
      {!session && isLoading ? (
        <FleetMessage
          title="Loading charge detail"
          message="Resolving the selected charging session and telemetry readings."
          tone="loading"
        />
      ) : !session ? (
        <FleetMessage
          title="No selected charging session"
          message="Select a session once /charging returns history."
          tone="empty"
          icon="charging"
        />
      ) : (
        <View style={fleetStyles.detailStack}>
          <View style={fleetStyles.detailHeader}>
            <View style={fleetStyles.detailCopy}>
              <KeyValueRow label="Started" value={formatDateTime(session.started_at)} />
              <KeyValueRow label="Ended" value={formatDateTime(session.ended_at)} />
              <KeyValueRow label="Duration" value={formatChargingDuration(session)} />
              <KeyValueRow
                label="Cost"
                value={formatCost(session.cost_decimal, session.cost_currency)}
              />
            </View>
            <StatusPill
              label={session.live ? 'Live' : session.ended_at ? 'Complete' : 'Open'}
              state={session.live ? 'online' : session.ended_at ? 'online' : 'warning'}
            />
          </View>
          <MetricGrid
            items={[
              {
                id: 'energy',
                label: 'Energy added',
                value: formatEnergy(session.total_energy_added_wh),
                helper: 'Total session energy',
                tone: 'success',
                icon: 'batteryCharging',
              },
              {
                id: 'peak-power',
                label: 'Peak power',
                value: formatPower(session.peak_power_w),
                helper: 'Session peak',
                tone: 'warning',
                icon: 'bolt',
              },
              {
                id: 'avg-power',
                label: 'Average power',
                value: formatPower(session.avg_power_w),
                helper: 'Session average',
                tone: 'neutral',
                icon: 'power',
              },
            ]}
            minItemWidth={180}
          />
          <ChartSummary
            title="Charging curve summary"
            subtitle="Native bar summary from /charging/:id/telemetry; full interactive curve remains pending."
            metricLabel="Latest charger power"
            metricValue={formatPower(
              Math.max(
                latestReading?.ac_charging_power_w ?? 0,
                latestReading?.dc_charging_power_w ?? 0,
              ),
            )}
            data={chartData}
            emptyLabel={
              hasTelemetryError
                ? 'Charge telemetry API is unavailable for this selected session.'
                : 'Charge telemetry has no power readings for this session.'
            }
            icon="trends"
          />
          {hasDetailError || hasTelemetryError ? (
            <FleetMessage
              title="Partial charge detail"
              message="Session data is shown when available; one or more detail endpoints are unavailable."
              tone="error"
            />
          ) : null}
        </View>
      )}
    </ScreenSection>
  );
}
