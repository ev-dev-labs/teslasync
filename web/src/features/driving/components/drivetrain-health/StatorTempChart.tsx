import { useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import {
  ChartContainer,
  ChartTooltip,
  LineChart,
  Line,
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
import { useUnits } from '@/hooks/useUnits';

import type { MotorChartDataPoint } from './constants';
import { convertTempFromSI } from '@/lib/unitConversion';

interface StatorTempChartProps {
  data: MotorChartDataPoint[];
  loading?: boolean;
}

export function StatorTempChart({ data, loading = false }: StatorTempChartProps) {
  const { t } = useTranslation();
  const { unitPrefs } = useUnits();
  const tempUnit = unitPrefs.temperature;

  const toTemperatureDisplay = useCallback(
    (value: number) => convertTempFromSI(value, tempUnit),
    [tempUnit],
  );

  const rows = useMemo(() => data ?? [], [data]);

  // Empty when there is nothing meaningful to trace: a single (or no) snapshot,
  // or every snapshot's stator temps are null (three flat null lines would
  // otherwise render as a blank panel). Mirrors the sibling TorqueHistoryChart.
  const empty = useMemo(
    () =>
      rows.length <= 1 ||
      !rows.some(
        (d) => d.stator !== null || d.statorRel !== null || d.statorRer !== null,
      ),
    [rows],
  );

  const fallbackRows = useMemo(
    () =>
      rows.map((d) => ({
        time: d.time,
        stator: d.stator,
        statorRel: d.statorRel,
        statorRer: d.statorRer,
      })),
    [rows],
  );

  const normalThreshold = useMemo(() => toTemperatureDisplay(60), [toTemperatureDisplay]);
  const warmThreshold = useMemo(() => toTemperatureDisplay(80), [toTemperatureDisplay]);

  return (
    <FadeIn delay={0.23}>
      <ChartContainer
        title={t('drivetrain.statorTempHistory', 'Stator Temperature History')}
        subtitle={t('drivetrain.statorTempSub', 'Motor stator temperature over recent snapshots')}
        ariaLabel={t('drivetrain.statorTempHistory.aria', 'Front, rear-left and rear-right motor stator temperature history line chart')}
        loading={loading}
        empty={empty}
        data={fallbackRows}
        dataColumns={[
          { key: 'time', label: t('drivetrain.col.time', 'Time') },
          { key: 'stator', label: `${t('drivetrain.col.stator', 'Stator')} (${tempUnit})` },
          { key: 'statorRel', label: `${t('drivetrain.col.statorRel', 'Rear-Left')} (${tempUnit})` },
          { key: 'statorRer', label: `${t('drivetrain.col.statorRer', 'Rear-Right')} (${tempUnit})` },
        ]}
        height={280}
      >
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={rows}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--glass-border)" strokeOpacity={0.4} />
            <XAxis dataKey="time" tick={{ fill: 'var(--text-muted)', fontSize: 10 }} />
            <YAxis tick={{ fill: 'var(--text-muted)', fontSize: 10 }} />
            <Tooltip content={<ChartTooltip />} />
            <Legend />
            <Line
              {...AREA_DEFAULTS}
              dataKey="stator"
              name={`${t('drivetrain.statorTemp', 'Stator Temp')} (${tempUnit})`}
              stroke="#ef4444"
            />
            <Line
              {...AREA_DEFAULTS}
              dataKey="statorRel"
              name={`${t('drivetrain.statorTempRearLeft', 'Rear-Left Stator Temp')} (${tempUnit})`}
              stroke="#a855f7"
            />
            <Line
              {...AREA_DEFAULTS}
              dataKey="statorRer"
              name={`${t('drivetrain.statorTempRearRight', 'Rear-Right Stator Temp')} (${tempUnit})`}
              stroke="#06b6d4"
            />
            <ReferenceLine
              y={normalThreshold}
              stroke="#4ade80"
              strokeDasharray="4 4"
              strokeOpacity={0.5}
              label={{ value: t('drivetrain.normal', 'Normal'), position: 'right', fill: '#4ade80', fontSize: 10 }}
            />
            <ReferenceLine
              y={warmThreshold}
              stroke="#fbbf24"
              strokeDasharray="4 4"
              strokeOpacity={0.5}
              label={{ value: t('drivetrain.warm', 'Warm'), position: 'right', fill: '#fbbf24', fontSize: 10 }}
            />
          </LineChart>
        </ResponsiveContainer>
      </ChartContainer>
    </FadeIn>
  );
}
