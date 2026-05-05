import { useTranslation } from 'react-i18next';
import {
  ChartContainer,
  ChartTooltip,
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
  AREA_DEFAULTS,
  areaGradient,
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
      ariaLabel={t(
        'charging.curve.powerVsSoc.aria',
        'Charging power versus state-of-charge area chart for the selected session',
      )}
      data={curveData.map((p) => ({ soc: p.soc, power: Math.round(p.power * 10) / 10 }))}
      dataColumns={[
        { key: 'soc', label: t('charging.curve.col.soc', 'SOC %') },
        { key: 'power', label: t('charging.curve.col.power', 'Power (kW)') },
      ]}
      height={320}
      exportable
      exportFilename="power-vs-soc"
    >
      <ResponsiveContainer width="100%" height={320}>
        <AreaChart data={curveData} margin={{ top: 10, right: 20, left: 0, bottom: 0 }}>
          {areaGradient('curvePowerGrad', CHART_COLORS[0])}
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
            {...AREA_DEFAULTS}
            dataKey="power"
            name={t('charging.curve.power', 'Power')}
            stroke={CHART_COLORS[0]}
            fill="url(#curvePowerGrad)"
            unit=" kW"
          />
        </AreaChart>
      </ResponsiveContainer>
    </ChartContainer>
  );
}
