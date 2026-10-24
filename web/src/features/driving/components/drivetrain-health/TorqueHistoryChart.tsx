import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import {
  ChartContainer,
  ChartTooltip,
  ChartGradient,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
  ReferenceLine,
  AREA_DEFAULTS,
} from '@/components/charts';
import { FadeIn } from '@/components/motion';

import type { MotorChartDataPoint } from './constants';
import { CHART_COLORS, CHART_NEUTRAL } from '@/lib/colors';

interface TorqueHistoryChartProps {
  data: MotorChartDataPoint[];
  loading?: boolean;
}

export function TorqueHistoryChart({ data, loading = false }: TorqueHistoryChartProps) {
  const { t } = useTranslation();

  const rows = useMemo(() => data ?? [], [data]);

  // Empty when there is nothing meaningful to trace: a single (or no) snapshot,
  // or every snapshot's torque is null (a single flat null line would otherwise
  // render as a blank panel). Mirrors the sibling StatorTempChart.
  const empty = useMemo(
    () => rows.length <= 1 || !rows.some((d) => d.torque !== null),
    [rows],
  );

  const fallbackRows = useMemo(
    () => rows.map((d) => ({ time: d.time, torque: d.torque })),
    [rows],
  );

  return (
    <FadeIn delay={0.24}>
      <ChartContainer
        title={t('drivetrain.torqueHistory', 'Motor Torque')}
        subtitle={t('drivetrain.torqueHistorySub', 'Drive inverter torque output over time')}
        ariaLabel={t('drivetrain.torqueHistoryAria', 'Motor inverter torque output history area chart')}
        loading={loading}
        empty={empty}
        data={fallbackRows}
        dataColumns={[
          { key: 'time', label: t('drivetrain.col.time', 'Time') },
          { key: 'torque', label: t('drivetrain.col.torque', 'Torque (Nm)') },
        ]}
        height={280}
      >
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={rows}>
            <defs>
              <ChartGradient id="dtTorqueGrad" color={CHART_COLORS[0]} />
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--glass-border)" strokeOpacity={0.4} />
            <XAxis dataKey="time" tick={{ fill: 'var(--text-muted)', fontSize: 10 }} />
            <YAxis tick={{ fill: 'var(--text-muted)', fontSize: 10 }} />
            <Tooltip content={<ChartTooltip />} />
            <Legend />
            <Area
              {...AREA_DEFAULTS}
              dataKey="torque"
              name={`${t('drivetrain.torque', 'Torque')} (Nm)`}
              stroke={CHART_COLORS[0]}
              fill="url(#dtTorqueGrad)"
            />
            <ReferenceLine y={0} stroke={CHART_NEUTRAL} strokeDasharray="2 2" />
          </AreaChart>
        </ResponsiveContainer>
      </ChartContainer>
    </FadeIn>
  );
}
