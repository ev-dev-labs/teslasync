import { Thermometer } from 'lucide-react';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import {
  CartesianGrid, ChartContainer, ChartLegend, ChartTooltip, CHART_COLORS,
  ReferenceLine, ResponsiveContainer, Scatter, ScatterChart, Tooltip, XAxis,
  YAxis, ZAxis, axisTick,
} from '@/components/charts';
import { EmptyState, QueryError } from '@/components/feedback';
import { formatDate } from '@/lib/dateFormat';
import { fmtNumber } from '@/lib/numberFormat';
import { convertDistanceFromSI, convertTempFromSI } from '@/lib/unitConversion';

import type { TemperatureEvidence } from '../../lib/coldStart';
import type { ColdStartSectionState } from './types';
import { useColdStartDisplay } from './useColdStartDisplay';

interface TemperatureEfficiencyChartProps {
  points: TemperatureEvidence[];
  state: ColdStartSectionState;
  className?: string;
}

/** Outside-temperature scatter, colored by parking-gap classification. */
export function TemperatureEfficiencyChart({ points, state, className }: TemperatureEfficiencyChartProps) {
  const { t } = useTranslation();
  const { convertEfficiency, efficiencyUnit, unitPrefs } = useColdStartDisplay();
  const rows = useMemo(
    () =>
      points.map((point) => ({
        date: formatDate(point.startTs, { locale: unitPrefs.locale }),
        classification: point.classification,
        group:
          point.classification === 'cold'
            ? t('coldStart.temperature.cold', 'Cold')
            : t('coldStart.temperature.warm', 'Warm'),
        temperature: Math.round(
          convertTempFromSI(point.outsideTempAvgC, unitPrefs.temperature) * 10,
        ) / 10,
        consumption: Math.round(convertEfficiency(point.whPerKm) * 10) / 10,
        distance: Math.round(
          convertDistanceFromSI(point.distanceM, unitPrefs.distance) * 10,
        ) / 10,
      })),
    [
      convertEfficiency,
      points,
      t,
      unitPrefs.distance,
      unitPrefs.locale,
      unitPrefs.temperature,
    ],
  );
  const coldRows = rows.filter((row) => row.classification === 'cold');
  const warmRows = rows.filter((row) => row.classification === 'warm');
  const hasData = rows.length > 0;
  const coldName = t('coldStart.temperature.coldSeries', 'Cold starts');
  const warmName = t('coldStart.temperature.warmSeries', 'Warm starts');
  const temperatureName = t('coldStart.temperature.temperature', 'Outside temperature');
  const consumptionName = t('coldStart.temperature.consumption', 'Consumption');
  const distanceName = t('coldStart.temperature.distance', 'Distance');

  return (
    <section
      className={className}
      aria-label={t('coldStart.sections.temperature', 'Temperature and consumption evidence')}
      data-testid="cold-start-temperature"
    >
      <ChartContainer
        className="h-full"
        title={t('coldStart.temperature.title', 'Temperature vs consumption')}
        subtitle={t(
          'coldStart.temperature.subtitle',
          '{{cold}} cold and {{warm}} warm drives with outside-temperature readings; marker size follows distance.',
          { cold: coldRows.length, warm: warmRows.length },
        )}
        ariaLabel={t(
          'coldStart.temperature.aria',
          'Scatter plot of outside temperature against consumption, split into cold and warm starts',
        )}
        loading={state.isLoading}
        height={350}
        chartKey="cold-start-temperature"
        exportable={!state.error && !state.isLoading && hasData}
        exportFilename="cold-start-temperature"
        data={state.error ? [] : rows}
        dataColumns={[
          { key: 'date', label: t('coldStart.temperature.date', 'Date') },
          { key: 'group', label: t('coldStart.temperature.group', 'Group') },
          {
            key: 'temperature',
            label: `${temperatureName} (${unitPrefs.temperature})`,
            format: (value) => fmtNumber(value, 1),
          },
          {
            key: 'consumption',
            label: `${consumptionName} (${efficiencyUnit})`,
            format: (value) => fmtNumber(value, 1),
          },
          {
            key: 'distance',
            label: `${distanceName} (${unitPrefs.distance})`,
            format: (value) => fmtNumber(value, 1),
          },
        ]}
      >
        {({ hiddenSeries }) =>
          state.error ? (
            <div className="flex h-full items-center justify-center">
              <QueryError error={state.error} onRetry={state.onRetry} />
            </div>
          ) : !hasData ? (
            <EmptyState /* no-action: temperature evidence depends on recorded drive readings. */
              className="h-full"
              icon={<Thermometer className="h-8 w-8" aria-hidden="true" />}
              message={t(
                'coldStart.temperature.empty',
                'No classified drives in this window include a usable outside-temperature reading.',
              )}
            />
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <ScatterChart margin={{ top: 12, right: 12, left: 0, bottom: 4 }}>
                <CartesianGrid
                  strokeDasharray="3 3"
                  stroke="var(--glass-border)"
                  strokeOpacity={0.4}
                />
                <XAxis
                  type="number"
                  dataKey="temperature"
                  name={temperatureName}
                  unit={unitPrefs.temperature}
                  tick={axisTick}
                  tickLine={false}
                  axisLine={false}
                />
                <YAxis
                  type="number"
                  dataKey="consumption"
                  name={consumptionName}
                  unit={` ${efficiencyUnit}`}
                  tick={axisTick}
                  tickLine={false}
                  axisLine={false}
                  width={62}
                />
                <ZAxis
                  type="number"
                  dataKey="distance"
                  name={distanceName}
                  range={[45, 190]}
                />
                <ReferenceLine
                  x={convertTempFromSI(0, unitPrefs.temperature)}
                  stroke={CHART_COLORS[4]}
                  strokeDasharray="4 4"
                  strokeOpacity={0.65}
                />
                <Tooltip
                  content={
                    <ChartTooltip
                      valueFormatter={(value, name) =>
                        name === temperatureName
                          ? `${fmtNumber(value, 1)}${unitPrefs.temperature}`
                          : name === distanceName
                            ? `${fmtNumber(value, 1)} ${unitPrefs.distance}`
                            : `${fmtNumber(value, 1)} ${efficiencyUnit}`
                      }
                    />
                  }
                />
                <ChartLegend verticalAlign="top" align="right" />
                <Scatter
                  name={coldName}
                  data={coldRows}
                  fill={CHART_COLORS[0]}
                  fillOpacity={0.78}
                  hide={hiddenSeries?.isHidden(coldName) ?? false}
                />
                <Scatter
                  name={warmName}
                  data={warmRows}
                  fill={CHART_COLORS[1]}
                  fillOpacity={0.78}
                  hide={hiddenSeries?.isHidden(warmName) ?? false}
                />
              </ScatterChart>
            </ResponsiveContainer>
          )
        }
      </ChartContainer>
    </section>
  );
}
