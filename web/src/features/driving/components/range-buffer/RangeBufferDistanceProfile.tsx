import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { ChartContainer } from '@/components/charts';
import type { RangeBufferResult } from '../../lib/rangeBuffer';
import {
  RangeBufferPercentileChart,
  type RangeBufferProfileChartRow,
} from './RangeBufferPercentileChart';
import { RangeBufferSectionBody } from './RangeBufferSectionBody';
import type {
  RangeBufferDistanceFormatter,
  RangeBufferQueryState,
} from './types';

interface RangeBufferDistanceProfileProps {
  result: RangeBufferResult;
  state: RangeBufferQueryState;
  formatDistance: RangeBufferDistanceFormatter;
}

export function RangeBufferDistanceProfile({
  result,
  state,
  formatDistance,
}: RangeBufferDistanceProfileProps) {
  const { t } = useTranslation();
  const rows = useMemo<RangeBufferProfileChartRow[]>(
    () =>
      result.distanceProfile.map((point) => ({
        key: `${point.fromM}-${point.toM ?? 'max'}`,
        label:
          point.toM == null
            ? `${formatDistance(point.fromM, { precision: 0 })}+`
            : `${formatDistance(point.fromM, { precision: 0 })}-${formatDistance(point.toM, { precision: 0 })}`,
        samples: point.samples,
        p10Pct: point.p10Pct,
        medianPct: point.medianPct,
        p90Pct: point.p90Pct,
        contextPct: point.medianDropPct,
      })),
    [formatDistance, result.distanceProfile],
  );

  return (
    <section data-testid="range-buffer-distance-profile">
      <ChartContainer
        title={t(
          'rangeBuffer.distanceProfile.title',
          'Arrival buffer by drive distance',
        )}
        subtitle={t(
          'rangeBuffer.distanceProfile.subtitle',
          'Fixed SI distance bands converted only at display; association does not establish cause.',
        )}
        ariaLabel={t(
          'rangeBuffer.distanceProfile.aria',
          'Distance-band chart of arrival battery percentiles and drive counts',
        )}
        height={300}
        loading={state.isLoading}
        empty={false}
        chartKey="range-buffer-distance-profile"
        exportable={
          state.isResolved
          && !state.error
          && result.driveContext.distanceRows > 0
        }
        exportData={rows}
        data={rows}
        dataColumns={[
          {
            key: 'label',
            label: t('rangeBuffer.columns.distanceBand', 'Distance band'),
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
          {
            key: 'contextPct',
            label: t(
              'rangeBuffer.columns.medianDropPct',
              'Median drive drop (%)',
            ),
          },
        ]}
      >
        {({ hiddenSeries }) => (
          <RangeBufferSectionBody
            result={result}
            state={state}
            requirement="distance"
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
              contextName={t(
                'rangeBuffer.series.medianDrop',
                'Median drive drop',
              )}
              hiddenSeries={hiddenSeries}
            />
          </RangeBufferSectionBody>
        )}
      </ChartContainer>
    </section>
  );
}
