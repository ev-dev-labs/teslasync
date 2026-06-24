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
import {
  formatChargingDuration,
  formatCost,
  formatDateTime,
  formatEnergy,
} from './formatFleetValue';

interface ChargingCostAnalysisSectionProps {
  sessions: ChargingSession[];
  isLoading: boolean;
  hasError: boolean;
}

function resolveCurrency(sessions: ChargingSession[]): string {
  return (
    sessions.find(session => session.cost_currency)?.cost_currency ?? 'USD'
  );
}

function formatCostPerKwh(
  cost: number | null | undefined,
  energyWh: number,
  currency: string,
): string {
  if (cost == null || !Number.isFinite(cost) || energyWh <= 0) {
    return '-';
  }

  return `${formatCost(cost / (energyWh / 1000), currency)}/kWh`;
}

export function ChargingCostAnalysisSection({
  sessions,
  isLoading,
  hasError,
}: ChargingCostAnalysisSectionProps) {
  const costedSessions = useMemo(
    () =>
      sessions.filter(
        session =>
          session.cost_decimal != null && Number.isFinite(session.cost_decimal),
      ),
    [sessions],
  );
  const currency = resolveCurrency(costedSessions);
  const totalCost = costedSessions.reduce(
    (sum, session) => sum + (session.cost_decimal ?? 0),
    0,
  );
  const totalEnergyWh = costedSessions.reduce(
    (sum, session) => sum + (session.total_energy_added_wh ?? 0),
    0,
  );
  const averageCost =
    costedSessions.length > 0 ? totalCost / costedSessions.length : null;
  const chartData = useMemo<ChartSummaryDatum[]>(
    () =>
      costedSessions.slice(-8).map(session => ({
        id: String(session.id),
        label: `#${session.id}`,
        value: session.cost_decimal ?? 0,
        formattedValue: formatCost(session.cost_decimal, session.cost_currency),
        icon: 'receipt' as const,
      })),
    [costedSessions],
  );
  const metrics = useMemo<MetricGridItem[]>(
    () => [
      {
        id: 'charging-cost-total',
        label: 'Session cost',
        value:
          costedSessions.length === 0 ? '-' : formatCost(totalCost, currency),
        helper: `${costedSessions.length} returned cost rows`,
        tone: hasError ? 'warning' : 'success',
        icon: 'receipt',
      },
      {
        id: 'charging-cost-average',
        label: 'Average cost',
        value: formatCost(averageCost, currency),
        helper: 'Average of returned sessions',
        tone: 'neutral',
        icon: 'wallet',
      },
      {
        id: 'charging-cost-rate',
        label: 'Cost rate',
        value: formatCostPerKwh(totalCost, totalEnergyWh, currency),
        helper: 'Cost divided by SI Wh added',
        tone: 'accent',
        icon: 'bolt',
      },
      {
        id: 'charging-cost-energy',
        label: 'Costed energy',
        value: formatEnergy(totalEnergyWh),
        helper: 'Energy from cost-bearing rows',
        tone: 'warning',
        icon: 'batteryCharging',
      },
    ],
    [
      averageCost,
      costedSessions.length,
      currency,
      hasError,
      totalCost,
      totalEnergyWh,
    ],
  );

  return (
    <ScreenSection
      title="Charging cost analysis"
      subtitle="Cost-analysis and charging-cost routes are backed by returned charging session cost fields only."
    >
      <View style={fleetStyles.detailStack}>
        <MetricGrid items={metrics} minItemWidth={180} />
        <ChartSummary
          title="Charging cost trend"
          subtitle="Accessible native summary of returned session costs."
          metricLabel="Total returned cost"
          metricValue={
            costedSessions.length === 0 ? '-' : formatCost(totalCost, currency)
          }
          data={chartData}
          emptyLabel={
            hasError
              ? 'Charging cost rows are unavailable because /charging failed.'
              : 'Cost analysis will appear when charging sessions include cost_decimal.'
          }
          icon="receipt"
          sourceLabel="Cost chart from /charging session rows; no forecast or synthetic tariff data is generated"
          dataTableLabel="Charging costs"
        />
        {isLoading && sessions.length === 0 ? (
          <FleetMessage
            title="Loading charging costs"
            message="Fetching charging sessions before deriving cost-analysis evidence."
            tone="loading"
          />
        ) : hasError && sessions.length === 0 ? (
          <FleetMessage
            title="Charging cost API unavailable"
            message="Cost-analysis and charging-cost routes remain visible until /charging recovers."
            tone="error"
          />
        ) : costedSessions.length === 0 ? (
          <FleetMessage
            title="No charging cost rows"
            message="The native app does not invent tariffs; session costs render when the API returns cost_decimal."
            tone="empty"
            icon="receipt"
          />
        ) : (
          <View style={fleetStyles.list}>
            {costedSessions.slice(0, 5).map(session => (
              <ListRow
                key={session.id}
                title={`Charging cost session #${session.id}`}
                subtitle={`${formatCost(
                  session.cost_decimal,
                  session.cost_currency,
                )} · ${formatEnergy(session.total_energy_added_wh)}`}
                meta={formatDateTime(session.started_at)}
                icon="receipt"
                detail={
                  <View>
                    <KeyValueRow
                      label="Duration"
                      value={formatChargingDuration(session)}
                    />
                    <KeyValueRow
                      label="Rate"
                      value={formatCostPerKwh(
                        session.cost_decimal,
                        session.total_energy_added_wh ?? 0,
                        session.cost_currency ?? currency,
                      )}
                    />
                    <KeyValueRow
                      label="Source route"
                      value="/cost-analysis, /charging/costs"
                    />
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
