import {
  Activity,
  Binary,
  Clock3,
  Database,
  Gauge,
  RotateCw,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { MetricCard } from '@/components/data-display';
import { Grid } from '@/components/layout';
import { GlassPanel, PanelTitle } from '@/components/ui';
import type { UnitFormatter } from '@/hooks/useUnits';
import { fmtInt, fmtPercent } from '@/lib/numberFormat';
import type { HvacCyclingSummary } from '../../lib/hvacCycling';
import { HvacCyclingQueryStatus } from './HvacCyclingQueryStatus';
import type { HvacCyclingQueryState } from './types';

interface HvacCyclingEvidenceKpiLedgerProps {
  summary: HvacCyclingSummary;
  state: HvacCyclingQueryState;
  formatDuration: UnitFormatter;
}

export function HvacCyclingEvidenceKpiLedger({
  summary,
  state,
  formatDuration,
}: HvacCyclingEvidenceKpiLedgerProps) {
  const { t } = useTranslation();
  const resolved = state.isResolved && !state.error;
  const unavailable = !state.vehicleSelected
    ? t('hvacCycling.kpis.selectVehicle', 'Select a vehicle to load evidence.')
    : state.isLoading
      ? t('hvacCycling.kpis.loading', 'Waiting for climate history…')
      : state.error
        ? t('hvacCycling.kpis.error', 'Climate history is unavailable.')
        : t('hvacCycling.kpis.pending', 'Evidence availability is unresolved.');

  return (
    <section
      data-testid="hvac-cycling-kpis"
      aria-label={t(
        'hvacCycling.kpis.aria',
        'HVAC cycling evidence ledger',
      )}
    >
      <GlassPanel className="p-4 sm:p-5">
        <PanelTitle className="mb-4 flex items-center gap-2">
          <Binary className="h-4 w-4 text-[var(--text-muted)]" aria-hidden="true" />
          {t('hvacCycling.kpis.title', 'Evidence KPI ledger')}
        </PanelTitle>
        <Grid cols={{ default: 1, sm: 2, xl: 6 }} gap={3}>
          <MetricCard
            label={t('hvacCycling.kpis.returned', 'Returned rows')}
            value={resolved ? fmtInt(summary.rows.returnedRows) : '—'}
            subtitle={resolved
              ? t('hvacCycling.kpis.returnedHint', 'raw endpoint rows')
              : unavailable}
            icon={<Database className="h-5 w-5" />}
            color="blue"
          />
          <MetricCard
            label={t('hvacCycling.kpis.known', 'Known-state samples')}
            value={resolved ? fmtInt(summary.rows.validKnownStateRows) : '—'}
            subtitle={resolved
              ? t('hvacCycling.kpis.knownHint', '{{count}} unique timestamps', {
                  count: summary.rows.uniqueTimestampRows,
                })
              : unavailable}
            icon={<Activity className="h-5 w-5" />}
            color="cyan"
          />
          <MetricCard
            label={t('hvacCycling.kpis.intervals', 'Observed intervals')}
            value={resolved ? fmtInt(summary.intervals.observedIntervals) : '—'}
            subtitle={resolved
              ? t('hvacCycling.kpis.intervalsHint', '{{count}} candidate pairs', {
                  count: summary.intervals.candidateAdjacentPairs,
                })
              : unavailable}
            icon={<Binary className="h-5 w-5" />}
            color="purple"
          />
          <MetricCard
            label={t('hvacCycling.kpis.observed', 'Observed duration')}
            value={resolved
              ? formatDuration(summary.observedS, { precision: 1 })
              : '—'}
            subtitle={resolved
              ? t('hvacCycling.kpis.observedHint', 'gap-qualified on + off time')
              : unavailable}
            icon={<Clock3 className="h-5 w-5" />}
            color="blue"
          />
          <MetricCard
            label={t('hvacCycling.kpis.duty', 'Observed on duty')}
            value={resolved && summary.dutyCycle != null
              ? fmtPercent(summary.dutyCycle * 100, 1)
              : '—'}
            subtitle={resolved
              ? t('hvacCycling.kpis.dutyHint', 'duration-weighted denominator')
              : unavailable}
            icon={<Gauge className="h-5 w-5" />}
            color="cyan"
          />
          <MetricCard
            label={t('hvacCycling.kpis.shortRate', 'Qualified short-cycle rate')}
            value={resolved && summary.qualifiedShortCycleRate != null
              ? fmtPercent(summary.qualifiedShortCycleRate * 100, 1)
              : '—'}
            subtitle={resolved
              ? t('hvacCycling.kpis.shortRateHint', '{{count}} complete active runs', {
                  count: summary.completeOnRunCount,
                })
              : unavailable}
            icon={<RotateCw className="h-5 w-5" />}
            color="amber"
          />
        </Grid>
        <HvacCyclingQueryStatus summary={summary} state={state} />
      </GlassPanel>
    </section>
  );
}
