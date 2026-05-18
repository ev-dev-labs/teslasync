/**
 * LocationsPage — visited locations ranked by frequency.
 *
 * Shows stats, bar charts (visits + time), and paginated location list.
 */

import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { MapPin, Clock, Hash, Trophy, Navigation, Building2 } from 'lucide-react';

import { PageContainer } from '@/components/layout';
import { GlassPanel, Select, Pagination } from '@/components/ui';
import { MetricCard, DataFreshnessAuto } from '@/components/data-display';
import { Skeleton, EmptyState } from '@/components/feedback';
import { FadeIn } from '@/components/motion';
import { SearchInput, FilterBar, ActiveFilterChips, RangePicker, type FilterChipDescriptor } from '@/components/forms';
import { useFilteredList } from '@/hooks/useFilteredList';
import { useRangeState } from '@/hooks/useRangeState';
import { useUrlNumber, useUrlString } from '@/hooks/useUrlState';
import { useSelectedVehicle } from '@/hooks/useSelectedVehicle';
import {
  ChartTooltip,
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from '@/components/charts';

import { usePageTitle } from '@/hooks/usePageTitle';
import { useUnits } from '@/hooks/useUnits';
import { formatDate } from '@/lib/dateFormat';
import { fmtNumber } from '@/lib/numberFormat';
import { cn } from '@/lib/cn';
import { request } from '@/api/client';
import { AIAutoNameUnnamedLocations } from '@/components/ai/AIAutoNameUnnamedLocations';

// ─── Types ───────────────────────────────────────────────────────────────────

interface VisitedLocation {
  id: number;
  address_name: string;
  visit_count: number;
  total_duration_s: number;
  last_visited: string | null;
}

// isUnnamedLocation reports whether a visited-location row should
// surface the AI auto-name affordance. Three buckets count as
// "unnamed": empty/whitespace, the literal "Unknown" sentinel the
// reverse-geocoder emits, and the coordinate-pair fallback shape
// the geocoder emits when reverse-geocode fails. Documented in the
// slice prompt — the AI is propose-only and only worth offering
// when the existing label is unhelpful.
function isUnnamedLocation(addressName: string): boolean {
  const trimmed = (addressName ?? '').trim();
  if (trimmed === '') return true;
  if (trimmed.toLowerCase() === 'unknown') return true;
  // Coordinate fallback: e.g. "47.6062,-122.3321" or
  // "47.6062, -122.3321". Two signed decimals separated by a comma
  // (with optional whitespace) and nothing else.
  if (/^-?\d+(?:\.\d+)?\s*,\s*-?\d+(?:\.\d+)?$/.test(trimmed)) return true;
  return false;
}

// ─── Page ────────────────────────────────────────────────────────────────────

export default function LocationsPage() {
  const { t } = useTranslation();
  usePageTitle(t('Locations'));
  const { formatDuration } = useUnits();

  const [, setUrlVehicleId] = useUrlNumber('vehicle_id', 0);
  const { vehicleId, vehicles, setVehicleId } = useSelectedVehicle();
  const onPickVehicle = (id: number) => {
    setVehicleId(id);
    setUrlVehicleId(id);
  };
  const [page, setPage] = useUrlNumber('page', 1);
  const pageSize = 50;
  const [search, setSearch] = useUrlString('q', '');
  // AI applied-name pending hand-off — when the user clicks Apply on
  // an AI proposal, the proposed name is parked here keyed by
  // location.id. The user then writes it into the canonical
  // baseline geofence-create / location-rename UI; the AI panel
  // never persists. (ADR-015 §I3 + §I8 propose-only contract.)
  const [appliedName, setAppliedName] = useState<{ id: number; name: string } | null>(null);
  const { start, end, setRange } = useRangeState({
    persistKey: 'locations.range',
    defaultPresetId: 'all',
  });

  const locationsQuery = useQuery({
    queryKey: ['visited-locations', vehicleId, page, pageSize],
    queryFn: () => request<VisitedLocation[]>(`/locations?vehicle_id=${vehicleId}&limit=${pageSize}&offset=${(page - 1) * pageSize}`),
    enabled: vehicleId !== null,
  });
  const { data: rawLocations, isLoading, error } = locationsQuery;

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
      const t = new Date(l.last_visited).getTime();
      return t >= startMs && t <= endMs;
    });
  }, [rawLocations, start, end]);

  const locationSearchFields = useMemo(
    () => ['address_name'] as const satisfies ReadonlyArray<keyof VisitedLocation>,
    [],
  );
  const filteredLocations = useFilteredList(locations, search, locationSearchFields);

  const totalVisits = locations?.reduce((s, l) => s + l.visit_count, 0) ?? 0;
  const totalTime = locations?.reduce((s, l) => s + l.total_duration_s, 0) ?? 0;
  const uniquePlaces = locations?.length ?? 0;
  const topLocation = locations?.[0];
  const avgDurationS = totalVisits > 0 ? totalTime / totalVisits : 0;

  const uniqueCities = useMemo(() => {
    if (!locations?.length) return 0;
    const cities = new Set<string>();
    for (const loc of locations) {
      const parts = (loc.address_name ?? '').split(',').map(s => s.trim());
      const city = parts.length > 1 ? parts[parts.length - 1] : parts[0];
      if (city && city !== 'Unknown') {
        cities.add(city);
      }
    }
    return cities.size;
  }, [locations]);

  const visitsChartData= useMemo(() =>
    (locations ?? []).slice(0, 15).map(l => ({
      name: (l.address_name ?? '').length > 25 ? (l.address_name ?? '').slice(0, 22) + '…' : (l.address_name ?? ''),
      visits: l.visit_count,
    })),
  [locations]);

  const timeChartData = useMemo(() =>
    (locations ?? []).slice(0, 10).map(l => ({
      name: (l.address_name ?? '').length > 25 ? (l.address_name ?? '').slice(0, 22) + '…' : (l.address_name ?? ''),
      hours: +(fmtNumber(l.total_duration_s / 3600, 1)),
    })),
  [locations]);

  return (
    <PageContainer
      title={t('Visited Locations')}
      subtitle={t('Places you\'ve been — ranked by frequency')}
      loading={isLoading}
      error={error as Error | null}
      actions={
        <div className="flex flex-wrap items-center justify-end gap-3">
          {vehicles.length > 0 && (
            <Select
              value={String(vehicleId ?? '')}
              onChange={e => onPickVehicle(Number(e.target.value))}
              options={vehicles.map(v => ({ value: String(v.id), label: v.display_name || v.vin }))}
            />
          )}
          <RangePicker
            value={{ start, end }}
            onChange={(r) => {
              setRange(r);
              setPage(1);
            }}
            align="end"
            triggerTestId="locations-range"
          />
          <DataFreshnessAuto query={locationsQuery} />
        </div>
      }
    >
      {/* ── Summary stats ────────────────────────────────────────── */}
      <FadeIn>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-3 sm:gap-4">
          <MetricCard label={t('Unique Places')} value={uniquePlaces} icon={<Navigation className="h-4 w-4" />} color="green" />
          <MetricCard label={t('Unique Cities')} value={uniqueCities} icon={<Building2 className="h-4 w-4" />} color="blue" />
          <MetricCard label={t('Total Visits')} value={totalVisits} icon={<Hash className="h-4 w-4" />} color="cyan" />
          <MetricCard label={t('Total Time')} value={formatDuration(totalTime)} icon={<Clock className="h-4 w-4" />} color="purple" />
          <MetricCard label={t('Most Visited')} value={topLocation?.address_name ?? '—'} icon={<Trophy className="h-4 w-4" />} color="amber" />
          <MetricCard label={t('Avg Visit')} value={formatDuration(avgDurationS)} icon={<Clock className="h-4 w-4" />} color="cyan" />
        </div>
      </FadeIn>

      {/* ── Top Locations by Visits ───────────────────────────────── */}
      <FadeIn>
        <GlassPanel className="p-4 sm:p-6">
          <span className="text-sm font-semibold mb-4 block text-[var(--text-primary)]">{t('Top Locations by Visits')}</span>
          {isLoading ? <Skeleton className="h-[300px]" /> : visitsChartData.length === 0 ? (
            <div className="flex items-center justify-center h-[300px] text-[var(--text-muted)] text-sm">{t('No visited location data')}</div>
          ) : (
            <ResponsiveContainer width="100%" height={Math.max(300, visitsChartData.length * 36)}>
              <BarChart data={visitsChartData} layout="vertical" margin={{ left: 120 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--glass-border)" strokeOpacity={0.5} />
                <XAxis type="number" tick={{ fontSize: 10, fill: 'var(--text-muted)' }} />
                <YAxis dataKey="name" type="category" tick={{ fontSize: 10, fill: '#9ca3af' }} width={110} />
                <Tooltip content={<ChartTooltip />} />
                <Bar dataKey="visits" name={t('Visits')} fill="#10b981" radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </GlassPanel>
      </FadeIn>

      {/* ── Top Locations by Time ────────────────────────────────── */}
      <FadeIn>
        <GlassPanel className="p-4 sm:p-6">
          <span className="text-sm font-semibold mb-4 block text-[var(--text-primary)]">{t('Top Locations by Time Spent (hours)')}</span>
          {isLoading ? <Skeleton className="h-[280px]" /> : timeChartData.length === 0 ? (
            <div className="flex items-center justify-center h-[280px] text-[var(--text-muted)] text-sm">{t('No time-spent data available')}</div>
          ) : (
            <ResponsiveContainer width="100%" height={Math.max(280, timeChartData.length * 36)}>
              <BarChart data={timeChartData} layout="vertical" margin={{ left: 120 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--glass-border)" strokeOpacity={0.5} />
                <XAxis type="number" tick={{ fontSize: 10, fill: 'var(--text-muted)' }} />
                <YAxis dataKey="name" type="category" tick={{ fontSize: 10, fill: '#9ca3af' }} width={110} />
                <Tooltip content={<ChartTooltip />} />
                <Bar dataKey="hours" name={t('Hours')} fill="#a855f7" radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </GlassPanel>
      </FadeIn>

      {/* ── All Locations list ───────────────────────────────────── */}
      <FadeIn>
        <GlassPanel className="p-4 sm:p-6">
          <span className="text-sm font-semibold mb-4 block text-[var(--text-primary)]">{t('All Locations')}</span>
          <FilterBar className="mb-3">
            <SearchInput
              value={search}
              onChange={setSearch}
              placeholder={t('Search by address…')}
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
            <div className="space-y-3">{[1, 2, 3, 4, 5].map(i => <Skeleton key={i} className="h-16 rounded-xl" />)}</div>
          ) : !locations?.length ? (
            <EmptyState
              icon={<MapPin className="h-12 w-12" />}
              title={t('No locations')}
              message={t('No visited locations recorded yet')}
              actionTo={{ label: t('locations.empty.cta', 'View drives'), to: '/drives' }}
            />
          ) : !filteredLocations.length ? (
            <EmptyState
              icon={<MapPin className="h-12 w-12" />}
              title={t('No locations')}
              message={t('No locations match your search')}
              action={{ label: t('Clear search'), onClick: () => setSearch('') }}
            />
          ) : (
            <>
              <div className="space-y-2">
                {filteredLocations.map((loc, i) => (
                  <div key={loc.id} className="space-y-2">
                    <GlassPanel className="p-4 flex items-center gap-4 hover:border-[var(--border-subtle)] transition-colors">
                      <div className={cn(
                        'h-8 w-8 rounded-lg flex items-center justify-center text-xs font-bold shrink-0',
                        i === 0 ? 'bg-neon-amber/20 text-neon-amber' : i < 3 ? 'bg-neon-cyan/10 text-neon-cyan' : 'bg-[var(--surface-2)] text-[var(--text-muted)]',
                      )}>
                        #{i + 1}
                      </div>
                      <div className="flex-1 min-w-0">
                        <span className="text-sm font-medium truncate block text-[var(--text-primary)]">{loc.address_name}</span>
                        <span className="text-[11px] text-[var(--text-muted)]">
                          {loc.visit_count} {t('visits')} · {formatDuration(loc.total_duration_s)} {t('total')} · ~{formatDuration(loc.visit_count > 0 ? loc.total_duration_s / loc.visit_count : 0)} {t('avg')}
                          {loc.last_visited && ` · ${t('Last')}: ${formatDate(loc.last_visited)}`}
                        </span>
                        {appliedName?.id === loc.id && (
                          <span className="mt-1 inline-block text-[11px] text-emerald-300">
                            {t('locations.aiAutoName.applied', 'Suggested name ready to save:')}{' '}
                            <span className="text-[var(--text-primary)]">{appliedName.name}</span>
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-1 text-emerald-300 text-xs font-medium shrink-0">
                        <Hash className="h-3 w-3" />{loc.visit_count}
                      </div>
                    </GlassPanel>
                    {isUnnamedLocation(loc.address_name) && (
                      <AIAutoNameUnnamedLocations
                        locationId={loc.id}
                        currentName={loc.address_name}
                        onApplyName={(name) => setAppliedName({ id: loc.id, name })}
                      />
                    )}
                  </div>
                ))}
              </div>
              <Pagination
                page={page}
                pageSize={pageSize}
                total={locations.length < pageSize ? (page - 1) * pageSize + locations.length : page * pageSize + 1}
                onPageChange={setPage}
              />
            </>
          )}
        </GlassPanel>
      </FadeIn>
    </PageContainer>
  );
}
