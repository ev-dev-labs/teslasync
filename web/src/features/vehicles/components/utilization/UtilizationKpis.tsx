import { Activity } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { StatStrip } from '@/components/data-display';
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
            <StatStrip id="utilization-summary" className="col-span-full"
              period={{ kind: 'unknown', label: t('utilization.kpis', 'Utilization summary metrics'),
                reason: t('utilization.ofWindow', 'of the observed window') }}
              metrics={[
                { metricId: 'text', occurrenceId: 'driving-share', label: t('utilization.drivingShare', 'Time driving'),
                  rawValue: summary.drivingShare != null ? `${fmtNumber(summary.drivingShare * 100)}%` : null,
                  context: t('utilization.ofWindow', 'of the observed window') },
                { metricId: 'text', occurrenceId: 'active-days', label: t('utilization.activeDays', 'Days used'),
                  rawValue: summary.activeDayShare != null ? `${fmtNumber(summary.activeDayShare * 100)}%` : null,
                  context: t('utilization.observedCalendarDays', '{{active}} of {{days}} observed UTC days', {
                    active: fmtInt(summary.consistency.activeDays), days: fmtInt(summary.observedCalendarDays),
                  }) },
                { metricId: 'text', occurrenceId: 'distance-per-day', label: t('utilization.perDay', 'Distance per day'),
                  rawValue: summary.distancePerDayM != null ? formatDistance(summary.distancePerDayM) : null,
                  context: t('utilization.driveCount', '{{count}} drives', { count: summary.drives }) },
                { metricId: 'text', occurrenceId: 'cost-per-distance', label: t('utilization.costPerKmCard', 'Cost per distance'),
                  rawValue: costPerDisplayDistance != null ? `${formatCurrency(costPerDisplayDistance)}/${distanceUnit}` : null,
                  context: t('utilization.energyOnly', 'energy only') },
              ]}
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
