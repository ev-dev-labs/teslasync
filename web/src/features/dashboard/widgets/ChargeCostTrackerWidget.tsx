import { useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { DollarSign, Zap, Fuel, TrendingDown } from 'lucide-react';
import { EmptyState } from '@/components/feedback';
import { deriveDataState, knownNumber, sumKnown } from '@/api/dataState';
import { useVehicles } from '@/api/hooks/useVehicles';
import { useFormatting } from '@/hooks/useFormatting';
import { useUnits } from '@/hooks/useUnits';
import { request } from '@/api/client';
import { fmtNumber } from '@/lib/numberFormat';
import { convertDistanceToSI, convertEnergyFromSI } from '@/lib/unitConversion';
import { WidgetShell } from './WidgetShell';
import { WidgetBigNumber, WidgetStatGrid } from './shared';
import { dashboardTokens } from '../lib/dashboardTokens';
import type { WidgetProps } from './types';
import type { ChargingSession } from '@/api/types';

export interface CostMetrics {
  totalKwh: number | null;
  totalCost: number | null;
  costPerDistance: number | null;
  gasSavings: number | null;
  sessionCount: number;
  /** Estimated distance covered by the charged energy, in SI meters. */
  totalDistanceM: number | null;
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
  const energies = sessions.map(s => {
    const energy = knownNumber(s.total_energy_added_wh);
    return energy == null ? null : convertEnergyFromSI(energy, 'kWh');
  });
  const costs = sessions.map((s, index) => {
    const recorded = knownNumber(s.cost_decimal) ?? knownNumber(s.cost);
    const energy = energies[index];
    return recorded ?? (energy == null ? null : energy * costPerKwh);
  });
  const totalKwh = sumKnown(energies);
  const totalCost = sumKnown(costs);

  const totalDistanceM = totalKwh == null || energies.some(energy => energy == null)
    ? null : totalKwh * AVG_METERS_PER_KWH;

  const costPerDistance = totalKwh != null && totalDistanceM != null
    ? costPerDistFn(totalKwh, totalDistanceM) : null;
  const gasCost = totalDistanceM != null ? estimateGasCostFn(totalDistanceM) : null;
  const gasSavings = gasCost != null && totalCost != null && costs.every(cost => cost != null)
    ? gasCost - totalCost : null;

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

  const query = useQuery({
    queryKey: ['charging', id, 'cost-tracker-30d', thirtyDaysAgo],
    queryFn: () =>
      request<ChargingSession[]>(
        `/charging?vehicle_id=${id}&limit=100&start=${thirtyDaysAgo}`,
      ),
    enabled: id > 0,
    staleTime: 60_000,
  });
  const { data: sessions, isLoading, isFetching, isStale, isError, dataUpdatedAt, refetch } = query;

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
  const energyWh = sumKnown((sessions ?? []).map(session => session.total_energy_added_wh));
  const dataState = sessions ? deriveDataState(query, {
    provenance: 'inferred',
    partial: sessions.length >= 100 || sessions.some(session => knownNumber(session.total_energy_added_wh) == null),
  }) : undefined;
  const currency = (value: number | null, decimals?: number) => value == null ? null : formatCurrency(value, decimals);

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
        loading={isLoading && !sessions}
        dataState={dataState}
        error={errorMessage}
        updatedAt={dataUpdatedAt}
        isFetching={isFetching}
        isStale={isStale}
        isError={isError}
        onRefresh={handleRefresh}
      >
        {hasData ? (
          <WidgetBigNumber value={currency(metrics.totalCost, 0)} label={t('widget.chargeCost.monthly', '30-day cost')} animated={false} align="center" />
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
      title={t('widget.chargeCost.title', 'Charge cost tracker')}
      icon={<DollarSign className="h-3.5 w-3.5 text-emerald-400" />}
      loading={isLoading && !sessions}
      dataState={dataState}
      error={errorMessage}
      updatedAt={dataUpdatedAt}
      isFetching={isFetching}
      isStale={isStale}
      isError={isError}
      onRefresh={handleRefresh}
    >
      {hasData ? (
        <div className="space-y-2">
          <WidgetStatGrid cols={2} stats={[
            { label: t('widget.chargeCost.totalEnergy', 'Total energy'), value: energyWh == null ? null : `${fmtNumber(convertEnergyFromSI(energyWh, unitPrefs.energy), 1)} ${unitPrefs.energy}`, icon: <Zap className="h-3.5 w-3.5" /> },
            { label: t('widget.chargeCost.totalCost', 'Total cost'), value: currency(metrics.totalCost), icon: <DollarSign className="h-3.5 w-3.5" /> },
          ]} />
          <div className={`flex min-w-0 flex-wrap justify-between gap-2 ${dashboardTokens.metricLabel}`}>
            <span>{t('widget.chargeCost.sessions', '{{count}} sessions', { count: metrics.sessionCount })}</span>
            <span>{formatCurrency(costPerKwh)}/{t('widget.chargeCost.kwh', 'kWh')}</span>
          </div>

          {isTall && (
            <div className="space-y-2">
              <WidgetStatGrid cols={2} stats={[
                { label: t('widget.chargeCost.costPerDistance', 'Cost / {{unit}}', { unit: distanceUnit }), value: currency(metrics.costPerDistance, 3), icon: <Fuel className="h-3.5 w-3.5" /> },
                { label: t('widget.chargeCost.gasSavings', 'vs gas savings'), value: currency(metrics.gasSavings), icon: <TrendingDown className="h-3.5 w-3.5" /> },
              ]} />
              <p className={dashboardTokens.metricLabel}>
                {metrics.gasSavings != null ? t('widget.chargeCost.savingsNote', '30-day estimate') : t('widget.chargeCost.configureGas', 'Set gas price in settings')}
              </p>
            </div>
          )}

          {!isTall && (
            <div className={`flex min-w-0 flex-wrap items-center justify-between gap-2 ${dashboardTokens.metricLabel}`}>
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
