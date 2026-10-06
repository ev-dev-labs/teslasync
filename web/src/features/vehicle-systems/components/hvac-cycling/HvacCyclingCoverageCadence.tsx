import { useTranslation } from 'react-i18next';

import { LayoutCard } from '@/components/layout';
import { Text } from '@/components/ui';
import { VehicleOperationalBrief } from '../operationalbrief-all/VehicleOperationalBrief';
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
          <VehicleOperationalBrief embedded id="hvac-cycling-coverage-summary"
            title={t('hvacCycling.coverage.title', 'Chronological coverage and cadence')}
            retained={Boolean(state.refreshError) || Boolean(state.isPaused)}
            period={{ kind: 'unknown', label: t('dataSources.labels.climateHistory', 'Climate history'),
              reason: t('hvacCycling.coverage.subtitle', 'Valid unique timestamps define span and cadence even when HVAC state is unknown.') }}
            metrics={[
              { metricId: 'text', occurrenceId: 'earliest', label: t('hvacCycling.coverage.earliest', 'Earliest valid timestamp'), rawValue: coverage.earliestValidMs != null ? date(coverage.earliestValidMs) : null },
              { metricId: 'text', occurrenceId: 'latest', label: t('hvacCycling.coverage.latest', 'Latest valid timestamp'), rawValue: coverage.latestValidMs != null ? date(coverage.latestValidMs) : null },
              ...[
                { key: 'span', label: t('hvacCycling.coverage.span', 'Timeline span'), value: coverage.spanS },
                { key: 'median', label: t('hvacCycling.coverage.medianGap', 'Median cadence'), value: coverage.medianGapS },
                { key: 'p90', label: t('hvacCycling.coverage.p90Gap', 'P90 cadence'), value: coverage.p90GapS },
                { key: 'max', label: t('hvacCycling.coverage.maxGap', 'Maximum observed gap'), value: coverage.maxObservedGapS },
              ].map(fact => ({
                metricId: 'duration' as const, occurrenceId: fact.key, label: fact.label, rawValue: fact.value,
                display: { formatter: (raw: number) => ({ value: formatDuration(raw), unit: '' }) },
              })),
              { metricId: 'percent', occurrenceId: 'state-coverage', label: t('hvacCycling.coverage.stateCoverage', 'Known-state coverage'), rawValue: coverage.stateCoverage != null ? coverage.stateCoverage * 100 : null, display: { formatter: raw => ({ value: fmtPercent(raw), unit: '' }) } },
              { metricId: 'count', occurrenceId: 'gap-pair', label: t('hvacCycling.coverage.gaps', 'Cadence / long gaps'), rawValue: coverage.cadenceIntervals,
                display: { formatter: raw => ({ value: t('hvacCycling.coverage.gapPair', '{{cadence}} / {{long}}', { cadence: fmtInt(raw), long: fmtInt(coverage.longGapCount) }), unit: '' }) } },
            ]}
          />
        </HvacCyclingSectionBody>
      </LayoutCard>
    </section>
  );
}
