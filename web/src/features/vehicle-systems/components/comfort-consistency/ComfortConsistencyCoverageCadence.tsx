import { CalendarRange } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { Grid } from '@/components/layout';
import {
  GlassPanel,
  MetricLabel,
  PanelTitle,
  Text,
} from '@/components/ui';
import type { UnitFormatter } from '@/hooks/useUnits';
import { formatDateTime } from '@/lib/dateFormat';
import { fmtInt, fmtPercent } from '@/lib/numberFormat';
import type { ComfortConsistencySummary } from '../../lib/comfortConsistency';
import { ComfortConsistencySectionBody } from './ComfortConsistencySectionBody';
import type { ComfortConsistencyQueryState } from './types';

interface ComfortConsistencyCoverageCadenceProps {
  summary: ComfortConsistencySummary;
  state: ComfortConsistencyQueryState;
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

export function ComfortConsistencyCoverageCadence({
  summary,
  state,
  locale,
  formatDuration,
}: ComfortConsistencyCoverageCadenceProps) {
  const { t } = useTranslation();
  const coverage = summary.coverage;
  const date = (ms: number | null) =>
    formatDateTime(ms != null ? new Date(ms) : null, { locale });

  return (
    <section data-testid="comfort-consistency-coverage-cadence">
      <GlassPanel className="p-4 sm:p-5">
        <PanelTitle className="mb-1 flex items-center gap-2">
          <CalendarRange className="h-4 w-4 text-[var(--text-muted)]" aria-hidden="true" />
          {t('comfortConsistency.coverage.title', 'Chronological coverage and cadence')}
        </PanelTitle>
        <Text as="p" variant="caption" className="mb-4">
          {t(
            'comfortConsistency.coverage.subtitle',
            'Every unique valid timestamp defines source span and cadence, including rows later excluded from comfort scoring.',
          )}
        </Text>
        <ComfortConsistencySectionBody
          summary={summary}
          state={state}
          requirement="timestamps"
        >
          <Grid cols={{ default: 2, xl: 4 }} gap={3}>
            <CoverageMetric
              label={t('comfortConsistency.coverage.earliest', 'Earliest valid timestamp')}
              value={date(coverage.earliestValidMs)}
            />
            <CoverageMetric
              label={t('comfortConsistency.coverage.latest', 'Latest valid timestamp')}
              value={date(coverage.latestValidMs)}
            />
            <CoverageMetric
              label={t('comfortConsistency.coverage.span', 'Timeline span')}
              value={formatDuration(coverage.spanS, { precision: 1 })}
            />
            <CoverageMetric
              label={t('comfortConsistency.coverage.stateCoverage', 'Known-HVAC coverage')}
              value={coverage.stateCoverage != null
                ? fmtPercent(coverage.stateCoverage * 100, 1)
                : '—'}
            />
            <CoverageMetric
              label={t('comfortConsistency.coverage.medianGap', 'Median cadence')}
              value={formatDuration(coverage.medianGapS, { precision: 2 })}
            />
            <CoverageMetric
              label={t('comfortConsistency.coverage.p90Gap', 'P90 cadence')}
              value={formatDuration(coverage.p90GapS, { precision: 2 })}
            />
            <CoverageMetric
              label={t('comfortConsistency.coverage.maxGap', 'Maximum observed gap')}
              value={formatDuration(coverage.maxObservedGapS, { precision: 2 })}
            />
            <CoverageMetric
              label={t('comfortConsistency.coverage.gaps', 'Cadence / long gaps')}
              value={t(
                'comfortConsistency.coverage.gapPair',
                '{{cadence}} / {{long}}',
                {
                  cadence: fmtInt(coverage.cadenceIntervals),
                  long: fmtInt(coverage.longGapCount),
                },
              )}
            />
          </Grid>
        </ComfortConsistencySectionBody>
      </GlassPanel>
    </section>
  );
}
