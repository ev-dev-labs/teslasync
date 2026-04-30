import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Clock } from 'lucide-react';
import { Badge } from '@/components/ui';
import { StatCard } from '@/components/data-display';
import { EmptyState } from '@/components/feedback';
import { useChargePlans, useRatePlans } from '@/api/hooks/useCharging';
import { useVehicles } from '@/api/hooks/useVehicles';
import { useSettings } from '@/hooks/useSettings';
import { fmtNumber, fmtInt } from '@/lib/numberFormat';
import { WidgetShell } from './WidgetShell';
import { WidgetDetailCard, type DetailEntry } from './shared';
import type { WidgetProps } from './types';

/** Variant for DetailEntry badges (WidgetDetailCard maps 'error' → 'danger' internally) */
function detailBadgeVariant(status: string): 'success' | 'warning' | 'error' | 'neutral' {
  switch (status) {
    case 'completed':
      return 'success';
    case 'active':
    case 'scheduled':
      return 'warning';
    case 'failed':
    case 'cancelled':
      return 'error';
    default:
      return 'neutral';
  }
}

/** Variant for direct Badge component usage */
function badgeVariant(status: string): 'success' | 'warning' | 'danger' | 'neutral' {
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

function formatTime(iso: string | null): string {
  if (!iso) return '—';
  try {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return iso;
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  } catch {
    return iso;
  }
}

function formatDate(iso: string | null): string {
  if (!iso) return '—';
  try {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return iso;
    return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
  } catch {
    return iso;
  }
}

export default function ChargePlansWidget({ vehicleId, size }: WidgetProps) {
  const { t } = useTranslation('dashboard');
  const { data: vehicles } = useVehicles();
  const id = vehicleId ?? vehicles?.[0]?.id ?? 0;
  const { formatCurrency } = useSettings();

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
      value: `${formatDate(activePlan.scheduled_start)} ${formatTime(activePlan.scheduled_start)}`,
    });

    items.push({
      label: t('widget.chargePlans.schedEnd', 'Scheduled End'),
      value: `${formatDate(activePlan.scheduled_end)} ${formatTime(activePlan.scheduled_end)}`,
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
  }, [activePlan, t, formatCurrency]);

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
            <span className="text-2xl font-bold text-white/90">
              {fmtInt(activePlan.target_soc ?? 0)}%
            </span>
            <span className="text-[10px] text-white/40 uppercase tracking-wider truncate max-w-full text-center">
              {t('widget.chargePlans.targetSoc', 'Target SOC')}
            </span>
            {activePlan.depart_by && (
              <span className="text-xs text-white/60 truncate max-w-full">
                {formatTime(activePlan.depart_by)}
              </span>
            )}
          </div>
        ) : (
          <EmptyState
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
                <span className="text-xs text-white/50 truncate">
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
            <EmptyState
              icon={<Clock className="h-5 w-5" />}
              message={t('widget.chargePlans.noPlans', 'No charge plans')}
              className="py-4"
            />
          )}

          {/* Rate plans section */}
          {safeRates.length > 0 && (
            <div className="border-t border-white/[0.06] pt-2">
              <h4 className="text-[10px] font-medium text-white/40 uppercase tracking-wider mb-1">
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
        <EmptyState
          icon={<Clock className="h-5 w-5" />}
          message={t('widget.chargePlans.noData', 'No charge plans or rate data')}
          className="py-4"
        />
      )}
    </WidgetShell>
  );
}
