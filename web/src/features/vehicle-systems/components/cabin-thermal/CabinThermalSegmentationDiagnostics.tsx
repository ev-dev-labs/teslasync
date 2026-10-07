import { useTranslation } from 'react-i18next';

import { LayoutCard } from '@/components/layout';
import { VehicleOperationalBrief } from '../operationalbrief-all/VehicleOperationalBrief';
import {
  Text,
} from '@/components/ui';

import type { CabinThermalSummary } from '../../lib/cabinThermal';
import { CabinThermalSectionBody } from './CabinThermalSectionBody';
import type { CabinThermalQueryState } from './types';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';

interface CabinThermalSegmentationDiagnosticsProps {
  summary: CabinThermalSummary;
  state: CabinThermalQueryState;
}

export function CabinThermalSegmentationDiagnostics({
  summary,
  state,
}: CabinThermalSegmentationDiagnosticsProps) {
  const { t } = useTranslation();
  const { fmtInt } = useNumberFormatting();
  const coverage = summary.coverage;

  return (
    <section data-testid="cabin-thermal-segmentation">
      <LayoutCard title={t('cabinThermal.segmentation.title', 'Segmentation diagnostics')}>
        <Text as="p" variant="caption" className="mb-4">
          {t(
            'cabinThermal.segmentation.subtitle',
            'HVAC-active and HVAC-unknown evidence stay normalized but cannot enter a soak candidate; long gaps split continuity.',
          )}
        </Text>
        <CabinThermalSectionBody summary={summary} state={state} requirement="rows">
          <VehicleOperationalBrief embedded id="cabin-thermal-segmentation-summary"
            title={t('cabinThermal.segmentation.title', 'Segmentation diagnostics')}
            retained={Boolean(state.refreshError) || Boolean(state.isPaused)}
            period={{ kind: 'unknown', label: t('dataSources.labels.climateHistory', 'Climate history'),
              reason: t('cabinThermal.segmentation.subtitle', 'HVAC-active and HVAC-unknown evidence stay normalized but cannot enter a soak candidate; long gaps split continuity.') }}
            metrics={[
              { key: 'on', label: t('cabinThermal.segmentation.hvacOnSamples', 'HVAC-on samples'), value: coverage.hvacOnSamples },
              { key: 'off', label: t('cabinThermal.segmentation.hvacOffSamples', 'HVAC-off samples'), value: coverage.hvacOffSamples },
              { key: 'unknown', label: t('cabinThermal.segmentation.hvacUnknownSamples', 'HVAC-unknown samples'), value: coverage.hvacUnknownSamples },
              { key: 'runs', label: t('cabinThermal.segmentation.hvacRuns', 'HVAC-on runs'), value: coverage.hvacOnRuns },
              { key: 'unknown-runs', label: t('cabinThermal.segmentation.hvacUnknownRuns', 'HVAC-unknown runs'), value: coverage.hvacUnknownRuns },
              { key: 'boundaries', label: t('cabinThermal.segmentation.boundaries', 'Observed HVAC boundaries'), value: coverage.hvacBoundaryCount },
              { key: 'gaps', label: t('cabinThermal.segmentation.longGaps', 'Long-gap breaks'), value: coverage.longGapCount },
              { key: 'segments', label: t('cabinThermal.segmentation.timeSegments', 'Time-continuity segments'), value: coverage.longGapSegments },
              { key: 'rows', label: t('cabinThermal.segmentation.candidateRows', 'Rows entering candidates'), value: summary.accounting.candidateSampleRows },
              { key: 'candidates', label: t('cabinThermal.segmentation.candidates', 'Candidate windows'), value: summary.accounting.candidateWindows },
            ].map(fact => ({
              metricId: 'count' as const, occurrenceId: fact.key, label: fact.label, rawValue: fact.value,
              display: { formatter: raw => ({ value: fmtInt(raw), unit: '' }) },
            }))}
          />
        </CabinThermalSectionBody>
      </LayoutCard>
    </section>
  );
}
