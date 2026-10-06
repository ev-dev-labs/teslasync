import { useTranslation } from 'react-i18next';

import { LayoutCard, Grid } from '@/components/layout';
import {
  MetricLabel,
  Text,
} from '@/components/ui';
import type { UnitFormatter } from '@/hooks/useUnits';
import { formatDateTime } from '@/lib/dateFormat';

import type { CabinThermalSummary } from '../../lib/cabinThermal';
import { CabinThermalSectionBody } from './CabinThermalSectionBody';
import type { CabinThermalQueryState } from './types';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';

interface CabinThermalSourceCoverageProps {
  summary: CabinThermalSummary;
  state: CabinThermalQueryState;
  locale: string;
  formatDuration: UnitFormatter;
}

function CoverageMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-2)] p-3">
      <MetricLabel>{label}</MetricLabel>
      <Text
        as="div"
        size="base"
        weight="semibold"
        color="primary"
        className="mt-1"
      >
        {value}
      </Text>
    </div>
  );
}

export function CabinThermalSourceCoverage({
  summary,
  state,
  locale,
  formatDuration,
}: CabinThermalSourceCoverageProps) {
  const { fmtInt } = useNumberFormatting();
  const { t } = useTranslation();
  const coverage = summary.coverage;
  const duration = (minutes: number | null) =>
    minutes != null ? formatDuration(minutes * 60) : '—';

  return (
    <section data-testid="cabin-thermal-source-coverage">
      <LayoutCard title={t('cabinThermal.coverage.title', 'Source coverage')}>
        <Text as="p" variant="caption" className="mb-4">
          {t(
            'cabinThermal.coverage.subtitle',
            'Chronological span and cadence of valid, deduplicated climate samples returned by the seven-day endpoint.',
          )}
        </Text>
        <CabinThermalSectionBody summary={summary} state={state} requirement="rows">
          <Grid cols={{ default: 2, xl: 4 }} gap={3}>
            <CoverageMetric
              label={t('cabinThermal.coverage.earliest', 'Earliest valid sample')}
              value={formatDateTime(coverage.earliestValidTs, { locale })}
            />
            <CoverageMetric
              label={t('cabinThermal.coverage.latest', 'Latest valid sample')}
              value={formatDateTime(coverage.latestValidTs, { locale })}
            />
            <CoverageMetric
              label={t('cabinThermal.coverage.span', 'Observed span')}
              value={duration(coverage.timespanMin)}
            />
            <CoverageMetric
              label={t('cabinThermal.coverage.intervals', 'Adjacent intervals')}
              value={fmtInt(coverage.gapIntervals)}
            />
            <CoverageMetric
              label={t('cabinThermal.coverage.medianCadence', 'Median cadence')}
              value={duration(coverage.medianCadenceMin)}
            />
            <CoverageMetric
              label={t('cabinThermal.coverage.p90Cadence', 'P90 cadence')}
              value={duration(coverage.p90CadenceMin)}
            />
            <CoverageMetric
              label={t('cabinThermal.coverage.maxGap', 'Largest observed gap')}
              value={duration(coverage.maxObservedGapMin)}
            />
            <CoverageMetric
              label={t('cabinThermal.coverage.longGaps', 'Long gaps')}
              value={fmtInt(coverage.longGapCount)}
            />
          </Grid>
        </CabinThermalSectionBody>
      </LayoutCard>
    </section>
  );
}
