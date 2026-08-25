import { useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Gauge, TrendingUp, BarChart3, Route,
  CalendarDays, CalendarRange, CalendarClock, Activity,
} from 'lucide-react';

import { PageContainer } from '@/components/layout';
import { VehicleSelect } from '@/components/forms';
import { GlassPanel, DataTable, PanelTitle, type Column } from '@/components/ui';
import { MetricCard, MetricBar, KVList } from '@/components/data-display';
import { Skeleton, EmptyState, QueryError } from '@/components/feedback';
import { FadeIn } from '@/components/motion';
import {
  ChartTooltip, EmbeddedChart,
  AreaChart, Area, BarChart, Bar, XAxis, YAxis,
  CartesianGrid, Tooltip, ResponsiveContainer,
  AREA_DEFAULTS, areaGradient, axisTickSm,
} from '@/components/charts';

import { usePageTitle } from '@/hooks/usePageTitle';
import { useSelectedVehicle } from '@/hooks/useSelectedVehicle';
import { NoVehicleSelected } from '@/features/onboarding/components/NoVehicleSelected';
import { useUnits } from '@/hooks/useUnits';
import { convertDistanceFromSI } from '@/lib/unitConversion';
import { useChartPalette } from '@/hooks/useChartPalette';
import { formatDate } from '@/lib/dateFormat';
import { fmtNumber, fmtInt } from '@/lib/numberFormat';
import {
  useMileageStats,
  useMonthlyMileage,
  useDailyMileage,
} from '@/api/hooks/useAnalytics';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface MonthRow {
  month: string;
  distance: number;
  drives: number;
  dailyAvg: number;
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export default function MileagePage() {
  const { t } = useTranslation();
  usePageTitle(t('mileage.title', 'Mileage'));

  const { unitPrefs } = useUnits();
  const distanceUnit = unitPrefs.distance;
  // Backend /mileage/{stats,daily,monthly} returns kilometres, while the
  // SI-floor converter expects meters — scale km → m before converting to
  // the user's display unit at the render boundary.
  const fromKm = useCallback(
    (km: number) => convertDistanceFromSI((km ?? 0) * 1000, distanceUnit),
    [distanceUnit],
  );

  // Reactive chart palette follows the active theme + color-vision settings.
  const palette = useChartPalette();

  // Header VehiclePicker is the source of truth.
  const { vehicleId } = useSelectedVehicle();
  const activeId = vehicleId != null ? String(vehicleId) : '';

  const statsQuery = useMileageStats(activeId);
  const dailyQuery = useDailyMileage(activeId, 90);
  const monthlyQuery = useMonthlyMileage(activeId);
  const dataSources = useMemo(
    () => [
      {
        id: 'mileage-summary',
        label: t('dataSources.labels.mileageSummary', 'Mileage summary'),
        query: statsQuery,
        enabled: vehicleId != null,
      },
      {
        id: 'daily-mileage',
        label: t('dataSources.labels.dailyMileage', 'Daily mileage'),
        query: dailyQuery,
        enabled: vehicleId != null,
      },
      {
        id: 'monthly-mileage',
        label: t('dataSources.labels.monthlyMileage', 'Monthly mileage'),
        query: monthlyQuery,
        enabled: vehicleId != null,
      },
    ],
    [dailyQuery, monthlyQuery, statsQuery, t, vehicleId],
  );

  const stats = statsQuery.data;
  const dailyRows = useMemo(() => dailyQuery.data ?? [], [dailyQuery.data]);
  const monthlyData = useMemo(() => monthlyQuery.data ?? [], [monthlyQuery.data]);

  /* Summary derivations from /mileage/stats. Daily avg uses the trailing
     30-day window so it reflects recent activity rather than a lifetime-flat
     average that understates current usage on long-tail histories. */
  const dailyAvgKm = (stats?.last_30d_km ?? 0) / 30;
  const totalDistance = fromKm(stats?.lifetime_km ?? 0);
  const totalDrives = stats?.drive_count_lifetime ?? 0;
  const dailyAvg = fromKm(dailyAvgKm);
  const annualProjection = fromKm(dailyAvgKm * 365);
  const last7d = fromKm(stats?.last_7d_km ?? 0);
  const last30d = fromKm(stats?.last_30d_km ?? 0);
  const last365d = fromKm(stats?.last_365d_km ?? 0);

  // Windowed distances vs lifetime, for the "Distance by Window" bento panel.
  const lifetimeMax = totalDistance > 0 ? totalDistance : 1;
  const windowRows = useMemo(
    () => [
      { key: '7d', label: t('mileage.last7Days', 'Last 7 Days'), value: last7d, color: palette[0] },
      { key: '30d', label: t('mileage.last30Days', 'Last 30 Days'), value: last30d, color: palette[1] },
      { key: '365d', label: t('mileage.last365Days', 'Last 365 Days'), value: last365d, color: palette[2] },
    ],
    [t, last7d, last30d, last365d, palette],
  );

  const activityItems = useMemo(
    () => [
      { label: t('mileage.firstDrive', 'First Drive'), value: stats?.first_drive_at ? formatDate(stats.first_drive_at) : '—' },
      { label: t('mileage.lastDrive', 'Last Drive'), value: stats?.last_drive_at ? formatDate(stats.last_drive_at) : '—' },
      { label: t('mileage.lifetimeDrives', 'Lifetime Drives'), value: fmtInt(totalDrives) },
      { label: t('mileage.drives30d', 'Drives (30d)'), value: fmtInt(stats?.drive_count_30d ?? 0) },
    ],
    [t, stats?.first_drive_at, stats?.last_drive_at, stats?.drive_count_30d, totalDrives],
  );

  /* Odometer over time — end-of-day absolute reading (end_odometer_km).
     Days where every drive had a NULL odometer (rare; abnormally-ended
     drives) are filtered out so the line doesn't dive to zero. */
  const odometerData = useMemo(
    () =>
      dailyRows
        .filter((d) => d.end_odometer_km != null)
        .map((d) => ({ date: formatDate(d.date), odometer: fromKm(d.end_odometer_km ?? 0) })),
    [dailyRows, fromKm],
  );

  const dailyData = useMemo(
    () => dailyRows.map((d) => ({ date: formatDate(d.date), distance: fromKm(d.total_km ?? 0) })),
    [dailyRows, fromKm],
  );

  /* Monthly summary rows derive from /mileage/monthly which already groups
     per UTC calendar month. The same rows drive the Monthly Distance chart. */
  const monthlyRows: MonthRow[] = useMemo(
    () =>
      monthlyData.map((m) => {
        const km = m.total_km ?? 0;
        const drives = m.drive_count ?? 0;
        return {
          month: m.year_month ?? '',
          distance: fromKm(km),
          drives,
          dailyAvg: drives > 0 ? fromKm(km / drives) : 0,
        };
      }),
    [monthlyData, fromKm],
  );
  const monthlyChartRows = useMemo(
    () => monthlyRows.map(({ month, distance }) => ({ month, distance })),
    [monthlyRows],
  );

  const monthColumns: Column<MonthRow>[] = useMemo(
    () => [
      { key: 'month', header: t('mileage.month', 'Month'), render: (r) => r.month, sortable: true },
      { key: 'distance', header: `${t('mileage.distance', 'Distance')} (${distanceUnit})`, render: (r) => fmtNumber(r.distance), sortable: true },
      { key: 'drives', header: t('mileage.drives', 'Drives'), render: (r) => fmtInt(r.drives), sortable: true },
      { key: 'dailyAvg', header: `${t('mileage.distancePerDrive', 'Distance / Drive')} (${distanceUnit})`, render: (r) => fmtNumber(r.dailyAvg), sortable: true },
    ],
    [t, distanceUnit],
  );

  // Defensive guard: no vehicle selected.
  if (vehicleId == null) {
    return <NoVehicleSelected pageTitle={t('mileage.title', 'Mileage')} />;
  }

  return (
    <PageContainer
      title={t('mileage.title', 'Mileage')}
      subtitle={t('mileage.subtitle', 'Daily and monthly distance tracking')}
      query={[statsQuery, dailyQuery, monthlyQuery]}
      dataSources={dataSources}
      actions={<VehicleSelect />}
    >
      {/* §1 — KPI band: full-width responsive metric grid */}
      <FadeIn>
        <section aria-label={t('mileage.kpis', 'Mileage summary metrics')}>
          {statsQuery.isError ? (
            <GlassPanel className="p-4 sm:p-5">
              <QueryError error={statsQuery.error} onRetry={() => statsQuery.refetch()} />
            </GlassPanel>
          ) : (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 xl:grid-cols-6">
              {statsQuery.isLoading ? (
                Array.from({ length: 6 }).map((_, i) => (
                  <Skeleton key={i} height={92} className="rounded-xl" />
                ))
              ) : (
                <>
                  <MetricCard
                    label={t('mileage.totalDistance', 'Total Distance')}
                    value={`${fmtInt(totalDistance)} ${distanceUnit}`}
                    icon={<Gauge className="h-4 w-4" />}
                    color="cyan"
                  />
                  <MetricCard
                    label={t('mileage.totalDrives', 'Total Drives')}
                    value={fmtInt(totalDrives)}
                    icon={<Route className="h-4 w-4" />}
                    color="green"
                  />
                  <MetricCard
                    label={t('mileage.dailyAvg30d', 'Daily Avg (30d)')}
                    value={`${fmtNumber(dailyAvg)} ${distanceUnit}`}
                    icon={<CalendarDays className="h-4 w-4" />}
                    color="purple"
                  />
                  <MetricCard
                    label={t('mileage.annualProjection', 'Annual Projection')}
                    value={`${fmtInt(annualProjection)} ${distanceUnit}`}
                    icon={<TrendingUp className="h-4 w-4" />}
                    color="amber"
                  />
                  <MetricCard
                    label={t('mileage.last7Days', 'Last 7 Days')}
                    value={`${fmtNumber(last7d)} ${distanceUnit}`}
                    icon={<CalendarClock className="h-4 w-4" />}
                    color="blue"
                  />
                  <MetricCard
                    label={t('mileage.last365Days', 'Last 365 Days')}
                    value={`${fmtInt(last365d)} ${distanceUnit}`}
                    icon={<CalendarRange className="h-4 w-4" />}
                    color="cyan"
                  />
                </>
              )}
            </div>
          )}
        </section>
      </FadeIn>

      {/* §2 — Primary bento: odometer hero + distance-by-window context */}
      <FadeIn delay={0.1}>
        <section
          aria-label={t('mileage.odometerSection', 'Odometer and distance windows')}
          className="grid grid-cols-1 gap-4 xl:grid-cols-3 xl:gap-5"
        >
          <GlassPanel className="p-4 sm:p-5 xl:col-span-2">
            <PanelTitle className="mb-3 flex items-center gap-2">
              <Gauge className="h-4 w-4 text-cyan-300" aria-hidden="true" />
              {t('mileage.odometerOverTime', 'Odometer Over Time')}
            </PanelTitle>
            {dailyQuery.isError ? (
              <QueryError error={dailyQuery.error} onRetry={() => dailyQuery.refetch()} />
            ) : dailyQuery.isLoading ? (
              <Skeleton height={288} />
            ) : odometerData.length === 0 ? (
              <EmptyState /* no-action: transient empty state — no odometer readings in the window */
                icon={<Gauge className="h-8 w-8" />}
                message={t('mileage.noOdometer', 'No odometer readings yet')}
              />
            ) : (
              <EmbeddedChart
                title={t('mileage.odometerOverTime', 'Odometer Over Time')}
                ariaLabel={t('mileage.odometerOverTimeAria', 'Odometer readings over time')}
                data={odometerData}
                dataColumns={[
                  { key: 'date', label: t('mileage.date', 'Date') },
                  {
                    key: 'odometer',
                    label: `${t('mileage.odometer', 'Odometer')} (${distanceUnit})`,
                    format: (value) => fmtNumber(Number(value ?? 0)),
                  },
                ]}
                height={288}
                mobileHeight={256}
                chartKey="mileage-odometer-over-time"
              >
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={odometerData}>
                    {areaGradient('odoGrad', palette[2])}
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--glass-border)" strokeOpacity={0.4} />
                    <XAxis dataKey="date" tick={axisTickSm} minTickGap={24} />
                    <YAxis tick={axisTickSm} domain={['auto', 'auto']} width={48} />
                    <Tooltip content={<ChartTooltip />} />
                    <Area
                      {...AREA_DEFAULTS}
                      dataKey="odometer"
                      stroke={palette[2]}
                      fill="url(#odoGrad)"
                      name={`${t('mileage.odometer', 'Odometer')} (${distanceUnit})`}
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </EmbeddedChart>
            )}
          </GlassPanel>

          <GlassPanel className="p-4 sm:p-5">
            <PanelTitle className="mb-3 flex items-center gap-2">
              <Activity className="h-4 w-4 text-cyan-300" aria-hidden="true" />
              {t('mileage.distanceByWindow', 'Distance by Window')}
            </PanelTitle>
            {statsQuery.isError ? (
              <QueryError error={statsQuery.error} onRetry={() => statsQuery.refetch()} />
            ) : statsQuery.isLoading ? (
              <Skeleton height={220} />
            ) : (
              <div className="space-y-4">
                <div className="space-y-3">
                  {windowRows.map((row) => (
                    <MetricBar
                      key={row.key}
                      label={row.label}
                      value={row.value}
                      max={lifetimeMax}
                      color={row.color}
                      sublabel={`${fmtNumber(row.value)} ${distanceUnit}`}
                    />
                  ))}
                </div>
                <KVList items={activityItems} />
              </div>
            )}
          </GlassPanel>
        </section>
      </FadeIn>

      {/* §3 — Secondary bento: daily + monthly distance side-by-side on wide screens */}
      <FadeIn delay={0.2}>
        <section
          aria-label={t('mileage.distanceCharts', 'Daily and monthly distance')}
          className="grid grid-cols-1 gap-4 2xl:grid-cols-2 xl:gap-5"
        >
          <GlassPanel className="p-4 sm:p-5">
            <PanelTitle className="mb-3 flex items-center gap-2">
              <BarChart3 className="h-4 w-4 text-cyan-300" aria-hidden="true" />
              {t('mileage.dailyDistance', 'Daily Distance')}
            </PanelTitle>
            {dailyQuery.isError ? (
              <QueryError error={dailyQuery.error} onRetry={() => dailyQuery.refetch()} />
            ) : dailyQuery.isLoading ? (
              <Skeleton height={288} />
            ) : dailyData.length === 0 ? (
              <EmptyState /* no-action: transient empty state — no daily distance in the window */
                icon={<BarChart3 className="h-8 w-8" />}
                message={t('mileage.noDaily', 'No daily distance yet')}
              />
            ) : (
              <EmbeddedChart
                title={t('mileage.dailyDistance', 'Daily Distance')}
                ariaLabel={t('mileage.dailyDistanceAria', 'Daily distance traveled over time')}
                data={dailyData}
                dataColumns={[
                  { key: 'date', label: t('mileage.date', 'Date') },
                  {
                    key: 'distance',
                    label: `${t('mileage.distance', 'Distance')} (${distanceUnit})`,
                    format: (value) => fmtNumber(Number(value ?? 0)),
                  },
                ]}
                height={288}
                mobileHeight={256}
                chartKey="mileage-daily-distance"
              >
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={dailyData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--glass-border)" strokeOpacity={0.4} />
                    <XAxis dataKey="date" tick={axisTickSm} minTickGap={24} />
                    <YAxis tick={axisTickSm} width={48} />
                    <Tooltip content={<ChartTooltip />} />
                    <Bar
                      dataKey="distance"
                      fill={palette[0]}
                      radius={[4, 4, 0, 0]}
                      name={`${t('mileage.distance', 'Distance')} (${distanceUnit})`}
                    />
                  </BarChart>
                </ResponsiveContainer>
              </EmbeddedChart>
            )}
          </GlassPanel>

          <GlassPanel className="p-4 sm:p-5">
            <PanelTitle className="mb-3 flex items-center gap-2">
              <BarChart3 className="h-4 w-4 text-cyan-300" aria-hidden="true" />
              {t('mileage.monthlyDistance', 'Monthly Distance')}
            </PanelTitle>
            {monthlyQuery.isError ? (
              <QueryError error={monthlyQuery.error} onRetry={() => monthlyQuery.refetch()} />
            ) : monthlyQuery.isLoading ? (
              <Skeleton height={288} />
            ) : monthlyRows.length === 0 ? (
              <EmptyState /* no-action: transient empty state — no monthly distance in the window */
                icon={<BarChart3 className="h-8 w-8" />}
                message={t('mileage.noMonthly', 'No monthly distance yet')}
              />
            ) : (
              <EmbeddedChart
                title={t('mileage.monthlyDistance', 'Monthly Distance')}
                ariaLabel={t('mileage.monthlyDistanceAria', 'Monthly distance traveled over time')}
                data={monthlyChartRows}
                dataColumns={[
                  { key: 'month', label: t('mileage.month', 'Month') },
                  {
                    key: 'distance',
                    label: `${t('mileage.distance', 'Distance')} (${distanceUnit})`,
                    format: (value) => fmtNumber(Number(value ?? 0)),
                  },
                ]}
                height={288}
                mobileHeight={256}
                chartKey="mileage-monthly-distance"
              >
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={monthlyRows}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--glass-border)" strokeOpacity={0.4} />
                    <XAxis dataKey="month" tick={axisTickSm} minTickGap={16} />
                    <YAxis tick={axisTickSm} width={48} />
                    <Tooltip content={<ChartTooltip />} />
                    <Bar
                      dataKey="distance"
                      fill={palette[1]}
                      radius={[4, 4, 0, 0]}
                      name={`${t('mileage.distance', 'Distance')} (${distanceUnit})`}
                    />
                  </BarChart>
                </ResponsiveContainer>
              </EmbeddedChart>
            )}
          </GlassPanel>
        </section>
      </FadeIn>

      {/* §4 — Detail band: full-width monthly summary table */}
      <FadeIn delay={0.3}>
        <GlassPanel className="p-4 sm:p-5">
          <PanelTitle className="mb-3 flex items-center gap-2">
            <CalendarRange className="h-4 w-4 text-cyan-300" aria-hidden="true" />
            {t('mileage.monthlySummary', 'Monthly Summary')}
          </PanelTitle>
          {monthlyQuery.isError ? (
            <QueryError error={monthlyQuery.error} onRetry={() => monthlyQuery.refetch()} />
          ) : monthlyQuery.isLoading ? (
            <Skeleton height={240} />
          ) : (
            <DataTable<MonthRow>
              tableId="analytics:mileage-monthly"
              columns={monthColumns}
              data={monthlyRows}
              keyExtractor={(r) => r.month}
              emptyMessage={t('mileage.noMonthly', 'No monthly distance yet')}
              compact
              pagination
            />
          )}
        </GlassPanel>
      </FadeIn>
    </PageContainer>
  );
}
