import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Route, MapPin, Zap, Clock, Calendar, DollarSign, Download } from 'lucide-react';
import { PageContainer } from '@/components/layout';
import { GlassPanel, Select, Pagination, Button } from '@/components/ui';
import { MetricCard, InlineMetric, SavedViewMenu, DataFreshnessAuto } from '@/components/data-display';
import { ChartContainer, ChartTooltip, ChartGradient, BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, axisTickSm, chartGrid, chartAnimation } from '@/components/charts';
import { DateRangeFilter } from '@/components/forms';
import { EmptyState, Skeleton } from '@/components/feedback';
import { FadeIn } from '@/components/motion';
import { useTrips } from '@/api/hooks/useTrips';
import { useVehicles } from '@/api/hooks/useVehicles';
import { useUnits } from '@/hooks/useUnits';
import {
  convertDistanceFromSI,
  type DistanceUnitPref,
} from '@/lib/unitConversion';
import { usePageTitle } from '@/hooks/usePageTitle';
import { useSavedViewUrl } from '@/hooks/useSavedViewUrl';
import { useUrlBatch, useUrlNumber, useUrlString } from '@/hooks/useUrlState';
import { formatDate } from '@/lib/dateFormat';
import { fmtNumber, fmtInt } from '@/lib/numberFormat';
import { exportAsCSV, exportAsJSON } from '@/lib/export';
import { PullToRefresh } from '@/components/mobile';
import type { Trip } from '@/api/types';

// Phase-43/0025 + 0026: Wh/km -> Wh/(display unit) conversion uses an
// inline factor because @/lib/unitConversion does not yet expose a
// convertEfficiencyFromSI helper. Same precedent as
// FleetComparePage.whPerKmToDisplay.
const KM_PER_MILE = 1.609344;

function formatDuration(startDate: string, endDate: string | null): string {
  if (!endDate) return 'In progress';
  const ms = new Date(endDate).getTime() - new Date(startDate).getTime();
  const hours = Math.floor(ms / 3600000);
  const minsRaw = (ms % 3600000) / 60000;
  if (hours === 0) return `${fmtInt(minsRaw)}m`;
  return minsRaw >= 0.5 ? `${hours}h ${fmtInt(minsRaw)}m` : `${hours}h`;
}

export default function TripListPage() {
  const { t } = useTranslation();
  usePageTitle(t('trips.title', 'Trips'));
  const savedView = useSavedViewUrl();

  const { data: vehicles } = useVehicles();
  const [selectedVehicle, setSelectedVehicle] = useUrlNumber('vehicle_id', 0);
  const vehicleId = selectedVehicle > 0 ? selectedVehicle : (vehicles?.[0]?.id ?? null);

  const [page, setPage] = useUrlNumber('page', 1);
  const [pageSize, setPageSize] = useUrlNumber('size', 50);
  const defaultStart = useMemo(() => {
    const d = new Date();
    d.setDate(d.getDate() - 365);
    return d.toISOString().split('T')[0];
  }, []);
  const defaultEnd = useMemo(() => new Date().toISOString().split('T')[0], []);
  const [startDate, setStartDate] = useUrlString('from', defaultStart);
  const [endDate, setEndDate] = useUrlString('to', defaultEnd);
  const setRangeBatch = useUrlBatch();

  const { unitPrefs } = useUnits();
  // useSettings retained for the legacy efficiencyUnit label string only.

  const efficiencyUnit = unitPrefs.distance === 'mi' ? 'Wh/mi' : 'Wh/km';

  const tripsQuery = useTrips({
    vehicle_id: vehicleId ?? undefined,
    limit: pageSize,
    offset: (page - 1) * pageSize,
    start: startDate,
    end: endDate,
  });
  const { data: trips, isLoading, refetch: refetchTrips } = tripsQuery;

  const allTrips = trips ?? [];

  // Summary stats
  const totalDist = allTrips.reduce((s, t) => s + t.total_distance_km, 0);
  const totalEnergy = allTrips.reduce((s, t) => s + t.total_energy_kwh, 0);
  const totalCost = allTrips.reduce((s, t) => s + t.total_cost, 0);
  const totalDrives = allTrips.reduce((s, t) => s + t.drive_count, 0);

  // Bar chart: top 10 trips by distance
  const chartData = useMemo(
    () =>
      [...allTrips]
        .sort((a, b) => b.total_distance_km - a.total_distance_km)
        .slice(0, 10)
        .map((trip) => ({
          name: trip.name ?? `Trip ${trip.id}`,
          distance: convertDistanceFromSI(trip.total_distance_km * 1000, unitPrefs.distance),
          energy: trip.total_energy_kwh,
        })),
    [allTrips, unitPrefs.distance],
  );

  const vehicleOptions = (vehicles ?? []).map((v) => ({
    value: String(v.id),
    label: v.display_name || v.vin,
  }));

  const handleExportCSV = () => {
    exportAsCSV(
      allTrips.map((trip) => ({
        id: trip.id,
        name: trip.name ?? `Trip ${trip.id}`,
        start_date: trip.start_date,
        end_date: trip.end_date ?? '',
        distance_km: trip.total_distance_km,
        energy_kwh: trip.total_energy_kwh,
        cost: trip.total_cost,
        drives: trip.drive_count,
        charges: trip.charge_count,
      })),
      'teslasync-trips.csv',
    );
  };

  const handleExportJSON = () => {
    exportAsJSON(allTrips, 'teslasync-trips.json');
  };

  // Heuristic total for pagination (backend doesn't return total count)
  const estimatedTotal =
    allTrips.length < pageSize
      ? (page - 1) * pageSize + allTrips.length
      : page * pageSize + 1;

  const totalDistDisplay = convertDistanceFromSI(totalDist * 1000, unitPrefs.distance);

  return (
    <PageContainer
      title={t('trips.title', 'Trips')}
      subtitle={t('trips.subtitle', 'Multi-drive trip reports with distance and cost tracking')}
      loading={isLoading}
      actions={
        <div className="flex items-center gap-3">
          <DataFreshnessAuto query={tripsQuery} />
          <SavedViewMenu
            route="/trips"
            currentQuery={savedView.currentQuery}
            onApply={savedView.apply}
          />
        </div>
      }
    >
      <PullToRefresh onRefresh={async () => { await refetchTrips(); }}>
      {/* Vehicle Selector */}
      {vehicleOptions.length > 1 && (
        <div className="flex justify-end mb-4">
          <Select
            value={String(vehicleId ?? '')}
            onChange={(e) => {
              setSelectedVehicle(Number(e.target.value));
              setPage(1);
            }}
            options={vehicleOptions}
            label={t('trips.vehicle', 'Vehicle')}
          />
        </div>
      )}

      {/* Date Range Filter */}
      <FadeIn>
        <DateRangeFilter
          startDate={startDate}
          endDate={endDate}
          onStartDateChange={setStartDate}
          onEndDateChange={setEndDate}
          onRangeChange={(r) => setRangeBatch({ from: r.start, to: r.end })}
          onApply={() => setPage(1)}
        />
      </FadeIn>

      {/* Stats Cards */}
      <FadeIn delay={0.05}>
        {isLoading ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 my-6">
            {[1, 2, 3, 4].map((i) => (
              <Skeleton key={i} className="h-24 rounded-xl" />
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 my-6">
            <MetricCard
              label={t('trips.stats.distance', 'Total Distance')}
              value={`${fmtInt(totalDistDisplay)} ${unitPrefs.distance}`}
              icon={<MapPin className="h-4 w-4" />}
              color="cyan"
              subtitle={t('trips.stats.tripCount', '{{count}} trips', { count: allTrips.length })}
            />
            <MetricCard
              label={t('trips.stats.energy', 'Energy Used')}
              value={`${fmtNumber(totalEnergy)} kWh`}
              icon={<Zap className="h-4 w-4" />}
              color="amber"
              subtitle={t('trips.stats.driveCount', '{{count}} drives', { count: totalDrives })}
            />
            <MetricCard
              label={t('trips.stats.cost', 'Total Cost')}
              value={`$${fmtNumber(totalCost)}`}
              icon={<DollarSign className="h-4 w-4" />}
              color="green"
              subtitle={
                totalDistDisplay > 0
                  ? `$${fmtNumber((totalCost / totalDistDisplay) * 100)}/100${unitPrefs.distance}`
                  : '$0'
              }
            />
            <MetricCard
              label={t('trips.stats.total', 'Total Trips')}
              value={`${allTrips.length}`}
              icon={<Route className="h-4 w-4" />}
              color="purple"
              subtitle={t('trips.stats.totalDrives', '{{count}} total drives', { count: totalDrives })}
            />
          </div>
        )}
      </FadeIn>

      {/* Top Trips Chart */}
      <FadeIn delay={0.1}>
        <ChartContainer
          title={t('trips.chart.title', 'Top Trips by Distance')}
          ariaLabel={t('trips.chart.title.aria', 'Top trips ranked by distance horizontal bar chart')}
          data={chartData.map((c) => ({ name: c.name, distance: c.distance }))}
          dataColumns={[
            { key: 'name', label: t('trips.chart.col.trip', 'Trip') },
            { key: 'distance', label: `${t('trips.chart.distance', 'Distance')} (${unitPrefs.distance})` },
          ]}
          height={280}
          className="mb-6"
          action={
            <div className="flex gap-2">
              <Button variant="ghost" size="sm" onClick={handleExportCSV}>
                <Download className="h-3.5 w-3.5 mr-1" />
                {t('trips.export.csv', 'CSV')}
              </Button>
              <Button variant="ghost" size="sm" onClick={handleExportJSON}>
                <Download className="h-3.5 w-3.5 mr-1" />
                {t('trips.export.json', 'JSON')}
              </Button>
            </div>
          }
        >
          {chartData.length > 0 ? (
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData} layout="vertical" {...chartAnimation}>
                <defs>
                  <ChartGradient id="tripGrad" color="#00f0ff" opacity={0.8} />
                </defs>
                {chartGrid}
                <XAxis type="number" tick={axisTickSm} />
                <YAxis dataKey="name" type="category" tick={axisTickSm} width={80} />
                <Tooltip content={<ChartTooltip />} />
                <Bar
                  dataKey="distance"
                  fill="url(#tripGrad)"
                  name={`${t('trips.chart.distance', 'Distance')} (${unitPrefs.distance})`}
                  radius={[0, 4, 4, 0]}
                />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <EmptyState /* no-action: transient empty state — surfaces when source data is missing; no specific recovery action available */ icon={<Route className="h-12 w-12" />} message={t('trips.chart.empty', 'No trip data to chart')} />
          )}
        </ChartContainer>
      </FadeIn>

      {/* Trip List */}
      <FadeIn delay={0.15}>
        <GlassPanel className="p-4 sm:p-6">
          <h3 className="text-sm font-semibold text-[var(--text-primary)] mb-4">
            {t('trips.list.heading', 'All Trips')}
          </h3>
          {allTrips.length === 0 ? (
            <EmptyState /* no-action: transient empty state — surfaces when source data is missing; no specific recovery action available */ icon={<Route className="h-12 w-12" />} message={t('trips.list.empty', 'No trips recorded yet')} />
          ) : (
            <div className="space-y-3">
              {allTrips.map((trip) => (
                <TripRow
                  key={trip.id}
                  trip={trip}
                  distancePref={unitPrefs.distance}
                  efficiencyUnit={efficiencyUnit}
                />
              ))}
            </div>
          )}
        </GlassPanel>
      </FadeIn>

      {/* Pagination */}
      {allTrips.length > 0 && (
        <Pagination
          page={page}
          pageSize={pageSize}
          total={estimatedTotal}
          onPageChange={setPage}
          onPageSizeChange={(s) => {
            setPageSize(s);
            setPage(1);
          }}
        />
      )}
      </PullToRefresh>
    </PageContainer>
  );
}

/* ─── Trip Row ───────────────────────────────────────────── */

interface TripRowProps {
  trip: Trip;
  distancePref: DistanceUnitPref;
  efficiencyUnit: string;
}

function TripRow({ trip, distancePref, efficiencyUnit }: TripRowProps) {
  const { t } = useTranslation();

  const whPerKm = trip.total_distance_km > 0
    ? (trip.total_energy_kwh / trip.total_distance_km) * 1000
    : 0;
  const efficiencyDisplay = distancePref === 'mi' ? whPerKm * KM_PER_MILE : whPerKm;
  const distanceDisplay = convertDistanceFromSI(trip.total_distance_km * 1000, distancePref);

  return (
    <GlassPanel className="p-3 sm:p-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
      <div className="flex items-center gap-3 sm:gap-4">
        <div className="h-10 w-10 rounded-full flex items-center justify-center bg-cyan-500/10">
          <Route className="h-5 w-5 text-cyan-400" />
        </div>
        <div>
          <p className="text-sm font-semibold text-[var(--text-primary)]">
            {trip.name ?? `${t('trips.row.trip', 'Trip')} #${trip.id}`}
          </p>
          <div className="flex items-center gap-3 mt-0.5">
            <InlineMetric icon={<Calendar />} value={formatDate(trip.start_date)} />
            <InlineMetric icon={<Clock />} value={formatDuration(trip.start_date, trip.end_date ?? null)} />
            <span className="text-[11px] text-[var(--text-muted)]">
              {t('trips.row.drives', '{{count}} drives', { count: trip.drive_count })}
            </span>
            {trip.charge_count > 0 && (
              <span className="text-[11px] text-[var(--text-muted)]">
                {t('trips.row.charges', '{{count}} charges', { count: trip.charge_count })}
              </span>
            )}
          </div>
        </div>
      </div>

      <div className="flex items-center gap-4 sm:gap-6 text-right w-full sm:w-auto justify-end">
        <div>
          <p className="text-sm font-bold text-[var(--text-primary)]">
            {fmtInt(distanceDisplay)} {distancePref}
          </p>
          <p className="text-[10px] text-[var(--text-muted)]">
            {t('trips.row.drives', '{{count}} drives', { count: trip.drive_count })}
          </p>
        </div>
        <div>
          <p className="text-sm font-bold text-amber-400">
            {fmtNumber(trip.total_energy_kwh)} kWh
          </p>
          <p className="text-[10px] text-[var(--text-muted)]">
            {trip.total_distance_km > 0
              ? `${fmtInt(efficiencyDisplay)} ${efficiencyUnit}`
              : `0 ${efficiencyUnit}`}
          </p>
        </div>
        {trip.total_cost > 0 && (
          <div>
            <p className="text-sm font-bold text-emerald-400">
              ${fmtNumber(trip.total_cost)}
            </p>
            <p className="text-[10px] text-[var(--text-muted)]">{t('trips.row.cost', 'cost')}</p>
          </div>
        )}
      </div>
    </GlassPanel>
  );
}
