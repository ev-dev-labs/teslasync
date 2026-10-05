import { useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Gauge, BarChart3,
} from 'lucide-react';

import { PageLayout, Section, CardGrid, LayoutCard, type CardGridItem } from '@/components/layout/layout-reference';

import { DataTable, type Column } from '@/components/ui';
import { MetricBar, KVList } from '@/components/data-display';
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

import {
  useMileageStats,
  useMonthlyMileage,
  useDailyMileage,
} from '@/api/hooks/useAnalytics';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';
import { deriveDataState } from '@/api/dataState';
import { MileageSummary, MileageSourceNotice } from '../components/mileage-modernization';

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
  const { fmtInt, fmtNumber } = useNumberFormatting();
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
  const statsSource = deriveDataState(statsQuery, { provenance: 'historical' });
  const dailySource = deriveDataState(dailyQuery, { provenance: 'historical' });
  const monthlySource = deriveDataState(monthlyQuery, { provenance: 'historical' });
  const dailyRows = useMemo(() => dailyQuery.data ?? [], [dailyQuery.data]);
  const monthlyData = useMemo(() => monthlyQuery.data ?? [], [monthlyQuery.data]);

  /* Window derivations remain on the existing display boundary. Summary
     average/projection operands are preserved in MileageSummary. */
  const totalDistance = fromKm(stats?.lifetime_km ?? 0);
  const totalDrives = stats?.drive_count_lifetime ?? 0;
  const last7d = fromKm(stats?.last_7d_km ?? 0);
  const last30d = fromKm(stats?.last_30d_km ?? 0);
  const last365d = fromKm(stats?.last_365d_km ?? 0);

  // Windowed distances vs lifetime, for the "Distance by Window" bento panel.
  const lifetimeMax = totalDistance > 0 ? totalDistance : 1;
  const windowRows = useMemo(
    () => [
      { key: '7d', label: t('mileage.last7Days', 'Last 7 days'), value: last7d, color: palette[0] },
      { key: '30d', label: t('mileage.last30Days', 'Last 30 days'), value: last30d, color: palette[1] },
      { key: '365d', label: t('mileage.last365Days', 'Last 365 days'), value: last365d, color: palette[2] },
    ],
    [t, last7d, last30d, last365d, palette],
  );

  const activityItems = useMemo(
    () => [
      { label: t('mileage.firstDrive', 'First drive'), value: stats?.first_drive_at ? formatDate(stats.first_drive_at) : '—' },
      { label: t('mileage.lastDrive', 'Last drive'), value: stats?.last_drive_at ? formatDate(stats.last_drive_at) : '—' },
      { label: t('mileage.lifetimeDrives', 'Lifetime drives'), value: stats?.drive_count_lifetime != null ? fmtInt(totalDrives) : '—' },
      { label: t('mileage.drives30d', 'Drives (30d)'), value: stats?.drive_count_30d != null ? fmtInt(stats.drive_count_30d) : '—' },
    ],
    [t, stats?.first_drive_at, stats?.last_drive_at, stats?.drive_count_30d, totalDrives, fmtInt],
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
      { key: 'month', header: t('mileage.month', 'Month'), render: (r) => r.month, sortable: true, filterValue: (r) => r.month },
      { key: 'distance', header: `${t('mileage.distance', 'Distance')} (${distanceUnit})`, render: (r) => fmtNumber(r.distance), sortable: true, align: 'right' },
      { key: 'drives', header: t('mileage.drives', 'Drives'), render: (r) => fmtInt(r.drives), sortable: true, align: 'right', filterValue: (r) => r.drives, filterValueLabel: (_value, r) => fmtInt(r.drives) },
      { key: 'dailyAvg', header: `${t('mileage.distancePerDrive', 'Distance / drive')} (${distanceUnit})`, render: (r) => fmtNumber(r.dailyAvg), sortable: true, align: 'right' },
    ],
    [t, distanceUnit, fmtNumber, fmtInt],
  );

  // Defensive guard: no vehicle selected.
  if (vehicleId == null) {
    return <NoVehicleSelected pageTitle={t('mileage.title', 'Mileage')} />;
  }

  // One shared CardGrid observes the allocated canvas and supplies placement
  // to every card. No page-local canvas cap, observer or packing algorithm.
  const cards: CardGridItem[] = [
    {
      id: 'mileage-summary-card',
      size: 'full',
      content: (
        <LayoutCard title={t('mileage.kpis', 'Mileage summary metrics')}>
          <section aria-label={t('mileage.kpis', 'Mileage summary metrics')} className="min-w-0 space-y-3">
            <MileageSourceNotice source={statsSource} onRetry={() => statsQuery.refetch()} />
            {statsSource.fatalError ? (
              <QueryError error={statsQuery.error} onRetry={() => statsQuery.refetch()} />
            ) : (
              <MileageSummary stats={stats} loading={statsQuery.isLoading} retained={!!statsSource.refreshError} />
            )}
          </section>
        </LayoutCard>
      ),
    },
    {
      id: 'mileage-odometer-card',
      size: 'half',
      content: (
        <LayoutCard
          title={t('mileage.odometerOverTime', 'Odometer over time')}
          description={t('mileage.source.odometerPeriod', 'Daily source: trailing 90 days. Absolute end-of-day odometer readings; days without a reading are omitted. Recording completeness is unknown.')}
        >
            <MileageSourceNotice source={dailySource} onRetry={() => dailyQuery.refetch()} />
            {dailySource.fatalError ? (
              <QueryError error={dailyQuery.error} onRetry={() => dailyQuery.refetch()} />
            ) : dailyQuery.isLoading && !dailySource.hasData ? (
              <Skeleton height={288} />
            ) : odometerData.length === 0 ? (
              <EmptyState /* no-action: transient empty state — no odometer readings in the window */
                icon={<Gauge className="h-8 w-8" />}
                message={t('mileage.noOdometer', 'No odometer readings yet')}
              />
            ) : (
              <EmbeddedChart
                title={t('mileage.odometerOverTime', 'Odometer over time')}
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
        </LayoutCard>
      ),
    },
    {
      id: 'mileage-windows-card',
      size: 'half',
      content: (
        <LayoutCard
          title={t('mileage.distanceByWindow', 'Distance by window')}
          description={t('mileage.windows.method', 'Fixed trailing 7 / 30 / 365-day distances, scaled against recorded lifetime distance. First and last drive dates describe recorded activity, not guaranteed vehicle lifetime coverage.')}
        >
            <MileageSourceNotice source={statsSource} onRetry={() => statsQuery.refetch()} />
            {statsSource.fatalError ? (
              <QueryError error={statsQuery.error} onRetry={() => statsQuery.refetch()} />
            ) : statsQuery.isLoading && !statsSource.hasData ? (
              <Skeleton height={220} />
            ) : stats ? (
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
            ) : (
              <EmptyState message={t('mileage.summary.unavailable', 'Mileage summary has not been supplied.')} />
            )}
        </LayoutCard>
      ),
    },
    {
      id: 'mileage-daily-card',
      size: 'half',
      content: (
        <LayoutCard
          title={t('mileage.dailyDistance', 'Daily distance')}
          description={t('mileage.daily.period', 'Recorded daily drive distance from the trailing 90-day source. Dates use the existing date formatter. Recording completeness is unknown.')}
        >
            <MileageSourceNotice source={dailySource} onRetry={() => dailyQuery.refetch()} />
            {dailySource.fatalError ? (
              <QueryError error={dailyQuery.error} onRetry={() => dailyQuery.refetch()} />
            ) : dailyQuery.isLoading && !dailySource.hasData ? (
              <Skeleton height={288} />
            ) : dailyData.length === 0 ? (
              <EmptyState /* no-action: transient empty state — no daily distance in the window */
                icon={<BarChart3 className="h-8 w-8" />}
                message={t('mileage.noDaily', 'No daily distance yet')}
              />
            ) : (
              <EmbeddedChart
                title={t('mileage.dailyDistance', 'Daily distance')}
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
        </LayoutCard>
      ),
    },
    {
      id: 'mileage-monthly-card',
      size: 'half',
      content: (
        <LayoutCard
          title={t('mileage.monthlyDistance', 'Monthly distance')}
          description={t('mileage.monthly.period', 'UTC calendar-month buckets from the server’s default 24-month window. This is not a full-history total; recording completeness is unknown.')}
        >
            <MileageSourceNotice source={monthlySource} onRetry={() => monthlyQuery.refetch()} />
            {monthlySource.fatalError ? (
              <QueryError error={monthlyQuery.error} onRetry={() => monthlyQuery.refetch()} />
            ) : monthlyQuery.isLoading && !monthlySource.hasData ? (
              <Skeleton height={288} />
            ) : monthlyRows.length === 0 ? (
              <EmptyState /* no-action: transient empty state — no monthly distance in the window */
                icon={<BarChart3 className="h-8 w-8" />}
                message={t('mileage.noMonthly', 'No monthly distance yet')}
              />
            ) : (
              <EmbeddedChart
                title={t('mileage.monthlyDistance', 'Monthly distance')}
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
        </LayoutCard>
      ),
    },
    {
      id: 'mileage-monthly-table-card',
      size: 'full',
      content: (
        <LayoutCard
          title={t('mileage.monthlySummary', 'Monthly summary')}
          description={t('mileage.monthly.method', 'The same UTC monthly source as the chart. Distance / drive divides monthly recorded distance by monthly drive count; a zero drive count yields zero. No totals are inferred from these limited rows.')}
        >
          <MileageSourceNotice source={monthlySource} onRetry={() => monthlyQuery.refetch()} />
          {monthlySource.fatalError ? (
            <QueryError error={monthlyQuery.error} onRetry={() => monthlyQuery.refetch()} />
          ) : monthlyQuery.isLoading && !monthlySource.hasData ? (
            <Skeleton height={240} />
          ) : (
            <DataTable<MonthRow>
              enableValueFilters
              tableId="analytics:mileage-monthly"
              columns={monthColumns}
              mobileColumns={['month', 'distance', 'drives']}
              data={monthlyRows}
              keyExtractor={(r) => r.month}
              emptyMessage={t('mileage.noMonthly', 'No monthly distance yet')}
              compact
              pagination
            />
          )}
        </LayoutCard>
      ),
    },
  ];

  return (
    <PageLayout
      title={t('mileage.title', 'Mileage')}
      subtitle={t('mileage.subtitle', 'Daily and monthly distance tracking')}
      query={[statsQuery, dailyQuery, monthlyQuery]}
      dataSources={dataSources}
    >
      <FadeIn>
        <Section
          id="mileage-analysis"
          title={t('mileage.analysis.title', 'Recorded mileage')}
          description={t('mileage.analysis.scope', 'Vehicle scope comes from the workspace header. Mileage sources use their own fixed periods; they do not accept workspace date bounds.')}
        >
          <CardGrid items={cards} label={t('mileage.analysis.cards', 'Mileage metrics, charts and monthly detail')} />
        </Section>
      </FadeIn>
    </PageLayout>
  );
}
