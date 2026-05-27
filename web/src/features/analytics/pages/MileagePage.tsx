import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Gauge, TrendingUp, Calendar, BarChart3, AlertCircle } from 'lucide-react';

import { PageContainer } from '@/components/layout';
import { VehicleSelect } from '@/components/forms';
import { GlassPanel, DataTable, type Column } from '@/components/ui';
import { MetricCard, DataFreshnessAuto } from '@/components/data-display';
import { Skeleton, EmptyState, AlertBanner } from '@/components/feedback';
import { getErrorMessage } from '@/lib/errorMessage';
import { FadeIn } from '@/components/motion';
import {
  ChartTooltip,
  AreaChart, Area, BarChart, Bar, XAxis, YAxis,
  CartesianGrid, Tooltip, ResponsiveContainer,
  AREA_DEFAULTS, areaGradient,
} from '@/components/charts';

import { usePageTitle } from '@/hooks/usePageTitle';
import { useSelectedVehicle } from '@/hooks/useSelectedVehicle';
import { NoVehicleSelected } from '@/features/onboarding/components/NoVehicleSelected';
import { useUnits } from '@/hooks/useUnits';
import { convertDistanceFromSI } from '@/lib/unitConversion';
import { useChartPalette } from '@/hooks/useChartPalette';
import { formatDate } from '@/lib/dateFormat';
import { fmtNumber, fmtInt } from '@/lib/numberFormat';
import { cn } from '@/lib/cn';
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
  // Backend `/mileage/{stats,daily,monthly}` returns SI kilometres
  // (Phase-43a / Prompt 0004 + Phase-43a / Prompt 0009 fix/misc-fixes).
  // `convertDistanceFromSI` expects SI meters — multiply km by 1000.
  const fromKm = (km: number) => convertDistanceFromSI(km * 1000, distanceUnit);

  // Phase-45/23 — reactive chart palette (CB-safe / neon per user pref).
  const palette = useChartPalette();

  // Phase 40 / Prompt 16: header VehiclePicker is the source of truth.
  const { vehicleId } = useSelectedVehicle();
  const activeId = vehicleId != null ? String(vehicleId) : '';

  const statsQuery = useMileageStats(activeId);
  const { data: stats, isLoading, error: statsError } = statsQuery;

  // 90 daily buckets matches the legacy `limit=90` query string the page
  // used before /mileage/daily was restored.
  const { data: dailyBuckets, error: dailyError } = useDailyMileage(activeId, 90);
  const dailyRows = useMemo(() => dailyBuckets ?? [], [dailyBuckets]);

  const { data: monthlyBuckets, error: monthlyError } = useMonthlyMileage(activeId);
  const monthlyData = useMemo(() => monthlyBuckets ?? [], [monthlyBuckets]);

  const anyError = [statsError, dailyError, monthlyError].find(Boolean);

  /* Summary metric derivations from /mileage/stats. The restored
     endpoint exposes lifetime + windowed rollups (lifetime_km,
     last_30d_km, drive_count_lifetime, …). Daily avg = last_30d_km / 30
     so it reflects recent activity rather than a lifetime-flat average
     that would understate current usage on long-tail histories. */
  const totalDistanceDisplay = fromKm(stats?.lifetime_km ?? 0);
  const totalDrives = stats?.drive_count_lifetime ?? 0;
  const dailyAvgKm = (stats?.last_30d_km ?? 0) / 30;
  const dailyAvgDisplay = fromKm(dailyAvgKm);
  const annualProjectionDisplay = fromKm(dailyAvgKm * 365);

  /* Odometer over time (area chart). Uses end_odometer_km — the
     absolute odometer reading at the end of the latest qualifying
     drive in each day. Days where every drive had a NULL odometer
     reading (rare; only on abnormally-ended drives) are filtered out
     so the line doesn't dive to zero. */
  const odometerData = useMemo(
    () =>
      dailyRows
        .filter((d) => d.end_odometer_km != null)
        .map((d) => ({
          date: formatDate(d.date),
          odometer: fromKm(d.end_odometer_km ?? 0),
        })),
    [dailyRows, fromKm],
  );

  /* Daily distance (bar chart). */
  const dailyData = useMemo(
    () =>
      dailyRows.map((d) => ({
        date: formatDate(d.date),
        distance: fromKm(d.total_km ?? 0),
      })),
    [dailyRows, fromKm],
  );

  /* Monthly summary rows derive from /mileage/monthly which already
     groups per UTC calendar month. */
  const monthlyRows: MonthRow[] = useMemo(() => {
    return monthlyData.map((m) => {
      const km = m.total_km ?? 0;
      const drives = m.drive_count ?? 0;
      return {
        month: m.year_month ?? '',
        distance: fromKm(km),
        drives,
        dailyAvg: drives > 0 ? fromKm(km / drives) : 0,
      };
    });
  }, [monthlyData, fromKm]);

  const monthColumns: Column<MonthRow>[] = useMemo(() => [
    { key: 'month', header: t('Month'), render: (r) => r.month, sortable: true },
    { key: 'distance', header: `${t('Distance')} (${distanceUnit})`, render: (r) => fmtNumber(r.distance), sortable: true },
    { key: 'drives', header: t('Drives'), render: (r) => fmtInt(r.drives), sortable: true },
    { key: 'dailyAvg', header: `${t('Distance per Drive')} (${distanceUnit})`, render: (r) => fmtNumber(r.dailyAvg), sortable: true },
  ], [t, distanceUnit]);

  // Defensive guard: no vehicle selected (Phase 40 / Prompt 18).
  if (vehicleId == null) {
    return <NoVehicleSelected pageTitle={t('mileage.title', 'Mileage')} />;
  }

  return (
    <PageContainer
      title={t('mileage.title', 'Mileage')}
      subtitle={t('mileage.subtitle', 'Daily and monthly distance tracking')}
      loading={isLoading}
      error={null}
      actions={
        <div className="flex flex-wrap items-center justify-end gap-3">
          <VehicleSelect />
          <DataFreshnessAuto query={statsQuery} />
        </div>
      }
    >
      {anyError && (
        <AlertBanner variant="danger" icon={<AlertCircle className="h-5 w-5" />}>
          {t('error.loadFailed', 'Failed to load data')}: {getErrorMessage(anyError)}
        </AlertBanner>
      )}

      {/* Summary metric cards */}
      <FadeIn>
        <div className={cn('grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6')}>
          {isLoading
            ? Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} height={96} className="rounded-xl" />
              ))
            : (
              <>
                <MetricCard
                  label={t('mileage.totalDistance', 'Total Distance')}
                  value={`${fmtInt(totalDistanceDisplay)} ${distanceUnit}`}
                  icon={<Gauge className="h-4 w-4" />}
                  color="cyan"
                />
                <MetricCard
                  label={t('mileage.totalDrives', 'Total Drives')}
                  value={fmtInt(totalDrives)}
                  icon={<TrendingUp className="h-4 w-4" />}
                  color="green"
                />
                <MetricCard
                  label={t('mileage.dailyAvg', 'Daily Avg (30d)')}
                  value={`${fmtNumber(dailyAvgDisplay)} ${distanceUnit}`}
                  icon={<Calendar className="h-4 w-4" />}
                  color="purple"
                />
                <MetricCard
                  label={t('mileage.annualProjection', 'Annual Projection')}
                  value={`${fmtInt(annualProjectionDisplay)} ${distanceUnit}`}
                  icon={<BarChart3 className="h-4 w-4" />}
                  color="cyan"
                />
              </>
            )}
        </div>
      </FadeIn>

      {/* Odometer over time */}
      <FadeIn delay={0.1}>
        <GlassPanel className="mb-6 p-4">
          <p className="text-sm font-semibold mb-3 text-[var(--text-primary)]">
            {t('Odometer Over Time')}
          </p>
          {odometerData.length === 0 ? (
            <EmptyState /* no-action: transient empty state — surfaces when source data is missing; no specific recovery action available */ message={t('No Entries')} />
          ) : (
            <ResponsiveContainer width="100%" height={280}>
              <AreaChart data={odometerData}>
                {areaGradient('odoGrad', palette[2])}
                <CartesianGrid strokeDasharray="3 3" stroke="var(--glass-border)" />
                <XAxis dataKey="date" tick={{ fontSize: 10, fill: 'var(--text-muted)' }} />
                <YAxis tick={{ fontSize: 10, fill: 'var(--text-muted)' }} domain={['auto', 'auto']} />
                <Tooltip content={<ChartTooltip />} />
                <Area
                  {...AREA_DEFAULTS}
                  dataKey="odometer"
                  stroke={palette[2]}
                  fill="url(#odoGrad)"
                  name={`${t('Odometer')} (${distanceUnit})`}
                />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </GlassPanel>
      </FadeIn>

      {/* Daily distance */}
      <FadeIn delay={0.2}>
        <GlassPanel className="mb-6 p-4">
          <p className="text-sm font-semibold mb-3 text-[var(--text-primary)]">
            {t('Daily Distance')}
          </p>
          {dailyData.length === 0 ? (
            <EmptyState /* no-action: transient empty state — surfaces when source data is missing; no specific recovery action available */ message={t('No Entries')} />
          ) : (
            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={dailyData}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--glass-border)" />
                <XAxis dataKey="date" tick={{ fontSize: 10, fill: 'var(--text-muted)' }} />
                <YAxis tick={{ fontSize: 10, fill: 'var(--text-muted)' }} />
                <Tooltip content={<ChartTooltip />} />
                <Bar
                  dataKey="distance"
                  fill={palette[0]}
                  radius={[4, 4, 0, 0]}
                  name={`${t('Distance')} (${distanceUnit})`}
                />
              </BarChart>
            </ResponsiveContainer>
          )}
        </GlassPanel>
      </FadeIn>

      {/* Monthly summary table */}
      <FadeIn delay={0.3}>
        <GlassPanel className="p-4">
          <p className="text-sm font-semibold mb-3 text-[var(--text-primary)]">
            {t('Monthly Summary')}
          </p>
          <DataTable<MonthRow>
            tableId="analytics:mileage-monthly"
            columns={monthColumns}
            data={monthlyRows}
            keyExtractor={(r) => r.month}
            emptyMessage={t('No Entries')}
            compact
            pagination
          />
        </GlassPanel>
      </FadeIn>
    </PageContainer>
  );
}
