/**
 * LocationsPage — visited locations ranked by frequency.
 *
 * Modern-UI full-width bento redesign:
 *   1. KPI band     — six metric cards that reflow to a 6-across strip on wide screens.
 *   2. Charts bento — the two leaderboards (visits / time) sit side-by-side from `xl` up.
 *   3. Detail band  — searchable, paginated leaderboard whose cards flow into two
 *                     columns on `2xl`, each retaining its inline AI auto-name affordance.
 *
 * Every data-bound section owns its loading / error / empty state; the page is never
 * gated behind a single flag, and all values are null-safe.
 */

import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import {
  Activity,
  BatteryCharging,
  Bell,
  Building2,
  Car,
  Clock,
  Eye,
  Hash,
  MapPin,
  Navigation,
  Route,
  Trophy,
  Wrench,
} from 'lucide-react';

import { PageContainer } from '@/components/layout';
import { Button, GlassPanel, Pagination, PanelTitle, Text } from '@/components/ui';
import { EntityPreviewDrawer, MetricCard } from '@/components/data-display';
import { Skeleton, EmptyState, QueryError } from '@/components/feedback';
import { FadeIn } from '@/components/motion';
import {
  SearchInput,
  FilterBar,
  ActiveFilterChips,
  RangePicker,
  VehicleSelect,
  type FilterChipDescriptor,
} from '@/components/forms';
import { useFilteredList } from '@/hooks/useFilteredList';
import { useRangeState } from '@/hooks/useRangeState';
import { useUrlNumber, useUrlString } from '@/hooks/useUrlState';
import { useSelectedVehicle } from '@/hooks/useSelectedVehicle';

import { usePageTitle } from '@/hooks/usePageTitle';
import { useUnits } from '@/hooks/useUnits';
import { formatDate } from '@/lib/dateFormat';
import { fmtNumber } from '@/lib/numberFormat';
import { cn } from '@/lib/cn';
import { buildContextHref } from '@/lib/contextNavigation';
import { request } from '@/api/client';
import { AIAutoNameUnnamedLocations } from '@/components/ai/AIAutoNameUnnamedLocations';
import { LocationLeaderboardPanel, type LeaderboardDatum } from '../components/LocationLeaderboardPanel';

// ─── Types ───────────────────────────────────────────────────────────────────

interface VisitedLocation {
  id: number;
  address_name: string;
  visit_count: number;
  total_duration_s: number;
  last_visited: string | null;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

// isUnnamedLocation reports whether a visited-location row should
// surface the AI auto-name affordance. Three buckets count as
// "unnamed": empty/whitespace, the literal "Unknown" sentinel the
// reverse-geocoder emits, and the coordinate-pair fallback shape
// the geocoder emits when reverse-geocode fails. The AI is
// propose-only and only worth offering when the existing label
// is unhelpful.
export function isUnnamedLocation(addressName: string): boolean {
  const trimmed = (addressName ?? '').trim();
  if (trimmed === '') return true;
  if (trimmed.toLowerCase() === 'unknown') return true;
  // Coordinate fallback: e.g. "47.6062,-122.3321" or
  // "47.6062, -122.3321". Two signed decimals separated by a comma
  // (with optional whitespace) and nothing else.
  if (/^-?\d+(?:\.\d+)?\s*,\s*-?\d+(?:\.\d+)?$/.test(trimmed)) return true;
  return false;
}

// truncateLabel keeps chart Y-axis labels legible by clipping long
// addresses to a fixed width with an ellipsis.
export function truncateLabel(name: string, max = 22): string {
  const value = name ?? '';
  return value.length > max + 3 ? `${value.slice(0, max)}…` : value;
}

// rankChipClass tones the leaderboard rank badge by position: gold for
// #1, cyan for the podium, muted for the rest. Toned 300-level accents
// paired with a matching tint + border — never neon body text.
export function rankChipClass(index: number): string {
  if (index === 0) return 'border-amber-400/30 bg-amber-500/15 text-amber-300';
  if (index < 3) return 'border-cyan-400/20 bg-cyan-500/10 text-cyan-300';
  return 'border-[var(--glass-border)] bg-[var(--surface-2)] text-[var(--text-muted)]';
}

// ─── Page ────────────────────────────────────────────────────────────────────

export default function LocationsPage() {
  const { t } = useTranslation();
  usePageTitle(t('locations.title', 'Visited Locations'));
  const { formatDuration } = useUnits();

  const { vehicleId } = useSelectedVehicle();
  const [page, setPage] = useUrlNumber('page', 1);
  const pageSize = 50;
  const [search, setSearch] = useUrlString('q', '');
  const [previewLocation, setPreviewLocation] = useState<VisitedLocation | null>(null);
  // AI applied-name pending hand-off — when the user clicks Apply on
  // an AI proposal, the proposed name is parked here keyed by
  // location.id. The user then writes it into the canonical
  // baseline geofence-create / location-rename UI; the AI panel
  // never persists.
  const [appliedName, setAppliedName] = useState<{ id: number; name: string } | null>(null);
  const { start, end, setRange, reset: resetRange } = useRangeState({
    persistKey: 'locations.range',
    defaultPresetId: 'all',
  });

  const locationsQuery = useQuery({
    queryKey: ['visited-locations', vehicleId, page, pageSize],
    queryFn: () => request<VisitedLocation[]>(`/locations?vehicle_id=${vehicleId}&limit=${pageSize}&offset=${(page - 1) * pageSize}`),
    enabled: vehicleId !== null,
  });
  const { data: rawLocations, isLoading, isError, error, refetch } = locationsQuery;

  // Client-side filter by `last_visited` within the picked range. Backend
  // /locations does not yet accept from/to so visit_count and
  // total_duration_s remain LIFETIME aggregates — we only narrow which
  // places are listed (those last visited in the window).
  const locations = useMemo(() => {
    if (!rawLocations?.length) return rawLocations;
    const startMs = new Date(`${start}T00:00:00`).getTime();
    const endMs = new Date(`${end}T23:59:59.999`).getTime();
    return rawLocations.filter((l) => {
      if (!l.last_visited) return false;
      const ts = new Date(l.last_visited).getTime();
      return ts >= startMs && ts <= endMs;
    });
  }, [rawLocations, start, end]);

  const locationSearchFields = useMemo(
    () => ['address_name'] as const satisfies ReadonlyArray<keyof VisitedLocation>,
    [],
  );
  const filteredLocations = useFilteredList(locations, search, locationSearchFields);

  const totalVisits = locations?.reduce((s, l) => s + (l.visit_count ?? 0), 0) ?? 0;
  const totalTime = locations?.reduce((s, l) => s + (l.total_duration_s ?? 0), 0) ?? 0;
  const uniquePlaces = locations?.length ?? 0;
  const topLocation = locations?.[0];
  const avgDurationS = totalVisits > 0 ? totalTime / totalVisits : 0;

  const uniqueCities = useMemo(() => {
    if (!locations?.length) return 0;
    const cities = new Set<string>();
    for (const loc of locations) {
      // Skip unnamed / "Unknown" / coordinate-fallback rows — a raw lat,long
      // pair is not a city and would otherwise inflate the unique-city count.
      if (isUnnamedLocation(loc.address_name)) continue;
      const parts = (loc.address_name ?? '').split(',').map((s) => s.trim());
      const city = parts.length > 1 ? parts[parts.length - 1] : parts[0];
      if (city && city !== 'Unknown') {
        cities.add(city);
      }
    }
    return cities.size;
  }, [locations]);

  const visitsChartData = useMemo<LeaderboardDatum[]>(
    () =>
      (locations ?? []).slice(0, 15).map((l) => ({
        name: truncateLabel(l.address_name ?? ''),
        value: l.visit_count ?? 0,
      })),
    [locations],
  );

  // "Top Locations by Time Spent" must rank by time, not inherit the backend's
  // visit-count ordering — otherwise the chart plotted the most-VISITED places'
  // durations, contradicting its own title. Sort a copy so `locations` (which
  // the KPIs and detail-list ranks depend on) is never mutated.
  const timeChartData = useMemo<LeaderboardDatum[]>(
    () =>
      [...(locations ?? [])]
        .sort((a, b) => (b.total_duration_s ?? 0) - (a.total_duration_s ?? 0))
        .slice(0, 10)
        .map((l) => ({
          name: truncateLabel(l.address_name ?? ''),
          value: +fmtNumber((l.total_duration_s ?? 0) / 3600, 1),
        })),
    [locations],
  );

  const shownCount = locations?.length ?? 0;
  const hasLocations = shownCount > 0;

  const actions = (
    <div className="flex flex-wrap items-center justify-start gap-2 sm:justify-end">
      <VehicleSelect
        ariaLabel={t('locations.selectVehicle', 'Select vehicle')}
      />
      <RangePicker
        value={{ start, end }}
        onChange={(r) => {
          setRange(r);
          setPage(1);
        }}
        align="end"
        triggerTestId="locations-range"
      />
    </div>
  );

  return (
    <PageContainer
      title={t('locations.title', 'Visited Locations')}
      subtitle={t('locations.subtitle', "Places you've been — ranked by frequency")}
      actions={actions}
      query={locationsQuery}
    >
      {/* ── 1. KPI band ───────────────────────────────────────────── */}
      <FadeIn>
        <section
          aria-label={t('locations.kpis', 'Location summary')}
          className="grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-3 xl:grid-cols-6"
        >
          {isLoading ? (
            Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-20 rounded-xl" />
            ))
          ) : isError ? (
            <div className="col-span-full">
              <QueryError error={error} onRetry={() => refetch()} />
            </div>
          ) : (
            <>
              <MetricCard label={t('locations.uniquePlaces', 'Unique Places')} value={uniquePlaces} icon={<Navigation className="h-4 w-4" />} color="green" />
              <MetricCard label={t('locations.uniqueCities', 'Unique Cities')} value={uniqueCities} icon={<Building2 className="h-4 w-4" />} color="blue" />
              <MetricCard label={t('locations.totalVisits', 'Total Visits')} value={totalVisits} icon={<Hash className="h-4 w-4" />} color="cyan" />
              <MetricCard label={t('locations.totalTime', 'Total Time')} value={formatDuration(totalTime)} icon={<Clock className="h-4 w-4" />} color="purple" />
              <MetricCard label={t('locations.mostVisited', 'Most Visited')} value={topLocation?.address_name ?? '—'} icon={<Trophy className="h-4 w-4" />} color="amber" />
              <MetricCard label={t('locations.avgVisit', 'Avg Visit')} value={formatDuration(avgDurationS)} icon={<Clock className="h-4 w-4" />} color="cyan" />
            </>
          )}
        </section>
      </FadeIn>

      {/* ── 2. Charts bento — leaderboards side-by-side on wide screens ─ */}
      <FadeIn delay={0.1}>
        <section
          aria-label={t('locations.leaderboards', 'Top locations')}
          className="grid grid-cols-1 gap-4 xl:grid-cols-2"
        >
          <LocationLeaderboardPanel
            title={t('locations.byVisits', 'Top Locations by Visits')}
            icon={<Hash className="h-4 w-4 text-cyan-300" aria-hidden="true" />}
            seriesLabel={t('locations.visits', 'Visits')}
            color="#10b981"
            data={visitsChartData}
            loading={isLoading}
            error={error}
            onRetry={() => refetch()}
            emptyMessage={t('locations.noVisitData', 'No visited location data')}
            emptyActionLabel={t('locations.resetDateRange', 'Reset date range')}
            onResetFilters={resetRange}
            ariaLabel={t('locations.byVisits.aria', 'Bar chart of the most-visited locations')}
          />
          <LocationLeaderboardPanel
            title={t('locations.byTime', 'Top Locations by Time Spent (hours)')}
            icon={<Clock className="h-4 w-4 text-cyan-300" aria-hidden="true" />}
            seriesLabel={t('locations.hours', 'Hours')}
            color="#a855f7"
            data={timeChartData}
            loading={isLoading}
            error={error}
            onRetry={() => refetch()}
            emptyMessage={t('locations.noTimeData', 'No time-spent data available')}
            emptyActionLabel={t('locations.resetDateRange', 'Reset date range')}
            onResetFilters={resetRange}
            ariaLabel={t('locations.byTime.aria', 'Bar chart of locations by hours spent')}
          />
        </section>
      </FadeIn>

      {/* ── 3. Detail band — searchable, paginated leaderboard ──────── */}
      <FadeIn delay={0.2}>
        <GlassPanel className="p-4 sm:p-5">
          <PanelTitle className="mb-3 flex items-center gap-2">
            <MapPin className="h-4 w-4 text-cyan-300" aria-hidden="true" />
            {t('locations.all', 'All Locations')}
          </PanelTitle>

          <FilterBar className="mb-3">
            <SearchInput
              value={search}
              onChange={setSearch}
              placeholder={t('locations.searchPlaceholder', 'Search by address…')}
              className="w-full sm:w-72"
              historyScope="locations"
            />
          </FilterBar>
          <ActiveFilterChips
            className="mb-3"
            filters={
              (search
                ? [
                    {
                      key: 'q',
                      label: t('locations.filterLabel.search', 'Search'),
                      value: search,
                      onRemove: () => setSearch(''),
                    } satisfies FilterChipDescriptor,
                  ]
                : []) as readonly FilterChipDescriptor[]
            }
            onClearAll={() => setSearch('')}
          />

          {isLoading ? (
            <div className="grid grid-cols-1 gap-3 2xl:grid-cols-2">
              {[1, 2, 3, 4, 5, 6].map((i) => (
                <Skeleton key={i} className="h-16 rounded-xl" />
              ))}
            </div>
          ) : isError ? (
            <QueryError error={error} onRetry={() => refetch()} />
          ) : !hasLocations ? (
            <EmptyState
              icon={<MapPin className="h-12 w-12" />}
              title={t('locations.empty.title', 'No locations')}
              message={t('locations.empty.message', 'No visited locations recorded yet')}
              actionTo={{ label: t('locations.empty.cta', 'View drives'), to: '/drives' }}
            />
          ) : !filteredLocations.length ? (
            <EmptyState
              icon={<MapPin className="h-12 w-12" />}
              title={t('locations.empty.title', 'No locations')}
              message={t('locations.noMatch', 'No locations match your search')}
              action={{ label: t('locations.clearSearch', 'Clear search'), onClick: () => setSearch('') }}
            />
          ) : (
            <div className="space-y-4">
              <ul className="grid list-none grid-cols-1 gap-3 2xl:grid-cols-2">
                {filteredLocations.map((loc, i) => {
                  const visits = loc.visit_count ?? 0;
                  const totalDuration = loc.total_duration_s ?? 0;
                  const avg = visits > 0 ? totalDuration / visits : 0;
                  return (
                    <li key={loc.id} className="space-y-2">
                      <GlassPanel className="flex items-center gap-3 p-3 transition-colors hover:border-[var(--border-subtle)] sm:p-4">
                        <Text
                          as="div"
                          size="xs"
                          weight="bold"
                          className={cn(
                            'flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border',
                            rankChipClass(i),
                          )}
                        >
                          #{i + 1}
                        </Text>
                        <div className="min-w-0 flex-1">
                          <Text as="p" size="sm" weight="medium" color="primary" className="truncate">
                            {loc.address_name ?? '—'}
                          </Text>
                          <Text as="p" variant="caption" className="mt-0.5">
                            {visits} {t('locations.visits', 'visits')} · {formatDuration(totalDuration)} {t('locations.total', 'total')} · ~{formatDuration(avg)} {t('locations.avg', 'avg')}
                            {loc.last_visited ? ` · ${t('locations.last', 'Last')}: ${formatDate(loc.last_visited)}` : ''}
                          </Text>
                          {appliedName?.id === loc.id && (
                            <Text as="span" size="xs" className="mt-1 inline-block text-emerald-300">
                              {t('locations.aiAutoName.applied', 'Suggested name ready to save:')}{' '}
                              <Text as="span" color="primary">{appliedName.name}</Text>
                            </Text>
                          )}
                        </div>
                        <Text
                          as="div"
                          size="xs"
                          weight="medium"
                          className="flex shrink-0 items-center gap-1 rounded-lg border border-cyan-400/20 bg-cyan-500/10 px-2 py-1 text-cyan-300"
                        >
                          <Hash className="h-3 w-3" aria-hidden="true" />
                          {visits}
                        </Text>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="h-9 w-9 shrink-0 p-0"
                          aria-label={t(
                            'locations.inspect',
                            'Inspect {{location}}',
                            { location: loc.address_name || t('locations.unknown', 'unknown location') },
                          )}
                          onClick={() => setPreviewLocation(loc)}
                        >
                          <Eye className="h-4 w-4" aria-hidden="true" />
                        </Button>
                      </GlassPanel>
                      {isUnnamedLocation(loc.address_name) && (
                        <AIAutoNameUnnamedLocations
                          locationId={loc.id}
                          currentName={loc.address_name}
                          onApplyName={(name) => setAppliedName({ id: loc.id, name })}
                        />
                      )}
                    </li>
                  );
                })}
              </ul>
              <Pagination
                page={page}
                pageSize={pageSize}
                total={shownCount < pageSize ? (page - 1) * pageSize + shownCount : page * pageSize + 1}
                onPageChange={setPage}
              />
            </div>
          )}
        </GlassPanel>
      </FadeIn>

      <EntityPreviewDrawer
        open={previewLocation !== null}
        onClose={() => setPreviewLocation(null)}
        eyebrow={t('locations.preview.eyebrow', 'Location evidence')}
        title={previewLocation?.address_name || t('locations.unknown', 'Unknown location')}
        description={
          previewLocation?.last_visited
            ? t('locations.preview.lastVisited', 'Last visited {{date}}', {
                date: formatDate(previewLocation.last_visited),
              })
            : undefined
        }
        fields={
          previewLocation
            ? [
                {
                  key: 'visits',
                  label: t('locations.totalVisits', 'Total Visits'),
                  value: previewLocation.visit_count ?? 0,
                },
                {
                  key: 'time',
                  label: t('locations.totalTime', 'Total Time'),
                  value: formatDuration(previewLocation.total_duration_s ?? 0),
                },
                {
                  key: 'average',
                  label: t('locations.avgVisit', 'Avg Visit'),
                  value: formatDuration(
                    previewLocation.visit_count > 0
                      ? previewLocation.total_duration_s / previewLocation.visit_count
                      : 0,
                  ),
                },
                {
                  key: 'last-visited',
                  label: t('locations.lastVisited', 'Last visited'),
                  value: previewLocation.last_visited
                    ? formatDate(previewLocation.last_visited)
                    : '—',
                },
              ]
            : []
        }
        relatedActions={
          previewLocation && vehicleId != null
            ? [
                {
                  key: 'vehicle',
                  label: t('entityContext.vehicle', 'Vehicle'),
                  to: `/vehicles/${vehicleId}`,
                  icon: <Car className="h-4 w-4" aria-hidden="true" />,
                },
                {
                  key: 'drives',
                  label: t('entityContext.drives', 'Drive history'),
                  to: buildContextHref('/drives', {
                    q: previewLocation.address_name,
                    from: start,
                    to: end,
                  }),
                  icon: <Route className="h-4 w-4" aria-hidden="true" />,
                },
                {
                  key: 'charging',
                  label: t('entityContext.charging', 'Charging sessions'),
                  to: buildContextHref('/charging', {
                    q: previewLocation.address_name,
                    from: start,
                    to: end,
                  }),
                  icon: <BatteryCharging className="h-4 w-4" aria-hidden="true" />,
                },
                {
                  key: 'alerts',
                  label: t('entityContext.alerts', 'Alerts'),
                  to: buildContextHref('/notifications/alerts', { from: start, to: end }),
                  icon: <Bell className="h-4 w-4" aria-hidden="true" />,
                },
                {
                  key: 'service',
                  label: t('entityContext.service', 'Service history'),
                  to: '/maintenance',
                  icon: <Wrench className="h-4 w-4" aria-hidden="true" />,
                },
                {
                  key: 'telemetry',
                  label: t('entityContext.telemetry', 'Telemetry evidence'),
                  to: buildContextHref('/signals', { from: start, to: end }),
                  icon: <Activity className="h-4 w-4" aria-hidden="true" />,
                },
              ]
            : []
        }
      />
    </PageContainer>
  );
}
