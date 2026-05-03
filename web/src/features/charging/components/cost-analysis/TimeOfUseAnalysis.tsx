import { useTranslation } from 'react-i18next';
import { Clock } from 'lucide-react';
import { GlassPanel } from '@/components/ui';
import {
  ChartTooltip, chartGrid, axisTickSm,
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Cell,
} from '@/components/charts';
import { useChartPalette } from '@/hooks/useChartPalette';
import { fmtNumber, fmtInt } from '@/lib/numberFormat';
import type { HourBucket, TouInsights } from './types';

interface TimeOfUseAnalysisProps {
  hourlyData: HourBucket[];
  touInsights: TouInsights | null;
}

export function TimeOfUseAnalysis({ hourlyData, touInsights }: TimeOfUseAnalysisProps) {
  const { t } = useTranslation();
  const palette = useChartPalette();

  return (
    <GlassPanel className="p-4">
      <h3 className="mb-4 flex items-center gap-2 text-sm font-semibold text-white">
        <Clock className="h-4 w-4 text-amber-400" />
        {t('costAnalysis.tou.title', 'Electricity Rate Analysis (Time-of-Use)')}
      </h3>
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Hourly bar chart */}
        <div className="lg:col-span-2">
          {hourlyData.length > 0 ? (
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={hourlyData}>
                <CartesianGrid {...chartGrid} />
                <XAxis
                  dataKey="label"
                  {...axisTickSm}
                  interval={2}
                />
                <YAxis
                  {...axisTickSm}
                  tickFormatter={(v: number) => `${v}`}
                />
                <Tooltip content={<ChartTooltip />} />
                <Bar
                  dataKey="sessions"
                  name={t('costAnalysis.tou.sessions', 'Sessions')}
                  radius={[3, 3, 0, 0]}
                >
                  {hourlyData.map((entry) => {
                    const isPeak = entry.hour >= 14 && entry.hour <= 19;
                    const isOffPeak = entry.hour >= 22 || entry.hour < 6;
                    const color = isPeak
                      ? '#ef4444'
                      : isOffPeak
                        ? '#10b981'
                        : palette[0];
                    return <Cell key={entry.hour} fill={color} />;
                  })}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <div className="flex h-[260px] items-center justify-center text-sm text-[var(--text-muted)]">
              {t('costAnalysis.charts.noData', 'Not enough data')}
            </div>
          )}

          {/* Legend for peak / off-peak */}
          <div className="mt-2 flex justify-center gap-6">
            <div className="flex items-center gap-1.5">
              <div className="h-3 w-3 rounded-full bg-red-500" />
              <span className="text-xs text-[var(--text-muted)]">
                {t('costAnalysis.tou.peak', 'Peak (2–7 PM)')}
              </span>
            </div>
            <div className="flex items-center gap-1.5">
              <div
                className="h-3 w-3 rounded-full bg-[#00f0ff]"
              />
              <span className="text-xs text-[var(--text-muted)]">
                {t('costAnalysis.tou.midPeak', 'Mid-peak')}
              </span>
            </div>
            <div className="flex items-center gap-1.5">
              <div className="h-3 w-3 rounded-full bg-green-500" />
              <span className="text-xs text-[var(--text-muted)]">
                {t('costAnalysis.tou.offPeak', 'Off-peak (10 PM–6 AM)')}
              </span>
            </div>
          </div>
        </div>

        {/* ToU insights */}
        <div className="space-y-3">
          <h4 className="text-xs font-medium uppercase tracking-wider text-[var(--text-muted)]">
            {t('costAnalysis.tou.insights', 'Insights')}
          </h4>
          {touInsights ? (
            <>
              <GlassPanel className="p-3">
                <p className="text-xs text-[var(--text-muted)]">
                  {t('costAnalysis.tou.cheapestHour', 'Cheapest Hour')}
                </p>
                <p className="mt-1 text-lg font-semibold text-green-400">
                  {touInsights.cheapest.label}
                </p>
                <p className="text-[10px] text-[var(--text-muted)]">
                  {t('costAnalysis.tou.avgCost', 'avg')} $
                  {fmtNumber(touInsights.cheapest.avgCost, 3)}{' '}
                  {t('costAnalysis.tou.perSession', '/ session')}
                </p>
              </GlassPanel>
              <GlassPanel className="p-3">
                <p className="text-xs text-[var(--text-muted)]">
                  {t('costAnalysis.tou.priciestHour', 'Priciest Hour')}
                </p>
                <p className="mt-1 text-lg font-semibold text-red-400">
                  {touInsights.priciest.label}
                </p>
                <p className="text-[10px] text-[var(--text-muted)]">
                  {t('costAnalysis.tou.avgCost', 'avg')} $
                  {fmtNumber(touInsights.priciest.avgCost, 3)}{' '}
                  {t('costAnalysis.tou.perSession', '/ session')}
                </p>
              </GlassPanel>
              <GlassPanel className="p-3">
                <p className="text-xs text-[var(--text-muted)]">
                  {t('costAnalysis.tou.busiestHour', 'Busiest Hour')}
                </p>
                <p className="mt-1 text-lg font-semibold text-cyan-400">
                  {touInsights.busiest.label}
                </p>
                <p className="text-[10px] text-[var(--text-muted)]">
                  {fmtInt(touInsights.busiest.sessions)}{' '}
                  {t('costAnalysis.tou.sessions', 'sessions')}
                </p>
              </GlassPanel>
              <GlassPanel className="p-3">
                <p className="text-xs text-[var(--text-muted)]">
                  {t('costAnalysis.tou.offPeakRatio', 'Off-Peak Charging')}
                </p>
                <p className="mt-1 text-lg font-semibold text-emerald-400">
                  {fmtNumber(touInsights.offPeakPct, 1)}%
                </p>
                <p className="text-[10px] text-[var(--text-muted)]">
                  {t('costAnalysis.tou.offPeakDesc', 'of sessions between 10 PM–6 AM')}
                </p>
              </GlassPanel>
            </>
          ) : (
            <div className="flex h-32 items-center justify-center text-sm text-[var(--text-muted)]">
              {t('costAnalysis.tou.noInsights', 'No insights available')}
            </div>
          )}
        </div>
      </div>
    </GlassPanel>
  );
}
