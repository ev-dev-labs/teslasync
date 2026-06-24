import React, { useEffect, useMemo, useState } from 'react';
import { View } from 'react-native';

import {
  useChargeTelemetry,
  useChargingSession,
  useChargingSessions,
} from '../../api/hooks';
import { ChargingActionRoutesSection } from './ChargingActionRoutesSection';
import { ChargingCostAnalysisSection } from './ChargingCostAnalysisSection';
import { ChargingDetailSection } from './ChargingDetailSection';
import { ChargingHeatmapSection } from './ChargingHeatmapSection';
import { ChargingOverviewSection } from './ChargingOverviewSection';
import { ChargingSessionListSection } from './ChargingSessionListSection';
import {
  FleetRouteReadiness,
  type FleetRouteReadinessItem,
} from './FleetRouteReadiness';
import { fleetStyles } from './fleetStyles';

const chargingReadinessItems: FleetRouteReadinessItem[] = [
  {
    id: 'charging-list',
    label: 'Charging sessions',
    route: '/charging',
    api: '/charging',
    status: 'implemented',
    evidence:
      'The native Charging screen renders API-backed charging session list and summary cards.',
  },
  {
    id: 'charging-detail',
    label: 'Charge detail shell',
    route: '/charging/:id',
    api: '/charging/{sessionID}, /charging/{sessionID}/telemetry',
    status: 'implemented',
    evidence:
      'Selecting a charge session resolves typed detail and telemetry summary surfaces.',
  },
  {
    id: 'charging-curve',
    label: 'Charging curve summary',
    route: '/charging-curve',
    api: '/charging/{sessionID}/telemetry',
    status: 'implemented',
    evidence:
      'Native renders charging-curve and charging-curves telemetry summaries with an accessible data table.',
  },
  {
    id: 'charging-curves',
    label: 'Charging curves history',
    route: '/charging/curves',
    api: '/charging/{sessionID}/telemetry',
    status: 'implemented',
    evidence:
      'Selected charging session telemetry drives native chart summaries without Recharts or WebView embedding.',
  },
  {
    id: 'cost-analysis',
    label: 'Cost analysis',
    route: '/cost-analysis, /charging/costs',
    api: '/charging cost_decimal',
    status: 'implemented',
    evidence:
      'Native derives total, average, and per-kWh cost from returned session cost fields only.',
  },
  {
    id: 'tesla-charging-history',
    label: 'Tesla charging history',
    route: '/tesla-charging-history, /tesla-charging-sessions',
    api: '/charging',
    status: 'implemented',
    evidence:
      'Native session history renders returned Tesla charging sessions with duration, SOC, energy, and charger details.',
  },
  {
    id: 'smart-charge',
    label: 'Smart charge and schedule',
    route: '/smart-charge, /charging/schedule',
    api: '/charging',
    status: 'implemented',
    evidence:
      'Native surfaces selected-session schedule context and command-safe unavailable optimizer states.',
  },
  {
    id: 'powershare',
    label: 'Powershare',
    route: '/powershare',
    api: '/charging/{sessionID}/telemetry',
    status: 'implemented',
    evidence:
      'Native shows charger input telemetry while explicitly marking bidirectional powershare APIs unavailable.',
  },
  {
    id: 'charging-vampire-drain',
    label: 'Charging vampire drain',
    route: '/charging/vampire-drain',
    api: '/charging, /analytics/sleep on Energy',
    status: 'implemented',
    evidence:
      'Native keeps charge-scoped drain visible as unavailable and does not infer vampire drain from charging rows.',
  },
  {
    id: 'charging-heatmap',
    label: 'Charging heatmap',
    route: '/charging-heatmap',
    api: '/charging started_at',
    status: 'implemented',
    evidence:
      'Native aggregates charging session timestamps and SI energy into accessible heatmap bucket summaries.',
  },
];

export function ChargingFleetView() {
  const sessionsQuery = useChargingSessions({ limit: 20 });
  const sessions = useMemo(
    () => sessionsQuery.data ?? [],
    [sessionsQuery.data],
  );
  const [selectedSessionId, setSelectedSessionId] = useState<number | null>(
    null,
  );

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

  const selectedSession =
    sessions.find(session => session.id === selectedSessionId) ?? null;
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
      <ChargingCostAnalysisSection
        sessions={sessions}
        isLoading={sessionsQuery.isLoading}
        hasError={Boolean(sessionsQuery.error)}
      />
      <ChargingActionRoutesSection
        session={detailSession}
        telemetry={telemetry}
        hasTelemetryError={Boolean(telemetryQuery.error)}
      />
      <ChargingHeatmapSection
        sessions={sessions}
        isLoading={sessionsQuery.isLoading}
        hasError={Boolean(sessionsQuery.error)}
      />
      <FleetRouteReadiness
        title="Charging route readiness"
        subtitle="Charging list, detail, curves, costs, schedule, powershare, vampire-drain, and heatmap routes are represented without native WebView shortcuts."
        items={chargingReadinessItems}
      />
    </View>
  );
}
