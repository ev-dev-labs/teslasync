import {
  Activity,
  BatteryCharging,
  Database,
  Gauge,
  Leaf,
  Rows3,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { MetricCard } from '@/components/data-display';
import { EmptyState, QueryError } from '@/components/feedback';
import { Grid } from '@/components/layout';
import { GlassPanel, PanelTitle } from '@/components/ui';
import { useUnits } from '@/hooks/useUnits';
import { fmtInt, fmtNumber, fmtPercent } from '@/lib/numberFormat';
import type { RegenEfficiencyData } from '@/types/driving';

import type { RegenEfficiencyModel } from '../../lib/regenEfficiency';
import { DetailScopeNotice } from './DetailScopeNotice';
import type { RegenSectionState } from './types';

const KPI_COLUMNS = { default: 2, sm: 3, xl: 6 } as const;

interface RegenKpiBandProps {
  aggregate: RegenEfficiencyData | undefined;
  model: RegenEfficiencyModel;
  aggregateState: RegenSectionState;
  detailState: RegenSectionState;
}

export function RegenKpiBand({
  aggregate,
  model,
  aggregateState,
  detailState,
}: RegenKpiBandProps) {
  const { t } = useTranslation();
  const { formatEnergy } = useUnits();
  const aggregateTotalsUnavailable =
    detailState.isResolved &&
    aggregate != null &&
    aggregate.totalRegenWh === 0 &&
    aggregate.totalDriveWh === 0 &&
    model.totalMeasuredDriveEnergyWh > 0;
  const aggregateUnavailable =
    aggregateState.isLoading ||
    !aggregateState.isResolved ||
    aggregateState.error != null ||
    aggregate == null ||
    aggregateTotalsUnavailable;
  const detailUnavailable =
    detailState.isLoading ||
    !detailState.isResolved ||
    detailState.error != null;
  const aggregateValue = (value: string): string =>
    aggregateState.isLoading
      ? t('regen.states.loadingShort', 'Loading…')
      : aggregateUnavailable
        ? '—'
        : value;
  const detailValue = (value: string): string =>
    detailState.isLoading
      ? t('regen.states.loadingShort', 'Loading…')
      : detailUnavailable
        ? '—'
        : value;
  const aggregateRecoveryShare =
    aggregate != null &&
    Number.isFinite(aggregate.totalDriveWh) &&
    aggregate.totalDriveWh > 0 &&
    Number.isFinite(aggregate.regenRatio)
      ? fmtPercent(aggregate.regenRatio, 1)
      : '—';
  const returnedRowsSubtitle = detailState.isLoading
    ? t('regen.states.detailLoading', 'Detailed query loading.')
    : detailState.error
      ? t('regen.states.detailUnavailable', 'Detailed query unavailable.')
      : !detailState.isResolved
        ? t(
            'regen.states.detailPending',
            'Detailed data availability has not resolved.',
          )
        : model.accounting.historyCapReached
          ? t(
              'regen.kpis.returnedRowsCapped',
              '{{limit}}-row cap reached',
              { limit: fmtInt(model.accounting.historyLimit) },
            )
          : t(
              'regen.kpis.returnedRowsBelowCap',
              'Below the {{limit}}-row request cap',
              { limit: fmtInt(model.accounting.historyLimit) },
            );
  const noResolvedEvidence =
    aggregateState.isResolved &&
    detailState.isResolved &&
    (aggregate == null ||
      (aggregate.totalRegenWh === 0 && aggregate.totalDriveWh === 0)) &&
    model.accounting.observedCount === 0;

  return (
    <section
      aria-label={t('regen.kpis.aria', 'Selected-window recovery summary')}
      data-testid="regen-kpis"
    >
      <GlassPanel className="p-4 sm:p-5">
        <PanelTitle className="mb-4 flex items-center gap-2">
          <Activity className="h-4 w-4 text-cyan-300" aria-hidden="true" />
          {t('regen.kpis.title', 'Selected-window evidence')}
        </PanelTitle>
        <Grid cols={KPI_COLUMNS} gap={3}>
          <MetricCard
            label={t('regen.kpis.aggregateRecovered', 'Aggregate recovered')}
            value={aggregateValue(
              formatEnergy(aggregate?.totalRegenWh, { precision: 1 }),
            )}
            subtitle={t(
              'regen.kpis.aggregateRecoveredHint',
              'Complete date-scoped aggregate',
            )}
            icon={<Leaf className="h-5 w-5" aria-hidden="true" />}
            color="green"
          />
          <MetricCard
            label={t('regen.kpis.aggregateShare', 'Aggregate recovery share')}
            value={aggregateValue(aggregateRecoveryShare)}
            subtitle={t(
              'regen.kpis.aggregateShareHint',
              'Recovered energy ÷ drive-energy denominator',
            )}
            icon={<Gauge className="h-5 w-5" aria-hidden="true" />}
            color="cyan"
          />
          <MetricCard
            label={t('regen.kpis.packCycles', 'Equivalent full-pack cycles')}
            value={aggregateValue(fmtNumber(aggregate?.freeCharges, 1))}
            subtitle={t(
              'regen.kpis.packCyclesHint',
              'Using the reported capacity estimate',
            )}
            icon={<BatteryCharging className="h-5 w-5" aria-hidden="true" />}
            color="purple"
          />
          <MetricCard
            label={t('regen.kpis.aggregateDenominator', 'Aggregate drive energy')}
            value={aggregateValue(
              formatEnergy(aggregate?.totalDriveWh, { precision: 1 }),
            )}
            subtitle={t(
              'regen.kpis.aggregateDenominatorHint',
              'Complete recovery denominator',
            )}
            icon={<Activity className="h-5 w-5" aria-hidden="true" />}
            color="amber"
          />
          <MetricCard
            label={t('regen.kpis.returnedRows', 'Detailed rows returned')}
            value={detailValue(fmtInt(model.accounting.observedCount))}
            subtitle={returnedRowsSubtitle}
            icon={<Rows3 className="h-5 w-5" aria-hidden="true" />}
            color="cyan"
          />
          <MetricCard
            label={t('regen.kpis.eligibleCoverage', 'Eligible detailed coverage')}
            value={detailValue(
              t('regen.kpis.coverageValue', '{{eligible}} / {{observed}}', {
                eligible: fmtInt(model.accounting.eligibleCount),
                observed: fmtInt(model.accounting.observedCount),
              }),
            )}
            subtitle={t(
              'regen.kpis.eligibleCoverageHint',
              'Measured regen and positive drive energy',
            )}
            icon={<Database className="h-5 w-5" aria-hidden="true" />}
            color="green"
          />
        </Grid>

        {aggregateState.error ? (
          <div className="mt-4" data-testid="regen-kpis-aggregate-error">
            <QueryError
              error={aggregateState.error}
              onRetry={aggregateState.onRetry}
            />
          </div>
        ) : null}
        {detailState.error ? (
          <div className="mt-4" data-testid="regen-kpis-detail-error">
            <QueryError error={detailState.error} onRetry={detailState.onRetry} />
          </div>
        ) : null}
        {noResolvedEvidence ? (
          <EmptyState /* no-action: the vehicle and date controls remain available above. */
            className="py-6"
            icon={<Leaf className="h-7 w-7" aria-hidden="true" />}
            message={t(
              'regen.kpis.empty',
              'No aggregate energy or detailed drives were returned for this selected window.',
            )}
          />
        ) : null}
        {detailState.isResolved ? (
          <DetailScopeNotice
            className="mt-4"
            capReached={model.accounting.historyCapReached}
            historyLimit={model.accounting.historyLimit}
          />
        ) : null}
      </GlassPanel>
    </section>
  );
}
