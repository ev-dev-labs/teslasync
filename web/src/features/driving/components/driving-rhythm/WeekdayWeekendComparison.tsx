import { CalendarRange, Info } from 'lucide-react';
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

import type {
  DrivingRhythm,
  RhythmDayType,
} from '../../lib/drivingRhythm';
import { DrivingRhythmSectionBody } from './DrivingRhythmSectionBody';
import type { DrivingRhythmSectionState } from './types';

interface WeekdayWeekendComparisonProps {
  summary: DrivingRhythm;
  state: DrivingRhythmSectionState;
  className?: string;
}

export function WeekdayWeekendComparison({
  summary,
  state,
  className,
}: WeekdayWeekendComparisonProps) {
  const { t } = useTranslation();
  const { formatDistance } = useUnits();
  const labels: Record<RhythmDayType, string> = {
    weekday: t('rhythm.comparison.weekday', 'Weekdays'),
    weekend: t('rhythm.comparison.weekend', 'Weekends'),
  };
  const rows = (['weekday', 'weekend'] as const).map((key) => {
    const cohort = summary.dayTypes[key];
    return {
      ...cohort,
      label: labels[key],
    };
  });

  return (
    <GlassPanel
      className={cn('h-full p-5 sm:p-6', className)}
      role="region"
      aria-label={t(
        'rhythm.sections.comparison',
        'Weekday and weekend comparison',
      )}
      data-testid="driving-rhythm-comparison"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <PanelTitle className="flex items-center gap-2">
          <CalendarRange
            className="h-4 w-4 text-indigo-300"
            aria-hidden="true"
          />
          {t('rhythm.comparison.title', 'Weekday vs weekend')}
        </PanelTitle>
        <Badge variant="neutral">
          {t('rhythm.comparison.normalized', 'Calendar-day normalized')}
        </Badge>
      </div>
      <Text as="p" variant="caption" className="mt-1">
        {t(
          'rhythm.comparison.subtitle',
          'Per-day rates use every selected calendar day, including days with no drive.',
        )}
      </Text>

      <DrivingRhythmSectionBody state={state} className="mt-4 min-h-72">
        {summary.total === 0 ? (
          <EmptyState /* no-action: the active filters and recorded telemetry determine this read-only result */
            className="h-full"
            icon={<CalendarRange className="h-8 w-8" aria-hidden="true" />}
            message={t(
              'rhythm.comparison.empty',
              'No valid drives are available for a weekday/weekend comparison.',
            )}
          />
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            {rows.map((row) => (
              <div
                key={row.key}
                className="rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-2)] p-4"
              >
                <div className="flex items-center justify-between gap-2">
                  <Text as="h4" variant="subhead">
                    {row.label}
                  </Text>
                  <Badge variant={row.key === 'weekday' ? 'info' : 'neutral'}>
                    {t('rhythm.comparison.shareValue', '{{share}}%', {
                      share: fmtNumber(row.share * 100, 0),
                    })}
                  </Badge>
                </div>
                <div className="mt-4 grid grid-cols-2 gap-3">
                  <div>
                    <MetricValue>{row.drives}</MetricValue>
                    <MetricLabel>
                      {t('rhythm.comparison.drives', 'Valid drives')}
                    </MetricLabel>
                  </div>
                  <div>
                    <MetricValue>
                      {row.drivesPerCalendarDay != null
                        ? fmtNumber(row.drivesPerCalendarDay, 2)
                        : '—'}
                    </MetricValue>
                    <MetricLabel>
                      {t('rhythm.comparison.perDay', 'Drives / selected day')}
                    </MetricLabel>
                  </div>
                  <div>
                    <MetricValue>{row.activeDays}</MetricValue>
                    <MetricLabel>
                      {t('rhythm.comparison.activeDays', 'Active local days')}
                    </MetricLabel>
                  </div>
                  <div>
                    <MetricValue>
                      {formatDistance(row.averageDistanceM, { precision: 1 })}
                    </MetricValue>
                    <MetricLabel>
                      {t(
                        'rhythm.comparison.averageDistance',
                        'Avg measured distance',
                      )}
                    </MetricLabel>
                  </div>
                </div>
                <Text as="p" variant="caption" className="mt-4">
                  {row.calendarDays != null
                    ? t(
                        'rhythm.comparison.coverage',
                        '{{active}} active of {{calendar}} selected calendar days · {{distance}} logged',
                        {
                          active: row.activeDays,
                          calendar: row.calendarDays,
                          distance: formatDistance(
                            row.measuredDistanceDrives > 0
                              ? row.distanceM
                              : null,
                            { precision: 1 },
                          ),
                        },
                      )
                    : t(
                        'rhythm.comparison.noCalendarScope',
                        'Selected calendar-day coverage is unavailable; raw counts remain valid.',
                      )}
                </Text>
              </div>
            ))}
            <div className="flex items-start gap-2 sm:col-span-2">
              <Info
                className="mt-0.5 h-4 w-4 shrink-0 text-cyan-300"
                aria-hidden="true"
              />
              <Text as="p" variant="bodySm">
                {t(
                  'rhythm.comparison.interpretation',
                  'Compare the per-selected-day rates rather than raw shares when judging weekday and weekend frequency.',
                )}
              </Text>
            </div>
          </div>
        )}
      </DrivingRhythmSectionBody>
    </GlassPanel>
  );
}
