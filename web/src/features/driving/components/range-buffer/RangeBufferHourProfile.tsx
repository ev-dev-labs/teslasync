import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { ChartContainer } from '@/components/charts';
import type { RangeBufferResult } from '../../lib/rangeBuffer';
import { rangeBufferHourLabel } from './labels';
import {
  RangeBufferPercentileChart,
  type RangeBufferProfileChartRow,
} from './RangeBufferPercentileChart';
import { RangeBufferSectionBody } from './RangeBufferSectionBody';
import type { RangeBufferQueryState } from './types';

interface RangeBufferHourProfileProps {
  result: RangeBufferResult;
  state: RangeBufferQueryState;
  timeZone: string;
}

export function RangeBufferHourProfile({
  result,
  state,
  timeZone,
}: RangeBufferHourProfileProps) {
  const { t } = useTranslation();
  const rows = useMemo<RangeBufferProfileChartRow[]>(
    () =>
      result.hourProfile.map((point) => ({
        key: String(point.bucketStartHour),
        label: rangeBufferHourLabel(point.bucketStartHour),
        samples: point.samples,
        p10Pct: point.p10Pct,
        medianPct: point.medianPct,
        p90Pct: point.p90Pct,
      })),
    [result.hourProfile],
  );

  return (
    <section data-testid="range-buffer-hour-profile">
      <ChartContainer
        title={t(
          'rangeBuffer.hour.title',
          'Arrival buffer by local completion time',
        )}
        subtitle={t(
          'rangeBuffer.hour.subtitle',
          'Four-hour completion windows in {{timeZone}}; each drive is one observation.',
          { timeZone },
        )}
        ariaLabel={t(
          'rangeBuffer.hour.aria',
          'Local completion-time chart of arrival battery percentiles and drive counts',
        )}
        height={300}
        loading={state.isLoading}
        empty={false}
        chartKey="range-buffer-hour-profile"
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
            label: t('rangeBuffer.columns.hourWindow', 'Local time window'),
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
