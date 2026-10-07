import { useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Route } from 'lucide-react';
import { EmptyState } from '@/components/feedback';
import { useRouteEfficiency } from '@/api/hooks/useDriving';
import { useVehicles } from '@/api/hooks/useVehicles';
import { useUnits } from '@/hooks/useUnits';
import { fmtNumber, fmtInt } from '@/lib/numberFormat';
import { WidgetShell } from './WidgetShell';
import { WidgetRankedList, type RankedItem } from './shared';
import type { WidgetProps } from './types';

function efficiencyBadge(
  rawWhPerMi: number,
  t: (key: string, fallback: string) => string,
): RankedItem['badge'] {
  if (rawWhPerMi <= 250) return { text: t('widget.routeEfficiency.excellent', 'Excellent'), variant: 'success' };
  if (rawWhPerMi <= 325) return { text: t('widget.routeEfficiency.good', 'Good'), variant: 'success' };
  if (rawWhPerMi <= 400) return { text: t('widget.routeEfficiency.fair', 'Fair'), variant: 'warning' };
  return { text: t('widget.routeEfficiency.poor', 'Poor'), variant: 'error' };
}

export default function RouteEfficiencyWidget({ vehicleId, size }: WidgetProps) {
  const { t } = useTranslation('dashboard');
  const { data: vehicles } = useVehicles();
  const vid = vehicleId ?? vehicles?.[0]?.id;
  const vehicleIdStr = vid != null ? String(vid) : undefined;

  const {
    data, isLoading, error, isFetching, isStale, isError, dataUpdatedAt, refetch, } = useRouteEfficiency(vehicleIdStr);

  const { unitPrefs } = useUnits();
  const isMiles = unitPrefs.distance === 'mi';
  // Stable across renders (keyed on the unit only) so the `items` memo below
  // is not defeated by a fresh closure on every render.
  const toEfficiencyDisplay = useCallback(
    (whPerKm: number) => (isMiles ? whPerKm * 1.609344 : whPerKm),
    [isMiles],
  );

  const efficiencyUnit = isMiles ? 'Wh/mi' : 'Wh/km';

  const isCompact = size.cols <= 1;
  const isWide = size.cols >= 3;

  const routes = useMemo(() => data?.routes ?? [], [data]);

  const items: RankedItem[] = useMemo(() => {
    const bestRaw = routes.length > 0
      ? Math.min(...routes.map(r => r.avgEfficiency ?? Infinity))
      : Infinity;

    return routes.map((r, i) => {
      const rawEff = r.avgEfficiency ?? 0;
      const eff = toEfficiencyDisplay(rawEff);
      const trips = r.tripCount ?? 0;
      const isBest = rawEff === bestRaw && rawEff > 0;

      let label = `${r.startLocation ?? '—'} → ${r.endLocation ?? '—'}`;
      if (isWide) {
        const bestEff = fmtNumber(toEfficiencyDisplay(r.bestEfficiency ?? 0), 0);
        const worstEff = fmtNumber(toEfficiencyDisplay(r.worstEfficiency ?? 0), 0);
        label += `  ·  ${t('widget.routeEfficiency.best', 'best')} ${bestEff} / ${t('widget.routeEfficiency.worst', 'worst')} ${worstEff} ${efficiencyUnit}`;
      }

      return {
        id: i,
        label,
        // Invert: lower Wh/unit (better) → higher value → ranks first
        value: eff > 0 ? 10000 / eff : 0,
        formattedValue: `${fmtNumber(eff, 0)} ${efficiencyUnit} · ${fmtInt(trips)}×`,
        badge: efficiencyBadge(rawEff, t),
        barColor: isBest ? 'bg-emerald-400' : 'bg-blue-400',
      };
    });
  }, [routes, toEfficiencyDisplay, efficiencyUnit, isWide, t]);

  const handleRefresh = useCallback(() => {
    refetch();
  }, [refetch]);

  const shellProps = {
    loading: isLoading,
    error: error ? String(error) : null,
    updatedAt: dataUpdatedAt,
    isFetching,
    isStale,
    isError,
    onRefresh: handleRefresh,
  };

  if (isCompact) {
    return (
      <WidgetShell {...shellProps}>
        <div className="flex h-full flex-col min-h-[44px]">
          {routes.length > 0 ? (
            <WidgetRankedList
              items={items}
              compact
              emptyMessage={t('widget.routeEfficiency.noData', 'No route data')}
              emptyIcon={<Route className="h-5 w-5" />}
            />
          ) : (
            <EmptyState /* no-action: transient empty state — surfaces when source data is missing; no specific recovery action available */
              icon={<Route className="h-5 w-5" />}
              message={t('widget.routeEfficiency.noData', 'No route data')}
              className="py-2"
            />
          )}
        </div>
      </WidgetShell>
    );
  }

  return (
    <WidgetShell
      title={t('widget.routeEfficiency.title', 'Route Efficiency')}
      icon={<Route className="h-3.5 w-3.5 text-emerald-400" />}
      {...shellProps}
    >
      {routes.length > 0 ? (
        <WidgetRankedList
          items={items}
          emptyMessage={t('widget.routeEfficiency.noData', 'No route data')}
          emptyIcon={<Route className="h-5 w-5" />}
        />
      ) : (
        <EmptyState /* no-action: transient empty state — surfaces when source data is missing; no specific recovery action available */
          icon={<Route className="h-5 w-5" />}
          message={t('widget.routeEfficiency.noData', 'No route data')}
          className="py-4"
        />
      )}
    </WidgetShell>
  );
}
