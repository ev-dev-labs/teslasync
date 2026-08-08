import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Route, Repeat, Gauge, Activity, TrendingUp, Award, Navigation } from 'lucide-react';

import { PageContainer } from '@/components/layout';
import { GlassPanel, PanelTitle, SectionTitle } from '@/components/ui';
import { VehicleSelect, RangePicker } from '@/components/forms';
import { MetricCard, MetricBar } from '@/components/data-display';
import { Skeleton, EmptyState, QueryError } from '@/components/feedback';
import { FadeIn, StaggerContainer, StaggerItem } from '@/components/motion';
import {
  ChartContainer, ChartTooltip,
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from '@/components/charts';

import { AIRouteEfficiencySuggestions } from '@/components/ai/AIRouteEfficiencySuggestions';
import { useRouteEfficiency } from '@/api/hooks/useDriving';
import { useSelectedVehicle } from '@/hooks/useSelectedVehicle';
import { useRangeState } from '@/hooks/useRangeState';
import { useUnits } from '@/hooks/useUnits';
import { usePageTitle } from '@/hooks/usePageTitle';
import { fmtInt } from '@/lib/numberFormat';
import {
  RouteCard, makeUnitDisplay, ROUTE_EFF_COLORS, MAX_COMPARISON_ROUTES,
} from '../components/route-efficiency';

export default function RouteEfficiencyPage() {
  const { t } = useTranslation();
  usePageTitle(t('routeEfficiency.title', 'Route Efficiency'));

  const { vehicleId } = useSelectedVehicle();
  const vehicleIdStr = vehicleId != null ? String(vehicleId) : undefined;

  const { start: startDate, end: endDate, setRange } = useRangeState({
    persistKey: 'route-efficiency.range',
    defaultPresetId: '30d',
  });

  const routeQuery = useRouteEfficiency(vehicleIdStr, startDate, endDate);
  const { data, isLoading, error, refetch } = routeQuery;

  const routes = data?.routes ?? [];
  const hasRoutes = routes.length > 0;
  // Only surface the hard error state when there is nothing to fall back on.
  // TanStack Query retains the last good `data` when a background refetch
  // fails, so a transient error must not blow the still-valid routes away —
  // the page keeps rendering them and the header freshness chip (wired via
  // `query={routeQuery}`) reflects the degraded state instead.
  const isError = Boolean(error) && !hasRoutes;

  const { unitPrefs } = useUnits();
  const unit = useMemo(() => makeUnitDisplay(unitPrefs.distance), [unitPrefs.distance]);

  /* ---- Aggregates (SI Wh/km in, converted at the display boundary) ---- */
  const totalTrips = routes.reduce((sum, r) => sum + (r.tripCount ?? 0), 0);
  const bestEff = hasRoutes ? Math.min(...routes.map((r) => r.bestEfficiency ?? 0)) : 0;
  const worstEff = hasRoutes ? Math.max(...routes.map((r) => r.worstEfficiency ?? 0)) : 0;
  const avgEff = hasRoutes
    ? routes.reduce((s, r) => s + (r.avgEfficiency ?? 0), 0) / routes.length
    : 0;
  const mostDrivenTrips = routes[0]?.tripCount ?? 0;

  const effVal = (whPerKm: number) => (hasRoutes ? fmtInt(unit.toEfficiency(whPerKm)) : '—');

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
    <PageContainer
      title={t('routeEfficiency.title', 'Route Efficiency')}
      subtitle={t('routeEfficiency.subtitle', 'Compare efficiency across your most-driven routes')}
      query={routeQuery}
      actions={
        <div className="flex flex-wrap items-center gap-2 sm:gap-3">
          <VehicleSelect />
          <RangePicker
            value={{ start: startDate, end: endDate }}
            onChange={setRange}
            align="end"
            triggerTestId="route-efficiency-range-picker"
          />
        </div>
      }
    >
      {/* 1 — KPI band */}
      <FadeIn>
        <section
          aria-label={t('routeEfficiency.kpisAria', 'Route efficiency summary metrics')}
          className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 xl:grid-cols-6"
        >
          {isLoading ? (
            Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} height={88} />)
          ) : isError ? (
            <div className="col-span-full">
              <QueryError error={error} onRetry={() => refetch()} />
            </div>
          ) : (
            <>
              <MetricCard
                label={t('routeEfficiency.routes', 'Routes')}
                value={fmtInt(routes.length)}
                icon={<Route className="h-5 w-5" />}
                color="cyan"
              />
              <MetricCard
                label={t('routeEfficiency.totalTrips', 'Total Trips')}
                value={fmtInt(totalTrips)}
                icon={<Repeat className="h-5 w-5" />}
                color="blue"
              />
              <MetricCard
                label={t('routeEfficiency.bestEfficiency', 'Best')}
                value={effVal(bestEff)}
                subtitle={effUnit}
                icon={<Gauge className="h-5 w-5" />}
                color="green"
              />
              <MetricCard
                label={t('routeEfficiency.avgEfficiency', 'Avg')}
                value={effVal(avgEff)}
                subtitle={effUnit}
                icon={<Activity className="h-5 w-5" />}
                color="amber"
              />
              <MetricCard
                label={t('routeEfficiency.worstEfficiency', 'Worst')}
                value={effVal(worstEff)}
                subtitle={effUnit}
                icon={<TrendingUp className="h-5 w-5" />}
                color="red"
              />
              <MetricCard
                label={t('routeEfficiency.mostDrivenTrips', 'Most-driven')}
                value={hasRoutes ? fmtInt(mostDrivenTrips) : '—'}
                subtitle={t('routeEfficiency.trips', 'trips')}
                icon={<Award className="h-5 w-5" />}
                color="purple"
              />
            </>
          )}
        </section>
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
            <ChartContainer
              className="xl:col-span-2"
              title={t('routeEfficiency.comparison', 'Route Efficiency Comparison')}
              ariaLabel={t(
                'routeEfficiency.comparisonAria',
                'Per-route best, average, and worst efficiency comparison bar chart',
              )}
              data={chartData}
              dataColumns={[
                { key: 'name', label: t('routeEfficiency.col.route', 'Route') },
                { key: 'best', label: `${t('routeEfficiency.best', 'Best')} ${effUnit}` },
                { key: 'avg', label: `${t('routeEfficiency.avgLabel', 'Avg')} ${effUnit}` },
                { key: 'worst', label: `${t('routeEfficiency.worst', 'Worst')} ${effUnit}` },
              ]}
              height={340}
              loading={isLoading}
              empty={!isLoading && chartData.length < 2}
            >
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chartData} layout="vertical" margin={{ left: 8, right: 12 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--glass-border)" strokeOpacity={0.4} />
                  <XAxis type="number" tick={{ fill: 'var(--text-muted)', fontSize: 10 }} />
                  <YAxis dataKey="name" type="category" tick={{ fill: 'var(--text-muted)', fontSize: 9 }} width={110} />
                  <Tooltip content={<ChartTooltip />} cursor={{ fill: 'var(--surface-2)', fillOpacity: 0.3 }} />
                  <Bar dataKey="best" name={`${t('routeEfficiency.best', 'Best')} ${effUnit}`} fill={ROUTE_EFF_COLORS.best} fillOpacity={0.85} radius={[0, 3, 3, 0]} />
                  <Bar dataKey="avg" name={`${t('routeEfficiency.avgLabel', 'Avg')} ${effUnit}`} fill={ROUTE_EFF_COLORS.avg} fillOpacity={0.65} radius={[0, 3, 3, 0]} />
                  <Bar dataKey="worst" name={`${t('routeEfficiency.worst', 'Worst')} ${effUnit}`} fill={ROUTE_EFF_COLORS.worst} fillOpacity={0.5} radius={[0, 3, 3, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </ChartContainer>
          )}

          <GlassPanel className="p-4 sm:p-5">
            <PanelTitle className="mb-4 flex items-center gap-2">
              <Gauge className="h-4 w-4 text-cyan-300" aria-hidden="true" />
              {t('routeEfficiency.metrics', 'Route Metrics')}
            </PanelTitle>
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
          </GlassPanel>
        </section>
      </FadeIn>

      {/* 4 — Detail band: most-driven route cards */}
      <FadeIn delay={0.2}>
        <section aria-label={t('routeEfficiency.mostDriven', 'Most-driven routes')}>
          <SectionTitle className="mb-3 flex items-center gap-2">
            <Navigation className="h-4 w-4 text-cyan-300" aria-hidden="true" />
            {t('routeEfficiency.mostDriven', 'Most-driven routes')}
          </SectionTitle>
          {isLoading ? (
            <div className="grid gap-4 [grid-template-columns:repeat(auto-fill,minmax(20rem,1fr))]">
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
            <StaggerContainer className="grid gap-4 [grid-template-columns:repeat(auto-fill,minmax(20rem,1fr))]">
              {routes.map((route) => (
                <StaggerItem key={`${route.startLocation}-${route.endLocation}`}>
                  <RouteCard route={route} unit={unit} />
                </StaggerItem>
              ))}
            </StaggerContainer>
          )}
        </section>
      </FadeIn>
    </PageContainer>
  );
}
