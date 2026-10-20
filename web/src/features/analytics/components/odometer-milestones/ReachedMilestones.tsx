import { Check, Flag } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { Timeline } from '@/components/data-display';
import { EmptyState } from '@/components/feedback';
import { Badge } from '@/components/ui';
import { LayoutCard } from '@/components/layout';

import type { OdometerMilestoneResult } from '../../lib/odometerMilestones';
import { MilestoneSectionBody } from './MilestoneSectionBody';
import type { MilestoneSectionState } from './types';
import { useOdometerMilestoneDisplay } from './useOdometerMilestoneDisplay';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';

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
  useNumberFormatting();
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
      <LayoutCard title={t('milestones.reached.title', 'Milestones reached')}>
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
      </LayoutCard>
    </section>
  );
}
