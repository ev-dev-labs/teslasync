import { SlidersHorizontal } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { Grid } from '@/components/layout';
import {
  GlassPanel,
  MetricLabel,
  PanelTitle,
  Text,
} from '@/components/ui';
import type { UnitFormatter } from '@/hooks/useUnits';
import { fmtInt } from '@/lib/numberFormat';
import type { HvacCyclingSummary } from '../../lib/hvacCycling';
import { HvacCyclingSectionBody } from './HvacCyclingSectionBody';
import type { HvacCyclingQueryState } from './types';

interface HvacCyclingThresholdGateMatrixProps {
  summary: HvacCyclingSummary;
  state: HvacCyclingQueryState;
  formatDuration: UnitFormatter;
}

interface GateProps {
  label: string;
  value: string;
  affected: number;
}

function Gate({ label, value, affected }: GateProps) {
  const { t } = useTranslation();
  return (
    <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-2)] p-3">
      <MetricLabel>{label}</MetricLabel>
      <Text as="p" variant="bodySm" className="mt-1">{value}</Text>
      <Text as="p" variant="caption" className="mt-1">
        {t('hvacCycling.thresholds.affected', '{{count}} affected', {
          count: affected,
        })}
      </Text>
    </div>
  );
}

export function HvacCyclingThresholdGateMatrix({
  summary,
  state,
  formatDuration,
}: HvacCyclingThresholdGateMatrixProps) {
  const { t } = useTranslation();
  const threshold = summary.thresholds;

  return (
    <section data-testid="hvac-cycling-thresholds">
      <GlassPanel className="p-4 sm:p-5">
        <PanelTitle className="mb-1 flex items-center gap-2">
          <SlidersHorizontal className="h-4 w-4 text-[var(--text-muted)]" aria-hidden="true" />
          {t('hvacCycling.thresholds.title', 'Threshold and gate matrix')}
        </PanelTitle>
        <Text as="p" variant="caption" className="mb-4">
          {t(
            'hvacCycling.thresholds.subtitle',
            'Deterministic continuity, classification, duplicate, conflict, and display rules for this result.',
          )}
        </Text>
        <HvacCyclingSectionBody summary={summary} state={state}>
          <Grid cols={{ default: 2, md: 4 }} gap={3}>
            <Gate
              label={t('hvacCycling.thresholds.maxGap', 'Maximum observed gap')}
              value={t('hvacCycling.thresholds.atMost', '≤ {{value}}', {
                value: formatDuration(threshold.maxGapS, { precision: 1 }),
              })}
              affected={summary.intervals.longGapExclusions}
            />
            <Gate
              label={t('hvacCycling.thresholds.short', 'Short-run threshold')}
              value={t('hvacCycling.thresholds.atMost', '≤ {{value}}', {
                value: formatDuration(
                  threshold.shortCycleThresholdS,
                  { precision: 1 },
                ),
              })}
              affected={summary.shortCompleteOnRunCount}
            />
            <Gate
              label={t('hvacCycling.thresholds.unknown', 'Unknown-state continuity')}
              value={t('hvacCycling.thresholds.breaks', 'Breaks continuity')}
              affected={summary.intervals.unknownStateBarriers}
            />
            <Gate
              label={t('hvacCycling.thresholds.nonpositive', 'Nonpositive interval')}
              value={t('hvacCycling.thresholds.excluded', 'Excluded')}
              affected={summary.intervals.nonpositiveIntervals}
            />
            <Gate
              label={t('hvacCycling.thresholds.duplicate', 'Duplicate timestamp policy')}
              value={t('hvacCycling.thresholds.first', 'First returned row retained')}
              affected={summary.rows.duplicateTimestampRows}
            />
            <Gate
              label={t('hvacCycling.thresholds.conflict', 'Conflicting inputs')}
              value={t('hvacCycling.thresholds.activeWins', 'Any active input resolves on')}
              affected={summary.signals.anyConflictRows}
            />
            <Gate
              label={t('hvacCycling.thresholds.complete', 'Short-cycle eligibility')}
              value={t('hvacCycling.thresholds.twoBoundaries', 'Two observed transitions')}
              affected={summary.activeRunCount - summary.completeOnRunCount}
            />
            <Gate
              label={t('hvacCycling.thresholds.directory', 'Run display cap')}
              value={fmtInt(threshold.runDisplayLimit)}
              affected={summary.runDirectory.omitted}
            />
          </Grid>
        </HvacCyclingSectionBody>
      </GlassPanel>
    </section>
  );
}
