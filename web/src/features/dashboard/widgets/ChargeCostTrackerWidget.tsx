import { useCallback, useMemo } from 'react';
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
import { convertDistanceToSI, convertEnergyFromSI } from '@/lib/unitConversion';
import { WidgetShell } from './WidgetShell';
import type { WidgetProps } from './types';
import type { ChargingSession } from '@/api/types';

export interface CostMetrics {
  totalKwh: number;
  totalCost: number;
  costPerDistance: number | null;
  gasSavings: number | null;
  sessionCount: number;
  /** Estimated distance covered by the charged energy, in SI meters. */
  totalDistanceM: number;
}

/**
 * Average Tesla efficiency (~3.5 mi/kWh) expressed in SI meters per kWh.
 * The cost/gas helpers from `useFormatting` consume SI meters, so the
 * mile-based figure is lifted into SI once here via the lib rather than any
 * call site hardcoding 1609.344.
 */
const AVG_METERS_PER_KWH = convertDistanceToSI(3.5, 'mi');

/**
 * Aggregate 30-day charging sessions into the widget's cost metrics.
 *
 * `costPerDistFn` and `estimateGasCostFn` both expect an SI-meter distance,
 * so the estimated range is derived in meters (`totalDistanceM`) — passing
 * miles here silently under-counts distance by ~1609× and corrupts both the
 * cost-per-distance and gas-savings figures.
 */
export function computeMetrics(
  sessions: ChargingSession[],
  costPerKwh: number,
  costPerDistFn: (kwh: number, distanceM: number) => number | null,
  estimateGasCostFn: (distanceM: number) => number | null,
): CostMetrics {
  let totalKwh = 0;
  let totalCost = 0;

  for (const s of sessions) {
    const energy = convertEnergyFromSI(s.total_energy_added_wh ?? 0, 'kWh');
    totalKwh += energy;
    // Prefer session cost if recorded, otherwise estimate from kWh
    totalCost += s.cost != null ? s.cost : energy * costPerKwh;
  }

  const totalDistanceM = totalKwh * AVG_METERS_PER_KWH;

  const costPerDistance = costPerDistFn(totalKwh, totalDistanceM);
  const gasCost = estimateGasCostFn(totalDistanceM);
  const gasSavings = gasCost != null ? gasCost - totalCost : null;

  return {
    totalKwh,
    totalCost,
    costPerDistance,
    gasSavings,
    sessionCount: sessions.length,
    totalDistanceM,
  };
}

export default function ChargeCostTrackerWidget({ vehicleId, size }: WidgetProps) {
  const { t } = useTranslation('dashboard');
  const { data: vehicles } = useVehicles();
  const id = vehicleId ?? vehicles?.[0]?.id ?? 0;

  const { costPerKwh, formatCurrency, costPerDistanceUnit, estimateGasCost } = useFormatting();
  const { unitPrefs } = useUnits();
  const distanceUnit = unitPrefs.distance;

  // Fetch last 30 days of charging sessions
  const thirtyDaysAgo = useMemo(() => {
    const d = new Date();
    d.setDate(d.getDate() - 30);
    return d.toISOString();
  }, []);

  const { data: sessions, isLoading, isFetching, isStale, isError, dataUpdatedAt, refetch } = useQuery({
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

  const handleRefresh = useCallback(() => {
    refetch();
  }, [refetch]);

  // Only surface the full-panel error when the INITIAL load failed with no
  // cached data. A background-refetch error over existing data keeps the
  // metrics on screen (the freshness dot still flags the error state), so a
  // transient blip never blanks out a working widget.
  const errorMessage =
    isError && !sessions
      ? t('widget.chargeCost.error', 'Failed to load charge data')
      : null;

  // Compact: single big metric (total cost)
  if (isCompact) {
    return (
      <WidgetShell
        loading={isLoading}
        error={errorMessage}
        updatedAt={dataUpdatedAt}
        isFetching={isFetching}
        isStale={isStale}
        isError={isError}
        onRefresh={handleRefresh}
      >
        {hasData ? (
          <div className="h-full flex flex-col items-center justify-center gap-0.5">
            <span className="text-2xl font-bold text-[var(--text-primary)]">
              {formatCurrency(metrics.totalCost, 0)}
            </span>
            <span className="text-2xs text-[var(--text-muted)] uppercase tracking-wider">
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
      error={errorMessage}
      updatedAt={dataUpdatedAt}
      isFetching={isFetching}
      isStale={isStale}
      isError={isError}
      onRefresh={handleRefresh}
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
                    ? formatCurrency(metrics.costPerDistance, 3)
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
            <div className="flex items-center justify-between text-2xs text-[var(--text-muted)] px-1">
              <span>
                {metrics.costPerDistance != null
                  ? `${formatCurrency(metrics.costPerDistance, 3)}/${distanceUnit}`
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
