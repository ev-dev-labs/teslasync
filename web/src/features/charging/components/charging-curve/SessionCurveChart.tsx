import { useTranslation } from 'react-i18next';
import {
  ChartContainer,
  ChartTooltip,
  ChartGradient,
  chartGrid,
  axisTickSm,
  CHART_COLORS,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from '@/components/charts';
import type { CurvePoint } from './types';

interface SessionCurveChartProps {
  curveData: CurvePoint[];
}

export default function SessionCurveChart({ curveData }: SessionCurveChartProps) {
  const { t } = useTranslation();

  return (
    <ChartContainer
      title={t('charging.curve.powerVsSoc', 'Power vs SOC')}
      subtitle={t(
        'charging.curve.powerVsSocDesc',
        'Charging power curve for selected session',
      )}
      height={320}
      exportable
      exportFilename="power-vs-soc"
    >
      <ResponsiveContainer width="100%" height={320}>
        <AreaChart data={curveData} margin={{ top: 10, right: 20, left: 0, bottom: 0 }}>
          <defs>
            <ChartGradient id="curvePowerGrad" color={CHART_COLORS[0]} />
          </defs>
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
          <Area
            type="monotone"
            dataKey="power"
            name={t('charging.curve.power', 'Power')}
            stroke={CHART_COLORS[0]}
            fill="url(#curvePowerGrad)"
            strokeWidth={2}
            unit=" kW"
          />
        </AreaChart>
      </ResponsiveContainer>
    </ChartContainer>
  );
}
