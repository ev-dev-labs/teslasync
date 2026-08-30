import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import {
  Bar,
  BarChart,
  CartesianGrid,
  ChartContainer,
  ChartTooltip,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  axisTick,
} from '@/components/charts';
import { chartTokens } from '@/lib/tokens';
import type { PackCapacityResult } from '../../lib/packCapacity';
import { PackCapacitySectionBody } from './PackCapacitySectionBody';
import type { PackCapacityQueryState } from './types';

interface PackCapacityInnovationProfileProps {
  result: PackCapacityResult;
  state: PackCapacityQueryState;
}

export function PackCapacityInnovationProfile({
  result,
  state,
}: PackCapacityInnovationProfileProps) {
  const { t } = useTranslation();
  const labels = {
    below_minus_two: t(
      'packCapacity.innovation.belowMinusTwo',
      'Below -2 sigma',
    ),
    minus_two_to_minus_one: t(
      'packCapacity.innovation.minusTwoToMinusOne',
      '-2 to -1 sigma',
    ),
    minus_one_to_one: t(
      'packCapacity.innovation.minusOneToOne',
      '-1 to +1 sigma',
    ),
    one_to_two: t(
      'packCapacity.innovation.oneToTwo',
      '+1 to +2 sigma',
    ),
    above_two: t(
      'packCapacity.innovation.aboveTwo',
      'Above +2 sigma',
    ),
  };
  const rows = useMemo(
    () =>
      result.innovationProfile.map((point) => ({
        band: labels[point.band],
        samples: point.samples,
        share: point.share == null ? null : point.share * 100,
      })),
    [labels, result.innovationProfile],
  );

  return (
    <section data-testid="pack-capacity-innovation-profile">
      <ChartContainer
        title={t(
          'packCapacity.innovation.title',
          'Standardized innovation distribution',
        )}
        subtitle={t(
          'packCapacity.innovation.subtitle',
          'Pre-update measurement departures divided by combined prior and measurement uncertainty.',
        )}
        ariaLabel={t(
          'packCapacity.innovation.aria',
          'Distribution of standardized filter innovations',
        )}
        size="standard"
        loading={state.isLoading}
        empty={false}
        exportable={state.isResolved && !state.error}
        exportData={rows}
        data={rows}
        dataColumns={[
          { key: 'band', label: t('packCapacity.columns.band', 'Innovation band') },
          { key: 'samples', label: t('packCapacity.series.samples', 'Qualified samples') },
          { key: 'share', label: t('packCapacity.columns.share', 'Share (%)') },
        ]}
      >
        <PackCapacitySectionBody
          result={result}
          state={state}
          className="h-full"
        >
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={rows}>
              <CartesianGrid
                strokeDasharray="3 3"
                stroke="var(--glass-border)"
                strokeOpacity={0.4}
              />
              <XAxis
                dataKey="band"
                tick={axisTick}
                tickLine={false}
                axisLine={false}
              />
              <YAxis
                tick={axisTick}
                tickLine={false}
                axisLine={false}
                allowDecimals={false}
              />
              <Tooltip content={<ChartTooltip />} />
              <Bar
                dataKey="samples"
                name={t('packCapacity.series.samples', 'Samples')}
                fill={chartTokens.series[4]}
                fillOpacity={0.72}
                radius={[4, 4, 0, 0]}
              />
            </BarChart>
          </ResponsiveContainer>
        </PackCapacitySectionBody>
      </ChartContainer>
    </section>
  );
}
