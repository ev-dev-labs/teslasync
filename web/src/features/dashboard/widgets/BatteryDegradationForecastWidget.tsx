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

/** Map risk factor name to an icon for display */
function riskIcon(name: string) {
  const lower = name.toLowerCase();
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
function healthTier(ratePctPerMonth: number): { label: string; variant: 'success' | 'warning' | 'danger'; key: string } {
  if (ratePctPerMonth <= 0.05) return { label: 'Healthy', variant: 'success', key: 'healthy' };
  if (ratePctPerMonth <= 0.12) return { label: 'Normal', variant: 'warning', key: 'normal' };
  return { label: 'Accelerated', variant: 'danger', key: 'accelerated' };
}

/** Risk score → impact level for WidgetTipCards */
function scoreToImpact(score: number): 'high' | 'medium' | 'low' {
  if (score >= 7) return 'high';
  if (score >= 4) return 'medium';
  return 'low';
}

export default function BatteryDegradationForecastWidget({ vehicleId, size }: WidgetProps) {
  const { t } = useTranslation('dashboard');
  const { data: vehicles } = useVehicles();
  const id = vehicleId ?? vehicles?.[0]?.id ?? null;
  const idStr = id != null ? String(id) : null;
  const { locale } = useDateFormat();

  const { data, isLoading, isFetching, isStale, isError, dataUpdatedAt, refetch } =
    useBatteryDegradation(idStr);

  const isCompact = size.cols <= 1;

  const rate = data?.degradation_rate_pct_per_month ?? 0;
  const tier = useMemo(() => healthTier(rate), [rate]);
  const currentHealthPct = data?.current_health_pct ?? data?.current_health ?? null;
  const projectedDate = data?.projected_80pct_date
    ? new Intl.DateTimeFormat(locale, { year: 'numeric', month: 'short' }).format(new Date(data.projected_80pct_date))
    : '—';

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

  const hasData = currentHealthPct != null || (data?.projected_80pct_date != null);

  return (
    <WidgetShell
      title={isCompact ? undefined : t('widget.forecast.title', 'Battery Forecast')}
      icon={isCompact ? undefined : <TrendingDown className="h-3.5 w-3.5 text-neon-amber" />}
      loading={isLoading}
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
              <p className="text-[10px] uppercase tracking-wider text-[var(--text-muted)] mb-1">
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
                <p className="text-[10px] uppercase tracking-wider text-[var(--text-muted)]">
                  {t('widget.forecast.riskFactors', 'Risk Factors')}
                </p>
                <ul className="flex flex-col gap-1 overflow-y-auto max-h-40">
                  {riskFactors.slice(0, 5).map((rf) => (
                    <li
                      key={rf.name}
                      className="flex items-center gap-2 rounded-lg bg-white/[0.03] border border-white/[0.06] px-3 py-2 min-h-[44px]"
                    >
                      <span className="shrink-0 text-[var(--text-secondary)]">
                        {riskIcon(rf.name)}
                      </span>
                      <div className="flex-1 min-w-0">
                        <span className="text-sm text-[var(--text-primary)] truncate block">
                          {rf.label ?? rf.name}
                        </span>
                        <span className="text-[10px] text-[var(--text-muted)] truncate block">
                          {rf.detail ?? '—'}
                        </span>
                      </div>
                      <Badge
                        variant={scoreToImpact(rf.score) === 'high' ? 'danger' : scoreToImpact(rf.score) === 'medium' ? 'warning' : 'success'}
                        size="sm"
                      >
                        {fmtNumber(rf.score, 0)}
                      </Badge>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* Recommendations as tip cards */}
            {tipItems.length > 0 && (
              <div className="flex flex-col gap-1.5">
                <p className="text-[10px] uppercase tracking-wider text-[var(--text-muted)]">
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
