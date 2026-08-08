import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { ChartContainer } from '@/components/charts';
import type { DepartureForecast } from '../../lib/departureForecast';
import { DepartureForecastNext24Plot } from './DepartureForecastNext24Plot';
import { DepartureForecastSectionBody } from './DepartureForecastSectionBody';
import { departureChartLabel } from './labels';
import type { DepartureForecastQueryState } from './types';

interface DepartureForecastNext24ChartProps {
  forecast: DepartureForecast;
  state: DepartureForecastQueryState;
  locale: string;
  timeZone: string;
}

export function DepartureForecastNext24Chart({
  forecast,
  state,
  locale,
  timeZone,
}: DepartureForecastNext24ChartProps) {
  const { t } = useTranslation();
  const likelihoodName = t(
    'departure.next24.likelihoodSeries',
    'Hourly modeled likelihood',
  );
  const cumulativeName = t(
    'departure.next24.cumulativeSeries',
    'Cumulative modeled likelihood',
  );
  const rows = useMemo(
    () =>
      forecast.slots.map((slot) => ({
        slotId: slot.startMs,
        slot: departureChartLabel(slot.startMs, locale, timeZone),
        likelihood: Math.round(slot.p * 1_000) / 10,
        cumulative: Math.round(slot.cumulative * 1_000) / 10,
        departures: slot.historicalDepartures,
        occurrences: slot.cellOccurrences,
        support:
          slot.historicalDepartures > 0
            ? t('departure.next24.supported', 'Recorded departures')
            : t('departure.next24.shrunk', 'Prior-shrunk cell'),
        isPeak: forecast.peak?.startMs === slot.startMs,
      })),
    [forecast.peak?.startMs, forecast.slots, locale, t, timeZone],
  );
  const tableRows = useMemo(
    () =>
      rows.map((row) => ({
        slot: row.slot,
        likelihood: row.likelihood,
        cumulative: row.cumulative,
        departures: row.departures,
        occurrences: row.occurrences,
        support: row.support,
      })),
    [rows],
  );
  const ready =
    state.isResolved && !state.error && forecast.totalDepartures > 0;

  return (
    <section data-testid="departure-next-24">
      <ChartContainer
        title={t(
          'departure.next24.title',
          'Modeled likelihood — next 24 local hours',
        )}
        subtitle={t(
          'departure.next24.subtitle',
          'Bars are hourly Gamma-Poisson estimates; the line accumulates modeled likelihood across real vehicle-timezone boundaries.',
        )}
        ariaLabel={t(
          'departure.next24.aria',
          'Hourly and cumulative modeled departure likelihood across the next 24 vehicle-timezone hour boundaries',
        )}
        ariaDescription={t(
          'departure.next24.description',
          'These estimates describe the returned drive-start pattern and are not calibrated probabilities or guarantees.',
        )}
        height={360}
        chartKey="departure-forecast-next-24"
        exportable={ready}
        exportFilename="departure-forecast-next-24"
        data={ready ? tableRows : []}
        dataColumns={[
          {
            key: 'slot',
            label: t('departure.next24.column.slot', 'Local slot'),
          },
          {
            key: 'likelihood',
            label: t(
              'departure.next24.column.likelihood',
              'Modeled likelihood (%)',
            ),
          },
          {
            key: 'cumulative',
            label: t(
              'departure.next24.column.cumulative',
              'Cumulative estimate (%)',
            ),
          },
          {
            key: 'departures',
            label: t(
              'departure.next24.column.departures',
              'Historical departures',
            ),
          },
          {
            key: 'occurrences',
            label: t(
              'departure.next24.column.occurrences',
              'Cell occurrences',
            ),
          },
          {
            key: 'support',
            label: t('departure.next24.column.support', 'Cell support'),
          },
        ]}
      >
        {({ hiddenSeries }) => (
          <DepartureForecastSectionBody
            forecast={forecast}
            state={state}
            className="h-full min-h-0"
            skeletonHeight={320}
          >
            <DepartureForecastNext24Plot
              rows={rows}
              likelihoodName={likelihoodName}
              cumulativeName={cumulativeName}
              locale={locale}
              hiddenSeries={hiddenSeries}
            />
          </DepartureForecastSectionBody>
        )}
      </ChartContainer>
    </section>
  );
}
