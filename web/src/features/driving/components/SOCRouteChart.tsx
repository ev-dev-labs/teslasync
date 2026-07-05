import { useMemo } from 'react';
import {
  ChartContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  chartGrid,
  axisTick,
  AREA_DEFAULTS,
} from '@/components/charts';
import { EmptyState } from '@/components/feedback';
import { useTranslation } from 'react-i18next';
import { useUnits } from '@/hooks/useUnits';
import { convertDistanceFromSI } from '@/lib/unitConversion';
import type { TripSOCPoint, TripChargeStop } from '@/types/driving';

interface SOCRouteChartProps {
  socCurve: TripSOCPoint[];
  chargeStops: TripChargeStop[];
  minArrivalSOC: number;
}

/** Round to one decimal place for stable, legible chart/axis values. */
const roundTo1 = (n: number) => Math.round(n * 10) / 10;

export function SOCRouteChart({ socCurve, chargeStops, minArrivalSOC }: SOCRouteChartProps) {
  const { t } = useTranslation();
  const { unitPrefs } = useUnits();
  const distanceUnit = unitPrefs.distance;

  // The reference line reads a required number; guard defensively against a
  // JS caller passing null/undefined/NaN so it never plots a phantom line.
  const minSOC = Number.isFinite(minArrivalSOC) ? minArrivalSOC : 0;

  // soc_curve distances are SI meters — convert to the user's display unit at
  // the render boundary so the X axis, its label, and the reference lines all
  // share one scale (previously the axis plotted raw meters under a "km" label).
  const chartData = useMemo(
    () =>
      (socCurve ?? []).map((pt) => ({
        distance: roundTo1(convertDistanceFromSI(pt?.distance_m ?? 0, distanceUnit)),
        soc: roundTo1(pt?.soc ?? 0),
      })),
    [socCurve, distanceUnit],
  );

  // Match each charge stop to the first onward soc_curve point near its
  // charge_from_soc; record the display-unit distance so the vertical marker
  // lands on the same X scale as the plotted area.
  const stopDistances = useMemo(() => {
    const distances: number[] = [];
    let cumDistM = 0;
    for (const stop of chargeStops ?? []) {
      const matchPt = (socCurve ?? []).find(
        (pt) =>
          (pt?.distance_m ?? 0) > cumDistM &&
          Math.abs((pt?.soc ?? 0) - (stop?.charge_from_soc ?? 0)) < 5,
      );
      if (matchPt) {
        const m = matchPt.distance_m ?? 0;
        distances.push(roundTo1(convertDistanceFromSI(m, distanceUnit)));
        cumDistM = m;
      }
    }
    return distances;
  }, [socCurve, chargeStops, distanceUnit]);

  const title = t('tripPlanner.socChart.title', 'Battery Along Route');
  const ariaLabel = t(
    'tripPlanner.socChart.aria',
    'Planned route battery state-of-charge area chart',
  );

  if (chartData.length === 0) {
    // chart-a11y:no-table empty-state branch wraps a placeholder, no series available to tabulate
    return (
      <ChartContainer title={title} ariaLabel={ariaLabel} height={300}>
        <EmptyState /* no-action: transient empty state — surfaces when source data is missing; no specific recovery action available */ message={t('tripPlanner.socChart.empty', 'Plan a trip to see the SOC curve')} />
      </ChartContainer>
    );
  }

  return (
    <ChartContainer
      title={title}
      ariaLabel={ariaLabel}
      data={chartData}
      dataColumns={[
        {
          key: 'distance',
          label: t('tripPlanner.socChart.col.distance', 'Distance ({{unit}})', {
            unit: distanceUnit,
          }),
        },
        { key: 'soc', label: t('tripPlanner.socChart.col.soc', 'SOC %') },
      ]}
      height={300}
    >
      <ResponsiveContainer width="100%" height={300}>
        <AreaChart data={chartData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
          <defs>
            <linearGradient id="socGradient" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#22c55e" stopOpacity={0.4} />
              <stop offset="50%" stopColor="#eab308" stopOpacity={0.2} />
              <stop offset="100%" stopColor="#ef4444" stopOpacity={0.1} />
            </linearGradient>
          </defs>
          <CartesianGrid {...chartGrid} />
          <XAxis
            dataKey="distance"
            {...axisTick}
            label={{ value: distanceUnit, position: 'insideBottomRight', offset: -5, fill: 'rgba(255,255,255,0.5)', fontSize: 11 }}
          />
          <YAxis
            domain={[0, 100]}
            {...axisTick}
            label={{ value: t('tripPlanner.socChart.socAxis', 'SOC %'), angle: -90, position: 'insideLeft', fill: 'rgba(255,255,255,0.5)', fontSize: 11 }}
          />
          <Tooltip
            contentStyle={{ background: 'rgba(15,15,30,0.95)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8 }}
            labelFormatter={(v) => `${v} ${distanceUnit}`}
            formatter={(v: number) => [`${v}%`, t('tripPlanner.socChart.socSeries', 'SOC')]}
          />
          <Area
            {...AREA_DEFAULTS}
            dataKey="soc"
            stroke="#22c55e"
            fill="url(#socGradient)"
          />
          {/* Min arrival SOC reference line */}
          <ReferenceLine
            y={minSOC}
            stroke="#ef4444"
            strokeDasharray="6 4"
            label={{ value: t('tripPlanner.socChart.minArrival', 'Min {{soc}}%', { soc: minSOC }), fill: '#ef4444', fontSize: 11, position: 'right' }}
          />
          {/* Charge stop vertical lines */}
          {stopDistances.map((dist, i) => (
            <ReferenceLine
              key={`stop-${i}`}
              x={dist}
              stroke="#3b82f6"
              strokeDasharray="4 4"
              label={{ value: t('tripPlanner.socChart.stopLabel', '⚡ Stop {{n}}', { n: i + 1 }), fill: '#3b82f6', fontSize: 10, position: 'top' }}
            />
          ))}
        </AreaChart>
      </ResponsiveContainer>
    </ChartContainer>
  );
}
