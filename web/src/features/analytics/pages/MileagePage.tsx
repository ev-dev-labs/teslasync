import { useState, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { Gauge, TrendingUp, Calendar, BarChart3 } from 'lucide-react';

import { PageContainer } from '@/components/layout';
import { GlassPanel, Select, DataTable, type Column } from '@/components/ui';
import { MetricCard } from '@/components/data-display';
import { Skeleton, EmptyState } from '@/components/feedback';
import { FadeIn } from '@/components/motion';
import {
  ChartTooltip, CHART_COLORS,
  AreaChart, Area, BarChart, Bar, XAxis, YAxis,
  CartesianGrid, Tooltip, ResponsiveContainer,
} from '@/components/charts';

import { useVehicles } from '@/api/hooks/useVehicles';
import { usePageTitle } from '@/hooks/usePageTitle';
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
  current_odometer: number;
  month_distance: number;
  daily_avg: number;
  annual_projection: number;
  entries: MileageEntry[];
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

  const [vehicleId, setVehicleId] = useState('');

  const { data: vehicles } = useVehicles();

  const activeId = vehicleId || String(vehicles?.[0]?.id ?? '');

  const { data: stats, isLoading } = useQuery<MileageStats>({
    queryKey: ['mileage-stats', activeId],
    queryFn: () => request<MileageStats>(`/mileage/stats?vehicle_id=${activeId}`),
    enabled: activeId !== '',
  });

  const { data: entries } = useQuery<MileageEntry[]>({
    queryKey: ['mileage-entries', activeId],
    queryFn: () => request<MileageEntry[]>(`/mileage/daily?vehicle_id=${activeId}&limit=90`),
    enabled: activeId !== '',
  });

  /* Odometer over time (area chart) */
  const odometerData = useMemo(
    () => (entries ?? []).map((e) => ({ date: formatDate(e.date), odometer: e.odometer })),
    [entries],
  );

  /* Daily distance (bar chart) */
  const dailyData = useMemo(
    () => (entries ?? []).map((e) => ({ date: formatDate(e.date), distance: e.distance })),
    [entries],
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
      distance: v.distance,
      drives: v.drives,
      dailyAvg: v.drives > 0 ? v.distance / v.drives : 0,
    }));
  }, [entries]);

  const monthColumns: Column<MonthRow>[] = useMemo(() => [
    { key: 'month', header: t('Month'), render: (r) => r.month, sortable: true },
    { key: 'distance', header: t('Distance'), render: (r) => fmtNumber(r.distance), sortable: true },
    { key: 'drives', header: t('Drives'), render: (r) => fmtInt(r.drives), sortable: true },
    { key: 'dailyAvg', header: t('Daily Avg'), render: (r) => fmtNumber(r.dailyAvg), sortable: true },
  ], [t]);

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
      title={t('Mileage')}
      subtitle={t('Mileage Subtitle')}
      actions={selector}
      loading={isLoading}
      error={null}
    >
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
                  label={t('Current Odometer')}
                  value={fmtInt(stats?.current_odometer)}
                  icon={<Gauge className="h-4 w-4" />}
                  color="cyan"
                />
                <MetricCard
                  label={t('Month Distance')}
                  value={fmtInt(stats?.month_distance)}
                  icon={<TrendingUp className="h-4 w-4" />}
                  color="green"
                />
                <MetricCard
                  label={t('Daily Avg')}
                  value={fmtNumber(stats?.daily_avg)}
                  icon={<Calendar className="h-4 w-4" />}
                  color="purple"
                />
                <MetricCard
                  label={t('Annual Projection')}
                  value={fmtInt(stats?.annual_projection)}
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
                  name={t('Odometer')}
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
                  name={t('Distance')}
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
          />
        </GlassPanel>
      </FadeIn>
    </PageContainer>
  );
}
