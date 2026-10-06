import { useTranslation } from 'react-i18next';

import { StatGroup, type StatMetric } from '@/components/data-display/stat-reference';
import { LayoutCard } from '@/components/layout/layout-reference';
import { Select } from '@/components/ui';
import type { UnitFormatter } from '@/hooks/useUnits';
import {
  CAPACITY_PROCESS_NOISE_OPTIONS,
  CAPACITY_SOC_WINDOW_OPTIONS,
  type PackCapacityResult,
} from '../../lib/packCapacity';
import type { PackCapacityQueryState } from '../pack-capacity';
import {
  packCapacityBandLabel,
  packCapacityFitLabel,
  packCapacityNumber,
  packCapacityPercent,
} from '../pack-capacity/labels';
import { PackCapacityQueryStatus } from '../pack-capacity/PackCapacityQueryStatus';

interface PackCapacitySummaryProps {
  result: PackCapacityResult;
  state: PackCapacityQueryState;
  locale: string;
  formatEnergy: UnitFormatter;
  minSocWindowPct: number;
  processNoiseWhPerSqrtDay: number;
  onMinSocWindowChange: (value: number) => void;
  onProcessNoiseChange: (value: number) => void;
}

/**
 * Shared stats presentation, specialist formatting. The glossary does not
 * define posterior capacity, one-sigma uncertainty or this support index.
 * Explicit text metrics preserve the original locale/precision/± semantics;
 * the canonical raw quantities remain in the unchanged analysis result.
 */
export function PackCapacitySummary({
  result,
  state,
  locale,
  formatEnergy,
  minSocWindowPct,
  processNoiseWhPerSqrtDay,
  onMinSocWindowChange,
  onProcessNoiseChange,
}: PackCapacitySummaryProps) {
  const { t } = useTranslation();
  const resolved = state.isResolved && !state.error;
  const unresolvedSubtitle = !state.vehicleSelected
    ? t('packCapacity.states.selectVehicleKpi', 'Select a vehicle above to load charging evidence.')
    : state.isLoading
      ? t('packCapacity.states.loadingKpi', 'Waiting for returned charging history...')
      : state.error
        ? t('packCapacity.states.errorKpi', 'Charging history is unavailable; use the status below to retry.')
        : !state.isResolved
          ? t('packCapacity.states.pendingKpi', 'Charging-history availability has not resolved.')
          : null;
  const fit = result.summary.fit;
  const annualChange = fit.status === 'available' ? fit.annualChangeWh : null;
  const posterior = t('packCapacity.kpis.posterior', 'latest filtered posterior');
  const oneSigma = t('packCapacity.kpis.oneSigma', 'one sigma under selected assumptions');
  const ratioHint = t('packCapacity.kpis.ratioHint', 'descriptive ratio, not state of health');
  const rawRange = t('packCapacity.kpis.rawRange', 'qualified unfiltered measurements');
  const fitLabel = packCapacityFitLabel(t, fit.status);
  const supportBand = packCapacityBandLabel(t, result.coverage.support.band);
  const noEstimate = t(
    'packCapacity.modernization.noEstimate',
    'No qualified charging-derived estimate is available.',
  );
  const noFit = fit.status !== 'available' ? fitLabel : noEstimate;
  const textMetric = (
    occurrenceId: string,
    label: string,
    value: string | null,
    context: string,
    missingReason = noEstimate,
  ): StatMetric => ({
    metricId: 'text',
    occurrenceId,
    label,
    rawValue: resolved ? value : null,
    description: context,
    context: unresolvedSubtitle ?? context,
    missingReason: unresolvedSubtitle ?? missingReason,
  });
  const metrics: StatMetric[] = [
    textMetric(
      'pack-capacity:current',
      t('packCapacity.kpis.current', 'Current estimate'),
      result.summary.currentWh != null ? formatEnergy(result.summary.currentWh) : null,
      posterior,
    ),
    textMetric(
      'pack-capacity:uncertainty',
      t('packCapacity.kpis.uncertainty', 'Filter uncertainty'),
      result.summary.currentSigmaWh != null ? `±${formatEnergy(result.summary.currentSigmaWh)}` : null,
      oneSigma,
    ),
    textMetric(
      'pack-capacity:ratio',
      t('packCapacity.kpis.ratio', 'Current / filtered maximum'),
      result.summary.currentToMaxRatio != null
        ? packCapacityPercent(result.summary.currentToMaxRatio, locale) : null,
      ratioHint,
    ),
    textMetric(
      'pack-capacity:raw-median',
      t('packCapacity.kpis.rawMedian', 'Raw median'),
      result.summary.rawMedianWh != null ? formatEnergy(result.summary.rawMedianWh) : null,
      rawRange,
    ),
    textMetric(
      'pack-capacity:annual-change',
      t('packCapacity.kpis.annualChange', 'Annualized linear change'),
      annualChange != null ? formatEnergy(annualChange) : null,
      fitLabel,
      noFit,
    ),
    textMetric(
      'pack-capacity:support',
      t('packCapacity.kpis.support', 'Evidence support'),
      `${packCapacityNumber(result.coverage.support.index, locale, 1)}/100`,
      supportBand,
    ),
  ];

  return (
    <section
      data-testid="pack-capacity-kpis"
      className="w-full min-w-0"
      aria-label={t('packCapacity.kpis.aria', 'Pack capacity charging evidence summary')}
    >
      <LayoutCard
        title={t('packCapacity.kpis.title', 'Capacity evidence under filter assumptions')}
        description={t(
          'packCapacity.kpis.subtitle',
          'Implied full-pack energy from completed charging windows; not a battery-health, degradation, or remaining-life measurement.',
        )}
        actions={
          <div className="flex min-w-0 flex-wrap items-end gap-3 [&_select]:min-h-11">
            <Select
              id="pack-capacity-soc-window"
              size="sm"
              className="min-w-40"
              label={t('packCapacity.controls.socWindow', 'Minimum SoC window')}
              options={CAPACITY_SOC_WINDOW_OPTIONS.map(value => ({
                value: String(value),
                label: t('packCapacity.controls.socWindowOption', '{{value}} percentage points', { value }),
              }))}
              value={String(minSocWindowPct)}
              onChange={event => onMinSocWindowChange(Number(event.target.value))}
            />
            <Select
              id="pack-capacity-process-noise"
              size="sm"
              className="min-w-44"
              label={t('packCapacity.controls.processNoise', 'Process uncertainty')}
              options={CAPACITY_PROCESS_NOISE_OPTIONS.map(value => ({
                value: String(value),
                label: t('packCapacity.controls.processNoiseOption', '{{value}} Wh / square-root day', { value }),
              }))}
              value={String(processNoiseWhPerSqrtDay)}
              onChange={event => onProcessNoiseChange(Number(event.target.value))}
            />
          </div>
        }
      >
        <StatGroup
          id="pack-capacity-summary"
          metrics={metrics}
          loading={state.isLoading}
          period={{
            kind: 'alltime',
            label: t('packCapacity.modernization.period', 'Returned charging-history window'),
            provenance: t(
              'packCapacity.modernization.provenance',
              'Up to {{limit}} returned sessions; not a lifetime record or a battery-health measurement.',
              { limit: result.accounting.historyLimit },
            ),
          }}
        />
        <PackCapacityQueryStatus result={result} state={state} />
      </LayoutCard>
    </section>
  );
}
