import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { Gauge, TrendingUp, Calendar, BarChart3, AlertCircle } from 'lucide-react';

import { PageContainer } from '@/components/layout';
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
import { useSettings } from '@/hooks/useSettings';
import { useChartPalette } from '@/hooks/useChartPalette';
import { formatDate } from '@/lib/dateFormat';
import { fmtNumber, fmtInt } from '@/lib/numberFormat';
import { cn } from '@/lib/cn';
import { request } from '@/api/client';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface MileageEntry {
  date: string;
  odometer: number;
  distance: number;
}

interface MileageStats {
  total_distance: number;
  avg_daily: number;
  max_daily: number;
  total_energy: number;
  total_drives: number;
  days_tracked: number;
}

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

  const { convertDistance, distanceUnit } = useSettings();

  // Phase-45/23 — reactive chart palette (CB-safe / neon per user pref).
  const palette = useChartPalette();

  // Phase 40 / Prompt 16: header VehiclePicker is the source of truth.
  const { vehicleId } = useSelectedVehicle();
  const activeId = vehicleId != null ? String(vehicleId) : '';

  const statsQuery = useQuery<MileageStats>({
    queryKey: ['mileage-stats', activeId],
    queryFn: () => request<MileageStats>(`/mileage/stats?vehicle_id=${activeId}`),
    enabled: activeId !== '',
  });
  const { data: stats, isLoading, error: statsError } = statsQuery;

  const { data: entries, error: entriesError } = useQuery<MileageEntry[]>({
    queryKey: ['mileage-entries', activeId],
    queryFn: () => request<MileageEntry[]>(`/mileage/daily?vehicle_id=${activeId}&limit=90`),
    enabled: activeId !== '',
  });

  const anyError = [statsError, entriesError].find(Boolean);

  /* Odometer over time (area chart) */
  const odometerData = useMemo(
    () => (entries ?? []).map((e) => ({ date: formatDate(e.date), odometer: convertDistance(e.odometer) })),
    [entries, convertDistance],
  );

  /* Daily distance (bar chart) */
  const dailyData = useMemo(
    () => (entries ?? []).map((e) => ({ date: formatDate(e.date), distance: convertDistance(e.distance) })),
    [entries, convertDistance],
  );

  /* Monthly summary rows */
  const monthlyRows: MonthRow[] = useMemo(() => {
    if (!entries?.length) return [];
    const map = new Map<string, { distance: number; drives: number }>();
    for (const e of entries) {
      const key = (e.date ?? '').slice(0, 7);
      const cur = map.get(key) ?? { distance: 0, drives: 0 };
      cur.distance += e.distance;
      cur.drives += 1;
      map.set(key, cur);
    }
    return [...map.entries()].map(([month, v]) => ({
      month,
      distance: convertDistance(v.distance),
      drives: v.drives,
      dailyAvg: v.drives > 0 ? convertDistance(v.distance / v.drives) : 0,
    }));
  }, [entries, convertDistance]);

  const monthColumns: Column<MonthRow>[] = useMemo(() => [
    { key: 'month', header: t('Month'), render: (r) => r.month, sortable: true },
    { key: 'distance', header: `${t('Distance')} (${distanceUnit})`, render: (r) => fmtNumber(r.distance), sortable: true },
    { key: 'drives', header: t('Drives'), render: (r) => fmtInt(r.drives), sortable: true },
    { key: 'dailyAvg', header: `${t('Daily Avg')} (${distanceUnit})`, render: (r) => fmtNumber(r.dailyAvg), sortable: true },
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
      actions={<DataFreshnessAuto query={statsQuery} />}
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
                  value={`${fmtInt(convertDistance(stats?.total_distance ?? 0))} ${distanceUnit}`}
                  icon={<Gauge className="h-4 w-4" />}
                  color="cyan"
                />
                <MetricCard
                  label={t('mileage.totalDrives', 'Total Drives')}
                  value={fmtInt(stats?.total_drives)}
                  icon={<TrendingUp className="h-4 w-4" />}
                  color="green"
                />
                <MetricCard
                  label={t('mileage.dailyAvg', 'Daily Avg')}
                  value={`${fmtNumber(convertDistance(stats?.avg_daily ?? 0))} ${distanceUnit}`}
                  icon={<Calendar className="h-4 w-4" />}
                  color="purple"
                />
                <MetricCard
                  label={t('mileage.annualProjection', 'Annual Projection')}
                  value={`${fmtInt(convertDistance((stats?.avg_daily ?? 0) * 365))} ${distanceUnit}`}
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
                <YAxis tick={{ fontSize: 10, fill: 'var(--text-muted)' }} />
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
