import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Compass, MapPin, Milestone, Sparkles } from 'lucide-react';

import { PageContainer } from '@/components/layout';
import { GlassPanel, PanelTitle, Text, HelpTooltip, DataTable, type Column } from '@/components/ui';
import { VehicleSelect } from '@/components/forms';
import { MetricCard } from '@/components/data-display';
import { Skeleton, EmptyState, QueryError } from '@/components/feedback';
import { FadeIn } from '@/components/motion';
import { NoVehicleSelected } from '@/features/onboarding/components/NoVehicleSelected';
import {
  ChartContainer, ChartTooltip,
  BarChart, Bar,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from '@/components/charts';

import { useDrives } from '@/api/hooks/useDriving';
import { useSelectedVehicle } from '@/hooks/useSelectedVehicle';
import { useUnits } from '@/hooks/useUnits';
import { usePageTitle } from '@/hooks/usePageTitle';
import { chartTokens } from '@/lib/tokens';

import { summarizeExplorer, type Destination } from '../lib/explorer';

export default function ExplorerPage() {
  const { t } = useTranslation();
  usePageTitle(t('explorer.title', 'Explorer'));

  const { vehicleId } = useSelectedVehicle();
  const vehicleIdStr = vehicleId != null ? String(vehicleId) : undefined;
  const { formatDistance } = useUnits();

  const drivesQuery = useDrives(vehicleIdStr);

  const summary = useMemo(() => summarizeExplorer(drivesQuery.data ?? []), [drivesQuery.data]);

  const fmtKm = (km: number) => formatDistance(km * 1000, { precision: 0 });

  const columns = useMemo<Column<Destination>[]>(() => [
    {
      key: 'label',
      header: t('explorer.place', 'Place'),
      render: (r) => (
        <Text variant="bodySm" className="block max-w-[16rem] truncate" title={r.label ?? r.cell}>
          {r.label ?? t('explorer.unnamed', 'Unnamed spot ({{cell}})', { cell: r.cell })}
        </Text>
      ),
    },
    {
      key: 'visits',
      header: t('explorer.visits', 'Visits'),
      align: 'right',
      sortable: true,
      render: (r) => <Text variant="body" className="font-mono tabular-nums">{r.visits}</Text>,
    },
    {
      key: 'distanceFromHomeKm',
      header: t('explorer.fromHome', 'From Home'),
      align: 'right',
      sortable: true,
      render: (r) => (
        <Text variant="body" className="font-mono tabular-nums">{fmtKm(r.distanceFromHomeKm)}</Text>
      ),
    },
    {
      key: 'firstVisitMonth',
      header: t('explorer.firstVisit', 'First Visit'),
      align: 'right',
      sortable: true,
      render: (r) => <Text variant="bodySm">{r.firstVisitMonth}</Text>,
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- fmtKm derives from formatDistance
  ], [t, formatDistance]);

  if (vehicleId == null) {
    return <NoVehicleSelected pageTitle={t('explorer.title', 'Explorer')} />;
  }

  const isLoading = drivesQuery.isLoading;
  const isError = drivesQuery.isError;

  return (
    <PageContainer
      title={t('explorer.title', 'Explorer')}
      subtitle={t('explorer.subtitle', 'How far and how wide your car actually roams')}
      query={drivesQuery}
      actions={<VehicleSelect />}
    >
      {/* 1 — KPI band */}
      <FadeIn>
        <section
          aria-label={t('explorer.kpis', 'Explorer summary metrics')}
          className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4"
        >
          {isError ? (
            <GlassPanel className="col-span-full p-4 sm:p-5">
              <QueryError error={drivesQuery.error} onRetry={() => drivesQuery.refetch()} />
            </GlassPanel>
          ) : isLoading ? (
            Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} height={96} className="rounded-xl" />
            ))
          ) : (
            <>
              <MetricCard
                label={t('explorer.uniquePlaces', 'Unique Places')}
                value={summary.uniquePlaces}
                subtitle={t('explorer.arrivals', '{{count}} located arrivals', { count: summary.analyzed })}
                icon={<MapPin className="h-5 w-5" />}
                color="cyan"
              />
              <MetricCard
                label={t('explorer.radius', 'Roaming Radius')}
                value={summary.radiusKm != null ? fmtKm(summary.radiusKm) : '—'}
                subtitle={t('explorer.radiusHint', '90% of arrivals within')}
                icon={<Compass className="h-5 w-5" />}
                color="green"
              />
              <MetricCard
                label={t('explorer.farthest', 'Farthest Point')}
                value={summary.farthest ? fmtKm(summary.farthest.distanceFromHomeKm) : '—'}
                subtitle={summary.farthest?.label ?? undefined}
                icon={<Milestone className="h-5 w-5" />}
                color="purple"
              />
              <MetricCard
                label={t('explorer.home', 'Home Base')}
                value={summary.home?.label ?? (summary.home ? t('explorer.located', 'Located') : '—')}
                subtitle={t('explorer.homeHint', 'most frequent arrival')}
                icon={<Sparkles className="h-5 w-5" />}
                color="amber"
              />
            </>
          )}
        </section>
      </FadeIn>

      {/* 2 — Destinations (2/3) + discoveries (1/3) */}
      <FadeIn delay={0.1}>
        <section className="grid grid-cols-1 gap-4 xl:grid-cols-3">
          <GlassPanel className="p-4 sm:p-5 xl:col-span-2">
            <PanelTitle className="mb-3 flex items-center gap-2">
              <MapPin className="h-4 w-4 text-cyan-300" aria-hidden="true" />
              {t('explorer.destinations', 'Destinations')}
              <HelpTooltip
                size="sm"
                i18nKey="help.explorer.body"
                defaultValue="Arrivals are clustered into ~1 km cells; the most-visited cell becomes your home base and everything else counts as a destination. The roaming radius is the distance covering 90% of your arrivals."
                ariaLabel={t('help.explorer.iconLabel', 'More info about explorer stats')}
              />
            </PanelTitle>
            {isError ? (
              <QueryError error={drivesQuery.error} onRetry={() => drivesQuery.refetch()} />
            ) : isLoading ? (
              <Skeleton height={280} />
            ) : summary.destinations.length === 0 ? (
              <EmptyState
                icon={<Compass className="h-8 w-8" />}
                message={t('explorer.noData', 'No located drives yet — GPS end positions are required.')}
                actionTo={{ label: t('explorer.browseDrives', 'Browse drives'), to: '/drives' }}
              />
            ) : (
              <DataTable
                tableId="driving:explorer-destinations"
                columns={columns}
                data={summary.destinations}
                keyExtractor={(r) => r.cell}
                emptyMessage={t('explorer.noData', 'No located drives yet — GPS end positions are required.')}
                pagination
              />
            )}
          </GlassPanel>

          <ChartContainer
            className="xl:col-span-1"
            title={t('explorer.discoveries', 'New Places per Month')}
            ariaLabel={t('explorer.discoveries.aria', 'Count of first-time destinations per month')}
            loading={isLoading}
            empty={summary.monthlyDiscoveries.length < 2}
            height={300}
            data={summary.monthlyDiscoveries}
            dataColumns={[
              { key: 'month', label: t('explorer.col.month', 'Month') },
              { key: 'newPlaces', label: t('explorer.col.newPlaces', 'New places') },
            ]}
          >
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={summary.monthlyDiscoveries}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--glass-border)" strokeOpacity={0.4} />
                <XAxis dataKey="month" tick={{ fill: 'var(--text-muted)', fontSize: 10 }} />
                <YAxis allowDecimals={false} tick={{ fill: 'var(--text-muted)', fontSize: 11 }} />
                <Tooltip content={<ChartTooltip />} />
                <Bar
                  dataKey="newPlaces"
                  name={t('explorer.newPlaces', 'New places')}
                  fill={chartTokens.series[5]}
                  fillOpacity={0.8}
                  radius={[4, 4, 0, 0]}
                />
              </BarChart>
            </ResponsiveContainer>
          </ChartContainer>
        </section>
      </FadeIn>
    </PageContainer>
  );
}
