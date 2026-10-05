import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ChartContainer, ChartLegend, ChartTooltip, ChartGradient,
  AreaChart, Area, LineChart, Line, XAxis, YAxis, chartGrid,
  axisTick, Tooltip, ResponsiveContainer, AREA_DEFAULTS,
} from '@/components/charts';
import { CardGrid } from '@/components/layout/layout-reference';
import { EmptyState, QueryError, Skeleton, StaleRefreshWarning } from '@/components/feedback';
import { FadeIn } from '@/components/motion';
import { useHiddenSeries } from '@/hooks/useHiddenSeries';
import { useDateFormat } from '@/hooks/useDateFormat';
import type { MotorHistoryQuery } from '@/api/hooks/useVehicles';
import { useMotorEvidence } from './useMotorEvidence';
import { DynamicsPlacement } from './DynamicsPlacement';

interface MotorHistoryChartsProps {
  vehicleId: number | null | undefined;
  historyQuery?: MotorHistoryQuery;
}

/** ChartContainer is intentional: ChartCard/EmbeddedChart currently strip
 * export/fullscreen. All three identities, series and controls stay owned by
 * the existing chart pipeline, while CardGrid owns container placement. */
export default function MotorHistoryCharts({ vehicleId, historyQuery }: MotorHistoryChartsProps) {
  const { t } = useTranslation();
  const { formatTime } = useDateFormat();
  const { query, state } = useMotorEvidence(vehicleId, historyQuery);
  const motorHistory = state.data;
  const powerHidden = useHiddenSeries('motor-power-history');
  const torqueHidden = useHiddenSeries('motor-torque-history');
  const rpmHidden = useHiddenSeries('motor-rpm-history');
  const powerChartData = useMemo(() => (motorHistory ?? []).map(s => ({
    time: formatTime(s.ts), power: s.power_kw ?? null, regen: s.regen_kw ?? null,
  })), [motorHistory, formatTime]);
  const torqueChartData = useMemo(() => (motorHistory ?? []).map(s => ({
    time: formatTime(s.ts), front: s.torque_nm_front ?? null, rear: s.torque_nm_rear ?? null,
  })), [motorHistory, formatTime]);
  const rpmChartData = useMemo(() => (motorHistory ?? []).map(s => ({
    time: formatTime(s.ts), front: s.motor_rpm_front ?? null, rear: s.motor_rpm_rear ?? null,
  })), [motorHistory, formatTime]);
  const powerHasData = useMemo(() =>
    powerChartData.some(d => Number.isFinite(d.power) || Number.isFinite(d.regen)), [powerChartData]);
  const torqueHasData = useMemo(() =>
    torqueChartData.some(d => Number.isFinite(d.front) || Number.isFinite(d.rear)), [torqueChartData]);
  const rpmHasData = useMemo(() =>
    rpmChartData.some(d => Number.isFinite(d.front) || Number.isFinite(d.rear)), [rpmChartData]);
  const noData = query.isLoading && !state.hasData ? <Skeleton className="h-48" /> : state.fatalError ? (
    <QueryError error={state.fatalError} onRetry={() => void query.refetch()} />
  ) : (
    <EmptyState message={t('dynamics.awaitingData', 'Awaiting motor telemetry data...')} />
  );
  return (
    <div className="min-w-0 space-y-3">
      <StaleRefreshWarning state={state} label={t('dynamics.modernization.sampleMetrics', 'Selected-drive motor samples')} />
      <CardGrid label={t('dynamics.review.evidence', 'Inside this ride')} items={[
        {
          id: 'motor-power-history', size: 'full',
          content: (
            <DynamicsPlacement>
              <FadeIn delay={0.1} className="min-w-0">
                {/* chart-a11y:no-table dense per-sample telemetry trace; original image export contract retained */}
                <ChartContainer
                  title={t('dynamics.powerOverTime', 'Motor Power Over Time')}
                  subtitle={t('dynamics.powerOverTimeDesc', 'Drive and regen power from motor telemetry')}
                  ariaLabel={t('dynamics.powerOverTime.aria', 'Motor power and regen over time area chart')}
                  height={280}
                  loading={query.isLoading && !state.hasData}
                  error={state.fatalError}
                  onRetry={() => void query.refetch()}
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
                        {chartGrid}
                        <XAxis dataKey="time" tick={axisTick} />
                        <YAxis tick={axisTick} unit=" kW" />
                        <Tooltip content={<ChartTooltip />} />
                        <ChartLegend state={powerHidden} />
                        <Area {...AREA_DEFAULTS} dataKey="power" stroke="#06b6d4" fill="url(#powerAreaGrad)" name={t('dynamics.power', 'Power')} hide={powerHidden.isHidden('power')} />
                        <Area {...AREA_DEFAULTS} dataKey="regen" stroke="#22c55e" fill="url(#regenAreaGrad)" name={t('dynamics.regen', 'Regen')} hide={powerHidden.isHidden('regen')} />
                      </AreaChart>
                    </ResponsiveContainer>
                  ) : noData}
                </ChartContainer>
              </FadeIn>
            </DynamicsPlacement>
          ),
        },
        {
          id: 'motor-torque-history', size: 'half',
          content: (
            <DynamicsPlacement>
              <FadeIn delay={0.25}>
                {/* chart-a11y:no-table dense per-sample telemetry trace; original image export contract retained */}
                <ChartContainer
                  title={t('dynamics.torqueHistory', 'Motor Torque History')}
                  subtitle={t('dynamics.torqueHistoryDesc', 'Front and rear motor torque over time')}
                  ariaLabel={t('dynamics.torqueHistory.aria', 'Front and rear motor torque over time line chart')}
                  height={280}
                  loading={query.isLoading && !state.hasData}
                  error={state.fatalError}
                  onRetry={() => void query.refetch()}
                  exportable
                  exportFilename="torque-history"
                  chartKey="motor-torque-history"
                >
                  {torqueHasData ? (
                    <ResponsiveContainer width="100%" height={280}>
                      <LineChart data={torqueChartData}>
                        {chartGrid}
                        <XAxis dataKey="time" tick={axisTick} />
                        <YAxis tick={axisTick} unit=" Nm" />
                        <Tooltip content={<ChartTooltip />} />
                        <ChartLegend state={torqueHidden} />
                        <Line {...AREA_DEFAULTS} dataKey="front" stroke="#3b82f6" name={t('dynamics.torqueFront', 'Front Torque')} hide={torqueHidden.isHidden('front')} />
                        <Line {...AREA_DEFAULTS} dataKey="rear" stroke="#a855f7" name={t('dynamics.torqueRear', 'Rear Torque')} hide={torqueHidden.isHidden('rear')} />
                      </LineChart>
                    </ResponsiveContainer>
                  ) : noData}
                </ChartContainer>
              </FadeIn>
            </DynamicsPlacement>
          ),
        },
        {
          id: 'motor-rpm-history', size: 'half',
          content: (
            <DynamicsPlacement>
              <FadeIn delay={0.3}>
                {/* chart-a11y:no-table dense per-sample telemetry trace; original image export contract retained */}
                <ChartContainer
                  title={t('dynamics.rpmHistory', 'Motor RPM History')}
                  subtitle={t('dynamics.rpmHistoryDesc', 'Front and rear motor RPM over time')}
                  ariaLabel={t('dynamics.rpmHistory.aria', 'Front and rear motor RPM over time line chart')}
                  height={280}
                  loading={query.isLoading && !state.hasData}
                  error={state.fatalError}
                  onRetry={() => void query.refetch()}
                  exportable
                  exportFilename="motor-rpm"
                  chartKey="motor-rpm-history"
                >
                  {rpmHasData ? (
                    <ResponsiveContainer width="100%" height={280}>
                      <LineChart data={rpmChartData}>
                        {chartGrid}
                        <XAxis dataKey="time" tick={axisTick} />
                        <YAxis tick={axisTick} unit=" rpm" />
                        <Tooltip content={<ChartTooltip />} />
                        <ChartLegend state={rpmHidden} />
                        <Line {...AREA_DEFAULTS} dataKey="front" stroke="#06b6d4" name={t('dynamics.rpmFront', 'Front RPM')} hide={rpmHidden.isHidden('front')} />
                        <Line {...AREA_DEFAULTS} dataKey="rear" stroke="#a855f7" name={t('dynamics.rpmRear', 'Rear RPM')} hide={rpmHidden.isHidden('rear')} />
                      </LineChart>
                    </ResponsiveContainer>
                  ) : noData}
                </ChartContainer>
              </FadeIn>
            </DynamicsPlacement>
          ),
        },
      ]} />
    </div>
  );
}
