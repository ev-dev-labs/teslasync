import { useState, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import clsx from 'clsx';
import {
  Heart,
  Battery,
  BatteryFull,
  Gauge,
  RefreshCcw,
  Clock,
  Zap,
  Thermometer,
  ArrowRight,
  Lightbulb,
} from 'lucide-react';
import { PageContainer } from '@/components/layout/PageContainer';
import { GlassPanel } from '@/components/ui/GlassPanel';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Select } from '@/components/ui/Select';
import { MetricCard } from '@/components/data-display/MetricCard';
import { RadialGauge } from '@/components/charts/RadialGauge';
import { Skeleton } from '@/components/feedback/Skeleton';
import { EmptyState } from '@/components/feedback/EmptyState';
import { FadeIn } from '@/components/motion/FadeIn';
import { ChartTooltip } from '@/components/charts/ChartTooltip';
import {
  AreaChart,
  Area,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from '@/components/charts';
import { usePageTitle } from '@/hooks/usePageTitle';
import { formatDateShort } from '@/lib/dateFormat';
import { fmtNumber, fmtPercent } from '@/lib/numberFormat';
import { CHART_COLORS } from '@/lib/colors';
import { request } from '@/api/client';
import { useVehicles } from '@/api/hooks/useVehicles';
import { Grid } from '@/components/layout/Grid';

interface BatteryHealthOverview {
  health_score: number;
  soh_pct: number;
  current_capacity_kwh: number;
  original_capacity_kwh: number;
  degradation_rate_yr: number;
  total_cycles: number;
  battery_age_months: number;
  fast_charge_pct: number;
  full_charge_pct: number;
  avg_depth_of_discharge: number;
  charge_habits_score: number;
  temp_exposure_score: number;
  battery_level_history: { date: string; level: number }[];
  temp_distribution: { range: string; hours: number; color: string }[];
}

function healthVariant(score: number): 'success' | 'warning' | 'danger' {
  if (score >= 90) return 'success';
  if (score >= 70) return 'warning';
  return 'danger';
}

function healthLabel(score: number, t: (k: string) => string): string {
  if (score >= 90) return t('Excellent');
  if (score >= 70) return t('Good');
  return t('Degraded');
}

function habitsVariant(score: number): 'success' | 'warning' | 'danger' {
  if (score >= 80) return 'success';
  if (score >= 50) return 'warning';
  return 'danger';
}

function gaugeColor(score: number): string {
  if (score >= 90) return CHART_COLORS[1];
  if (score >= 70) return CHART_COLORS[3];
  return CHART_COLORS[5];
}

const QUICK_LINKS: { to: string; label: string }[] = [
  { to: '/battery-cells', label: 'Battery Cells' },
  { to: '/battery-degradation', label: 'Degradation' },
  { to: '/energy-flow', label: 'Energy Flow' },
  { to: '/projected-range', label: 'Projected Range' },
  { to: '/vampire-drain', label: 'Vampire Drain' },
  { to: '/sleep-efficiency', label: 'Sleep Efficiency' },
];

function buildRecommendations(
  d: BatteryHealthOverview,
  t: (k: string) => string,
): string[] {
  const tips: string[] = [];
  if (d.fast_charge_pct > 30)
    tips.push(t('Reduce fast charging frequency to slow degradation.'));
  if (d.full_charge_pct > 40)
    tips.push(t('Avoid charging to 100% regularly — keep the limit at 80–90%.'));
  if (d.avg_depth_of_discharge > 70)
    tips.push(t('Try to avoid deep discharges below 20%.'));
  if (d.temp_exposure_score < 60)
    tips.push(t('Precondition the battery in extreme temperatures before driving.'));
  if (d.degradation_rate_yr > 3)
    tips.push(t('Your degradation rate is above average — review charging habits.'));
  if (tips.length === 0)
    tips.push(t('Your battery health looks great — keep up the good habits!'));
  return tips;
}

export default function BatteryHealthPage() {
  const { t } = useTranslation();
  usePageTitle(t('Battery Health'));

  const { data: vehicles } = useVehicles();
  const [vehicleId, setVehicleId] = useState<string | null>(null);
  const activeId = vehicleId ?? (vehicles?.[0]?.id != null ? String(vehicles[0].id) : null);

  const {
    data,
    isLoading,
    error,
  } = useQuery({
    queryKey: ['battery-health-overview', activeId],
    queryFn: () =>
      request<BatteryHealthOverview>(
        `/analytics/battery-overview?vehicle_id=${activeId}`,
      ),
    enabled: activeId !== null,
  });

  const recommendations = useMemo(
    () => (data ? buildRecommendations(data, t) : []),
    [data, t],
  );

  /* ── Loading skeleton ─────────────────────────────────────────── */

  if (isLoading) {
    return (
      <PageContainer
        title={t('Battery Health')}
        subtitle={t('Health overview, charge habits and temperature exposure')}
      >
        <Grid cols={{ default: 2, lg: 3 }} gap={4}>
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} height={100} />
          ))}
        </Grid>
      </PageContainer>
    );
  }

  /* ── Empty / error ────────────────────────────────────────────── */

  if (!data) {
    return (
      <PageContainer
        title={t('Battery Health')}
        subtitle={t('Health overview, charge habits and temperature exposure')}
        error={error as Error | null}
      >
        <EmptyState
          icon={<Battery className="h-10 w-10 text-gray-400" />}
          message={t('No battery health data available yet.')}
        />
      </PageContainer>
    );
  }

  /* ── Main render ──────────────────────────────────────────────── */

  return (
    <PageContainer
      title={t('Battery Health')}
      subtitle={t('Health overview, charge habits and temperature exposure')}
      actions={
        vehicles && vehicles.length > 1 ? (
          <Select
            options={(vehicles ?? []).map((v) => ({
              value: String(v.id),
              label: v.display_name || v.vin,
            }))}
            value={activeId ?? ''}
            onChange={(e) => setVehicleId(e.target.value)}
          />
        ) : undefined
      }
    >
      {/* ── Health Score Gauge ──────────────────────────────────── */}
      <FadeIn>
        <GlassPanel className="flex flex-col items-center gap-4 py-8">
          <RadialGauge
            value={data.health_score}
            max={100}
            label={t('Health Score')}
            color={gaugeColor(data.health_score)}
            size={180}
          />
          <Badge variant={healthVariant(data.health_score)} size="lg">
            {healthLabel(data.health_score, t)}
          </Badge>
        </GlassPanel>
      </FadeIn>

      {/* ── Summary Metric Cards ───────────────────────────────── */}
      <FadeIn delay={0.05}>
        <Grid cols={{ default: 2, lg: 3 }} gap={4}>
          <MetricCard
            label={t('State of Health')}
            value={fmtPercent(data.soh_pct)}
            icon={<Heart className="h-5 w-5" />}
            color="cyan"
          />
          <MetricCard
            label={t('Current Capacity')}
            value={`${fmtNumber(data.current_capacity_kwh, 1)} kWh`}
            icon={<Battery className="h-5 w-5" />}
            color="green"
          />
          <MetricCard
            label={t('Original Capacity')}
            value={`${fmtNumber(data.original_capacity_kwh, 1)} kWh`}
            icon={<BatteryFull className="h-5 w-5" />}
            color="blue"
          />
          <MetricCard
            label={t('Degradation Rate')}
            value={`${fmtNumber(data.degradation_rate_yr, 2)}%/${t('yr')}`}
            icon={<Gauge className="h-5 w-5" />}
            color="amber"
          />
          <MetricCard
            label={t('Total Cycles')}
            value={fmtNumber(data.total_cycles, 0)}
            icon={<RefreshCcw className="h-5 w-5" />}
            color="purple"
          />
          <MetricCard
            label={t('Battery Age')}
            value={`${data.battery_age_months} ${t('months')}`}
            icon={<Clock className="h-5 w-5" />}
            color="red"
          />
        </Grid>
      </FadeIn>

      {/* ── Battery Level History ──────────────────────────────── */}
      <FadeIn delay={0.1}>
        <GlassPanel>
          <Badge variant="info" className="mb-4">
            {t('Last 30 Days')}
          </Badge>
          <ResponsiveContainer width="100%" height={280}>
            <AreaChart data={data.battery_level_history}>
              <defs>
                <linearGradient id="levelGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={CHART_COLORS[0]} stopOpacity={0.4} />
                  <stop offset="100%" stopColor={CHART_COLORS[0]} stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
              <XAxis
                dataKey="date"
                tickFormatter={(v: string) => formatDateShort(v)}
                stroke="#94a3b8"
                fontSize={12}
              />
              <YAxis
                domain={[0, 100]}
                tickFormatter={(v: number) => `${v}%`}
                stroke="#94a3b8"
                fontSize={12}
              />
              <Tooltip content={<ChartTooltip />} />
              <Legend />
              <Area
                type="monotone"
                dataKey="level"
                name={t('Battery Level')}
                stroke={CHART_COLORS[0]}
                fill="url(#levelGrad)"
                strokeWidth={2}
              />
            </AreaChart>
          </ResponsiveContainer>
        </GlassPanel>
      </FadeIn>

      {/* ── Charge Habits Analysis ─────────────────────────────── */}
      <FadeIn delay={0.15}>
        <GlassPanel>
          <Badge
            variant={habitsVariant(data.charge_habits_score)}
            className="mb-4"
          >
            {t('Charge Habits Score')}: {data.charge_habits_score}
          </Badge>
          <Grid cols={{ default: 2, md: 4 }} gap={4}>
            <RadialGauge
              value={data.fast_charge_pct}
              max={100}
              label={t('Fast Charge %')}
              unit="%"
              color={CHART_COLORS[5]}
              size={110}
            />
            <RadialGauge
              value={data.full_charge_pct}
              max={100}
              label={t('Full Charge %')}
              unit="%"
              color={CHART_COLORS[3]}
              size={110}
            />
            <MetricCard
              label={t('Avg Depth of Discharge')}
              value={fmtPercent(data.avg_depth_of_discharge)}
              icon={<Zap className="h-5 w-5" />}
              color="amber"
            />
            <MetricCard
              label={t('Habits Score')}
              value={fmtNumber(data.charge_habits_score, 0)}
              icon={<Heart className="h-5 w-5" />}
              color="green"
            />
          </Grid>
        </GlassPanel>
      </FadeIn>

      {/* ── Temperature Exposure ───────────────────────────────── */}
      <FadeIn delay={0.2}>
        <GlassPanel>
          <Badge variant="info" className="mb-4">
            <Thermometer className="mr-1 inline h-4 w-4" />
            {t('Temperature Exposure')}
          </Badge>
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={data.temp_distribution}>
              <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
              <XAxis dataKey="range" stroke="#94a3b8" fontSize={12} />
              <YAxis
                tickFormatter={(v: number) => `${v}h`}
                stroke="#94a3b8"
                fontSize={12}
              />
              <Tooltip content={<ChartTooltip />} />
              <Bar
                dataKey="hours"
                name={t('Hours')}
                radius={[4, 4, 0, 0]}
              >
                {data.temp_distribution.map((entry, idx) => (
                  <rect key={idx} fill={entry.color} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </GlassPanel>
      </FadeIn>

      {/* ── Quick Links ────────────────────────────────────────── */}
      <FadeIn delay={0.25}>
        <GlassPanel>
          <Grid cols={{ default: 2, md: 3 }} gap={3}>
            {QUICK_LINKS.map((link) => (
              <Link key={link.to} to={link.to}>
                <Button
                  variant="outline"
                  className="w-full justify-between"
                  icon={<ArrowRight className="h-4 w-4" />}
                >
                  {t(link.label)}
                </Button>
              </Link>
            ))}
          </Grid>
        </GlassPanel>
      </FadeIn>

      {/* ── Recommendations ────────────────────────────────────── */}
      <FadeIn delay={0.3}>
        <GlassPanel glow="green">
          <Badge variant="success" className="mb-3">
            <Lightbulb className="mr-1 inline h-4 w-4" />
            {t('Recommendations')}
          </Badge>
          <ul className={clsx('space-y-2 text-sm text-gray-300')}>
            {recommendations.map((tip, idx) => (
              <li key={idx} className="flex items-start gap-2">
                <Lightbulb className="mt-0.5 h-4 w-4 shrink-0 text-green-400" />
                {tip}
              </li>
            ))}
          </ul>
        </GlassPanel>
      </FadeIn>
    </PageContainer>
  );
}
