import React, {useEffect, useMemo, useState} from 'react';
import {View} from 'react-native';

import {
  useChargeTelemetry,
  useChargingSession,
  useChargingSessions,
} from '../../api/hooks';
import {ChargingDetailSection} from './ChargingDetailSection';
import {ChargingOverviewSection} from './ChargingOverviewSection';
import {ChargingSessionListSection} from './ChargingSessionListSection';
import {
  FleetRouteReadiness,
  type FleetRouteReadinessItem,
} from './FleetRouteReadiness';
import {fleetStyles} from './fleetStyles';

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
      'Native renders a power bar summary from telemetry without using the web charging chart.',
  },
  {
    id: 'charging-vampire-drain',
    label: 'Charging vampire drain',
    route: '/charging/vampire-drain',
    api: '/vampire-drain',
    status: 'native-summary',
    evidence:
      'Charging vampire-drain parity is represented as a native summary/unavailable state without inventing analytics.',
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
    <View style={fleetStyles.root}>
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
