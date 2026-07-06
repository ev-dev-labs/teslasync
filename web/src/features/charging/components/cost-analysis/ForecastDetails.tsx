import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Fuel, Lightbulb, Zap } from 'lucide-react';
import { Text, Caption } from '@/components/ui';
import { AnimatedNumber, Currency } from '@/components/data-display';
import {
  ChartTooltip,
  ResponsiveContainer, PieChart, Pie, Cell, Tooltip,
} from '@/components/charts';
import { fmtNumber } from '@/lib/numberFormat';
import { useFormatting } from '@/hooks/useFormatting';
import type { CostForecastData } from '@/types/charging';
import { CostSection } from './CostSection';

interface ForecastDetailsProps {
  forecastData: CostForecastData | undefined;
  isLoading?: boolean;
  error?: unknown;
  onRetry?: () => void;
}

export function ForecastDetails({ forecastData, isLoading, error, onRetry }: ForecastDetailsProps) {
  const { t } = useTranslation();
  const { currencySymbol } = useFormatting();

  // Guard each band on the specific slice it renders — a partial forecast
  // payload (present envelope, missing breakdown/gas_comparison) must degrade
  // to that section's empty state, never throw on a nested field access.
  const breakdown = forecastData?.breakdown;
  const gas = forecastData?.gas_comparison;

  const homeLabel = t('Home');
  const superchargerLabel = t('Supercharger');

  // Stable reference for the donut series so the <Pie> doesn't re-animate on
  // unrelated parent re-renders; each share is null-safe down to the leaf.
  const breakdownData = useMemo(
    () => [
      { name: homeLabel, value: breakdown?.home?.pct ?? 0 },
      { name: superchargerLabel, value: breakdown?.supercharger?.pct ?? 0 },
    ],
    [breakdown, homeLabel, superchargerLabel],
  );

  // Drop null / blank insights so an all-empty list collapses to the empty
  // state instead of rendering hollow chips.
  const rawInsights = forecastData?.insights;
  const insights = useMemo(
    () =>
      (rawInsights ?? []).filter(
        (s): s is string => typeof s === 'string' && s.trim().length > 0,
      ),
    [rawInsights],
  );

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
      {/* Breakdown donut */}
      <CostSection
        title={t('costAnalysis.forecast.breakdown', 'Charging Breakdown')}
        isLoading={isLoading}
        error={error}
        onRetry={onRetry}
        isEmpty={!breakdown}
        emptyMessage={t('costAnalysis.forecast.noBreakdown', 'Breakdown will appear once charging data is available.')}
        skeletonHeight={180}
      >
        {breakdown && (
          <div className="flex flex-col items-center">
            <div className="h-44 w-full" role="img" aria-label={t('costAnalysis.forecast.breakdownAria', 'Home versus Supercharger charging share')}>
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={breakdownData}
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
            </div>
            <div className="mt-2 w-full space-y-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="inline-block h-2 w-2 rounded-full bg-emerald-500" aria-hidden="true" />
                  <Caption>{homeLabel}</Caption>
                </div>
                <Text size="xs" weight="medium" color="primary">
                  <Currency value={breakdown.home?.avg_cost_per_kwh} precision={3} />/kWh
                </Text>
              </div>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="inline-block h-2 w-2 rounded-full bg-amber-500" aria-hidden="true" />
                  <Caption>{superchargerLabel}</Caption>
                </div>
                <Text size="xs" weight="medium" color="primary">
                  <Currency value={breakdown.supercharger?.avg_cost_per_kwh} precision={3} />/kWh
                </Text>
              </div>
            </div>
          </div>
        )}
      </CostSection>

      {/* Savings */}
      <CostSection
        title={t('costAnalysis.forecast.savings', 'Gas vs EV Savings')}
        icon={<Fuel className="h-4 w-4 text-emerald-300" aria-hidden="true" />}
        isLoading={isLoading}
        error={error}
        onRetry={onRetry}
        isEmpty={!gas}
        emptyMessage={t('costAnalysis.forecast.noSavings', 'Savings data will appear once driving history is available.')}
        skeletonHeight={180}
      >
        {gas && (
          <div className="space-y-4">
            <div className="rounded-xl border border-neon-green/10 bg-neon-green/[0.06] p-4 text-center">
              <Text variant="metricLabel" as="p" className="mb-1">
                {t('costAnalysis.forecast.monthlySavings', 'Monthly Savings')}
              </Text>
              <Text as="p" size="3xl" weight="bold" className="text-emerald-300">
                {currencySymbol}<AnimatedNumber value={gas.monthly_savings ?? 0} decimals={0} />
              </Text>
            </div>
            <div className="grid grid-cols-2 gap-3 text-center">
              <div className="rounded-lg bg-white/[0.04] p-3">
                <Text as="p" variant="caption">{t('costAnalysis.forecast.annual', 'Annual')}</Text>
                <Text as="p" size="lg" weight="semibold" color="primary">
                  <Currency value={gas.annual_savings} precision={0} />
                </Text>
              </div>
              <div className="rounded-lg bg-white/[0.04] p-3">
                <Text as="p" variant="caption">{t('costAnalysis.forecast.lifetime', 'Lifetime')}</Text>
                <Text as="p" size="lg" weight="semibold" color="primary">
                  <Currency value={gas.lifetime_savings} precision={0} />
                </Text>
              </div>
            </div>
            <div className="space-y-1">
              <div className="flex justify-between">
                <Caption>{t('costAnalysis.forecast.gasCost', 'Gas cost/mo')}</Caption>
                <Currency value={gas.gas_cost_per_month} className="text-rose-300" />
              </div>
              <div className="flex justify-between">
                <Caption>{t('costAnalysis.forecast.evCost', 'EV cost/mo')}</Caption>
                <Currency value={gas.ev_cost_per_month} className="text-emerald-300" />
              </div>
              <div className="flex justify-between">
                <Caption>{t('costAnalysis.forecast.avgKm', 'Avg km/mo')}</Caption>
                <Caption>{fmtNumber(gas.avg_km_per_month, 0)}</Caption>
              </div>
            </div>
          </div>
        )}
      </CostSection>

      {/* Insights */}
      <CostSection
        title={t('costAnalysis.forecast.insights', 'Insights')}
        icon={<Lightbulb className="h-4 w-4 text-amber-300" aria-hidden="true" />}
        isLoading={isLoading}
        error={error}
        onRetry={onRetry}
        isEmpty={insights.length === 0}
        emptyMessage={t('costAnalysis.forecast.noInsights', 'Insights will appear as more data is collected.')}
        skeletonHeight={180}
      >
        <div className="space-y-3">
          {insights.map((insight, i) => (
            <div
              key={i}
              className="flex items-start gap-3 rounded-xl border border-white/[0.06] bg-white/[0.03] p-3"
            >
              <Zap className="mt-0.5 h-4 w-4 shrink-0 text-amber-300" aria-hidden="true" />
              <Text variant="bodySm">{insight}</Text>
            </div>
          ))}
        </div>
      </CostSection>
    </div>
  );
}
