import { useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Route } from 'lucide-react';
import { EmptyState } from '@/components/feedback';
import { Badge, Caption } from '@/components/ui';
import { useRouteEfficiency } from '@/api/hooks/useDriving';
import { useVehicles } from '@/api/hooks/useVehicles';
import { knownNumber } from '@/api/dataState';
import { useDataState } from '@/hooks/useDataState';
import { convertEfficiencyFromSI } from '@/lib/unitConversion';
import { useUnits } from '@/hooks/useUnits';

import { WidgetShell } from './WidgetShell';
import InstrumentPresentation from './designPacks/InstrumentPresentation';
import { WidgetBigNumber, WidgetDetailCard, WidgetRankedList, type RankedItem } from './shared';
import type { WidgetProps } from './types';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';

function efficiencyBadge(
  rawWhPerKm: number,
  t: (key: string, fallback: string) => string,
): RankedItem['badge'] {
  if (rawWhPerKm <= 250) return { text: t('widget.routeEfficiency.excellent', 'Excellent'), variant: 'success' };
  if (rawWhPerKm <= 325) return { text: t('widget.routeEfficiency.good', 'Good'), variant: 'success' };
  if (rawWhPerKm <= 400) return { text: t('widget.routeEfficiency.fair', 'Fair'), variant: 'warning' };
  return { text: t('widget.routeEfficiency.poor', 'Poor'), variant: 'error' };
}

export default function RouteEfficiencyWidget({ vehicleId, size, config }: WidgetProps) {
  const { fmtNumber, fmtInt } = useNumberFormatting();
  const { t } = useTranslation('dashboard');
  const { data: vehicles } = useVehicles();
  const vid = vehicleId ?? vehicles?.[0]?.id;
  const vehicleIdStr = vid != null ? String(vid) : undefined;

  const query = useRouteEfficiency(vehicleIdStr, undefined, undefined, config?.timeRange);
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
  const reading = useCallback((value: unknown) => {
    const number = knownNumber(value);
    return number == null ? '—' : fmtNumber(toEfficiencyDisplay(number));
  }, [fmtNumber, toEfficiencyDisplay]);

  const items: RankedItem[] = useMemo(() => {
    const bestRaw = routes.length > 0
      ? Math.min(...routes.map(r => knownNumber(r.avgEfficiency) ?? Infinity))
      : Infinity;

    return routes.map((r, i) => {
      const rawEff = knownNumber(r.avgEfficiency);
      const eff = rawEff == null ? null : toEfficiencyDisplay(rawEff);
      const trips = knownNumber(r.tripCount);
      const isBest = rawEff != null && rawEff === bestRaw;
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
        value: eff == null ? null : 10000 / (Math.max(0, eff) + 1),
        formattedValue: `${eff == null ? '—' : `${fmtNumber(eff)} ${efficiencyUnit}`} · ${trips == null ? '—' : fmtInt(trips)}×`,
        status: (isBest ? 'success' : undefined) as RankedItem['status'],
        badge: rawEff == null ? undefined : efficiencyBadge(rawEff, t),
      };
    }).sort((a, b) => {
      if (a.value == null) return b.value == null ? 0 : 1;
      if (b.value == null) return -1;
      return b.value - a.value;
    });
  }, [routes, toEfficiencyDisplay, efficiencyUnit, isWide, t, fmtNumber, fmtInt, reading]);

  const primaryRoute = routes.find((_, index) => index === items[0]?.id);
  const primaryEfficiency = knownNumber(primaryRoute?.avgEfficiency);
  const trips = knownNumber(primaryRoute?.tripCount);
  const rankedList = (
    <WidgetRankedList items={items} order="source" wrapContent compact={isCompact}
      emptyMessage={t('widget.routeEfficiency.noData', 'No route data')}
      emptyIcon={<Route className="h-5 w-5" />} />
  );
  const presentation = {
    family: 'list' as const,
    compact: isCompact,
    icon: <Route />,
    headline: (
      <div className="min-w-0 space-y-2">
        <WidgetBigNumber value={primaryEfficiency == null ? null : reading(primaryEfficiency)}
          unit={efficiencyUnit} animated={false}
          label={primaryRoute
            ? `${primaryRoute.startLocation ?? '—'} → ${primaryRoute.endLocation ?? '—'}`
            : t('widget.routeEfficiency.noData', 'No route data')} />
        <Badge variant="neutral">{t('dashboardWidgets.driving.routeEfficiency.drives', 'Drives')}: {trips == null ? '—' : fmtInt(trips)}</Badge>
      </div>
    ),
    instrument: routes.length > 0 ? rankedList : (
      <EmptyState variant="informational" icon={<Route className="h-5 w-5" />}
        message={t('widget.routeEfficiency.noData', 'No route data')} className={isCompact ? 'py-2' : 'py-4'} />
    ),
    details: (
      <div className="min-w-0 space-y-2">
        <WidgetDetailCard entries={[
          { label: t('widget.routeEfficiency.best', 'best'), value: primaryRoute?.bestEfficiency },
          { label: t('widget.routeEfficiency.worst', 'worst'), value: primaryRoute?.worstEfficiency },
          { label: t('dashboardWidgets.driving.routeEfficiency.average', 'Average'), value: primaryRoute?.avgEfficiency },
        ].map(entry => ({
          label: entry.label,
          value: knownNumber(entry.value) == null ? '—' : `${reading(entry.value)} ${efficiencyUnit}`,
        }))} />
        <Caption as="p">{t('dashboardWidgets.driving.routeEfficiency.compareNote', 'Compare repeated journeys rather than a single trip.')}</Caption>
      </div>
    ),
  };

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
        <InstrumentPresentation {...presentation}>
          <div className="min-w-0">
            {routes.length > 0 ? rankedList : (
              <EmptyState /* no-action: transient empty state — surfaces when source data is missing; no specific recovery action available */
                icon={<Route className="h-5 w-5" />}
                message={t('widget.routeEfficiency.noData', 'No route data')}
                className="py-2"
              />
            )}
          </div>
        </InstrumentPresentation>
      </WidgetShell>
    );
  }

  return (
    <WidgetShell
      title={t('widget.routeEfficiency.title', 'Route efficiency')}
      icon={<Route className="h-3.5 w-3.5 text-emerald-400" />}
      {...shellProps}
    >
      <InstrumentPresentation {...presentation}>
        {routes.length > 0 ? (
          <div className="min-w-0">
            {rankedList}
          </div>
        ) : (
          <EmptyState /* no-action: transient empty state — surfaces when source data is missing; no specific recovery action available */
            icon={<Route className="h-5 w-5" />}
            message={t('widget.routeEfficiency.noData', 'No route data')}
            className="py-4"
          />
        )}
      </InstrumentPresentation>
    </WidgetShell>
  );
}
