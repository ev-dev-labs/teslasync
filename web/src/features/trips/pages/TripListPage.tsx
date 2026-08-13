import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Route, MapPin, Zap, DollarSign, Gauge, BatteryCharging,
  Calendar, Clock, Download,
} from 'lucide-react';
import { PageContainer } from '@/components/layout';
import {
  GlassPanel, PanelTitle, Pagination, Caption, Badge, Button, Text, MetricLabel,
} from '@/components/ui';
import {
  MetricCard, MetricBar, InlineMetric, SavedViewMenu, DataFreshnessAuto,
} from '@/components/data-display';
import {
  ChartContainer, ChartTooltip, ChartGradient,
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  axisTickSm, chartGrid, chartAnimation, CHART_COLORS,
} from '@/components/charts';
import { RangePicker, VehicleSelect } from '@/components/forms';
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
import { fmtInt } from '@/lib/numberFormat';
import { exportAsCSV, exportAsJSON } from '@/lib/export';
import type { Trip } from '@/api/types';

/* ─── Constants & helpers ─────────────────────────────────── */

// Wh/km -> Wh/(display unit) conversion uses an inline factor because
// @/lib/unitConversion does not yet expose a convertEfficiencyFromSI helper.
// Same precedent as FleetComparePage.whPerKmToDisplay.
const KM_PER_MILE = 1.609344;

const KPI_BAND = 'grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-3 xl:grid-cols-6';
const CARD_GRID = 'grid grid-cols-1 gap-3 sm:gap-4 md:grid-cols-2 2xl:grid-cols-3 3xl:grid-cols-4';
const DISTANCE_COLOR = CHART_COLORS[0];
const ENERGY_COLOR = CHART_COLORS[1];
const ENERGY_ROWS = 6;

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

  const [page, setPage] = useUrlNumber('page', 1);
  const [pageSize] = useUrlNumber('size', 50);
  const {
    start: startDate,
    end: endDate,
    setRangeWithUrlUpdates,
  } = useRangeState({
    persistKey: 'trips.list.range',
    defaultPresetId: '1y',
  });
  const setUrlBatch = useUrlBatch();

  const tripsQuery = useTrips({
    vehicle_id: vehicleId ?? undefined,
    limit: pageSize,
    offset: (page - 1) * pageSize,
    start: startDate,
    end: endDate,
  });
  const { data: trips, isLoading, isError, error, refetch } = tripsQuery;

  const allTrips = trips ?? [];

  // Heuristic total for pagination (backend doesn't return a total count).
  const estimatedTotal =
    allTrips.length < pageSize
      ? (page - 1) * pageSize + allTrips.length
      : page * pageSize + 1;

  const onRetry = () => {
    void refetch();
  };

  const sectionState: SectionStateProps = { trips: allTrips, isLoading, isError, error, onRetry };

  return (
    <PageContainer
      title={t('trips.title', 'Trips')}
      subtitle={t('trips.subtitle', 'Multi-drive trip reports with distance and cost tracking')}
      loading={isLoading && allTrips.length === 0}
      actions={
        <div className="flex flex-wrap items-center justify-end gap-3">
          <VehicleSelect />
          <RangePicker
            value={{ start: startDate, end: endDate }}
            onChange={(r) => {
              setRangeWithUrlUpdates(r, { page: null });
            }}
            align="end"
            triggerTestId="trip-list-range"
          />
          <DataFreshnessAuto query={tripsQuery} />
          <SavedViewMenu
            route="/trips"
            currentQuery={savedView.currentQuery}
            onApply={savedView.apply}
          />
        </div>
      }
    >
      <PullToRefresh onRefresh={async () => { await refetch(); }}>
        {/* 1 — KPI band: full-width responsive metric grid */}
        <FadeIn>
          <section aria-label={t('trips.stats.aria', 'Trip summary metrics')}>
            <TripStatsBand trips={allTrips} isLoading={isLoading} />
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
            <div className="mb-3 flex items-center justify-between gap-3">
              <PanelTitle>{t('trips.list.heading', 'All Trips')}</PanelTitle>
              {allTrips.length > 0 && (
                <Caption>{t('trips.list.count', '{{count}} trips', { count: allTrips.length })}</Caption>
              )}
            </div>
            {isLoading ? (
              <div className={CARD_GRID}>
                {[0, 1, 2, 3, 4, 5].map((i) => (
                  <Skeleton key={i} className="h-40 rounded-xl" />
                ))}
              </div>
            ) : isError ? (
              <GlassPanel className="p-4 sm:p-5">
                <QueryError error={error} onRetry={onRetry} resourceName={t('trips.title', 'Trips')} />
              </GlassPanel>
            ) : allTrips.length === 0 ? (
              <GlassPanel className="p-4 sm:p-5">
                <EmptyState
                  icon={<Route className="h-12 w-12" aria-hidden="true" />}
                  message={t('trips.list.empty', 'No trips recorded yet')}
                  action={{ label: t('common.retry', 'Retry'), onClick: onRetry }}
                />
              </GlassPanel>
            ) : (
              <div className={CARD_GRID}>
                {allTrips.map((trip) => (
                  <TripCard key={trip.id} trip={trip} />
                ))}
              </div>
            )}
          </section>
        </FadeIn>

        {/* 4 — Pagination footer */}
        {allTrips.length > 0 && (
          <FadeIn delay={0.3}>
            <Pagination
              page={page}
              pageSize={pageSize}
              total={estimatedTotal}
              onPageChange={setPage}
              onPageSizeChange={(s) => {
                setUrlBatch({ size: String(s), page: null });
              }}
            />
          </FadeIn>
        )}
      </PullToRefresh>
    </PageContainer>
  );
}

/* ─── KPI band ────────────────────────────────────────────── */

/** Full-width KPI band. Aggregates are computed null-safe from SI fields and
 *  formatted at the display boundary via `useUnits` / `useFormatting`. */
function TripStatsBand({ trips, isLoading }: { trips: Trip[]; isLoading: boolean }) {
  const { t } = useTranslation();
  const { unitPrefs, formatEnergy } = useUnits();
  const { formatCurrency } = useFormatting();
  const distancePref = unitPrefs.distance;

  const stats = useMemo(() => {
    const totalDistM = trips.reduce((s, trip) => s + (trip.total_distance_m ?? 0), 0);
    const totalEnergyWh = trips.reduce((s, trip) => s + (trip.total_energy_wh ?? 0), 0);
    const totalCost = trips.reduce((s, trip) => s + (trip.total_cost ?? 0), 0);
    const totalDrives = trips.reduce((s, trip) => s + (trip.drive_count ?? 0), 0);
    const totalCharges = trips.reduce((s, trip) => s + (trip.charge_count ?? 0), 0);
    const tripCount = trips.length;
    const totalDistDisplay = convertDistanceFromSI(totalDistM, distancePref);
    const avgDistDisplay = tripCount > 0 ? totalDistDisplay / tripCount : 0;
    return {
      totalEnergyWh, totalCost, totalDrives, totalCharges,
      tripCount, totalDistDisplay, avgDistDisplay,
    };
  }, [trips, distancePref]);

  if (isLoading) {
    return (
      <div className={KPI_BAND}>
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <Skeleton key={i} className="h-[86px] rounded-xl" />
        ))}
      </div>
    );
  }

  return (
    <div className={KPI_BAND}>
      <MetricCard
        label={t('trips.stats.distance', 'Total Distance')}
        value={`${fmtInt(stats.totalDistDisplay)} ${distancePref}`}
        icon={<MapPin className="h-4 w-4" aria-hidden="true" />}
        color="cyan"
        subtitle={t('trips.stats.tripCount', '{{count}} trips', { count: stats.tripCount })}
      />
      <MetricCard
        label={t('trips.stats.energy', 'Energy Used')}
        value={formatEnergy(stats.totalEnergyWh)}
        icon={<Zap className="h-4 w-4" aria-hidden="true" />}
        color="amber"
        subtitle={t('trips.stats.driveCount', '{{count}} drives', { count: stats.totalDrives })}
      />
      <MetricCard
        label={t('trips.stats.cost', 'Total Cost')}
        value={formatCurrency(stats.totalCost)}
        icon={<DollarSign className="h-4 w-4" aria-hidden="true" />}
        color="green"
        subtitle={
          stats.totalDistDisplay > 0
            ? t('trips.stats.costPer', '{{cost}}/100{{unit}}', {
                cost: formatCurrency((stats.totalCost / stats.totalDistDisplay) * 100),
                unit: distancePref,
              })
            : formatCurrency(0)
        }
      />
      <MetricCard
        label={t('trips.stats.total', 'Total Trips')}
        value={`${stats.tripCount}`}
        icon={<Route className="h-4 w-4" aria-hidden="true" />}
        color="purple"
        subtitle={t('trips.stats.totalDrives', '{{count}} total drives', { count: stats.totalDrives })}
      />
      <MetricCard
        label={t('trips.stats.avgPerTrip', 'Avg / Trip')}
        value={`${fmtInt(stats.avgDistDisplay)} ${distancePref}`}
        icon={<Gauge className="h-4 w-4" aria-hidden="true" />}
        color="blue"
        subtitle={t('trips.stats.avgPerTripSub', 'distance per trip')}
      />
      <MetricCard
        label={t('trips.stats.charges', 'Total Charges')}
        value={`${stats.totalCharges}`}
        icon={<BatteryCharging className="h-4 w-4" aria-hidden="true" />}
        color="red"
        subtitle={t('trips.stats.chargeSessions', '{{count}} charge sessions', { count: stats.totalCharges })}
      />
    </div>
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
          distance: convertDistanceFromSI(trip.total_distance_m ?? 0, distancePref),
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
    <ChartContainer
      title={t('trips.chart.title', 'Top Trips by Distance')}
      ariaLabel={t('trips.chart.aria', 'Top trips ranked by distance horizontal bar chart')}
      data={chartData}
      dataColumns={[
        { key: 'name', label: t('trips.chart.col.trip', 'Trip') },
        { key: 'distance', label: `${t('trips.chart.distance', 'Distance')} (${distancePref})` },
      ]}
      height={280}
      className={className}
      loading={isLoading}
      empty={!isLoading && !isError && chartData.length === 0}
      action={
        <div className="flex gap-2">
          <Button variant="ghost" size="sm" onClick={handleExportCSV} disabled={!canExport}>
            <Download className="mr-1 h-3.5 w-3.5" aria-hidden="true" />
            {t('trips.export.csv', 'CSV')}
          </Button>
          <Button variant="ghost" size="sm" onClick={handleExportJSON} disabled={!canExport}>
            <Download className="mr-1 h-3.5 w-3.5" aria-hidden="true" />
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
          <BarChart data={chartData} layout="vertical" {...chartAnimation}>
            <defs>
              <ChartGradient id="tripGrad" color={DISTANCE_COLOR} opacity={0.8} />
            </defs>
            {chartGrid}
            <XAxis type="number" tick={axisTickSm} />
            <YAxis dataKey="name" type="category" tick={axisTickSm} width={80} />
            <Tooltip content={<ChartTooltip />} />
            <Bar
              dataKey="distance"
              fill="url(#tripGrad)"
              name={`${t('trips.chart.distance', 'Distance')} (${distancePref})`}
              radius={[0, 4, 4, 0]}
            />
          </BarChart>
        </ResponsiveContainer>
      )}
    </ChartContainer>
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
    <GlassPanel className="p-4 sm:p-5">
      <PanelTitle className="mb-3 flex items-center gap-2">
        <Zap className="h-4 w-4 text-amber-300" aria-hidden="true" />
        {t('trips.energy.title', 'Top Trips by Energy')}
      </PanelTitle>
      {isLoading ? (
        <Skeleton height={220} />
      ) : isError ? (
        <QueryError error={error} onRetry={onRetry} resourceName={t('trips.title', 'Trips')} />
      ) : rows.ranked.length === 0 ? (
        <EmptyState
          icon={<Zap className="h-8 w-8" aria-hidden="true" />}
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
              sublabel={formatEnergy(trip.total_energy_wh ?? 0)}
            />
          ))}
        </div>
      )}
    </GlassPanel>
  );
}

/* ─── Trip card ───────────────────────────────────────────── */

/** A single trip rendered as a bento grid cell — header, meta badges, and a
 *  distance / energy / cost stat footer. */
function TripCard({ trip }: { trip: Trip }) {
  const { t } = useTranslation();
  const { unitPrefs, formatEnergy } = useUnits();
  const { formatCurrency } = useFormatting();

  const distancePref = unitPrefs.distance;
  const distanceM = trip.total_distance_m ?? 0;
  const energyWh = trip.total_energy_wh ?? 0;
  const cost = trip.total_cost ?? 0;
  const driveCount = trip.drive_count ?? 0;
  const chargeCount = trip.charge_count ?? 0;

  const distanceDisplay = convertDistanceFromSI(distanceM, distancePref);
  const whPerKm = distanceM > 0 ? energyWh / (distanceM / 1000) : 0;
  const efficiencyDisplay = distancePref === 'mi' ? whPerKm * KM_PER_MILE : whPerKm;
  const efficiencyUnit = distancePref === 'mi' ? 'Wh/mi' : 'Wh/km';

  return (
    <GlassPanel className="flex h-full flex-col gap-3 p-4">
      <div className="flex items-start gap-3">
        <span
          aria-hidden="true"
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-cyan-500/10 ring-1 ring-cyan-500/20"
        >
          <Route className="h-5 w-5 text-cyan-300" />
        </span>
        <div className="min-w-0 flex-1">
          <Text as="p" size="sm" weight="semibold" color="primary" className="truncate">
            {trip.name ?? `${t('trips.row.trip', 'Trip')} #${trip.id}`}
          </Text>
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">
            <InlineMetric icon={<Calendar />} value={formatDate(trip.start_date)} />
            <InlineMetric
              icon={<Clock />}
              value={formatDuration(
                trip.start_date,
                trip.end_date ?? null,
                t('trips.card.inProgress', 'In progress'),
              )}
            />
          </div>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        <Badge variant="info" size="sm">
          {t('trips.card.drives', '{{count}} drives', { count: driveCount })}
        </Badge>
        {chargeCount > 0 && (
          <Badge variant="success" size="sm">
            {t('trips.card.charges', '{{count}} charges', { count: chargeCount })}
          </Badge>
        )}
      </div>

      <div className="mt-auto grid grid-cols-3 gap-2 border-t border-[var(--border-subtle)] pt-3">
        <div className="min-w-0">
          <MetricLabel>{t('trips.card.distance', 'Distance')}</MetricLabel>
          <Text as="p" size="sm" weight="semibold" color="primary" className="mt-0.5 truncate tabular-nums">
            {fmtInt(distanceDisplay)} {distancePref}
          </Text>
        </div>
        <div className="min-w-0">
          <MetricLabel>{t('trips.card.energy', 'Energy')}</MetricLabel>
          <Text as="p" size="sm" weight="semibold" className="mt-0.5 truncate tabular-nums text-amber-300">
            {formatEnergy(energyWh)}
          </Text>
          <Caption className="block truncate">
            {distanceM > 0
              ? `${fmtInt(efficiencyDisplay)} ${efficiencyUnit}`
              : `0 ${efficiencyUnit}`}
          </Caption>
        </div>
        <div className="min-w-0">
          <MetricLabel>{t('trips.card.cost', 'Cost')}</MetricLabel>
          <Text as="p" size="sm" weight="semibold" className="mt-0.5 truncate tabular-nums text-emerald-300">
            {cost > 0 ? formatCurrency(cost) : '—'}
          </Text>
        </div>
      </div>
    </GlassPanel>
  );
}
