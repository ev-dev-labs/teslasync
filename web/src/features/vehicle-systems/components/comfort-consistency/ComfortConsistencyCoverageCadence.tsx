import { useTranslation } from 'react-i18next';

import { LayoutCard } from '@/components/layout';
import { VehicleOperationalBrief } from '../operationalbrief-all/VehicleOperationalBrief';
import {
  Text,
} from '@/components/ui';
import type { UnitFormatter } from '@/hooks/useUnits';
import { formatDateTime } from '@/lib/dateFormat';

import type { ComfortConsistencySummary } from '../../lib/comfortConsistency';
import { ComfortConsistencySectionBody } from './ComfortConsistencySectionBody';
import type { ComfortConsistencyQueryState } from './types';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';

interface ComfortConsistencyCoverageCadenceProps {
  summary: ComfortConsistencySummary;
  state: ComfortConsistencyQueryState;
  locale: string;
  formatDuration: UnitFormatter;
}

export function ComfortConsistencyCoverageCadence({
  summary,
  state,
  locale,
  formatDuration,
}: ComfortConsistencyCoverageCadenceProps) {
  const { fmtPercent, fmtInt } = useNumberFormatting();
  const { t } = useTranslation();
  const coverage = summary.coverage;
  const date = (ms: number | null) =>
    formatDateTime(ms != null ? new Date(ms) : null, { locale });

  return (
    <section data-testid="comfort-consistency-coverage-cadence">
      <LayoutCard title={t('comfortConsistency.coverage.title', 'Chronological coverage and cadence')}>
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
          <VehicleOperationalBrief embedded id="comfort-consistency-coverage-summary"
            title={t('comfortConsistency.coverage.title', 'Chronological coverage and cadence')}
            retained={Boolean(state.refreshError) || Boolean(state.isPaused)}
            period={{ kind: 'unknown', label: t('dataSources.labels.climateHistory', 'Climate history'),
              reason: t('comfortConsistency.coverage.subtitle', 'Every unique valid timestamp defines source span and cadence, including rows later excluded from comfort scoring.') }}
            metrics={[
              { metricId: 'text', occurrenceId: 'earliest', label: t('comfortConsistency.coverage.earliest', 'Earliest valid timestamp'), rawValue: coverage.earliestValidMs != null ? date(coverage.earliestValidMs) : null },
              { metricId: 'text', occurrenceId: 'latest', label: t('comfortConsistency.coverage.latest', 'Latest valid timestamp'), rawValue: coverage.latestValidMs != null ? date(coverage.latestValidMs) : null },
              ...[
                { key: 'span', label: t('comfortConsistency.coverage.span', 'Timeline span'), value: coverage.spanS },
                { key: 'median', label: t('comfortConsistency.coverage.medianGap', 'Median cadence'), value: coverage.medianGapS },
                { key: 'p90', label: t('comfortConsistency.coverage.p90Gap', 'P90 cadence'), value: coverage.p90GapS },
                { key: 'max', label: t('comfortConsistency.coverage.maxGap', 'Maximum observed gap'), value: coverage.maxObservedGapS },
              ].map(fact => ({
                metricId: 'duration' as const, occurrenceId: fact.key, label: fact.label, rawValue: fact.value,
                display: { formatter: (raw: number) => ({ value: formatDuration(raw), unit: '' }) },
              })),
              { metricId: 'percent', occurrenceId: 'state-coverage', label: t('comfortConsistency.coverage.stateCoverage', 'Known-HVAC coverage'), rawValue: coverage.stateCoverage != null ? coverage.stateCoverage * 100 : null, display: { formatter: raw => ({ value: fmtPercent(raw), unit: '' }) } },
              { metricId: 'count', occurrenceId: 'gap-pair', label: t('comfortConsistency.coverage.gaps', 'Cadence / long gaps'), rawValue: coverage.cadenceIntervals,
                display: { formatter: raw => ({ value: t('comfortConsistency.coverage.gapPair', '{{cadence}} / {{long}}', { cadence: fmtInt(raw), long: fmtInt(coverage.longGapCount) }), unit: '' }) } },
            ]}
          />
        </ComfortConsistencySectionBody>
      </LayoutCard>
    </section>
  );
}
