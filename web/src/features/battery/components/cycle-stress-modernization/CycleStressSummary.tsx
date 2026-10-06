import { Activity } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { StatStrip, type StatMetric, type StatPeriod } from '@/components/data-display/stat-reference';
import { GlassPanel, PanelTitle, Select, Text } from '@/components/ui';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';
import {
  CYCLE_DEPTH_THRESHOLDS, CYCLE_STRESS_EXPONENTS, type CycleStressResult,
} from '../../lib/cycleStress';
import {
  cycleStressBandLabel, cycleStressNumber, cycleStressPercent, cycleStressShare,
} from '../cycle-stress/labels';
import { CycleStressSourceStatus } from './CycleStressSourceStatus';
import type { CycleStressTrust } from './queryState';

interface Props {
  result: CycleStressResult;
  trust: CycleStressTrust;
  locale: string;
  deepThresholdPct: number;
  exponent: number;
  onDeepThresholdChange: (value: number) => void;
  onExponentChange: (value: number) => void;
}

export function CycleStressSummary({
  result, trust, locale, deepThresholdPct, exponent,
  onDeepThresholdChange, onExponentChange,
}: Props) {
  useNumberFormatting();
  const { t } = useTranslation();
  const { state } = trust;
  const resolved = state.isResolved && !state.error;
  const unresolvedSubtitle = !state.vehicleSelected
    ? t('cycleStress.states.selectVehicleKpi', 'Select a vehicle above to load cycle evidence.')
    : state.isLoading
      ? t('cycleStress.states.loadingKpi', 'Waiting for returned source histories...')
      : state.error
        ? t('cycleStress.states.errorKpi', 'Source histories are unavailable; use the status below to retry.')
        : !state.isResolved
          ? t('cycleStress.states.pendingKpi', 'Source availability has not resolved.')
          : null;
  const period: StatPeriod = {
    kind: 'unknown',
    label: t('cycleStress.modernization.period', 'Returned vehicle histories · bounded evidence'),
    reason: t('cycleStress.modernization.provenance',
      'Reconstructed from up to 1,000 drives and 1,000 charging sessions. Source spans may differ; this is not a selected-date-window or full-history total.'),
  };
  // Specialist formatted text intentionally retains the existing Intl locale,
  // global precision, literal percent and /100 contracts. No generic score or
  // count formatter is allowed to silently round or recast these source values.
  const metric = (occurrenceId: string, label: string, value: string, context: string): StatMetric => ({
    metricId: 'text', occurrenceId, label, description: context, context,
    rawValue: resolved && value !== '—' ? value : null,
    missingReason: unresolvedSubtitle ?? undefined,
  });
  const metrics: StatMetric[] = [
    metric('cycle-stress:intervals',
      t('cycleStress.kpis.intervals', 'Accepted intervals'),
      cycleStressNumber(result.continuity.acceptedIntervals, locale),
      unresolvedSubtitle ?? t('cycleStress.kpis.returned', '{{count}} total rows returned', {
        count: result.driveAccounting.returnedRows + result.chargingAccounting.returnedRows,
      })),
    metric('cycle-stress:efc',
      t('cycleStress.kpis.efc', 'Equivalent full cycles'),
      cycleStressNumber(result.summary.equivalentFullCycles, locale),
      unresolvedSubtitle ?? t('cycleStress.kpis.efcHint', 'sum of count x depth fraction')),
    metric('cycle-stress:depth-index',
      t('cycleStress.kpis.depthIndex', 'Depth-weighted index'),
      cycleStressNumber(result.summary.depthWeightedIndex, locale),
      unresolvedSubtitle ?? t('cycleStress.kpis.indexHint', 'illustrative exponent {{value}}', {
        value: result.config.exponent,
      })),
    metric('cycle-stress:median-depth',
      t('cycleStress.kpis.medianDepth', 'Median depth'),
      cycleStressPercent(result.summary.medianDepthPct, locale),
      unresolvedSubtitle ?? t('cycleStress.kpis.weightedMedian', 'cycle-count-weighted nearest rank')),
    metric('cycle-stress:deep-share',
      t('cycleStress.kpis.deepShare', '{{value}}%+ cycle share', { value: deepThresholdPct }),
      cycleStressShare(result.summary.deepCycleShare, locale),
      unresolvedSubtitle ?? t('cycleStress.kpis.descriptiveThreshold', 'descriptive threshold sensitivity')),
    metric('cycle-stress:support',
      t('cycleStress.kpis.support', 'Evidence support'),
      `${cycleStressNumber(result.coverage.support.index, locale)}/100`,
      unresolvedSubtitle ?? cycleStressBandLabel(t, result.coverage.support.band)),
  ];

  return (
    <section data-testid="cycle-stress-kpis"
      aria-label={t('cycleStress.kpis.aria', 'Reconstructed Cycle Stress evidence summary')}>
      <GlassPanel className="min-w-0 p-4 sm:p-5">
        <div className="mb-3 flex min-w-0 flex-col gap-3 @[640px]:flex-row @[640px]:items-end @[640px]:justify-between">
          <div className="min-w-0">
            <PanelTitle className="flex items-center gap-2">
              <Activity className="h-4 w-4 shrink-0 text-[var(--text-secondary)]" aria-hidden="true" />
              {t('cycleStress.kpis.title', 'Reconstructed cycle evidence')}
            </PanelTitle>
            <Text as="p" variant="caption" className="mt-1">
              {t('cycleStress.kpis.subtitle',
                'Descriptive rainflow ranges from continuity-bounded SoC endpoints; not a battery-health or remaining-life estimate.')}
            </Text>
          </div>
          <div className="grid min-w-0 grid-cols-1 gap-2 @[430px]:grid-cols-2 @[640px]:shrink-0">
            <Select id="cycle-stress-threshold" size="sm" className="min-w-0"
              label={t('cycleStress.controls.deepThreshold', 'Deep-cycle lens')}
              options={CYCLE_DEPTH_THRESHOLDS.map(value => ({
                value: String(value),
                label: t('cycleStress.controls.thresholdOption', '{{value}}% or deeper', { value }),
              }))}
              value={String(deepThresholdPct)}
              onChange={event => onDeepThresholdChange(Number(event.target.value))} />
            <Select id="cycle-stress-exponent" size="sm" className="min-w-0"
              label={t('cycleStress.controls.exponent', 'Depth exponent')}
              options={CYCLE_STRESS_EXPONENTS.map(value => ({
                value: String(value),
                label: t('cycleStress.controls.exponentOption', 'Exponent {{value}}', { value }),
              }))}
              value={String(exponent)}
              onChange={event => onExponentChange(Number(event.target.value))} />
          </div>
        </div>
        <StatStrip id="cycle-stress-summary" metrics={metrics} period={period}
          variant="embedded" loading={state.isLoading}
          retained={trust.sources.some(source => source.trust.hasData
            && Boolean(source.trust.refreshError || source.trust.isRefreshBlocked))} />
        <CycleStressSourceStatus result={result} trust={trust} />
      </GlassPanel>
    </section>
  );
}
