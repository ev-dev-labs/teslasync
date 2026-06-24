import React, { useEffect, useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import {
  useChargeTelemetry,
  useChargingSession,
  useChargingSessions,
} from '../../api/hooks';
import type { ChargeTelemetryReading, ChargingSession } from '../../api/types';
import { ChartSummary, type ChartSummaryDatum } from '../../components/charts/ChartSummary';
import { KeyValueRow } from '../../components/data/KeyValueRow';
import { ListRow } from '../../components/data/ListRow';
import { MetricGrid, type MetricGridItem } from '../../components/data/MetricGrid';
import { ScreenSection } from '../../components/data/ScreenSection';
import { StatusPill } from '../../components/ui/StatusPill';
import { spacing } from '../../theme/tokens';
import { FleetMessage } from './FleetMessage';
import {
  FleetRouteReadiness,
  type FleetRouteReadinessItem,
} from './FleetRouteReadiness';
import {
  formatChargingDuration,
  formatCost,
  formatDateTime,
  formatEnergy,
  formatPower,
  formatSocRange,
} from './formatFleetValue';

const chargingReadinessItems: FleetRouteReadinessItem[] = [
  {
    id: 'charging-list',
    label: 'Charging sessions',
    route: '/charging',
    api: '/charging',
    status: 'implemented',
    evidence: 'The native Charging screen renders API-backed charging session list and summary cards.',
  },
  {
    id: 'charging-detail',
    label: 'Charge detail shell',
    route: '/charging/:id',
    api: '/charging/{sessionID}, /charging/{sessionID}/telemetry',
    status: 'implemented',
    evidence: 'Selecting a charge session resolves typed detail and telemetry summary surfaces.',
  },
  {
    id: 'charging-curve',
    label: 'Charging curve summary',
    route: '/charging-curve',
    api: '/charging/{sessionID}/telemetry',
    status: 'native-summary',
    evidence:
      'Native renders a power bar summary from telemetry; the full web charging curve remains pending.',
  },
  {
    id: 'charging-vampire-drain',
    label: 'Charging vampire drain',
    route: '/charging/vampire-drain',
    api: '/vampire-drain',
    status: 'pending',
    evidence: 'The route remains mapped, but vampire-drain analytics are not implemented in N0005.',
  },
];

export function ChargingFleetView() {
  const sessionsQuery = useChargingSessions({limit: 20});
  const sessions = useMemo(() => sessionsQuery.data ?? [], [sessionsQuery.data]);
  const [selectedSessionId, setSelectedSessionId] = useState<number | null>(null);

  useEffect(() => {
    if (sessions.length === 0) {
      if (selectedSessionId !== null) {
        setSelectedSessionId(null);
      }
      return;
    }

    if (!sessions.some(session => session.id === selectedSessionId)) {
      setSelectedSessionId(sessions[0].id);
    }
  }, [selectedSessionId, sessions]);

  const selectedSession = sessions.find(session => session.id === selectedSessionId) ?? null;
  const detailQuery = useChargingSession(selectedSessionId);
  const telemetryQuery = useChargeTelemetry(selectedSessionId);
  const detailSession = detailQuery.data ?? selectedSession;
  const telemetry = telemetryQuery.data ?? [];

  return (
    <View style={styles.root}>
      <ChargingOverviewSection
        sessions={sessions}
        isLoading={sessionsQuery.isLoading}
        hasError={Boolean(sessionsQuery.error)}
      />
      <ChargingSessionListSection
        sessions={sessions}
        selectedSessionId={selectedSessionId}
        isLoading={sessionsQuery.isLoading}
        hasError={Boolean(sessionsQuery.error)}
        onSelect={setSelectedSessionId}
      />
      <ChargingDetailSection
        session={detailSession}
        telemetry={telemetry}
        isLoading={detailQuery.isLoading || telemetryQuery.isLoading}
        hasDetailError={Boolean(detailQuery.error)}
        hasTelemetryError={Boolean(telemetryQuery.error)}
      />
      <FleetRouteReadiness
        title="Charging route readiness"
        subtitle="Charging list, detail, and telemetry routes are represented without native WebView shortcuts."
        items={chargingReadinessItems}
      />
    </View>
  );
}

interface ChargingOverviewSectionProps {
  sessions: ChargingSession[];
  isLoading: boolean;
  hasError: boolean;
}

function ChargingOverviewSection({sessions, isLoading, hasError}: ChargingOverviewSectionProps) {
  const totalEnergyWh = sessions.reduce((sum, session) => sum + (session.total_energy_added_wh ?? 0), 0);
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

interface ChargingSessionListSectionProps {
  sessions: ChargingSession[];
  selectedSessionId: number | null;
  isLoading: boolean;
  hasError: boolean;
  onSelect: (sessionId: number) => void;
}

function ChargingSessionListSection({
  sessions,
  selectedSessionId,
  isLoading,
  hasError,
  onSelect,
}: ChargingSessionListSectionProps) {
  return (
    <ScreenSection
      title="Charging sessions"
      subtitle="Recent sessions from /charging with selectable native detail shells.">
      {isLoading && sessions.length === 0 ? (
        <FleetMessage
          title="Loading sessions"
          message="Fetching charging sessions from the TeslaSync API."
          tone="loading"
        />
      ) : hasError && sessions.length === 0 ? (
        <FleetMessage
          title="Charging API unavailable"
          message="Charging history will appear when /charging is reachable."
          tone="error"
        />
      ) : sessions.length === 0 ? (
        <FleetMessage
          title="No charging sessions"
          message="Charging history, live sessions, and energy totals will appear here."
          tone="empty"
          icon="charger"
        />
      ) : (
        <View style={styles.list}>
          {sessions.map(session => (
            <ListRow
              key={session.id}
              title={`Session #${session.id}`}
              subtitle={`${formatEnergy(session.total_energy_added_wh)} · ${formatChargingDuration(session)}`}
              meta={session.id === selectedSessionId ? 'Selected' : formatDateTime(session.started_at)}
              icon="charging"
              onPress={() => onSelect(session.id)}
              detail={
                <View>
                  <KeyValueRow label="State of charge" value={formatSocRange(session.start_soc_pct, session.end_soc_pct)} />
                  <KeyValueRow label="Peak power" value={formatPower(session.peak_power_w)} />
                  <KeyValueRow label="Charger" value={session.charger_type ?? '-'} />
                </View>
              }
            />
          ))}
        </View>
      )}
    </ScreenSection>
  );
}

interface ChargingDetailSectionProps {
  session: ChargingSession | null | undefined;
  telemetry: ChargeTelemetryReading[];
  isLoading: boolean;
  hasDetailError: boolean;
  hasTelemetryError: boolean;
}

function ChargingDetailSection({
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
        <View style={styles.detailStack}>
          <View style={styles.detailHeader}>
            <View style={styles.detailCopy}>
              <KeyValueRow label="Started" value={formatDateTime(session.started_at)} />
              <KeyValueRow label="Ended" value={formatDateTime(session.ended_at)} />
              <KeyValueRow label="Duration" value={formatChargingDuration(session)} />
              <KeyValueRow label="Cost" value={formatCost(session.cost_decimal, session.cost_currency)} />
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

const styles = StyleSheet.create({
  root: {
    gap: spacing.lg,
  },
  list: {
    gap: spacing.sm,
  },
  detailStack: {
    gap: spacing.lg,
  },
  detailHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  detailCopy: {
    flex: 1,
    minWidth: 0,
  },
});
