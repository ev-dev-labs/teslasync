import { useTranslation } from 'react-i18next';
import { GlassPanel, PanelTitle } from '@/components/ui';
import { Grid } from '@/components/layout';
import { StatCard } from '@/components/data-display';
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

const SUMMARY_GRID = { default: 2, sm: 3, lg: 6 } as const;

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
            {!hasSessions && (
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
            <Grid cols={SUMMARY_GRID} gap={4}>
              <StatCard
                label={t('dayLog.summary.drives', 'Drives')}
                value={summary?.drive_count ?? 0}
                icon={<Icons.drive className="h-4 w-4" />}
              />
              <StatCard
                label={t('dayLog.summary.charges', 'Charges')}
                value={summary?.charge_count ?? 0}
                icon={<Icons.charging className="h-4 w-4" />}
              />
              <StatCard
                label={t('dayLog.summary.driveTime', 'Drive time')}
                value={formatDuration(summary?.drive_duration_s)}
                icon={<Icons.clock className="h-4 w-4" />}
              />
              <StatCard
                label={t('dayLog.summary.distance', 'Distance')}
                value={formatDistance(summary?.drive_distance_m)}
                icon={<Icons.navigation className="h-4 w-4" />}
              />
              <StatCard
                label={t('dayLog.summary.energyAdded', 'Energy added')}
                value={formatEnergy(summary?.energy_added_wh)}
                icon={<Icons.batteryCharging className="h-4 w-4" />}
              />
              <StatCard
                label={t('dayLog.summary.energyUsed', 'Energy used')}
                value={formatEnergy(summary?.energy_used_wh)}
                icon={<Icons.bolt className="h-4 w-4" />}
              />
            </Grid>
          </>
        )}
      </div>
    </GlassPanel>
  );
}
