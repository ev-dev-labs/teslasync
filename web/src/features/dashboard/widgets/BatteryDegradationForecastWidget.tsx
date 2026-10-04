import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { TrendingDown, AlertTriangle, Lightbulb, Zap, Thermometer, Battery } from 'lucide-react';
import { Badge } from '@/components/ui';
import { EmptyState } from '@/components/feedback';
import { useBatteryDegradation } from '@/api/hooks/useEnergy';
import { useVehicles } from '@/api/hooks/useVehicles';

import { knownNumber } from '@/api/dataState';
import { useDataState } from '@/hooks/useDataState';
import { dashboardTokens } from '../lib/dashboardTokens';
import { useDateFormat } from '@/hooks/useDateFormat';
import { WidgetShell } from './WidgetShell';
import { WidgetBigNumber, WidgetStatGrid, WidgetTipCards, type TipItem } from './shared';
import type { WidgetProps } from './types';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';

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
  const { fmtNumber } = useNumberFormatting();
  const { t } = useTranslation('dashboard');
  const { data: vehicles } = useVehicles();
  const id = vehicleId ?? vehicles?.[0]?.id ?? null;
  const idStr = id != null ? String(id) : null;
  const { locale } = useDateFormat();

  const query = useBatteryDegradation(idStr);
  const { data, isLoading, isFetching, isStale, isError, error, dataUpdatedAt, refetch } = query;
  const trust = useDataState(query, { provenance: 'inferred' });

  const isCompact = size.cols <= 1;

  const rate = knownNumber(data?.degradation_rate_pct_per_month);
  const tier = rate != null ? healthTier(rate) : null;
  const currentHealthPct = knownNumber(data?.current_health_pct) ?? knownNumber(data?.current_health);
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
    rate != null ||
    (data?.horizon_outlook?.points?.length ?? 0) > 0 ||
    data?.projected_80pct_date != null ||
    riskFactors.length > 0 ||
    recommendations.length > 0;
  const emptySectionMessage = hasData
    ? t('widget.emptyMessage', 'This widget has no qualifying data yet.')
    : t('widget.forecast.noData', 'No degradation forecast data');

  return (
    <WidgetShell
      title={t('widget.forecast.title', 'Battery forecast')}
      icon={isCompact ? undefined : <TrendingDown className="h-3.5 w-3.5" />}
      loading={isLoading}
      dataState={data != null || isLoading || isError || error ? trust : undefined}
      updatedAt={dataUpdatedAt}
      isFetching={isFetching}
      isStale={isStale}
      isError={isError}
      onRefresh={() => refetch()}
    >
      {isCompact ? (
          /* ── Compact layout (1×2) ── */
          <div className="flex min-w-0 flex-col gap-2">
            <WidgetBigNumber value={currentHealthPct != null ? `${fmtNumber(currentHealthPct)}%` : null} label={t('widget.forecast.currentHealth', 'Current health')} />
            {tier && <Badge variant={tier.variant} size="sm" className="self-start">
              {t(`widget.forecast.${tier.key}`, tier.label)}
            </Badge>}
            {!hasData && <EmptyState icon={<TrendingDown className="h-5 w-5" />} message={t('widget.forecast.noData', 'No degradation forecast data')}
              action={{ label: t('common.refresh', 'Refresh'), onClick: () => { void refetch(); } }} />}
          </div>
        ) : (
          /* ── Standard layout (2×4) ── */
          <div className="flex min-w-0 flex-col gap-3">
            {/* Projected 80% date — hero section */}
            <div className="flex min-w-0 flex-col gap-2">
              <WidgetBigNumber value={projectedDate === '—' ? null : projectedDate} label={t('widget.forecast.projected80', 'Projected 80% capacity')} animated={false} />
              {tier && <Badge variant={tier.variant} size="sm" className="self-start">
                  {t(`widget.forecast.${tier.key}`, tier.label)}
              </Badge>}
            </div>

            {/* Current health stat */}
            <WidgetStatGrid stats={[
              { label: t('widget.forecast.currentHealth', 'Current health'), value: currentHealthPct != null ? `${fmtNumber(currentHealthPct)}%` : null },
              { label: t('widget.degradation', 'Degradation'), value: rate != null ? `${rate > 0 ? '−' : ''}${fmtNumber(rate)}%/${t('widget.mo', 'mo')}` : null },
            ]} cols={2} />

            {/* Horizon outlook: 1/3/5-year twin readout */}
              <div className="flex flex-col gap-1.5">
                <h4 className={dashboardTokens.metricLabel}>
                  {t('widget.forecast.horizon', '1 / 3 / 5-year outlook')}
                </h4>
                {(data?.horizon_outlook?.points?.length ?? 0) > 0 ? <ul className="grid grid-cols-1 gap-2 @xs:grid-cols-3">
                  {(data?.horizon_outlook?.points ?? []).map((p) => (
                    <li
                      key={p.years}
                      className="min-w-0 border-b border-[var(--border-subtle)] py-2"
                    >
                      <p className={dashboardTokens.metricLabel}>
                        {t('widget.forecast.years', '{{n}} yr', { n: p.years })}
                      </p>
                      <p className={dashboardTokens.secondaryMetric}>
                        {knownNumber(p.health_pct) != null ? `${fmtNumber(p.health_pct)}%` : '—'}
                      </p>
                      <p className={dashboardTokens.metricLabel}>
                        {knownNumber(p.confidence_low) != null ? fmtNumber(p.confidence_low) : '—'}–{knownNumber(p.confidence_high) != null ? fmtNumber(p.confidence_high) : '—'}
                      </p>
                    </li>
                  ))}
                </ul> : (
                  // no-action: Outlook points are read-only model output; the widget owns refresh.
                  <EmptyState message={emptySectionMessage} />
                )}
              </div>

            {/* Risk factors list */}
              <div className="flex flex-col gap-1.5">
                <h4 className={dashboardTokens.metricLabel}>
                  {t('widget.forecast.riskFactors', 'Risk factors')}
                </h4>
                {riskFactors.length > 0 ? <ul className="flex flex-col gap-1">
                  {riskFactors.slice(0, 5).map((rf, idx) => {
                    const score = knownNumber(rf.score);
                    const impact = score != null ? scoreToImpact(score) : null;
                    return (
                      <li
                        key={`${rf.name ?? 'risk'}-${idx}`}
                        className="flex min-w-0 items-start gap-2 border-b border-[var(--border-subtle)] py-2"
                      >
                        <span className="shrink-0 text-[var(--text-secondary)]">
                          {riskIcon(rf.name)}
                        </span>
                        <div className="flex-1 min-w-0">
                          <span className={`${dashboardTokens.title} block break-words`}>
                            {rf.label ?? rf.name ?? '—'}
                          </span>
                          <span className={`${dashboardTokens.metricLabel} block break-words`}>
                            {rf.detail ?? '—'}
                          </span>
                        </div>
                        <Badge variant={impact != null ? impactVariant(impact) : 'neutral'} size="sm">
                          {score != null ? fmtNumber(score) : '—'}
                        </Badge>
                      </li>
                    );
                  })}
                </ul> : (
                  // no-action: Missing model risk factors cannot be authored here; the widget owns refresh.
                  <EmptyState message={emptySectionMessage} />
                )}
              </div>

            {/* Recommendations as tip cards */}
              <div className="flex flex-col gap-1.5">
                <h4 className={dashboardTokens.metricLabel}>
                  {t('widget.forecast.recommendations', 'Recommendations')}
                </h4>
                <WidgetTipCards tips={tipItems} maxTips={3} emptyMessage={t('widget.chargingOptimizer.noRecommendations', 'No recommendations')} />
              </div>
          </div>
      )}
    </WidgetShell>
  );
}
