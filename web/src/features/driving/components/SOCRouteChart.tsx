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
import type { TripSOCPoint, TripChargeStop } from '@/types/driving';

interface SOCRouteChartProps {
  socCurve: TripSOCPoint[];
  chargeStops: TripChargeStop[];
  minArrivalSOC: number;
}

export function SOCRouteChart({ socCurve, chargeStops, minArrivalSOC }: SOCRouteChartProps) {
  const { t } = useTranslation();

  const chartData = useMemo(() =>
    (socCurve ?? []).map((pt) => ({
      distance: Math.round(pt.distance_km * 10) / 10,
      soc: Math.round(pt.soc * 10) / 10,
    })),
    [socCurve],
  );

  // Find charge stop distances for reference lines
  const stopDistances = useMemo(() => {
    const distances: number[] = [];
    let cumDist = 0;
    for (const stop of chargeStops ?? []) {
      // Charge stops align with leg boundaries in soc_curve
      const matchPt = (socCurve ?? []).find(
        (pt) => pt.distance_km > cumDist && Math.abs(pt.soc - stop.charge_from_soc) < 5,
      );
      if (matchPt) {
        distances.push(Math.round(matchPt.distance_km));
        cumDist = matchPt.distance_km;
      }
    }
    return distances;
  }, [socCurve, chargeStops]);

  if (chartData.length === 0) {
    return (
      <ChartContainer title={t('tripPlanner.socChart.title', 'Battery Along Route')} height={300}>
        <EmptyState message={t('tripPlanner.socChart.empty', 'Plan a trip to see the SOC curve')} />
      </ChartContainer>
    );
  }

  return (
    <ChartContainer title={t('tripPlanner.socChart.title', 'Battery Along Route')} height={300}>
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
            label={{ value: 'km', position: 'insideBottomRight', offset: -5, fill: 'rgba(255,255,255,0.5)', fontSize: 11 }}
          />
          <YAxis
            domain={[0, 100]}
            {...axisTick}
            label={{ value: 'SOC %', angle: -90, position: 'insideLeft', fill: 'rgba(255,255,255,0.5)', fontSize: 11 }}
          />
          <Tooltip
            contentStyle={{ background: 'rgba(15,15,30,0.95)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8 }}
            labelFormatter={(v) => `${v} km`}
            formatter={(v: number) => [`${v}%`, 'SOC']}
          />
          <Area
            {...AREA_DEFAULTS}
            dataKey="soc"
            stroke="#22c55e"
            fill="url(#socGradient)"
          />
          {/* Min arrival SOC reference line */}
          <ReferenceLine
            y={minArrivalSOC}
            stroke="#ef4444"
            strokeDasharray="6 4"
            label={{ value: `Min ${minArrivalSOC}%`, fill: '#ef4444', fontSize: 11, position: 'right' }}
          />
          {/* Charge stop vertical lines */}
          {stopDistances.map((dist, i) => (
            <ReferenceLine
              key={`stop-${i}`}
              x={dist}
              stroke="#3b82f6"
              strokeDasharray="4 4"
              label={{ value: `⚡ Stop ${i + 1}`, fill: '#3b82f6', fontSize: 10, position: 'top' }}
            />
          ))}
        </AreaChart>
      </ResponsiveContainer>
    </ChartContainer>
  );
}
