import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Layers, Route, Shapes, Target } from 'lucide-react';

import { PageContainer } from '@/components/layout';
import { GlassPanel, PanelTitle, Text, Badge, HelpTooltip } from '@/components/ui';
import { VehicleSelect } from '@/components/forms';
import { MetricCard } from '@/components/data-display';
import { Skeleton, EmptyState, QueryError } from '@/components/feedback';
import { FadeIn } from '@/components/motion';
import { NoVehicleSelected } from '@/features/onboarding/components/NoVehicleSelected';
import {
  ChartContainer, ChartTooltip,
  ScatterChart, Scatter, ZAxis,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from '@/components/charts';

import { useDrives } from '@/api/hooks/useDriving';
import { useSelectedVehicle } from '@/hooks/useSelectedVehicle';
import { useUnits } from '@/hooks/useUnits';
import { usePageTitle } from '@/hooks/usePageTitle';
import { chartTokens } from '@/lib/tokens';

import { summarizeArchetypes, type ArchetypeLabel } from '../lib/driveArchetypes';

const LABEL_DEFAULTS: Record<ArchetypeLabel, string> = {
  highwayRun: 'Highway Run',
  roadTrip: 'Road Trip',
  morningCommute: 'Morning Commute',
  eveningCommute: 'Evening Commute',
  shortHop: 'Short Hop',
  coldWeather: 'Cold Weather',
  everyday: 'Everyday',
};

export default function DriveArchetypesPage() {
  const { t } = useTranslation();
  usePageTitle(t('archetypes.title', 'Drive Archetypes'));

  const { vehicleId } = useSelectedVehicle();
  const vehicleIdStr = vehicleId != null ? String(vehicleId) : undefined;
  const { formatDistance, formatSpeed, formatTemperature } = useUnits();

  const drivesQuery = useDrives(vehicleIdStr);

  const summary = useMemo(
    () => summarizeArchetypes(drivesQuery.data ?? []),
    [drivesQuery.data],
  );

  // One scatter series per cluster: distance against speed, sized by how many
  // drives the cluster holds. This is the projection that makes the k-means
  // partition legible without needing all six dimensions.
  const series = useMemo(
    () =>
      summary.clusters.map((c) => ({
        label: c.label,
        color: chartTokens.series[c.index % chartTokens.series.length]!,
        points: [
          {
            distance: Math.round(c.centroid.distanceKm * 10) / 10,
            speed: Math.round(c.centroid.speedKph),
            size: c.size,
            efficiency: Math.round(c.centroid.whPerKm),
          },
        ],
      })),
    [summary.clusters],
  );

  const flatData = useMemo(
    () =>
      summary.clusters.map((c) => ({
        archetype: t(`archetypes.label.${c.label}`, LABEL_DEFAULTS[c.label]),
        drives: c.size,
        distance: Math.round(c.centroid.distanceKm * 10) / 10,
        speed: Math.round(c.centroid.speedKph),
        efficiency: Math.round(c.centroid.whPerKm),
      })),
    [summary.clusters, t],
  );

  const dominant = summary.clusters[0] ?? null;

  if (vehicleId == null) {
    return <NoVehicleSelected pageTitle={t('archetypes.title', 'Drive Archetypes')} />;
  }

  const isLoading = drivesQuery.isLoading;
  const isError = drivesQuery.isError;

  return (
    <PageContainer
      title={t('archetypes.title', 'Drive Archetypes')}
      subtitle={t(
        'archetypes.subtitle',
        'Unsupervised clustering of every drive into the handful of journeys you actually make',
      )}
      query={drivesQuery}
      actions={<VehicleSelect />}
    >
      {/* 1 — KPI band */}
      <FadeIn>
        <section
          aria-label={t('archetypes.kpis', 'Drive archetype metrics')}
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
                label={t('archetypes.count', 'Archetypes Found')}
                value={summary.k || '—'}
                subtitle={t('archetypes.fromDrives', 'from {{count}} drives', {
                  count: summary.analyzedDrives,
                })}
                icon={<Shapes className="h-5 w-5" />}
                color="cyan"
                help={{
                  i18nKey: 'help.archetypes.count',
                  defaultValue:
                    'Drives are placed in a six-dimensional space (log distance, speed, time of day as a circular pair, consumption, temperature) and partitioned by k-means++. The number of clusters is not chosen by hand — every k from 2 to 5 is tried and the one with the best mean silhouette wins.',
                }}
              />
              <MetricCard
                label={t('archetypes.dominant', 'Most Common')}
                value={
                  dominant != null
                    ? t(`archetypes.label.${dominant.label}`, LABEL_DEFAULTS[dominant.label])
                    : '—'
                }
                subtitle={
                  dominant != null
                    ? t('archetypes.shareOf', '{{share}}% of drives', {
                        share: Math.round(dominant.share * 100),
                      })
                    : undefined
                }
                icon={<Route className="h-5 w-5" />}
                color="purple"
              />
              <MetricCard
                label={t('archetypes.separation', 'Cluster Separation')}
                value={summary.k > 0 ? `${Math.round(summary.silhouette * 100) / 100}` : '—'}
                subtitle={t('archetypes.silhouetteHint', 'mean silhouette, −1 to 1')}
                icon={<Target className="h-5 w-5" />}
                color={
                  summary.silhouette >= 0.5 ? 'green' : summary.silhouette >= 0.25 ? 'amber' : 'blue'
                }
              />
              <MetricCard
                label={t('archetypes.skipped', 'Drives Skipped')}
                value={summary.skippedDrives}
                subtitle={t('archetypes.skippedHint', 'missing distance, energy or speed')}
                icon={<Layers className="h-5 w-5" />}
                color="blue"
              />
            </>
          )}
        </section>
      </FadeIn>

      {/* 2 — Cluster map */}
      <FadeIn delay={0.1}>
        {!isLoading && !isError && summary.k === 0 ? (
          <GlassPanel className="p-4 sm:p-5">
            <EmptyState /* no-action: clustering starts automatically once 20 usable drives exist. */
              icon={<Shapes className="h-8 w-8" />}
              message={t(
                'archetypes.noData',
                'At least twenty complete drives are needed before distinct journey types can be separated.',
              )}
            />
          </GlassPanel>
        ) : (
          <ChartContainer
            title={t('archetypes.chart', 'Archetype Map')}
            subtitle={t(
              'archetypes.chartHint',
              'Each marker is a cluster centre; distance against average speed, sized by how many drives belong to it',
            )}
            ariaLabel={t(
              'archetypes.chart.aria',
              'Scatter plot of drive archetype centres by distance and average speed, sized by cluster membership',
            )}
            loading={isLoading}
            empty={series.length === 0}
            height={380}
            data={flatData}
            dataColumns={[
              { key: 'archetype', label: t('archetypes.col.archetype', 'Archetype') },
              { key: 'drives', label: t('archetypes.col.drives', 'Drives') },
              { key: 'distance', label: t('archetypes.col.distance', 'Distance (km)') },
              { key: 'speed', label: t('archetypes.col.speed', 'Avg speed (km/h)') },
              { key: 'efficiency', label: t('archetypes.col.efficiency', 'Wh/km') },
            ]}
          >
            <ResponsiveContainer width="100%" height="100%">
              <ScatterChart margin={{ top: 16, right: 16, bottom: 24, left: 8 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--glass-border)" strokeOpacity={0.4} />
                <XAxis
                  type="number"
                  dataKey="distance"
                  name={t('archetypes.col.distance', 'Distance (km)')}
                  tick={{ fill: 'var(--text-muted)', fontSize: 11 }}
                />
                <YAxis
                  type="number"
                  dataKey="speed"
                  name={t('archetypes.col.speed', 'Avg speed (km/h)')}
                  tick={{ fill: 'var(--text-muted)', fontSize: 11 }}
                />
                <ZAxis type="number" dataKey="size" range={[80, 900]} />
                <Tooltip content={<ChartTooltip />} cursor={{ strokeDasharray: '3 3' }} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                {series.map((s) => (
                  <Scatter
                    key={s.label}
                    name={t(`archetypes.label.${s.label}`, LABEL_DEFAULTS[s.label])}
                    data={s.points}
                    fill={s.color}
                    fillOpacity={0.75}
                  />
                ))}
              </ScatterChart>
            </ResponsiveContainer>
          </ChartContainer>
        )}
      </FadeIn>

      {/* 3 — Archetype profiles */}
      <FadeIn delay={0.2}>
        <GlassPanel className="p-4 sm:p-5">
          <PanelTitle className="mb-3 flex items-center gap-2">
            <Shapes className="h-4 w-4 text-cyan-300" aria-hidden="true" />
            {t('archetypes.profiles', 'Archetype Profiles')}
            <HelpTooltip
              size="sm"
              i18nKey="help.archetypes.profiles"
              defaultValue="Labels are assigned from the cluster centre, not chosen in advance: a fast, long, low-consumption centre becomes a highway run, an early-morning short one becomes a commute. Time of day is encoded as a sine/cosine pair so 23:00 and 01:00 are correctly treated as neighbours."
              ariaLabel={t('help.archetypes.iconLabel', 'More info about archetype profiles')}
            />
          </PanelTitle>
          {isLoading ? (
            <Skeleton height={160} />
          ) : summary.clusters.length === 0 ? (
            <EmptyState /* no-action: profiles are derived from the clustering and appear with it. */
              icon={<Layers className="h-8 w-8" />}
              message={t(
                'archetypes.noProfiles',
                'No archetypes yet — they appear once enough drives have been recorded to separate.',
              )}
            />
          ) : (
            <ul className="grid gap-3 lg:grid-cols-2">
              {summary.clusters.map((c) => (
                <li
                  key={c.index}
                  className="rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-2)] p-3"
                >
                  <div className="mb-2 flex flex-wrap items-center gap-2">
                    <Badge variant="info">
                      {t(`archetypes.label.${c.label}`, LABEL_DEFAULTS[c.label])}
                    </Badge>
                    <Text variant="caption">
                      {t('archetypes.driveCount', '{{count}} drives · {{share}}%', {
                        count: c.size,
                        share: Math.round(c.share * 100),
                      })}
                    </Text>
                  </div>
                  <div className="grid grid-cols-2 gap-x-4 gap-y-1 sm:grid-cols-4">
                    <Text variant="caption">
                      {t('archetypes.typicalDistance', 'Distance')}
                    </Text>
                    <Text variant="bodySm">{formatDistance(c.centroid.distanceKm * 1000)}</Text>
                    <Text variant="caption">
                      {t('archetypes.typicalSpeed', 'Avg speed')}
                    </Text>
                    <Text variant="bodySm">{formatSpeed((c.centroid.speedKph * 1000) / 3600)}</Text>
                    <Text variant="caption">
                      {t('archetypes.typicalHour', 'Typical start')}
                    </Text>
                    <Text variant="bodySm">
                      {`${String(Math.floor(c.centroid.hour)).padStart(2, '0')}:${String(
                        Math.round((c.centroid.hour % 1) * 60),
                      ).padStart(2, '0')}`}
                    </Text>
                    <Text variant="caption">
                      {t('archetypes.typicalTemp', 'Avg temp')}
                    </Text>
                    <Text variant="bodySm">
                      {formatTemperature(c.centroid.tempC, { precision: 0 })}
                    </Text>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </GlassPanel>
      </FadeIn>
    </PageContainer>
  );
}
