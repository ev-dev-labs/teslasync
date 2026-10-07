import { Clock4 } from 'lucide-react';
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

import {
  formatMinuteOfDay,
  type DrivingRhythm,
} from '../../lib/drivingRhythm';
import { DrivingRhythmSectionBody } from './DrivingRhythmSectionBody';
import type { DrivingRhythmSectionState } from './types';
import { useRhythmDayLabel } from './useRhythmDayLabel';

const DAY_ORDER = [1, 2, 3, 4, 5, 6, 0] as const;

interface DepartureConsistencyProps {
  summary: DrivingRhythm;
  state: DrivingRhythmSectionState;
  className?: string;
}

export function DepartureConsistency({
  summary,
  state,
  className,
}: DepartureConsistencyProps) {
  const { t } = useTranslation();
  const { formatDuration } = useUnits();
  const dayLabel = useRhythmDayLabel();

  return (
    <GlassPanel
      className={cn('h-full p-5 sm:p-6', className)}
      role="region"
      aria-label={t(
        'rhythm.sections.consistency',
        'Departure consistency by weekday',
      )}
      data-testid="driving-rhythm-consistency"
    >
      <PanelTitle className="flex items-center gap-2">
        <Clock4 className="h-4 w-4 text-emerald-300" aria-hidden="true" />
        {t('rhythm.consistency.title', 'Departure consistency')}
      </PanelTitle>
      <Text as="p" variant="caption" className="mt-1">
        {t(
          'rhythm.consistency.subtitle',
          'Typical 24-hour departure and median circular deviation by local weekday in {{timezone}}.',
          { timezone: summary.timeZone },
        )}
      </Text>

      <DrivingRhythmSectionBody state={state} className="mt-4 min-h-64">
        {summary.total === 0 ? (
          <EmptyState /* no-action: the active filters and recorded telemetry determine this read-only result */
            className="h-full"
            icon={<Clock4 className="h-8 w-8" aria-hidden="true" />}
            message={t(
              'rhythm.consistency.empty',
              'No valid departures are available for weekday profiles.',
            )}
          />
        ) : (
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 xl:grid-cols-7">
            {DAY_ORDER.map((day) => {
              const profile = summary.dayProfiles[day]!;
              return (
                <div
                  key={day}
                  className="rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-2)] p-3"
                >
                  <div className="flex flex-wrap items-center justify-between gap-1">
                    <Text as="h4" variant="subhead">
                      {dayLabel(day)}
                    </Text>
                    <Badge
                      size="sm"
                      variant={
                        profile.consistencySupported ? 'success' : 'neutral'
                      }
                    >
                      {t(
                        'rhythm.consistency.sampleBadge',
                        '{{count}}/{{minimum}}',
                        {
                          count: profile.drives,
                          minimum: summary.minConsistencyDrives,
                        },
                      )}
                    </Badge>
                  </div>
                  <div className="mt-3">
                    <MetricValue>
                      {formatMinuteOfDay(profile.medianDepartureMinute)}
                    </MetricValue>
                    <MetricLabel>
                      {t('rhythm.consistency.typical', 'Circular median')}
                    </MetricLabel>
                  </div>
                  <div className="mt-3">
                    <MetricValue>
                      {profile.consistencyDeviationS != null
                        ? `±${formatDuration(
                            profile.consistencyDeviationS,
                            { precision: 2 },
                          )}`
                        : '—'}
                    </MetricValue>
                    <MetricLabel>
                      {profile.consistencySupported
                        ? t(
                            'rhythm.consistency.deviation',
                            'Median deviation',
                          )
                        : t(
                            'rhythm.consistency.moreNeeded',
                            'Below sample floor',
                          )}
                    </MetricLabel>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </DrivingRhythmSectionBody>
    </GlassPanel>
  );
}
