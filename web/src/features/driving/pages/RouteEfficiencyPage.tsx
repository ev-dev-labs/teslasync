import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { MapPin, ArrowRight, TrendingUp, Activity } from 'lucide-react';
import { PageContainer } from '@/components/layout/PageContainer';
import { GlassPanel } from '@/components/ui/GlassPanel';
import { Badge } from '@/components/ui/Badge';
import { IconBox } from '@/components/ui/IconBox';
import { VehicleSelect, RangePicker } from '@/components/forms';
import { useUrlString, useUrlBatch } from '@/hooks/useUrlState';
import {
  ChartContainer, ChartTooltip,
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from '@/components/charts';
import { AnimatedNumber } from '@/components/data-display/AnimatedNumber';
import { MetricBar } from '@/components/data-display/MetricBar';
import { EmptyState } from '@/components/feedback/EmptyState';
import { FadeIn } from '@/components/motion/FadeIn';
import { StaggerContainer } from '@/components/motion/StaggerContainer';
import { StaggerItem } from '@/components/motion/StaggerItem';
import { useRouteEfficiency } from '@/api/hooks/useDriving';
import { useSelectedVehicle } from '@/hooks/useSelectedVehicle';
import { useUnits } from '@/hooks/useUnits';
import { usePageTitle } from '@/hooks/usePageTitle';
import { fmtNumber, fmtInt } from '@/lib/numberFormat';
import type { RouteSummary } from '@/types/driving';
import { convertDistanceFromSI } from '@/lib/unitConversion';

/* ------------------------------------------------------------------ */
/*  Helpers                                                           */
/* ------------------------------------------------------------------ */

function efficiencyVariant(eff: number): 'success' | 'info' | 'warning' | 'danger' {
  if (eff < 140) return 'success';
  if (eff < 180) return 'info';
  if (eff < 220) return 'warning';
  return 'danger';
}

/* ------------------------------------------------------------------ */
/*  RouteCard                                                         */
/* ------------------------------------------------------------------ */

function RouteCard({ route, efficiencyUnit, distanceUnit, toDistanceDisplay, toEfficiencyDisplay }: {
  route: RouteSummary;
  efficiencyUnit: string;
  distanceUnit: string;
  toDistanceDisplay: (v: number) => number;
  toEfficiencyDisplay: (v: number) => number;
}) {
  const { t } = useTranslation();
  const avgEff = toEfficiencyDisplay(route.avgEfficiency);
  const bestEff = toEfficiencyDisplay(route.bestEfficiency);
  const worstEff = toEfficiencyDisplay(route.worstEfficiency);

  return (
    <GlassPanel hover glow="cyan" className="p-5 cursor-pointer transition-all">
      <div className="flex items-start justify-between mb-3">
        <div className="flex items-center gap-2">
          <IconBox color="cyan"><MapPin className="h-4 w-4" /></IconBox>
          <div>
            <p className="text-sm font-semibold text-[var(--text-primary)]">
              {route.startLocation} <ArrowRight className="h-3 w-3 inline mx-1 text-[var(--text-muted)]" /> {route.endLocation}
            </p>
            <p className="text-[10px] text-[var(--text-muted)]">
               {route.tripCount} {t('routeEfficiency.trips', 'trips')} · {fmtNumber(toDistanceDisplay(route.avgDistanceKm * 1000))} {distanceUnit} {t('routeEfficiency.avg', 'avg')}
            </p>
          </div>
        </div>
        <Badge variant={efficiencyVariant(route.avgEfficiency)}>
          {fmtInt(avgEff)} {efficiencyUnit}
        </Badge>
      </div>

      {/* Efficiency bar */}
      <div className="flex items-center gap-2 mt-3">
        <div className="flex-1 h-3 rounded-full overflow-hidden bg-[var(--surface-2)]">
          <div
            className="h-full rounded-full"
            style={{
              width: '100%', background: `linear-gradient(to right, #10b981 ${(bestEff / Math.max(worstEff, 1)) * 100}%, #00f0ff ${(bestEff / Math.max(worstEff, 1)) * 100}% ${(avgEff / Math.max(worstEff, 1)) * 100}%, #ef4444 ${(avgEff / Math.max(worstEff, 1)) * 100}%)`, }}
          />
        </div>
        <div className="flex gap-3 text-[10px] shrink-0">
          <span className="text-green-400 font-bold">{fmtInt(bestEff)}</span>
          <span className="text-cyan-400 font-bold">{fmtInt(avgEff)}</span>
          <span className="text-red-400 font-bold">{fmtInt(worstEff)}</span>
        </div>
      </div>
      <div className="flex gap-3 text-[9px] text-[var(--text-muted)] mt-1 justify-end">
        <span>{t('routeEfficiency.best', 'Best')}</span>
        <span>{t('routeEfficiency.avgLabel', 'Avg')}</span>
        <span>{t('routeEfficiency.worst', 'Worst')}</span>
      </div>
    </GlassPanel>
  );
}

/* ------------------------------------------------------------------ */
/*  RouteEfficiencyPage                                               */
/* ------------------------------------------------------------------ */

export default function RouteEfficiencyPage() {
  const { t } = useTranslation();
  usePageTitle(t('routeEfficiency.title', 'Route Efficiency'));

  const { vehicleId } = useSelectedVehicle();
  const vehicleIdStr = vehicleId != null ? String(vehicleId) : undefined;

  const defaultStartDate = useMemo(() => {
    const d = new Date();
    d.setDate(d.getDate() - 30);
    return d.toISOString().split('T')[0];
  }, []);
  const defaultEndDate = useMemo(() => new Date().toISOString().split('T')[0], []);
  const [startDate] = useUrlString('from', defaultStartDate);
  const [endDate] = useUrlString('to', defaultEndDate);
  const setRangeBatch = useUrlBatch();

  const { data, isLoading, error } = useRouteEfficiency(vehicleIdStr, startDate, endDate);
  const { unitPrefs } = useUnits();
  const toDistanceDisplay = (value: number) => convertDistanceFromSI(value, unitPrefs.distance);

  const distanceUnit = unitPrefs.distance;
  const efficiencyUnit = unitPrefs.distance === 'mi' ? 'Wh/mi' : 'Wh/km';
  const toEfficiencyDisplay = (whPerKm: number) => unitPrefs.distance === 'mi' ? whPerKm * 1.609344 : whPerKm;

  const routes = data?.routes ?? [];
  const totalTrips = routes.reduce((sum, r) => sum + r.tripCount, 0);
  const bestEff = routes.length > 0 ? Math.min(...routes.map((r) => r.bestEfficiency)) : 0;
  const worstEff = routes.length > 0 ? Math.max(...routes.map((r) => r.worstEfficiency)) : 0;
  const avgEff = routes.length > 0 ? routes.reduce((s, r) => s + r.avgEfficiency, 0) / routes.length : 0;

  /* ---- Chart data for route comparison ---- */
  const chartData = useMemo(() => {
    return routes
      .sort((a, b) => a.avgEfficiency - b.avgEfficiency)
      .slice(0, 10)
      .map((r) => ({
        name: `${(r.startLocation ?? '').substring(0, 10)}→${(r.endLocation ?? '').substring(0, 10)}`,
        avg: Math.round(toEfficiencyDisplay(r.avgEfficiency)),
        best: Math.round(toEfficiencyDisplay(r.bestEfficiency)),
        worst: Math.round(toEfficiencyDisplay(r.worstEfficiency)),
        trips: r.tripCount,
      }));
  }, [routes, toEfficiencyDisplay]);

  return (
    <PageContainer
      title={t('routeEfficiency.title', 'Route Efficiency')}
      subtitle={t('routeEfficiency.subtitle', 'Compare efficiency across your most-driven routes')}
      error={error as Error | null}
      actions={
        <div className="flex flex-wrap items-center gap-3">
          <VehicleSelect />
          <RangePicker
            value={{ start: startDate, end: endDate }}
            onChange={(r) => setRangeBatch({ from: r.start, to: r.end })}
            align="end"
            triggerTestId="route-efficiency-range-picker"
          />
        </div>
      }
      loading={isLoading}
    >
      {/* Summary stats */}
      <FadeIn>
        <GlassPanel className="p-4 sm:p-6">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-center">
            <div>
              <p className="text-2xl font-bold text-cyan-400"><AnimatedNumber value={routes.length} /></p>
              <p className="text-[10px] text-[var(--text-muted)] uppercase">{t('routeEfficiency.routes', 'Routes')}</p>
            </div>
            <div>
              <p className="text-2xl font-bold text-[var(--text-primary)]"><AnimatedNumber value={totalTrips} /></p>
              <p className="text-[10px] text-[var(--text-muted)] uppercase">{t('routeEfficiency.totalTrips', 'Total Trips')}</p>
            </div>
            <div>
              <p className="text-2xl font-bold text-green-400"><AnimatedNumber value={Math.round(toEfficiencyDisplay(bestEff))} /></p>
              <p className="text-[10px] text-[var(--text-muted)] uppercase">{t('routeEfficiency.bestEfficiency', 'Best')} {efficiencyUnit}</p>
            </div>
            <div>
              <p className="text-2xl font-bold text-amber-400"><AnimatedNumber value={Math.round(toEfficiencyDisplay(avgEff))} /></p>
              <p className="text-[10px] text-[var(--text-muted)] uppercase">{t('routeEfficiency.avgEfficiency', 'Avg')} {efficiencyUnit}</p>
            </div>
          </div>
        </GlassPanel>
      </FadeIn>

      {/* Route efficiency comparison chart */}
      {chartData.length > 1 && (
        <FadeIn>
          <ChartContainer
            title={t('routeEfficiency.comparison', 'Route Efficiency Comparison')}
            ariaLabel={t('routeEfficiency.comparison.aria', 'Per-route best, average, and worst efficiency comparison bar chart')}
            data={chartData.map((r) => ({ name: r.name, best: r.best, avg: r.avg, worst: r.worst }))}
            dataColumns={[
              { key: 'name', label: t('routeEfficiency.col.route', 'Route') },
              { key: 'best', label: `${t('routeEfficiency.best', 'Best')} ${efficiencyUnit}` },
              { key: 'avg', label: `${t('routeEfficiency.avgLabel', 'Avg')} ${efficiencyUnit}` },
              { key: 'worst', label: `${t('routeEfficiency.worst', 'Worst')} ${efficiencyUnit}` },
            ]}
            height={260}
          >
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData} layout="vertical">
                <CartesianGrid strokeDasharray="3 3" stroke="var(--glass-border)" strokeOpacity={0.4} />
                <XAxis type="number" tick={{ fill: 'var(--text-muted)', fontSize: 10 }} />
                <YAxis dataKey="name" type="category" tick={{ fill: 'var(--text-muted)', fontSize: 9 }} width={120} />
                <Tooltip content={<ChartTooltip />} />
                <Bar dataKey="best" name={`${t('routeEfficiency.best', 'Best')} ${efficiencyUnit}`} fill="#10b981" fillOpacity={0.8} radius={[0, 3, 3, 0]} />
                <Bar dataKey="avg" name={`${t('routeEfficiency.avgLabel', 'Avg')} ${efficiencyUnit}`} fill="#00f0ff" fillOpacity={0.6} radius={[0, 3, 3, 0]} />
                <Bar dataKey="worst" name={`${t('routeEfficiency.worst', 'Worst')} ${efficiencyUnit}`} fill="#ef4444" fillOpacity={0.5} radius={[0, 3, 3, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </ChartContainer>
        </FadeIn>
      )}

      {/* Route cards */}
      <StaggerContainer className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {routes.map((route) => (
          <StaggerItem key={`${route.startLocation}-${route.endLocation}`}>
            <RouteCard
              route={route}
              efficiencyUnit={efficiencyUnit}
              distanceUnit={distanceUnit}
              toDistanceDisplay={toDistanceDisplay}
              toEfficiencyDisplay={toEfficiencyDisplay}
            />
          </StaggerItem>
        ))}
      </StaggerContainer>

      {/* Metric bars */}
      <FadeIn>
        <GlassPanel className="p-4 sm:p-5">
          <h3 className="text-sm font-semibold text-[var(--text-primary)] flex items-center gap-2 mb-4">
            <TrendingUp className="h-4 w-4 text-cyan-400" /> {t('routeEfficiency.metrics', 'Route Metrics')}
          </h3>
          {routes.length > 0 ? (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 sm:gap-4">
              <div>
                <MetricBar label={t('routeEfficiency.bestLabel', 'Best Efficiency')} value={toEfficiencyDisplay(bestEff)} max={300} color="#10b981" />
                <p className="text-[10px] text-[var(--text-muted)] mt-1">{fmtInt(toEfficiencyDisplay(bestEff))} {efficiencyUnit}</p>
              </div>
              <div>
                <MetricBar label={t('routeEfficiency.avgLabel', 'Avg Efficiency')} value={toEfficiencyDisplay(avgEff)} max={300} color="#00f0ff" />
                <p className="text-[10px] text-[var(--text-muted)] mt-1">{fmtInt(toEfficiencyDisplay(avgEff))} {efficiencyUnit}</p>
              </div>
              <div>
                <MetricBar label={t('routeEfficiency.worstLabel', 'Worst Efficiency')} value={toEfficiencyDisplay(worstEff)} max={400} color="#ef4444" />
                <p className="text-[10px] text-[var(--text-muted)] mt-1">{fmtInt(toEfficiencyDisplay(worstEff))} {efficiencyUnit}</p>
              </div>
              <div>
                <MetricBar label={t('routeEfficiency.mostDrivenLabel', 'Most Driven Route')} value={routes[0]?.tripCount ?? 0} max={Math.max(routes[0]?.tripCount ?? 1, 20)} color="#a855f7" />
                <p className="text-[10px] text-[var(--text-muted)] mt-1">{routes[0]?.tripCount ?? 0} {t('routeEfficiency.trips', 'trips')}</p>
              </div>
            </div>
          ) : (
            <EmptyState /* no-action: transient empty state — surfaces when source data is missing; no specific recovery action available */
              icon={<Activity className="h-8 w-8 opacity-20" />}
              message={t('common.noData', 'No data available')}
              className="py-8"
            />
          )}
        </GlassPanel>
      </FadeIn>
    </PageContainer>
  );
}
