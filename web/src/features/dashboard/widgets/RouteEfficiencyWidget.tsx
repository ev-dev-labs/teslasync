import { useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Route } from 'lucide-react';
import { EmptyState } from '@/components/feedback';
import { useRouteEfficiency } from '@/api/hooks/useDriving';
import { useVehicles } from '@/api/hooks/useVehicles';
import { knownNumber } from '@/api/dataState';
import { useDataState } from '@/hooks/useDataState';
import { convertEfficiencyFromSI } from '@/lib/unitConversion';
import { useUnits } from '@/hooks/useUnits';

import { WidgetShell } from './WidgetShell';
import { WidgetRankedList, type RankedItem } from './shared';
import type { WidgetProps } from './types';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';

const LIST_LAYOUT_CLASS = 'min-w-0 [&_li>div.relative]:flex-wrap [&_li>div.relative>span.flex-1]:basis-full @sm:[&_li>div.relative>span.flex-1]:basis-auto [&_li>div.relative>span.flex-1]:whitespace-normal [&_li>div.relative>span.flex-1]:break-words [&_li>div.relative>span.shrink-0]:max-w-full';

function efficiencyBadge(
  rawWhPerKm: number,
  t: (key: string, fallback: string) => string,
): RankedItem['badge'] {
  if (rawWhPerKm <= 250) return { text: t('widget.routeEfficiency.excellent', 'Excellent'), variant: 'success' };
  if (rawWhPerKm <= 325) return { text: t('widget.routeEfficiency.good', 'Good'), variant: 'success' };
  if (rawWhPerKm <= 400) return { text: t('widget.routeEfficiency.fair', 'Fair'), variant: 'warning' };
  return { text: t('widget.routeEfficiency.poor', 'Poor'), variant: 'error' };
}

export default function RouteEfficiencyWidget({ vehicleId, size }: WidgetProps) {
  const { fmtNumber, fmtInt } = useNumberFormatting();
  const { t } = useTranslation('dashboard');
  const { data: vehicles } = useVehicles();
  const vid = vehicleId ?? vehicles?.[0]?.id;
  const vehicleIdStr = vid != null ? String(vid) : undefined;

  const query = useRouteEfficiency(vehicleIdStr);
  const { data, isLoading, error, isFetching, isStale, isError, dataUpdatedAt, refetch } = query;
  const trust = useDataState({ ...query, data: data ?? undefined }, { provenance: 'historical' });

  const { unitPrefs } = useUnits();
  const isMiles = unitPrefs.distance === 'mi';
  // Stable across renders (keyed on the unit only) so the `items` memo below
  // is not defeated by a fresh closure on every render.
  const toEfficiencyDisplay = useCallback(
    (whPerKm: number) => convertEfficiencyFromSI(whPerKm, isMiles ? 'mi' : 'km'),
    [isMiles],
  );

  const efficiencyUnit = isMiles ? 'Wh/mi' : 'Wh/km';

  const isCompact = size.cols <= 1;
  const isWide = size.cols >= 3;

  const routes = useMemo(() => data?.routes ?? [], [data]);

  const items: RankedItem[] = useMemo(() => {
    const bestRaw = routes.length > 0
      ? Math.min(...routes.map(r => knownNumber(r.avgEfficiency) ?? Infinity))
      : Infinity;

    return routes.map((r, i) => {
      const rawEff = knownNumber(r.avgEfficiency);
      const eff = rawEff == null ? null : toEfficiencyDisplay(rawEff);
      const trips = knownNumber(r.tripCount);
      const isBest = rawEff != null && rawEff === bestRaw;
      const reading = (value: unknown) => {
        const number = knownNumber(value);
        return number == null ? '—' : fmtNumber(toEfficiencyDisplay(number));
      };

      let label = `${r.startLocation ?? '—'} → ${r.endLocation ?? '—'}`;
      if (isWide) {
        const bestEff = reading(r.bestEfficiency);
        const worstEff = reading(r.worstEfficiency);
        label += `  ·  ${t('widget.routeEfficiency.best', 'best')} ${bestEff} / ${t('widget.routeEfficiency.worst', 'worst')} ${worstEff} ${efficiencyUnit}`;
      }

      return {
        id: i,
        label,
        // Invert: lower Wh/unit (better) → higher value → ranks first
        value: eff == null ? 0 : 10000 / (Math.max(0, eff) + 1),
        formattedValue: `${eff == null ? '—' : `${fmtNumber(eff)} ${efficiencyUnit}`} · ${trips == null ? '—' : fmtInt(trips)}×`,
        badge: rawEff == null ? undefined : efficiencyBadge(rawEff, t),
        barColor: isBest ? 'bg-emerald-400' : 'bg-blue-400',
      };
    });
  }, [routes, toEfficiencyDisplay, efficiencyUnit, isWide, t, fmtNumber, fmtInt]);

  const handleRefresh = useCallback(() => {
    refetch();
  }, [refetch]);

  const shellProps = {
    loading: isLoading,
    dataState: data != null || isLoading || isError || error ? trust : undefined,
    updatedAt: dataUpdatedAt,
    isFetching,
    isStale,
    isError,
    onRefresh: handleRefresh,
  };

  if (isCompact) {
    return (
      <WidgetShell title={t('widget.routeEfficiency.title', 'Route efficiency')} {...shellProps}>
        <div className={LIST_LAYOUT_CLASS}>
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
      title={t('widget.routeEfficiency.title', 'Route efficiency')}
      icon={<Route className="h-3.5 w-3.5 text-emerald-400" />}
      {...shellProps}
    >
      {routes.length > 0 ? (
        <div className={LIST_LAYOUT_CLASS}>
          <WidgetRankedList
            items={items}
            emptyMessage={t('widget.routeEfficiency.noData', 'No route data')}
            emptyIcon={<Route className="h-5 w-5" />}
          />
        </div>
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
