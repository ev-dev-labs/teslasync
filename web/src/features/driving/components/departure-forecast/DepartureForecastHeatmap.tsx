import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { ChartContainer } from '@/components/charts';
import type { DepartureForecast } from '../../lib/departureForecast';
import { DepartureForecastHeatmapGrid } from './DepartureForecastHeatmapGrid';
import { DepartureForecastSectionBody } from './DepartureForecastSectionBody';
import { departureWeekdayShortLabel } from './labels';
import type { DepartureForecastQueryState } from './types';

interface DepartureForecastHeatmapProps {
  forecast: DepartureForecast;
  state: DepartureForecastQueryState;
  locale: string;
}

export function DepartureForecastHeatmap({
  forecast,
  state,
  locale,
}: DepartureForecastHeatmapProps) {
  const { t } = useTranslation();
  const rows = useMemo(
    () =>
      forecast.rates.matrix.flatMap((weekday) =>
        weekday.map((cell) => ({
          weekday: departureWeekdayShortLabel(t, cell.weekday),
          hour: `${String(cell.hour).padStart(2, '0')}:00`,
          departures: cell.departures,
          occurrences: cell.occurrences,
          likelihood: cell.supported
            ? Math.round(cell.p * 1_000) / 10
            : null,
          support: cell.supported
            ? t('departure.heatmap.supported', 'Supported')
            : t('departure.heatmap.unsupported', 'No recorded departures'),
        })),
      ),
    [forecast.rates.matrix, t],
  );
  const ready =
    state.isResolved && !state.error && forecast.totalDepartures > 0;

  return (
    <section data-testid="departure-heatmap">
      <ChartContainer
        title={t(
          'departure.heatmap.title',
          'Learned weekday-hour profile',
        )}
        subtitle={t(
          'departure.heatmap.subtitle',
          'A 7×24 vehicle-timezone matrix; unsupported cells and entire weekdays remain visibly distinct from learned routines.',
        )}
        ariaLabel={t(
          'departure.heatmap.aria',
          'Seven-day by 24-hour heatmap of supported recorded departures and modeled likelihood',
        )}
        ariaDescription={t(
          'departure.heatmap.description',
          'Cell numbers are recorded drive starts. Empty cells are not presented as learned routines.',
        )}
        height={420}
        exportable={ready}
        exportFilename="departure-forecast-heatmap"
        data={ready ? rows : []}
        dataColumns={[
          {
            key: 'weekday',
            label: t('departure.heatmap.column.weekday', 'Weekday'),
          },
          {
            key: 'hour',
            label: t('departure.heatmap.column.hour', 'Local hour'),
          },
          {
            key: 'departures',
            label: t(
              'departure.heatmap.column.departures',
              'Recorded departures',
            ),
          },
          {
            key: 'occurrences',
            label: t(
              'departure.heatmap.column.occurrences',
              'Cell occurrences',
            ),
          },
          {
            key: 'likelihood',
            label: t(
              'departure.heatmap.column.likelihood',
              'Modeled likelihood (%)',
            ),
          },
          {
            key: 'support',
            label: t('departure.heatmap.column.support', 'Support'),
          },
        ]}
      >
        <DepartureForecastSectionBody
          forecast={forecast}
          state={state}
          className="h-full min-h-0"
          skeletonHeight={380}
        >
          <DepartureForecastHeatmapGrid
            forecast={forecast}
            locale={locale}
          />
        </DepartureForecastSectionBody>
      </ChartContainer>
    </section>
  );
}
