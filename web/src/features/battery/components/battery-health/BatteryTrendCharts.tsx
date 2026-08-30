import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import {
  AREA_DEFAULTS,
  Area,
  AreaChart,
  ChartContainer,
  ChartGradient,
  ChartLegend,
  ChartTooltip,
  ComposedChart,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  TimeMarker,
  Tooltip,
  XAxis,
  YAxis,
  axisTickSm,
  chartGrid,
  renderAnnotationLines,
} from '@/components/charts';
import { FadeIn } from '@/components/motion';
import { useAlertContext } from '@/hooks/useAlertContext';
import { useUnits } from '@/hooks/useUnits';
import { convertDistanceFromSI } from '@/lib/unitConversion';
import { COLOR, STATUS_COLORS } from '@/lib/colors';
import { formatDateShort } from '@/lib/dateFormat';
import type { BatteryHealthAnalytics } from '@/types/energy';
import { isProjectionTrustworthy } from './helpers';

interface BatteryTrendChartsProps {
  health: BatteryHealthAnalytics;
  vehicleId: number;
}

interface PredictionChartPoint extends Record<string, string | number | undefined> {
  label: string;
  actual?: number;
  predicted?: number;
}

export default function BatteryTrendCharts({ health, vehicleId }: BatteryTrendChartsProps) {
  const { t } = useTranslation();
  const { unitPrefs } = useUnits();
  const alertContext = useAlertContext();
  const alertMarkerLabel = useMemo(
    () => (alertContext.timestamp ? formatDateShort(alertContext.timestamp) : null),
    [alertContext.timestamp],
  );
  const projectionTrustworthy = isProjectionTrustworthy(health.prediction);

  const predictionChartData = useMemo(() => {
    const history: PredictionChartPoint[] = (health.history ?? []).map((point) => ({
      label: formatDateShort(point.date),
      actual: point.soh_pct,
    }));
    const projections: PredictionChartPoint[] = projectionTrustworthy
      ? (health.prediction.projection_points ?? []).map((point) => ({
          label: point.month.slice(0, 7),
          predicted: point.health,
        }))
      : [];
    if (history.length > 0 && projections.length > 0) {
      projections[0] = {
        ...projections[0],
        actual: history[history.length - 1].actual,
      };
    }
    return [...history, ...projections];
  }, [health.history, health.prediction.projection_points, projectionTrustworthy]);

  const rangeTrend = useMemo(() => {
    const points = (health.history ?? []).map((point) => ({
      label: formatDateShort(point.date),
      range: Math.round(convertDistanceFromSI(point.range_m, unitPrefs.distance)),
    }));
    return points.length > 0 && points.some((point) => point.range > 0) ? points : [];
  }, [health.history, unitPrefs.distance]);

  return (
    <FadeIn delay={0.1}>
      <section
        aria-label={t('battery.section.trends', 'Capacity and range trends')}
        className="grid grid-cols-1 gap-4 xl:grid-cols-3"
      >
        <ChartContainer
          className="h-full xl:col-span-2"
          title={t('battery.chart.capacityTrend', 'Capacity Trend & Prediction')}
          subtitle={t('battery.chart.dashedProjected', 'Dashed = projected')}
          ariaLabel={t(
            'battery.chart.capacityTrendAria',
            'Battery capacity trend with dashed projection line over time',
          )}
          size="detail"
          empty={predictionChartData.length === 0}
          emptyMessage={t('battery.chart.noTrend', 'Not enough snapshots for trend analysis')}
          data={predictionChartData}
          dataColumns={[
            { key: 'label', label: t('chart.col.date', 'Date') },
            { key: 'actual', label: t('battery.chart.actual', 'Actual %') },
            { key: 'predicted', label: t('battery.chart.predicted', 'Predicted %') },
          ]}
          exportData={predictionChartData}
          exportFilename="capacity-trend"
          chartKey="battery-health-capacity-trend"
        >
          {({ hiddenSeries }) => (
            <div className="h-full">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={predictionChartData}>
                  <defs>
                    <ChartGradient id="healthGrad" color={COLOR.CYAN} opacity={0.15} />
                  </defs>
                  {chartGrid}
                  <XAxis dataKey="label" tick={axisTickSm} tickLine={false} axisLine={false} />
                  <YAxis domain={[60, 100]} tick={axisTickSm} tickLine={false} axisLine={false} unit="%" />
                  <Tooltip content={<ChartTooltip />} />
                  <ChartLegend />
                  <ReferenceLine y={70} stroke={STATUS_COLORS.critical} strokeDasharray="8 4" />
                  <ReferenceLine y={80} stroke={STATUS_COLORS.warning} strokeDasharray="4 4" />
                  <TimeMarker
                    x={alertMarkerLabel}
                    severity={alertContext.signal ? 'critical' : undefined}
                  />
                  <Area
                    {...AREA_DEFAULTS}
                    dataKey="actual"
                    name={t('battery.chart.actual', 'Actual %')}
                    stroke="transparent"
                    fill="url(#healthGrad)"
                    hide={hiddenSeries?.isHidden('actual')}
                    legendType="none"
                  />
                  <Line
                    {...AREA_DEFAULTS}
                    dataKey="actual"
                    name={t('battery.chart.actual', 'Actual %')}
                    stroke={COLOR.CYAN}
                    dot={{ fill: COLOR.CYAN, r: 2 }}
                    connectNulls={false}
                    hide={hiddenSeries?.isHidden('actual')}
                  />
                  <Line
                    {...AREA_DEFAULTS}
                    dataKey="predicted"
                    name={t('battery.chart.predicted', 'Predicted %')}
                    stroke={COLOR.CYAN}
                    strokeDasharray="6 4"
                    opacity={0.5}
                    hide={hiddenSeries?.isHidden('predicted')}
                  />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          )}
        </ChartContainer>

        <ChartContainer
          className="h-full"
          title={t('battery.chart.rangeTrend', 'Estimated Range Over Time')}
          ariaLabel={t(
            'battery.chart.rangeTrendAria',
            'Estimated battery range over time area chart',
          )}
          size="detail"
          empty={rangeTrend.length === 0}
          emptyMessage={t('battery.chart.noRange', 'No range data yet')}
          data={rangeTrend}
          dataColumns={[
            { key: 'label', label: t('chart.col.date', 'Date') },
            {
              key: 'range',
              label: `${t('battery.chart.range', 'Range')} (${unitPrefs.distance})`,
            },
          ]}
          exportData={rangeTrend}
          exportFilename="range-trend"
          annotations={{ vehicleId, scope: 'battery', chartId: 'battery-health-range-trend' }}
        >
          {({ annotations: chartAnnotations }) =>
            (
              <div className="h-full">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={rangeTrend}>
                    <defs>
                      <ChartGradient id="rangeGrad" color={COLOR.GOOD} opacity={0.3} />
                    </defs>
                    {chartGrid}
                    <XAxis dataKey="label" tick={axisTickSm} tickLine={false} axisLine={false} />
                    <YAxis tick={axisTickSm} tickLine={false} axisLine={false} />
                    <Tooltip content={<ChartTooltip />} />
                    <TimeMarker
                      x={alertMarkerLabel}
                      severity={alertContext.signal ? 'critical' : undefined}
                    />
                    {renderAnnotationLines(chartAnnotations, (timestamp) => timestamp)}
                    <Area
                      {...AREA_DEFAULTS}
                      dataKey="range"
                      name={`${t('battery.chart.range', 'Range')} (${unitPrefs.distance})`}
                      stroke={COLOR.GOOD}
                      fill="url(#rangeGrad)"
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            )
          }
        </ChartContainer>
      </section>
    </FadeIn>
  );
}
