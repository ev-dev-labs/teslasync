import {
  CalendarClock,
  Flag,
  Gauge,
  Milestone,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { MetricCard } from '@/components/data-display';
import { EmptyState, QueryError, Skeleton } from '@/components/feedback';
import { Grid } from '@/components/layout';
import { GlassPanel } from '@/components/ui';
import { fmtNumber } from '@/lib/numberFormat';

import type { OdometerMilestoneResult } from '../../lib/odometerMilestones';
import type { MilestoneSectionState } from './types';
import { useOdometerMilestoneDisplay } from './useOdometerMilestoneDisplay';

const KPI_COLUMNS = { default: 2, xl: 4 } as const;

interface MilestoneKpisProps extends MilestoneSectionState {
  summary: OdometerMilestoneResult;
}

export function MilestoneKpis({
  summary,
  isLoading,
  error,
  onRetry,
}: MilestoneKpisProps) {
  const { t } = useTranslation();
  const { formatDateMs, formatDistanceKm } =
    useOdometerMilestoneDisplay();
  const next = summary.upcoming[0] ?? null;
  const pace = summary.primaryPace;
  const observedDays =
    pace.observedDays != null ? fmtNumber(pace.observedDays, 1) : '—';

  return (
    <section
      aria-label={t('milestones.sections.kpis', 'Milestone summary metrics')}
      data-testid="milestone-kpis"
    >
      <Grid cols={KPI_COLUMNS} gap={4}>
        {error ? (
          <GlassPanel className="col-span-full p-4 sm:p-5">
            <QueryError error={error} onRetry={onRetry} />
          </GlassPanel>
        ) : isLoading ? (
          Array.from({ length: 4 }).map((_, index) => (
            <Skeleton key={index} height={96} className="rounded-xl" />
          ))
        ) : (
          <>
            <MetricCard
              label={t(
                'milestones.kpi.odometer',
                'Calibrated observed odometer',
              )}
              value={formatDistanceKm(summary.currentOdometerKm)}
              subtitle={t(
                'milestones.kpi.odometerEvidence',
                'Calibration + {{count}} eligible returned drives',
                { count: summary.accounting.eligibleRows },
              )}
              icon={<Gauge className="h-5 w-5" aria-hidden="true" />}
              color="cyan"
            />
            <MetricCard
              label={t('milestones.kpi.pace', 'Supported 90-day pace')}
              value={
                pace.paceKmPerDay != null
                  ? t('milestones.kpi.perDay', '{{distance}} / day', {
                      distance: formatDistanceKm(pace.paceKmPerDay, 1),
                    })
                  : '—'
              }
              subtitle={
                pace.supported
                  ? t(
                      'milestones.kpi.paceEvidence',
                      '{{count}} drives across {{days}} observed days',
                      {
                        count: pace.sampleCount,
                        days: observedDays,
                      },
                    )
                  : t(
                      'milestones.kpi.paceUnsupported',
                      'Needs at least {{minimum}} eligible recent drives',
                      { minimum: summary.method.minimumPaceDrives },
                    )
              }
              icon={
                <CalendarClock className="h-5 w-5" aria-hidden="true" />
              }
              color="purple"
            />
            <MetricCard
              label={t('milestones.kpi.next', 'Next round milestone')}
              value={
                next ? formatDistanceKm(next.thresholdKm) : '—'
              }
              subtitle={
                next
                  ? t('milestones.kpi.remaining', '{{distance}} remaining', {
                      distance: formatDistanceKm(next.remainingKm),
                    })
                  : undefined
              }
              icon={<Flag className="h-5 w-5" aria-hidden="true" />}
              color="amber"
            />
            <MetricCard
              label={t('milestones.kpi.eta', 'Next projected ETA')}
              value={formatDateMs(next?.forecast?.etaMs)}
              subtitle={
                next?.forecast
                  ? t(
                      'milestones.kpi.etaEvidence',
                      'Trailing-90-day projection, not a guarantee',
                    )
                  : pace.supported
                    ? t(
                        'milestones.kpi.etaOutOfRange',
                        'Supported pace, but beyond forecast horizon',
                      )
                    : t(
                        'milestones.kpi.etaUnsupported',
                        'Unavailable without supported 90-day evidence',
                      )
              }
              icon={<Milestone className="h-5 w-5" aria-hidden="true" />}
              color="green"
            />
            {summary.accounting.eligibleRows === 0 ? (
              <EmptyState
                className="col-span-full py-5"
                icon={<Gauge className="h-8 w-8" aria-hidden="true" />}
                message={t(
                  'milestones.kpi.empty',
                  'No eligible positive-distance drives are available in the returned history window.',
                )}
                actionTo={{
                  label: t('milestones.actions.browseDrives', 'Browse drives'),
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
