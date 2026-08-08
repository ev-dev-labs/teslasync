import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { ChartContainer } from '@/components/charts';
import type { RangeBufferResult } from '../../lib/rangeBuffer';
import { rangeBufferWeekdayLabel } from './labels';
import {
  RangeBufferPercentileChart,
  type RangeBufferProfileChartRow,
} from './RangeBufferPercentileChart';
import { RangeBufferSectionBody } from './RangeBufferSectionBody';
import type { RangeBufferQueryState } from './types';

interface RangeBufferWeekdayProfileProps {
  result: RangeBufferResult;
  state: RangeBufferQueryState;
  timeZone: string;
}

export function RangeBufferWeekdayProfile({
  result,
  state,
  timeZone,
}: RangeBufferWeekdayProfileProps) {
  const { t } = useTranslation();
  const rows = useMemo<RangeBufferProfileChartRow[]>(
    () =>
      result.weekdayProfile.map((point) => ({
        key: String(point.weekday),
        label: rangeBufferWeekdayLabel(t, point.weekday),
        samples: point.samples,
        p10Pct: point.p10Pct,
        medianPct: point.medianPct,
        p90Pct: point.p90Pct,
      })),
    [result.weekdayProfile, t],
  );

  return (
    <section data-testid="range-buffer-weekday-profile">
      <ChartContainer
        title={t(
          'rangeBuffer.weekday.title',
          'Arrival buffer by local weekday',
        )}
        subtitle={t(
          'rangeBuffer.weekday.subtitle',
          'Drive-weighted arrival percentiles in {{timeZone}}; unequal sample counts remain visible.',
          { timeZone },
        )}
        ariaLabel={t(
          'rangeBuffer.weekday.aria',
          'Weekday chart of arrival battery percentiles and drive counts',
        )}
        height={300}
        loading={state.isLoading}
        empty={false}
        chartKey="range-buffer-weekday-profile"
        exportable={
          state.isResolved
          && !state.error
          && result.accounting.includedRows > 0
        }
        exportData={rows}
        data={rows}
        dataColumns={[
          {
            key: 'label',
            label: t('rangeBuffer.columns.weekday', 'Local weekday'),
          },
          {
            key: 'samples',
            label: t('rangeBuffer.columns.arrivals', 'Arrivals'),
          },
          {
            key: 'p10Pct',
            label: t('rangeBuffer.columns.p10Pct', 'p10 arrival (%)'),
          },
          {
            key: 'medianPct',
            label: t('rangeBuffer.columns.medianPct', 'Median arrival (%)'),
          },
          {
            key: 'p90Pct',
            label: t('rangeBuffer.columns.p90Pct', 'p90 arrival (%)'),
          },
        ]}
      >
        {({ hiddenSeries }) => (
          <RangeBufferSectionBody
            result={result}
            state={state}
            className="h-full"
          >
            <RangeBufferPercentileChart
              rows={rows}
              samplesName={t('rangeBuffer.series.arrivals', 'Arrivals')}
              p10Name={t('rangeBuffer.series.p10', 'p10 arrival')}
              medianName={t(
                'rangeBuffer.series.median',
                'Median arrival',
              )}
              p90Name={t('rangeBuffer.series.p90', 'p90 arrival')}
              hiddenSeries={hiddenSeries}
            />
          </RangeBufferSectionBody>
        )}
      </ChartContainer>
    </section>
  );
}
