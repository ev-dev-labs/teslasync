import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Clock } from 'lucide-react';
import { EmptyState, Skeleton } from '@/components/feedback';
import { Badge, Subhead } from '@/components/ui';
import { SourceContent } from '@/components/layout';
import { useChargePlans, useRatePlans } from '@/api/hooks/useCharging';
import { useVehicles } from '@/api/hooks/useVehicles';
import { useFormatting } from '@/hooks/useFormatting';
import { useDateFormat } from '@/hooks/useDateFormat';

import { WidgetShell } from './WidgetShell';
import type { DetailEntry } from './shared';
import type { WidgetProps } from './types';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';
import { useDataState } from '@/hooks/useDataState';
import { combineDataStates, knownNumber } from '@/api/dataState';
import { safeArray } from '@/lib/safeArray';
import { WidgetBigNumber, WidgetDetailCard, WidgetStatGrid } from './shared';
import { sourcePresentation } from '../components/continuation-dashboard-3/sourcePresentation';

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
  const { fmtNumber } = useNumberFormatting();
  const { t } = useTranslation('dashboard');
  const vehiclesQuery = useVehicles();
  const candidate = vehicleId ?? safeArray(vehiclesQuery.data)[0]?.id;
  const id = Number.isSafeInteger(candidate) && Number(candidate) > 0 ? Number(candidate) : 0;
  const { formatCurrency } = useFormatting();
  const { formatTime, formatDateShort: formatDate } = useDateFormat();

  const plansQuery = useChargePlans(id > 0 ? id : undefined);
  const {
    data: plans,
    isLoading: plansLoading,
    isFetching: plansFetching,
    isStale: plansStale,
    isError: plansError,
    refetch: refetchPlans,
  } = plansQuery;

  const ratesQuery = useRatePlans();
  const {
    data: ratePlans,
    isLoading: ratesLoading,
    isFetching: ratesFetching,
    isStale: ratesStale,
    isError: ratesError,
    refetch: refetchRates,
  } = ratesQuery;

  const isFetching = plansFetching || ratesFetching;
  const isStale = plansStale || ratesStale;
  const isError = plansError || ratesError;

  const safePlans = safeArray(plans);
  const safeRates = safeArray(ratePlans);
  const discoveryState = useDataState(vehiclesQuery);
  const plansState = useDataState({
    ...plansQuery,
    data: plans ?? (!id || (!plansLoading && !plansQuery.isPending && !plansError) ? null : undefined),
  }, { provenance: 'inferred', unavailable: safePlans.length === 0 });
  const ratesState = useDataState({
    ...ratesQuery,
    data: ratePlans ?? (!ratesLoading && !ratesQuery.isPending && !ratesError ? null : undefined),
  }, { provenance: 'historical', unavailable: safeRates.length === 0 });
  const sources = [
    !id && vehicleId == null && discoveryState.status !== 'ok' ? discoveryState : plansState,
    ratesState,
  ];
  const combined = combineDataStates(sources);
  const failure = sources.find((state) => state.fatalError)?.fatalError ?? null;
  const retained = safePlans.length > 0 || safeRates.length > 0;
  const dataState = {
    ...combined,
    data: { plans, ratePlans },
    hasData: retained,
    status: !retained && failure ? 'initialFailure' as const
      : !retained && sources.some((state) => state.status === 'initial') ? 'initial' as const
        : retained && sources.some((state) => state.status === 'unavailable') ? 'partial' as const : combined.status,
    fatalError: !retained ? failure : null,
    refreshError: retained ? combined.refreshError ?? failure : null,
    retry: () => handleRefresh(),
  };

  const activePlan = useMemo(
    () => safePlans.find((p) => p.status === 'active' || p.status === 'scheduled') ?? safePlans[0] ?? null,
    [safePlans],
  );

  const isCompact = size.cols <= 1;

  const planEntries: DetailEntry[] = useMemo(() => {
    if (!activePlan) return [];

    const items: DetailEntry[] = [];
    const estimatedCost = knownNumber(activePlan.estimated_cost);

    items.push({
      label: t('widget.chargePlans.targetSoc', 'Target SOC'),
      value: knownNumber(activePlan.target_soc) == null ? '—' : `${fmtNumber(activePlan.target_soc)}%`,
    });

    items.push({
      label: t('widget.chargePlans.departure', 'Departure'),
      value: activePlan.depart_by ? formatTime(activePlan.depart_by) : '—',
    });

    items.push({
      label: t('widget.chargePlans.schedStart', 'Scheduled start'),
      value: joinDateTime(formatDate(activePlan.scheduled_start), formatTime(activePlan.scheduled_start)),
    });

    items.push({
      label: t('widget.chargePlans.schedEnd', 'Scheduled end'),
      value: joinDateTime(formatDate(activePlan.scheduled_end), formatTime(activePlan.scheduled_end)),
    });

    items.push({
      label: t('widget.chargePlans.estEnergy', 'Est. energy'),
      value: knownNumber(activePlan.estimated_kwh) != null ? `${fmtNumber(activePlan.estimated_kwh)} kWh` : '—',
    });

    items.push({
      label: t('widget.chargePlans.estCost', 'Est. cost'),
      value: estimatedCost != null ? formatCurrency(estimatedCost) : '—',
    });

    if (activePlan.savings != null && activePlan.savings > 0) {
      items.push({
        label: t('widget.chargePlans.savings', 'Savings'),
        value: formatCurrency(activePlan.savings),
        badge: { text: t('widget.chargePlans.saved', 'saved'), variant: 'success' },
      });
    }

    return items;
  }, [activePlan, t, formatCurrency, formatTime, formatDate, fmtNumber]);

  const rateEntries: DetailEntry[] = useMemo(() => {
    return safeRates.map((rp) => ({
      id: rp.id,
      label: rp.utility ?? '—',
      value: rp.name ?? '—',
      badge: { text: rp.id ?? '—', variant: 'neutral' as const },
      mono: true,
    }));
  }, [safeRates]);

  const hasData = safePlans.length > 0 || safeRates.length > 0;

  const handleRefresh = () => {
    if (vehicleId == null) void vehiclesQuery.refetch?.();
    if (id) void refetchPlans();
    void refetchRates();
  };

  if (isCompact) {
    return (
      <WidgetShell
        title={t('widget.chargePlans.title', 'Charge plans')}
        dataState={dataState}
        updatedAt={dataState.updatedAt ?? 0}
        isFetching={isFetching}
        isStale={isStale}
        isError={isError}
        onRefresh={handleRefresh}
      >
        {activePlan ? (
          <WidgetBigNumber
            align="center"
            value={knownNumber(activePlan.target_soc) == null ? null : `${fmtNumber(activePlan.target_soc)}%`}
            label={t('widget.chargePlans.targetSoc', 'Target SOC')}
            subtitle={activePlan.depart_by ? formatTime(activePlan.depart_by) : undefined}
          />
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
      title={t('widget.chargePlans.title', 'Charge plans')}
      icon={<Clock className="h-3.5 w-3.5 text-[var(--text-secondary)]" />}
      dataState={dataState}
      updatedAt={dataState.updatedAt ?? 0}
      isFetching={isFetching}
      isStale={isStale}
      isError={isError}
      onRefresh={handleRefresh}
    >
      {/* After: hero is the active rate-plan name + status pill. The TOU
          strip/legend from the preview is omitted: RatePlanInfo carries no
          period/rate data, so drawing it would fabricate prices/hours. */}
      <div className="flex h-full min-w-0 flex-col gap-3 overflow-y-auto">
        <SourceContent
          state={sourcePresentation(plansState, activePlan != null)}
          label={t('widget.chargePlans.title', 'Charge plans')}
          emptyMessage={t('widget.chargePlans.noPlans', 'No charge plans')}
          errorMessage={t('widget.chargePlans.plansError', 'Unable to load charge plans')}
          error={plansState.fatalError}
          errorRecovery={{ onRetry: plansState.retry ?? undefined }}
          loadingContent={<Skeleton className="h-24" />}
        >
          {activePlan && (
            <div>
              <div className="mb-1 flex min-w-0 flex-wrap items-center justify-between gap-2">
                <span className="min-w-0 text-base font-semibold text-[var(--text-primary)] [overflow-wrap:anywhere]">
                  {activePlan.rate_plan ?? '—'}
                </span>
                <Badge variant={badgeVariant(activePlan.status)} size="sm" dot>{activePlan.status ?? '—'}</Badge>
              </div>
              <WidgetStatGrid stats={planEntries.slice(0, 2).map(({ label, value }) => ({ label, value }))} />
              <WidgetDetailCard
                entries={planEntries.slice(2)}
                compact={size.rows <= 3}
                emptyMessage={t('widget.chargePlans.noDetails', 'No plan details')}
                emptyIcon={<Clock className="h-5 w-5" />}
              />
            </div>
          )}
        </SourceContent>
        <div className="border-t border-[var(--border-subtle)] pt-2">
          <Subhead>{t('widget.chargePlans.ratePlans', 'Rate plans')}</Subhead>
          <SourceContent
            state={sourcePresentation(ratesState, rateEntries.length > 0)}
            label={t('widget.chargePlans.ratePlans', 'Rate plans')}
            emptyMessage={t('widget.chargePlans.noRates', 'No rate plans')}
            errorMessage={t('widget.chargePlans.ratesError', 'Unable to load rate plans')}
            error={ratesState.fatalError}
            errorRecovery={{ onRetry: ratesState.retry ?? undefined }}
          >
            <WidgetDetailCard
              entries={rateEntries}
              compact={size.rows <= 3}
              emptyMessage={t('widget.chargePlans.noRates', 'No rate plans')}
              emptyIcon={<Clock className="h-5 w-5" />}
            />
          </SourceContent>
        </div>
        {!hasData && !plansState.fatalError && !ratesState.fatalError && (
          <EmptyState /* no-action: read-only plan and rate summaries retain shell refresh */
            icon={<Clock className="h-5 w-5" />}
            message={t('widget.chargePlans.noData', 'No charge plans or rate data')}
            className="py-4"
          />
        )}
      </div>
    </WidgetShell>
  );
}
