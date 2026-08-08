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
import { fmtInt } from '@/lib/numberFormat';
import type { CabinThermalSummary } from '../../lib/cabinThermal';
import { CabinThermalSectionBody } from './CabinThermalSectionBody';
import type { CabinThermalQueryState } from './types';

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
  const { t } = useTranslation();
  const coverage = summary.coverage;
  const duration = (minutes: number | null) =>
    minutes != null ? formatDuration(minutes * 60, { precision: 1 }) : '—';

  return (
    <section data-testid="cabin-thermal-source-coverage">
      <GlassPanel className="p-4 sm:p-5">
        <PanelTitle className="mb-1 flex items-center gap-2">
          <CalendarRange className="h-4 w-4 text-[var(--text-muted)]" aria-hidden="true" />
          {t('cabinThermal.coverage.title', 'Source coverage')}
        </PanelTitle>
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
      </GlassPanel>
    </section>
  );
}
