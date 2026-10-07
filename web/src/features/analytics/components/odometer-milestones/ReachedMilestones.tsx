import { Check, Flag } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { Timeline } from '@/components/data-display';
import { EmptyState } from '@/components/feedback';
import { Badge, GlassPanel, PanelTitle } from '@/components/ui';

import type { OdometerMilestoneResult } from '../../lib/odometerMilestones';
import { MilestoneSectionBody } from './MilestoneSectionBody';
import type { MilestoneSectionState } from './types';
import { useOdometerMilestoneDisplay } from './useOdometerMilestoneDisplay';

interface ReachedMilestonesProps {
  summary: OdometerMilestoneResult;
  state: MilestoneSectionState;
  className?: string;
}

export function ReachedMilestones({
  summary,
  state,
  className,
}: ReachedMilestonesProps) {
  const { t } = useTranslation();
  const { formatDateMs, formatDistanceKm } =
    useOdometerMilestoneDisplay();
  const items = [...summary.reached].reverse().map((milestone) => ({
    icon: <Check className="h-3 w-3" aria-hidden="true" />,
    title: (
      <Badge variant="success">
        {formatDistanceKm(milestone.thresholdKm)}
      </Badge>
    ),
    subtitle: t(
      'milestones.reached.crossing',
      'Crossed during eligible drive #{{id}}',
      { id: milestone.crossingDriveId },
    ),
    time: formatDateMs(milestone.reachedAtMs),
  }));

  return (
    <section
      className={className}
      aria-label={t(
        'milestones.sections.reached',
        'Milestones reached in observed history',
      )}
      data-testid="milestone-reached"
    >
      <GlassPanel className="h-full p-4 sm:p-5">
        <PanelTitle className="mb-4 flex items-center gap-2">
          <Flag className="h-4 w-4 text-emerald-300" aria-hidden="true" />
          {t('milestones.reached.title', 'Milestones reached')}
        </PanelTitle>
        <MilestoneSectionBody state={state}>
          {items.length === 0 ? (
            <EmptyState
              icon={<Flag className="h-8 w-8" aria-hidden="true" />}
              message={t(
                'milestones.reached.empty',
                'No round milestone was crossed by an eligible drive in this returned history window.',
              )}
              actionTo={{
                label: t('milestones.actions.browseDrives', 'Browse drives'),
                to: '/drives',
              }}
            />
          ) : (
            <Timeline
              items={items}
              className="max-h-[26rem] overflow-y-auto pr-2"
              emptyMessage={t(
                'milestones.reached.empty',
                'No round milestone was crossed by an eligible drive in this returned history window.',
              )}
            />
          )}
        </MilestoneSectionBody>
      </GlassPanel>
    </section>
  );
}
