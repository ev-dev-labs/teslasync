import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import type { ChargingSession } from '@/api/types';
import { formatDateShort } from '@/lib/dateFormat';
import {
  ChartContainer,
  ChartTooltip,
  chartGrid,
  axisTickSm,
  CHART_COLORS,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  AREA_DEFAULTS,
} from '@/components/charts';
import { FadeIn } from '@/components/motion';
import { generateChargingCurve, getChargerLabel } from './helpers';

interface SessionComparisonChartProps {
  sessions: ChargingSession[];
}

export default function SessionComparisonChart({ sessions }: SessionComparisonChartProps) {
  const { t } = useTranslation();

  const comparisonSessions = useMemo(() => sessions.slice(0, 10), [sessions]);

  const comparisonData = useMemo(() => {
    if (!comparisonSessions.length) return [];
    const curves = comparisonSessions.map((s, i) => ({
      curve: generateChargingCurve(s),
      key: `s${i}`,
    }));
    const allSocs = new Set<number>();
    curves.forEach((c) => c.curve.forEach((p) => allSocs.add(p.soc)));
    const socValues = Array.from(allSocs).sort((a, b) => a - b);

    return socValues.map((soc) => {
      const point: Record<string, number> = { soc };
      curves.forEach(({ curve, key }) => {
        const match = curve.find((p) => p.soc === soc);
        if (match) point[key] = Math.round(match.power * 10) / 10;
      });
      return point;
    });
  }, [comparisonSessions]);

  return (
    <FadeIn delay={0.15}>
      <ChartContainer
        title={t('charging.curve.sessionComparison', 'Session Comparison')}
        subtitle={t(
          'charging.curve.sessionComparisonDesc',
          'Power curves overlaid from last 10 sessions',
        )}
        height={300}
        exportable
        exportFilename="session-comparison"
      >
        <ResponsiveContainer width="100%" height={300}>
          <LineChart data={comparisonData} margin={{ top: 10, right: 20, left: 0, bottom: 0 }}>
            <CartesianGrid {...chartGrid} />
            <XAxis
              dataKey="soc"
              tick={axisTickSm}
              label={{
                value: t('charging.curve.socPercent', 'SOC (%)'),
                position: 'insideBottomRight',
                offset: -5,
                style: { fill: 'rgba(255,255,255,0.4)', fontSize: 11 },
              }}
            />
            <YAxis
              tick={axisTickSm}
              label={{
                value: t('charging.curve.powerKw', 'Power (kW)'),
                angle: -90,
                position: 'insideLeft',
                style: { fill: 'rgba(255,255,255,0.4)', fontSize: 11 },
              }}
            />
            <Tooltip content={<ChartTooltip />} />
            {comparisonSessions.map((s, i) => (
              <Line
                key={s.id}
                {...AREA_DEFAULTS}
                dataKey={`s${i}`}
                name={`${formatDateShort(s.start_ts)} (${getChargerLabel(s)})`}
                stroke={CHART_COLORS[i % CHART_COLORS.length]}
                strokeWidth={1.5}
                unit=" kW"
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
        <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 px-2">
          {comparisonSessions.map((s, i) => (
            <div key={s.id} className="flex items-center gap-1.5 text-xs text-white/60">
              <span
                className="inline-block h-2 w-3 rounded-sm"
                style={{ backgroundColor: CHART_COLORS[i % CHART_COLORS.length] }}
              />
              {formatDateShort(s.start_ts)}
            </div>
          ))}
        </div>
      </ChartContainer>
    </FadeIn>
  );
}
