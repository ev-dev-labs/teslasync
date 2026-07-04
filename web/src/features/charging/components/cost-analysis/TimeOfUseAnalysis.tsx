import { useTranslation } from 'react-i18next';
import { Clock } from 'lucide-react';
import { GlassPanel, Text, Caption } from '@/components/ui';
import { EmptyState } from '@/components/feedback';
import {
  ChartTooltip, chartGrid, axisTickSm,
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Cell,
} from '@/components/charts';
import { fmtNumber, fmtInt } from '@/lib/numberFormat';
import { CostSection } from './CostSection';
import type { HourBucket, TouInsights } from './types';

interface TimeOfUseAnalysisProps {
  hourlyData: HourBucket[];
  touInsights: TouInsights | null;
  isLoading?: boolean;
  error?: unknown;
  onRetry?: () => void;
}

interface InsightCardProps {
  label: string;
  value: string;
  valueClass: string;
  sub: string;
}

function InsightCard({ label, value, valueClass, sub }: InsightCardProps) {
  return (
    <GlassPanel className="p-3">
      <Text as="p" variant="caption">{label}</Text>
      <Text as="p" size="lg" weight="semibold" className={`mt-1 ${valueClass}`}>{value}</Text>
      <Text as="p" variant="caption">{sub}</Text>
    </GlassPanel>
  );
}

export function TimeOfUseAnalysis({
  hourlyData, touInsights, isLoading, error, onRetry,
}: TimeOfUseAnalysisProps) {
  const { t } = useTranslation();

  return (
    <CostSection
      title={t('costAnalysis.tou.title', 'Electricity Rate Analysis (Time-of-Use)')}
      icon={<Clock className="h-4 w-4 text-amber-300" aria-hidden="true" />}
      isLoading={isLoading}
      error={error}
      onRetry={onRetry}
      isEmpty={hourlyData.length === 0}
      emptyMessage={t('costAnalysis.charts.noData', 'Not enough data')}
      skeletonHeight={280}
    >
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Hourly bar chart */}
        <div className="lg:col-span-2">
          <div className="h-56 sm:h-64" role="img" aria-label={t('costAnalysis.tou.chartAria', 'Charging sessions by hour of day with peak and off-peak coloring')}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={hourlyData}>
                <CartesianGrid {...chartGrid} />
                <XAxis dataKey="label" {...axisTickSm} interval={2} />
                <YAxis {...axisTickSm} tickFormatter={(v: number) => `${v}`} />
                <Tooltip content={<ChartTooltip />} />
                <Bar
                  dataKey="sessions"
                  name={t('costAnalysis.tou.sessions', 'Sessions')}
                  radius={[3, 3, 0, 0]}
                >
                  {hourlyData.map((entry) => {
                    const isPeak = entry.hour >= 14 && entry.hour <= 19;
                    const isOffPeak = entry.hour >= 22 || entry.hour < 6;
                    const color = isPeak ? '#ef4444' : isOffPeak ? '#10b981' : '#22d3ee';
                    return <Cell key={entry.hour} fill={color} />;
                  })}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>

          {/* Legend for peak / off-peak */}
          <div className="mt-2 flex flex-wrap justify-center gap-6">
            <div className="flex items-center gap-1.5">
              <span className="h-3 w-3 rounded-full bg-rose-500" aria-hidden="true" />
              <Caption>{t('costAnalysis.tou.peak', 'Peak (2–7 PM)')}</Caption>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="h-3 w-3 rounded-full bg-neon-cyan" aria-hidden="true" />
              <Caption>{t('costAnalysis.tou.midPeak', 'Mid-peak')}</Caption>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="h-3 w-3 rounded-full bg-emerald-500" aria-hidden="true" />
              <Caption>{t('costAnalysis.tou.offPeak', 'Off-peak (10 PM–6 AM)')}</Caption>
            </div>
          </div>
        </div>

        {/* ToU insights */}
        <div className="space-y-3">
          <Text as="h4" variant="label">
            {t('costAnalysis.tou.insights', 'Insights')}
          </Text>
          {touInsights ? (
            <>
              <InsightCard
                label={t('costAnalysis.tou.cheapestHour', 'Cheapest Hour')}
                value={touInsights.cheapest.label}
                valueClass="text-emerald-300"
                sub={`${t('costAnalysis.tou.avgCost', 'avg')} ${fmtNumber(touInsights.cheapest.avgCost, 3)} ${t('costAnalysis.tou.perSession', '/ session')}`}
              />
              <InsightCard
                label={t('costAnalysis.tou.priciestHour', 'Priciest Hour')}
                value={touInsights.priciest.label}
                valueClass="text-rose-300"
                sub={`${t('costAnalysis.tou.avgCost', 'avg')} ${fmtNumber(touInsights.priciest.avgCost, 3)} ${t('costAnalysis.tou.perSession', '/ session')}`}
              />
              <InsightCard
                label={t('costAnalysis.tou.busiestHour', 'Busiest Hour')}
                value={touInsights.busiest.label}
                valueClass="text-cyan-300"
                sub={`${fmtInt(touInsights.busiest.sessions)} ${t('costAnalysis.tou.sessions', 'sessions')}`}
              />
              <InsightCard
                label={t('costAnalysis.tou.offPeakRatio', 'Off-Peak Charging')}
                value={`${fmtNumber(touInsights.offPeakPct, 1)}%`}
                valueClass="text-emerald-300"
                sub={t('costAnalysis.tou.offPeakDesc', 'of sessions between 10 PM–6 AM')}
              />
            </>
          ) : (
            <EmptyState
              /* no-action: transient empty state — no per-hour insight once sessions exist in range */
              message={t('costAnalysis.tou.noInsights', 'No insights available')}
            />
          )}
        </div>
      </div>
    </CostSection>
  );
}
