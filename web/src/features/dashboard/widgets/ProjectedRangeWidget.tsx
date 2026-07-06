import { useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Navigation, Thermometer, Gauge, Mountain } from 'lucide-react';
import { AnimatedNumber } from '@/components/data-display';
import { Badge } from '@/components/ui';
import { EmptyState } from '@/components/feedback';
import { useProjectedRange } from '@/api/hooks/useEnergy';
import { useVehicles } from '@/api/hooks/useVehicles';
import { useUnits } from '@/hooks/useUnits';
import { fmtNumber } from '@/lib/numberFormat';
import { WidgetShell } from './WidgetShell';
import { WidgetBigNumber } from './shared';
import type { WidgetProps } from './types';
import { convertDistanceFromSI } from '@/lib/unitConversion';

function healthBadge(score: number, t: (k: string, d: string) => string) {
  if (score >= 90) return { text: t('widget.projectedRange.excellent', 'Excellent'), variant: 'success' as const };
  if (score >= 70) return { text: t('widget.projectedRange.good', 'Good'), variant: 'success' as const };
  if (score >= 50) return { text: t('widget.projectedRange.fair', 'Fair'), variant: 'warning' as const };
  return { text: t('widget.projectedRange.poor', 'Poor'), variant: 'error' as const };
}

export default function ProjectedRangeWidget({ vehicleId, size }: WidgetProps) {
  const { t } = useTranslation('dashboard');
  const { data: vehicles } = useVehicles();
  const id = vehicleId ?? vehicles?.[0]?.id ?? null;
  const idStr = id != null ? String(id) : null;

  const {
    data, isLoading, isFetching, isStale, isError, dataUpdatedAt, refetch, } = useProjectedRange(idStr);

  const { unitPrefs } = useUnits();
  // Stable across renders unless the distance preference changes, so the
  // derived range memos below actually cache instead of recomputing every
  // render (they list this converter in their dependency arrays).
  const toDistanceDisplay = useCallback(
    (value: number) => convertDistanceFromSI(value, unitPrefs.distance),
    [unitPrefs.distance],
  );

  const distanceUnit = unitPrefs.distance;

  const isCompact = size.cols <= 1;
  const isWide = size.cols >= 3;

  // Data is in km; convert to SI meters before display conversion.
  const projectedRange = useMemo(
    () => (data?.current_range_km != null ? toDistanceDisplay(data.current_range_km * 1000) : null),
    [data?.current_range_km, toDistanceDisplay],
  );

  const epaRange = useMemo(
    () => (data?.new_range_km != null ? toDistanceDisplay(data.new_range_km * 1000) : null),
    [data?.new_range_km, toDistanceDisplay],
  );

  const avgDaily = useMemo(
    () => (data?.avg_daily_km != null ? toDistanceDisplay(data.avg_daily_km * 1000) : null),
    [data?.avg_daily_km, toDistanceDisplay],
  );

  const healthScore = data?.health_score ?? null;
  const badge = healthScore != null ? healthBadge(healthScore, t) : undefined;

  // Comparison bar: projected / EPA ratio (clamped 0-100%)
  const rangePct = projectedRange != null && epaRange != null && epaRange > 0
    ? Math.min(100, Math.round((projectedRange / epaRange) * 100))
    : null;

  // Factors list for wide view — derived from available data fields
  const factors = useMemo(() => {
    if (!data) return [];
    return [
      {
        icon: Gauge,
        label: t('widget.projectedRange.degradation', 'Battery Degradation'),
        value: `${fmtNumber(data.degradation_pct ?? 0, 1)}%`,
      },
      {
        icon: Navigation,
        label: t('widget.projectedRange.avgDaily', 'Avg Daily Usage'),
        value: `${fmtNumber(avgDaily ?? 0, 0)} ${distanceUnit}`,
      },
      {
        icon: Thermometer,
        label: t('widget.projectedRange.capacity', 'Current Capacity'),
        value: `${fmtNumber(data.current_capacity_pct ?? 0, 1)}%`,
      },
      {
        icon: Mountain,
        label: t('widget.projectedRange.cycles', 'Battery Cycles'),
        value: fmtNumber(data.total_cycles ?? 0, 0),
      },
    ];
  }, [data, avgDaily, distanceUnit, t]);

  return (
    <WidgetShell
      title={isCompact ? undefined : t('widget.projectedRange.title', 'Projected Range')}
      icon={isCompact ? undefined : <Navigation className="h-3.5 w-3.5 text-neon-cyan" />}
      loading={isLoading}
      updatedAt={dataUpdatedAt}
      isFetching={isFetching}
      isStale={isStale}
      isError={isError}
      onRefresh={() => refetch()}
    >
      {data ? (
        isCompact ? (
          /* ── Compact (1×2): big number + confidence badge ── */
          <WidgetBigNumber
            value={projectedRange != null ? Math.round(projectedRange) : null}
            unit={distanceUnit}
            label={t('widget.projectedRange.projected', 'Projected')}
            badge={badge}
          />
        ) : isWide ? (
          /* ── Wide (2×4): range + comparison + factors list ── */
          <div className="h-full flex flex-col gap-3 min-h-0">
            {/* Primary range display */}
            <div className="text-center flex-shrink-0">
              <div className="flex items-baseline justify-center gap-1">
                {projectedRange != null ? (
                  <AnimatedNumber value={Math.round(projectedRange)} className="text-3xl font-bold text-neon-cyan" />
                ) : (
                  <span className="text-3xl font-bold text-[var(--text-muted)]">—</span>
                )}
                <span className="text-lg text-[var(--text-secondary)]">{distanceUnit}</span>
              </div>
              {badge && (
                <Badge variant={badge.variant === 'success' ? 'success' : badge.variant === 'warning' ? 'warning' : 'danger'} size="sm" className="mt-1">
                  {badge.text} · {fmtNumber(healthScore ?? 0, 0)}%
                </Badge>
              )}
            </div>

            {/* Comparison bar: projected vs EPA */}
            <ComparisonBar
              rangePct={rangePct}
              epaRange={epaRange}
              distanceUnit={distanceUnit}
              t={t}
            />

            {/* Factors list */}
            <div className="flex-1 min-h-0 overflow-y-auto">
              <p className="text-2xs text-[var(--text-muted)] uppercase tracking-wider mb-1.5">
                {t('widget.projectedRange.factors', 'Range Factors')}
              </p>
              <div className="flex flex-col gap-1.5">
                {factors.map((f) => (
                  <div key={f.label} className="flex items-center justify-between text-xs py-1 border-b border-white/[0.04] last:border-0 min-h-[44px]">
                    <div className="flex items-center gap-2 min-w-0">
                      <f.icon className="h-3.5 w-3.5 text-[var(--text-muted)] flex-shrink-0" />
                      <span className="text-[var(--text-secondary)] truncate">{f.label}</span>
                    </div>
                    <span className="text-[var(--text-primary)] font-medium flex-shrink-0 ml-2">{f.value}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        ) : (
          /* ── Standard (2×2): range + comparison bar + health badge ── */
          <div className="h-full flex flex-col justify-center gap-3">
            {/* Primary range display */}
            <div className="text-center">
              <div className="flex items-baseline justify-center gap-1">
                {projectedRange != null ? (
                  <AnimatedNumber value={Math.round(projectedRange)} className="text-3xl font-bold text-neon-cyan" />
                ) : (
                  <span className="text-3xl font-bold text-[var(--text-muted)]">—</span>
                )}
                <span className="text-lg text-[var(--text-secondary)]">{distanceUnit}</span>
              </div>
              {badge && (
                <Badge variant={badge.variant === 'success' ? 'success' : badge.variant === 'warning' ? 'warning' : 'danger'} size="sm" className="mt-1">
                  {badge.text} · {fmtNumber(healthScore ?? 0, 0)}%
                </Badge>
              )}
            </div>

            {/* Comparison bar */}
            <ComparisonBar
              rangePct={rangePct}
              epaRange={epaRange}
              distanceUnit={distanceUnit}
              t={t}
            />
          </div>
        )
      ) : (
        <EmptyState /* no-action: transient empty state — surfaces when source data is missing; no specific recovery action available */
          icon={<Navigation className="h-6 w-6" />}
          message={t('widget.projectedRange.noData', 'No projected range data')}
          className="py-4"
        />
      )}
    </WidgetShell>
  );
}

function ComparisonBar({
  rangePct,
  epaRange,
  distanceUnit,
  t,
}: {
  rangePct: number | null;
  epaRange: number | null;
  distanceUnit: string;
  t: (k: string, d: string) => string;
}) {
  return (
    <div className="flex-shrink-0">
      <div className="flex items-center justify-between text-2xs text-[var(--text-muted)] mb-1">
        <span>{t('widget.projectedRange.projected', 'Projected')}</span>
        <span>
          {t('widget.projectedRange.epa', 'EPA')}: {epaRange != null ? `${fmtNumber(epaRange, 0)} ${distanceUnit}` : '—'}
        </span>
      </div>
      <div
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={rangePct ?? undefined}
        aria-label={t('widget.projectedRange.rangeComparison', 'Projected range vs EPA rated')}
        className="h-2 rounded-full bg-[var(--surface-2)] overflow-hidden"
      >
        <div
          className="h-full rounded-full transition-all duration-slow"
          style={{
            width: `${rangePct ?? 0}%`,
            backgroundColor: rangePct != null && rangePct >= 80 ? '#10b981' : rangePct != null && rangePct >= 60 ? '#f59e0b' : '#ef4444',
          }}
        />
      </div>
      {rangePct != null && (
        <p className="text-2xs text-[var(--text-muted)] mt-0.5 text-center">
          {rangePct}% {t('widget.projectedRange.ofEpa', 'of EPA rated')}
        </p>
      )}
    </div>
  );
}
