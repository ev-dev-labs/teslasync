import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Clock } from 'lucide-react';
import { Badge } from '@/components/ui';
import { StatCard } from '@/components/data-display';
import { EmptyState } from '@/components/feedback';
import { useChargePlans, useRatePlans } from '@/api/hooks/useCharging';
import { useVehicles } from '@/api/hooks/useVehicles';
import { useFormatting } from '@/hooks/useFormatting';
import { useDateFormat } from '@/hooks/useDateFormat';
import { fmtNumber, fmtInt } from '@/lib/numberFormat';
import { WidgetShell } from './WidgetShell';
import { WidgetDetailCard, type DetailEntry } from './shared';
import type { WidgetProps } from './types';

/**
 * Maps a charge-plan status to a semantic <Badge> variant. Exported for direct
 * Badge usage (which speaks 'danger'). A `null`/`undefined`/unknown status
 * collapses to the neutral tone rather than throwing, so a partially-populated
 * plan from the API still renders.
 */
export function badgeVariant(status: string | null | undefined): 'success' | 'warning' | 'danger' | 'neutral' {
  switch (status) {
    case 'completed':
      return 'success';
    case 'active':
    case 'scheduled':
      return 'warning';
    case 'failed':
    case 'cancelled':
      return 'danger';
    default:
      return 'neutral';
  }
}

/**
 * Variant for DetailEntry badges. `WidgetDetailCard` speaks 'error' where the
 * raw Badge speaks 'danger', so this thin adapter reuses {@link badgeVariant}
 * and remaps the single differing tone — keeping one source of truth for the
 * status→tone mapping.
 */
export function detailBadgeVariant(status: string | null | undefined): 'success' | 'warning' | 'error' | 'neutral' {
  const variant = badgeVariant(status);
  return variant === 'danger' ? 'error' : variant;
}

/**
 * Compose a "date time" cell from an already-formatted date + time pair,
 * collapsing to a single "—" when either side is the placeholder. Without this
 * an unscheduled plan rendered the nonsensical double placeholder "— —", since
 * both `formatDate` and `formatTime` independently return "—" for an
 * empty/invalid timestamp.
 */
export function joinDateTime(datePart: string, timePart: string): string {
  const FALLBACK = '—';
  const hasDate = Boolean(datePart) && datePart !== FALLBACK;
  const hasTime = Boolean(timePart) && timePart !== FALLBACK;
  if (!hasDate && !hasTime) return FALLBACK;
  if (!hasTime) return datePart;
  if (!hasDate) return timePart;
  return `${datePart} ${timePart}`;
}

export default function ChargePlansWidget({ vehicleId, size }: WidgetProps) {
  const { t } = useTranslation('dashboard');
  const { data: vehicles } = useVehicles();
  const id = vehicleId ?? vehicles?.[0]?.id ?? 0;
  const { formatCurrency } = useFormatting();
  const { formatTime, formatDateShort: formatDate } = useDateFormat();

  const {
    data: plans,
    isLoading: plansLoading,
    isFetching: plansFetching,
    isStale: plansStale,
    isError: plansError,
    dataUpdatedAt: plansUpdatedAt,
    refetch: refetchPlans,
  } = useChargePlans(id > 0 ? id : undefined);

  const {
    data: ratePlans,
    isLoading: ratesLoading,
    isFetching: ratesFetching,
    isStale: ratesStale,
    isError: ratesError,
    dataUpdatedAt: ratesUpdatedAt,
    refetch: refetchRates,
  } = useRatePlans();

  const isLoading = plansLoading || ratesLoading;
  const isFetching = plansFetching || ratesFetching;
  const isStale = plansStale || ratesStale;
  const isError = plansError || ratesError;
  const updatedAt = Math.max(plansUpdatedAt ?? 0, ratesUpdatedAt ?? 0);

  const safePlans = plans ?? [];
  const safeRates = ratePlans ?? [];

  const activePlan = useMemo(
    () => safePlans.find((p) => p.status === 'active' || p.status === 'scheduled') ?? safePlans[0] ?? null,
    [safePlans],
  );

  const isCompact = size.cols <= 1;

  const planEntries: DetailEntry[] = useMemo(() => {
    if (!activePlan) return [];

    const items: DetailEntry[] = [];

    items.push({
      label: t('widget.chargePlans.targetSoc', 'Target SOC'),
      value: `${fmtInt(activePlan.target_soc ?? 0)}%`,
      badge: { text: activePlan.status ?? '—', variant: detailBadgeVariant(activePlan.status) },
    });

    items.push({
      label: t('widget.chargePlans.departure', 'Departure'),
      value: activePlan.depart_by ? formatTime(activePlan.depart_by) : '—',
    });

    items.push({
      label: t('widget.chargePlans.schedStart', 'Scheduled Start'),
      value: joinDateTime(formatDate(activePlan.scheduled_start), formatTime(activePlan.scheduled_start)),
    });

    items.push({
      label: t('widget.chargePlans.schedEnd', 'Scheduled End'),
      value: joinDateTime(formatDate(activePlan.scheduled_end), formatTime(activePlan.scheduled_end)),
    });

    items.push({
      label: t('widget.chargePlans.estEnergy', 'Est. Energy'),
      value: activePlan.estimated_kwh != null ? `${fmtNumber(activePlan.estimated_kwh, 1)} kWh` : '—',
    });

    items.push({
      label: t('widget.chargePlans.estCost', 'Est. Cost'),
      value: activePlan.estimated_cost != null ? formatCurrency(activePlan.estimated_cost) : '—',
    });

    if (activePlan.savings != null && activePlan.savings > 0) {
      items.push({
        label: t('widget.chargePlans.savings', 'Savings'),
        value: formatCurrency(activePlan.savings),
        badge: { text: t('widget.chargePlans.saved', 'saved'), variant: 'success' },
      });
    }

    items.push({
      label: t('widget.chargePlans.ratePlan', 'Rate Plan'),
      value: activePlan.rate_plan ?? '—',
    });

    return items;
  }, [activePlan, t, formatCurrency, formatTime, formatDate]);

  const rateEntries: DetailEntry[] = useMemo(() => {
    return safeRates.map((rp) => ({
      label: rp.utility ?? '—',
      value: rp.name ?? '—',
      badge: { text: rp.id ?? '—', variant: 'neutral' as const },
      mono: true,
    }));
  }, [safeRates]);

  const hasData = safePlans.length > 0 || safeRates.length > 0;

  const handleRefresh = () => {
    refetchPlans();
    refetchRates();
  };

  if (isCompact) {
    return (
      <WidgetShell
        loading={isLoading}
        updatedAt={updatedAt}
        isFetching={isFetching}
        isStale={isStale}
        isError={isError}
        onRefresh={handleRefresh}
      >
        {activePlan ? (
          <div className="h-full flex flex-col items-center justify-center gap-1 px-2">
            <Clock className="h-4 w-4 text-cyan-400" />
            <span className="text-2xl font-bold text-[var(--text-primary)]">
              {fmtInt(activePlan.target_soc ?? 0)}%
            </span>
            <span className="text-2xs text-[var(--text-muted)] uppercase tracking-wider truncate max-w-full text-center">
              {t('widget.chargePlans.targetSoc', 'Target SOC')}
            </span>
            {activePlan.depart_by && (
              <span className="text-xs text-[var(--text-secondary)] truncate max-w-full">
                {formatTime(activePlan.depart_by)}
              </span>
            )}
          </div>
        ) : (
          <EmptyState /* no-action: transient empty state — surfaces when source data is missing; no specific recovery action available */
            icon={<Clock className="h-5 w-5" />}
            message={t('widget.chargePlans.noPlans', 'No charge plans')}
            className="py-4"
          />
        )}
      </WidgetShell>
    );
  }

  return (
    <WidgetShell
      title={t('widget.chargePlans.title', 'Charge Plans')}
      icon={<Clock className="h-3.5 w-3.5 text-cyan-400" />}
      loading={isLoading}
      updatedAt={updatedAt}
      isFetching={isFetching}
      isStale={isStale}
      isError={isError}
      onRefresh={handleRefresh}
    >
      {hasData ? (
        <div className="h-full flex flex-col gap-3 overflow-y-auto">
          {/* Active charge plan details */}
          {activePlan ? (
            <div>
              <div className="flex items-center gap-2 mb-1">
                <Badge variant={badgeVariant(activePlan.status)} size="sm" dot>
                  {activePlan.status ?? '—'}
                </Badge>
                <span className="text-xs text-[var(--text-secondary)] truncate">
                  {activePlan.rate_plan ?? ''}
                </span>
              </div>

              {/* Summary stats */}
              <div className="grid grid-cols-2 gap-2 mb-2">
                <StatCard
                  label={t('widget.chargePlans.targetSoc', 'Target SOC')}
                  value={`${fmtInt(activePlan.target_soc ?? 0)}%`}
                />
                <StatCard
                  label={t('widget.chargePlans.departure', 'Departure')}
                  value={activePlan.depart_by ? formatTime(activePlan.depart_by) : '—'}
                />
              </div>

              <WidgetDetailCard
                entries={planEntries.slice(2)}
                compact={size.rows <= 3}
                emptyMessage={t('widget.chargePlans.noDetails', 'No plan details')}
                emptyIcon={<Clock className="h-5 w-5" />}
              />
            </div>
          ) : (
            <EmptyState /* no-action: transient empty state — surfaces when source data is missing; no specific recovery action available */
              icon={<Clock className="h-5 w-5" />}
              message={t('widget.chargePlans.noPlans', 'No charge plans')}
              className="py-4"
            />
          )}

          {/* Rate plans section */}
          {safeRates.length > 0 && (
            <div className="border-t border-white/[0.06] pt-2">
              <h4 className="text-2xs font-medium text-[var(--text-muted)] uppercase tracking-wider mb-1">
                {t('widget.chargePlans.ratePlans', 'Rate Plans')}
              </h4>
              <WidgetDetailCard
                entries={rateEntries}
                compact={size.rows <= 3}
                emptyMessage={t('widget.chargePlans.noRates', 'No rate plans')}
                emptyIcon={<Clock className="h-5 w-5" />}
              />
            </div>
          )}
        </div>
      ) : (
        <EmptyState /* no-action: transient empty state — surfaces when source data is missing; no specific recovery action available */
          icon={<Clock className="h-5 w-5" />}
          message={t('widget.chargePlans.noData', 'No charge plans or rate data')}
          className="py-4"
        />
      )}
    </WidgetShell>
  );
}
