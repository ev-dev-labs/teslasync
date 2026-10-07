import {
  Activity,
  CalendarClock,
  CalendarDays,
  Clock3,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { MetricCard } from '@/components/data-display';
import { EmptyState, QueryError, Skeleton } from '@/components/feedback';
import { Grid } from '@/components/layout';
import { GlassPanel } from '@/components/ui';
import { fmtInt } from '@/lib/numberFormat';

import type { DrivingRhythm } from '../../lib/drivingRhythm';
import type { DrivingRhythmSectionState } from './types';
import { useRhythmDayLabel } from './useRhythmDayLabel';

const KPI_COLUMNS = { default: 2, xl: 4 } as const;

interface DrivingRhythmKpisProps extends DrivingRhythmSectionState {
  summary: DrivingRhythm;
}

export function DrivingRhythmKpis({
  summary,
  isLoading,
  error,
  onRetry,
}: DrivingRhythmKpisProps) {
  const { t } = useTranslation();
  const dayLabel = useRhythmDayLabel();
  const favorite = summary.favorite;
  const weekdayShare =
    summary.total > 0
      ? Math.round((summary.weekdayCount / summary.total) * 100)
      : null;

  return (
    <section
      aria-label={t('rhythm.kpis', 'Driving rhythm summary metrics')}
      data-testid="driving-rhythm-kpis"
    >
      <Grid cols={KPI_COLUMNS} gap={4}>
        {error ? (
          <GlassPanel className="col-span-full p-4 sm:p-5">
            <QueryError error={error} onRetry={onRetry} />
          </GlassPanel>
        ) : isLoading ? (
          Array.from({ length: 4 }, (_, index) => (
            <Skeleton key={index} height={96} className="rounded-xl" />
          ))
        ) : (
          <>
            <MetricCard
              label={t('rhythm.totalDrives', 'Drives')}
              value={fmtInt(summary.total)}
              subtitle={
                summary.excluded > 0
                  ? t(
                      'rhythm.kpi.timestampCoverage',
                      '{{included}} of {{observed}} returned rows included',
                      {
                        included: summary.total,
                        observed: summary.observed,
                      },
                    )
                  : t(
                      'rhythm.kpi.returnedCoverage',
                      '{{count}} returned rows included',
                      { count: summary.observed },
                    )
              }
              icon={<CalendarDays className="h-5 w-5" aria-hidden="true" />}
              color="cyan"
            />
            <MetricCard
              label={t('rhythm.favoriteSlot', 'Favorite Slot')}
              value={
                favorite
                  ? `${dayLabel(favorite.day)} ${String(
                      favorite.hour,
                    ).padStart(2, '0')}:00`
                  : '—'
              }
              subtitle={
                favorite
                  ? t('rhythm.driveCount', '{{count}} drives', {
                      count: favorite.count,
                    })
                  : t('rhythm.kpi.noFavorite', 'No valid departure starts')
              }
              icon={<Clock3 className="h-5 w-5" aria-hidden="true" />}
              color="purple"
            />
            <MetricCard
              label={t('rhythm.weekdayShare', 'Weekday Share')}
              value={weekdayShare != null ? `${weekdayShare}%` : '—'}
              subtitle={t(
                'rhythm.weekendCount',
                '{{count}} weekend drives',
                { count: summary.weekendCount },
              )}
              icon={
                <CalendarClock className="h-5 w-5" aria-hidden="true" />
              }
              color="blue"
            />
            <MetricCard
              label={t('rhythm.predictability', 'Predictability')}
              value={
                summary.predictability != null
                  ? fmtInt(summary.predictability)
                  : '—'
              }
              subtitle={
                summary.predictability != null
                  ? t('rhythm.of100', 'of 100')
                  : t(
                      'rhythm.kpi.predictabilityFloor',
                      'Needs at least {{count}} valid drives',
                      { count: summary.minPredictabilityDrives },
                    )
              }
              icon={<Activity className="h-5 w-5" aria-hidden="true" />}
              color="green"
            />
            {summary.total === 0 ? (
              <EmptyState
                className="col-span-full py-6"
                icon={<CalendarClock className="h-7 w-7" aria-hidden="true" />}
                message={t(
                  'rhythm.noDrives',
                  'No drives in this period yet.',
                )}
                actionTo={{
                  label: t('rhythm.browseDrives', 'Browse drives'),
                  to: '/drives',
                }}
              />
            ) : null}
          </>
        )}
      </Grid>
    </section>
  );
}
