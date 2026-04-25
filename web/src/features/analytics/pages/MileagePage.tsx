import { useState, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { Gauge, TrendingUp, Calendar, BarChart3, AlertCircle } from 'lucide-react';

import { PageContainer } from '@/components/layout';
import { GlassPanel, Select, DataTable, type Column } from '@/components/ui';
import { MetricCard } from '@/components/data-display';
import { Skeleton, EmptyState, AlertBanner } from '@/components/feedback';
import { getErrorMessage } from '@/lib/errorMessage';
import { FadeIn } from '@/components/motion';
import {
  ChartTooltip, CHART_COLORS,
  AreaChart, Area, BarChart, Bar, XAxis, YAxis,
  CartesianGrid, Tooltip, ResponsiveContainer,
} from '@/components/charts';

import { useVehicles } from '@/api/hooks/useVehicles';
import { usePageTitle } from '@/hooks/usePageTitle';
import { useSettings } from '@/hooks/useSettings';
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

  const [vehicleId, setVehicleId] = useState('');

  const { data: vehicles } = useVehicles();

  const activeId = vehicleId || String(vehicles?.[0]?.id ?? '');

  const { data: stats, isLoading, error: statsError } = useQuery<MileageStats>({
    queryKey: ['mileage-stats', activeId],
    queryFn: () => request<MileageStats>(`/mileage/stats?vehicle_id=${activeId}`),
    enabled: activeId !== '',
  });

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

  const vehicleOptions = (vehicles ?? []).map((v) => ({
    value: String(v.id),
    label: v.display_name || v.vin,
  }));

  const selector = vehicles && vehicles.length > 1 ? (
    <Select
      options={vehicleOptions}
      value={activeId}
      onChange={(e) => setVehicleId(e.target.value)}
      placeholder={t('Select Vehicle')}
    />
  ) : undefined;

  return (
    <PageContainer
      title={t('mileage.title', 'Mileage')}
      subtitle={t('mileage.subtitle', 'Daily and monthly distance tracking')}
      actions={selector}
      loading={isLoading}
      error={null}
    >
      {anyError && (
        <AlertBanner variant="danger" icon={<AlertCircle className="h-5 w-5" />}>
          {t('error.loadFailed', 'Failed to load data')}: {getErrorMessage(anyError)}
        </AlertBanner>
      )}

      {/* Summary metric cards */}
      <FadeIn>
        <div className={cn('grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6')}>
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
            <EmptyState message={t('No Entries')} />
          ) : (
            <ResponsiveContainer width="100%" height={280}>
              <AreaChart data={odometerData}>
                <defs>
                  <linearGradient id="odoGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor={CHART_COLORS[2]} stopOpacity={0.3} />
                    <stop offset="95%" stopColor={CHART_COLORS[2]} stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--glass-border)" />
                <XAxis dataKey="date" tick={{ fontSize: 10, fill: 'var(--text-muted)' }} />
                <YAxis tick={{ fontSize: 10, fill: 'var(--text-muted)' }} />
                <Tooltip content={<ChartTooltip />} />
                <Area
                  type="monotone"
                  dataKey="odometer"
                  stroke={CHART_COLORS[2]}
                  fill="url(#odoGrad)"
                  strokeWidth={2}
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
            <EmptyState message={t('No Entries')} />
          ) : (
            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={dailyData}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--glass-border)" />
                <XAxis dataKey="date" tick={{ fontSize: 10, fill: 'var(--text-muted)' }} />
                <YAxis tick={{ fontSize: 10, fill: 'var(--text-muted)' }} />
                <Tooltip content={<ChartTooltip />} />
                <Bar
                  dataKey="distance"
                  fill={CHART_COLORS[0]}
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
