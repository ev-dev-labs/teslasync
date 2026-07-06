import { useMemo } from 'react';
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

/** Utility time-of-use rate period for an hour-of-day bucket. */
export type TouPeriod = 'peak' | 'mid-peak' | 'off-peak';

/**
 * Canonical swatch colors shared by the hourly bars AND the legend so the two
 * can never drift apart (they previously did: the peak legend dot was rose-500
 * while the bar was red-500, and the mid dot was neon-cyan while the bar was
 * cyan-400). Mirrored from Tailwind red-500 / cyan-400 / emerald-500; applied
 * as dynamic values, which is the documented inline-style exception.
 */
export const TOU_PERIOD_COLORS: Record<TouPeriod, string> = {
  peak: '#ef4444',
  'mid-peak': '#22d3ee',
  'off-peak': '#10b981',
};

/**
 * Classify an hour-of-day into its time-of-use rate period. Peak = 2–7 PM
 * (14–19), off-peak = 10 PM–6 AM (22–05), everything else mid-peak. Non-finite
 * or out-of-range input is normalized into [0,23] so a malformed bucket still
 * resolves to a deterministic color instead of rendering an uncolored bar.
 */
export function classifyHour(hour: number): TouPeriod {
  const h = Number.isFinite(hour) ? Math.trunc(hour) : 0;
  const norm = ((h % 24) + 24) % 24;
  if (norm >= 14 && norm <= 19) return 'peak';
  if (norm >= 22 || norm < 6) return 'off-peak';
  return 'mid-peak';
}

/** Resolve the shared bar/legend color for an hour-of-day bucket. */
export function hourColor(hour: number): string {
  return TOU_PERIOD_COLORS[classifyHour(hour)];
}

/** Legend rows — same order + source-of-truth colors as the hourly bars. */
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
  // Null-safe before any `.length` / `.map`: an undefined prop must render the
  // section's empty state, never crash the whole Cost Analysis page.
  const rows = useMemo(() => hourlyData ?? [], [hourlyData]);

  return (
    <CostSection
      title={t('costAnalysis.tou.title', 'Electricity Rate Analysis (Time-of-Use)')}
      icon={<Clock className="h-4 w-4 text-amber-300" aria-hidden="true" />}
      isLoading={isLoading}
      error={error}
      onRetry={onRetry}
      isEmpty={rows.length === 0}
      emptyMessage={t('costAnalysis.charts.noData', 'Not enough data')}
      skeletonHeight={280}
    >
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Hourly bar chart */}
        <div className="lg:col-span-2">
          <div className="h-56 sm:h-64" role="img" aria-label={t('costAnalysis.tou.chartAria', 'Charging sessions by hour of day with peak and off-peak coloring')}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={rows}>
                <CartesianGrid {...chartGrid} />
                <XAxis dataKey="label" {...axisTickSm} interval={2} />
                <YAxis {...axisTickSm} tickFormatter={(v: number) => `${v}`} />
                <Tooltip content={<ChartTooltip />} />
                <Bar
                  dataKey="sessions"
                  name={t('costAnalysis.tou.sessions', 'Sessions')}
                  radius={[3, 3, 0, 0]}
                >
                  {rows.map((entry) => (
                    <Cell key={entry.hour} fill={hourColor(entry.hour)} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>

          {/* Legend — dot colors sourced from TOU_PERIOD_COLORS so they always
              match the bars above (previously drifted: rose vs red, neon vs cyan). */}
          <div className="mt-2 flex flex-wrap justify-center gap-6">
            {TOU_LEGEND.map(({ period, i18nKey, label }) => (
              <div key={period} className="flex items-center gap-1.5">
                <span
                  className="h-3 w-3 rounded-full"
                  style={{ backgroundColor: TOU_PERIOD_COLORS[period] }}
                  aria-hidden="true"
                />
                <Caption>{t(i18nKey, label)}</Caption>
              </div>
            ))}
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
