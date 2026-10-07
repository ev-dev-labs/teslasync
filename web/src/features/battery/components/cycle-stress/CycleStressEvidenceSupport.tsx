import {
  Activity,
  CalendarRange,
  Clock3,
  Database,
  Layers3,
  ShieldCheck,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { MetricCard } from '@/components/data-display';
import { AlertBanner } from '@/components/feedback';
import { GlassPanel, PanelTitle, Text } from '@/components/ui';
import type { CycleStressResult } from '../../lib/cycleStress';
import {
  cycleStressBandLabel,
  cycleStressNumber,
} from './labels';
import { CycleStressSectionBody } from './CycleStressSectionBody';
import type { CycleStressQueryState } from './types';

interface CycleStressEvidenceSupportProps {
  result: CycleStressResult;
  state: CycleStressQueryState;
  locale: string;
}

export function CycleStressEvidenceSupport({
  result,
  state,
  locale,
}: CycleStressEvidenceSupportProps) {
  const { t } = useTranslation();
  const support = result.coverage.support;

  return (
    <section data-testid="cycle-stress-evidence-support">
      <GlassPanel className="p-4 sm:p-5">
        <PanelTitle className="mb-1 flex items-center gap-2">
          <ShieldCheck
            className="h-4 w-4 text-cyan-300"
            aria-hidden="true"
          />
          {t(
            'cycleStress.support.title',
            'Evidence support',
          )}
        </PanelTitle>
        <Text as="p" variant="caption" className="mb-4">
          {t(
            'cycleStress.support.subtitle',
            'Support measures breadth, recency, and source participation; it is separate from whether cycle depth is high or low.',
          )}
        </Text>
        <CycleStressSectionBody
          result={result}
          state={state}
          requirement="none"
        >
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-6">
            <MetricCard
              label={t('cycleStress.support.index', 'Support index')}
              value={`${cycleStressNumber(
                support.index,
                locale,
                1,
              )}/100`}
              subtitle={cycleStressBandLabel(t, support.band)}
              icon={<ShieldCheck className="h-5 w-5" />}
              color="purple"
            />
            <MetricCard
              label={t(
                'cycleStress.support.intervals',
                'Accepted intervals',
              )}
              value={cycleStressNumber(
                support.intervals.value,
                locale,
                0,
              )}
              subtitle={t(
                'cycleStress.support.target',
                '{{value}} target',
                { value: support.intervals.target },
              )}
              icon={<Database className="h-5 w-5" />}
              color="cyan"
            />
            <MetricCard
              label={t(
                'cycleStress.support.cycles',
                'Weighted cycles',
              )}
              value={cycleStressNumber(
                support.cycles.value,
                locale,
                1,
              )}
              subtitle={t(
                'cycleStress.support.target',
                '{{value}} target',
                { value: support.cycles.target },
              )}
              icon={<Activity className="h-5 w-5" />}
              color="green"
            />
            <MetricCard
              label={t(
                'cycleStress.support.weeks',
                'Active local weeks',
              )}
              value={cycleStressNumber(
                support.activeWeeks.value,
                locale,
                0,
              )}
              subtitle={t(
                'cycleStress.support.target',
                '{{value}} target',
                { value: support.activeWeeks.target },
              )}
              icon={<CalendarRange className="h-5 w-5" />}
              color="blue"
            />
            <MetricCard
              label={t('cycleStress.support.recency', 'Recency')}
              value={
                result.coverage.daysSinceLastObservation == null
                  ? '—'
                  : t(
                      'cycleStress.support.daysValue',
                      '{{value}} days',
                      {
                        value: cycleStressNumber(
                          result.coverage.daysSinceLastObservation,
                          locale,
                          1,
                        ),
                      },
                    )
              }
              subtitle={t(
                'cycleStress.support.latestEndpoint',
                'since latest retained endpoint',
              )}
              icon={<Clock3 className="h-5 w-5" />}
              color="amber"
            />
            <MetricCard
              label={t(
                'cycleStress.support.sources',
                'Sources represented',
              )}
              value={cycleStressNumber(
                support.sourceCoverage.value,
                locale,
                0,
              )}
              subtitle={t(
                'cycleStress.support.outOfTwo',
                'of 2 requested histories',
              )}
              icon={<Layers3 className="h-5 w-5" />}
              color="red"
            />
          </div>
          <AlertBanner className="mt-4" variant="info">
            <Text as="p" variant="caption">
              {t(
                'cycleStress.support.formula',
                'Support index = 100 x (0.25 x interval volume + 0.25 x weighted cycles + 0.20 x active weeks + 0.15 x recency + 0.15 x source coverage). Volume saturates at 50 intervals, 20 weighted cycles, and 8 weeks. Recency scores 1 through 7 days, 0.75 through 30, 0.5 through 90, 0.25 through 180, then 0. Bands are thin below 35, developing below 70, and strong from 70.',
              )}
            </Text>
          </AlertBanner>
          {result.coverage.omittedTrendMonths > 0 ? (
            <AlertBanner className="mt-3" variant="warning">
              <Text as="p" variant="caption">
                {t(
                  'cycleStress.support.monthLimit',
                  '{{shown}} of {{returned}} local months are shown; {{omitted}} older months are omitted from the chart only.',
                  {
                    shown: result.coverage.displayedTrendMonths,
                    returned: result.coverage.returnedTrendMonths,
                    omitted: result.coverage.omittedTrendMonths,
                  },
                )}
              </Text>
            </AlertBanner>
          ) : null}
          {result.coverage.omittedTimelinePoints > 0 ? (
            <AlertBanner className="mt-3" variant="warning">
              <Text as="p" variant="caption">
                {t(
                  'cycleStress.support.timelineLimit',
                  '{{shown}} of {{total}} turning points are shown in the point cloud; {{omitted}} older points are omitted from that chart only.',
                  {
                    shown: result.coverage.timelinePoints,
                    total: result.continuity.turningPoints,
                    omitted: result.coverage.omittedTimelinePoints,
                  },
                )}
              </Text>
            </AlertBanner>
          ) : null}
        </CycleStressSectionBody>
      </GlassPanel>
    </section>
  );
}
