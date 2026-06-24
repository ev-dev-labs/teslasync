import React, { useMemo } from 'react';
import { View } from 'react-native';

import type { ChargeTelemetryReading, ChargingSession } from '../../api/types';
import { KeyValueRow } from '../../components/data/KeyValueRow';
import { ListRow } from '../../components/data/ListRow';
import {
  MetricGrid,
  type MetricGridItem,
} from '../../components/data/MetricGrid';
import { ScreenSection } from '../../components/data/ScreenSection';
import { fleetStyles } from './fleetStyles';
import {
  formatChargingDuration,
  formatDateTime,
  formatPower,
  formatSocRange,
} from './formatFleetValue';

interface ChargingActionRoutesSectionProps {
  session: ChargingSession | null | undefined;
  telemetry: ChargeTelemetryReading[];
  hasTelemetryError: boolean;
}

function latestPowerW(
  reading: ChargeTelemetryReading | undefined,
): number | null {
  if (!reading) {
    return null;
  }

  const measuredPower = Math.max(
    reading.ac_charging_power_w ?? 0,
    reading.dc_charging_power_w ?? 0,
  );
  if (measuredPower > 0) {
    return measuredPower;
  }

  if (
    reading.charger_voltage_v != null &&
    reading.charger_actual_current_a != null
  ) {
    return reading.charger_voltage_v * reading.charger_actual_current_a;
  }

  return null;
}

export function ChargingActionRoutesSection({
  session,
  telemetry,
  hasTelemetryError,
}: ChargingActionRoutesSectionProps) {
  const latestReading = telemetry[telemetry.length - 1];
  const latestInputPowerW = latestPowerW(latestReading);
  const metrics = useMemo<MetricGridItem[]>(
    () => [
      {
        id: 'smart-charge-state',
        label: 'Smart charge',
        value: 'Unavailable',
        helper: 'No optimizer command endpoint exposed',
        tone: 'warning',
        icon: 'sparkles',
      },
      {
        id: 'schedule-state',
        label: 'Schedule basis',
        value: session ? formatDateTime(session.started_at) : '-',
        helper: 'Most recent selected session start',
        tone: session ? 'accent' : 'neutral',
        icon: 'calendarClock',
      },
      {
        id: 'powershare-state',
        label: 'Powershare',
        value: 'Not exposed',
        helper: 'No bidirectional power API route',
        tone: 'warning',
        icon: 'powerShare',
      },
      {
        id: 'charge-vampire-state',
        label: 'Charge drain',
        value: 'Not inferred',
        helper: 'No fake drain analytics from charge rows',
        tone: hasTelemetryError ? 'warning' : 'neutral',
        icon: 'moon',
      },
    ],
    [hasTelemetryError, session],
  );

  return (
    <ScreenSection
      title="Charging action route evidence"
      subtitle="Smart-charge, schedule, powershare, and charging vampire-drain routes render command-safe native states without pretending unavailable controls succeeded."
    >
      <View style={fleetStyles.detailStack}>
        <MetricGrid items={metrics} minItemWidth={180} />
        <View style={fleetStyles.list}>
          <ListRow
            title="Smart charge route"
            subtitle="The native app exposes the route surface and selected-session context, but does not fabricate optimizer decisions."
            meta="/smart-charge"
            icon="sparkles"
            detail={
              <View>
                <KeyValueRow
                  label="Selected session"
                  value={session ? `#${session.id}` : '-'}
                />
                <KeyValueRow
                  label="SOC range"
                  value={formatSocRange(
                    session?.start_soc_pct,
                    session?.end_soc_pct,
                  )}
                />
              </View>
            }
          />
          <ListRow
            title="Charging schedule route"
            subtitle="Schedule evidence comes from returned session timestamps; write controls remain unavailable until an API exists."
            meta="/charging/schedule"
            icon="calendarClock"
            detail={
              <View>
                <KeyValueRow
                  label="Started"
                  value={formatDateTime(session?.started_at)}
                />
                <KeyValueRow
                  label="Duration"
                  value={formatChargingDuration(session)}
                />
              </View>
            }
          />
          <ListRow
            title="Powershare route"
            subtitle="Vehicle-to-home/export power is not exposed by the current native API contract; charger input telemetry is shown separately."
            meta="/powershare"
            icon="powerShare"
            detail={
              <View>
                <KeyValueRow
                  label="Latest input power"
                  value={formatPower(latestInputPowerW)}
                />
                <KeyValueRow
                  label="Battery heater"
                  value={
                    latestReading?.battery_heater_on == null
                      ? '-'
                      : latestReading.battery_heater_on
                      ? 'On'
                      : 'Off'
                  }
                />
              </View>
            }
          />
          <ListRow
            title="Charging vampire-drain route"
            subtitle="Charge-scoped drain is kept visible as unavailable rather than inferred from charging energy or SOC deltas."
            meta="/charging/vampire-drain"
            icon="moon"
            detail={
              <View>
                <KeyValueRow
                  label="Drain endpoint"
                  value="Unavailable for charging scope"
                />
                <KeyValueRow
                  label="Related native route"
                  value="/vampire-drain on Energy"
                />
              </View>
            }
          />
        </View>
      </View>
    </ScreenSection>
  );
}
