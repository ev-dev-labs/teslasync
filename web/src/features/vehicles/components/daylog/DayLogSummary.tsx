import { useTranslation } from 'react-i18next';
import { GlassPanel, PanelTitle } from '@/components/ui';
import { StatStrip } from '@/components/data-display';
import { EmptyState, QueryError, StatSkeleton } from '@/components/feedback';
import { Icons } from '@/lib/icons';
import { useUnits } from '@/hooks/useUnits';
import type { DayLogSummary as DayLogSummaryData } from '@/api/types';

export interface DayLogSummaryProps {
  summary: DayLogSummaryData | null;
  isLoading: boolean;
  error: unknown;
  onRetry: () => void;
}

/**
 * Section 2 — day totals. Counts are exact; SI sums render through
 * `useUnits()` and degrade to an em-dash when the server reports null
 * (unknown), never a fake zero. A session-free day keeps the shell and
 * shows an explicit empty state.
 */
export function DayLogSummary({ summary, isLoading, error, onRetry }: DayLogSummaryProps) {
  const { t } = useTranslation();
  const { formatDistance, formatDuration, formatEnergy } = useUnits();

  const hasSessions = (summary?.drive_count ?? 0) + (summary?.charge_count ?? 0) > 0;

  return (
    <GlassPanel className="p-6" data-testid="daylog-summary">
      <PanelTitle>{t('dayLog.summary.title', 'Day summary')}</PanelTitle>
      <div className="mt-4">
        {isLoading ? (
          <StatSkeleton count={6} />
        ) : error ? (
          <QueryError error={error} onRetry={onRetry} resourceName={t('dayLog.summary.title', 'Day summary')} />
        ) : (
          <>
            {summary != null && !hasSessions && (
              <EmptyState
                className="py-6"
                icon={<Icons.activity className="h-8 w-8" />}
                message={t('dayLog.summary.empty', 'No drives or charging sessions this day.')}
                description={t(
                  'dayLog.summary.emptyHint',
                  'Locks, sentry, and state changes below still tell the story when the car stayed put.',
                )}
                actionTo={{
                  label: t('dayLog.summary.drivesCta', 'Open drives'),
                  to: '/drives',
                }}
              />
            )}
            <StatStrip id="day-log-summary" variant="embedded"
              period={{ kind: 'unknown', label: t('dayLog.summary.period', 'Selected vehicle day') }}
              metrics={[
                { metricId: 'count', occurrenceId: 'drives', label: t('dayLog.summary.drives', 'Drives'), rawValue: summary?.drive_count ?? null },
                { metricId: 'count', occurrenceId: 'charges', label: t('dayLog.summary.charges', 'Charges'), rawValue: summary?.charge_count ?? null },
                { metricId: 'text', occurrenceId: 'drive-time', label: t('dayLog.summary.driveTime', 'Drive time'),
                  rawValue: summary?.drive_duration_s == null ? null : formatDuration(summary.drive_duration_s) },
                { metricId: 'text', occurrenceId: 'distance', label: t('dayLog.summary.distance', 'Distance'),
                  rawValue: summary?.drive_distance_m == null ? null : formatDistance(summary.drive_distance_m) },
                { metricId: 'text', occurrenceId: 'energy-added', label: t('dayLog.summary.energyAdded', 'Energy added'),
                  rawValue: summary?.energy_added_wh == null ? null : formatEnergy(summary.energy_added_wh) },
                { metricId: 'text', occurrenceId: 'energy-used', label: t('dayLog.summary.energyUsed', 'Energy used'),
                  rawValue: summary?.energy_used_wh == null ? null : formatEnergy(summary.energy_used_wh) },
              ]}
              />
          </>
        )}
      </div>
    </GlassPanel>
  );
}
