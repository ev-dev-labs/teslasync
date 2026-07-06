import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { TrendingDown, AlertTriangle, Lightbulb, Zap, Thermometer, Battery } from 'lucide-react';
import { Badge } from '@/components/ui';
import { StatCard } from '@/components/data-display';
import { EmptyState } from '@/components/feedback';
import { useBatteryDegradation } from '@/api/hooks/useEnergy';
import { useVehicles } from '@/api/hooks/useVehicles';
import { fmtNumber } from '@/lib/numberFormat';
import { useDateFormat } from '@/hooks/useDateFormat';
import { WidgetShell } from './WidgetShell';
import { WidgetTipCards, type TipItem } from './shared';
import type { WidgetProps } from './types';

/** Map risk factor name to an icon for display. Null-safe: a missing name
 *  falls through to the generic warning icon rather than throwing. */
export function riskIcon(name: string | null | undefined) {
  const lower = (name ?? '').toLowerCase();
  if (lower.includes('temp') || lower.includes('heat') || lower.includes('thermal')) {
    return <Thermometer className="h-3.5 w-3.5" />;
  }
  if (lower.includes('charge') || lower.includes('fast') || lower.includes('dc')) {
    return <Zap className="h-3.5 w-3.5" />;
  }
  if (lower.includes('battery') || lower.includes('soc') || lower.includes('depth')) {
    return <Battery className="h-3.5 w-3.5" />;
  }
  return <AlertTriangle className="h-3.5 w-3.5" />;
}

/** Classify degradation rate into a health tier */
export function healthTier(ratePctPerMonth: number): { label: string; variant: 'success' | 'warning' | 'danger'; key: string } {
  if (ratePctPerMonth <= 0.05) return { label: 'Healthy', variant: 'success', key: 'healthy' };
  if (ratePctPerMonth <= 0.12) return { label: 'Normal', variant: 'warning', key: 'normal' };
  return { label: 'Accelerated', variant: 'danger', key: 'accelerated' };
}

/** Risk score → impact level for WidgetTipCards */
export function scoreToImpact(score: number): 'high' | 'medium' | 'low' {
  if (score >= 7) return 'high';
  if (score >= 4) return 'medium';
  return 'low';
}

/** Map an impact level to the matching Badge variant. */
function impactVariant(impact: 'high' | 'medium' | 'low'): 'danger' | 'warning' | 'success' {
  if (impact === 'high') return 'danger';
  if (impact === 'medium') return 'warning';
  return 'success';
}

/**
 * Format an ISO date string as a localized "MMM YYYY" label. Returns an em
 * dash for a missing or unparseable date so a malformed API value never
 * throws a RangeError out of `Intl.DateTimeFormat` (which would crash the
 * whole widget render).
 */
export function formatProjectedMonth(dateStr: string | null | undefined, locale: string): string {
  if (!dateStr) return '—';
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return '—';
  try {
    return new Intl.DateTimeFormat(locale, { year: 'numeric', month: 'short' }).format(d);
  } catch {
    // Malformed BCP-47 locale tag — fall back to en-US so we still render.
    return new Intl.DateTimeFormat('en-US', { year: 'numeric', month: 'short' }).format(d);
  }
}

export default function BatteryDegradationForecastWidget({ vehicleId, size }: WidgetProps) {
  const { t } = useTranslation('dashboard');
  const { data: vehicles } = useVehicles();
  const id = vehicleId ?? vehicles?.[0]?.id ?? null;
  const idStr = id != null ? String(id) : null;
  const { locale } = useDateFormat();

  const { data, isLoading, isFetching, isStale, isError, error, dataUpdatedAt, refetch } =
    useBatteryDegradation(idStr);

  const isCompact = size.cols <= 1;

  const rate = data?.degradation_rate_pct_per_month ?? 0;
  const tier = useMemo(() => healthTier(rate), [rate]);
  const currentHealthPct = data?.current_health_pct ?? data?.current_health ?? null;
  const projectedDate = formatProjectedMonth(data?.projected_80pct_date, locale);

  const riskFactors = data?.risk_factors ?? [];
  const recommendations = data?.recommendations ?? [];

  const tipItems: TipItem[] = useMemo(
    () =>
      recommendations.map((rec, idx) => ({
        id: idx,
        icon: <Lightbulb className="h-3.5 w-3.5" />,
        title: t('widget.forecast.tip', 'Tip'),
        description: rec,
        impact: 'medium' as const,
        impactLabel: t('widget.forecast.recommendation', 'Recommendation'),
      })),
    [recommendations, t],
  );

  // Surface the panel whenever the API returned anything meaningful — a
  // health reading, a projected date, risk factors, or recommendations —
  // rather than hiding available risk/recommendation data behind the empty
  // state when the predictive model omits the health/projection fields.
  const hasData =
    currentHealthPct != null ||
    data?.projected_80pct_date != null ||
    riskFactors.length > 0 ||
    recommendations.length > 0;

  return (
    <WidgetShell
      title={isCompact ? undefined : t('widget.forecast.title', 'Battery Forecast')}
      icon={isCompact ? undefined : <TrendingDown className="h-3.5 w-3.5 text-neon-amber" />}
      loading={isLoading}
      error={error ? String(error) : null}
      updatedAt={dataUpdatedAt}
      isFetching={isFetching}
      isStale={isStale}
      isError={isError}
      onRefresh={() => refetch()}
    >
      {hasData ? (
        isCompact ? (
          /* ── Compact layout (1×2) ── */
          <div className="h-full flex flex-col items-center justify-center gap-1">
            <p className="text-2xl font-bold tabular-nums text-[var(--text-primary)]">
              {currentHealthPct != null ? `${fmtNumber(currentHealthPct, 1)}%` : '—'}
            </p>
            <Badge variant={tier.variant} size="sm">
              {t(`widget.forecast.${tier.key}`, tier.label)}
            </Badge>
          </div>
        ) : (
          /* ── Standard layout (2×4) ── */
          <div className="h-full flex flex-col gap-3 overflow-y-auto">
            {/* Projected 80% date — hero section */}
            <div className="text-center py-2">
              <p className="text-2xs uppercase tracking-wider text-[var(--text-muted)] mb-1">
                {t('widget.forecast.projected80', 'Projected 80% Capacity')}
              </p>
              <p className="text-2xl font-bold tabular-nums text-[var(--text-primary)]">
                {projectedDate}
              </p>
              <div className="flex items-center justify-center gap-2 mt-1.5">
                <Badge variant={tier.variant} size="sm">
                  {t(`widget.forecast.${tier.key}`, tier.label)}
                </Badge>
                {rate > 0 && (
                  <span className="text-xs text-[var(--text-muted)]">
                    −{fmtNumber(rate, 2)}%/{t('widget.mo', 'mo')}
                  </span>
                )}
              </div>
            </div>

            {/* Current health stat */}
            {currentHealthPct != null && (
              <StatCard
                label={t('widget.forecast.currentHealth', 'Current Health')}
                value={`${fmtNumber(currentHealthPct, 1)}%`}
              />
            )}

            {/* Risk factors list */}
            {riskFactors.length > 0 && (
              <div className="flex flex-col gap-1.5">
                <p className="text-2xs uppercase tracking-wider text-[var(--text-muted)]">
                  {t('widget.forecast.riskFactors', 'Risk Factors')}
                </p>
                <ul className="flex flex-col gap-1 overflow-y-auto max-h-40">
                  {riskFactors.slice(0, 5).map((rf, idx) => {
                    const impact = scoreToImpact(rf.score ?? 0);
                    return (
                      <li
                        key={`${rf.name ?? 'risk'}-${idx}`}
                        className="flex items-center gap-2 rounded-lg bg-white/[0.03] border border-white/[0.06] px-3 py-2 min-h-[44px]"
                      >
                        <span className="shrink-0 text-[var(--text-secondary)]">
                          {riskIcon(rf.name)}
                        </span>
                        <div className="flex-1 min-w-0">
                          <span className="text-sm text-[var(--text-primary)] truncate block">
                            {rf.label ?? rf.name ?? '—'}
                          </span>
                          <span className="text-2xs text-[var(--text-muted)] truncate block">
                            {rf.detail ?? '—'}
                          </span>
                        </div>
                        <Badge variant={impactVariant(impact)} size="sm">
                          {fmtNumber(rf.score, 0)}
                        </Badge>
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}

            {/* Recommendations as tip cards */}
            {tipItems.length > 0 && (
              <div className="flex flex-col gap-1.5">
                <p className="text-2xs uppercase tracking-wider text-[var(--text-muted)]">
                  {t('widget.forecast.recommendations', 'Recommendations')}
                </p>
                <WidgetTipCards tips={tipItems} maxTips={3} />
              </div>
            )}
          </div>
        )
      ) : (
        <EmptyState /* no-action: transient empty state — surfaces when source data is missing; no specific recovery action available */
          icon={<TrendingDown className="h-5 w-5" />}
          message={t('widget.forecast.noData', 'No degradation forecast data')}
          className="py-4"
        />
      )}
    </WidgetShell>
  );
}
