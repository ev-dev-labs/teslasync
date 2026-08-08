import { Flame, Percent, Snowflake, TrendingUp } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { MetricCard } from '@/components/data-display';
import { EmptyState, QueryError, Skeleton } from '@/components/feedback';
import { Grid } from '@/components/layout';
import { GlassPanel } from '@/components/ui';
import { fmtNumber } from '@/lib/numberFormat';

import {
  COLD_GAP_HOURS,
  type ColdStartSummary,
} from '../../lib/coldStart';
import type { ColdStartSectionState } from './types';
import { useColdStartDisplay } from './useColdStartDisplay';

const KPI_COLUMNS = { default: 2, xl: 4 } as const;

interface ColdStartKpisProps extends ColdStartSectionState {
  summary: ColdStartSummary;
  penaltyCostLabel: string | null;
}

/** The original four KPI cards, now backed by the selected server window. */
export function ColdStartKpis({
  summary,
  penaltyCostLabel,
  isLoading,
  error,
  onRetry,
}: ColdStartKpisProps) {
  const { t } = useTranslation();
  const { formatEfficiency, formatEnergy } = useColdStartDisplay();
  const shareLabel =
    summary.penaltyShare != null
      ? t('coldStart.penaltyVsWarm', '{{sign}}{{pct}}% vs warm starts', {
          sign: summary.penaltyShare > 0 ? '+' : summary.penaltyShare < 0 ? '−' : '',
          pct: fmtNumber(Math.abs(summary.penaltyShare) * 100, 0),
        })
      : undefined;

  return (
    <section
      aria-label={t('coldStart.kpis', 'Cold start summary metrics')}
      data-testid="cold-start-kpis"
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
              label={t('coldStart.penalty', 'Cold Penalty')}
              value={formatEfficiency(summary.penaltyWhPerKm)}
              subtitle={shareLabel}
              icon={<Snowflake className="h-5 w-5" aria-hidden="true" />}
              color="cyan"
            />
            <MetricCard
              label={t('coldStart.totalEnergy', 'Extra Energy')}
              value={formatEnergy(summary.totalPenaltyWh, { precision: 1 })}
              subtitle={penaltyCostLabel ?? undefined}
              icon={<TrendingUp className="h-5 w-5" aria-hidden="true" />}
              color="amber"
            />
            <MetricCard
              label={t('coldStart.coldShare', 'Cold Starts')}
              value={
                summary.coldShare != null
                  ? `${fmtNumber(summary.coldShare * 100, 0)}%`
                  : '—'
              }
              subtitle={t('coldStart.gapDef', 'parked {{h}}h or more', {
                h: COLD_GAP_HOURS,
              })}
              icon={<Percent className="h-5 w-5" aria-hidden="true" />}
              color="purple"
            />
            <MetricCard
              label={t('coldStart.analyzed', 'Analyzed')}
              value={summary.analyzed}
              subtitle={t('coldStart.driveCount', 'drives with a known gap')}
              icon={<Flame className="h-5 w-5" aria-hidden="true" />}
              color="green"
            />
            {summary.analyzed === 0 ? (
              <EmptyState /* no-action: the vehicle and range selectors above are the recovery surfaces. */
                className="col-span-full py-6"
                icon={<Snowflake className="h-7 w-7" aria-hidden="true" />}
                message={t(
                  'coldStart.emptyWindow',
                  'No drives with usable energy and a known preceding parking gap were returned for this selected window.',
                )}
              />
            ) : null}
          </>
        )}
      </Grid>
    </section>
  );
}
