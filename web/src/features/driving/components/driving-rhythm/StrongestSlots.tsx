import { ListOrdered, Timer } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { EmptyState } from '@/components/feedback';
import {
  Badge,
  GlassPanel,
  MetricLabel,
  MetricValue,
  PanelTitle,
  Text,
} from '@/components/ui';
import { useUnits } from '@/hooks/useUnits';
import { cn } from '@/lib/cn';
import { fmtNumber } from '@/lib/numberFormat';

import type { DrivingRhythm } from '../../lib/drivingRhythm';
import { DrivingRhythmSectionBody } from './DrivingRhythmSectionBody';
import type { DrivingRhythmSectionState } from './types';
import { useRhythmDayLabel } from './useRhythmDayLabel';

interface StrongestSlotsProps {
  summary: DrivingRhythm;
  state: DrivingRhythmSectionState;
  className?: string;
}

export function StrongestSlots({
  summary,
  state,
  className,
}: StrongestSlotsProps) {
  const { t } = useTranslation();
  const { formatDistance } = useUnits();
  const dayLabel = useRhythmDayLabel();
  const slots = summary.strongestSlots ?? [];

  return (
    <GlassPanel
      className={cn('h-full p-5 sm:p-6', className)}
      role="region"
      aria-label={t(
        'rhythm.sections.slots',
        'Strongest departure time slots',
      )}
      data-testid="driving-rhythm-slots"
    >
      <PanelTitle className="flex items-center gap-2">
        <ListOrdered
          className="h-4 w-4 text-amber-300"
          aria-hidden="true"
        />
        {t('rhythm.slots.title', 'Strongest time slots')}
      </PanelTitle>
      <Text as="p" variant="caption" className="mt-1">
        {t(
          'rhythm.slots.subtitle',
          'Ranked by valid start count; ties resolve Monday-first, then by earlier local hour.',
        )}
      </Text>

      <DrivingRhythmSectionBody state={state} className="mt-4 min-h-64">
        {slots.length === 0 ? (
          <EmptyState
            className="h-full"
            icon={<Timer className="h-8 w-8" aria-hidden="true" />}
            message={t(
              'rhythm.slots.empty',
              'No occupied weekday-hour slots are available to rank.',
            )}
          />
        ) : (
          <ol className="space-y-2">
            {slots.map((slot) => (
              <li
                key={`${slot.day}-${slot.hour}`}
                className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-2)] p-3"
              >
                <Badge variant={slot.rank === 1 ? 'success' : 'neutral'}>
                  {t('rhythm.slots.rank', '#{{rank}}', {
                    rank: slot.rank,
                  })}
                </Badge>
                <div className="min-w-0">
                  <Text as="p" variant="subhead">
                    {t(
                      'rhythm.slots.slotLabel',
                      '{{day}} at {{hour}}:00',
                      {
                        day: dayLabel(slot.day),
                        hour: String(slot.hour).padStart(2, '0'),
                      },
                    )}
                  </Text>
                  <Text as="p" variant="caption">
                    {t(
                      'rhythm.slots.evidence',
                      '{{share}}% of valid starts · {{distance}} logged across {{measured}} measured drives',
                      {
                        share: fmtNumber(slot.share * 100, 1),
                        distance: formatDistance(
                          slot.measuredDistanceDrives > 0
                            ? slot.distanceM
                            : null,
                          { precision: 1 },
                        ),
                        measured: slot.measuredDistanceDrives,
                      },
                    )}
                  </Text>
                </div>
                <div className="text-right">
                  <MetricValue>{slot.count}</MetricValue>
                  <MetricLabel>
                    {slot.qualified
                      ? t('rhythm.slots.supported', 'sample supported')
                      : t(
                          'rhythm.slots.sparse',
                          'below {{count}}-drive floor',
                          { count: summary.minSlotDrives },
                        )}
                  </MetricLabel>
                </div>
              </li>
            ))}
          </ol>
        )}
      </DrivingRhythmSectionBody>
    </GlassPanel>
  );
}
