import { Flag, Gauge } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { ProgressRing } from '@/components/data-display';
import { Grid } from '@/components/layout';
import {
  GlassPanel,
  HelpTooltip,
  PanelTitle,
  Text,
} from '@/components/ui';
import { fmtNumber } from '@/lib/numberFormat';

import type { OdometerMilestoneResult } from '../../lib/odometerMilestones';
import { MilestoneSectionBody } from './MilestoneSectionBody';
import type { MilestoneSectionState } from './types';
import { useOdometerMilestoneDisplay } from './useOdometerMilestoneDisplay';

const DETAIL_COLUMNS = { default: 2, lg: 4 } as const;

interface MilestoneProgressProps {
  summary: OdometerMilestoneResult;
  state: MilestoneSectionState;
}

export function MilestoneProgress({
  summary,
  state,
}: MilestoneProgressProps) {
  const { t } = useTranslation();
  const { formatDistanceKm } = useOdometerMilestoneDisplay();
  const { segment, primaryPace, accounting } = summary;
  const percent = segment.progressRatio * 100;
  const evidence =
    accounting.eligibleRows === 0
      ? t(
          'milestones.progress.noEvidence',
          'Progress currently reflects calibration only; eligible drives will add observed growth.',
        )
      : accounting.capReached
        ? t(
            'milestones.progress.cappedEvidence',
            'The 1,000-row cap was reached, so older distance may be absent and odometer completeness is unknown.',
          )
        : primaryPace.supported
          ? t(
              'milestones.progress.supportedEvidence',
              'Forecast evidence uses {{count}} drives across {{days}} observed days; projections can change.',
              {
                count: primaryPace.sampleCount,
                days: fmtNumber(primaryPace.observedDays, 1),
              },
            )
          : t(
              'milestones.progress.thinEvidence',
              'Progress is observed, but no ETA is shown until five eligible drives support the trailing pace.',
            );

  return (
    <section
      aria-label={t(
        'milestones.sections.progress',
        'Progress to next milestone',
      )}
      data-testid="milestone-progress"
    >
      <GlassPanel className="p-4 sm:p-6">
        <PanelTitle className="mb-4 flex items-center gap-2">
          <Flag className="h-4 w-4 text-amber-300" aria-hidden="true" />
          {t('milestones.progress.title', 'Progress to the next round number')}
          <HelpTooltip
            size="sm"
            i18nKey="help.milestones.body"
            defaultValue="Calibration is the odometer immediately before the chronologically first row in this returned history window. Eligible drive distances are added in order, and milestones are round in your selected distance unit."
            ariaLabel={t(
              'help.milestones.iconLabel',
              'More info about milestone math',
            )}
          />
        </PanelTitle>
        <MilestoneSectionBody state={state}>
          <div className="grid items-center gap-6 lg:grid-cols-[auto_1fr]">
            <ProgressRing
              value={percent}
              size={136}
              strokeWidth={9}
              centerLabel={`${fmtNumber(percent, 1)}%`}
              centerSubLabel={t(
                'milestones.progress.complete',
                'complete',
              )}
              ariaLabel={t(
                'milestones.progress.aria',
                '{{percent}} percent progress toward the next milestone',
                { percent: fmtNumber(percent, 1) },
              )}
            />
            <Grid cols={DETAIL_COLUMNS} gap={3}>
              {[
                {
                  key: 'previous',
                  label: t(
                    'milestones.progress.previous',
                    'Previous milestone',
                  ),
                  value: formatDistanceKm(segment.previousMilestoneKm),
                },
                {
                  key: 'current',
                  label: t('milestones.progress.current', 'Current odometer'),
                  value: formatDistanceKm(summary.currentOdometerKm),
                },
                {
                  key: 'next',
                  label: t('milestones.progress.next', 'Next milestone'),
                  value: formatDistanceKm(segment.nextMilestoneKm),
                },
                {
                  key: 'remaining',
                  label: t('milestones.progress.remaining', 'Remaining'),
                  value: formatDistanceKm(segment.remainingKm),
                },
              ].map((item) => (
                <div
                  key={item.key}
                  className="rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-2)] p-3"
                >
                  <Text variant="caption">{item.label}</Text>
                  <Text
                    as="dd"
                    size="sm"
                    weight="semibold"
                    color="primary"
                    className="mt-1 tabular-nums"
                  >
                    {item.value}
                  </Text>
                </div>
              ))}
            </Grid>
          </div>
          <div className="mt-5 flex gap-2 rounded-xl border border-amber-400/20 bg-amber-400/5 p-3">
            <Gauge
              className="mt-0.5 h-4 w-4 shrink-0 text-amber-300"
              aria-hidden="true"
            />
            <Text variant="bodySm">{evidence}</Text>
          </div>
        </MilestoneSectionBody>
      </GlassPanel>
    </section>
  );
}
