import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Activity } from 'lucide-react';

import {
  ChartContainer,
  ChartLegend,
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
  AREA_DEFAULTS,
} from '@/components/charts';
import { EmptyState } from '@/components/feedback';
import { FadeIn } from '@/components/motion';
import { useHiddenSeries } from '@/hooks/useHiddenSeries';
import { useDateFormat } from '@/hooks/useDateFormat';
import { useMotorHistory } from '@/api/hooks/useVehicles';
import { INTERVALS } from '@/lib/constants';
import { MOTOR_HISTORY_LIMIT } from './useMotorStats';

interface MotorHistoryChartsProps {
  vehicleId: number | null | undefined;
  toSpeedDisplay: (v: number) => number;
  speedUnit: string;
}

export default function MotorHistoryCharts({ vehicleId }: MotorHistoryChartsProps) {
  const { t } = useTranslation();
  const { formatTime } = useDateFormat();

  // Same query key as useMotorStats, so the four history-derived panels
  // share one request and one cache entry while each refreshes on its own.
  const { data: motorHistory } = useMotorHistory(
    vehicleId ?? 0,
    MOTOR_HISTORY_LIMIT,
    INTERVALS.FAST,
  );

  // URL-persisted hidden-series state for the
  // power-vs-regen trace; users often want to isolate one or the other
  // when looking at a regen-heavy descent or a sustained throttle pull.
  const powerHidden = useHiddenSeries('motor-power-history');

  const powerChartData = useMemo(
    () =>
      (motorHistory ?? []).map((s) => ({
        time: formatTime(s.ts),
        power: s.power_kw ?? null,
        regen: s.regen_kw ?? null,
      })),
    [motorHistory, formatTime],
  );

  const torqueChartData = useMemo(
    () =>
      (motorHistory ?? []).map((s) => ({
        time: formatTime(s.ts),
        front: s.torque_nm_front ?? null,
        rear: s.torque_nm_rear ?? null,
      })),
    [motorHistory, formatTime],
  );

  const rpmChartData = useMemo(
    () =>
      (motorHistory ?? []).map((s) => ({
        time: formatTime(s.ts),
        front: s.motor_rpm_front ?? null,
        rear: s.motor_rpm_rear ?? null,
      })),
    [motorHistory, formatTime],
  );

  // A snapshot window can carry samples whose series are all null (e.g. a
  // torque-only telemetry burst has no power/regen, a pre-Raven car reports
  // no per-axle rpm). Plotting those would leave an axis-only blank panel, so
  // gate each chart on "has at least one finite value" and fall back to the
  // placeholder — never a mute frame.
  const powerHasData = useMemo(
    () => powerChartData.some((d) => Number.isFinite(d.power) || Number.isFinite(d.regen)),
    [powerChartData],
  );
  const torqueHasData = useMemo(
    () => torqueChartData.some((d) => Number.isFinite(d.front) || Number.isFinite(d.rear)),
    [torqueChartData],
  );
  const rpmHasData = useMemo(
    () => rpmChartData.some((d) => Number.isFinite(d.front) || Number.isFinite(d.rear)),
    [rpmChartData],
  );

  const noData = (
    <EmptyState /* no-action: transient empty state — surfaces when source data is missing; no specific recovery action available */
      icon={<Activity className="h-5 w-5" />}
      message={t('dynamics.awaitingData', 'Awaiting motor telemetry data...')}
    />
  );

  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-2 xl:gap-5 3xl:grid-cols-3">
      {/* Motor Power Over Time */}
      <FadeIn delay={0.2}>
        {/* chart-a11y:no-table dense per-sample telemetry trace; CSV export available */}
        <ChartContainer
          title={t('dynamics.powerOverTime', 'Motor Power Over Time')}
          subtitle={t('dynamics.powerOverTimeDesc', 'Drive and regen power from motor telemetry')}
          ariaLabel={t('dynamics.powerOverTime.aria', 'Motor power and regen over time area chart')}
          height={280}
          chartKey="motor-power-history"
          exportable
          exportFilename="motor-power"
        >
          {powerHasData ? (
            <ResponsiveContainer width="100%" height={280}>
              <AreaChart data={powerChartData}>
                <defs>
                  <ChartGradient id="powerAreaGrad" color="#06b6d4" />
                  <ChartGradient id="regenAreaGrad" color="#22c55e" />
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
                <XAxis dataKey="time" tick={{ fill: 'rgba(255,255,255,0.5)', fontSize: 11 }} />
                <YAxis tick={{ fill: 'rgba(255,255,255,0.5)', fontSize: 11 }} unit=" kW" />
                <Tooltip content={<ChartTooltip />} />
                <ChartLegend state={powerHidden} wrapperStyle={{ color: 'rgba(255,255,255,0.6)' }} />
                <Area {...AREA_DEFAULTS} dataKey="power" stroke="#06b6d4" fill="url(#powerAreaGrad)" name={t('dynamics.power', 'Power')} hide={powerHidden.isHidden('power')} />
                <Area {...AREA_DEFAULTS} dataKey="regen" stroke="#22c55e" fill="url(#regenAreaGrad)" name={t('dynamics.regen', 'Regen')} hide={powerHidden.isHidden('regen')} />
              </AreaChart>
            </ResponsiveContainer>
          ) : (
            noData
          )}
        </ChartContainer>
      </FadeIn>

      {/* Motor Torque History */}
      <FadeIn delay={0.25}>
        {/* chart-a11y:no-table dense per-sample telemetry trace; CSV export available */}
        <ChartContainer
          title={t('dynamics.torqueHistory', 'Motor Torque History')}
          subtitle={t('dynamics.torqueHistoryDesc', 'Front and rear motor torque over time')}
          ariaLabel={t('dynamics.torqueHistory.aria', 'Front and rear motor torque over time line chart')}
          height={280}
          exportable
          exportFilename="torque-history"
        >
          {torqueHasData ? (
            <ResponsiveContainer width="100%" height={280}>
              <LineChart data={torqueChartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
                <XAxis dataKey="time" tick={{ fill: 'rgba(255,255,255,0.5)', fontSize: 11 }} />
                <YAxis tick={{ fill: 'rgba(255,255,255,0.5)', fontSize: 11 }} unit=" Nm" />
                <Tooltip content={<ChartTooltip />} />
                <Legend wrapperStyle={{ color: 'rgba(255,255,255,0.6)' }} />
                <Line {...AREA_DEFAULTS} dataKey="front" stroke="#3b82f6" name={t('dynamics.torqueFront', 'Front Torque')} />
                <Line {...AREA_DEFAULTS} dataKey="rear" stroke="#a855f7" name={t('dynamics.torqueRear', 'Rear Torque')} />
              </LineChart>
            </ResponsiveContainer>
          ) : (
            noData
          )}
        </ChartContainer>
      </FadeIn>

      {/* Motor RPM History */}
      <FadeIn delay={0.3}>
        {/* chart-a11y:no-table dense per-sample telemetry trace; CSV export available */}
        <ChartContainer
          title={t('dynamics.rpmHistory', 'Motor RPM History')}
          subtitle={t('dynamics.rpmHistoryDesc', 'Front and rear motor RPM over time')}
          ariaLabel={t('dynamics.rpmHistory.aria', 'Front and rear motor RPM over time line chart')}
          height={280}
          exportable
          exportFilename="motor-rpm"
        >
          {rpmHasData ? (
            <ResponsiveContainer width="100%" height={280}>
              <LineChart data={rpmChartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
                <XAxis dataKey="time" tick={{ fill: 'rgba(255,255,255,0.5)', fontSize: 11 }} />
                <YAxis tick={{ fill: 'rgba(255,255,255,0.5)', fontSize: 11 }} unit=" RPM" />
                <Tooltip content={<ChartTooltip />} />
                <Legend wrapperStyle={{ color: 'rgba(255,255,255,0.6)' }} />
                <Line {...AREA_DEFAULTS} dataKey="front" stroke="#06b6d4" name={t('dynamics.rpmFront', 'Front RPM')} />
                <Line {...AREA_DEFAULTS} dataKey="rear" stroke="#a855f7" name={t('dynamics.rpmRear', 'Rear RPM')} />
              </LineChart>
            </ResponsiveContainer>
          ) : (
            noData
          )}
        </ChartContainer>
      </FadeIn>
    </div>
  );
}
