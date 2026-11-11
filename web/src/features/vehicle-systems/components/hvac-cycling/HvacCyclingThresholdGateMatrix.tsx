import { useTranslation } from 'react-i18next';

import { LayoutCard } from '@/components/layout';
import { MetricLabel, Text } from '@/components/ui';
import type { UnitFormatter } from '@/hooks/useUnits';

import type { HvacCyclingSummary } from '../../lib/hvacCycling';
import { HvacCyclingSectionBody } from './HvacCyclingSectionBody';
import type { HvacCyclingQueryState } from './types';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';

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
    <div data-app-part="metric" data-app-metric="tile" data-surface-variant="standalone" className="rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-2)] p-3">
      <MetricLabel data-app-part="metric-label">{label}</MetricLabel>
      <div data-app-part="metric-reading" className="mt-1">
        <Text data-app-part="metric-value" as="p" variant="bodySm">{value}</Text>
      </div>
      <Text data-app-part="metric-context" as="p" variant="caption" className="mt-1">
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
  const { fmtInt } = useNumberFormatting();
  const { t } = useTranslation();
  const threshold = summary.thresholds;

  return (
    <section data-testid="hvac-cycling-thresholds">
      <LayoutCard title={t('hvacCycling.thresholds.title', 'Threshold and gate matrix')}>
        <Text as="p" variant="caption" className="mb-4">
          {t(
            'hvacCycling.thresholds.subtitle',
            'Deterministic continuity, classification, duplicate, conflict, and display rules for this result.',
          )}
        </Text>
        <HvacCyclingSectionBody summary={summary} state={state}>
          <div data-app-part="metric-grid" className="grid min-w-0 grid-cols-2 items-stretch gap-3 md:grid-cols-4 [&>*]:min-w-0">
            <Gate
              label={t('hvacCycling.thresholds.maxGap', 'Maximum observed gap')}
              value={t('hvacCycling.thresholds.atMost', '≤ {{value}}', {
                value: formatDuration(threshold.maxGapS),
              })}
              affected={summary.intervals.longGapExclusions}
            />
            <Gate
              label={t('hvacCycling.thresholds.short', 'Short-run threshold')}
              value={t('hvacCycling.thresholds.atMost', '≤ {{value}}', {
                value: formatDuration(
                  threshold.shortCycleThresholdS,
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
          </div>
        </HvacCyclingSectionBody>
      </LayoutCard>
    </section>
  );
}
