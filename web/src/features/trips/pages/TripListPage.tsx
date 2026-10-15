import { useEffect, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Route, Zap,
  Calendar, Clock, Download,
} from 'lucide-react';
import { PageLayout, ChartCard, LayoutCard, CardGrid } from '@/components/layout';
import { deriveDataState } from '@/api/dataState';
import {
  GlassPanel, PanelTitle, Pagination, Caption, Badge, Button, Text, MetricLabel, Icon,
} from '@/components/ui';
import {
  MetricBar, InlineMetric, SavedViewMenu, DataFreshnessAuto,
} from '@/components/data-display';
import {
  ChartTooltip,
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  axisTick, chartGrid, chartAnimationProps, CHART_COLORS,
} from '@/components/charts';

import { EmptyState, QueryError, Skeleton } from '@/components/feedback';
import { FadeIn } from '@/components/motion';
import { PullToRefresh } from '@/components/mobile';
import { useTrips } from '@/api/hooks/useTrips';
import { useSelectedVehicle } from '@/hooks/useSelectedVehicle';
import { useUnits } from '@/hooks/useUnits';
import { useFormatting } from '@/hooks/useFormatting';
import { usePageTitle } from '@/hooks/usePageTitle';
import { useSavedViewUrl } from '@/hooks/useSavedViewUrl';
import { useUrlBatch, useUrlNumber } from '@/hooks/useUrlState';
import { useRangeState } from '@/hooks/useRangeState';
import { convertDistanceFromSI } from '@/lib/unitConversion';
import { formatDate } from '@/lib/dateFormat';

import { exportAsCSV, exportAsJSON } from '@/lib/export';
import type { Trip } from '@/api/types';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';
import { useOperationalMetrics } from '@/hooks/useOperationalMetrics';
import type { StatMetric } from '@/components/data-display/stat-reference/types';
import type { DataState } from '@/api/dataState';
import { TripOperationalBrief } from '../components/operationalbrief-all/TripOperationalBrief';

/* ─── Constants & helpers ─────────────────────────────────── */

// Wh/km -> Wh/(display unit) conversion uses an inline factor because
// @/lib/unitConversion does not yet expose a convertEfficiencyFromSI helper.
// Same precedent as FleetComparePage.whPerKmToDisplay.
const KM_PER_MILE = 1.609344;

const DISTANCE_COLOR = CHART_COLORS[0];
const ENERGY_COLOR = CHART_COLORS[1];
const ENERGY_ROWS = 6;

function sumTripValues(trips: Trip[], field: 'total_distance_m' | 'total_energy_wh' | 'total_cost' | 'drive_count' | 'charge_count'): number | null {
  const values = trips.map(trip => trip[field]);
  return values.every(value => typeof value === 'number' && Number.isFinite(value))
    ? values.reduce((total, value) => total + value, 0)
    : null;
}

function formatDuration(
  startDate: string,
  endDate: string | null,
  inProgressLabel: string,
): string {
  if (!endDate) return inProgressLabel;
  const ms = new Date(endDate).getTime() - new Date(startDate).getTime();
  if (!Number.isFinite(ms) || ms <= 0) return '—';
  // Round to whole minutes FIRST, then split into h/m. Rounding the leftover
  // minutes independently (the old approach) could round a 59.7 remainder up
  // to 60 and render "1h 60m"; carrying the round through the total makes it
  // roll into the hour ("2h") instead.
  const totalMinutes = Math.round(ms / 60000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours === 0) return `${minutes}m`;
  return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
}

interface SectionStateProps {
  trips: Trip[];
  isLoading: boolean;
  isError: boolean;
  error: unknown;
  onRetry: () => void;
}

/* ─── Page ────────────────────────────────────────────────── */

export default function TripListPage() {
  const { t } = useTranslation();
  usePageTitle(t('trips.title', 'Trips'));
  const savedView = useSavedViewUrl();

  const { vehicleId } = useSelectedVehicle();

  const [requestedPage, setPage] = useUrlNumber('page', 1);
  const [requestedSize] = useUrlNumber('size', 50);
  const pageSize = Number.isSafeInteger(requestedSize) && requestedSize > 0 && requestedSize <= 1000 ? requestedSize : 50;
  const page = Number.isSafeInteger(requestedPage) && requestedPage > 0 &&
    Number.isSafeInteger((requestedPage - 1) * pageSize) ? requestedPage : 1;
  const {
    start: startDate, end: endDate, startInstant, endInstantExclusive, presetId, timezone,
  } = useRangeState();
  const setUrlBatch = useUrlBatch();
  // A rolling clock refetch is not a workspace selection change.
  const rollingRange = presetId === '24h' || presetId === 'live';
  const scopeKey = JSON.stringify([vehicleId, rollingRange ? presetId : [startDate, endDate, presetId], timezone]);
  const previousScope = useRef(scopeKey);
  const restoringView = useRef(false);
  const requestPage = previousScope.current !== scopeKey && !restoringView.current ? 1 : page;
  useEffect(() => {
    if (previousScope.current !== scopeKey) {
      previousScope.current = scopeKey;
      if (!restoringView.current && page !== 1) setUrlBatch({ page: null });
    }
    restoringView.current = false;
  }, [scopeKey, page, setUrlBatch]);

  const tripsQuery = useTrips({
    vehicle_id: vehicleId ?? undefined,
    limit: pageSize,
    offset: (requestPage - 1) * pageSize,
    start: startInstant,
    end: endInstantExclusive,
  });
  const { data: trips, refetch } = tripsQuery;
  const source = deriveDataState(tripsQuery, { provenance: 'historical' });
  const isLoading = source.status === 'initial';
  const isError = source.fatalError !== null;
  const error = source.fatalError;

  const allTrips = trips ?? [];

  const onRetry = () => {
    void refetch();
  };

  const sectionState: SectionStateProps = { trips: allTrips, isLoading, isError, error, onRetry };

  return (
    <PageLayout
      title={t('trips.title', 'Trips')}
      subtitle={t('trips.subtitle', 'Multi-drive trip reports with distance and cost tracking')}
      busy={isLoading && !source.isRefreshBlocked}
      metadataActions={<DataFreshnessAuto query={tripsQuery} />}
      dataSources={[{ id: 'trips', label: t('trips.title', 'Trips'), query: tripsQuery }]}
      overflowActions={
        <div className="flex flex-wrap items-center justify-end gap-3">
          <SavedViewMenu
            route="/trips"
            currentQuery={savedView.currentQuery}
            onApply={query => {
              restoringView.current = true;
              savedView.apply(query);
            }}
          />
        </div>
      }
    >
      <PullToRefresh onRefresh={async () => { await refetch(); }}>
        {/* 1 — KPI band: full-width responsive metric grid */}
        <FadeIn>
          <section aria-label={t('trips.stats.aria', 'Trip summary metrics')}>
            <TripStatsBand trips={allTrips} source={source} startDate={startDate} endDate={endDate} vehicleId={vehicleId} />
          </section>
        </FadeIn>

        {/* 2 — Primary bento: hero distance chart + energy breakdown */}
        <FadeIn delay={0.1}>
          <section
            aria-label={t('trips.primary.aria', 'Trip distance and energy breakdown')}
            className="grid grid-cols-1 gap-4 xl:grid-cols-3"
          >
            <TopTripsChart className="xl:col-span-2" {...sectionState} />
            <TripEnergyPanel {...sectionState} />
          </section>
        </FadeIn>

        {/* 3 — Detail band: full-width responsive grid of trip cards */}
        <FadeIn delay={0.2}>
          <section aria-label={t('trips.list.aria', 'All trips')}>
            <div className="mb-3 flex min-w-0 flex-wrap items-center justify-between gap-3">
              <PanelTitle>{t('trips.list.heading', 'All Trips')}</PanelTitle>
              {allTrips.length > 0 && (
                <Caption>{t('trips.list.count', '{{count}} trips', { count: allTrips.length })}</Caption>
              )}
            </div>
            {isLoading ? (
              <CardGrid
                label={t('trips.list.aria', 'All trips')}
                items={[0, 1, 2, 3, 4, 5].map(i => ({
                  id: `loading-${i}`, size: 'third',
                  content: <LayoutCard title={t('trips.row.trip', 'Trip')} size="third">
                    <Skeleton className="h-40" />
                  </LayoutCard>,
                }))}
              />
            ) : isError ? (
              <GlassPanel className="p-4 sm:p-5">
                <QueryError error={error} onRetry={onRetry} resourceName={t('trips.title', 'Trips')} />
              </GlassPanel>
            ) : allTrips.length === 0 ? (
              <GlassPanel className="p-4 sm:p-5">
                <EmptyState
                  icon={<Icon icon={Route} size="xl" />}
                  message={t('trips.list.empty', 'No trips recorded yet')}
                  action={{ label: t('common.retry', 'Retry'), onClick: onRetry }}
                />
              </GlassPanel>
            ) : (
              <CardGrid
                label={t('trips.list.aria', 'All trips')}
                items={allTrips.map(trip => ({
                  id: String(trip.id), size: 'third', content: <TripCard trip={trip} />,
                }))}
              />
            )}
          </section>
        </FadeIn>

        {/* 4 — Pagination footer */}
        {(allTrips.length > 0 || page > 1) && (
          <FadeIn delay={0.3}>
            <Pagination
              page={page}
              pageSize={pageSize}
              total={allTrips.length}
              totalKind="loaded"
              // This enables probing the next window, not an exact-count claim.
              hasNextPage={!isLoading && !isError && allTrips.length >= pageSize}
              onPageChange={setPage}
              onPageSizeChange={(s) => {
                setUrlBatch({ size: String(s), page: null });
              }}
            />
          </FadeIn>
        )}
      </PullToRefresh>
    </PageLayout>
  );
}

/* ─── KPI band ────────────────────────────────────────────── */

/** Full-width KPI band. Aggregates are computed null-safe from SI fields and
 *  formatted at the display boundary via `useUnits` / `useFormatting`. */
function TripStatsBand({ trips, source, startDate, endDate, vehicleId }: {
  trips: Trip[]; source: DataState<Trip[]>; startDate: string; endDate: string; vehicleId: number | null;
}) {
  const { fmtInt } = useNumberFormatting();
  const { t } = useTranslation();
  const { unitPrefs, formatEnergy } = useUnits();
  const { formatCurrency } = useFormatting();
  const distancePref = unitPrefs.distance;

  const stats = useMemo(() => {
    const totalDistM = sumTripValues(trips, 'total_distance_m');
    const totalEnergyWh = sumTripValues(trips, 'total_energy_wh');
    const totalCost = sumTripValues(trips, 'total_cost');
    const totalDrives = sumTripValues(trips, 'drive_count');
    const totalCharges = sumTripValues(trips, 'charge_count');
    const tripCount = trips.length;
    const totalDistDisplay = totalDistM === null ? null : convertDistanceFromSI(totalDistM, distancePref);
    const avgDistDisplay = totalDistDisplay === null ? null : tripCount > 0 ? totalDistDisplay / tripCount : 0;
    return {
      totalEnergyWh, totalCost, totalDrives, totalCharges,
      tripCount, totalDistM, totalDistDisplay, avgDistDisplay,
    };
  }, [trips, distancePref]);

  const hasData = source.hasData;
  const scope = t('trips.brief.list.scope', 'Loaded page only · {{start}} – {{end}} · vehicle {{vehicle}}', {
    start: startDate, end: endDate, vehicle: vehicleId ?? t('trips.brief.allVehicles', 'All vehicles'),
  });
  const metrics: readonly StatMetric[] = [
    { metricId: 'distance', occurrenceId: 'distance', rawValue: hasData ? stats.totalDistM : null,
      label: t('trips.stats.distance', 'Total Distance'), description: scope,
      display: { formatter: raw => ({ value: fmtInt(convertDistanceFromSI(raw, distancePref)), unit: distancePref }) },
      context: hasData ? t('trips.stats.tripCount', '{{count}} trips', { count: stats.tripCount }) : undefined },
    { metricId: 'energy', occurrenceId: 'energy', rawValue: hasData ? stats.totalEnergyWh : null,
      label: t('trips.stats.energy', 'Energy Used'), description: scope,
      display: { formatter: raw => ({ value: formatEnergy(raw), unit: '' }) },
      context: hasData && stats.totalDrives !== null ? t('trips.stats.driveCount', '{{count}} drives', { count: stats.totalDrives }) : undefined },
    { metricId: 'currency', occurrenceId: 'cost', rawValue: hasData ? stats.totalCost : null,
      label: t('trips.stats.cost', 'Total Cost'), description: scope,
      display: { formatter: raw => ({ value: formatCurrency(raw), unit: '' }) },
      context: !hasData ? undefined : t('trips.stats.costPer', '{{cost}}/100{{unit}}', {
                cost: stats.totalDistDisplay !== null && stats.totalDistDisplay > 0 && stats.totalCost !== null
                  ? formatCurrency((stats.totalCost / stats.totalDistDisplay) * 100) : '—',
                unit: distancePref,
              }) },
    { metricId: 'count', occurrenceId: 'trips', rawValue: hasData ? stats.tripCount : null,
      label: t('trips.stats.total', 'Total Trips'), description: scope,
      display: { formatter: raw => ({ value: String(raw), unit: '' }) },
      context: hasData && stats.totalDrives !== null ? t('trips.stats.totalDrives', '{{count}} total drives', { count: stats.totalDrives }) : undefined },
    { metricId: 'distance', occurrenceId: 'average-distance',
      rawValue: hasData && stats.totalDistM !== null ? (stats.tripCount > 0 ? stats.totalDistM / stats.tripCount : 0) : null,
      label: t('trips.stats.avgPerTrip', 'Avg / Trip'), description: scope,
      display: { formatter: () => ({ value: fmtInt(stats.avgDistDisplay), unit: distancePref }) },
      context: t('trips.stats.avgPerTripSub', 'distance per trip') },
    { metricId: 'count', occurrenceId: 'charges', rawValue: hasData ? stats.totalCharges : null,
      label: t('trips.stats.charges', 'Total Charges'), description: scope,
      display: { formatter: raw => ({ value: String(raw), unit: '' }) },
      context: hasData && stats.totalCharges !== null ? t('trips.stats.chargeSessions', '{{count}} charge sessions', { count: stats.totalCharges }) : undefined },
  ];
  const operationalMetrics = useOperationalMetrics(metrics);
  return (
    <TripOperationalBrief source={source} metrics={operationalMetrics} scope={scope}
      eyebrow={t('trips.brief.list.eyebrow', 'Trip reports')}
      title={t('trips.brief.list.title', 'Loaded trip summary')}
      description={t('trips.brief.list.description', 'Distance, energy and recorded cost for the trips on this page; not fleet-wide or full-range totals.')}
      provenance={t('trips.brief.list.provenance', 'Stored trip records returned by the selected vehicle, date window and pagination.')} />
  );
}

/* ─── Hero chart ──────────────────────────────────────────── */

/** Hero panel: horizontal bar chart of the ten longest trips by distance, with
 *  CSV / JSON export of the full loaded set. Owns loading / empty / error. */
function TopTripsChart({ trips, isLoading, isError, error, onRetry, className }: SectionStateProps & { className?: string }) {
  const { t } = useTranslation();
  const { unitPrefs } = useUnits();
  const distancePref = unitPrefs.distance;

  const chartData = useMemo(
    () =>
      [...trips]
        .sort((a, b) => (b.total_distance_m ?? 0) - (a.total_distance_m ?? 0))
        .slice(0, 10)
        .map((trip) => ({
          name: trip.name ?? `${t('trips.row.trip', 'Trip')} ${trip.id}`,
          distance: Number.isFinite(trip.total_distance_m) ? convertDistanceFromSI(trip.total_distance_m, distancePref) : null,
        })),
    [trips, distancePref, t],
  );

  const handleExportCSV = () => {
    exportAsCSV(
      trips.map((trip) => ({
        id: trip.id,
        name: trip.name ?? `${t('trips.row.trip', 'Trip')} ${trip.id}`,
        start_date: trip.start_date,
        end_date: trip.end_date ?? '',
        distance_m: trip.total_distance_m ?? 0,
        energy_wh: trip.total_energy_wh ?? 0,
        cost: trip.total_cost ?? 0,
        drives: trip.drive_count ?? 0,
        charges: trip.charge_count ?? 0,
      })),
      'teslasync-trips-v2.csv',
    );
  };

  const handleExportJSON = () => {
    exportAsJSON(trips, 'teslasync-trips.json');
  };

  const canExport = trips.length > 0;

  return (
    <div className={className}>
    <ChartCard
      title={t('trips.chart.title', 'Top Trips by Distance')}
      ariaLabel={t('trips.chart.aria', 'Top trips ranked by distance horizontal bar chart')}
      data={chartData}
      dataColumns={[
        { key: 'name', label: t('trips.chart.col.trip', 'Trip') },
        { key: 'distance', label: `${t('trips.chart.distance', 'Distance')} (${distancePref})` },
      ]}
      height={280}
      size="standard"
      exportable
      loading={isLoading}
      empty={!isLoading && !isError && chartData.length === 0}
      action={
        <div className="flex min-w-0 flex-wrap gap-2">
          <Button wrapLabel variant="ghost" size="sm" className="min-h-11 min-w-11 md:min-h-9 md:min-w-9" onClick={handleExportCSV} disabled={!canExport}>
            <Icon icon={Download} size="sm" className="me-1" />
            {t('trips.export.csv', 'CSV')}
          </Button>
          <Button wrapLabel variant="ghost" size="sm" className="min-h-11 min-w-11 md:min-h-9 md:min-w-9" onClick={handleExportJSON} disabled={!canExport}>
            <Icon icon={Download} size="sm" className="me-1" />
            {t('trips.export.json', 'JSON')}
          </Button>
        </div>
      }
    >
      {isError ? (
        <div className="flex h-full items-center justify-center">
          <QueryError error={error} onRetry={onRetry} resourceName={t('trips.title', 'Trips')} />
        </div>
      ) : (
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={chartData} layout="vertical">
            {chartGrid}
            <XAxis type="number" tick={axisTick} />
            <YAxis dataKey="name" type="category" tick={axisTick} width={80} />
            <Tooltip content={<ChartTooltip />} />
            <Bar
              dataKey="distance"
              fill={DISTANCE_COLOR}
              name={`${t('trips.chart.distance', 'Distance')} (${distancePref})`}
              radius={[0, 4, 4, 0]}
              {...chartAnimationProps()}
            />
          </BarChart>
        </ResponsiveContainer>
      )}
    </ChartCard>
    </div>
  );
}

/* ─── Energy side panel ───────────────────────────────────── */

/** Bento side panel ranking the most energy-hungry trips as a MetricBar ladder.
 *  Shares the trips source with the hero chart; owns its own states. */
function TripEnergyPanel({ trips, isLoading, isError, error, onRetry }: SectionStateProps) {
  const { t } = useTranslation();
  const { formatEnergy } = useUnits();

  const rows = useMemo(() => {
    const ranked = [...trips]
      .filter((trip) => (trip.total_energy_wh ?? 0) > 0)
      .sort((a, b) => (b.total_energy_wh ?? 0) - (a.total_energy_wh ?? 0))
      .slice(0, ENERGY_ROWS);
    const max = ranked.reduce((m, trip) => Math.max(m, trip.total_energy_wh ?? 0), 0);
    return { ranked, max };
  }, [trips]);

  return (
    <LayoutCard title={t('trips.energy.title', 'Top Trips by Energy')}>
      {isLoading ? (
        <Skeleton height={220} />
      ) : isError ? (
        <QueryError error={error} onRetry={onRetry} resourceName={t('trips.title', 'Trips')} />
      ) : rows.ranked.length === 0 ? (
        <EmptyState
          icon={<Icon icon={Zap} size="xl" />}
          message={t('trips.energy.empty', 'No energy data to rank yet')}
          action={{ label: t('common.retry', 'Retry'), onClick: onRetry }}
        />
      ) : (
        <div className="space-y-3">
          {rows.ranked.map((trip) => (
            <MetricBar
              key={trip.id}
              label={trip.name ?? `${t('trips.row.trip', 'Trip')} #${trip.id}`}
              value={trip.total_energy_wh ?? 0}
              max={rows.max || (trip.total_energy_wh ?? 1)}
              color={ENERGY_COLOR}
              fill="solid"
              sublabel={formatEnergy(trip.total_energy_wh ?? 0)}
            />
          ))}
        </div>
      )}
    </LayoutCard>
  );
}

/* ─── Trip card ───────────────────────────────────────────── */

/** A single trip rendered as a bento grid cell — header, meta badges, and a
 *  distance / energy / cost stat footer. */
function TripCard({ trip }: { trip: Trip }) {
  const { fmtInt } = useNumberFormatting();
  const { t } = useTranslation();
  const { unitPrefs, formatEnergy } = useUnits();
  const { formatCurrency } = useFormatting();

  const distancePref = unitPrefs.distance;
  const distanceM = Number.isFinite(trip.total_distance_m) ? trip.total_distance_m : null;
  const energyWh = Number.isFinite(trip.total_energy_wh) ? trip.total_energy_wh : null;
  const cost = Number.isFinite(trip.total_cost) ? trip.total_cost : null;
  const driveCount = trip.drive_count ?? 0;
  const chargeCount = trip.charge_count ?? 0;

  const distanceDisplay = distanceM === null ? null : convertDistanceFromSI(distanceM, distancePref);
  const whPerKm = distanceM !== null && distanceM > 0 && energyWh !== null ? energyWh / (distanceM / 1000) : null;
  const efficiencyDisplay = whPerKm === null ? null : distancePref === 'mi' ? whPerKm * KM_PER_MILE : whPerKm;
  const efficiencyUnit = distancePref === 'mi' ? 'Wh/mi' : 'Wh/km';

  return (
    <LayoutCard
      title={trip.name ?? `${t('trips.row.trip', 'Trip')} #${trip.id}`}
      size="third"
      actions={
        <span
          aria-hidden="true"
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-shape-sm bg-[var(--surface-2)]"
        >
          <Icon icon={Route} size="lg" className="text-[var(--text-secondary)]" />
        </span>
      }
    >
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <InlineMetric icon={<Icon icon={Calendar} />} value={formatDate(trip.start_date)} />
            <InlineMetric
              icon={<Icon icon={Clock} />}
              value={formatDuration(
                trip.start_date,
                trip.end_date ?? null,
                t('trips.card.inProgress', 'In progress'),
              )}
            />
          </div>

      <div className="flex flex-wrap gap-2">
        <Badge variant="neutral" size="sm">
          {t('trips.card.drives', '{{count}} drives', { count: driveCount })}
        </Badge>
        {chargeCount > 0 && (
          <Badge variant="neutral" size="sm">
            {t('trips.card.charges', '{{count}} charges', { count: chargeCount })}
          </Badge>
        )}
      </div>

      <div className="mt-auto grid grid-cols-3 gap-2 border-t border-[var(--border-subtle)] pt-3">
        <div className="min-w-0">
          <MetricLabel>{t('trips.card.distance', 'Distance')}</MetricLabel>
          <Text as="p" variant="body" className="mt-0.5 break-words tabular-nums [overflow-wrap:anywhere]">
            {distanceDisplay === null ? '—' : fmtInt(distanceDisplay)} {distancePref}
          </Text>
        </div>
        <div className="min-w-0">
          <MetricLabel>{t('trips.card.energy', 'Energy')}</MetricLabel>
          <Text as="p" variant="body" className="mt-0.5 break-words tabular-nums [overflow-wrap:anywhere]">
            {formatEnergy(energyWh)}
          </Text>
          <Caption className="block break-words [overflow-wrap:anywhere]">
            {efficiencyDisplay !== null
              ? `${fmtInt(efficiencyDisplay)} ${efficiencyUnit}`
              : '—'}
          </Caption>
        </div>
        <div className="min-w-0">
          <MetricLabel>{t('trips.card.cost', 'Cost')}</MetricLabel>
          <Text as="p" variant="body" className="mt-0.5 break-words tabular-nums [overflow-wrap:anywhere]">
            {cost !== null ? formatCurrency(cost) : '—'}
          </Text>
        </div>
      </div>
    </LayoutCard>
  );
}
