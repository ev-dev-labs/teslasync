import { Fragment } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ChartTooltip, renderAnnotationLines, AREA_DEFAULTS, areaGradient, chartGrid,
  AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer,
} from '@/components/charts';
import { Text } from '@/components/ui';
import { getChartFontFamily, getChartFontSize } from '@/lib/chartTypography';
import { chartTokens } from '@/lib/tokens';
import { getEfficiency } from '@/lib/drivesAggregation';
import { EfficiencyChart } from './EfficiencyChart';
import type { DrivesPresentation } from './types';

const endpointStroke = chartTokens.series[0];
const endpointFill = (last: boolean) => last ? endpointStroke : 'var(--surface-1)';

export function EfficiencyTrend({ model, source, units, selectedVehicleId }: DrivesPresentation & { selectedVehicleId: number | null }) {
  const { t } = useTranslation();
  const efficiencyUnit = units.unitPrefs.distance === 'mi' ? 'Wh/mi' : 'Wh/km';
  const { dailyTrend, filteredDrives } = model;
  const lastIndex = dailyTrend.length - 1;
  const hasTrend = dailyTrend.length >= 3;
  const showKey = hasTrend && source.state.hasData && !source.state.fatalError && !source.malformed;
  const eligibleCount = filteredDrives.filter(drive => getEfficiency(drive) !== null).length;
  const chartText = {
    fill: chartTokens.axisStroke,
    fontFamily: getChartFontFamily(),
    fontSize: getChartFontSize(12),
  };
  return <EfficiencyChart source={source}
    title={t('efficiency.perDriveTrend', { unit: efficiencyUnit, defaultValue: 'Per-drive efficiency ({{unit}})' })}
    ariaLabel={t('efficiency.perDriveTrendAria', 'Per-drive efficiency subset area chart')}
    subtitle={t('efficiency.perDriveTrendContext', 'Up to 30 eligible drive observations in reverse source order; not daily averages.')}
    metadata={{
      sourceLabel: t('efficiency.perDriveTrendCounts', {
        shown: dailyTrend.length, eligible: eligibleCount, loaded: filteredDrives.length,
        defaultValue: 'Showing {{shown}} of {{eligible}} eligible drives from {{loaded}} range-filtered loaded drives.',
      }),
      unitLabel: efficiencyUnit,
    }}
    data={dailyTrend}
    dataColumns={[
      { key: 'date', label: t('efficiency.col.date', 'Date') },
      { key: 'efficiency', label: t('efficiency.chartColumns.driveEfficiency', 'Drive energy consumption ({{unit}})', { unit: efficiencyUnit }), kind: 'measurement' },
      { key: 'distance', label: t('efficiency.chartColumns.driveDistance', 'Drive distance ({{unit}})', { unit: units.unitPrefs.distance }), kind: 'measurement' },
    ]}
    empty={!hasTrend}
    footer={showKey ? (
      <ul className="flex flex-wrap gap-x-4 gap-y-1 forced-colors:hidden">
        {[
          { end: 'first', label: t('efficiency.perDriveTrendFirstSample', 'First sample') },
          { end: 'last', label: t('efficiency.perDriveTrendLastSample', 'Last sample') },
        ].map(({ end, label }) => (
          <li key={end} className="flex min-w-0 items-center gap-2">
            <svg aria-hidden="true" className="size-3 shrink-0" viewBox="0 0 12 12">
              <circle cx={6} cy={6} r={4} fill={endpointFill(end === 'last')} stroke={endpointStroke} strokeWidth={2} />
            </svg>
            <Text variant="caption" className="[overflow-wrap:anywhere]">{label}</Text>
          </li>
        ))}
      </ul>
    ) : undefined}
    annotations={{ vehicleId: selectedVehicleId, scope: 'efficiency', chartId: 'efficiency-daily-trend' }}>
    {({ annotations: chartAnnotations }) => (
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={dailyTrend}>
          {areaGradient('effGrad', chartTokens.series[0], 0.08)}
          {chartGrid}
          <XAxis dataKey="date" tick={chartText} />
          <YAxis tick={chartText} />
          <Tooltip content={<ChartTooltip />} />
          {renderAnnotationLines(chartAnnotations, ts => ts)}
          <Area {...AREA_DEFAULTS} dataKey="efficiency" stroke={endpointStroke} fill="url(#effGrad)" name={efficiencyUnit}
            dot={({ index, cx, cy }: { index: number; cx: number; cy: number }) =>
              (index === 0 || index === lastIndex) && Number.isFinite(cx) && Number.isFinite(cy)
                ? <circle key={index} aria-hidden="true" cx={cx} cy={cy} r={4} fill={endpointFill(index === lastIndex)} stroke={endpointStroke} strokeWidth={2} />
                : <Fragment key={index} />
            } />
        </AreaChart>
      </ResponsiveContainer>
    )}
  </EfficiencyChart>;
}
