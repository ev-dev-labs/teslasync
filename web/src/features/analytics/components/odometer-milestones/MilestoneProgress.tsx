import { Gauge } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { ProgressRing } from '@/components/data-display';
import { AlertBanner } from '@/components/feedback';
import { LayoutCard } from '@/components/layout';
import {
  HelpTooltip,
  Text,
} from '@/components/ui';


import type { OdometerMilestoneResult } from '../../lib/odometerMilestones';
import { MilestoneSectionBody } from './MilestoneSectionBody';
import type { MilestoneSectionState } from './types';
import { useOdometerMilestoneDisplay } from './useOdometerMilestoneDisplay';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';

interface MilestoneProgressProps {
  summary: OdometerMilestoneResult;
  state: MilestoneSectionState;
}

export function MilestoneProgress({
  summary,
  state,
}: MilestoneProgressProps) {
  const { fmtNumber } = useNumberFormatting();
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
                days: fmtNumber(primaryPace.observedDays),
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
      <LayoutCard title={t('milestones.progress.title', 'Progress to the next round number')}
        actions={<HelpTooltip
            size="sm"
            i18nKey="help.milestones.body"
            defaultValue="Calibration is the odometer immediately before the chronologically first eligible drive in this returned history window. Eligible drive distances are added in order, and milestones are round in your selected distance unit."
            ariaLabel={t(
              'help.milestones.iconLabel',
              'More info about milestone math',
            )}
          />}
      >
        <MilestoneSectionBody state={state}>
          <div className="grid items-center gap-6 lg:grid-cols-[auto_1fr]">
            <ProgressRing
              value={percent}
              size={136}
              strokeWidth={9}
              centerLabel={`${fmtNumber(percent)}%`}
              centerSubLabel={t(
                'milestones.progress.complete',
                'complete',
              )}
              ariaLabel={t(
                'milestones.progress.aria',
                '{{percent}} percent progress toward the next milestone',
                { percent: fmtNumber(percent) },
              )}
            />
            <dl data-app-part="list" data-app-list="definitions"
              data-layout="responsive-columns"
              className="grid min-w-0 grid-cols-2 gap-3 lg:grid-cols-4"
            >
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
                  data-app-part="list-row"
                  key={item.key}
                  className="rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-2)] p-3"
                >
                  <Text data-app-part="metric-label" as="dt" variant="caption">{item.label}</Text>
                  <Text
                    data-app-part="metric-value"
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
            </dl>
          </div>
          <AlertBanner
            variant="warning"
            icon={<Gauge className="h-4 w-4" aria-hidden="true" />}
            className="mt-5 gap-2 rounded-xl p-3"
          >
            <Text variant="bodySm">{evidence}</Text>
          </AlertBanner>
        </MilestoneSectionBody>
      </LayoutCard>
    </section>
  );
}
