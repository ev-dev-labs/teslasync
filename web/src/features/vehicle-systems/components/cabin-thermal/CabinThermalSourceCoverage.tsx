import { useTranslation } from 'react-i18next';

import { LayoutCard } from '@/components/layout';
import { VehicleOperationalBrief } from '../operationalbrief-all/VehicleOperationalBrief';
import {
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

export function CabinThermalSourceCoverage({
  summary,
  state,
  locale,
  formatDuration,
}: CabinThermalSourceCoverageProps) {
  const { fmtInt } = useNumberFormatting();
  const { t } = useTranslation();
  const coverage = summary.coverage;

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
          <VehicleOperationalBrief embedded id="cabin-thermal-coverage-summary"
            title={t('cabinThermal.coverage.title', 'Source coverage')}
            retained={Boolean(state.refreshError) || Boolean(state.isPaused)}
            period={{ kind: 'unknown', label: t('dataSources.labels.climateHistory', 'Climate history'),
              reason: t('cabinThermal.coverage.subtitle', 'Chronological span and cadence of valid, deduplicated climate samples returned by the seven-day endpoint.') }}
            metrics={[
              { metricId: 'text', occurrenceId: 'earliest', label: t('cabinThermal.coverage.earliest', 'Earliest valid sample'), rawValue: coverage.earliestValidTs ? formatDateTime(coverage.earliestValidTs, { locale }) : null },
              { metricId: 'text', occurrenceId: 'latest', label: t('cabinThermal.coverage.latest', 'Latest valid sample'), rawValue: coverage.latestValidTs ? formatDateTime(coverage.latestValidTs, { locale }) : null },
              ...[
                { key: 'span', label: t('cabinThermal.coverage.span', 'Observed span'), minutes: coverage.timespanMin },
                { key: 'median', label: t('cabinThermal.coverage.medianCadence', 'Median cadence'), minutes: coverage.medianCadenceMin },
                { key: 'p90', label: t('cabinThermal.coverage.p90Cadence', 'P90 cadence'), minutes: coverage.p90CadenceMin },
                { key: 'max', label: t('cabinThermal.coverage.maxGap', 'Largest observed gap'), minutes: coverage.maxObservedGapMin },
              ].map(fact => ({
                metricId: 'duration' as const, occurrenceId: fact.key, label: fact.label,
                rawValue: fact.minutes != null ? fact.minutes * 60 : null,
                display: { formatter: (raw: number) => ({ value: formatDuration(raw), unit: '' }) },
              })),
              { metricId: 'count', occurrenceId: 'intervals', label: t('cabinThermal.coverage.intervals', 'Adjacent intervals'), rawValue: coverage.gapIntervals, display: { formatter: raw => ({ value: fmtInt(raw), unit: '' }) } },
              { metricId: 'count', occurrenceId: 'long-gaps', label: t('cabinThermal.coverage.longGaps', 'Long gaps'), rawValue: coverage.longGapCount, display: { formatter: raw => ({ value: fmtInt(raw), unit: '' }) } },
            ]}
          />
        </CabinThermalSectionBody>
      </LayoutCard>
    </section>
  );
}
