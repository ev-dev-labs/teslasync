import { Activity, CalendarCheck2, Route, Wallet } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { MetricCard } from '@/components/data-display';
import { EmptyState, QueryError, Skeleton } from '@/components/feedback';
import { Grid } from '@/components/layout';
import { GlassPanel } from '@/components/ui';
import { useFormatting } from '@/hooks/useFormatting';

import { convertDistanceToSI } from '@/lib/unitConversion';

import type { UtilizationSummary } from '../../lib/utilization';
import type { UtilizationSectionState } from './types';
import { useUtilizationDisplay } from './useUtilizationDisplay';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';

const KPI_COLUMNS = { default: 2, xl: 4 } as const;

interface UtilizationKpisProps extends UtilizationSectionState {
  summary: UtilizationSummary;
}

export function UtilizationKpis({
  summary,
  isLoading,
  error,
  onRetry,
}: UtilizationKpisProps) {
  const { fmtNumber, fmtInt } = useNumberFormatting();
  const { t } = useTranslation();
  const { formatCurrency } = useFormatting();
  const { distanceUnit, formatDistance } = useUtilizationDisplay();
  const distanceUnitKm =
    convertDistanceToSI(1, distanceUnit) / 1_000;
  const costPerDisplayDistance =
    summary.costPerKm != null
      ? summary.costPerKm * distanceUnitKm
      : null;

  return (
    <section
      aria-label={t(
        'utilization.kpis',
        'Utilization summary metrics',
      )}
      data-testid="utilization-kpis"
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
              label={t('utilization.drivingShare', 'Time driving')}
              value={
                summary.drivingShare != null
                  ? `${fmtNumber(summary.drivingShare * 100)}%`
                  : '—'
              }
              subtitle={t(
                'utilization.ofWindow',
                'of the observed window',
              )}
              icon={
                <Activity className="h-5 w-5" aria-hidden="true" />
              }
              color="cyan"
            />
            <MetricCard
              label={t('utilization.activeDays', 'Days used')}
              value={
                summary.activeDayShare != null
                  ? `${fmtNumber(summary.activeDayShare * 100)}%`
                  : '—'
              }
              subtitle={t(
                'utilization.observedCalendarDays',
                '{{active}} of {{days}} observed UTC days',
                {
                  active: fmtInt(summary.consistency.activeDays),
                  days: fmtInt(summary.observedCalendarDays),
                },
              )}
              icon={
                <CalendarCheck2
                  className="h-5 w-5"
                  aria-hidden="true"
                />
              }
              color="purple"
            />
            <MetricCard
              label={t('utilization.perDay', 'Distance per day')}
              value={
                summary.distancePerDayM != null
                  ? formatDistance(summary.distancePerDayM)
                  : '—'
              }
              subtitle={t(
                'utilization.driveCount',
                '{{count}} drives',
                { count: summary.drives },
              )}
              icon={<Route className="h-5 w-5" aria-hidden="true" />}
              color="green"
            />
            <MetricCard
              label={t(
                'utilization.costPerKmCard',
                'Cost per distance',
              )}
              value={
                costPerDisplayDistance != null
                  ? `${formatCurrency(
                      costPerDisplayDistance,
                    )}/${distanceUnit}`
                  : '—'
              }
              subtitle={t(
                'utilization.energyOnly',
                'energy only',
              )}
              icon={<Wallet className="h-5 w-5" aria-hidden="true" />}
              color="amber"
            />
            {summary.accounting.eligibleRows === 0 ? (
              <EmptyState
                className="col-span-full py-5"
                icon={
                  <Activity className="h-8 w-8" aria-hidden="true" />
                }
                message={t(
                  'utilization.noData',
                  'No drives in this period yet.',
                )}
                actionTo={{
                  label: t(
                    'utilization.browseDrives',
                    'Browse drives',
                  ),
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
