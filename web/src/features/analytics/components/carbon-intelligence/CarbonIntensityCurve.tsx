import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import {
  Area,
  AreaChart,
  ChartContainer,
  ChartGradient,
  ChartTooltip,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  axisTick,
  chartGrid,
} from '@/components/charts';
import { EmptyState } from '@/components/feedback';
import { CarbonSectionBody } from './CarbonSectionBody';
import type { CarbonSectionProps } from './types';

const COLOR_CURVE = '#2dd4bf';
const COLOR_CLEAN = '#10b981';
const COLOR_DIRTY = '#f43f5e';

export function CarbonIntensityCurve({
  analysis,
  states,
  display,
}: CarbonSectionProps) {
  const { t } = useTranslation();
  const rows = analysis.curve.rows;
  const exportRows = useMemo(
    () => rows.map((row) => ({
      backend_model_hour: row.hour,
      intensity_g_co2_per_kwh: row.intensityGPerKwh,
      rank: row.rank,
      band: row.band,
    })),
    [rows],
  );
  const accessibilityRows = useMemo(
    () => rows.map((row) => ({
      hour: row.hour,
      intensityGPerKwh: row.intensityGPerKwh,
      rank: row.rank,
    })),
    [rows],
  );

  return (
    <section
      data-testid="carbon-intensity-curve"
      aria-label={t(
        'carbon.curve.sectionAria',
        'Built-in hourly grid intensity model curve',
      )}
    >
      <ChartContainer
        title={t('carbon.curve.title', '24-hour grid intensity curve')}
        subtitle={t(
          'carbon.curve.subtitle',
          'Static built-in model by backend/model clock-hour — not a live grid signal',
        )}
        ariaLabel={t(
          'carbon.curve.aria',
          'Static 24-hour grid carbon intensity model with derived cleanest and dirtiest hours',
        )}
        ariaDescription={t(
          'carbon.curve.description',
          'Hours use the backend model clock because the attribution endpoint does not expose its timezone.',
        )}
        exportable
        exportFilename="carbon-intensity-model"
        exportData={exportRows}
        data={accessibilityRows}
        dataColumns={[
          {
            key: 'hour',
            label: t('carbon.curve.hourColumn', 'Backend/model clock-hour'),
            format: (value) => display.formatHour(
              typeof value === 'number' ? value : null,
            ),
          },
          {
            key: 'intensityGPerKwh',
            label: t('carbon.curve.intensityColumn', 'Grid intensity'),
            format: (value) => display.formatIntensity(
              typeof value === 'number' ? value : null,
            ),
          },
          {
            key: 'rank',
            label: t('carbon.curve.rankColumn', 'Cleanest rank'),
            format: (value) => display.formatNumber(
              typeof value === 'number' ? value : null,
              0,
            ),
          },
        ]}
        height={360}
      >
        <CarbonSectionBody state={states.intensity} skeletonHeight={320}>
          {rows.length > 0 ? (
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart
                data={rows}
                margin={{ top: 12, right: 16, bottom: 4, left: 4 }}
              >
                <defs>
                  <ChartGradient
                    id="carbon-intensity-model-gradient"
                    color={COLOR_CURVE}
                    opacity={0.4}
                  />
                </defs>
                {chartGrid}
                <XAxis
                  dataKey="hour"
                  type="number"
                  domain={[0, 23]}
                  ticks={[0, 3, 6, 9, 12, 15, 18, 21]}
                  allowDecimals={false}
                  tickFormatter={(hour: number) => display.formatHour(hour)}
                  tick={axisTick}
                  tickLine={false}
                  axisLine={false}
                />
                <YAxis
                  width={48}
                  tick={axisTick}
                  tickLine={false}
                  axisLine={false}
                  tickFormatter={(value: number) => display.formatNumber(value, 0)}
                />
                <Tooltip
                  content={(
                    <ChartTooltip
                      labelFormatter={(label) => display.formatHour(Number(label))}
                      valueFormatter={(value) =>
                        display.formatIntensity(Number(value))}
                    />
                  )}
                />
                {analysis.curve.stats.greenestHours.map((hour) => (
                  <ReferenceLine
                    key={`clean-${hour}`}
                    x={hour}
                    stroke={COLOR_CLEAN}
                    strokeDasharray="4 3"
                    strokeOpacity={0.8}
                  />
                ))}
                {analysis.curve.stats.dirtiestHours.map((hour) => (
                  <ReferenceLine
                    key={`dirty-${hour}`}
                    x={hour}
                    stroke={COLOR_DIRTY}
                    strokeDasharray="4 3"
                    strokeOpacity={0.8}
                  />
                ))}
                <Area
                  type="monotone"
                  dataKey="intensityGPerKwh"
                  name={t('carbon.curve.series', 'Grid intensity')}
                  stroke={COLOR_CURVE}
                  fill="url(#carbon-intensity-model-gradient)"
                  strokeWidth={2}
                />
              </AreaChart>
            </ResponsiveContainer>
          ) : (
            <EmptyState
              message={t(
                'carbon.curve.empty',
                'No valid hourly intensity rows are available.',
              )}
            />
          )}
        </CarbonSectionBody>
      </ChartContainer>
    </section>
  );
}
