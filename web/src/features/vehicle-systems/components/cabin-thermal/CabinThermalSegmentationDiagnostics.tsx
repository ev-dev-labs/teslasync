import { Split } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { Grid } from '@/components/layout';
import {
  GlassPanel,
  MetricLabel,
  MetricValue,
  PanelTitle,
  Text,
} from '@/components/ui';
import { fmtInt } from '@/lib/numberFormat';
import type { CabinThermalSummary } from '../../lib/cabinThermal';
import { CabinThermalSectionBody } from './CabinThermalSectionBody';
import type { CabinThermalQueryState } from './types';

interface CabinThermalSegmentationDiagnosticsProps {
  summary: CabinThermalSummary;
  state: CabinThermalQueryState;
}

function SegmentMetric({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-2)] p-3">
      <MetricLabel>{label}</MetricLabel>
      <MetricValue className="mt-1">{fmtInt(value)}</MetricValue>
    </div>
  );
}

export function CabinThermalSegmentationDiagnostics({
  summary,
  state,
}: CabinThermalSegmentationDiagnosticsProps) {
  const { t } = useTranslation();
  const coverage = summary.coverage;

  return (
    <section data-testid="cabin-thermal-segmentation">
      <GlassPanel className="p-4 sm:p-5">
        <PanelTitle className="mb-1 flex items-center gap-2">
          <Split className="h-4 w-4 text-[var(--text-muted)]" aria-hidden="true" />
          {t('cabinThermal.segmentation.title', 'Segmentation diagnostics')}
        </PanelTitle>
        <Text as="p" variant="caption" className="mb-4">
          {t(
            'cabinThermal.segmentation.subtitle',
            'HVAC-active and HVAC-unknown evidence stay normalized but cannot enter a soak candidate; long gaps split continuity.',
          )}
        </Text>
        <CabinThermalSectionBody summary={summary} state={state} requirement="rows">
          <Grid cols={{ default: 2, xl: 4 }} gap={3}>
            <SegmentMetric
              label={t('cabinThermal.segmentation.hvacOnSamples', 'HVAC-on samples')}
              value={coverage.hvacOnSamples}
            />
            <SegmentMetric
              label={t('cabinThermal.segmentation.hvacOffSamples', 'HVAC-off samples')}
              value={coverage.hvacOffSamples}
            />
            <SegmentMetric
              label={t('cabinThermal.segmentation.hvacUnknownSamples', 'HVAC-unknown samples')}
              value={coverage.hvacUnknownSamples}
            />
            <SegmentMetric
              label={t('cabinThermal.segmentation.hvacRuns', 'HVAC-on runs')}
              value={coverage.hvacOnRuns}
            />
            <SegmentMetric
              label={t('cabinThermal.segmentation.hvacUnknownRuns', 'HVAC-unknown runs')}
              value={coverage.hvacUnknownRuns}
            />
            <SegmentMetric
              label={t('cabinThermal.segmentation.boundaries', 'Observed HVAC boundaries')}
              value={coverage.hvacBoundaryCount}
            />
            <SegmentMetric
              label={t('cabinThermal.segmentation.longGaps', 'Long-gap breaks')}
              value={coverage.longGapCount}
            />
            <SegmentMetric
              label={t('cabinThermal.segmentation.timeSegments', 'Time-continuity segments')}
              value={coverage.longGapSegments}
            />
            <SegmentMetric
              label={t('cabinThermal.segmentation.candidateRows', 'Rows entering candidates')}
              value={summary.accounting.candidateSampleRows}
            />
            <SegmentMetric
              label={t('cabinThermal.segmentation.candidates', 'Candidate windows')}
              value={summary.accounting.candidateWindows}
            />
          </Grid>
        </CabinThermalSectionBody>
      </GlassPanel>
    </section>
  );
}
