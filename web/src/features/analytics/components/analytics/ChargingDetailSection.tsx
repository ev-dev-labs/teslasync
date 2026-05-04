import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { DollarSign } from 'lucide-react';
import { GlassPanel } from '@/components/ui';
import { MetricCard } from '@/components/data-display';
import {
  ChartTooltip,
  chartGrid, axisTick, axisTickSm, chartMarginLabeled, chartAnimation, safe, CHART_COLORS,
  ComposedChart, Line, Area, Bar,
  XAxis, YAxis, Tooltip, ResponsiveContainer, Legend,
  AREA_DEFAULTS, areaGradient,
} from '@/components/charts';
import { EmptyState } from '@/components/feedback';
import { fmtNumber, fmtInt } from '@/lib/numberFormat';
import type { FleetAnalytics } from '@/api/types';
import { SectionTitle } from './helpers';

export function ChargingDetailSection({ data }: { data: FleetAnalytics | undefined }) {
  const { t } = useTranslation();

  const ca = data?.charging_analytics;
  const brands = ca?.charger_brands ?? [];
  const chargerTypes = ca?.charger_types ?? [];
  const monthlyTrend = ca?.monthly_trend ?? [];
  const costStats = ca?.cost_stats;

  const brandLeaderboard = useMemo(() => {
    const maxCount = brands.reduce((m, b) => Math.max(m, safe(b.count)), 0) || 1;
    return brands.map((b) => ({ ...b, pct: (safe(b.count) / maxCount) * 100 }));
  }, [brands]);

  return (
    <>
      {/* Charger Brands */}
      <GlassPanel className="p-4">
        <SectionTitle>{t('analytics.charging.chargerBrands', 'Charger Brands')}</SectionTitle>
        {brandLeaderboard.length > 0 ? (
          <div className="mt-3 space-y-3">
            {brandLeaderboard.map((b, idx) => (
              <div key={b.brand}>
                <div className="flex items-center justify-between text-xs mb-1">
                  <span className="text-[var(--text-primary)] font-medium">
                    #{idx + 1} {b.brand}
                  </span>
                  <span className="text-[var(--text-muted)]">
                    {fmtInt(b.count)} {t('analytics.charging.sessions', 'sessions')}
                  </span>
                </div>
                <div className="h-2 rounded-full bg-white/[0.06] overflow-hidden">
                  <div
                    className="h-full rounded-full bg-neon-green transition-all duration-slow"
                    style={{ width: `${b.pct}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        ) : (
          <EmptyState /* no-action: transient empty state — surfaces when source data is missing; no specific recovery action available */ message={t('analytics.charging.noBrands', 'No charger brand data')} />
        )}
      </GlassPanel>

      {/* Monthly Charging Trend */}
      <GlassPanel className="p-4">
        <SectionTitle>{t('analytics.charging.monthlyTrend', 'Monthly Charging Trend')}</SectionTitle>
        {monthlyTrend.length > 0 ? (
          <ResponsiveContainer width="100%" height={300}>
            <ComposedChart data={monthlyTrend} margin={chartMarginLabeled} {...chartAnimation}>
              {chartGrid}
              <XAxis dataKey="month" tick={axisTickSm} />
              <YAxis yAxisId="left" tick={axisTick} />
              <YAxis yAxisId="right" orientation="right" tick={axisTick} />
              <Tooltip content={<ChartTooltip />} />
              <Legend />
              {areaGradient('monthlyEnergyGrad', CHART_COLORS[1])}
              <Area {...AREA_DEFAULTS} yAxisId="left" dataKey="energy" name={t('analytics.charging.energykWh', 'Energy (kWh)')} stroke={CHART_COLORS[1]} fill="url(#monthlyEnergyGrad)" />
              <Line {...AREA_DEFAULTS} yAxisId="right" dataKey="avg_power" name={t('analytics.charging.avgPowerkW', 'Avg Power (kW)')} stroke={CHART_COLORS[3]} />
              <Bar yAxisId="left" dataKey="sessions" name={t('analytics.charging.sessions', 'Sessions')} fill={CHART_COLORS[2]} radius={[3, 3, 0, 0]} opacity={0.6} />
            </ComposedChart>
          </ResponsiveContainer>
        ) : (
          <EmptyState /* no-action: transient empty state — surfaces when source data is missing; no specific recovery action available */ message={t('analytics.charging.noMonthly', 'No monthly data')} />
        )}
      </GlassPanel>

      {/* Cost Analysis Cards */}
      <GlassPanel className="p-4">
        <SectionTitle>{t('analytics.charging.costAnalysis', 'Cost Analysis')}</SectionTitle>
        {costStats ? (
          <div className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-4">
            <MetricCard
              label={t('analytics.charging.minCost', 'Min Cost')}
              value={`$${fmtNumber(safe(costStats.min), 2)}`}
              icon={<DollarSign className="h-4 w-4" />}
              color="green"
            />
            <MetricCard
              label={t('analytics.charging.avgCost', 'Avg Cost')}
              value={`$${fmtNumber(safe(costStats.avg), 2)}`}
              icon={<DollarSign className="h-4 w-4" />}
              color="cyan"
            />
            <MetricCard
              label={t('analytics.charging.medianCost', 'Median Cost')}
              value={`$${fmtNumber(safe(costStats.median), 2)}`}
              icon={<DollarSign className="h-4 w-4" />}
              color="purple"
            />
            <MetricCard
              label={t('analytics.charging.maxCost', 'Max Cost')}
              value={`$${fmtNumber(safe(costStats.max), 2)}`}
              icon={<DollarSign className="h-4 w-4" />}
              color="amber"
            />
          </div>
        ) : (
          <EmptyState /* no-action: transient empty state — surfaces when source data is missing; no specific recovery action available */ message={t('analytics.charging.noCostStats', 'No cost statistics')} />
        )}
      </GlassPanel>

      {/* Cost by Charger Type */}
      <GlassPanel className="p-4">
        <SectionTitle>{t('analytics.charging.costByType', 'Cost by Charger Type')}</SectionTitle>
        {chargerTypes.length > 0 ? (
          <div className="mt-3 space-y-3">
            {chargerTypes.map((ct, i) => {
              const totalSessions = chargerTypes.reduce((s, x) => s + safe(x.count), 0);
              const pct = totalSessions > 0 ? (safe(ct.count) / totalSessions) * 100 : 0;
              return (
                <div key={i} className="flex items-center gap-3">
                  <span className="w-28 text-xs text-right font-medium text-[var(--text-secondary)]">{ct.type}</span>
                  <div className="flex-1 h-3 rounded-full bg-white/[0.06] overflow-hidden">
                    <div
                      className="h-full rounded-full transition-all duration-slow"
                      style={{ width: `${pct}%`, backgroundColor: CHART_COLORS[i % CHART_COLORS.length] }}
                    />
                  </div>
                  <span className="w-20 text-xs font-mono text-right text-[var(--text-primary)]">
                    {safe(ct.count)} ({fmtInt(pct)}%)
                  </span>
                </div>
              );
            })}
          </div>
        ) : (
          <EmptyState /* no-action: transient empty state — surfaces when source data is missing; no specific recovery action available */ message={t('analytics.charging.noCostByType', 'No charger type data')} />
        )}
      </GlassPanel>
    </>
  );
}
