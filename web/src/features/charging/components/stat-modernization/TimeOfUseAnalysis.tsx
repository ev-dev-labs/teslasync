import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Clock } from 'lucide-react';
import { Text, Caption } from '@/components/ui';
import { EmptyState } from '@/components/feedback';
import { ChargingSummaryBrief } from '../operationalbrief-all/ChargingSummaryBrief';
import {
  ChartTooltip, chartGrid, axisTickSm, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Cell, EmbeddedChart,
} from '@/components/charts';
import type { StatPeriod } from '@/lib/metric-reference';
import type { HourBucket, TouInsights } from '../cost-analysis/types';
import { classifyHour, hourColor, TOU_PERIOD_COLORS, type TouPeriod } from '../cost-analysis/TimeOfUseAnalysis';
import { CostStatSection } from './CostStatSection';
import { useStatFormatting } from './useStatFormatting';

const TOU_LEGEND: ReadonlyArray<{ period: TouPeriod; i18nKey: string; label: string }> = [
  { period: 'peak', i18nKey: 'costAnalysis.tou.peak', label: 'Peak (2–7 PM)' },
  { period: 'mid-peak', i18nKey: 'costAnalysis.tou.midPeak', label: 'Mid-peak' },
  { period: 'off-peak', i18nKey: 'costAnalysis.tou.offPeak', label: 'Off-peak (10 PM–6 AM)' },
];

interface TimeOfUseAnalysisProps {
  hourlyData: HourBucket[];
  touInsights: TouInsights | null;
  isLoading?: boolean;
  error?: unknown;
  onRetry?: () => void;
  period: StatPeriod;
}

export function TimeOfUseAnalysis({
  hourlyData, touInsights, isLoading, error, onRetry, period,
}: TimeOfUseAnalysisProps) {
  const { t } = useTranslation();
  const { text, preferences } = useStatFormatting();
  const rows = useMemo(() => hourlyData ?? [], [hourlyData]);

  return (
    <CostStatSection
      title={t('costAnalysis.tou.title', 'Electricity Rate Analysis (Time-of-Use)')}
      icon={<Clock className="h-4 w-4 text-amber-300" aria-hidden="true" />}
      isLoading={isLoading} error={error} onRetry={onRetry} retained={rows.length > 0}
      isEmpty={rows.length === 0} period={period}
      emptyMessage={t('costAnalysis.charts.noData', 'Not enough data')} skeletonHeight={280}>
      {periodHeaderId => (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          <div className="lg:col-span-2">
            <EmbeddedChart
              title={t('costAnalysis.tou.hourlyDistribution', 'Hourly charging distribution')}
              ariaLabel={t('costAnalysis.tou.chartAria', 'Charging sessions by hour of day with peak and off-peak coloring')}
              data={rows.map(({ label, sessions, hour }) => ({ label, sessions, period: classifyHour(hour) }))}
              dataColumns={[
                { key: 'label', label: t('costAnalysis.tou.hour', 'Hour') },
                { key: 'sessions', label: t('costAnalysis.tou.sessions', 'Sessions') },
                { key: 'period', label: t('costAnalysis.tou.ratePeriod', 'Rate period') },
              ]}
              fluid={false} mobileHeight={224} height={256}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={rows}>
                  <CartesianGrid {...chartGrid} />
                  <XAxis dataKey="label" {...axisTickSm} interval={2} />
                  <YAxis {...axisTickSm} tickFormatter={(v: number) => `${v}`} />
                  <Tooltip content={<ChartTooltip />} />
                  <Bar dataKey="sessions" name={t('costAnalysis.tou.sessions', 'Sessions')} radius={[3, 3, 0, 0]}>
                    {rows.map((entry) => <Cell key={entry.hour} fill={hourColor(entry.hour)} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </EmbeddedChart>
            <div className="mt-2 flex flex-wrap justify-center gap-6">
              {TOU_LEGEND.map(({ period: ratePeriod, i18nKey, label }) => (
                <div key={ratePeriod} className="flex items-center gap-1.5">
                  <span className="h-3 w-3 rounded-full"
                    style={{ backgroundColor: TOU_PERIOD_COLORS[ratePeriod] }} aria-hidden="true" />
                  <Caption>{t(i18nKey, label)}</Caption>
                </div>
              ))}
            </div>
          </div>
          <div className="space-y-3">
            <Text as="h4" variant="label">{t('costAnalysis.tou.insights', 'Insights')}</Text>
            {touInsights ? (
              <ChargingSummaryBrief title={t('costAnalysis.tou.insights', 'Insights')}
                period={period} preferences={preferences} periodInHeader periodContextInHeader periodHeaderId={periodHeaderId}
                metrics={[
                  { metricId: 'text', rawValue: touInsights.cheapest.label,
                    label: t('costAnalysis.tou.cheapestHour', 'Cheapest Hour'),
                    context: `${t('costAnalysis.tou.avgCost', 'avg')} ${text('number', touInsights.cheapest.avgCost)} ${t('costAnalysis.tou.perSession', '/ session')}` },
                  { metricId: 'text', rawValue: touInsights.priciest.label,
                    label: t('costAnalysis.tou.priciestHour', 'Priciest Hour'),
                    context: `${t('costAnalysis.tou.avgCost', 'avg')} ${text('number', touInsights.priciest.avgCost)} ${t('costAnalysis.tou.perSession', '/ session')}` },
                  { metricId: 'text', rawValue: touInsights.busiest.label,
                    label: t('costAnalysis.tou.busiestHour', 'Busiest Hour'),
                    context: `${text('count', touInsights.busiest.sessions)} ${t('costAnalysis.tou.sessions', 'sessions')}` },
                  { metricId: 'percent', rawValue: touInsights.offPeakPct,
                    label: t('costAnalysis.tou.offPeakRatio', 'Off-Peak Charging'),
                    context: t('costAnalysis.tou.offPeakDesc', 'of sessions between 10 PM–6 AM') },
                ]} />
            ) : (
              <EmptyState
                message={t('costAnalysis.tou.noInsights', 'No insights available')}
                action={onRetry ? { label: t('common.retry', 'Retry'), onClick: onRetry } : undefined}
              />
            )}
          </div>
        </div>
      )}
    </CostStatSection>
  );
}
