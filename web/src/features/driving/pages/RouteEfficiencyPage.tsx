import { useEffect, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Route, Gauge, Activity, Navigation } from 'lucide-react';

import { PageLayout, ChartCard, LayoutCard, Section } from '@/components/layout';
import { GlassPanel, Pagination, PanelTitle } from '@/components/ui';

import { MetricBar } from '@/components/data-display';
import type { StatMetric } from '@/components/data-display/stat-reference';
import { DrivingSummaryBrief } from '../components/operationalbrief-n-z/DrivingSummaryBrief';
import { Skeleton, EmptyState, QueryError, StaleRefreshWarning } from '@/components/feedback';
import { FadeIn, StaggerContainer, StaggerItem } from '@/components/motion';
import {
  ChartLegend, ChartTooltip,
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from '@/components/charts';

import { AIRouteEfficiencySuggestions } from '@/components/ai';
import { useRouteEfficiency } from '@/api/hooks/useDriving';
import { useSelectedVehicle } from '@/hooks/useSelectedVehicle';
import { useRangeState } from '@/hooks/useRangeState';
import { useUrlNumber } from '@/hooks/useUrlState';
import { useUnits } from '@/hooks/useUnits';
import { usePageTitle } from '@/hooks/usePageTitle';
import { useDataState } from '@/hooks/useDataState';

import {
  RouteCard, makeUnitDisplay, ROUTE_EFF_COLORS, MAX_COMPARISON_ROUTES,
} from '../components/route-efficiency';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';

const ROUTES_PAGE_SIZE = 12;

export default function RouteEfficiencyPage() {
  const { fmtInt, precision: displayPrecision, locale: displayLocale } = useNumberFormatting();
  const { t } = useTranslation();
  usePageTitle(t('routeEfficiency.title', 'Route Efficiency'));

  const { vehicleId } = useSelectedVehicle();
  const vehicleIdStr = vehicleId != null ? String(vehicleId) : undefined;

  const { start: startDate, end: endDate } = useRangeState({
    persistKey: 'route-efficiency.range',
  });
  const [page, setPage] = useUrlNumber('page', 1);

  const routeQuery = useRouteEfficiency(vehicleIdStr, startDate, endDate);
  const { data, refetch } = routeQuery;
  const routeState = useDataState(routeQuery, { provenance: 'historical' });
  const isLoading = vehicleIdStr != null && routeState.status === 'initial';
  const error = vehicleIdStr != null ? routeState.fatalError : null;

  const routes = vehicleIdStr != null ? data?.routes ?? [] : [];
  const hasRoutes = routes.length > 0;
  const totalPages = Math.max(1, Math.ceil(routes.length / ROUTES_PAGE_SIZE));
  const currentPage = Number.isFinite(page)
    ? Math.min(Math.max(1, Math.trunc(page)), totalPages)
    : 1;
  const visibleRoutes = routes.slice((currentPage - 1) * ROUTES_PAGE_SIZE, currentPage * ROUTES_PAGE_SIZE);

  const scope = `${vehicleIdStr ?? ''}|${startDate}|${endDate}`;
  const previousScope = useRef(scope);
  useEffect(() => {
    if (previousScope.current !== scope) {
      previousScope.current = scope;
      if (page !== 1) setPage(1);
    } else if (data && page !== currentPage) {
      setPage(currentPage);
    }
  }, [scope, data, page, currentPage, setPage]);
  // Only surface the hard error state when there is nothing to fall back on.
  // TanStack Query retains the last good `data` when a background refetch
  // fails, so a transient error must not blow the still-valid routes away —
  // the page keeps rendering them and the header freshness chip (wired via
  // `query={routeQuery}`) reflects the degraded state instead.
  const isError = error != null;

  const { unitPrefs } = useUnits();
  const unit = useMemo(() => makeUnitDisplay(unitPrefs.distance), [unitPrefs.distance, displayPrecision, displayLocale]);

  /* ---- Aggregates (SI Wh/km in, converted at the display boundary) ---- */
  const totalTrips = routes.reduce((sum, r) => sum + (r.tripCount ?? 0), 0);
  const bestEff = hasRoutes ? Math.min(...routes.map((r) => r.bestEfficiency ?? 0)) : 0;
  const worstEff = hasRoutes ? Math.max(...routes.map((r) => r.worstEfficiency ?? 0)) : 0;
  const avgEff = hasRoutes
    ? routes.reduce((s, r) => s + (r.avgEfficiency ?? 0), 0) / routes.length
    : 0;
  const mostDrivenTrips = routes[0]?.tripCount ?? 0;

  const sourceAvailable = vehicleIdStr != null && (routeState.hasData || routeQuery.isSuccess);
  const summaryMetrics: readonly StatMetric[] = [
    { metricId: 'count', occurrenceId: 'routes', rawValue: sourceAvailable ? routes.length : null,
      label: t('routeEfficiency.routes', 'Routes') },
    { metricId: 'count', occurrenceId: 'trips', rawValue: sourceAvailable ? totalTrips : null,
      label: t('routeEfficiency.totalTrips', 'Total Trips') },
    ...([
      ['best', bestEff, 'routeEfficiency.bestEfficiency', 'Best'],
      ['average', avgEff, 'routeEfficiency.avgEfficiency', 'Avg'],
      ['worst', worstEff, 'routeEfficiency.worstEfficiency', 'Worst'],
    ] as const).map(([id, raw, key, fallback]): StatMetric => ({
      metricId: 'efficiency', occurrenceId: id, rawValue: hasRoutes ? raw / 1000 : null,
      label: t(key, fallback),
      display: { formatter: (rawValue) => ({ value: fmtInt(unit.toEfficiency(rawValue * 1000)), unit: unit.efficiencyUnit }) },
    })),
    { metricId: 'count', occurrenceId: 'most-driven', rawValue: hasRoutes ? mostDrivenTrips : null,
      label: t('routeEfficiency.mostDrivenTrips', 'Most-driven'),
      context: t('routeEfficiency.trips', 'trips') },
  ];

  /* ---- Comparison chart rows (lowest consumption first) ---- */
  const chartData = useMemo(
    () =>
      [...routes]
        .sort((a, b) => (a.avgEfficiency ?? 0) - (b.avgEfficiency ?? 0))
        .slice(0, MAX_COMPARISON_ROUTES)
        .map((r) => ({
          name: `${(r.startLocation ?? '').substring(0, 10)}→${(r.endLocation ?? '').substring(0, 10)}`,
          best: Math.round(unit.toEfficiency(r.bestEfficiency)),
          avg: Math.round(unit.toEfficiency(r.avgEfficiency)),
          worst: Math.round(unit.toEfficiency(r.worstEfficiency)),
        })),
    [routes, unit],
  );

  const emptyMessage = vehicleIdStr
    ? t('routeEfficiency.noData', 'No route data')
    : t('routeEfficiency.selectVehicle', 'Select a vehicle to see route efficiency');
  const effUnit = unit.efficiencyUnit;

  return (
    <PageLayout
      title={t('routeEfficiency.title', 'Route Efficiency')}
      subtitle={t('routeEfficiency.subtitle', 'Compare efficiency across your most-driven routes')}
      query={routeQuery}
    >
      <StaleRefreshWarning state={routeState} label={t('routeEfficiency.title', 'Route Efficiency')} />
      {/* 1 — KPI band */}
      <FadeIn>
        <DrivingSummaryBrief
          id="route-efficiency-brief"
          title={t('routeEfficiency.kpisAria', 'Route efficiency summary metrics')}
          description={t('routeEfficiency.brief.description', 'All returned routes contribute to these totals; average consumption remains the unweighted mean of route averages.')}
          metrics={summaryMetrics}
          scope={`${startDate} — ${endDate}`}
          provenance={t('routeEfficiency.brief.provenance', 'Returned route-efficiency aggregate before pagination; completeness is not declared by the source.')}
          loading={isLoading}
          unavailable={!sourceAvailable}
          retained={routeState.isRefreshBlocked}
          actions={isError ? <QueryError error={error} onRetry={() => refetch()} /> : undefined}
        />
      </FadeIn>

      {/* 2 — AI suggestions (hidden by withAiFeature when ai_mode='off') */}
      <AIRouteEfficiencySuggestions vehicleId={vehicleIdStr} />

      {/* 3 — Primary bento: comparison chart (hero) + route metrics */}
      <FadeIn delay={0.1}>
        <section
          aria-label={t('routeEfficiency.analysisAria', 'Route efficiency analysis')}
          className="grid grid-cols-1 gap-4 xl:grid-cols-3 xl:gap-5"
        >
          {isError ? (
            <GlassPanel className="p-4 sm:p-5 xl:col-span-2">
              <PanelTitle className="mb-3">
                {t('routeEfficiency.comparison', 'Route Efficiency Comparison')}
              </PanelTitle>
              <QueryError error={error} onRetry={() => refetch()} />
            </GlassPanel>
          ) : (
            <div className="min-w-0 xl:col-span-2">
            <ChartCard
              title={t('routeEfficiency.comparison', 'Route Efficiency Comparison')}
              ariaLabel={t(
                'routeEfficiency.comparisonAria',
                'Per-route best, average, and worst efficiency comparison bar chart',
              )}
              chartKey="route-efficiency-comparison"
              data={chartData}
              dataColumns={[
                { key: 'name', label: t('routeEfficiency.col.route', 'Route') },
                { key: 'best', label: `${t('routeEfficiency.best', 'Best')} ${effUnit}` },
                { key: 'avg', label: `${t('routeEfficiency.avgLabel', 'Avg')} ${effUnit}` },
                { key: 'worst', label: `${t('routeEfficiency.worst', 'Worst')} ${effUnit}` },
              ]}
              height={340}
              mobileHeight={260}
              toolbar
              exportable
              loading={isLoading}
              empty={!isLoading && chartData.length < 2}
            >
              {({ hiddenSeries }) => (
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={chartData} layout="vertical" margin={{ left: 8, right: 12 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--glass-border)" strokeOpacity={0.4} />
                  <XAxis type="number" tick={{ fill: 'var(--text-muted)', fontSize: 10 }} />
                  <YAxis dataKey="name" type="category" tick={{ fill: 'var(--text-muted)', fontSize: 9 }} width={110} />
                  <Tooltip content={<ChartTooltip />} cursor={{ fill: 'var(--surface-2)', fillOpacity: 0.3 }} />
                  <ChartLegend />
                  <Bar dataKey="best" name={`${t('routeEfficiency.best', 'Best')} ${effUnit}`} fill={ROUTE_EFF_COLORS.best} fillOpacity={0.85} radius={[0, 3, 3, 0]} hide={hiddenSeries?.isHidden('best')} />
                  <Bar dataKey="avg" name={`${t('routeEfficiency.avgLabel', 'Avg')} ${effUnit}`} fill={ROUTE_EFF_COLORS.avg} fillOpacity={0.65} radius={[0, 3, 3, 0]} hide={hiddenSeries?.isHidden('avg')} />
                  <Bar dataKey="worst" name={`${t('routeEfficiency.worst', 'Worst')} ${effUnit}`} fill={ROUTE_EFF_COLORS.worst} fillOpacity={0.5} radius={[0, 3, 3, 0]} hide={hiddenSeries?.isHidden('worst')} />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </ChartCard>
            </div>
          )}

          <LayoutCard title={t('routeEfficiency.metrics', 'Route Metrics')} actions={
              <Gauge className="h-4 w-4 text-cyan-300" aria-hidden="true" />
          }>
            {isLoading ? (
              <Skeleton height={220} />
            ) : isError ? (
              <QueryError error={error} onRetry={() => refetch()} />
            ) : !hasRoutes ? (
              <EmptyState /* no-action: transient — no route metrics for the selected vehicle/range */
                icon={<Activity className="h-8 w-8 opacity-20" />}
                message={emptyMessage}
                className="py-8"
              />
            ) : (
              <div className="space-y-4">
                <MetricBar
                  label={t('routeEfficiency.bestLabel', 'Best Efficiency')}
                  value={unit.toEfficiency(bestEff)}
                  max={unit.toEfficiency(300)}
                  color={ROUTE_EFF_COLORS.best}
                  sublabel={`${fmtInt(unit.toEfficiency(bestEff))} ${effUnit}`}
                />
                <MetricBar
                  label={t('routeEfficiency.avgLabel', 'Avg Efficiency')}
                  value={unit.toEfficiency(avgEff)}
                  max={unit.toEfficiency(300)}
                  color={ROUTE_EFF_COLORS.avg}
                  sublabel={`${fmtInt(unit.toEfficiency(avgEff))} ${effUnit}`}
                />
                <MetricBar
                  label={t('routeEfficiency.worstLabel', 'Worst Efficiency')}
                  value={unit.toEfficiency(worstEff)}
                  max={unit.toEfficiency(400)}
                  color={ROUTE_EFF_COLORS.worst}
                  sublabel={`${fmtInt(unit.toEfficiency(worstEff))} ${effUnit}`}
                />
                <MetricBar
                  label={t('routeEfficiency.mostDrivenLabel', 'Most Driven Route')}
                  value={mostDrivenTrips}
                  max={Math.max(mostDrivenTrips, 20)}
                  color={ROUTE_EFF_COLORS.mostDriven}
                  sublabel={`${fmtInt(mostDrivenTrips)} ${t('routeEfficiency.trips', 'trips')}`}
                />
              </div>
            )}
          </LayoutCard>
        </section>
      </FadeIn>

      {/* 4 — Detail band: most-driven route cards */}
      <FadeIn delay={0.2}>
        <Section id="route-efficiency-most-driven" title={t('routeEfficiency.mostDriven', 'Most-driven routes')}>
          <div>
            <Navigation className="h-4 w-4 text-cyan-300" aria-hidden="true" />
          </div>
          {isLoading ? (
            <div className="grid gap-4 [grid-template-columns:repeat(auto-fill,minmax(min(100%,20rem),1fr))]">
              {Array.from({ length: 6 }).map((_, i) => (
                <Skeleton key={i} height={168} />
              ))}
            </div>
          ) : isError ? (
            <GlassPanel className="p-4 sm:p-5">
              <QueryError error={error} onRetry={() => refetch()} />
            </GlassPanel>
          ) : !hasRoutes ? (
            <GlassPanel className="p-4 sm:p-5">
              <EmptyState /* no-action: transient — no routes recorded for the selected vehicle/range */
                icon={<Route className="h-8 w-8 opacity-20" />}
                message={emptyMessage}
                className="py-10"
              />
            </GlassPanel>
          ) : (
            <StaggerContainer className="grid gap-4 [grid-template-columns:repeat(auto-fill,minmax(min(100%,20rem),1fr))]">
              {visibleRoutes.map((route) => (
                <StaggerItem key={`${route.startLocation}-${route.endLocation}`}>
                  <RouteCard route={route} unit={unit} />
                </StaggerItem>
              ))}
            </StaggerContainer>
          )}
          {!isLoading && !isError && routes.length > ROUTES_PAGE_SIZE && (
            <Pagination
              page={currentPage}
              pageSize={ROUTES_PAGE_SIZE}
              total={routes.length}
              onPageChange={setPage}
            />
          )}
        </Section>
      </FadeIn>
    </PageLayout>
  );
}
