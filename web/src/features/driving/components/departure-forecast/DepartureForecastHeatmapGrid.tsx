import { useTranslation } from 'react-i18next';

import { Badge, Text } from '@/components/ui';
import { cn } from '@/lib/cn';
import { fmtInt, fmtNumber } from '@/lib/numberFormat';
import type {
  DepartureForecast,
  DepartureMatrixCell,
} from '../../lib/departureForecast';
import { departureWeekdayShortLabel } from './labels';

interface DepartureForecastHeatmapGridProps {
  forecast: DepartureForecast;
  locale: string;
}

function cellClass(cell: DepartureMatrixCell, maximum: number): string {
  if (!cell.supported) {
    return 'border-dashed border-[var(--border-subtle)] bg-[var(--surface-1)] text-[var(--text-muted)]';
  }
  const ratio = maximum > 0 ? cell.p / maximum : 0;
  if (ratio >= 0.8) {
    return 'border-cyan-300/40 bg-cyan-400/30 text-[var(--text-primary)]';
  }
  if (ratio >= 0.55) {
    return 'border-cyan-300/30 bg-cyan-400/20 text-[var(--text-primary)]';
  }
  if (ratio >= 0.3) {
    return 'border-cyan-300/20 bg-cyan-400/10 text-[var(--text-secondary)]';
  }
  return 'border-cyan-300/10 bg-cyan-400/5 text-[var(--text-secondary)]';
}

export function DepartureForecastHeatmapGrid({
  forecast,
  locale,
}: DepartureForecastHeatmapGridProps) {
  const { t } = useTranslation();
  const maximum = Math.max(
    0,
    ...forecast.rates.matrix
      .flat()
      .filter((cell) => cell.supported)
      .map((cell) => cell.p),
  );

  return (
    <div className="h-full overflow-auto pb-2">
      <div
        className="min-w-[58rem]"
        aria-hidden="true"
        data-testid="departure-heatmap-grid"
      >
        <div className="grid grid-cols-[5rem_repeat(24,minmax(2rem,1fr))] gap-1">
          <Text as="span" variant="caption">
            {t('departure.heatmap.localHour', 'Local hour')}
          </Text>
          {Array.from({ length: 24 }, (_, hour) => (
            <Text
              key={hour}
              as="span"
              variant="caption"
              className="text-center"
            >
              {String(hour).padStart(2, '0')}
            </Text>
          ))}
        </div>
        <div className="mt-1 space-y-1">
          {forecast.weekdayProfiles.map((profile) => (
            <div
              key={profile.weekday}
              className={cn(
                'grid grid-cols-[5rem_repeat(24,minmax(2rem,1fr))] gap-1',
                !profile.supported && 'opacity-60',
              )}
            >
              <div className="flex min-w-0 flex-col justify-center">
                <Text as="span" variant="caption" className="truncate">
                  {departureWeekdayShortLabel(t, profile.weekday)}
                </Text>
                {!profile.supported ? (
                  <Text as="span" variant="helper" className="truncate">
                    {t(
                      'departure.heatmap.unsupportedDayShort',
                      'No events',
                    )}
                  </Text>
                ) : null}
              </div>
              {forecast.rates.matrix[profile.weekday]!.map((cell) => {
                const hourLabel = `${String(cell.hour).padStart(2, '0')}:00`;
                const title = cell.supported
                  ? t(
                      'departure.heatmap.cellTitle',
                      '{{day}} {{hour}}: {{likelihood}}% modeled likelihood from {{departures}} departures across {{occurrences}} cell occurrences',
                      {
                        day: departureWeekdayShortLabel(
                          t,
                          profile.weekday,
                        ),
                        hour: hourLabel,
                        likelihood: fmtNumber(cell.p * 100, 1, locale),
                        departures: fmtInt(cell.departures),
                        occurrences: fmtInt(cell.occurrences),
                      },
                    )
                  : t(
                      'departure.heatmap.unsupportedCellTitle',
                      '{{day}} {{hour}}: no recorded departures in this returned cell',
                      {
                        day: departureWeekdayShortLabel(
                          t,
                          profile.weekday,
                        ),
                        hour: hourLabel,
                      },
                    );
                return (
                  <div
                    key={cell.hour}
                    title={title}
                    className={cn(
                      'flex h-9 items-center justify-center rounded-md border',
                      cellClass(cell, maximum),
                    )}
                  >
                    <Text as="span" variant="caption">
                      {cell.supported ? fmtInt(cell.departures) : '·'}
                    </Text>
                  </div>
                );
              })}
            </div>
          ))}
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Badge variant="info">
            {t(
              'departure.heatmap.legendObserved',
              'Number = recorded departures',
            )}
          </Badge>
          <Badge variant="neutral">
            {t(
              'departure.heatmap.legendUnsupported',
              'Dot = no recorded departure support',
            )}
          </Badge>
          <Text as="span" variant="caption">
            {t(
              'departure.heatmap.legendIntensity',
              'Color intensity follows supported modeled likelihood.',
            )}
          </Text>
        </div>
      </div>
    </div>
  );
}
