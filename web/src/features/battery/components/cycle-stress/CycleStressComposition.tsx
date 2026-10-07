import {
  BatteryCharging,
  CircleDashed,
  CircleDot,
  Gauge,
  GitCompareArrows,
  Sigma,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { MetricCard } from '@/components/data-display';
import { AlertBanner } from '@/components/feedback';
import { GlassPanel, PanelTitle, Text } from '@/components/ui';
import type { CycleStressResult } from '../../lib/cycleStress';
import {
  cycleStressNumber,
  cycleStressShare,
} from './labels';
import { CycleStressSectionBody } from './CycleStressSectionBody';
import type { CycleStressQueryState } from './types';

interface CycleStressCompositionProps {
  result: CycleStressResult;
  state: CycleStressQueryState;
  locale: string;
}

export function CycleStressComposition({
  result,
  state,
  locale,
}: CycleStressCompositionProps) {
  const { t } = useTranslation();
  const composition = result.summary.composition;
  const halfEfcShare =
    result.summary.equivalentFullCycles > 0
      ? composition.halfEquivalentFullCycles
        / result.summary.equivalentFullCycles
      : null;

  return (
    <section data-testid="cycle-stress-composition">
      <GlassPanel className="p-4 sm:p-5">
        <PanelTitle className="mb-1 flex items-center gap-2">
          <GitCompareArrows
            className="h-4 w-4 text-cyan-300"
            aria-hidden="true"
          />
          {t(
            'cycleStress.composition.title',
            'Closed-cycle and boundary-residue composition',
          )}
        </PanelTitle>
        <Text as="p" variant="caption" className="mb-4">
          {t(
            'cycleStress.composition.subtitle',
            'Full-cycle records close inside a continuity segment; half-cycle records remain at segment or returned-history boundaries.',
          )}
        </Text>
        <CycleStressSectionBody
          result={result}
          state={state}
          requirement="cycles"
        >
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-6">
            <MetricCard
              label={t(
                'cycleStress.composition.fullRecords',
                'Full-cycle records',
              )}
              value={cycleStressNumber(
                composition.fullCycleRecords,
                locale,
                0,
              )}
              subtitle={t(
                'cycleStress.composition.closedRanges',
                'closed ranges, count 1.0',
              )}
              icon={<CircleDot className="h-5 w-5" />}
              color="green"
            />
            <MetricCard
              label={t(
                'cycleStress.composition.halfRecords',
                'Half-cycle records',
              )}
              value={cycleStressNumber(
                composition.halfCycleRecords,
                locale,
                0,
              )}
              subtitle={t(
                'cycleStress.composition.residualRanges',
                'boundary ranges, count 0.5',
              )}
              icon={<CircleDashed className="h-5 w-5" />}
              color="amber"
            />
            <MetricCard
              label={t(
                'cycleStress.composition.weightedCount',
                'Weighted cycle count',
              )}
              value={cycleStressNumber(
                result.summary.weightedCycleCount,
                locale,
                1,
              )}
              subtitle={t(
                'cycleStress.composition.countFormula',
                'full + half x 0.5',
              )}
              icon={<Sigma className="h-5 w-5" />}
              color="cyan"
            />
            <MetricCard
              label={t(
                'cycleStress.composition.fullEfc',
                'EFC from full cycles',
              )}
              value={cycleStressNumber(
                composition.fullEquivalentFullCycles,
                locale,
                2,
              )}
              subtitle={t(
                'cycleStress.composition.closedContribution',
                'closed-range contribution',
              )}
              icon={<BatteryCharging className="h-5 w-5" />}
              color="blue"
            />
            <MetricCard
              label={t(
                'cycleStress.composition.halfEfc',
                'EFC from residues',
              )}
              value={cycleStressNumber(
                composition.halfEquivalentFullCycles,
                locale,
                2,
              )}
              subtitle={t(
                'cycleStress.composition.boundaryContribution',
                'boundary-range contribution',
              )}
              icon={<Gauge className="h-5 w-5" />}
              color="purple"
            />
            <MetricCard
              label={t(
                'cycleStress.composition.residueShare',
                'Residue share of EFC',
              )}
              value={cycleStressShare(halfEfcShare, locale)}
              subtitle={t(
                'cycleStress.composition.windowSensitivity',
                'returned-window sensitivity',
              )}
              icon={<CircleDashed className="h-5 w-5" />}
              color="red"
            />
          </div>
          <AlertBanner className="mt-4" variant="info">
            <Text as="p" variant="caption">
              {t(
                'cycleStress.composition.notice',
                'A half-cycle here is a standard rainflow residue at a segment edge. It does not mean the underlying drive or charging row was incomplete; incomplete source rows are excluded before reconstruction.',
              )}
            </Text>
          </AlertBanner>
        </CycleStressSectionBody>
      </GlassPanel>
    </section>
  );
}
