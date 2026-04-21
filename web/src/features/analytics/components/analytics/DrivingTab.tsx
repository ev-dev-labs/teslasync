import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { GlassPanel } from '@/components/ui';
import {
  ChartTooltip, ChartGradient,
  chartGrid, axisTick, axisTickSm, chartMarginLabeled, chartAnimation, safe, CHART_COLORS,
  BarChart, Bar, ComposedChart, Line, AreaChart, Area, ScatterChart, Scatter,
  XAxis, YAxis, Tooltip, ResponsiveContainer, Legend, ZAxis,
} from '@/components/charts';
import { EmptyState } from '@/components/feedback';
import { FadeIn } from '@/components/motion';
import { useSettings } from '@/hooks/useSettings';
import type { FleetAnalytics } from '@/api/types';
import { SectionTitle } from './helpers';
import { DrivingPerformanceCards } from './DrivingPerformanceCards';
import { DrivingTemperatureStats } from './DrivingTemperatureStats';

export function DrivingTab({ data }: { data: FleetAnalytics | undefined }) {
  const { t } = useTranslation();
  const { convertDistance, convertTemp, convertEfficiency, distanceUnit, tempUnit, efficiencyUnit } = useSettings();

  const da = data?.drive_analytics;
  const speedDist = da?.speed_distribution ?? [];
  const distDist = da?.distance_distribution ?? [];
  const hourly = da?.hourly_pattern ?? [];
  const tempEff = da?.temp_vs_efficiency ?? [];
  const dailyTrend = da?.daily_trend ?? [];
  const durationDist = da?.duration_distribution ?? [];
  const effTrend = useMemo(() => dailyTrend.filter((d) => safe(d.efficiency) > 0), [dailyTrend]);

  return (
    <FadeIn className="space-y-4 mt-4">
      <DrivingPerformanceCards data={data} />

      {/* Speed Distribution */}
      <GlassPanel className="p-4">
        <SectionTitle>{t('analytics.driving.speedDist', 'Speed Distribution')}</SectionTitle>
        {speedDist.length > 0 ? (
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={speedDist} margin={chartMarginLabeled} {...chartAnimation}>
              {chartGrid}
              <XAxis dataKey="range" tick={axisTickSm} />
              <YAxis tick={axisTick} />
              <Tooltip content={<ChartTooltip />} />
              <Bar dataKey="count" name={t('analytics.driving.trips', 'Trips')} fill={CHART_COLORS[0]} radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        ) : (
          <EmptyState message={t('analytics.driving.noSpeed', 'No speed data')} />
        )}
      </GlassPanel>

      {/* Trip Distance Distribution */}
      <GlassPanel className="p-4">
        <SectionTitle>{t('analytics.driving.distDist', 'Trip Distance Distribution')}</SectionTitle>
        {distDist.length > 0 ? (
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={distDist} margin={chartMarginLabeled} {...chartAnimation}>
              {chartGrid}
              <XAxis dataKey="range" tick={axisTickSm} />
              <YAxis tick={axisTick} />
              <Tooltip content={<ChartTooltip />} />
              <Bar dataKey="count" name={t('analytics.driving.trips', 'Trips')} fill={CHART_COLORS[2]} radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        ) : (
          <EmptyState message={t('analytics.driving.noDistDist', 'No distance distribution data')} />
        )}
      </GlassPanel>

      {/* Hourly Driving Pattern */}
      <GlassPanel className="p-4">
        <SectionTitle>{t('analytics.driving.hourlyPattern', 'Hourly Driving Pattern')}</SectionTitle>
        {hourly.length > 0 ? (
          <ResponsiveContainer width="100%" height={280}>
            <ComposedChart data={hourly} margin={chartMarginLabeled} {...chartAnimation}>
              {chartGrid}
              <XAxis dataKey="hour" tick={axisTickSm} tickFormatter={(h: number) => `${h}:00`} />
              <YAxis yAxisId="left" tick={axisTick} />
              <YAxis yAxisId="right" orientation="right" tick={axisTick} />
              <Tooltip content={<ChartTooltip />} />
              <Legend />
              <Bar yAxisId="left" dataKey="drives" name={t('analytics.driving.drives', 'Drives')} fill={CHART_COLORS[0]} radius={[3, 3, 0, 0]} />
              <Line yAxisId="right" type="monotone" dataKey="distance" name={t('analytics.driving.distance', 'Distance')} stroke={CHART_COLORS[3]} strokeWidth={2} dot={false} />
            </ComposedChart>
          </ResponsiveContainer>
        ) : (
          <EmptyState message={t('analytics.driving.noHourly', 'No hourly data')} />
        )}
      </GlassPanel>

      {/* Temp vs Efficiency */}
      <GlassPanel className="p-4">
        <SectionTitle>{t('analytics.driving.tempVsEff', 'Temperature vs Efficiency')}</SectionTitle>
        {tempEff.length > 0 ? (
          <ResponsiveContainer width="100%" height={280}>
            <ScatterChart margin={chartMarginLabeled}>
              {chartGrid}
              <XAxis dataKey="temp" name={t('analytics.driving.temp', 'Temp')} tick={axisTick} unit={tempUnit} type="number" />
              <YAxis dataKey="efficiency" name={t('analytics.driving.efficiency', 'Efficiency')} tick={axisTick} unit={` ${efficiencyUnit}`} type="number" />
              <ZAxis dataKey="distance" range={[30, 300]} name={distanceUnit} />
              <Tooltip content={<ChartTooltip />} />
              <Scatter
                data={tempEff.map((d) => ({
                  temp: convertTemp(safe(d.temp)),
                  efficiency: convertEfficiency(safe(d.efficiency)),
                  distance: convertDistance(safe(d.distance)),
                }))}
                fill={CHART_COLORS[1]}
              />
            </ScatterChart>
          </ResponsiveContainer>
        ) : (
          <EmptyState message={t('analytics.driving.noTempEff', 'No temperature data')} />
        )}
      </GlassPanel>

      {/* Daily Driving Trend */}
      <GlassPanel className="p-4">
        <SectionTitle>{t('analytics.driving.dailyTrend', 'Daily Driving Trend')}</SectionTitle>
        {dailyTrend.length > 0 ? (
          <ResponsiveContainer width="100%" height={280}>
            <ComposedChart data={dailyTrend} margin={chartMarginLabeled} {...chartAnimation}>
              {chartGrid}
              <XAxis dataKey="date" tick={axisTickSm} tickFormatter={(v: string) => v.slice(5)} />
              <YAxis yAxisId="left" tick={axisTick} />
              <YAxis yAxisId="right" orientation="right" tick={axisTick} />
              <Tooltip content={<ChartTooltip />} />
              <Legend />
              <defs>
                <ChartGradient id="dailyDistGrad" color={CHART_COLORS[0]} />
              </defs>
              <Area yAxisId="left" type="monotone" dataKey="distance" name={distanceUnit} stroke={CHART_COLORS[0]} fill="url(#dailyDistGrad)" strokeWidth={2} />
              <Line yAxisId="right" type="monotone" dataKey="drives" name={t('analytics.driving.drives', 'Drives')} stroke={CHART_COLORS[3]} strokeWidth={2} dot={false} />
            </ComposedChart>
          </ResponsiveContainer>
        ) : (
          <EmptyState message={t('analytics.driving.noDailyTrend', 'No daily trend data')} />
        )}
      </GlassPanel>

      {/* Drive Duration Distribution */}
      <GlassPanel className="p-4">
        <SectionTitle>{t('analytics.driving.durationDist', 'Drive Duration Distribution')}</SectionTitle>
        {durationDist.length > 0 ? (
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={durationDist} margin={chartMarginLabeled} {...chartAnimation}>
              {chartGrid}
              <XAxis dataKey="range" tick={axisTickSm} />
              <YAxis tick={axisTick} />
              <Tooltip content={<ChartTooltip />} />
              <Bar dataKey="count" name={t('analytics.driving.drives', 'Drives')} fill={CHART_COLORS[4]} radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        ) : (
          <EmptyState message={t('analytics.driving.noDurationData', 'Not enough drive data for distribution chart')} />
        )}
      </GlassPanel>

      {/* Efficiency Trend */}
      <GlassPanel className="p-4">
        <SectionTitle>{t('analytics.driving.effTrend', 'Efficiency Trend')}</SectionTitle>
        {effTrend.length > 0 ? (
          <ResponsiveContainer width="100%" height={260}>
            <AreaChart data={effTrend} margin={chartMarginLabeled} {...chartAnimation}>
              {chartGrid}
              <XAxis dataKey="date" tick={axisTickSm} tickFormatter={(v: string) => v.slice(5)} />
              <YAxis tick={axisTick} />
              <Tooltip content={<ChartTooltip />} />
              <defs>
                <ChartGradient id="effTrendGrad" color={CHART_COLORS[1]} />
              </defs>
              <Area type="monotone" dataKey="efficiency" name={efficiencyUnit} stroke={CHART_COLORS[1]} fill="url(#effTrendGrad)" strokeWidth={2} />
            </AreaChart>
          </ResponsiveContainer>
        ) : (
          <EmptyState message={t('analytics.driving.noEffTrend', 'No efficiency trend data')} />
        )}
      </GlassPanel>

      <DrivingTemperatureStats data={data} />
    </FadeIn>
  );
}
