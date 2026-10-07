import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Sparkles, Clock, BatteryCharging, DollarSign, Zap } from 'lucide-react';
import { Badge } from '@/components/ui';
import { EmptyState } from '@/components/feedback';
import { useChargingOptimizer } from '@/api/hooks/useCharging';
import { useVehicles } from '@/api/hooks/useVehicles';
import { fmtNumber, fmtInt } from '@/lib/numberFormat';
import { safeArray } from '@/lib/safeArray';
import { cn } from '@/lib/cn';
import { WidgetShell } from './WidgetShell';
import { WidgetTipCards, type TipItem } from './shared';
import type { WidgetProps } from './types';

const PRIORITY_IMPACT: Record<string, 'high' | 'medium' | 'low'> = {
  high: 'high',
  medium: 'medium',
  low: 'low',
};

function formatHour(hour: number): string {
  // Normalize to a 0–23 clock hour so malformed data (NaN, negative, or a
  // stray 24+/decimal hour) degrades to a valid label instead of "NaN PM".
  const h = Number.isFinite(hour) ? ((Math.round(hour) % 24) + 24) % 24 : 0;
  if (h === 0) return '12 AM';
  if (h === 12) return '12 PM';
  return h < 12 ? `${h} AM` : `${h - 12} PM`;
}

export default function ChargingOptimizerWidget({ vehicleId, size }: WidgetProps) {
  const { t } = useTranslation('dashboard');
  const { data: vehicles } = useVehicles();
  const vid = vehicleId ?? vehicles?.[0]?.id;
  const vehicleIdStr = vid != null ? String(vid) : null;

  const {
    data, isLoading, error, isFetching, isStale, isError, dataUpdatedAt, refetch,
  } = useChargingOptimizer(vehicleIdStr);

  const isCompact = size.cols <= 1;
  const isWide = size.cols >= 4;

  const schedule = data?.current_schedule;
  const costAnalysis = data?.cost_analysis;
  const recommendations = safeArray(data?.recommendations);

  const optimalStartHour = schedule?.most_common_start_hour ?? 0;
  const targetSoc = schedule?.avg_charge_to_pct ?? 0;
  const monthlySavings = costAnalysis?.potential_monthly_savings ?? 0;
  const peakPct = costAnalysis?.sessions_during_peak_pct ?? 0;
  const offpeakHours = safeArray(costAnalysis?.offpeak_hours);
  const peakHours = safeArray(costAnalysis?.peak_hours);

  const scheduleMatchesOptimal = peakPct < 30;

  const tips: TipItem[] = useMemo(
    () =>
      recommendations.map((rec, i) => {
        // Guard each entry: a malformed payload may carry null/partial recs.
        const priority = rec?.priority;
        return {
          id: i,
          icon: <Sparkles className="h-4 w-4" />,
          title: rec?.title ?? '—',
          description: rec?.detail ?? '—',
          impact: priority ? PRIORITY_IMPACT[priority] : undefined,
          impactLabel: priority
            ? t(`widget.chargingOptimizer.priority.${priority}`, priority)
            : undefined,
        };
      }),
    [recommendations, t],
  );

  const shellProps = {
    loading: isLoading,
    error: error ? String(error) : null,
    updatedAt: dataUpdatedAt,
    isFetching,
    isStale,
    isError,
    onRefresh: () => refetch(),
  };

  // ── Compact (1 col) ──
  if (isCompact) {
    return (
      <WidgetShell {...shellProps}>
        {!data ? (
          <EmptyState /* no-action: transient empty state — surfaces when source data is missing; no specific recovery action available */
            icon={<Sparkles className="h-5 w-5" />}
            message={t('widget.chargingOptimizer.noData', 'No optimizer data')}
            className="py-4"
          />
        ) : (
          <div className="flex h-full flex-col items-center justify-center gap-2 min-h-[44px]">
            <div className="flex items-center gap-1.5">
              <Clock className="h-4 w-4 text-emerald-400" />
              <span className="text-lg font-bold text-[var(--text-primary)]">
                {formatHour(optimalStartHour)}
              </span>
            </div>
            <span className="text-xs text-[var(--text-secondary)]">
              {t('widget.chargingOptimizer.targetSocShort', 'SOC {{pct}}%', { pct: fmtInt(targetSoc) })}
            </span>
            {monthlySavings > 0 && (
              <Badge variant="success" size="sm">
                {t('widget.chargingOptimizer.savingsShort', '${{amount}}/mo', { amount: fmtNumber(monthlySavings, 0) })}
              </Badge>
            )}
          </div>
        )}
      </WidgetShell>
    );
  }

  // ── Standard (2×2) and Wide (2×4+) ──
  return (
    <WidgetShell
      title={t('widget.chargingOptimizer.title', 'Charging Optimizer')}
      icon={<Sparkles className="h-3.5 w-3.5 text-emerald-400" />}
      {...shellProps}
    >
      {!data ? (
        <EmptyState /* no-action: transient empty state — surfaces when source data is missing; no specific recovery action available */
          icon={<Sparkles className="h-5 w-5" />}
          message={t('widget.chargingOptimizer.noData', 'No optimizer data')}
          className="py-4"
        />
      ) : (
        <div className="flex flex-col gap-3 h-full">
          {/* Key metrics row */}
          <div className="grid grid-cols-1 @xs:grid-cols-3 gap-2">
            <div className="flex flex-col items-center gap-1 rounded-lg bg-white/[0.03] p-2 min-h-[44px]">
              <Clock className="h-4 w-4 text-emerald-400" />
              <span className="text-sm font-semibold text-[var(--text-primary)]">
                {formatHour(optimalStartHour)}
              </span>
              <span className="text-2xs text-[var(--text-muted)] truncate">
                {t('widget.chargingOptimizer.optimalStart', 'Optimal start')}
              </span>
            </div>
            <div className="flex flex-col items-center gap-1 rounded-lg bg-white/[0.03] p-2 min-h-[44px]">
              <BatteryCharging className="h-4 w-4 text-blue-400" />
              <span className="text-sm font-semibold text-[var(--text-primary)]">
                {fmtInt(targetSoc)}%
              </span>
              <span className="text-2xs text-[var(--text-muted)] truncate">
                {t('widget.chargingOptimizer.targetSoc', 'Target SOC')}
              </span>
            </div>
            <div className="flex flex-col items-center gap-1 rounded-lg bg-white/[0.03] p-2 min-h-[44px]">
              <DollarSign className="h-4 w-4 text-amber-400" />
              <span className="text-sm font-semibold text-[var(--text-primary)]">
                ${fmtNumber(monthlySavings, 0)}
              </span>
              <span className="text-2xs text-[var(--text-muted)] truncate">
                {t('widget.chargingOptimizer.savingsLabel', 'Savings/mo')}
              </span>
            </div>
          </div>

          {/* Schedule match badge */}
          <div className="flex items-center justify-between">
            <span className="text-xs text-[var(--text-secondary)]">
              {t('widget.chargingOptimizer.peakUsage', 'Peak charging: {{pct}}%', { pct: fmtInt(peakPct) })}
            </span>
            <Badge variant={scheduleMatchesOptimal ? 'success' : 'warning'} size="sm">
              {scheduleMatchesOptimal
                ? t('widget.chargingOptimizer.optimized', 'Optimized')
                : t('widget.chargingOptimizer.canImprove', 'Can improve')}
            </Badge>
          </div>

          {/* Wide mode: 24h timeline bar */}
          {isWide && (
            <div className="flex flex-col gap-1">
              <span className="text-2xs text-[var(--text-muted)] uppercase tracking-wider">
                {t('widget.chargingOptimizer.rateTimeline', '24h Rate Timeline')}
              </span>
              <div
                className="flex h-6 rounded-md overflow-hidden border border-white/[0.06]"
                role="img"
                aria-label={t('widget.chargingOptimizer.rateTimeline', '24h Rate Timeline')}
              >
                {Array.from({ length: 24 }, (_, h) => {
                  const isPeak = peakHours.includes(h);
                  const isOffpeak = offpeakHours.includes(h);
                  const isCurrentStart = h === optimalStartHour;
                  return (
                    <div
                      key={h}
                      className={cn(
                        'flex-1 relative',
                        isPeak && 'bg-red-500/30',
                        isOffpeak && 'bg-emerald-500/30',
                        !isPeak && !isOffpeak && 'bg-white/[0.04]',
                      )}
                      title={`${formatHour(h)} — ${isPeak ? t('widget.chargingOptimizer.peak', 'Peak') : isOffpeak ? t('widget.chargingOptimizer.offpeak', 'Off-peak') : t('widget.chargingOptimizer.standard', 'Standard')}`}
                    >
                      {isCurrentStart && (
                        <div className="absolute inset-0 flex items-center justify-center">
                          <Zap className="h-3 w-3 text-emerald-300" aria-hidden="true" />
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
              <div className="flex justify-between text-2xs text-[var(--text-muted)]">
                <span>12 AM</span>
                <span>6 AM</span>
                <span>12 PM</span>
                <span>6 PM</span>
                <span>12 AM</span>
              </div>
            </div>
          )}

          {/* Recommendations as tip cards */}
          <div className="flex-1 min-h-0">
            <WidgetTipCards
              tips={tips}
              maxTips={isWide ? 5 : 3}
              compact={false}
              emptyMessage={t('widget.chargingOptimizer.noRecommendations', 'No recommendations')}
              emptyIcon={<Sparkles className="h-5 w-5" />}
            />
          </div>
        </div>
      )}
    </WidgetShell>
  );
}
