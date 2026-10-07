import {
  Activity,
  CircleSlash2,
  Combine,
  GitBranch,
  Layers3,
  Rows3,
  Scissors,
  TimerOff,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { MetricCard } from '@/components/data-display';
import { AlertBanner } from '@/components/feedback';
import { GlassPanel, PanelTitle, Text } from '@/components/ui';
import type { CycleStressResult } from '../../lib/cycleStress';
import { cycleStressNumber } from './labels';
import { CycleStressSectionBody } from './CycleStressSectionBody';
import type { CycleStressQueryState } from './types';

interface CycleStressContinuityProps {
  result: CycleStressResult;
  state: CycleStressQueryState;
  locale: string;
}

export function CycleStressContinuity({
  result,
  state,
  locale,
}: CycleStressContinuityProps) {
  const { t } = useTranslation();
  const continuity = result.continuity;

  return (
    <section data-testid="cycle-stress-continuity">
      <GlassPanel className="p-4 sm:p-5">
        <PanelTitle className="mb-1 flex items-center gap-2">
          <GitBranch
            className="h-4 w-4 text-cyan-300"
            aria-hidden="true"
          />
          {t(
            'cycleStress.continuity.title',
            'Continuity and segmentation diagnostics',
          )}
        </PanelTitle>
        <Text as="p" variant="caption" className="mb-4">
          {t(
            'cycleStress.continuity.subtitle',
            'Cycles are extracted inside segments only; no range can cross a rejected overlap, long gap, or unexplained boundary jump.',
          )}
        </Text>
        <CycleStressSectionBody
          result={result}
          state={state}
          requirement="none"
        >
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-5">
            <MetricCard
              label={t(
                'cycleStress.continuity.intervals',
                'Accepted intervals',
              )}
              value={cycleStressNumber(
                continuity.acceptedIntervals,
                locale,
                0,
              )}
              subtitle={t(
                'cycleStress.continuity.afterAccounting',
                'after row and overlap accounting',
              )}
              icon={<Layers3 className="h-5 w-5" />}
              color="cyan"
            />
            <MetricCard
              label={t(
                'cycleStress.continuity.rawBoundaries',
                'Raw endpoint boundaries',
              )}
              value={cycleStressNumber(
                continuity.rawBoundaryPoints,
                locale,
                0,
              )}
              subtitle={t(
                'cycleStress.continuity.twoPerInterval',
                'two per accepted interval',
              )}
              icon={<Rows3 className="h-5 w-5" />}
              color="blue"
            />
            <MetricCard
              label={t(
                'cycleStress.continuity.retained',
                'Retained observations',
              )}
              value={cycleStressNumber(
                continuity.retainedObservations,
                locale,
                0,
              )}
              subtitle={t(
                'cycleStress.continuity.afterCoincident',
                'after coincident/tiny-point handling',
              )}
              icon={<Combine className="h-5 w-5" />}
              color="green"
            />
            <MetricCard
              label={t(
                'cycleStress.continuity.turningPoints',
                'Turning points',
              )}
              value={cycleStressNumber(
                continuity.turningPoints,
                locale,
                0,
              )}
              subtitle={t(
                'cycleStress.continuity.extrema',
                'segment endpoints plus local extrema',
              )}
              icon={<Activity className="h-5 w-5" />}
              color="purple"
            />
            <MetricCard
              label={t(
                'cycleStress.continuity.segments',
                'Continuity segments',
              )}
              value={cycleStressNumber(
                continuity.segmentCount,
                locale,
                0,
              )}
              subtitle={t(
                'cycleStress.continuity.noCrossing',
                'rainflow never crosses segments',
              )}
              icon={<GitBranch className="h-5 w-5" />}
              color="amber"
            />
            <MetricCard
              label={t(
                'cycleStress.continuity.timeGaps',
                'Long-gap breaks',
              )}
              value={cycleStressNumber(
                continuity.timeGapBoundaries,
                locale,
                0,
              )}
              subtitle={t(
                'cycleStress.continuity.gapThreshold',
                'over {{days}} days between intervals',
                {
                  days: cycleStressNumber(
                    result.config.maxContinuityGapS / 86_400,
                    locale,
                    1,
                  ),
                },
              )}
              icon={<TimerOff className="h-5 w-5" />}
              color="red"
            />
            <MetricCard
              label={t(
                'cycleStress.continuity.socJumps',
                'SoC-jump breaks',
              )}
              value={cycleStressNumber(
                continuity.socJumpBoundaries,
                locale,
                0,
              )}
              subtitle={t(
                'cycleStress.continuity.jumpThreshold',
                'over {{value}} percentage points',
                {
                  value: cycleStressNumber(
                    result.config.maxBoundaryJumpPct,
                    locale,
                    1,
                  ),
                },
              )}
              icon={<Scissors className="h-5 w-5" />}
              color="red"
            />
            <MetricCard
              label={t(
                'cycleStress.continuity.overlaps',
                'Rejected overlaps',
              )}
              value={cycleStressNumber(
                continuity.overlappingIntervals,
                locale,
                0,
              )}
              subtitle={t(
                'cycleStress.continuity.conflictingIntervals',
                'conflicting interval chronology',
              )}
              icon={<CircleSlash2 className="h-5 w-5" />}
              color="amber"
            />
            <MetricCard
              label={t(
                'cycleStress.continuity.compacted',
                'Monotone points compacted',
              )}
              value={cycleStressNumber(
                continuity.compactedPoints,
                locale,
                0,
              )}
              subtitle={t(
                'cycleStress.continuity.notExtrema',
                'not local extrema',
              )}
              icon={<Scissors className="h-5 w-5" />}
              color="blue"
            />
            <MetricCard
              label={t(
                'cycleStress.continuity.coincident',
                'Coincident collapses',
              )}
              value={cycleStressNumber(
                continuity.coincidentBoundaryCollapses,
                locale,
                0,
              )}
              subtitle={t(
                'cycleStress.continuity.laterObservation',
                'later observation retained at same instant',
              )}
              icon={<Combine className="h-5 w-5" />}
              color="cyan"
            />
          </div>
          <AlertBanner className="mt-4" variant="info">
            <Text as="p" variant="caption">
              {t(
                'cycleStress.continuity.notice',
                'The gap and boundary-jump thresholds are conservative reconstruction rules, not Tesla specifications. Breaking a sequence prevents unsupported history from creating a cycle, but it can increase half-cycle residue at segment edges.',
              )}
            </Text>
          </AlertBanner>
        </CycleStressSectionBody>
      </GlassPanel>
    </section>
  );
}
