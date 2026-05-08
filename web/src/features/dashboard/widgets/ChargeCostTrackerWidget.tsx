import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { DollarSign, Zap, Fuel, TrendingDown } from 'lucide-react';
import { MetricCard } from '@/components/data-display';
import { EmptyState } from '@/components/feedback';
import { useVehicles } from '@/api/hooks/useVehicles';
import { useFormatting } from '@/hooks/useFormatting';
import { useUnits } from '@/hooks/useUnits';
import { request } from '@/api/client';
import { fmtNumber } from '@/lib/numberFormat';
import { WidgetShell } from './WidgetShell';
import type { WidgetProps } from './types';
import type { ChargingSession } from '@/api/types';

interface CostMetrics {
  totalKwh: number;
  totalCost: number;
  costPerDistance: number | null;
  gasSavings: number | null;
  sessionCount: number;
  totalDistanceMi: number;
}

function computeMetrics(
  sessions: ChargingSession[],
  costPerKwh: number,
  costPerDistFn: (kwh: number, mi: number) => number | null,
  estimateGasCostFn: (mi: number) => number | null,
): CostMetrics {
  let totalKwh = 0;
  let totalCost = 0;
  let totalDistanceMi = 0;

  for (const s of sessions) {
    const energy = s.total_energy_added_wh ?? 0;
    totalKwh += energy;
    // Prefer session cost if recorded, otherwise estimate from kWh
    totalCost += s.cost != null ? s.cost : energy * costPerKwh;
  }

  // Rough distance estimate: ~3.5 mi/kWh average efficiency
  const AVG_MI_PER_KWH = 3.5;
  totalDistanceMi = totalKwh * AVG_MI_PER_KWH;

  const costPerDistance = costPerDistFn(totalKwh, totalDistanceMi);
  const gasCost = estimateGasCostFn(totalDistanceMi);
  const gasSavings = gasCost != null ? gasCost - totalCost : null;

  return {
    totalKwh,
    totalCost,
    costPerDistance,
    gasSavings,
    sessionCount: sessions.length,
    totalDistanceMi,
  };
}

export default function ChargeCostTrackerWidget({ vehicleId, size }: WidgetProps) {
  const { t } = useTranslation('dashboard');
  const { data: vehicles } = useVehicles();
  const id = vehicleId ?? vehicles?.[0]?.id ?? 0;

  const { costPerKwh } = useFormatting();
  const { unitPrefs } = useUnits();
  const distanceUnit = unitPrefs.distance;
  const { currencySymbol, formatCurrency, costPerDistanceUnit, estimateGasCost } = useFormatting();

  // Fetch last 30 days of charging sessions
  const thirtyDaysAgo = useMemo(() => {
    const d = new Date();
    d.setDate(d.getDate() - 30);
    return d.toISOString();
  }, []);

  const { data: sessions, isLoading, error, isFetching, isStale, isError, dataUpdatedAt, refetch } = useQuery({
    queryKey: ['charging', id, 'cost-tracker-30d', thirtyDaysAgo],
    queryFn: () =>
      request<ChargingSession[]>(
        `/charging?vehicle_id=${id}&limit=100&start=${thirtyDaysAgo}`,
      ),
    enabled: id > 0,
    staleTime: 60_000,
  });

  const metrics = useMemo(
    () =>
      computeMetrics(
        sessions ?? [],
        costPerKwh,
        costPerDistanceUnit,
        estimateGasCost,
      ),
    [sessions, costPerKwh, costPerDistanceUnit, estimateGasCost],
  );

  const isCompact = size.cols <= 1 && size.rows <= 1;
  const isTall = size.rows >= 2;
  const hasData = (sessions ?? []).length > 0;

  // Compact: single big metric (total cost)
  if (isCompact) {
    return (
      <WidgetShell
        loading={isLoading}
        error={error ? String(error) : null}
        updatedAt={dataUpdatedAt}
        isFetching={isFetching}
        isStale={isStale}
        isError={isError}
        onRefresh={() => refetch()}
      >
        {hasData ? (
          <div className="h-full flex flex-col items-center justify-center gap-0.5">
            <span className="text-2xl font-bold text-[var(--text-primary)]">
              {formatCurrency(metrics.totalCost, 0)}
            </span>
            <span className="text-[10px] text-[var(--text-muted)] uppercase tracking-wider">
              {t('widget.chargeCost.monthly', '30-day cost')}
            </span>
          </div>
        ) : (
          <EmptyState /* no-action: transient empty state — surfaces when source data is missing; no specific recovery action available */
            icon={<DollarSign className="h-5 w-5" />}
            message={t('widget.chargeCost.noData', 'No charge data')}
            className="py-4"
          />
        )}
      </WidgetShell>
    );
  }

  return (
    <WidgetShell
      title={t('widget.chargeCost.title', 'Charge Cost Tracker')}
      icon={<DollarSign className="h-3.5 w-3.5 text-emerald-400" />}
      loading={isLoading}
      error={error ? String(error) : null}
      updatedAt={dataUpdatedAt}
      isFetching={isFetching}
      isStale={isStale}
      isError={isError}
      onRefresh={() => refetch()}
    >
      {hasData ? (
        <div className="space-y-2">
          <div className="grid grid-cols-2 gap-2">
            <MetricCard
              label={t('widget.chargeCost.totalEnergy', 'Total Energy')}
              value={`${fmtNumber(metrics.totalKwh, 1)} kWh`}
              icon={<Zap className="h-3.5 w-3.5" />}
              color="cyan"
              subtitle={t('widget.chargeCost.sessions', '{{count}} sessions', {
                count: metrics.sessionCount,
              })}
            />
            <MetricCard
              label={t('widget.chargeCost.totalCost', 'Total Cost')}
              value={formatCurrency(metrics.totalCost)}
              icon={<DollarSign className="h-3.5 w-3.5" />}
              color="green"
              subtitle={`${formatCurrency(costPerKwh)}/${t('widget.chargeCost.kwh', 'kWh')}`}
            />
          </div>

          {isTall && (
            <div className="grid grid-cols-2 gap-2">
              <MetricCard
                label={t('widget.chargeCost.costPerDistance', 'Cost / {{unit}}', {
                  unit: distanceUnit,
                })}
                value={
                  metrics.costPerDistance != null
                    ? `${currencySymbol}${fmtNumber(metrics.costPerDistance, 3)}`
                    : '—'
                }
                icon={<Fuel className="h-3.5 w-3.5" />}
                color="amber"
              />
              <MetricCard
                label={t('widget.chargeCost.gasSavings', 'vs Gas Savings')}
                value={
                  metrics.gasSavings != null
                    ? formatCurrency(metrics.gasSavings)
                    : '—'
                }
                icon={<TrendingDown className="h-3.5 w-3.5" />}
                color="green"
                subtitle={
                  metrics.gasSavings != null
                    ? t('widget.chargeCost.savingsNote', '30-day estimate')
                    : t('widget.chargeCost.configureGas', 'Set gas price in settings')
                }
              />
            </div>
          )}

          {!isTall && (
            <div className="flex items-center justify-between text-[10px] text-[var(--text-muted)] px-1">
              <span>
                {metrics.costPerDistance != null
                  ? `${currencySymbol}${fmtNumber(metrics.costPerDistance, 3)}/${distanceUnit}`
                  : '—'}
              </span>
              <span>
                {metrics.gasSavings != null
                  ? t('widget.chargeCost.saved', 'Saved {{amount}} vs gas', {
                      amount: formatCurrency(metrics.gasSavings),
                    })
                  : ''}
              </span>
            </div>
          )}
        </div>
      ) : (
        <EmptyState /* no-action: transient empty state — surfaces when source data is missing; no specific recovery action available */
          icon={<DollarSign className="h-5 w-5" />}
          message={t('widget.chargeCost.noData', 'No charge data')}
          className="py-4"
        />
      )}
    </WidgetShell>
  );
}
