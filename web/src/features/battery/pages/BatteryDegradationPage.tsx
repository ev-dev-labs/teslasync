import { useState, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import clsx from 'clsx';
import {
  Battery, TrendingDown, Zap, Thermometer,
  Shield, Activity, Calendar,
} from 'lucide-react';
import { PageContainer } from '@/components/layout/PageContainer';
import { GlassPanel } from '@/components/ui/GlassPanel';
import { Badge } from '@/components/ui/Badge';
import { Select } from '@/components/ui/Select';
import { DataTable, type Column } from '@/components/ui/DataTable';
import { MetricCard } from '@/components/data-display/MetricCard';
import { RadialGauge } from '@/components/charts/RadialGauge';
import { Skeleton } from '@/components/feedback/Skeleton';
import { EmptyState } from '@/components/feedback/EmptyState';
import { FadeIn } from '@/components/motion/FadeIn';
import {
  AreaChart, Area, LineChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, Legend, ReferenceLine,
} from '@/components/charts';
import { ChartTooltip } from '@/components/charts/ChartTooltip';
import { usePageTitle } from '@/hooks/usePageTitle';
import { formatDate } from '@/lib/dateFormat';
import { fmtNumber } from '@/lib/numberFormat';
import { CHART_COLORS } from '@/lib/colors';
import { request } from '@/api/client';

/* ── Types ─────────────────────────────────────────────── */

interface DegradationEntry {
  date: string;
  odometer: number;
  soh_pct: number;
  capacity_kwh: number;
  range_km: number;
}

interface BatteryHealth {
  current_soh: number;
  estimated_capacity: number;
  original_capacity: number;
  degradation_rate_yr: number;
  battery_age_months: number;
  total_cycles: number;
  avg_depth_of_discharge: number;
  fast_charge_pct: number;
  full_charge_pct: number;
  charge_habits_score: number;
  temp_exposure_score: number;
  history: DegradationEntry[];
}

interface Vehicle {
  id: number;
  vin: string;
  display_name: string;
}

/* ── Helpers ───────────────────────────────────────────── */

function sohColor(soh: number): string {
  if (soh > 90) return CHART_COLORS[1];
  if (soh >= 80) return CHART_COLORS[3];
  return '#ef4444';
}

function scoreVariant(score: number): 'success' | 'warning' | 'danger' {
  if (score >= 80) return 'success';
  if (score >= 50) return 'warning';
  return 'danger';
}

function ageLabel(
  months: number,
  t: (k: string, opts?: Record<string, unknown>) => string,
): string {
  if (months < 12) return t('{{count}} months', { count: months });
  const years = Math.floor(months / 12);
  const rem = months % 12;
  return rem > 0
    ? t('{{y}}y {{m}}m', { y: years, m: rem })
    : t('{{y}} years', { y: years });
}

/* ── Page ──────────────────────────────────────────────── */

export default function BatteryDegradationPage() {
  const { t } = useTranslation();
  usePageTitle(t('Battery Degradation'));

  /* Vehicle selector */
  const { data: vehicles } = useQuery<Vehicle[]>({
    queryKey: ['vehicles'],
    queryFn: () => request<Vehicle[]>('/vehicles'),
  });
  const [vehicleId, setVehicleId] = useState<number | null>(null);
  const activeId = vehicleId ?? vehicles?.[0]?.id ?? null;

  /* Battery health data */
  const { data, isLoading, error } = useQuery<BatteryHealth>({
    queryKey: ['battery-health', activeId],
    queryFn: () =>
      request<BatteryHealth>(
        `/analytics/battery-health?vehicle_id=${activeId}`,
      ),
    enabled: activeId !== null,
  });

  const noData = !isLoading && (!data || data.history.length === 0);

  /* Chart data */
  const trendData = useMemo(() => {
    if (!data?.history) return [];
    return data.history.map((h) => ({
      date: formatDate(h.date),
      soh: h.soh_pct,
      odometer: h.odometer,
    }));
  }, [data]);

  const rangeData = useMemo(() => {
    if (!data?.history || data.history.length === 0) return [];
    const originalRange = data.history[0].range_km;
    return data.history.map((h) => ({
      date: formatDate(h.date),
      original: originalRange,
      current: h.range_km,
    }));
  }, [data]);

  const cycleDepthScore = data
    ? Math.max(0, Math.round(100 - data.avg_depth_of_discharge))
    : 0;

  /* Table columns */
  const columns: Column<DegradationEntry>[] = useMemo(
    () => [
      {
        key: 'date',
        header: t('Date'),
        render: (row: DegradationEntry) => formatDate(row.date),
        sortable: true,
      },
      {
        key: 'odometer',
        header: t('Odometer'),
        render: (row: DegradationEntry) => `${fmtNumber(row.odometer)} km`,
        sortable: true,
      },
      {
        key: 'soh_pct',
        header: t('SOH %'),
        render: (row: DegradationEntry) => (
          <Badge
            variant={
              row.soh_pct > 90
                ? 'success'
                : row.soh_pct >= 80
                  ? 'warning'
                  : 'danger'
            }
          >
            {fmtNumber(row.soh_pct)}%
          </Badge>
        ),
        sortable: true,
      },
      {
        key: 'capacity_kwh',
        header: t('Capacity'),
        render: (row: DegradationEntry) =>
          `${fmtNumber(row.capacity_kwh)} kWh`,
        sortable: true,
      },
      {
        key: 'range_km',
        header: t('Range'),
        render: (row: DegradationEntry) => `${fmtNumber(row.range_km)} km`,
        sortable: true,
      },
    ],
    [t],
  );

  /* ── Render ──────────────────────────────────────────── */

  return (
    <PageContainer
      title={t('Battery Degradation')}
      subtitle={t('Health trends, degradation predictions, and charging habit impact')}
      loading={isLoading}
      error={error as Error | null}
      empty={noData}
      emptyMessage={t('Not enough data to display degradation trends.')}
      actions={
        vehicles && vehicles.length > 1 ? (
          <Select
            options={vehicles.map((v) => ({
              value: String(v.id),
              label: v.display_name || v.vin,
            }))}
            value={String(activeId ?? '')}
            onChange={(e) => setVehicleId(Number(e.target.value))}
          />
        ) : undefined
      }
    >
      {/* ── Summary Metrics ───────────────────────────── */}
      <FadeIn>
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <MetricCard
            label={t('Current SOH')}
            value={`${fmtNumber(data?.current_soh ?? 0)}%`}
            icon={<Battery className="h-4 w-4" />}
            color="green"
          />
          <MetricCard
            label={t('Estimated Capacity')}
            value={`${fmtNumber(data?.estimated_capacity ?? 0)} kWh`}
            icon={<Zap className="h-4 w-4" />}
            color="cyan"
          />
          <MetricCard
            label={t('Degradation Rate')}
            value={`${fmtNumber(data?.degradation_rate_yr ?? 0)}%/yr`}
            icon={<TrendingDown className="h-4 w-4" />}
            color="purple"
          />
          <MetricCard
            label={t('Battery Age')}
            value={data ? ageLabel(data.battery_age_months, t) : '—'}
            icon={<Calendar className="h-4 w-4" />}
          />
        </div>
      </FadeIn>

      {/* ── Health Gauge + Cycle Stats ────────────────── */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <FadeIn delay={0.05}>
          <GlassPanel className="flex flex-col items-center justify-center p-6">
            <RadialGauge
              value={data?.current_soh ?? 0}
              max={100}
              label={t('Battery Health')}
              unit="%"
              color={sohColor(data?.current_soh ?? 0)}
              size={180}
            />
            <div className="mt-3 flex items-center gap-2">
              <Badge
                variant={
                  (data?.current_soh ?? 0) > 90
                    ? 'success'
                    : (data?.current_soh ?? 0) >= 80
                      ? 'warning'
                      : 'danger'
                }
              >
                {(data?.current_soh ?? 0) > 90
                  ? t('Excellent')
                  : (data?.current_soh ?? 0) >= 80
                    ? t('Good')
                    : t('Degraded')}
              </Badge>
            </div>
          </GlassPanel>
        </FadeIn>

        <FadeIn delay={0.1}>
          <GlassPanel className="p-6">
            <div className={clsx('mb-4 flex items-center gap-2 text-sm font-semibold')}>
              <Activity className="h-4 w-4 text-neon-purple" />
              {t('Cycle Count & Depth')}
            </div>
            <div className="grid grid-cols-2 gap-4">
              <MetricCard
                label={t('Total Cycles')}
                value={fmtNumber(data?.total_cycles ?? 0)}
                color="cyan"
              />
              <MetricCard
                label={t('Avg Depth of Discharge')}
                value={`${fmtNumber(data?.avg_depth_of_discharge ?? 0)}%`}
                color="purple"
              />
            </div>
            <div className="mt-4 text-xs text-[var(--text-muted)]">
              {t('Original capacity')}:{' '}
              <span className="font-medium">
                {fmtNumber(data?.original_capacity ?? 0)} kWh
              </span>
            </div>
          </GlassPanel>
        </FadeIn>
      </div>

      {/* ── Degradation Over Time ─────────────────────── */}
      {trendData.length > 0 ? (
        <FadeIn delay={0.15}>
          <GlassPanel className="p-6">
            <div className="mb-4 text-sm font-semibold">
              {t('Degradation Over Time')}
            </div>
            <ResponsiveContainer width="100%" height={280}>
              <LineChart data={trendData}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--glass-border)" />
                <XAxis dataKey="date" tick={{ fill: 'var(--text-muted)', fontSize: 10 }} />
                <YAxis domain={[70, 100]} tick={{ fill: 'var(--text-muted)', fontSize: 10 }} />
                <Tooltip content={<ChartTooltip />} />
                <Legend />
                <ReferenceLine y={90} stroke={CHART_COLORS[3]} strokeDasharray="6 4" />
                <ReferenceLine y={80} stroke="#ef4444" strokeDasharray="6 4" />
                <Line
                  type="monotone"
                  dataKey="soh"
                  name={t('SOH %')}
                  stroke={CHART_COLORS[1]}
                  strokeWidth={2.5}
                  dot={{ fill: CHART_COLORS[1], r: 3 }}
                />
              </LineChart>
            </ResponsiveContainer>
          </GlassPanel>
        </FadeIn>
      ) : (
        <Skeleton height={280} />
      )}

      {/* ── Range Loss Chart ──────────────────────────── */}
      {rangeData.length > 0 ? (
        <FadeIn delay={0.2}>
          <GlassPanel className="p-6">
            <div className="mb-4 text-sm font-semibold">
              {t('Range Loss Over Time')}
            </div>
            <ResponsiveContainer width="100%" height={260}>
              <AreaChart data={rangeData}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--glass-border)" />
                <XAxis dataKey="date" tick={{ fill: 'var(--text-muted)', fontSize: 10 }} />
                <YAxis tick={{ fill: 'var(--text-muted)', fontSize: 10 }} />
                <Tooltip content={<ChartTooltip />} />
                <Legend />
                <defs>
                  <linearGradient id="origRange" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={CHART_COLORS[0]} stopOpacity={0.25} />
                    <stop offset="100%" stopColor={CHART_COLORS[0]} stopOpacity={0.02} />
                  </linearGradient>
                  <linearGradient id="curRange" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={CHART_COLORS[2]} stopOpacity={0.3} />
                    <stop offset="100%" stopColor={CHART_COLORS[2]} stopOpacity={0.02} />
                  </linearGradient>
                </defs>
                <Area
                  type="monotone"
                  dataKey="original"
                  name={t('Original Range')}
                  stroke={CHART_COLORS[0]}
                  fill="url(#origRange)"
                  strokeWidth={2}
                />
                <Area
                  type="monotone"
                  dataKey="current"
                  name={t('Current Range')}
                  stroke={CHART_COLORS[2]}
                  fill="url(#curRange)"
                  strokeWidth={2}
                />
              </AreaChart>
            </ResponsiveContainer>
          </GlassPanel>
        </FadeIn>
      ) : (
        <EmptyState
          icon={<Battery className="h-12 w-12" />}
          message={t('Range data will appear once history is available.')}
        />
      )}

      {/* ── Battery Health Factors ────────────────────── */}
      <FadeIn delay={0.25}>
        <GlassPanel className="p-6">
          <div className="mb-4 flex items-center gap-2 text-sm font-semibold">
            <Shield className="h-4 w-4 text-neon-amber" />
            {t('Battery Health Factors')}
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            {/* Charge habits */}
            <GlassPanel className="p-4">
              <div className="mb-2 flex items-center justify-between">
                <span className="text-xs font-medium">
                  {t('Charge Habits')}
                </span>
                <Badge variant={scoreVariant(data?.charge_habits_score ?? 0)} size="sm">
                  {fmtNumber(data?.charge_habits_score ?? 0)}/100
                </Badge>
              </div>
              <div className="space-y-1 text-xs text-[var(--text-muted)]">
                <div className="flex justify-between">
                  <span>{t('Fast Charge')}</span>
                  <span className="font-medium">{fmtNumber(data?.fast_charge_pct ?? 0)}%</span>
                </div>
                <div className="flex justify-between">
                  <span>{t('Full Charge')}</span>
                  <span className="font-medium">{fmtNumber(data?.full_charge_pct ?? 0)}%</span>
                </div>
              </div>
            </GlassPanel>

            {/* Temperature exposure */}
            <GlassPanel className="p-4">
              <div className="mb-2 flex items-center justify-between">
                <span className="text-xs font-medium">
                  {t('Temperature Exposure')}
                </span>
                <Badge variant={scoreVariant(data?.temp_exposure_score ?? 0)} size="sm">
                  {fmtNumber(data?.temp_exposure_score ?? 0)}/100
                </Badge>
              </div>
              <div className="flex items-center gap-2 text-xs text-[var(--text-muted)]">
                <Thermometer className="h-3 w-3" />
                {t('Lower is better for longevity')}
              </div>
            </GlassPanel>

            {/* Cycle depth */}
            <GlassPanel className="p-4">
              <div className="mb-2 flex items-center justify-between">
                <span className="text-xs font-medium">
                  {t('Cycle Depth')}
                </span>
                <Badge variant={scoreVariant(cycleDepthScore)} size="sm">
                  {fmtNumber(cycleDepthScore)}/100
                </Badge>
              </div>
              <div className="space-y-1 text-xs text-[var(--text-muted)]">
                <div className="flex justify-between">
                  <span>{t('Avg DoD')}</span>
                  <span className="font-medium">
                    {fmtNumber(data?.avg_depth_of_discharge ?? 0)}%
                  </span>
                </div>
              </div>
            </GlassPanel>
          </div>
        </GlassPanel>
      </FadeIn>

      {/* ── Degradation History Table ─────────────────── */}
      <FadeIn delay={0.3}>
        <GlassPanel className="p-6">
          <div className="mb-4 text-sm font-semibold">
            {t('Degradation History')}
          </div>
          {data?.history && data.history.length > 0 ? (
            <DataTable
              columns={columns}
              data={data.history}
              keyExtractor={(row: DegradationEntry) =>
                `${row.date}-${row.odometer}`
              }
              emptyMessage={t('No degradation records found.')}
              compact
            />
          ) : (
            <div className="flex flex-col items-center justify-center gap-2 py-8 text-[var(--text-muted)]">
              <Activity className="h-8 w-8 opacity-20" />
              <p className="text-xs">{t('common.noData', 'No data available')}</p>
            </div>
          )}
        </GlassPanel>
      </FadeIn>
    </PageContainer>
  );
}
