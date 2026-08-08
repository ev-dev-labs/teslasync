import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { ChartContainer } from '@/components/charts';
import type { RangeBufferResult } from '../../lib/rangeBuffer';
import { rangeBufferMonthLabel } from './labels';
import {
  RangeBufferPercentileChart,
  type RangeBufferProfileChartRow,
} from './RangeBufferPercentileChart';
import { RangeBufferSectionBody } from './RangeBufferSectionBody';
import type { RangeBufferQueryState } from './types';

interface RangeBufferMonthTrendProps {
  result: RangeBufferResult;
  state: RangeBufferQueryState;
  locale: string;
}

export function RangeBufferMonthTrend({
  result,
  state,
  locale,
}: RangeBufferMonthTrendProps) {
  const { t } = useTranslation();
  const rows = useMemo<RangeBufferProfileChartRow[]>(
    () =>
      result.monthTrend.map((point) => ({
        key: point.monthKey,
        label: rangeBufferMonthLabel(point.monthKey, locale),
        samples: point.samples,
        p10Pct: point.p10Pct,
        medianPct: point.medianPct,
        p90Pct: point.p90Pct,
      })),
    [locale, result.monthTrend],
  );

  return (
    <section data-testid="range-buffer-month-trend">
      <ChartContainer
        title={t(
          'rangeBuffer.month.title',
          'Vehicle-local monthly arrival bands',
        )}
        subtitle={t(
          'rangeBuffer.month.subtitle',
          'Observed p10, median, p90, and sample count for up to the latest 24 returned months.',
        )}
        ariaLabel={t(
          'rangeBuffer.month.aria',
          'Monthly chart of observed arrival battery percentiles and included drive counts',
        )}
        height={300}
        loading={state.isLoading}
        empty={false}
        chartKey="range-buffer-month-trend"
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
            label: t('rangeBuffer.columns.month', 'Local month'),
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
