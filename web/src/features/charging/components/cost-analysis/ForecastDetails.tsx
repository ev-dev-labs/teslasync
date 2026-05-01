import { useTranslation } from 'react-i18next';
import { Fuel, Lightbulb, Zap } from 'lucide-react';
import { GlassPanel } from '@/components/ui';
import { FadeIn } from '@/components/motion';
import { AnimatedNumber } from '@/components/data-display';
import { EmptyState } from '@/components/feedback';
import {
  ChartTooltip,
  ResponsiveContainer, PieChart, Pie, Cell, Tooltip,
} from '@/components/charts';
import { fmtNumber } from '@/lib/numberFormat';
import type { CostForecastData } from '@/types/charging';

interface ForecastDetailsProps {
  forecastData: CostForecastData | undefined;
}

export function ForecastDetails({ forecastData }: ForecastDetailsProps) {
  const { t } = useTranslation();

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
      {/* Breakdown donut */}
      <FadeIn>
        <GlassPanel className="p-6">
          <h3 className="mb-4 text-sm font-semibold text-white">
            {t('costAnalysis.forecast.breakdown', 'Charging Breakdown')}
          </h3>
          {forecastData ? (
            <div className="flex flex-col items-center">
              <ResponsiveContainer width="100%" height={180}>
                <PieChart>
                  <Pie
                    data={[
                      { name: t('Home'), value: forecastData.breakdown.home.pct },
                      { name: t('Supercharger'), value: forecastData.breakdown.supercharger.pct },
                    ]}
                    cx="50%"
                    cy="50%"
                    innerRadius={50}
                    outerRadius={75}
                    dataKey="value"
                  >
                    <Cell fill="#22c55e" />
                    <Cell fill="#f59e0b" />
                  </Pie>
                  <Tooltip content={<ChartTooltip />} />
                </PieChart>
              </ResponsiveContainer>
              <div className="mt-2 space-y-2 text-xs w-full">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="inline-block h-2 w-2 rounded-full bg-green-500" />
                    <span className="text-white/70">{t('Home')}</span>
                  </div>
                  <span className="font-medium text-white">${fmtNumber(forecastData.breakdown.home.avg_cost_per_kwh, 3)}/kWh</span>
                </div>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="inline-block h-2 w-2 rounded-full bg-amber-500" />
                    <span className="text-white/70">{t('Supercharger')}</span>
                  </div>
                  <span className="font-medium text-white">${fmtNumber(forecastData.breakdown.supercharger.avg_cost_per_kwh, 3)}/kWh</span>
                </div>
              </div>
            </div>
          ) : (
            <EmptyState message={t('costAnalysis.forecast.noBreakdown', 'Breakdown will appear once charging data is available.')} />
          )}
        </GlassPanel>
      </FadeIn>

      {/* Savings */}
      <FadeIn>
        <GlassPanel className="p-6">
          <h3 className="mb-4 flex items-center gap-2 text-sm font-semibold text-white">
            <Fuel className="h-4 w-4 text-neon-green" />
            {t('costAnalysis.forecast.savings', 'Gas vs EV Savings')}
          </h3>
          {forecastData ? (
            <div className="space-y-4">
              <div className="rounded-xl p-4 bg-neon-green/[0.06] border border-neon-green/10 text-center">
                <p className="text-[10px] uppercase tracking-wider text-white/40 mb-1">
                  {t('costAnalysis.forecast.monthlySavings', 'Monthly Savings')}
                </p>
                <p className="text-3xl font-bold text-emerald-300">
                  $<AnimatedNumber value={forecastData.gas_comparison.monthly_savings} decimals={0} />
                </p>
              </div>
              <div className="grid grid-cols-2 gap-3 text-center">
                <div className="rounded-lg bg-white/[0.04] p-3">
                  <p className="text-[10px] text-white/40">{t('costAnalysis.forecast.annual', 'Annual')}</p>
                  <p className="text-lg font-semibold text-white">${fmtNumber(forecastData.gas_comparison.annual_savings, 0)}</p>
                </div>
                <div className="rounded-lg bg-white/[0.04] p-3">
                  <p className="text-[10px] text-white/40">{t('costAnalysis.forecast.lifetime', 'Lifetime')}</p>
                  <p className="text-lg font-semibold text-white">${fmtNumber(forecastData.gas_comparison.lifetime_savings, 0)}</p>
                </div>
              </div>
              <div className="text-xs text-white/40 space-y-1">
                <div className="flex justify-between">
                  <span>{t('costAnalysis.forecast.gasCost', 'Gas cost/mo')}</span>
                  <span className="text-red-400">${fmtNumber(forecastData.gas_comparison.gas_cost_per_month, 2)}</span>
                </div>
                <div className="flex justify-between">
                  <span>{t('costAnalysis.forecast.evCost', 'EV cost/mo')}</span>
                  <span className="text-green-400">${fmtNumber(forecastData.gas_comparison.ev_cost_per_month, 2)}</span>
                </div>
                <div className="flex justify-between">
                  <span>{t('costAnalysis.forecast.avgKm', 'Avg km/mo')}</span>
                  <span>{fmtNumber(forecastData.gas_comparison.avg_km_per_month, 0)}</span>
                </div>
              </div>
            </div>
          ) : (
            <EmptyState message={t('costAnalysis.forecast.noSavings', 'Savings data will appear once driving history is available.')} />
          )}
        </GlassPanel>
      </FadeIn>

      {/* Insights */}
      <FadeIn>
        <GlassPanel className="p-6">
          <h3 className="mb-4 flex items-center gap-2 text-sm font-semibold text-white">
            <Lightbulb className="h-4 w-4 text-neon-amber" />
            {t('costAnalysis.forecast.insights', 'Insights')}
          </h3>
          {(forecastData?.insights ?? []).length > 0 ? (
            <div className="space-y-3">
              {(forecastData?.insights ?? []).map((insight, i) => (
                <div
                  key={i}
                  className="flex items-start gap-3 rounded-xl p-3 bg-white/[0.03] border border-white/[0.06]"
                >
                  <Zap className="h-4 w-4 mt-0.5 shrink-0 text-neon-amber" />
                  <p className="text-sm text-white/70">{insight}</p>
                </div>
              ))}
            </div>
          ) : (
            <EmptyState message={t('costAnalysis.forecast.noInsights', 'Insights will appear as more data is collected.')} />
          )}
        </GlassPanel>
      </FadeIn>
    </div>
  );
}
