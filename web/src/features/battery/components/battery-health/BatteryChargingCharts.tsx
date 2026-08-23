import { useMemo, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Activity, Gauge, Zap } from 'lucide-react';

import {
  Bar,
  BarChart,
  Cell,
  ChartContainer,
  ChartTooltip,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  axisTickSm,
  chartGrid,
} from '@/components/charts';
import { EmptyState, SectionErrorBoundary } from '@/components/feedback';
import { FadeIn } from '@/components/motion';
import { GlassPanel, SectionTitle, Text } from '@/components/ui';
import { fmtNumber, fmtPercent } from '@/lib/numberFormat';
import type { BatteryChargingAnalysis } from '@/types/energy';
import { computeEnergyBreakdown } from './helpers';

interface BatteryChargingChartsProps {
  analysis: BatteryChargingAnalysis;
  totalCycles: number;
}

function HabitStat({
  value,
  label,
  accent,
}: {
  value: ReactNode;
  label: string;
  accent?: string;
}) {
  return (
    <div className="text-center">
      <Text
        as="p"
        size="lg"
        weight="bold"
        color={accent ? undefined : 'primary'}
        className={`tabular-nums ${accent ?? ''}`}
      >
        {value}
      </Text>
      <Text as="p" size="2xs" color="muted" className="mt-0.5">
        {label}
      </Text>
    </div>
  );
}

function StatRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between border-b border-[var(--border-subtle)] py-2">
      <Text size="xs" color="secondary">{label}</Text>
      <Text size="sm" weight="semibold" color="primary">{value}</Text>
    </div>
  );
}

export default function BatteryChargingCharts({
  analysis,
  totalCycles,
}: BatteryChargingChartsProps) {
  const { t } = useTranslation();
  const chargeLevelDistribution = useMemo(
    () =>
      (analysis.charge_level_distribution ?? []).map((bucket) => ({
        range: `${bucket.min_soc_pct}–${bucket.max_soc_pct + 1}%`,
        startCount: bucket.start_count,
        endCount: bucket.end_count,
      })),
    [analysis.charge_level_distribution],
  );
  const energyBreakdown = useMemo(() => computeEnergyBreakdown(analysis), [analysis]);

  return (
    <>
      <SectionErrorBoundary
        name="battery:charge-level-dist"
        fallbackTitle={t('battery.section.chargeDistFailed', 'Charge level distribution failed to load')}
      >
        <FadeIn delay={0.25}>
          <GlassPanel className="p-4 sm:p-5">
            <div className="mb-4 flex flex-wrap items-center gap-x-2 gap-y-1">
              <SectionTitle className="flex items-center gap-2">
                <Zap className="h-4 w-4 text-amber-300" aria-hidden="true" />
                {t('battery.chart.chargeDist', 'Charge Level Distribution')}
              </SectionTitle>
              <Text size="2xs" color="muted">
                {t('battery.chart.chargeDistSub', 'Recent 100 sessions')}
              </Text>
            </div>
            {analysis.total_sessions > 0 && chargeLevelDistribution.length > 0 ? (
              <>
                <div className="h-44 sm:h-56 2xl:h-64">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={chargeLevelDistribution}>
                      {chartGrid}
                      <XAxis dataKey="range" tick={axisTickSm} tickLine={false} axisLine={false} />
                      <YAxis tick={axisTickSm} tickLine={false} axisLine={false} />
                      <Tooltip content={<ChartTooltip />} />
                      <Legend />
                      <Bar
                        dataKey="startCount"
                        name={t('battery.chart.chargeStarted', 'Charge Started')}
                        fill="#ef4444"
                        fillOpacity={0.5}
                        radius={[3, 3, 0, 0]}
                      />
                      <Bar
                        dataKey="endCount"
                        name={t('battery.chart.chargeEnded', 'Charge Ended')}
                        fill="#10b981"
                        fillOpacity={0.5}
                        radius={[3, 3, 0, 0]}
                      />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
                <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
                  <HabitStat
                    value={
                      analysis.avg_start_soc_pct == null
                        ? '—'
                        : fmtPercent(analysis.avg_start_soc_pct)
                    }
                    label={t('battery.habit.avgStart', 'Avg Start Level')}
                  />
                  <HabitStat
                    value={
                      analysis.avg_end_soc_pct == null
                        ? '—'
                        : fmtPercent(analysis.avg_end_soc_pct)
                    }
                    label={t('battery.habit.avgEnd', 'Avg End Level')}
                    accent="text-emerald-300"
                  />
                  <HabitStat
                    value={analysis.supercharger_count}
                    label={t('battery.habit.supercharger', 'Supercharger Sessions')}
                    accent="text-amber-300"
                  />
                  <HabitStat
                    value={analysis.ac_session_count}
                    label={t('battery.habit.home', 'Home Charges')}
                    accent="text-cyan-300"
                  />
                </div>
              </>
            ) : (
              <EmptyState
                icon={<Zap className="h-8 w-8" aria-hidden="true" />}
                message={t('battery.chart.noSessions', 'No charging session data yet')}
                className="py-8"
              />
            )}
          </GlassPanel>
        </FadeIn>
      </SectionErrorBoundary>

      <SectionErrorBoundary
        name="battery:acdc-breakdown"
        fallbackTitle={t('battery.section.acdcFailed', 'AC/DC energy breakdown failed to load')}
      >
        <FadeIn delay={0.3}>
          <section
            aria-label={t('battery.section.chargingAnalysis', 'Charging energy analysis')}
            className="grid grid-cols-1 gap-4 lg:grid-cols-2"
          >
            <ChartContainer
              className="h-full"
              title={t('battery.chart.acdc', 'AC / DC Energy Breakdown')}
              ariaLabel={t('battery.chart.acdc.aria', 'AC versus DC energy share pie chart')}
              exportable
              exportFilename="energy-breakdown"
            >
              {energyBreakdown ? (
                <div className="h-52 2xl:h-60">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={energyBreakdown.pieData}
                        dataKey="value"
                        nameKey="name"
                        cx="50%"
                        cy="50%"
                        outerRadius={80}
                        innerRadius={40}
                        strokeWidth={2}
                        stroke="rgba(0,0,0,0.3)"
                      >
                        {energyBreakdown.pieData.map((entry) => (
                          <Cell key={entry.name} fill={entry.fill} />
                        ))}
                      </Pie>
                      <Legend />
                      <Tooltip content={<ChartTooltip />} />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
              ) : (
                <EmptyState
                  icon={<Zap className="h-8 w-8" aria-hidden="true" />}
                  message={t('battery.chart.noBreakdown', 'No charging data for breakdown')}
                  className="py-8"
                />
              )}
            </ChartContainer>

            <GlassPanel className="h-full p-4 sm:p-5">
              <SectionTitle className="mb-4 flex items-center gap-2">
                <Gauge className="h-4 w-4 text-purple-300" aria-hidden="true" />
                {t('battery.stats.title', 'Charging Statistics')}
              </SectionTitle>
              {energyBreakdown ? (
                <div className="space-y-1">
                  <StatRow
                    label={t('battery.stats.totalSessions', 'Total Sessions')}
                    value={String(energyBreakdown.totalSessions)}
                  />
                  <StatRow
                    label={t('battery.stats.acSessions', 'AC Sessions')}
                    value={String(energyBreakdown.acCount)}
                  />
                  <StatRow
                    label={t('battery.stats.dcSessions', 'DC / Supercharger')}
                    value={String(energyBreakdown.dcCount)}
                  />
                  <StatRow
                    label={t('battery.stats.totalEnergy', 'Total Energy Added')}
                    value={`${fmtNumber(energyBreakdown.totalEnergy, 1)} kWh`}
                  />
                  <StatRow
                    label={t('battery.stats.cycles', 'Charge Cycles')}
                    value={String(totalCycles)}
                  />
                </div>
              ) : (
                <EmptyState
                  icon={<Activity className="h-8 w-8" aria-hidden="true" />}
                  message={t('battery.stats.empty', 'No charging statistics yet')}
                  className="py-8"
                />
              )}
            </GlassPanel>
          </section>
        </FadeIn>
      </SectionErrorBoundary>
    </>
  );
}
