import { useTranslation } from 'react-i18next';
import { PageContainer } from '@/components/layout/PageContainer';
import { Grid } from '@/components/layout/Grid';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { StatCard } from '@/components/data-display/StatCard';
import { useRouteEfficiency } from '@/api/hooks/useDriving';
import type { RouteSummary } from '@/types/driving';

function efficiencyVariant(eff: number): 'success' | 'info' | 'warning' | 'danger' {
  if (eff < 5) return 'success';
  if (eff < 10) return 'info';
  if (eff < 15) return 'warning';
  return 'danger';
}

function RouteCard({ route }: { route: RouteSummary }) {
  const { t } = useTranslation();
  return (
    <Card>
      <div className="flex items-start justify-between mb-3">
        <div>
          <p className="text-sm font-medium">
            {route.startLocation} → {route.endLocation}
          </p>
          <p className="text-xs text-gray-500">
            {route.tripCount} {t('routeEfficiency.trips', 'trips')} · {(route.avgDistanceKm ?? 0).toFixed(1)} km avg
          </p>
        </div>
        <Badge variant={efficiencyVariant(route.avgEfficiency)}>
          {(route.avgEfficiency ?? 0).toFixed(1)}%
        </Badge>
      </div>

      <div className="grid grid-cols-3 gap-2 text-center text-xs">
        <div>
          <p className="text-gray-500">{t('routeEfficiency.best', 'Best')}</p>
          <p className="font-semibold text-green-600 dark:text-green-400">{(route.bestEfficiency ?? 0).toFixed(1)}</p>
        </div>
        <div>
          <p className="text-gray-500">{t('routeEfficiency.avg', 'Avg')}</p>
          <p className="font-semibold">{(route.avgEfficiency ?? 0).toFixed(1)}</p>
        </div>
        <div>
          <p className="text-gray-500">{t('routeEfficiency.worst', 'Worst')}</p>
          <p className="font-semibold text-red-600 dark:text-red-400">{(route.worstEfficiency ?? 0).toFixed(1)}</p>
        </div>
      </div>
    </Card>
  );
}

export default function RouteEfficiencyPage() {
  const { t } = useTranslation();
  const { data, isLoading, error } = useRouteEfficiency();

  const routes = data?.routes ?? [];
  const totalTrips = routes.reduce((sum, r) => sum + r.tripCount, 0);
  const bestEff = routes.length > 0 ? Math.min(...routes.map((r) => r.bestEfficiency)) : 0;

  return (
    <PageContainer
      title={t('routeEfficiency.title', 'Route Efficiency')}
      subtitle={t('routeEfficiency.subtitle', 'Compare efficiency across your most-driven routes')}
      loading={isLoading}
      error={error as Error | null}
      empty={routes.length === 0}
      emptyMessage={t('routeEfficiency.empty', 'No route data yet. Routes appear once you have drives with geocoded addresses.')}
    >
      <Grid cols={{ default: 2, md: 4 }} gap={4}>
        <StatCard
          label={t('routeEfficiency.routes', 'Routes')}
          value={routes.length}
        />
        <StatCard
          label={t('routeEfficiency.totalTrips', 'Total Trips')}
          value={totalTrips}
        />
        <StatCard
          label={t('routeEfficiency.bestEfficiency', 'Best Efficiency')}
          value={bestEff.toFixed(1)}
          unit="%"
        />
        {routes.length > 0 && (
          <StatCard
            label={t('routeEfficiency.mostDriven', 'Most Driven')}
            value={`${routes[0].tripCount}x`}
          />
        )}
      </Grid>

      <Grid cols={{ default: 1, md: 2 }} gap={4}>
        {routes.map((route) => (
          <RouteCard
            key={`${route.startLocation}-${route.endLocation}`}
            route={route}
          />
        ))}
      </Grid>
    </PageContainer>
  );
}
