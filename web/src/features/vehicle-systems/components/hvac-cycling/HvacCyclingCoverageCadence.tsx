import { useTranslation } from 'react-i18next';

import { LayoutCard, Grid } from '@/components/layout';
import { MetricLabel, Text } from '@/components/ui';
import type { UnitFormatter } from '@/hooks/useUnits';
import { formatDateTime } from '@/lib/dateFormat';

import type { HvacCyclingSummary } from '../../lib/hvacCycling';
import { HvacCyclingSectionBody } from './HvacCyclingSectionBody';
import type { HvacCyclingQueryState } from './types';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';

interface HvacCyclingCoverageCadenceProps {
  summary: HvacCyclingSummary;
  state: HvacCyclingQueryState;
  locale: string;
  formatDuration: UnitFormatter;
}

function CoverageMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-2)] p-3">
      <MetricLabel>{label}</MetricLabel>
      <Text as="p" variant="body" className="mt-1">{value}</Text>
    </div>
  );
}

export function HvacCyclingCoverageCadence({
  summary,
  state,
  locale,
  formatDuration,
}: HvacCyclingCoverageCadenceProps) {
  const { fmtPercent, fmtInt } = useNumberFormatting();
  const { t } = useTranslation();
  const coverage = summary.coverage;
  const date = (ms: number | null) =>
    formatDateTime(ms != null ? new Date(ms) : null, { locale });

  return (
    <section data-testid="hvac-cycling-coverage-cadence">
      <LayoutCard title={t('hvacCycling.coverage.title', 'Chronological coverage and cadence')}>
        <Text as="p" variant="caption" className="mb-4">
          {t(
            'hvacCycling.coverage.subtitle',
            'Valid unique timestamps define span and cadence even when HVAC state is unknown.',
          )}
        </Text>
        <HvacCyclingSectionBody summary={summary} state={state}>
          <Grid cols={{ default: 2, xl: 4 }} gap={3}>
            <CoverageMetric
              label={t('hvacCycling.coverage.earliest', 'Earliest valid timestamp')}
              value={date(coverage.earliestValidMs)}
            />
            <CoverageMetric
              label={t('hvacCycling.coverage.latest', 'Latest valid timestamp')}
              value={date(coverage.latestValidMs)}
            />
            <CoverageMetric
              label={t('hvacCycling.coverage.span', 'Timeline span')}
              value={formatDuration(coverage.spanS)}
            />
            <CoverageMetric
              label={t('hvacCycling.coverage.stateCoverage', 'Known-state coverage')}
              value={coverage.stateCoverage != null
                ? fmtPercent(coverage.stateCoverage * 100)
                : '—'}
            />
            <CoverageMetric
              label={t('hvacCycling.coverage.medianGap', 'Median cadence')}
              value={formatDuration(coverage.medianGapS)}
            />
            <CoverageMetric
              label={t('hvacCycling.coverage.p90Gap', 'P90 cadence')}
              value={formatDuration(coverage.p90GapS)}
            />
            <CoverageMetric
              label={t('hvacCycling.coverage.maxGap', 'Maximum observed gap')}
              value={formatDuration(coverage.maxObservedGapS)}
            />
            <CoverageMetric
              label={t('hvacCycling.coverage.gaps', 'Cadence / long gaps')}
              value={t(
                'hvacCycling.coverage.gapPair',
                '{{cadence}} / {{long}}',
                {
                  cadence: fmtInt(coverage.cadenceIntervals),
                  long: fmtInt(coverage.longGapCount),
                },
              )}
            />
          </Grid>
        </HvacCyclingSectionBody>
      </LayoutCard>
    </section>
  );
}
