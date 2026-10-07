import {
  Activity,
  Clock3,
  Gauge,
  ShieldCheck,
  Thermometer,
  TimerReset,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { MetricCard } from '@/components/data-display';
import { Grid } from '@/components/layout';
import { GlassPanel, PanelTitle } from '@/components/ui';
import type { UnitFormatter } from '@/hooks/useUnits';
import { fmtInt, fmtPercent } from '@/lib/numberFormat';
import type { ComfortConsistencySummary } from '../../lib/comfortConsistency';
import { ComfortConsistencyQueryStatus } from './ComfortConsistencyQueryStatus';
import type {
  ComfortConsistencyQueryState,
  TemperatureDeltaFormatter,
} from './types';

interface ComfortConsistencyEvidenceKpiLedgerProps {
  summary: ComfortConsistencySummary;
  state: ComfortConsistencyQueryState;
  formatDuration: UnitFormatter;
  formatDelta: TemperatureDeltaFormatter;
}

export function ComfortConsistencyEvidenceKpiLedger({
  summary,
  state,
  formatDuration,
  formatDelta,
}: ComfortConsistencyEvidenceKpiLedgerProps) {
  const { t } = useTranslation();
  const resolved = state.isResolved && !state.error;
  const unavailable = !state.vehicleSelected
    ? t('comfortConsistency.kpis.selectVehicle', 'Select a vehicle to load evidence.')
    : state.isLoading
      ? t('comfortConsistency.kpis.loading', 'Waiting for climate history...')
      : state.error
        ? t('comfortConsistency.kpis.error', 'Climate history is unavailable.')
        : t('comfortConsistency.kpis.pending', 'Evidence availability is unresolved.');
  const stabilizationShare =
    summary.stabilizationWindows.length > 0
      ? summary.stabilizedWindows / summary.stabilizationWindows.length
      : null;

  return (
    <section
      data-testid="comfort-consistency-kpis"
      aria-label={t(
        'comfortConsistency.kpis.aria',
        'Comfort consistency evidence ledger',
      )}
    >
      <GlassPanel className="p-4 sm:p-5">
        <PanelTitle className="mb-4 flex items-center gap-2">
          <ShieldCheck className="h-4 w-4 text-[var(--text-muted)]" aria-hidden="true" />
          {t('comfortConsistency.kpis.title', 'Evidence KPI ledger')}
        </PanelTitle>
        <Grid cols={{ default: 1, sm: 2, xl: 6 }} gap={3}>
          <MetricCard
            label={t('comfortConsistency.kpis.score', 'Adjusted consistency score')}
            value={resolved ? summary.consistencyScore ?? '—' : '—'}
            subtitle={resolved
              ? t('comfortConsistency.kpis.scoreHint', '{{confidence}} evidence confidence', {
                  confidence: fmtPercent(summary.confidence * 100, 0),
                })
              : unavailable}
            icon={<ShieldCheck className="h-5 w-5" />}
            color={
              summary.consistencyScore == null
                ? 'cyan'
                : summary.consistencyScore >= 80
                  ? 'green'
                  : summary.consistencyScore >= 60
                    ? 'amber'
                    : 'red'
            }
          />
          <MetricCard
            label={t('comfortConsistency.kpis.samples', 'Analyzed active samples')}
            value={resolved ? fmtInt(summary.analyzedSamples) : '—'}
            subtitle={resolved
              ? t('comfortConsistency.kpis.samplesHint', '{{returned}} returned rows', {
                  returned: fmtInt(summary.rows.returnedRows),
                })
              : unavailable}
            icon={<Activity className="h-5 w-5" />}
            color="blue"
          />
          <MetricCard
            label={t('comfortConsistency.kpis.observed', 'Observed active duration')}
            value={resolved
              ? formatDuration(summary.intervalComposition.observedActiveS, {
                  precision: 1,
                })
              : '—'}
            subtitle={resolved
              ? t('comfortConsistency.kpis.observedHint', '{{count}} qualified intervals', {
                  count: summary.intervals.observedActiveIntervals,
                })
              : unavailable}
            icon={<Clock3 className="h-5 w-5" />}
            color="purple"
          />
          <MetricCard
            label={t('comfortConsistency.kpis.inBand', 'Duration within comfort band')}
            value={
              resolved && summary.intervalComposition.withinBandShare != null
                ? fmtPercent(
                    summary.intervalComposition.withinBandShare * 100,
                    1,
                  )
                : '—'
            }
            subtitle={resolved
              ? t('comfortConsistency.kpis.inBandHint', 'duration-weighted support')
              : unavailable}
            icon={<Gauge className="h-5 w-5" />}
            color="cyan"
          />
          <MetricCard
            label={t('comfortConsistency.kpis.deviation', 'Weighted mean deviation')}
            value={resolved
              ? formatDelta(summary.durationWeightedMeanAbsDeviationC)
              : '—'}
            subtitle={resolved
              ? t('comfortConsistency.kpis.deviationHint', 'absolute cabin-to-target gap')
              : unavailable}
            icon={<Thermometer className="h-5 w-5" />}
            color="purple"
          />
          <MetricCard
            label={t('comfortConsistency.kpis.stabilized', 'Observed stabilization share')}
            value={
              resolved && stabilizationShare != null
                ? fmtPercent(stabilizationShare * 100, 1)
                : '—'
            }
            subtitle={resolved
              ? t('comfortConsistency.kpis.stabilizedHint', '{{count}} outside-band fragments', {
                  count: summary.stabilizationWindows.length,
                })
              : unavailable}
            icon={<TimerReset className="h-5 w-5" />}
            color="blue"
          />
        </Grid>
        <ComfortConsistencyQueryStatus summary={summary} state={state} />
      </GlassPanel>
    </section>
  );
}
