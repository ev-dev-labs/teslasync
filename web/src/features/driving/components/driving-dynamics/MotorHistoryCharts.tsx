import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Activity } from 'lucide-react';

import {
  ChartContainer,
  ChartTooltip,
  ChartGradient,
  AreaChart,
  Area,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from '@/components/charts';
import { EmptyState } from '@/components/feedback';
import { FadeIn } from '@/components/motion';
import type { MotorSnapshot } from '@/api/types';

interface MotorHistoryChartsProps {
  motorHistory: MotorSnapshot[] | undefined;
  convertSpeed: (v: number) => number;
  speedUnit: string;
}

export default function MotorHistoryCharts({ motorHistory, convertSpeed, speedUnit }: MotorHistoryChartsProps) {
  const { t } = useTranslation();

  const speedChartData = useMemo(() =>
    (motorHistory ?? []).map((s) => ({
      time: new Date(s.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      speed: s.vehicle_speed != null ? convertSpeed(s.vehicle_speed) : null,
    })), [motorHistory, convertSpeed],
  );

  const torqueChartData = useMemo(() =>
    (motorHistory ?? []).map((s) => ({
      time: new Date(s.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      torque: s.di_torque ?? null,
    })), [motorHistory],
  );

  const gForceChartData = useMemo(() =>
    (motorHistory ?? []).map((s) => ({
      time: new Date(s.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      lateral: s.lateral_accel ?? null,
      longitudinal: s.longitudinal_accel ?? null,
    })), [motorHistory],
  );

  const noData = (
    <EmptyState icon={<Activity className="h-5 w-5" />} message={t('dynamics.awaitingData', 'Awaiting motor telemetry data...')} />
  );

  return (
    <>
      {/* Speed Over Time */}
      <FadeIn delay={0.2}>
        <ChartContainer
          title={t('dynamics.speedOverTime', 'Speed Over Time')}
          subtitle={t('dynamics.speedOverTimeDesc', 'Vehicle speed from motor telemetry')}
          height={280}
          exportable
          exportFilename="speed-over-time"
        >
          {speedChartData.length > 0 ? (
            <ResponsiveContainer width="100%" height={280}>
              <AreaChart data={speedChartData}>
                <defs>
                  <ChartGradient id="speedAreaGrad" color="#06b6d4" />
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
                <XAxis dataKey="time" tick={{ fill: 'rgba(255,255,255,0.5)', fontSize: 11 }} />
                <YAxis tick={{ fill: 'rgba(255,255,255,0.5)', fontSize: 11 }} unit={` ${speedUnit}`} />
                <Tooltip content={<ChartTooltip />} />
                <Area type="monotone" dataKey="speed" stroke="#06b6d4" fill="url(#speedAreaGrad)" name={t('dynamics.speed', 'Speed')} />
              </AreaChart>
            </ResponsiveContainer>
          ) : noData}
        </ChartContainer>
      </FadeIn>

      {/* Motor Torque History */}
      <FadeIn delay={0.25}>
        <ChartContainer
          title={t('dynamics.torqueHistory', 'Motor Torque History')}
          subtitle={t('dynamics.torqueHistoryDesc', 'Drive inverter torque over time')}
          height={280}
          exportable
          exportFilename="torque-history"
        >
          {torqueChartData.length > 0 ? (
            <ResponsiveContainer width="100%" height={280}>
              <AreaChart data={torqueChartData}>
                <defs>
                  <ChartGradient id="torqueGrad" color="#3b82f6" />
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
                <XAxis dataKey="time" tick={{ fill: 'rgba(255,255,255,0.5)', fontSize: 11 }} />
                <YAxis tick={{ fill: 'rgba(255,255,255,0.5)', fontSize: 11 }} unit=" Nm" />
                <Tooltip content={<ChartTooltip />} />
                <Area type="monotone" dataKey="torque" stroke="#3b82f6" fill="url(#torqueGrad)" name={t('dynamics.torqueNm', 'Torque (Nm)')} />
              </AreaChart>
            </ResponsiveContainer>
          ) : noData}
        </ChartContainer>
      </FadeIn>

      {/* G-Force History */}
      <FadeIn delay={0.3}>
        <ChartContainer
          title={t('dynamics.gForceHistory', 'G-Force History')}
          subtitle={t('dynamics.gForceHistoryDesc', 'Lateral & longitudinal acceleration over time')}
          height={280}
          exportable
          exportFilename="g-force-history"
        >
          {gForceChartData.length > 0 ? (
            <ResponsiveContainer width="100%" height={280}>
              <LineChart data={gForceChartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
                <XAxis dataKey="time" tick={{ fill: 'rgba(255,255,255,0.5)', fontSize: 11 }} />
                <YAxis tick={{ fill: 'rgba(255,255,255,0.5)', fontSize: 11 }} unit=" g" />
                <Tooltip content={<ChartTooltip />} />
                <Legend wrapperStyle={{ color: 'rgba(255,255,255,0.6)' }} />
                <Line type="monotone" dataKey="lateral" stroke="#a855f7" strokeWidth={2} dot={false} name={t('dynamics.lateralGLine', 'Lateral G')} />
                <Line type="monotone" dataKey="longitudinal" stroke="#22c55e" strokeWidth={2} dot={false} name={t('dynamics.longGLine', 'Longitudinal G')} />
              </LineChart>
            </ResponsiveContainer>
          ) : noData}
        </ChartContainer>
      </FadeIn>
    </>
  );
}
