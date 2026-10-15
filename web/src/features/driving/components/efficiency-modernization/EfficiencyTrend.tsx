import { useTranslation } from 'react-i18next';
import {
  ChartTooltip, renderAnnotationLines, AREA_DEFAULTS, areaGradient,
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from '@/components/charts';
import { getChartFontFamily, getChartFontSize } from '@/lib/chartTypography';
import { chartTokens } from '@/lib/tokens';
import { getEfficiency } from '@/lib/drivesAggregation';
import { EfficiencyChart } from './EfficiencyChart';
import type { DrivesPresentation } from './types';

export function EfficiencyTrend({ model, source, units, selectedVehicleId }: DrivesPresentation & { selectedVehicleId: number | null }) {
  const { t } = useTranslation();
  const efficiencyUnit = units.unitPrefs.distance === 'mi' ? 'Wh/mi' : 'Wh/km';
  const { dailyTrend, filteredDrives } = model;
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
    empty={dailyTrend.length < 3}
    annotations={{ vehicleId: selectedVehicleId, scope: 'efficiency', chartId: 'efficiency-daily-trend' }}>
    {({ annotations: chartAnnotations }) => (
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={dailyTrend}>
          {areaGradient('effGrad', chartTokens.series[0], 0.08)}
          <CartesianGrid strokeDasharray="3 3" stroke={chartTokens.gridStroke} strokeOpacity={0.4} />
          <XAxis dataKey="date" tick={chartText} />
          <YAxis tick={chartText} />
          <Tooltip content={<ChartTooltip />} />
          {renderAnnotationLines(chartAnnotations, ts => ts)}
          <Area {...AREA_DEFAULTS} dataKey="efficiency" stroke={chartTokens.series[0]} fill="url(#effGrad)" name={efficiencyUnit} />
        </AreaChart>
      </ResponsiveContainer>
    )}
  </EfficiencyChart>;
}
