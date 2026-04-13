import { useState, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import {
  Car, Zap, MapPin, BarChart3, Battery, DollarSign, TrendingUp,
  Gauge, Leaf, Calendar, ArrowRight, Activity, Clock, Thermometer,
  Timer, BatteryCharging, Plug, Heart,
} from 'lucide-react';

/* ─── Layout & UI ─────────────────────────────────────────────────── */
import { PageContainer } from '@/components/layout';
import { GlassPanel, Button, TabNav } from '@/components/ui';

/* ─── Data display ────────────────────────────────────────────────── */
import { MetricCard } from '@/components/data-display';

/* ─── Charts ──────────────────────────────────────────────────────── */
import {
  ChartTooltip, ChartGradient,
  chartGrid, axisTick, axisTickSm, chartMarginLabeled, chartAnimation, safe, CHART_COLORS,
  BarChart, Bar, LineChart, Line, AreaChart, Area, PieChart, Pie, Cell,
  XAxis, YAxis, Tooltip, ResponsiveContainer, ComposedChart, ScatterChart, Scatter,
  Legend, ZAxis, RadarChart, Radar, PolarGrid, PolarAngleAxis,
} from '@/components/charts';

/* ─── Feedback & animation ────────────────────────────────────────── */
import { Skeleton, EmptyState } from '@/components/feedback';
import { FadeIn } from '@/components/motion';

/* ─── Hooks & utils ───────────────────────────────────────────────── */
import { useFleetAnalytics } from '@/api/hooks/useAnalytics';
import { useSettings } from '@/hooks/useSettings';
import { usePageTitle } from '@/hooks/usePageTitle';
import { fmtNumber, fmtInt } from '@/lib/numberFormat';
import type { FleetAnalytics } from '@/api/types';

/* ─── Constants ──────────────────────────────────────────────────── */

type TimeRange = '7' | '30' | '90' | '365' | 'all';

const TIME_RANGES: { value: TimeRange; label: string }[] = [
  { value: '7', label: '7d' },
  { value: '30', label: '30d' },
  { value: '90', label: '90d' },
  { value: '365', label: '365d' },
  { value: 'all', label: 'All' },
];

const TAB_KEYS = ['overview', 'driving', 'charging', 'battery'] as const;
type TabKey = (typeof TAB_KEYS)[number];

const PIE_COLORS = [CHART_COLORS[0], CHART_COLORS[1], CHART_COLORS[2], CHART_COLORS[3], CHART_COLORS[4], CHART_COLORS[5]];

const QUICK_LINKS = [
  { labelKey: 'analytics.links.statistics', href: '/statistics', icon: <BarChart3 className="h-4 w-4" /> },
  { labelKey: 'analytics.links.compare', href: '/compare', icon: <Activity className="h-4 w-4" /> },
  { labelKey: 'analytics.links.weeklyDigest', href: '/weekly-digest', icon: <Calendar className="h-4 w-4" /> },
  { labelKey: 'analytics.links.mileage', href: '/mileage', icon: <MapPin className="h-4 w-4" /> },
  { labelKey: 'analytics.links.timeline', href: '/timeline', icon: <Clock className="h-4 w-4" /> },
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



/* ─── Section title helper ───────────────────────────────────────── */

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <span className="text-sm font-semibold text-[var(--text-primary)]">
      {children}
    </span>
  );
}

/* ═══════════════════════════════════════════════════════════════════
   HERO GAUGES — always visible above tabs
   ═══════════════════════════════════════════════════════════════════ */

function HeroGauges({ data }: { data: FleetAnalytics | undefined }) {
  const { t } = useTranslation();
  const { convertDistance, convertEfficiency, distanceUnit, efficiencyUnit } = useSettings();

  if (!data) {
    return (
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
        {Array.from({ length: 6 }).map((_, i) => <MetricSkeleton key={i} />)}
      </div>
    );
  }

  const totalDist = convertDistance(data.total_distance_km ?? 0);
  const gasSavings = totalDist * 0.085 * 1.5 - safe(data.total_cost);
  const co2Saved = totalDist * 0.12;

  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
      <MetricCard
        label={t('analytics.hero.distance', 'Distance')}
        value={fmtNumber(totalDist, 1)}
        subtitle={distanceUnit}
        icon={<MapPin className="h-4 w-4" />}
        color="cyan"
      />
      <MetricCard
        label={t('analytics.hero.drives', 'Drives')}
        value={fmtInt(data.total_drives)}
        icon={<Car className="h-4 w-4" />}
        color="purple"
      />
      <MetricCard
        label={t('analytics.hero.energy', 'Energy')}
        value={fmtNumber(data.total_energy_kwh, 1)}
        subtitle="kWh"
        icon={<Zap className="h-4 w-4" />}
        color="green"
      />
      <MetricCard
        label={t('analytics.hero.efficiency', 'Efficiency')}
        value={fmtNumber(convertEfficiency(data.avg_efficiency_wh_km ?? 0), 1)}
        subtitle={efficiencyUnit}
        icon={<Gauge className="h-4 w-4" />}
        color="amber"
      />
      <MetricCard
        label={t('analytics.hero.gasSavings', 'Gas Savings')}
        value={`$${fmtNumber(Math.max(gasSavings, 0), 0)}`}
        icon={<DollarSign className="h-4 w-4" />}
        color="green"
      />
      <MetricCard
        label={t('analytics.hero.co2Saved', 'CO₂ Saved')}
        value={fmtNumber(co2Saved, 0)}
        subtitle="kg"
        icon={<Leaf className="h-4 w-4" />}
        color="green"
      />
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════
   OVERVIEW TAB
   ═══════════════════════════════════════════════════════════════════ */

function OverviewTab({ data }: { data: FleetAnalytics | undefined }) {
  const { t } = useTranslation();
  const { convertDistance, convertEfficiency, distanceUnit, efficiencyUnit } = useSettings();

  const vehicles = data?.vehicle_comparison ?? [];
  const monthlyTrend = data?.charging_analytics?.monthly_trend ?? [];
  const dowData = data?.drive_analytics?.day_of_week ?? [];

  /* 1 — Distance by Vehicle (BarChart) */
  const vehicleDistData = useMemo(
    () => vehicles.map((v) => ({ name: v.name, distance: convertDistance(safe(v.distance)) })),
    [vehicles, convertDistance],
  );

  /* 3 — Efficiency leaderboard, sorted best-first (lowest Wh/km) */
  const leaderboard = useMemo(() => {
    const sorted = [...vehicles].sort((a, b) => safe(a.efficiency) - safe(b.efficiency));
    const maxEff = sorted.length > 0 ? safe(sorted[sorted.length - 1].efficiency) : 1;
    return sorted.map((v) => ({ ...v, pct: maxEff > 0 ? (safe(v.efficiency) / maxEff) * 100 : 0 }));
  }, [vehicles]);

  /* Vehicle radar comparison (needs ≥ 2 vehicles) */
  const radarData = useMemo(() => {
    if (vehicles.length < 2) return [];
    const maxDist = Math.max(...vehicles.map((v) => safe(v.distance)), 1);
    const maxEnergy = Math.max(...vehicles.map((v) => safe(v.energy)), 1);
    const maxDrives = Math.max(...vehicles.map((v) => safe(v.drives)), 1);
    const maxEff = Math.max(...vehicles.map((v) => safe(v.efficiency)), 1);
    return ['Distance', 'Energy', 'Drives', 'Efficiency'].map((metric) => {
      const row: Record<string, string | number> = { metric };
      vehicles.forEach((v) => {
        switch (metric) {
          case 'Distance': row[v.name] = (safe(v.distance) / maxDist) * 100; break;
          case 'Energy': row[v.name] = (safe(v.energy) / maxEnergy) * 100; break;
          case 'Drives': row[v.name] = (safe(v.drives) / maxDrives) * 100; break;
          case 'Efficiency': row[v.name] = ((maxEff - safe(v.efficiency)) / maxEff) * 100; break;
        }
      });
      return row;
    });
  }, [vehicles]);

  return (
    <FadeIn className="space-y-4 mt-4">
      {/* 1 — Distance by Vehicle */}
      <GlassPanel className="p-4">
        <SectionTitle>{t('analytics.overview.distByVehicle', 'Distance by Vehicle')}</SectionTitle>
        {vehicleDistData.length > 0 ? (
          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={vehicleDistData} margin={chartMarginLabeled} {...chartAnimation}>
              {chartGrid}
              <XAxis dataKey="name" tick={axisTickSm} />
              <YAxis tick={axisTick} />
              <Tooltip content={<ChartTooltip />} />
              <Bar dataKey="distance" name={distanceUnit} fill={CHART_COLORS[0]} radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        ) : (
          <EmptyState message={t('analytics.overview.noVehicles', 'No vehicle data')} />
        )}
      </GlassPanel>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {/* 2 — Fleet Usage Donut */}
        <GlassPanel className="p-4">
          <SectionTitle>{t('analytics.overview.fleetUsage', 'Fleet Usage')}</SectionTitle>
          {vehicles.length > 0 ? (
            <ResponsiveContainer width="100%" height={280}>
              <PieChart>
                <Pie
                  data={vehicles.map((v) => ({ name: v.name, value: convertDistance(safe(v.distance)) }))}
                  dataKey="value"
                  nameKey="name"
                  cx="50%"
                  cy="50%"
                  innerRadius={55}
                  outerRadius={95}
                  paddingAngle={3}
                >
                  {vehicles.map((_, i) => (
                    <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip content={<ChartTooltip />} />
                <Legend />
              </PieChart>
            </ResponsiveContainer>
          ) : (
            <EmptyState message={t('analytics.overview.noVehicles', 'No vehicle data')} />
          )}
        </GlassPanel>

        {/* 3 — Efficiency Leaderboard */}
        <GlassPanel className="p-4">
          <SectionTitle>{t('analytics.overview.effLeaderboard', 'Efficiency Leaderboard')}</SectionTitle>
          {leaderboard.length > 0 ? (
            <div className="mt-3 space-y-3">
              {leaderboard.map((v, idx) => (
                <div key={v.id}>
                  <div className="flex items-center justify-between text-xs mb-1">
                    <span className="text-[var(--text-primary)] font-medium">
                      #{idx + 1} {v.name}
                    </span>
                    <span className="text-[var(--text-muted)]">
                      {fmtNumber(convertEfficiency(safe(v.efficiency)), 1)} {efficiencyUnit}
                    </span>
                  </div>
                  <div className="h-2 rounded-full bg-white/[0.06] overflow-hidden">
                    <div
                      className="h-full rounded-full bg-neon-cyan transition-all duration-500"
                      style={{ width: `${v.pct}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <EmptyState message={t('analytics.overview.noEfficiency', 'No efficiency data')} />
          )}
        </GlassPanel>
      </div>

      {/* Radar Vehicle Comparison + Energy & Activity */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <GlassPanel className="p-4">
          <SectionTitle>{t('analytics.overview.vehicleComparison', 'Vehicle Comparison')}</SectionTitle>
          {radarData.length > 0 ? (
            <ResponsiveContainer width="100%" height={280}>
              <RadarChart data={radarData} cx="50%" cy="50%" outerRadius="70%">
                <PolarGrid stroke="rgba(255,255,255,0.06)" />
                <PolarAngleAxis dataKey="metric" tick={{ fill: '#9ca3af', fontSize: 11 }} />
                {vehicles.map((v, i) => (
                  <Radar
                    key={v.id}
                    name={v.name}
                    dataKey={v.name}
                    stroke={CHART_COLORS[i % CHART_COLORS.length]}
                    fill={CHART_COLORS[i % CHART_COLORS.length]}
                    fillOpacity={0.15}
                    strokeWidth={2}
                  />
                ))}
                <Tooltip content={<ChartTooltip />} />
              </RadarChart>
            </ResponsiveContainer>
          ) : (
            <EmptyState message={t('analytics.overview.noComparison', 'Need 2+ vehicles for comparison')} />
          )}
        </GlassPanel>

        <GlassPanel className="p-4">
          <SectionTitle>{t('analytics.overview.energyActivity', 'Energy & Activity')}</SectionTitle>
          {vehicles.length > 0 ? (
            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={vehicles} margin={chartMarginLabeled} {...chartAnimation}>
                {chartGrid}
                <XAxis dataKey="name" tick={axisTickSm} />
                <YAxis tick={axisTick} />
                <Tooltip content={<ChartTooltip />} />
                <Legend />
                <Bar dataKey="energy" name={t('analytics.overview.energykWh', 'Energy (kWh)')} fill={CHART_COLORS[1]} radius={[4, 4, 0, 0]} />
                <Bar dataKey="drives" name={t('analytics.overview.drives', 'Drives')} fill={CHART_COLORS[3]} radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <EmptyState message={t('analytics.overview.noVehicles', 'No vehicle data')} />
          )}
        </GlassPanel>
      </div>

      {/* 4 — Day of Week Pattern */}
      <GlassPanel className="p-4">
        <SectionTitle>{t('analytics.overview.dayOfWeek', 'Day of Week Pattern')}</SectionTitle>
        {dowData.length > 0 ? (
          <ResponsiveContainer width="100%" height={280}>
            <ComposedChart data={dowData} margin={chartMarginLabeled} {...chartAnimation}>
              {chartGrid}
              <XAxis dataKey="day" tick={axisTickSm} />
              <YAxis yAxisId="left" tick={axisTick} />
              <YAxis yAxisId="right" orientation="right" tick={axisTick} />
              <Tooltip content={<ChartTooltip />} />
              <Legend />
              <Bar yAxisId="left" dataKey="drives" name={t('analytics.overview.drives', 'Drives')} fill={CHART_COLORS[2]} radius={[3, 3, 0, 0]} />
              <Line yAxisId="right" type="monotone" dataKey="avg_distance" name={t('analytics.overview.avgDist', 'Avg Distance')} stroke={CHART_COLORS[3]} strokeWidth={2} dot={false} />
            </ComposedChart>
          </ResponsiveContainer>
        ) : (
          <EmptyState message={t('analytics.overview.noDow', 'No day-of-week data')} />
        )}
      </GlassPanel>

      {/* 5 — Monthly Cost Comparison */}
      <GlassPanel className="p-4">
        <SectionTitle>{t('analytics.overview.monthlyCost', 'Monthly Cost Comparison')}</SectionTitle>
        {monthlyTrend.length > 0 ? (
          <ResponsiveContainer width="100%" height={300}>
            <ComposedChart data={monthlyTrend} margin={chartMarginLabeled} {...chartAnimation}>
              {chartGrid}
              <XAxis dataKey="month" tick={axisTickSm} />
              <YAxis yAxisId="left" tick={axisTick} />
              <YAxis yAxisId="right" orientation="right" tick={axisTick} />
              <Tooltip content={<ChartTooltip />} />
              <Legend />
              <Bar yAxisId="left" dataKey="cost" name={t('analytics.overview.electricCost', 'Electric Cost')} fill={CHART_COLORS[0]} radius={[3, 3, 0, 0]} />
              <Bar yAxisId="left" dataKey="gas_cost" name={t('analytics.overview.gasCost', 'Gas Cost')} fill={CHART_COLORS[5]} radius={[3, 3, 0, 0]} />
              <Line yAxisId="right" type="monotone" dataKey="savings" name={t('analytics.overview.savings', 'Savings')} stroke={CHART_COLORS[1]} strokeWidth={2} dot={false} />
            </ComposedChart>
          </ResponsiveContainer>
        ) : (
          <EmptyState message={t('analytics.overview.noMonthly', 'No monthly data')} />
        )}
      </GlassPanel>

      {/* Quick Links */}
      <GlassPanel className="p-4">
        <SectionTitle>{t('analytics.overview.quickLinks', 'Quick Links')}</SectionTitle>
        <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-5">
          {QUICK_LINKS.map((link) => (
            <Link key={link.href} to={link.href} className="block">
              <GlassPanel hover glow="cyan" className="flex items-center gap-3 p-3">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-white/[0.06]">
                  {link.icon}
                </div>
                <span className="flex-1 text-sm font-medium text-[var(--text-primary)]">
                  {t(link.labelKey, link.labelKey.split('.').pop() ?? '')}
                </span>
                <ArrowRight className="h-3.5 w-3.5 text-[var(--text-muted)]" />
              </GlassPanel>
            </Link>
          ))}
        </div>
      </GlassPanel>
    </FadeIn>
  );
}

/* ═══════════════════════════════════════════════════════════════════
   DRIVING TAB
   ═══════════════════════════════════════════════════════════════════ */

function DrivingTab({ data }: { data: FleetAnalytics | undefined }) {
  const { t } = useTranslation();
  const { convertDistance, convertSpeed, convertTemp, convertEfficiency, distanceUnit, speedUnit, tempUnit, efficiencyUnit } = useSettings();

  const da = data?.drive_analytics;
  const speedDist = da?.speed_distribution ?? [];
  const distDist = da?.distance_distribution ?? [];
  const hourly = da?.hourly_pattern ?? [];
  const tempEff = da?.temp_vs_efficiency ?? [];
  const dailyTrend = da?.daily_trend ?? [];
  const durationDist = da?.duration_distribution ?? [];
  const effTrend = useMemo(() => dailyTrend.filter((d) => safe(d.efficiency) > 0), [dailyTrend]);

  const ss = da?.speed_stats;
  const ps = da?.power_stats;
  const rs = da?.regen_stats;
  const ds = da?.distance_stats;
  const insideTemp = da?.temperature?.inside;
  const outsideTemp = da?.temperature?.outside;

  return (
    <FadeIn className="space-y-4 mt-4">
      {/* 1 — Performance Summary Cards */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
        <MetricCard
          label={t('analytics.driving.topSpeed', 'Top Speed')}
          value={ss ? fmtNumber(convertSpeed(safe(ss.max)), 0) : '—'}
          subtitle={speedUnit}
          icon={<Gauge className="h-4 w-4" />}
          color="cyan"
        />
        <MetricCard
          label={t('analytics.driving.avgSpeed', 'Avg Speed')}
          value={ss ? fmtNumber(convertSpeed(safe(ss.avg)), 0) : '—'}
          subtitle={speedUnit}
          icon={<TrendingUp className="h-4 w-4" />}
          color="purple"
        />
        <MetricCard
          label={t('analytics.driving.peakPower', 'Peak Power')}
          value={ps ? fmtNumber(safe(ps.max), 0) : '—'}
          subtitle="kW"
          icon={<Zap className="h-4 w-4" />}
          color="amber"
        />
        <MetricCard
          label={t('analytics.driving.peakRegen', 'Peak Regen')}
          value={rs ? fmtNumber(safe(rs.max), 0) : '—'}
          subtitle="kW"
          icon={<BatteryCharging className="h-4 w-4" />}
          color="green"
        />
        <MetricCard
          label={t('analytics.driving.avgDriveDist', 'Avg Drive Distance')}
          value={ds ? fmtNumber(convertDistance(safe(ds.avg)), 1) : '—'}
          subtitle={distanceUnit}
          icon={<MapPin className="h-4 w-4" />}
          color="cyan"
        />
        <MetricCard
          label={t('analytics.driving.longestDrive', 'Longest Drive')}
          value={ds ? fmtNumber(convertDistance(safe(ds.max)), 1) : '—'}
          subtitle={distanceUnit}
          icon={<Car className="h-4 w-4" />}
          color="purple"
        />
      </div>

      {/* 2 — Speed Distribution */}
      <GlassPanel className="p-4">
        <SectionTitle>{t('analytics.driving.speedDist', 'Speed Distribution')}</SectionTitle>
        {speedDist.length > 0 ? (
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={speedDist} margin={chartMarginLabeled} {...chartAnimation}>
              {chartGrid}
              <XAxis dataKey="range" tick={axisTickSm} />
              <YAxis tick={axisTick} />
              <Tooltip content={<ChartTooltip />} />
              <Bar dataKey="count" name={t('analytics.driving.trips', 'Trips')} fill={CHART_COLORS[0]} radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        ) : (
          <EmptyState message={t('analytics.driving.noSpeed', 'No speed data')} />
        )}
      </GlassPanel>

      {/* 3 — Trip Distance Distribution */}
      <GlassPanel className="p-4">
        <SectionTitle>{t('analytics.driving.distDist', 'Trip Distance Distribution')}</SectionTitle>
        {distDist.length > 0 ? (
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={distDist} margin={chartMarginLabeled} {...chartAnimation}>
              {chartGrid}
              <XAxis dataKey="range" tick={axisTickSm} />
              <YAxis tick={axisTick} />
              <Tooltip content={<ChartTooltip />} />
              <Bar dataKey="count" name={t('analytics.driving.trips', 'Trips')} fill={CHART_COLORS[2]} radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        ) : (
          <EmptyState message={t('analytics.driving.noDistDist', 'No distance distribution data')} />
        )}
      </GlassPanel>

      {/* 4 — Hourly Driving Pattern */}
      <GlassPanel className="p-4">
        <SectionTitle>{t('analytics.driving.hourlyPattern', 'Hourly Driving Pattern')}</SectionTitle>
        {hourly.length > 0 ? (
          <ResponsiveContainer width="100%" height={280}>
            <ComposedChart data={hourly} margin={chartMarginLabeled} {...chartAnimation}>
              {chartGrid}
              <XAxis dataKey="hour" tick={axisTickSm} tickFormatter={(h: number) => `${h}:00`} />
              <YAxis yAxisId="left" tick={axisTick} />
              <YAxis yAxisId="right" orientation="right" tick={axisTick} />
              <Tooltip content={<ChartTooltip />} />
              <Legend />
              <Bar yAxisId="left" dataKey="drives" name={t('analytics.driving.drives', 'Drives')} fill={CHART_COLORS[0]} radius={[3, 3, 0, 0]} />
              <Line yAxisId="right" type="monotone" dataKey="distance" name={t('analytics.driving.distance', 'Distance')} stroke={CHART_COLORS[3]} strokeWidth={2} dot={false} />
            </ComposedChart>
          </ResponsiveContainer>
        ) : (
          <EmptyState message={t('analytics.driving.noHourly', 'No hourly data')} />
        )}
      </GlassPanel>

      {/* 5 — Temp vs Efficiency */}
      <GlassPanel className="p-4">
        <SectionTitle>{t('analytics.driving.tempVsEff', 'Temperature vs Efficiency')}</SectionTitle>
        {tempEff.length > 0 ? (
          <ResponsiveContainer width="100%" height={280}>
            <ScatterChart margin={chartMarginLabeled}>
              {chartGrid}
              <XAxis dataKey="temp" name={t('analytics.driving.temp', 'Temp')} tick={axisTick} unit={tempUnit} type="number" />
              <YAxis dataKey="efficiency" name={t('analytics.driving.efficiency', 'Efficiency')} tick={axisTick} unit={` ${efficiencyUnit}`} type="number" />
              <ZAxis dataKey="distance" range={[30, 300]} name={distanceUnit} />
              <Tooltip content={<ChartTooltip />} />
              <Scatter
                data={tempEff.map((d) => ({
                  temp: convertTemp(safe(d.temp)),
                  efficiency: convertEfficiency(safe(d.efficiency)),
                  distance: convertDistance(safe(d.distance)),
                }))}
                fill={CHART_COLORS[1]}
              />
            </ScatterChart>
          </ResponsiveContainer>
        ) : (
          <EmptyState message={t('analytics.driving.noTempEff', 'No temperature data')} />
        )}
      </GlassPanel>

      {/* 6 — Daily Driving Trend */}
      <GlassPanel className="p-4">
        <SectionTitle>{t('analytics.driving.dailyTrend', 'Daily Driving Trend')}</SectionTitle>
        {dailyTrend.length > 0 ? (
          <ResponsiveContainer width="100%" height={280}>
            <ComposedChart data={dailyTrend} margin={chartMarginLabeled} {...chartAnimation}>
              {chartGrid}
              <XAxis dataKey="date" tick={axisTickSm} tickFormatter={(v: string) => v.slice(5)} />
              <YAxis yAxisId="left" tick={axisTick} />
              <YAxis yAxisId="right" orientation="right" tick={axisTick} />
              <Tooltip content={<ChartTooltip />} />
              <Legend />
              <defs>
                <ChartGradient id="dailyDistGrad" color={CHART_COLORS[0]} />
              </defs>
              <Area yAxisId="left" type="monotone" dataKey="distance" name={distanceUnit} stroke={CHART_COLORS[0]} fill="url(#dailyDistGrad)" strokeWidth={2} />
              <Line yAxisId="right" type="monotone" dataKey="drives" name={t('analytics.driving.drives', 'Drives')} stroke={CHART_COLORS[3]} strokeWidth={2} dot={false} />
            </ComposedChart>
          </ResponsiveContainer>
        ) : (
          <EmptyState message={t('analytics.driving.noDailyTrend', 'No daily trend data')} />
        )}
      </GlassPanel>

      {/* 7 — Drive Duration Distribution (optional) */}
      {durationDist.length > 0 && (
        <GlassPanel className="p-4">
          <SectionTitle>{t('analytics.driving.durationDist', 'Drive Duration Distribution')}</SectionTitle>
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={durationDist} margin={chartMarginLabeled} {...chartAnimation}>
              {chartGrid}
              <XAxis dataKey="range" tick={axisTickSm} />
              <YAxis tick={axisTick} />
              <Tooltip content={<ChartTooltip />} />
              <Bar dataKey="count" name={t('analytics.driving.drives', 'Drives')} fill={CHART_COLORS[4]} radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </GlassPanel>
      )}

      {/* 8 — Efficiency Trend */}
      <GlassPanel className="p-4">
        <SectionTitle>{t('analytics.driving.effTrend', 'Efficiency Trend')}</SectionTitle>
        {effTrend.length > 0 ? (
          <ResponsiveContainer width="100%" height={260}>
            <AreaChart data={effTrend} margin={chartMarginLabeled} {...chartAnimation}>
              {chartGrid}
              <XAxis dataKey="date" tick={axisTickSm} tickFormatter={(v: string) => v.slice(5)} />
              <YAxis tick={axisTick} />
              <Tooltip content={<ChartTooltip />} />
              <defs>
                <ChartGradient id="effTrendGrad" color={CHART_COLORS[1]} />
              </defs>
              <Area type="monotone" dataKey="efficiency" name={efficiencyUnit} stroke={CHART_COLORS[1]} fill="url(#effTrendGrad)" strokeWidth={2} />
            </AreaChart>
          </ResponsiveContainer>
        ) : (
          <EmptyState message={t('analytics.driving.noEffTrend', 'No efficiency trend data')} />
        )}
      </GlassPanel>

      {/* 9 — Temperature Stats */}
      <GlassPanel className="p-4">
        <SectionTitle>{t('analytics.driving.tempStats', 'Temperature Stats')}</SectionTitle>
        {insideTemp || outsideTemp ? (
          <div className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
            <MetricCard
              label={t('analytics.driving.insideMin', 'Inside Min')}
              value={insideTemp ? fmtNumber(convertTemp(safe(insideTemp.min)), 1) : '—'}
              subtitle={tempUnit}
              icon={<Thermometer className="h-4 w-4" />}
              color="cyan"
            />
            <MetricCard
              label={t('analytics.driving.insideAvg', 'Inside Avg')}
              value={insideTemp ? fmtNumber(convertTemp(safe(insideTemp.avg)), 1) : '—'}
              subtitle={tempUnit}
              icon={<Thermometer className="h-4 w-4" />}
              color="green"
            />
            <MetricCard
              label={t('analytics.driving.insideMax', 'Inside Max')}
              value={insideTemp ? fmtNumber(convertTemp(safe(insideTemp.max)), 1) : '—'}
              subtitle={tempUnit}
              icon={<Thermometer className="h-4 w-4" />}
              color="amber"
            />
            <MetricCard
              label={t('analytics.driving.outsideMin', 'Outside Min')}
              value={outsideTemp ? fmtNumber(convertTemp(safe(outsideTemp.min)), 1) : '—'}
              subtitle={tempUnit}
              icon={<Thermometer className="h-4 w-4" />}
              color="cyan"
            />
            <MetricCard
              label={t('analytics.driving.outsideAvg', 'Outside Avg')}
              value={outsideTemp ? fmtNumber(convertTemp(safe(outsideTemp.avg)), 1) : '—'}
              subtitle={tempUnit}
              icon={<Thermometer className="h-4 w-4" />}
              color="green"
            />
            <MetricCard
              label={t('analytics.driving.outsideMax', 'Outside Max')}
              value={outsideTemp ? fmtNumber(convertTemp(safe(outsideTemp.max)), 1) : '—'}
              subtitle={tempUnit}
              icon={<Thermometer className="h-4 w-4" />}
              color="amber"
            />
          </div>
        ) : (
          <EmptyState message={t('analytics.driving.noTempStats', 'No temperature stats')} />
        )}
      </GlassPanel>
    </FadeIn>
  );
}

/* ═══════════════════════════════════════════════════════════════════
   CHARGING TAB
   ═══════════════════════════════════════════════════════════════════ */

function ChargingTab({ data }: { data: FleetAnalytics | undefined }) {
  const { t } = useTranslation();

  const ca = data?.charging_analytics;
  const chargerTypes = ca?.charger_types ?? [];
  const batteryDist = ca?.start_battery_dist ?? [];
  const hourly = ca?.hourly_pattern ?? [];
  const brands = ca?.charger_brands ?? [];
  const monthlyTrend = ca?.monthly_trend ?? [];
  const costStats = ca?.cost_stats;
  const powerStats = ca?.power_stats;
  const durStats = ca?.duration_stats;
  const effStats = ca?.efficiency_stats;

  /* Brand leaderboard */
  const brandLeaderboard = useMemo(() => {
    const maxCount = brands.reduce((m, b) => Math.max(m, safe(b.count)), 0) || 1;
    return brands.map((b) => ({ ...b, pct: (safe(b.count) / maxCount) * 100 }));
  }, [brands]);

  return (
    <FadeIn className="space-y-4 mt-4">
      {/* 1 — Charging Summary Cards */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
        <MetricCard
          label={t('analytics.charging.sessions', 'Sessions')}
          value={fmtInt(data?.total_charging_sessions)}
          icon={<Plug className="h-4 w-4" />}
          color="cyan"
        />
        <MetricCard
          label={t('analytics.charging.totalEnergy', 'Total Energy')}
          value={fmtNumber(data?.total_energy_kwh, 1)}
          subtitle="kWh"
          icon={<Zap className="h-4 w-4" />}
          color="green"
        />
        <MetricCard
          label={t('analytics.charging.totalCost', 'Total Cost')}
          value={`$${fmtNumber(data?.total_cost, 2)}`}
          icon={<DollarSign className="h-4 w-4" />}
          color="amber"
        />
        <MetricCard
          label={t('analytics.charging.avgPower', 'Avg Power')}
          value={powerStats ? fmtNumber(safe(powerStats.avg), 1) : '—'}
          subtitle="kW"
          icon={<Gauge className="h-4 w-4" />}
          color="purple"
        />
        <MetricCard
          label={t('analytics.charging.avgDuration', 'Avg Duration')}
          value={durStats ? fmtNumber(safe(durStats.avg), 0) : '—'}
          subtitle={t('analytics.charging.min', 'min')}
          icon={<Timer className="h-4 w-4" />}
          color="cyan"
        />
        <MetricCard
          label={t('analytics.charging.chargeEff', 'Charge Efficiency')}
          value={effStats ? fmtNumber(safe(effStats.avg), 1) : '—'}
          subtitle="%"
          icon={<TrendingUp className="h-4 w-4" />}
          color="green"
        />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {/* 2 — Charger Types Donut */}
        <GlassPanel className="p-4">
          <SectionTitle>{t('analytics.charging.chargerTypes', 'Charger Types')}</SectionTitle>
          {chargerTypes.length > 0 ? (
            <ResponsiveContainer width="100%" height={280}>
              <PieChart>
                <Pie
                  data={chargerTypes}
                  dataKey="count"
                  nameKey="type"
                  cx="50%"
                  cy="50%"
                  innerRadius={55}
                  outerRadius={95}
                  paddingAngle={3}
                >
                  {chargerTypes.map((_, i) => (
                    <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip content={<ChartTooltip />} />
                <Legend />
              </PieChart>
            </ResponsiveContainer>
          ) : (
            <EmptyState message={t('analytics.charging.noTypes', 'No charger type data')} />
          )}
        </GlassPanel>

        {/* 3 — Start Battery Distribution */}
        <GlassPanel className="p-4">
          <SectionTitle>{t('analytics.charging.startBattery', 'Start Battery Distribution')}</SectionTitle>
          {batteryDist.length > 0 ? (
            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={batteryDist} margin={chartMarginLabeled} {...chartAnimation}>
                {chartGrid}
                <XAxis dataKey="range" tick={axisTickSm} />
                <YAxis tick={axisTick} />
                <Tooltip content={<ChartTooltip />} />
                <Bar dataKey="count" name={t('analytics.charging.sessions', 'Sessions')} fill={CHART_COLORS[1]} radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <EmptyState message={t('analytics.charging.noBatDist', 'No battery distribution data')} />
          )}
        </GlassPanel>
      </div>

      {/* 4 — Hourly Charging Pattern */}
      <GlassPanel className="p-4">
        <SectionTitle>{t('analytics.charging.hourlyPattern', 'Hourly Charging Pattern')}</SectionTitle>
        {hourly.length > 0 ? (
          <ResponsiveContainer width="100%" height={280}>
            <ComposedChart data={hourly} margin={chartMarginLabeled} {...chartAnimation}>
              {chartGrid}
              <XAxis dataKey="hour" tick={axisTickSm} tickFormatter={(h: number) => `${h}:00`} />
              <YAxis yAxisId="left" tick={axisTick} />
              <YAxis yAxisId="right" orientation="right" tick={axisTick} />
              <Tooltip content={<ChartTooltip />} />
              <Legend />
              <Bar yAxisId="left" dataKey="charges" name={t('analytics.charging.charges', 'Charges')} fill={CHART_COLORS[0]} radius={[3, 3, 0, 0]} />
              <Line yAxisId="right" type="monotone" dataKey="energy" name={t('analytics.charging.energykWh', 'Energy (kWh)')} stroke={CHART_COLORS[3]} strokeWidth={2} dot={false} />
            </ComposedChart>
          </ResponsiveContainer>
        ) : (
          <EmptyState message={t('analytics.charging.noHourly', 'No hourly data')} />
        )}
      </GlassPanel>

      {/* 5 — Charger Brands */}
      <GlassPanel className="p-4">
        <SectionTitle>{t('analytics.charging.chargerBrands', 'Charger Brands')}</SectionTitle>
        {brandLeaderboard.length > 0 ? (
          <div className="mt-3 space-y-3">
            {brandLeaderboard.map((b, idx) => (
              <div key={b.brand}>
                <div className="flex items-center justify-between text-xs mb-1">
                  <span className="text-[var(--text-primary)] font-medium">
                    #{idx + 1} {b.brand}
                  </span>
                  <span className="text-[var(--text-muted)]">
                    {fmtInt(b.count)} {t('analytics.charging.sessions', 'sessions')}
                  </span>
                </div>
                <div className="h-2 rounded-full bg-white/[0.06] overflow-hidden">
                  <div
                    className="h-full rounded-full bg-neon-green transition-all duration-500"
                    style={{ width: `${b.pct}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        ) : (
          <EmptyState message={t('analytics.charging.noBrands', 'No charger brand data')} />
        )}
      </GlassPanel>

      {/* 6 — Monthly Charging Trend */}
      <GlassPanel className="p-4">
        <SectionTitle>{t('analytics.charging.monthlyTrend', 'Monthly Charging Trend')}</SectionTitle>
        {monthlyTrend.length > 0 ? (
          <ResponsiveContainer width="100%" height={300}>
            <ComposedChart data={monthlyTrend} margin={chartMarginLabeled} {...chartAnimation}>
              {chartGrid}
              <XAxis dataKey="month" tick={axisTickSm} />
              <YAxis yAxisId="left" tick={axisTick} />
              <YAxis yAxisId="right" orientation="right" tick={axisTick} />
              <Tooltip content={<ChartTooltip />} />
              <Legend />
              <defs>
                <ChartGradient id="monthlyEnergyGrad" color={CHART_COLORS[1]} />
              </defs>
              <Area yAxisId="left" type="monotone" dataKey="energy" name={t('analytics.charging.energykWh', 'Energy (kWh)')} stroke={CHART_COLORS[1]} fill="url(#monthlyEnergyGrad)" strokeWidth={2} />
              <Line yAxisId="right" type="monotone" dataKey="avg_power" name={t('analytics.charging.avgPowerkW', 'Avg Power (kW)')} stroke={CHART_COLORS[3]} strokeWidth={2} dot={false} />
              <Bar yAxisId="left" dataKey="sessions" name={t('analytics.charging.sessions', 'Sessions')} fill={CHART_COLORS[2]} radius={[3, 3, 0, 0]} opacity={0.6} />
            </ComposedChart>
          </ResponsiveContainer>
        ) : (
          <EmptyState message={t('analytics.charging.noMonthly', 'No monthly data')} />
        )}
      </GlassPanel>

      {/* 7 — Cost Analysis Cards */}
      <GlassPanel className="p-4">
        <SectionTitle>{t('analytics.charging.costAnalysis', 'Cost Analysis')}</SectionTitle>
        {costStats ? (
          <div className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-4">
            <MetricCard
              label={t('analytics.charging.minCost', 'Min Cost')}
              value={`$${fmtNumber(safe(costStats.min), 2)}`}
              icon={<DollarSign className="h-4 w-4" />}
              color="green"
            />
            <MetricCard
              label={t('analytics.charging.avgCost', 'Avg Cost')}
              value={`$${fmtNumber(safe(costStats.avg), 2)}`}
              icon={<DollarSign className="h-4 w-4" />}
              color="cyan"
            />
            <MetricCard
              label={t('analytics.charging.medianCost', 'Median Cost')}
              value={`$${fmtNumber(safe(costStats.median), 2)}`}
              icon={<DollarSign className="h-4 w-4" />}
              color="purple"
            />
            <MetricCard
              label={t('analytics.charging.maxCost', 'Max Cost')}
              value={`$${fmtNumber(safe(costStats.max), 2)}`}
              icon={<DollarSign className="h-4 w-4" />}
              color="amber"
            />
          </div>
        ) : (
          <EmptyState message={t('analytics.charging.noCostStats', 'No cost statistics')} />
        )}
      </GlassPanel>

      {/* 8 — Cost by Charger Type */}
      <GlassPanel className="p-4">
        <SectionTitle>{t('analytics.charging.costByType', 'Cost by Charger Type')}</SectionTitle>
        {chargerTypes.length > 0 ? (
          <div className="mt-3 space-y-3">
            {chargerTypes.map((ct, i) => {
              const totalSessions = chargerTypes.reduce((s, x) => s + safe(x.count), 0);
              const pct = totalSessions > 0 ? Math.round((safe(ct.count) / totalSessions) * 100) : 0;
              return (
                <div key={i} className="flex items-center gap-3">
                  <span className="w-28 text-xs text-right font-medium text-white/60">{ct.type}</span>
                  <div className="flex-1 h-3 rounded-full bg-white/[0.06] overflow-hidden">
                    <div
                      className="h-full rounded-full transition-all duration-700"
                      style={{ width: `${pct}%`, backgroundColor: CHART_COLORS[i % CHART_COLORS.length] }}
                    />
                  </div>
                  <span className="w-20 text-xs font-mono text-right text-white/80">
                    {safe(ct.count)} ({pct}%)
                  </span>
                </div>
              );
            })}
          </div>
        ) : (
          <EmptyState message={t('analytics.charging.noCostByType', 'No charger type data')} />
        )}
      </GlassPanel>
    </FadeIn>
  );
}

/* ═══════════════════════════════════════════════════════════════════
   BATTERY TAB
   ═══════════════════════════════════════════════════════════════════ */

function BatteryTab({ data }: { data: FleetAnalytics | undefined }) {
  const { t } = useTranslation();
  const { convertDistance, distanceUnit } = useSettings();

  const trend = data?.battery_trend ?? [];
  const latest = trend.length > 0 ? trend[trend.length - 1] : null;

  if (trend.length === 0) {
    return (
      <FadeIn className="mt-4">
        <GlassPanel className="p-6">
          <EmptyState
            message={t('analytics.battery.noData', 'No battery trend data available')}
            icon={<Battery className="h-10 w-10" />}
          />
        </GlassPanel>
      </FadeIn>
    );
  }

  return (
    <FadeIn className="space-y-4 mt-4">
      {/* 1 — Battery Health Cards */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-5">
        <MetricCard
          label={t('analytics.battery.healthScore', 'Health Score')}
          value={latest ? fmtNumber(safe(latest.health_score), 1) : '—'}
          subtitle="%"
          icon={<Heart className="h-4 w-4" />}
          color="green"
        />
        <MetricCard
          label={t('analytics.battery.capacity', 'Capacity')}
          value={latest ? fmtNumber(safe(latest.capacity_kwh), 1) : '—'}
          subtitle="kWh"
          icon={<Battery className="h-4 w-4" />}
          color="cyan"
        />
        <MetricCard
          label={t('analytics.battery.degradation', 'Degradation')}
          value={latest ? fmtNumber(safe(latest.degradation_pct), 2) : '—'}
          subtitle="%"
          icon={<TrendingUp className="h-4 w-4" />}
          color="amber"
        />
        <MetricCard
          label={t('analytics.battery.estRange', 'Est. Range')}
          value={latest ? fmtNumber(convertDistance(safe(latest.range_km)), 0) : '—'}
          subtitle={distanceUnit}
          icon={<MapPin className="h-4 w-4" />}
          color="purple"
        />
        <MetricCard
          label={t('analytics.battery.cycles', 'Cycles')}
          value={latest ? fmtInt(safe(latest.cycle_count)) : '—'}
          icon={<Activity className="h-4 w-4" />}
          color="cyan"
        />
      </div>

      {/* 2 — Health Score Timeline */}
      <GlassPanel className="p-4">
        <SectionTitle>{t('analytics.battery.healthTimeline', 'Health Score Timeline')}</SectionTitle>
        <ResponsiveContainer width="100%" height={280}>
          <AreaChart data={trend} margin={chartMarginLabeled} {...chartAnimation}>
            {chartGrid}
            <XAxis dataKey="date" tick={axisTickSm} tickFormatter={(v: string) => v.slice(5)} />
            <YAxis tick={axisTick} domain={[80, 100]} />
            <Tooltip content={<ChartTooltip />} />
            <defs>
              <ChartGradient id="healthGrad" color={CHART_COLORS[1]} />
            </defs>
            <Area type="monotone" dataKey="health_score" name={t('analytics.battery.health', 'Health %')} stroke={CHART_COLORS[1]} fill="url(#healthGrad)" strokeWidth={2} />
          </AreaChart>
        </ResponsiveContainer>
      </GlassPanel>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {/* 3 — Capacity Trend */}
        <GlassPanel className="p-4">
          <SectionTitle>{t('analytics.battery.capacityTrend', 'Capacity Trend')}</SectionTitle>
          <ResponsiveContainer width="100%" height={260}>
            <LineChart data={trend} margin={chartMarginLabeled} {...chartAnimation}>
              {chartGrid}
              <XAxis dataKey="date" tick={axisTickSm} tickFormatter={(v: string) => v.slice(5)} />
              <YAxis tick={axisTick} />
              <Tooltip content={<ChartTooltip />} />
              <Line type="monotone" dataKey="capacity_kwh" name={t('analytics.battery.capacitykWh', 'Capacity (kWh)')} stroke={CHART_COLORS[0]} strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </GlassPanel>

        {/* 4 — Range Trend */}
        <GlassPanel className="p-4">
          <SectionTitle>{t('analytics.battery.rangeTrend', 'Range Trend')}</SectionTitle>
          <ResponsiveContainer width="100%" height={260}>
            <LineChart
              data={trend.map((d) => ({ ...d, range: convertDistance(safe(d.range_km)) }))}
              margin={chartMarginLabeled}
              {...chartAnimation}
            >
              {chartGrid}
              <XAxis dataKey="date" tick={axisTickSm} tickFormatter={(v: string) => v.slice(5)} />
              <YAxis tick={axisTick} />
              <Tooltip content={<ChartTooltip />} />
              <Line type="monotone" dataKey="range" name={`${t('analytics.battery.range', 'Range')} (${distanceUnit})`} stroke={CHART_COLORS[2]} strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </GlassPanel>
      </div>

      {/* 5 — Degradation & Cycles */}
      <GlassPanel className="p-4">
        <SectionTitle>{t('analytics.battery.degradationCycles', 'Degradation & Cycles')}</SectionTitle>
        <ResponsiveContainer width="100%" height={280}>
          <ComposedChart data={trend} margin={chartMarginLabeled} {...chartAnimation}>
            {chartGrid}
            <XAxis dataKey="date" tick={axisTickSm} tickFormatter={(v: string) => v.slice(5)} />
            <YAxis yAxisId="left" tick={axisTick} />
            <YAxis yAxisId="right" orientation="right" tick={axisTick} />
            <Tooltip content={<ChartTooltip />} />
            <Legend />
            <defs>
              <ChartGradient id="degradGrad" color={CHART_COLORS[5]} />
            </defs>
            <Area yAxisId="left" type="monotone" dataKey="degradation_pct" name={t('analytics.battery.degradPct', 'Degradation %')} stroke={CHART_COLORS[5]} fill="url(#degradGrad)" strokeWidth={2} />
            <Line yAxisId="right" type="monotone" dataKey="cycle_count" name={t('analytics.battery.cycleCount', 'Cycle Count')} stroke={CHART_COLORS[4]} strokeWidth={2} dot={false} />
          </ComposedChart>
        </ResponsiveContainer>
      </GlassPanel>
    </FadeIn>
  );
}

/* ═══════════════════════════════════════════════════════════════════
   MAIN COMPONENT
   ═══════════════════════════════════════════════════════════════════ */

export default function AnalyticsPage() {
  const { t } = useTranslation();
  usePageTitle(t('analytics.title', 'Fleet Analytics'));

  const [days, setDays] = useState<TimeRange>('30');
  const [activeTab, setActiveTab] = useState<TabKey>('overview');

  /* Determine query params: "All" uses start date, rest use days */
  const daysNum = days === 'all' ? 30 : Number(days);
  const startParam = days === 'all' ? '2015-01-01' : undefined;

  const { data, isLoading, error } = useFleetAnalytics(daysNum, startParam);

  /* Tab definitions */
  const tabs = useMemo(
    () => [
      { key: 'overview' as const, label: t('analytics.tabs.overview', 'Overview'), icon: <BarChart3 className="h-4 w-4" /> },
      { key: 'driving' as const, label: t('analytics.tabs.driving', 'Driving'), icon: <Car className="h-4 w-4" /> },
      { key: 'charging' as const, label: t('analytics.tabs.charging', 'Charging'), icon: <Zap className="h-4 w-4" /> },
      { key: 'battery' as const, label: t('analytics.tabs.battery', 'Battery'), icon: <Battery className="h-4 w-4" /> },
    ],
    [t],
  );

  /* ─── Header actions: time range selector ───────────────────────── */
  const headerActions = (
    <div className="flex items-center gap-1">
      {TIME_RANGES.map((r) => (
        <Button
          key={r.value}
          variant={days === r.value ? 'primary' : 'ghost'}
          size="sm"
          onClick={() => setDays(r.value)}
        >
          {r.label}
        </Button>
      ))}
    </div>
  );

  /* ─── Render ────────────────────────────────────────────────────── */
  return (
    <PageContainer
      title={t('analytics.title', 'Fleet Analytics')}
      subtitle={t('analytics.subtitle', 'Comprehensive fleet performance insights')}
      actions={headerActions}
      loading={isLoading}
      error={error instanceof Error ? error : error ? new Error(String(error)) : null}
    >
      {/* Hero gauges — always visible */}
      <HeroGauges data={data} />

      <div className="mt-4">
        <TabNav tabs={tabs} active={activeTab} onChange={(k) => setActiveTab(k as TabKey)} />
      </div>

      {activeTab === 'overview' && <OverviewTab data={data} />}
      {activeTab === 'driving' && <DrivingTab data={data} />}
      {activeTab === 'charging' && <ChargingTab data={data} />}
      {activeTab === 'battery' && <BatteryTab data={data} />}
    </PageContainer>
  );
}
