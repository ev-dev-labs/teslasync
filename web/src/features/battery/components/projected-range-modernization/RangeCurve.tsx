import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { ChartCard } from '@/components/layout/layout-reference';
import {
  ChartLegend, ChartTooltip, chartMargin, axisTick, CHART_COLORS,
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  ReferenceLine, AREA_DEFAULTS, areaGradient,
} from '@/components/charts';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';
import { useUnits } from '@/hooks/useUnits';
import { knownNumber } from '@/api/dataState';
import { convertDistanceFromSI } from '@/lib/unitConversion';
import { safeArray } from '@/lib/safeArray';
import { RangeSourceSlot, type RangeSectionProps } from './RangeSourceSlot';

export function RangeCurve({ source, loading }: RangeSectionProps) {
  const { t } = useTranslation();
  const { fmtNumber } = useNumberFormatting();
  const { unitPrefs } = useUnits();
  const curve = safeArray(source.data?.projection_curve);
  const displayCurve = useMemo(() => curve.map(point => {
    const rated = knownNumber(point.rated_range);
    const projected = knownNumber(point.projected_range);
    return {
      ...point,
      rated_range: rated == null ? null : convertDistanceFromSI(rated * 1000, unitPrefs.distance),
      projected_range: projected == null ? null : convertDistanceFromSI(projected * 1000, unitPrefs.distance),
    };
  }), [curve, unitPrefs.distance]);
  const tableData = useMemo(() => displayCurve.map(({ battery_pct, rated_range, projected_range }) => ({
    battery_pct, rated_range, projected_range,
  })), [displayCurve]);
  return (
    <ChartCard title={t('range.projectionCurve', 'Range Projection Curve')}
      ariaLabel={t('range.projectionCurveAria', 'Rated versus projected range across battery level')}
      chartKey="projected-range-curve" data={tableData}
      dataColumns={[
        { key: 'battery_pct', label: t('range.battery', 'Battery') },
        { key: 'rated_range', label: `${t('range.rated', 'Rated Range')} (${unitPrefs.distance})`, format: value => value == null ? '—' : fmtNumber(Number(value)) },
        { key: 'projected_range', label: `${t('range.projected', 'Projected Range')} (${unitPrefs.distance})`, format: value => value == null ? '—' : fmtNumber(Number(value)) },
      ]}>
      {({ hiddenSeries }) => (
        <RangeSourceSlot source={source} loading={loading} empty={curve.length === 0 || !source.data}
          message={t('range.noCurve', 'Range projection curve will appear once this vehicle logs drives.')} height={260}>
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={displayCurve} margin={chartMargin}>
              {areaGradient('ratedFill', CHART_COLORS[0])}
              {areaGradient('projectedFill', CHART_COLORS[1])}
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border-subtle)" strokeOpacity={0.4} />
              <XAxis dataKey="battery_pct" tick={axisTick} unit="%" />
              <YAxis tick={axisTick} unit={` ${unitPrefs.distance}`} width={55} />
              <Tooltip content={<ChartTooltip />} />
              <ChartLegend />
              {knownNumber(source.data?.battery_level) != null && (
                <ReferenceLine x={source.data?.battery_level} stroke={CHART_COLORS[3]} strokeDasharray="4 4" label={t('range.current', 'Current')} />
              )}
              <Area {...AREA_DEFAULTS} dataKey="rated_range" name={t('range.rated', 'Rated Range')}
                stroke={CHART_COLORS[0]} fill="url(#ratedFill)" hide={hiddenSeries?.isHidden('rated_range')} />
              <Area {...AREA_DEFAULTS} dataKey="projected_range" name={t('range.projected', 'Projected Range')}
                stroke={CHART_COLORS[1]} fill="url(#projectedFill)" hide={hiddenSeries?.isHidden('projected_range')} />
            </AreaChart>
          </ResponsiveContainer>
        </RangeSourceSlot>
      )}
    </ChartCard>
  );
}
