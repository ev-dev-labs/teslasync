import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Fuel, Lightbulb, Zap } from 'lucide-react';
import { Text } from '@/components/ui';
import { ChargingSummaryBrief } from '../operationalbrief-all/ChargingSummaryBrief';
import {
  ChartTooltip, ResponsiveContainer, PieChart, Pie, Cell, Tooltip, EmbeddedChart,
} from '@/components/charts';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';
import type { CostForecastData } from '@/types/charging';
import type { StatPeriod } from '@/lib/metric-reference';
import { CostStatSection } from './CostStatSection';
import { useStatFormatting } from './useStatFormatting';
import { kmToCanonicalMeters } from './displayBoundary';

interface ForecastDetailsProps {
  forecastData: CostForecastData | undefined;
  isLoading?: boolean;
  error?: unknown;
  onRetry?: () => void;
  period: StatPeriod;
}

/** Each independent returned slice keeps its own error/empty/retained truth. */
export function ForecastDetails({ forecastData, isLoading, error, onRetry, period }: ForecastDetailsProps) {
  const { t } = useTranslation();
  const { precision: displayPrecision } = useNumberFormatting();
  const { preferences } = useStatFormatting();
  const breakdown = forecastData?.breakdown;
  const gas = forecastData?.gas_comparison;
  const homeLabel = t('costAnalysis.forecast.home', 'Home');
  const superchargerLabel = t('chargerTypes.supercharger', 'Supercharger');
  const breakdownData = useMemo(
    () => [
      { name: homeLabel, value: breakdown?.home?.pct ?? 0 },
      { name: superchargerLabel, value: breakdown?.supercharger?.pct ?? 0 },
    ],
    [breakdown, homeLabel, superchargerLabel],
  );
  const rawInsights = forecastData?.insights;
  const insights = useMemo(
    () => (rawInsights ?? []).filter(
      (s): s is string => typeof s === 'string' && s.trim().length > 0,
    ),
    [rawInsights],
  );

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
      <CostStatSection
        title={t('costAnalysis.forecast.breakdown', 'Charging Breakdown')}
        isLoading={isLoading} error={error} onRetry={onRetry} retained={breakdown != null}
        isEmpty={!breakdown} period={period}
        emptyMessage={t('costAnalysis.forecast.noBreakdown', 'Breakdown will appear once charging data is available.')}
        skeletonHeight={180}>
        {periodHeaderId => (
          <div className="flex flex-col items-center">
            <EmbeddedChart
              title={t('costAnalysis.forecast.breakdown', 'Charging Breakdown')}
              ariaLabel={t('costAnalysis.forecast.breakdownAria', 'Home versus Supercharger charging share')}
              data={breakdownData}
              dataColumns={[
                { key: 'name', label: t('costAnalysis.forecast.chargerType', 'Charger type') },
                { key: 'value', label: t('costAnalysis.forecast.share', 'Share (%)') },
              ]}
              fluid={false} mobileHeight={176} height={176} className="w-full">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={breakdownData} cx="50%" cy="50%" innerRadius={50} outerRadius={75} dataKey="value">
                    <Cell fill="#22c55e" />
                    <Cell fill="#f59e0b" />
                  </Pie>
                  <Tooltip content={<ChartTooltip />} />
                </PieChart>
              </ResponsiveContainer>
            </EmbeddedChart>
            <ChargingSummaryBrief title={t('costAnalysis.forecast.breakdown', 'Charging Breakdown')}
              period={period} preferences={preferences} periodInHeader periodContextInHeader periodHeaderId={periodHeaderId}
              className="mt-2 w-full"
              metrics={[
                {
                  metricId: 'currency',
                  rawValue: breakdown?.home?.avg_cost_per_kwh,
                  label: homeLabel,
                  display: { precision: displayPrecision },
                  context: `${t('costAnalysis.stats.per', 'per')} kWh`,
                },
                {
                  metricId: 'currency',
                  rawValue: breakdown?.supercharger?.avg_cost_per_kwh,
                  label: superchargerLabel,
                  display: { precision: displayPrecision },
                  context: `${t('costAnalysis.stats.per', 'per')} kWh`,
                },
              ]} />
          </div>
        )}
      </CostStatSection>
      <CostStatSection
        title={t('costAnalysis.forecast.savings', 'Gas vs EV Savings')}
        icon={<Fuel className="h-4 w-4 text-emerald-300" aria-hidden="true" />}
        isLoading={isLoading} error={error} onRetry={onRetry} retained={gas != null}
        isEmpty={!gas} period={period}
        emptyMessage={t('costAnalysis.forecast.noSavings', 'Savings data will appear once driving history is available.')}
        skeletonHeight={180}>
        {periodHeaderId => (
          <ChargingSummaryBrief title={t('costAnalysis.forecast.savings', 'Gas vs EV Savings')}
            period={period} preferences={preferences} periodInHeader periodContextInHeader periodHeaderId={periodHeaderId}
            metrics={[
              {
                metricId: 'currency',
                rawValue: gas?.monthly_savings,
                label: t('costAnalysis.forecast.monthlySavings', 'Monthly Savings'),
                display: { precision: displayPrecision },
              },
              {
                metricId: 'currency',
                rawValue: gas?.annual_savings,
                label: t('costAnalysis.forecast.annual', 'Annual'),
                display: { precision: displayPrecision },
              },
              {
                metricId: 'currency',
                rawValue: gas?.lifetime_savings,
                label: t('costAnalysis.forecast.lifetime', 'Lifetime'),
                display: { precision: displayPrecision },
              },
              {
                metricId: 'currency',
                rawValue: gas?.gas_cost_per_month,
                label: t('costAnalysis.forecast.gasCost', 'Gas cost/mo'),
              },
              {
                metricId: 'currency',
                rawValue: gas?.ev_cost_per_month,
                label: t('costAnalysis.forecast.evCost', 'EV cost/mo'),
              },
              {
                metricId: 'distance',
                rawValue: kmToCanonicalMeters(gas?.avg_km_per_month),
                label: t('costAnalysis.forecast.avgKm', 'Avg km/mo'),
                display: { units: { distance: 'km' } },
              },
            ]} />
        )}
      </CostStatSection>
      <CostStatSection
        title={t('costAnalysis.forecast.insights', 'Insights')}
        icon={<Lightbulb className="h-4 w-4 text-amber-300" aria-hidden="true" />}
        isLoading={isLoading} error={error} onRetry={onRetry} retained={insights.length > 0}
        isEmpty={insights.length === 0} period={period}
        emptyMessage={t('costAnalysis.forecast.noInsights', 'Insights will appear as more data is collected.')}
        skeletonHeight={180}>
        <div className="space-y-3">
          {insights.map((insight, i) => (
            <div key={i}
              className="flex items-start gap-3 rounded-xl border border-white/[0.06] bg-white/[0.03] p-3">
              <Zap className="mt-0.5 h-4 w-4 shrink-0 text-amber-300" aria-hidden="true" />
              <Text variant="bodySm">{insight}</Text>
            </div>
          ))}
        </div>
      </CostStatSection>
    </div>
  );
}
