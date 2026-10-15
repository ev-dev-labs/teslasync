import { CalendarClock } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { EmptyState } from '@/components/feedback';
import { GlassPanel, HelpTooltip, PanelTitle, Table, Text } from '@/components/ui';
import { useChartPalette } from '@/hooks/useChartPalette';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';
import { cn } from '@/lib/cn';
import { typography } from '@/lib/tokens';

import type { DrivingRhythm } from '../../lib/drivingRhythm';
import { DrivingRhythmSectionBody } from './DrivingRhythmSectionBody';
import type { DrivingRhythmSectionState } from './types';
import { useRhythmDayLabel } from './useRhythmDayLabel';

const DAY_ORDER = [1, 2, 3, 4, 5, 6, 0] as const;
const CELL_LEVEL_PERCENTAGES = [15, 30, 45, 65, 85] as const;

function cellColor(count: number, maximum: number, color: string): string | undefined {
  if (count <= 0 || maximum <= 0) return undefined;
  const index = Math.min(
    CELL_LEVEL_PERCENTAGES.length - 1,
    Math.ceil((count / maximum) * CELL_LEVEL_PERCENTAGES.length) - 1,
  );
  return `color-mix(in srgb, ${color} ${CELL_LEVEL_PERCENTAGES[index]}%, var(--surface-2))`;
}

interface WeeklyPunchcardProps {
  summary: DrivingRhythm;
  state: DrivingRhythmSectionState;
}

export function WeeklyPunchcard({
  summary,
  state,
}: WeeklyPunchcardProps) {
  const { t } = useTranslation();
  const palette = useChartPalette();
  const { locale, fmtInt } = useNumberFormatting();
  const dayLabel = useRhythmDayLabel();
  const hourLabel = (hour: number) =>
    new Intl.NumberFormat(locale, { minimumIntegerDigits: 2 }).format(hour);
  const favoriteLabel = summary.favorite
    ? `${dayLabel(summary.favorite.day)} ${hourLabel(summary.favorite.hour)}:${hourLabel(0)}`
    : '—';

  return (
    <GlassPanel
      className="p-4 sm:p-5"
      role="region"
      aria-label={t('rhythm.sections.punchcard', 'Weekly punchcard')}
      data-testid="driving-rhythm-punchcard"
    >
      <PanelTitle className="flex items-center gap-2">
        <CalendarClock
          className={cn('h-4 w-4', typography.color.secondary)}
          aria-hidden="true"
        />
        {t('rhythm.punchcard', 'Weekly Punchcard')}
        <HelpTooltip
          size="sm"
          i18nKey="help.drivingRhythm.body"
          defaultValue="Each cell counts valid drive starts in that weekday-hour slot. Darker cells are busier; all cells use the same local-time scale."
          ariaLabel={t(
            'help.drivingRhythm.iconLabel',
            'More info about the punchcard',
          )}
        />
      </PanelTitle>
      <Text as="p" variant="caption" className="mt-1">
        {t(
          'rhythm.weeklyPunchcard.timezone',
          '24-hour departures grouped in {{timezone}}',
          { timezone: summary.timeZone },
        )}
      </Text>

      <DrivingRhythmSectionBody state={state} className="mt-4 min-h-72">
        {summary.total === 0 ? (
          <EmptyState
            className="h-full"
            icon={<CalendarClock className="h-8 w-8" aria-hidden="true" />}
            message={t('rhythm.noDrives', 'No drives in this period yet.')}
            actionTo={{
              label: t('rhythm.browseDrives', 'Browse drives'),
              to: '/drives',
            }}
          />
        ) : (
          <div
            className="max-w-full overflow-x-auto overscroll-x-contain rounded-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-ring)]"
            role="region"
            tabIndex={0}
            aria-label={t(
              'rhythm.weeklyPunchcard.scroll',
              'Weekly drive-start counts; scroll to see all hours',
            )}
          >
            <div className="min-w-[800px]">
              <Table variant="embedded" className="w-full table-fixed">
                <caption className="pb-3 text-start">
                  <Text variant="caption">
                    {t(
                      'rhythm.weeklyPunchcard.aria',
                      'Drive starts by local weekday and hour; strongest slot {{slot}}',
                      { slot: favoriteLabel },
                    )}
                  </Text>
                </caption>
                <thead>
                  <tr>
                    <th scope="col" className="w-12">
                      <Text variant="caption">{t('rhythm.weeklyPunchcard.day', 'Day')}</Text>
                    </th>
                    {Array.from({ length: 24 }, (_, hour) => (
                      <th key={hour} scope="col">
                        <Text variant="caption" className="text-center tabular-nums">
                          {hourLabel(hour)}
                        </Text>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {DAY_ORDER.map((day) => (
                    <tr key={day}>
                      <th scope="row">
                        <Text variant="caption">{dayLabel(day)}</Text>
                      </th>
                      {Array.from({ length: 24 }, (_, hour) => {
                        const count = summary.matrix[day]![hour]!;
                        return (
                          <td
                            key={hour}
                            aria-label={t(
                              'rhythm.weeklyPunchcard.cell',
                              '{{day}} {{hour}} · {{count}} drives',
                              { day: dayLabel(day), hour: `${hourLabel(hour)}:${hourLabel(0)}`, count: fmtInt(count) },
                            )}
                            className="border border-[var(--border-subtle)] bg-[var(--surface-2)] py-3 text-center"
                            style={{
                              backgroundColor: cellColor(count, summary.maxCount, palette[0]!),
                            }}
                          >
                            <Text variant="caption" className="tabular-nums">{fmtInt(count)}</Text>
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </Table>
            </div>
          </div>
        )}
      </DrivingRhythmSectionBody>
    </GlassPanel>
  );
}
