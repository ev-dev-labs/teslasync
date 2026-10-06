import { useTranslation } from 'react-i18next';
import type { DataState } from '@/api/dataState';
import { type StatMetric } from '@/components/data-display/stat-reference';
import { ChargingSummaryBrief } from '../operationalbrief-all/ChargingSummaryBrief';
import { EmptyState, QueryError } from '@/components/feedback';
import { useUnits } from '@/hooks/useUnits';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';

export interface ChargingHeatmapStats {
  count: number;
  totalEnergyWh: number;
  totalCost: number;
  avgDurationS: number;
  energyCount: number;
  costCount: number;
  durationCount: number;
}

interface ChargingHeatmapSummaryProps {
  stats: ChargingHeatmapStats | null;
  state: DataState<unknown>;
  loading: boolean;
}

/** Presentation only: operands, SI totals and query scope stay with the page. */
export function ChargingHeatmapSummary({ stats, state, loading }: ChargingHeatmapSummaryProps) {
  const { t } = useTranslation();
  const { unitPrefs } = useUnits();
  const { precision, locale } = useNumberFormatting();
  const noMeasurements = state.hasData
    ? t('charging.heatmap.noMeasurements', 'No recorded measurements in the returned sessions')
    : t('charging.heatmap.historyNotLoaded', 'Charging history has not loaded');
  const partialReason = t('charging.heatmap.partialMeasurements', 'Some returned sessions have no recorded value; the total includes recorded values only.');
  const metrics: StatMetric[] = [
    {
      metricId: 'charge.sessions',
      occurrenceId: 'charging-heatmap-total-sessions',
      label: t('charging.heatmap.totalSessions', 'Total Sessions'),
      description: t('charging.heatmap.sessionsHelp', 'Number of sessions returned for the selected vehicle and range.'),
      rawValue: state.hasData ? stats?.count ?? 0 : null,
      display: { units: { locale } },
    },
    {
      metricId: 'charge.energyAdded',
      occurrenceId: 'charging-heatmap-total-energy',
      label: t('charging.heatmap.totalEnergy', 'Total Energy'),
      description: t('charging.heatmap.energyHelp', 'Sum of recorded energy added in the returned sessions.'),
      rawValue: stats && stats.energyCount > 0 ? stats.totalEnergyWh : null,
      missingReason: noMeasurements,
      context: stats && stats.energyCount > 0 && stats.energyCount < stats.count ? partialReason : undefined,
      // Match useUnits.formatEnergy even before a saved precision exists.
      display: { precision: unitPrefs.precision ?? 2 },
    },
    {
      metricId: 'charge.recordedCost',
      occurrenceId: 'charging-heatmap-total-cost',
      label: t('charging.heatmap.totalCost', 'Total Cost'),
      description: t('charging.heatmap.costHelp', 'Sum of recorded session costs, not estimated billing.'),
      rawValue: stats && stats.costCount > 0 ? stats.totalCost : null,
      missingReason: noMeasurements,
      context: stats && stats.costCount > 0 && stats.costCount < stats.count ? partialReason : undefined,
      display: { precision: unitPrefs.precision ?? precision },
    },
    {
      metricId: 'charge.avgDuration',
      occurrenceId: 'charging-heatmap-average-duration',
      label: t('charging.heatmap.avgDuration', 'Avg Duration'),
      description: t('charging.heatmap.durationHelp', 'Average over sessions with valid start and end timestamps and a positive measured duration.'),
      rawValue: stats && stats.durationCount > 0 ? stats.avgDurationS : null,
      missingReason: state.hasData
        ? t('charging.heatmap.noDuration', 'No completed session with a positive measured duration')
        : t('charging.heatmap.historyNotLoaded', 'Charging history has not loaded'),
      display: { precision: unitPrefs.precision ?? 0 },
    },
  ];

  return (
    <ChargingSummaryBrief
      id="charging-heatmap-summary"
      metrics={state.fatalError ? [] : metrics}
      loading={loading}
      retained={state.hasData && state.status === 'stale'}
      emptyContent={state.fatalError ? (
        <QueryError error={state.fatalError} onRetry={state.retry ?? undefined} />
      ) : (
        <EmptyState
          message={t('charging.heatmap.historyNotLoaded', 'Charging history has not loaded')}
          action={state.retry ? { label: t('common.retry', 'Retry'), onClick: state.retry } : undefined}
        />
      )}
      period={{
        kind: 'unknown',
        label: t('charging.heatmap.returnedSessions', 'Returned charging sessions'),
        reason: t('charging.heatmap.loadedScope', 'Summary of the returned sessions for the shared vehicle and date scope (request limit: 2,000). This is not a complete-history total.'),
      }}
    />
  );
}
