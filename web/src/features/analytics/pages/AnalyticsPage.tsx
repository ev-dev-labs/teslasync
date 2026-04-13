import { useState, useMemo, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import clsx from 'clsx';
import {
  Car,
  Zap,
  MapPin,
  BarChart3,
  Battery,
  DollarSign,
  TrendingUp,
  Gauge,
  Leaf,
  Calendar,
  ArrowRight,
  Activity,
  Fuel,
  Clock,
} from 'lucide-react';

import { PageContainer } from '@/components/layout/PageContainer';
import { GlassPanel } from '@/components/ui/GlassPanel';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Select } from '@/components/ui/Select';
import { TabNav } from '@/components/ui/TabNav';
import { MetricCard } from '@/components/data-display/MetricCard';
import { AnimatedNumber } from '@/components/data-display/AnimatedNumber';
import { RadialGauge } from '@/components/charts/RadialGauge';
import { Skeleton } from '@/components/feedback/Skeleton';
import { EmptyState } from '@/components/feedback/EmptyState';
import { FadeIn } from '@/components/motion/FadeIn';
import { ChartTooltip } from '@/components/charts/ChartTooltip';
import {
  BarChart,
  Bar,
  LineChart,
  Line,
  AreaChart,
  Area,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from '@/components/charts';
import {
  chartGrid,
  axisTick,
  chartMargin,
  chartMarginLabeled,
  chartAnimation,
} from '@/components/charts';

import { usePageTitle } from '@/hooks/usePageTitle';
import { formatDate } from '@/lib/dateFormat';
import { fmtNumber, fmtInt } from '@/lib/numberFormat';
import { CHART_COLORS } from '@/lib/colors';
import { request } from '@/api/client';

/* ─── Types ──────────────────────────────────────────────────────── */

interface DailyDriving {
  date: string;
  distance: number;
  efficiency: number;
}

interface DistributionEntry {
  category: string;
  distance: number;
}

interface DrivingData {
  total_distance: number;
  total_drives: number;
  avg_distance: number;
  avg_efficiency: number;
  daily: DailyDriving[];
  distribution: DistributionEntry[];
}

interface DailyCharging {
  date: string;
  energy: number;
  cost: number;
}

interface AcDcEntry {
  type: string;
  count: number;
}

interface ChargingData {
  total_sessions: number;
  total_energy: number;
  avg_charge: number;
  total_cost: number;
  daily: DailyCharging[];
  ac_dc_split: AcDcEntry[];
}

interface MonthlyOverview {
  month: string;
  distance: number;
  energy: number;
  cost: number;
}

interface OverviewData {
  distance: number;
  energy: number;
  cost: number;
  co2_saved: number;
  drives: number;
  charges: number;
  monthly: MonthlyOverview[];
  efficiency: number;
  efficiency_target: number;
}

interface AnalyticsData {
  driving: DrivingData;
  charging: ChargingData;
  overview: OverviewData;
}

interface Vehicle {
  id: number;
  vin: string;
  display_name: string;
}

/* ─── Constants ──────────────────────────────────────────────────── */

type TimeRange = '7' | '30' | '90' | '365' | 'all';

const TIME_RANGES: { value: TimeRange; labelKey: string }[] = [
  { value: '7', labelKey: 'analytics.range.7d' },
  { value: '30', labelKey: 'analytics.range.30d' },
  { value: '90', labelKey: 'analytics.range.90d' },
  { value: '365', labelKey: 'analytics.range.365d' },
  { value: 'all', labelKey: 'analytics.range.all' },
];

const TAB_KEYS = ['driving', 'charging', 'overview'] as const;
type TabKey = (typeof TAB_KEYS)[number];

const PIE_COLORS = [CHART_COLORS[0], CHART_COLORS[1], CHART_COLORS[2], CHART_COLORS[3]];

/* ─── Quick-link targets ─────────────────────────────────────────── */

interface QuickLink {
  labelKey: string;
  href: string;
  icon: React.ReactNode;
}

const QUICK_LINKS: QuickLink[] = [
  { labelKey: 'analytics.links.statistics', href: '/analytics/statistics', icon: <BarChart3 className="h-4 w-4" /> },
  { labelKey: 'analytics.links.compare', href: '/analytics/compare', icon: <Activity className="h-4 w-4" /> },
  { labelKey: 'analytics.links.weeklyDigest', href: '/analytics/weekly-digest', icon: <Calendar className="h-4 w-4" /> },
  { labelKey: 'analytics.links.mileage', href: '/analytics/mileage', icon: <MapPin className="h-4 w-4" /> },
  { labelKey: 'analytics.links.timeline', href: '/analytics/timeline', icon: <Clock className="h-4 w-4" /> },
];

/* ─── Skeleton helpers ───────────────────────────────────────────── */

function MetricSkeleton() {
  return (
    <GlassPanel className="p-3">
      <Skeleton width="60%" height={12} />
      <Skeleton width="40%" height={24} className="mt-2" />
    </GlassPanel>
  );
}

function ChartSkeletonBlock({ className }: { className?: string }) {
  return (
    <GlassPanel className={clsx('p-4', className)}>
      <Skeleton width="30%" height={14} />
      <Skeleton width="100%" height={220} className="mt-3" rounded />
    </GlassPanel>
  );
}

/* ─── Main Component ─────────────────────────────────────────────── */

export default function AnalyticsPage() {
  const { t } = useTranslation();
  usePageTitle(t('Title'));

  const [vehicleId, setVehicleId] = useState<string>('');
  const [days, setDays] = useState<TimeRange>('30');
  const [activeTab, setActiveTab] = useState<TabKey>('driving');

  /* Vehicles */
  const vehiclesQuery = useQuery({
    queryKey: ['vehicles'],
    queryFn: () => request<Vehicle[]>('/vehicles'),
  });

  const vehicleOptions = useMemo(
    () =>
      (vehiclesQuery.data ?? []).map((v) => ({
        value: String(v.id),
        label: v.display_name || v.vin,
      })),
    [vehiclesQuery.data],
  );

  /* Select first vehicle when list loads */
  const selectedVehicleId = vehicleId || vehicleOptions[0]?.value || '';

  /* Analytics data */
  const daysParam = days === 'all' ? '0' : days;
  const analyticsQuery = useQuery({
    queryKey: ['analytics', selectedVehicleId, daysParam],
    queryFn: () =>
      request<AnalyticsData>(
        `/analytics?vehicle_id=${selectedVehicleId}&days=${daysParam}`,
      ),
    enabled: !!selectedVehicleId,
  });

  const data = analyticsQuery.data;
  const isLoading = analyticsQuery.isLoading || vehiclesQuery.isLoading;

  const handleVehicleChange = useCallback(
    (e: React.ChangeEvent<HTMLSelectElement>) => setVehicleId(e.target.value),
    [],
  );

  /* Tab definitions */
  const tabs = useMemo(
    () => [
      { key: 'driving' as const, label: t('Driving'), icon: <Car className="h-4 w-4" /> },
      { key: 'charging' as const, label: t('Charging'), icon: <Zap className="h-4 w-4" /> },
      { key: 'overview' as const, label: t('Overview'), icon: <BarChart3 className="h-4 w-4" /> },
    ],
    [t],
  );

  /* ─── Header actions ────────────────────────────────────────────── */

  const headerActions = (
    <div className="flex flex-wrap items-center gap-3">
      <Select
        options={vehicleOptions}
        value={selectedVehicleId}
        onChange={handleVehicleChange}
        placeholder={t('Select Vehicle')}
        className="w-44"
      />
      <div className="flex items-center gap-1">
        {TIME_RANGES.map((r) => (
          <Button
            key={r.value}
            variant={days === r.value ? 'primary' : 'ghost'}
            size="sm"
            onClick={() => setDays(r.value)}
          >
            {t(r.labelKey)}
          </Button>
        ))}
      </div>
    </div>
  );

  /* ─── Render ────────────────────────────────────────────────────── */

  return (
    <PageContainer
      title={t('Title')}
      subtitle={t('Subtitle')}
      actions={headerActions}
      loading={isLoading}
      error={analyticsQuery.error as Error | null}
      empty={!data && !isLoading}
      emptyMessage={t('Empty')}
    >
      <TabNav tabs={tabs} active={activeTab} onChange={(k) => setActiveTab(k as TabKey)} />

      {activeTab === 'driving' && (
        <DrivingTab data={data?.driving} isLoading={isLoading} />
      )}

      {activeTab === 'charging' && (
        <ChargingTab data={data?.charging} isLoading={isLoading} />
      )}

      {activeTab === 'overview' && (
        <OverviewTab data={data?.overview} isLoading={isLoading} />
      )}
    </PageContainer>
  );
}

/* ═══════════════════════════════════════════════════════════════════
   Tab 1 — Driving
   ═══════════════════════════════════════════════════════════════════ */

interface DrivingTabProps {
  data: DrivingData | undefined;
  isLoading: boolean;
}

function DrivingTab({ data, isLoading }: DrivingTabProps) {
  const { t } = useTranslation();
  if (isLoading) {
    return (
      <div className="space-y-4 mt-4">
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <MetricSkeleton key={i} />
          ))}
        </div>
        <ChartSkeletonBlock className="h-72" />
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <ChartSkeletonBlock className="h-72" />
          <ChartSkeletonBlock className="h-72" />
        </div>
      </div>
    );
  }

  if (!data) {
    return <EmptyState message={t('Empty')} icon={<Car className="h-10 w-10" />} />;
  }

  return (
    <FadeIn className="space-y-4 mt-4">
      {/* Summary cards */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <MetricCard
          label={t('Total Distance')}
          value={fmtNumber(data.total_distance, 1)}
          subtitle="km"
          icon={<MapPin className="h-4 w-4" />}
          color="cyan"
        />
        <MetricCard
          label={t('Total Drives')}
          value={fmtInt(data.total_drives)}
          icon={<Car className="h-4 w-4" />}
          color="green"
        />
        <MetricCard
          label={t('Avg Distance')}
          value={fmtNumber(data.avg_distance, 1)}
          subtitle="km"
          icon={<TrendingUp className="h-4 w-4" />}
          color="purple"
        />
        <MetricCard
          label={t('Avg Efficiency')}
          value={fmtNumber(data.avg_efficiency, 1)}
          subtitle="Wh/km"
          icon={<Gauge className="h-4 w-4" />}
          color="amber"
        />
      </div>

      {/* Daily distance chart */}
      <GlassPanel className="p-4">
        <div className="mb-3 flex items-center justify-between">
          <span className="text-sm font-semibold text-[var(--text-primary)]">
            {t('Daily Distance')}
          </span>
          <Badge variant="info" size="sm">
            {t('Distance Unit')}
          </Badge>
        </div>
        <ResponsiveContainer width="100%" height={260}>
          <BarChart data={data.daily} margin={chartMarginLabeled} {...chartAnimation}>
            {chartGrid}
            <XAxis
              dataKey="date"
              tick={axisTick}
              tickFormatter={(v: string) => formatDate(v)}
            />
            <YAxis tick={axisTick} />
            <Tooltip content={<ChartTooltip />} />
            <Bar dataKey="distance" name={t('Distance')} fill={CHART_COLORS[0]} radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </GlassPanel>

      {/* Efficiency trend + Distribution */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {/* Efficiency trend */}
        <GlassPanel className="p-4">
          <span className="text-sm font-semibold text-[var(--text-primary)]">
            {t('Efficiency Trend')}
          </span>
          <ResponsiveContainer width="100%" height={240} className="mt-2">
            <LineChart data={data.daily} margin={chartMargin} {...chartAnimation}>
              {chartGrid}
              <XAxis
                dataKey="date"
                tick={axisTick}
                tickFormatter={(v: string) => formatDate(v)}
              />
              <YAxis tick={axisTick} />
              <Tooltip content={<ChartTooltip />} />
              <Line
                type="monotone"
                dataKey="efficiency"
                name={t('Efficiency')}
                stroke={CHART_COLORS[1]}
                strokeWidth={2}
                dot={false}
              />
            </LineChart>
          </ResponsiveContainer>
        </GlassPanel>

        {/* Distance distribution */}
        <GlassPanel className="p-4">
          <span className="text-sm font-semibold text-[var(--text-primary)]">
            {t('Distribution')}
          </span>
          <ResponsiveContainer width="100%" height={240} className="mt-2">
            <PieChart>
              <Pie
                data={data.distribution}
                dataKey="distance"
                nameKey="category"
                cx="50%"
                cy="50%"
                outerRadius={90}
                innerRadius={50}
                paddingAngle={3}
                label={({ category }: DistributionEntry) => category}
              >
                {data.distribution.map((_, idx) => (
                  <Cell key={idx} fill={PIE_COLORS[idx % PIE_COLORS.length]} />
                ))}
              </Pie>
              <Tooltip content={<ChartTooltip />} />
              <Legend />
            </PieChart>
          </ResponsiveContainer>
        </GlassPanel>
      </div>
    </FadeIn>
  );
}

/* ═══════════════════════════════════════════════════════════════════
   Tab 2 — Charging
   ═══════════════════════════════════════════════════════════════════ */

interface ChargingTabProps {
  data: ChargingData | undefined;
  isLoading: boolean;
}

function ChargingTab({ data, isLoading }: ChargingTabProps) {
  const { t } = useTranslation();
  if (isLoading) {
    return (
      <div className="space-y-4 mt-4">
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <MetricSkeleton key={i} />
          ))}
        </div>
        <ChartSkeletonBlock className="h-72" />
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <ChartSkeletonBlock className="h-72" />
          <ChartSkeletonBlock className="h-72" />
        </div>
      </div>
    );
  }

  if (!data) {
    return <EmptyState message={t('Empty')} icon={<Zap className="h-10 w-10" />} />;
  }

  return (
    <FadeIn className="space-y-4 mt-4">
      {/* Summary cards */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <MetricCard
          label={t('Total Sessions')}
          value={fmtInt(data.total_sessions)}
          icon={<Zap className="h-4 w-4" />}
          color="cyan"
        />
        <MetricCard
          label={t('Total Energy')}
          value={fmtNumber(data.total_energy, 1)}
          subtitle="kWh"
          icon={<Battery className="h-4 w-4" />}
          color="green"
        />
        <MetricCard
          label={t('Avg Charge')}
          value={fmtNumber(data.avg_charge, 1)}
          subtitle="kWh"
          icon={<Fuel className="h-4 w-4" />}
          color="purple"
        />
        <MetricCard
          label={t('Total Cost')}
          value={fmtNumber(data.total_cost, 2)}
          subtitle="$"
          icon={<DollarSign className="h-4 w-4" />}
          color="amber"
        />
      </div>

      {/* Daily energy chart */}
      <GlassPanel className="p-4">
        <div className="mb-3 flex items-center justify-between">
          <span className="text-sm font-semibold text-[var(--text-primary)]">
            {t('Daily Energy')}
          </span>
          <Badge variant="info" size="sm">kWh</Badge>
        </div>
        <ResponsiveContainer width="100%" height={260}>
          <BarChart data={data.daily} margin={chartMarginLabeled} {...chartAnimation}>
            {chartGrid}
            <XAxis
              dataKey="date"
              tick={axisTick}
              tickFormatter={(v: string) => formatDate(v)}
            />
            <YAxis tick={axisTick} />
            <Tooltip content={<ChartTooltip />} />
            <Bar dataKey="energy" name={t('Energy')} fill={CHART_COLORS[1]} radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </GlassPanel>

      {/* Charge rate distribution + AC vs DC */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {/* Cost breakdown as area chart */}
        <GlassPanel className="p-4">
          <span className="text-sm font-semibold text-[var(--text-primary)]">
            {t('Cost Breakdown')}
          </span>
          <ResponsiveContainer width="100%" height={240} className="mt-2">
            <AreaChart data={data.daily} margin={chartMargin} {...chartAnimation}>
              {chartGrid}
              <XAxis
                dataKey="date"
                tick={axisTick}
                tickFormatter={(v: string) => formatDate(v)}
              />
              <YAxis tick={axisTick} />
              <Tooltip content={<ChartTooltip />} />
              <defs>
                <linearGradient id="costGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor={CHART_COLORS[3]} stopOpacity={0.4} />
                  <stop offset="95%" stopColor={CHART_COLORS[3]} stopOpacity={0} />
                </linearGradient>
              </defs>
              <Area
                type="monotone"
                dataKey="cost"
                name={t('Cost')}
                stroke={CHART_COLORS[3]}
                fill="url(#costGradient)"
                strokeWidth={2}
              />
            </AreaChart>
          </ResponsiveContainer>
        </GlassPanel>

        {/* AC vs DC pie */}
        <GlassPanel className="p-4">
          <span className="text-sm font-semibold text-[var(--text-primary)]">
            {t('Ac Vs Dc')}
          </span>
          <ResponsiveContainer width="100%" height={240} className="mt-2">
            <PieChart>
              <Pie
                data={data.ac_dc_split}
                dataKey="count"
                nameKey="type"
                cx="50%"
                cy="50%"
                outerRadius={90}
                innerRadius={50}
                paddingAngle={4}
                label={({ type }: AcDcEntry) => type}
              >
                {data.ac_dc_split.map((_, idx) => (
                  <Cell key={idx} fill={PIE_COLORS[idx % PIE_COLORS.length]} />
                ))}
              </Pie>
              <Tooltip content={<ChartTooltip />} />
              <Legend />
            </PieChart>
          </ResponsiveContainer>
        </GlassPanel>
      </div>
    </FadeIn>
  );
}

/* ═══════════════════════════════════════════════════════════════════
   Tab 3 — Overview
   ═══════════════════════════════════════════════════════════════════ */

interface OverviewTabProps {
  data: OverviewData | undefined;
  isLoading: boolean;
}

function OverviewTab({ data, isLoading }: OverviewTabProps) {
  const { t } = useTranslation();
  if (isLoading) {
    return (
      <div className="space-y-4 mt-4">
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
          {Array.from({ length: 6 }).map((_, i) => (
            <MetricSkeleton key={i} />
          ))}
        </div>
        <ChartSkeletonBlock className="h-80" />
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          <ChartSkeletonBlock className="h-64" />
          <ChartSkeletonBlock className="lg:col-span-2 h-64" />
        </div>
      </div>
    );
  }

  if (!data) {
    return <EmptyState message={t('Empty')} icon={<BarChart3 className="h-10 w-10" />} />;
  }

  return (
    <FadeIn className="space-y-4 mt-4">
      {/* Key metrics row */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
        <MetricCard
          label={t('Distance')}
          value={fmtNumber(data.distance, 1)}
          subtitle="km"
          icon={<MapPin className="h-4 w-4" />}
          color="cyan"
        />
        <MetricCard
          label={t('Energy')}
          value={fmtNumber(data.energy, 1)}
          subtitle="kWh"
          icon={<Zap className="h-4 w-4" />}
          color="green"
        />
        <MetricCard
          label={t('Cost')}
          value={fmtNumber(data.cost, 2)}
          subtitle="$"
          icon={<DollarSign className="h-4 w-4" />}
          color="amber"
        />
        <MetricCard
          label={t('analytics.overview.co2Saved', 'Co2Saved')}
          value={fmtNumber(data.co2_saved, 1)}
          subtitle="kg"
          icon={<Leaf className="h-4 w-4" />}
          color="green"
        />
        <MetricCard
          label={t('Drives')}
          value={fmtInt(data.drives)}
          icon={<Car className="h-4 w-4" />}
          color="purple"
        />
        <MetricCard
          label={t('Charges')}
          value={fmtInt(data.charges)}
          icon={<Battery className="h-4 w-4" />}
          color="blue"
        />
      </div>

      {/* Monthly comparison chart */}
      <GlassPanel className="p-4">
        <div className="mb-3 flex items-center justify-between">
          <span className="text-sm font-semibold text-[var(--text-primary)]">
            {t('Monthly Comparison')}
          </span>
          <div className="flex items-center gap-2">
            <Badge variant="info" size="sm">{t('Distance')}</Badge>
            <Badge variant="success" size="sm">{t('Energy')}</Badge>
            <Badge variant="warning" size="sm">{t('Cost')}</Badge>
          </div>
        </div>
        <ResponsiveContainer width="100%" height={300}>
          <BarChart data={data.monthly} margin={chartMarginLabeled} {...chartAnimation}>
            {chartGrid}
            <XAxis dataKey="month" tick={axisTick} />
            <YAxis tick={axisTick} />
            <Tooltip content={<ChartTooltip />} />
            <Legend />
            <Bar dataKey="distance" name={t('Distance')} fill={CHART_COLORS[0]} radius={[3, 3, 0, 0]} />
            <Bar dataKey="energy" name={t('Energy')} fill={CHART_COLORS[1]} radius={[3, 3, 0, 0]} />
            <Bar dataKey="cost" name={t('Cost')} fill={CHART_COLORS[3]} radius={[3, 3, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </GlassPanel>

      {/* Efficiency gauge + Quick links */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        {/* Radial gauge */}
        <GlassPanel className="flex flex-col items-center justify-center p-6">
          <span className="mb-4 text-sm font-semibold text-[var(--text-primary)]">
            {t('Efficiency Gauge')}
          </span>
          <RadialGauge
            value={Math.round(data.efficiency)}
            max={Math.round(data.efficiency_target * 1.5)}
            label={t('Efficiency')}
            unit=" Wh/km"
            color={CHART_COLORS[1]}
            size={160}
          />
          <div className="mt-4 flex items-center gap-2 text-xs text-[var(--text-muted)]">
            <span>{t('Target')}:</span>
            <AnimatedNumber value={data.efficiency_target} decimals={0} suffix=" Wh/km" className="font-semibold text-[var(--text-primary)]" />
          </div>
          <Badge
            variant={data.efficiency <= data.efficiency_target ? 'success' : 'warning'}
            size="sm"
            className="mt-2"
          >
            {data.efficiency <= data.efficiency_target
              ? t('On Target')
              : t('Above Target')}
          </Badge>
        </GlassPanel>

        {/* Quick links */}
        <GlassPanel className="p-4 lg:col-span-2">
          <span className="mb-3 block text-sm font-semibold text-[var(--text-primary)]">
            {t('Quick Links')}
          </span>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {QUICK_LINKS.map((link) => (
              <GlassPanel
                key={link.href}
                hover
                glow="cyan"
                className="flex items-center gap-3 p-3 cursor-pointer"
                onClick={() => {
                  window.location.href = link.href;
                }}
                role="link"
              >
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-white/[0.06]">
                  {link.icon}
                </div>
                <span className="flex-1 text-sm font-medium text-[var(--text-primary)]">
                  {t(link.labelKey)}
                </span>
                <ArrowRight className="h-3.5 w-3.5 text-[var(--text-muted)]" />
              </GlassPanel>
            ))}
          </div>
        </GlassPanel>
      </div>
    </FadeIn>
  );
}

