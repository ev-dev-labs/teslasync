import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { Link } from 'react-router-dom';
import {
  Heart, Battery, BatteryFull, Gauge, RefreshCcw, Clock,
  Zap, ArrowRight, Lightbulb, AlertTriangle,
  CheckCircle, Info, Target, Activity,
  Thermometer, ThermometerSun, ThermometerSnowflake, Flame,
} from 'lucide-react';

import { PageContainer, Grid } from '@/components/layout';
import { GlassPanel, Badge, Button } from '@/components/ui';
import {
  RadialGauge, ChartContainer, ChartTooltip, ChartGradient,
  chartGrid, axisTickSm, CHART_COLORS, renderAnnotationLines,
  AreaChart, Area, BarChart, Bar, ComposedChart, Line, ReferenceLine,
  PieChart, Pie, Cell, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend,
  AREA_DEFAULTS, TimeMarker,
} from '@/components/charts';
import { MetricCard, MetricBar, LiveIndicator } from '@/components/data-display';
import { Skeleton, EmptyState, LiveStaleDataBanner, SectionErrorBoundary, StatGridSkeleton, ChartBlockSkeleton, PageHeaderSkeleton } from '@/components/feedback';
import { FadeIn } from '@/components/motion';

import { useBatteryHealthAnalytics, useBatteryDegradation } from '@/api/hooks/useEnergy';
import { useChargingSessionsPaginated } from '@/api/hooks/useCharging';
import { useChargingTelemetryLatest } from '@/api/hooks/useVehicles';
import { useSettings } from '@/hooks/useSettings';
import { usePageTitle } from '@/hooks/usePageTitle';
import { useAlertContext } from '@/hooks/useAlertContext';
import { useSelectedVehicle } from '@/hooks/useSelectedVehicle';
import { NoVehicleSelected } from '@/features/onboarding/components/NoVehicleSelected';
import { cn } from '@/lib/cn';
import { COLOR, STATUS_COLORS } from '@/lib/colors';
import { fmtNumber, fmtPercent, fmtInt } from '@/lib/numberFormat';
import { formatDateShort } from '@/lib/dateFormat';
import type { BatteryHealthAnalytics } from '@/types/energy';
import type { ChargingSession } from '@/api/types';

/* ── Helpers ──────────────────────────────────────────────────────── */

interface InsightItem {
  icon: React.ReactNode;
  title: string;
  description: string;
  status: 'good' | 'warning' | 'critical';
}

const insightPanelClass = {
  good: 'border-neon-green/20 bg-neon-green/5',
  warning: 'border-neon-amber/20 bg-neon-amber/5',
  critical: 'border-neon-red/20 bg-neon-red/5',
} as const;

const insightIconClass = {
  good: 'text-emerald-300',
  warning: 'text-amber-300',
  critical: 'text-rose-300',
} as const;

function gaugeColor(score: number): string {
  if (score >= 90) return CHART_COLORS[1];
  if (score >= 70) return CHART_COLORS[3];
  return CHART_COLORS[5];
}

function healthVariant(score: number): 'success' | 'warning' | 'danger' {
  if (score >= 90) return 'success';
  if (score >= 70) return 'warning';
  return 'danger';
}

function healthLabel(score: number, t: (k: string, fb: string) => string): string {
  if (score >= 90) return t('battery.health.excellent', 'Excellent');
  if (score >= 70) return t('battery.health.good', 'Good');
  return t('battery.health.degraded', 'Degraded');
}

function degradationColor(pct: number): string {
  if (pct <= 5) return '#10b981';
  if (pct <= 15) return '#f59e0b';
  return '#ef4444';
}

function buildInsights(
  health: BatteryHealthAnalytics,
  sessions: ChargingSession[] | null,
  t: TFunction,
): InsightItem[] {
  const items: InsightItem[] = [];

  if (health.current_soh >= 90) {
    items.push({
      icon: <CheckCircle className="h-4 w-4" />,
      title: t('battery.insight.excellentTitle', 'Excellent Health'),
      description: t('battery.insight.excellentDesc', { soh: fmtNumber(health.current_soh, 0), defaultValue: 'Battery health is {{soh}}/100 — performing above average.' }),
      status: 'good',
    });
  } else if (health.current_soh >= 70) {
    items.push({
      icon: <Info className="h-4 w-4" />,
      title: t('battery.insight.goodTitle', 'Good Health'),
      description: t('battery.insight.goodDesc', { soh: fmtNumber(health.current_soh, 0), defaultValue: 'Battery health is {{soh}}/100 — normal degradation for age.' }),
      status: 'warning',
    });
  } else {
    items.push({
      icon: <AlertTriangle className="h-4 w-4" />,
      title: t('battery.insight.concernTitle', 'Health Concern'),
      description: t('battery.insight.concernDesc', { soh: fmtNumber(health.current_soh, 0), defaultValue: 'Battery health dropped to {{soh}}/100 — consider service check.' }),
      status: 'critical',
    });
  }

  if (health.fast_charge_pct > 50) {
    items.push({
      icon: <AlertTriangle className="h-4 w-4" />,
      title: t('battery.insight.highFastChargeTitle', 'High Fast-Charge Usage'),
      description: t('battery.insight.highFastChargeDesc', { pct: fmtPercent(health.fast_charge_pct), defaultValue: '{{pct}} of sessions are fast-charging. Mix in slow charging for longevity.' }),
      status: 'warning',
    });
  } else {
    items.push({
      icon: <CheckCircle className="h-4 w-4" />,
      title: t('battery.insight.goodHabitsTitle', 'Good Charging Habits'),
      description: t('battery.insight.goodHabitsDesc', 'Most charges are slow/AC — ideal for battery longevity.'),
      status: 'good',
    });
  }

  if (sessions) {
    const deepDischarges = sessions.filter((s) => s.start_battery_pct < 10).length;
    if (deepDischarges > 3) {
      items.push({
        icon: <AlertTriangle className="h-4 w-4" />,
        title: t('battery.insight.deepDischargeTitle', 'Deep Discharges Detected'),
        description: t('battery.insight.deepDischargeDesc', { count: deepDischarges, defaultValue: '{{count}} recent sessions started below 10%. Avoid deep discharges when possible.' }),
        status: 'warning',
      });
    }

    const superchargerCount = sessions.filter((s) =>
      s.charger_type?.toLowerCase().includes('tesla'),
    ).length;
    if (superchargerCount > sessions.length * 0.6) {
      items.push({
        icon: <Info className="h-4 w-4" />,
        title: t('battery.insight.highSuperchargerTitle', 'High Supercharger Usage'),
        description: t('battery.insight.highSuperchargerDesc', { count: superchargerCount, defaultValue: '{{count}} Supercharger sessions. Occasional slow charging helps battery health.' }),
        status: 'warning',
      });
    }
  }

  if (health.degradation_rate_yr < 3) {
    items.push({
      icon: <Target className="h-4 w-4" />,
      title: t('battery.insight.lowDegTitle', 'Low Degradation Rate'),
      description: t('battery.insight.lowDegDesc', { rate: fmtNumber(health.degradation_rate_yr, 1), defaultValue: '{{rate}}% per year — well below industry average of 3–5%.' }),
      status: 'good',
    });
  }

  return items;
}

function buildRecommendations(
  health: BatteryHealthAnalytics,
  t: (k: string, fb: string) => string,
): string[] {
  const tips: string[] = [];
  if (health.fast_charge_pct > 30)
    tips.push(t('battery.tip.reduceFast', 'Reduce fast charging frequency to slow degradation.'));
  if (health.full_charge_pct > 40)
    tips.push(t('battery.tip.avoid100', 'Avoid charging to 100% regularly — keep the limit at 80–90%.'));
  if (health.avg_depth_of_discharge > 70)
    tips.push(t('battery.tip.avoidDeep', 'Try to avoid deep discharges below 20%.'));
  if (health.degradation_rate_yr > 3)
    tips.push(t('battery.tip.aboveAvg', 'Your degradation rate is above average — review charging habits.'));
  if (tips.length === 0)
    tips.push(t('battery.tip.great', 'Your battery health looks great — keep up the good habits!'));
  return tips;
}

const QUICK_LINKS: { to: string; labelKey: string; fallback: string }[] = [
  { to: '/battery-cells', labelKey: 'battery.links.cells', fallback: 'Battery Cells' },
  { to: '/battery-degradation', labelKey: 'battery.links.degradation', fallback: 'Degradation' },
  { to: '/energy-flow', labelKey: 'battery.links.energyFlow', fallback: 'Energy Flow' },
  { to: '/projected-range', labelKey: 'battery.links.projectedRange', fallback: 'Projected Range' },
  { to: '/vampire-drain', labelKey: 'battery.links.vampireDrain', fallback: 'Vampire Drain' },
  { to: '/sleep-efficiency', labelKey: 'battery.links.sleepEfficiency', fallback: 'Sleep Efficiency' },
];

/* ── Loading skeleton ────────────────────────────────────────────── */

/**
 * Mirrors the BatteryHealthPage layout while data loads:
 * page header → 6 hero metric cards → degradation prediction chart →
 * insights panel → recommendations panel → charging habits chart →
 * quick-links row. Phase-45 / Prompt 18.
 */
function BatteryHealthSkeleton() {
  return (
    <div className="space-y-6" data-testid="battery-health-skeleton">
      <PageHeaderSkeleton />
      <StatGridSkeleton cards={6} className="md:grid-cols-3 lg:grid-cols-6" />
      <ChartBlockSkeleton height={360} />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Skeleton className="h-56 rounded-xl" />
        <Skeleton className="h-56 rounded-xl" />
      </div>
      <ChartBlockSkeleton height={300} />
      <StatGridSkeleton cards={6} className="md:grid-cols-3 lg:grid-cols-6" />
    </div>
  );
}

/* ── Page ─────────────────────────────────────────────────────────── */

export default function BatteryHealthPage() {
  const { t } = useTranslation();
  usePageTitle(t('battery.title', 'Battery Health'));
  const { convertDistance, distanceUnit, convertTemp, tempUnit } = useSettings();

  /* ── Vehicle selector (Phase 40 / Prompt 16: header picker is the source of truth) ─ */
  // Alert drillthrough URLs (?vehicle_id=…&t=…) flow into the global store
  // via useSelectedVehicle; useAlertContext is still consulted for the
  // timestamp & signal name used by the chart marker below.
  const alertCtx = useAlertContext();
  const { vehicleId } = useSelectedVehicle();
  const vehicleIdStr = vehicleId != null ? String(vehicleId) : null;

  // The alert timestamp used for the chart marker, formatted to match the
  // chart's `dataKey="label"` (formatDateShort). Recharts ReferenceLine matches
  // string x-values exactly, so we format the alert moment the same way.
  const alertMarkerLabel = useMemo(
    () => (alertCtx.timestamp ? formatDateShort(alertCtx.timestamp) : null),
    [alertCtx.timestamp],
  );

  /* ── Data fetching ─────────────────────────────────────────────── */
  const { data: health, isLoading: healthLoading, error: healthError } =
    useBatteryHealthAnalytics(vehicleIdStr);
  const { data: degradation } = useBatteryDegradation(vehicleIdStr);
  const { data: sessions } = useChargingSessionsPaginated(vehicleId, { limit: 100 });
  const { data: chargingLive } = useChargingTelemetryLatest(vehicleId ?? 0);

  /* ── Derived: insights & recommendations ───────────────────────── */
  const insights = useMemo(
    () => (health ? buildInsights(health, sessions ?? null, t) : []),
    [health, sessions, t],
  );
  const recommendations = useMemo(
    () => (health ? buildRecommendations(health, t) : []),
    [health, t],
  );

  /* ── Derived: prediction chart ─────────────────────────────────── */
  const predictionChartData = useMemo(() => {
    const hist = (health?.history ?? []).map((h) => ({
      label: formatDateShort(h.date),
      actual: h.soh_pct,
      predicted: undefined as number | undefined,
    }));
    const proj = (degradation?.prediction?.projection_points ?? []).map((p) => ({
      label: p.month.slice(0, 7),
      actual: undefined as number | undefined,
      predicted: p.health,
    }));
    // Overlap last actual point into prediction for continuity
    if (hist.length > 0 && proj.length > 0) {
      proj[0] = { ...proj[0], actual: hist[hist.length - 1].actual };
    }
    return [...hist, ...proj];
  }, [health, degradation]);

  /* ── Derived: range trend ──────────────────────────────────────── */
  const rangeTrend = useMemo(
    () =>
      (health?.history ?? []).map((h) => ({
        label: formatDateShort(h.date),
        range: Math.round(convertDistance(h.range_km)),
      })),
    [health, convertDistance],
  );

  /* ── Derived: charge level distribution ────────────────────────── */
  const chargeLevelDist = useMemo(() => {
    const items = sessions ?? [];
    if (items.length === 0) return [];
    const buckets = Array.from({ length: 10 }, (_, i) => ({
      range: `${i * 10}–${i * 10 + 10}%`,
      startCount: 0,
      endCount: 0,
    }));
    items.forEach((s) => {
      const si = Math.min(Math.floor(s.start_battery_pct / 10), 9);
      buckets[si].startCount++;
      if (s.end_battery_pct != null) {
        const ei = Math.min(Math.floor(s.end_battery_pct / 10), 9);
        buckets[ei].endCount++;
      }
    });
    return buckets;
  }, [sessions]);

  /* ── Derived: charging habits from sessions ────────────────────── */
  const chargingHabits = useMemo(() => {
    const items = sessions ?? [];
    if (items.length === 0) return null;
    const startLevels = items.map((s) => s.start_battery_pct);
    const endLevels = items.filter((s) => s.end_battery_pct != null).map((s) => s.end_battery_pct!);
    const avgStart = startLevels.length > 0 ? startLevels.reduce((a, b) => a + b, 0) / startLevels.length : 0;
    const avgEnd = endLevels.length > 0 ? endLevels.reduce((a, b) => a + b, 0) / endLevels.length : 80;
    const superchargerCount = items.filter((s) => s.charger_type?.toLowerCase().includes('tesla')).length;
    const dcFastCount = items.filter((s) => s.charger_type && !s.charger_type.toLowerCase().includes('tesla')).length;
    return { avgStart, avgEnd, superchargerCount, dcFastCount, total: items.length };
  }, [sessions]);

  /* ── Derived: AC/DC breakdown ──────────────────────────────────── */
  const energyBreakdown = useMemo(() => {
    const items = sessions ?? [];
    if (items.length === 0) return null;
    let acEnergy = 0, dcEnergy = 0, acCount = 0, dcCount = 0;
    items.forEach((s) => {
      const isDC =
        (s.charger_type != null && s.charger_type.length > 0) ||
        (s.charger_power_kw_max != null && s.charger_power_kw_max > 20);
      const energy = s.energy_added_kwh ?? 0;
      if (isDC) { dcEnergy += energy; dcCount++; }
      else { acEnergy += energy; acCount++; }
    });
    return {
      pieData: [
        { name: 'AC', value: +(fmtNumber(acEnergy, 1)), fill: '#10b981' },
        { name: 'DC', value: +(fmtNumber(dcEnergy, 1)), fill: '#f59e0b' },
      ],
      acCount,
      dcCount,
      totalEnergy: acEnergy + dcEnergy,
      totalSessions: items.length,
    };
  }, [sessions]);

  const yearsTo80 = degradation?.prediction?.has_enough_data
    ? fmtNumber(degradation.prediction.years_to_80_pct, 1)
    : '—';

  /* ── No vehicle: defensive guard (Phase 40 / Prompt 18) ───────── */
  if (vehicleId == null) {
    return <NoVehicleSelected pageTitle={t('battery.title', 'Battery Health')} />;
  }

  /* ── Loading ───────────────────────────────────────────────────── */
  if (healthLoading) {
    return <BatteryHealthSkeleton />;
  }

  /* ── Empty / error ─────────────────────────────────────────────── */
  if (!health) {
    return (
      <PageContainer
        title={t('battery.title', 'Battery Health')}
        subtitle={t('battery.subtitle', 'Degradation tracking, prediction, charging habits & longevity insights')}
        error={healthError as Error | null}
      >
        <EmptyState /* no-action: transient empty state — surfaces when source data is missing; no specific recovery action available */
          icon={<Battery className="h-10 w-10" />}
          message={t('battery.empty', 'No battery health data available yet.')}
        />
      </PageContainer>
    );
  }

  /* ── Main render ───────────────────────────────────────────────── */
  return (
    <PageContainer
      title={t('battery.title', 'Battery Health')}
      subtitle={t('battery.subtitle', 'Degradation tracking, prediction, charging habits & longevity insights')}
      actions={
        <span className="flex items-center gap-3">
          <LiveIndicator variant="compact" />
        </span>
      }
    >
      <LiveStaleDataBanner />
      {/* ── 1. Health Score Hero ──────────────────────────────────── */}
      <SectionErrorBoundary name="battery:health-hero" fallbackTitle={t('battery.section.heroFailed', 'Health score panel failed to load')}>
        <FadeIn>
          <GlassPanel className="p-4 sm:p-6 lg:p-8">
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-4 sm:gap-6 items-center">
            <div className="col-span-2 sm:col-span-1 flex flex-col items-center">
              <RadialGauge
                value={health.current_soh}
                max={100}
                label={t('battery.gauge.health', 'Health Score')}
                unit="/100"
                size={130}
                color={gaugeColor(health.current_soh)}
              />
              <Badge variant={healthVariant(health.current_soh)} className="mt-2">
                {healthLabel(health.current_soh, t)}
              </Badge>
            </div>
            <RadialGauge
              value={100 - (health.estimated_capacity / health.original_capacity * 100 - 100 + 100)}
              max={100}
              label={t('battery.gauge.capacity', 'Capacity')}
              unit="%"
              color="#00f0ff"
            />
            <RadialGauge
              value={health.degradation_rate_yr}
              max={10}
              label={t('battery.gauge.degradation', 'Degradation')}
              unit="%/yr"
              color={degradationColor(health.degradation_rate_yr)}
            />
            <RadialGauge
              value={health.total_cycles}
              max={1500}
              label={t('battery.gauge.cycles', 'Cycles')}
              unit=""
              color="#a855f7"
            />
            <div className="flex flex-col items-center text-center">
              <p className="text-3xl font-bold text-[var(--text-primary)]">{yearsTo80}</p>
              <p className="text-[10px] text-[var(--text-muted)] uppercase tracking-wider mt-1">
                {t('battery.yearsTo80', 'Years to 80%')}
              </p>
              <p className="text-[10px] text-[var(--text-muted)]">
                {t('battery.warrantyNote', 'warranty threshold')}
              </p>
            </div>
          </div>
        </GlassPanel>
      </FadeIn>
      </SectionErrorBoundary>

      {/* ── 2. Metric Bars ───────────────────────────────────────── */}
      <SectionErrorBoundary name="battery:metric-bars" fallbackTitle={t('battery.section.metricBarsFailed', 'Metric bars failed to load')}>
        <FadeIn delay={0.05}>
          <GlassPanel className="p-6">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
            <div>
              <MetricBar
                label={t('battery.bar.capacity', 'Current Capacity')}
                value={Math.round(health.estimated_capacity / health.original_capacity * 100)}
                max={100}
                color="#00f0ff"
              />
              <p className="text-[10px] text-[var(--text-muted)] mt-1">
                {fmtNumber(health.estimated_capacity, 1)} / {fmtNumber(health.original_capacity, 1)} kWh
              </p>
            </div>
            <div>
              <MetricBar
                label={t('battery.bar.degradation', 'Degradation')}
                value={health.degradation_rate_yr}
                max={10}
                color={degradationColor(health.degradation_rate_yr)}
              />
              <p className="text-[10px] text-[var(--text-muted)] mt-1">
                {fmtNumber(health.degradation_rate_yr, 2)}% {t('battery.perYear', 'per year')}
              </p>
            </div>
            <div>
              <MetricBar
                label={t('battery.bar.cycles', 'Charge Cycles')}
                value={health.total_cycles}
                max={1500}
                color="#a855f7"
              />
              <p className="text-[10px] text-[var(--text-muted)] mt-1">
                {t('battery.warrantyLimit', 'Tesla warranty: 1,500 cycles / 70%')}
              </p>
            </div>
          </div>
        </GlassPanel>
      </FadeIn>
      </SectionErrorBoundary>

      {/* ── 3. Summary Metric Cards ──────────────────────────────── */}
      <SectionErrorBoundary name="battery:summary-cards" fallbackTitle={t('battery.section.summaryCardsFailed', 'Summary metrics failed to load')}>
        <FadeIn delay={0.1}>
          <Grid cols={{ default: 2, lg: 3 }} gap={4}>
          <MetricCard
            label={t('battery.metric.soh', 'State of Health')}
            value={fmtPercent(health.current_soh)}
            icon={<Heart className="h-5 w-5" />}
            color="cyan"
          />
          <MetricCard
            label={t('battery.metric.currentCap', 'Current Capacity')}
            value={`${fmtNumber(health.estimated_capacity, 1)} kWh`}
            icon={<Battery className="h-5 w-5" />}
            color="green"
          />
          <MetricCard
            label={t('battery.metric.originalCap', 'Original Capacity')}
            value={`${fmtNumber(health.original_capacity, 1)} kWh`}
            icon={<BatteryFull className="h-5 w-5" />}
            color="blue"
          />
          <MetricCard
            label={t('battery.metric.degradation', 'Degradation Rate')}
            value={`${fmtNumber(health.degradation_rate_yr, 2)}%/${t('battery.yr', 'yr')}`}
            icon={<Gauge className="h-5 w-5" />}
            color="amber"
          />
          <MetricCard
            label={t('battery.metric.cycles', 'Total Cycles')}
            value={fmtNumber(health.total_cycles, 0)}
            icon={<RefreshCcw className="h-5 w-5" />}
            color="purple"
          />
          <MetricCard
            label={t('battery.metric.age', 'Battery Age')}
            value={`${health.battery_age_months} ${t('battery.months', 'months')}`}
            icon={<Clock className="h-5 w-5" />}
            color="red"
          />
          <MetricCard
            label={t('battery.metric.fullChargeComplete', 'Full Charge Complete')}
            value={
              chargingLive?.bms_fullcharge_complete == null
                ? '—'
                : chargingLive.bms_fullcharge_complete
                  ? t('common.yes', 'Yes')
                  : t('common.no', 'No')
            }
            icon={<CheckCircle className="h-5 w-5" />}
            color={chargingLive?.bms_fullcharge_complete ? 'green' : 'cyan'}
          />
        </Grid>
      </FadeIn>
      </SectionErrorBoundary>

      {/* ── 3b. Thermal Monitoring ───────────────────────────────── */}
      <SectionErrorBoundary name="battery:thermal" fallbackTitle={t('battery.section.thermalFailed', 'Thermal monitoring failed to load')}>
        <FadeIn delay={0.12}>
          <GlassPanel className="p-6">
          <div className="flex items-center gap-2 mb-4">
            <Thermometer className="h-4 w-4 text-neon-amber" />
            <h3 className="text-sm font-semibold text-[var(--text-primary)]">
              {t('battery.thermal.title', 'Thermal Monitoring')}
            </h3>
          </div>
          <Grid cols={{ default: 2, lg: 4 }} gap={4}>
            <MetricCard
              label={t('battery.thermal.moduleTempMax', 'Module Temp (Max)')}
              value={
                chargingLive?.module_temp_max != null
                  ? `${fmtNumber(convertTemp(chargingLive.module_temp_max), 1)} ${tempUnit}`
                  : '—'
              }
              subtitle={
                chargingLive?.num_module_temp_max != null
                  ? t('battery.thermal.moduleNumber', 'Module #{{n}}', {
                      n: chargingLive.num_module_temp_max,
                    })
                  : undefined
              }
              icon={<ThermometerSun className="h-5 w-5" />}
              color="amber"
            />
            <MetricCard
              label={t('battery.thermal.moduleTempMin', 'Module Temp (Min)')}
              value={
                chargingLive?.module_temp_min != null
                  ? `${fmtNumber(convertTemp(chargingLive.module_temp_min), 1)} ${tempUnit}`
                  : '—'
              }
              subtitle={
                chargingLive?.num_module_temp_min != null
                  ? t('battery.thermal.moduleNumber', 'Module #{{n}}', {
                      n: chargingLive.num_module_temp_min,
                    })
                  : undefined
              }
              icon={<ThermometerSnowflake className="h-5 w-5" />}
              color="cyan"
            />
            <MetricCard
              label={t('battery.thermal.heater', 'Battery Heater')}
              value={
                chargingLive?.battery_heater_on == null
                  ? '—'
                  : chargingLive.battery_heater_on
                    ? t('common.on', 'On')
                    : t('common.off', 'Off')
              }
              icon={<Flame className="h-5 w-5" />}
              color={chargingLive?.battery_heater_on ? 'red' : 'green'}
            />
            <MetricCard
              label={t('battery.thermal.tempSpread', 'Temperature Spread')}
              value={
                chargingLive?.module_temp_max != null && chargingLive?.module_temp_min != null
                  ? `${fmtNumber(
                      convertTemp(chargingLive.module_temp_max) -
                        convertTemp(chargingLive.module_temp_min),
                      1,
                    )} ${tempUnit}`
                  : '—'
              }
              icon={<Activity className="h-5 w-5" />}
              color="purple"
            />
          </Grid>
        </GlassPanel>
      </FadeIn>
      </SectionErrorBoundary>

      {/* ── 4. Smart Insights ────────────────────────────────────── */}
      <SectionErrorBoundary name="battery:insights" fallbackTitle={t('battery.section.insightsFailed', 'Smart insights failed to load')}>
        <FadeIn delay={0.15}>
          <div className="space-y-2">
          <h3 className="section-title flex items-center gap-2">
            <Heart className="h-4 w-4 text-neon-red" />
            {t('battery.insights.title', 'Smart Insights')}
          </h3>
          {insights.length > 0 ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {insights.map((ins, i) => (
                <GlassPanel
                  key={i}
                  className={cn('border p-4 transition-all duration-normal', insightPanelClass[ins.status])}
                >
                  <div className="flex items-start gap-3">
                    <div className={cn('mt-0.5', insightIconClass[ins.status])}>{ins.icon}</div>
                    <div>
                      <p className="text-sm font-medium text-[var(--text-primary)]">{ins.title}</p>
                      <p className="mt-0.5 text-xs text-[var(--text-secondary)]">{ins.description}</p>
                    </div>
                  </div>
                </GlassPanel>
              ))}
            </div>
          ) : (
            <EmptyState /* no-action: transient empty state — surfaces when source data is missing; no specific recovery action available */
              icon={<Info className="h-8 w-8" />}
              message={t('battery.insights.empty', 'Not enough data for insights yet')}
              className="py-6"
            />
          )}
        </div>
      </FadeIn>
      </SectionErrorBoundary>

      {/* ── 5. Capacity Trend & Prediction ───────────────────────── */}
      <FadeIn delay={0.2}>
        <ChartContainer
          title={t('battery.chart.capacityTrend', 'Capacity Trend & Prediction')}
          subtitle={t('battery.chart.dashedProjected', 'Dashed = projected')}
          exportable
          exportFilename="capacity-trend"
        >
          {predictionChartData.length > 0 ? (
            <div className="h-48 sm:h-72">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={predictionChartData}>
                  <defs>
                    <ChartGradient id="healthGrad" color={COLOR.CYAN} opacity={0.15} />
                  </defs>
                  {chartGrid}
                  <XAxis dataKey="label" tick={axisTickSm} tickLine={false} axisLine={false} />
                  <YAxis domain={[60, 100]} tick={axisTickSm} tickLine={false} axisLine={false} unit="%" />
                  <Tooltip content={<ChartTooltip />} />
                  <ReferenceLine y={70} stroke={STATUS_COLORS.critical} strokeDasharray="8 4" />
                  <ReferenceLine y={80} stroke={STATUS_COLORS.warning} strokeDasharray="4 4" />
                  <TimeMarker x={alertMarkerLabel} severity={alertCtx.signal ? 'critical' : undefined} />
                  <Area {...AREA_DEFAULTS} dataKey="actual" name={t('battery.chart.actual', 'Actual %')} stroke="transparent" fill="url(#healthGrad)" />
                  <Line {...AREA_DEFAULTS} dataKey="actual" name={t('battery.chart.actual', 'Actual %')} stroke={COLOR.CYAN} dot={{ fill: COLOR.CYAN, r: 2 }} connectNulls={false} />
                  <Line {...AREA_DEFAULTS} dataKey="predicted" name={t('battery.chart.predicted', 'Predicted %')} stroke={COLOR.CYAN} strokeDasharray="6 4" opacity={0.5} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <EmptyState /* no-action: transient empty state — surfaces when source data is missing; no specific recovery action available */
              icon={<Activity className="h-8 w-8" />}
              message={t('battery.chart.noTrend', 'Not enough snapshots for trend analysis')}
              className="py-8"
            />
          )}
        </ChartContainer>
      </FadeIn>

      {/* ── 6. Range Trend ───────────────────────────────────────── */}
      <FadeIn delay={0.25}>
        <ChartContainer
          title={t('battery.chart.rangeTrend', 'Estimated Range Over Time')}
          exportable
          exportFilename="range-trend"
          annotations={{ vehicleId, scope: 'battery', chartId: 'battery-health-range-trend' }}
        >
          {({ annotations: chartAnnotations }) =>
            rangeTrend.length > 0 ? (
              <div className="h-44 sm:h-60">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={rangeTrend}>
                    <defs>
                      <ChartGradient id="rangeGrad" color={COLOR.GOOD} opacity={0.3} />
                    </defs>
                    {chartGrid}
                    <XAxis dataKey="label" tick={axisTickSm} tickLine={false} axisLine={false} />
                    <YAxis tick={axisTickSm} tickLine={false} axisLine={false} />
                    <Tooltip content={<ChartTooltip />} />
                    <TimeMarker x={alertMarkerLabel} severity={alertCtx.signal ? 'critical' : undefined} />
                    {renderAnnotationLines(chartAnnotations, (ts) => ts)}
                    <Area
                      {...AREA_DEFAULTS}
                      dataKey="range"
                      name={`${t('battery.chart.range', 'Range')} (${distanceUnit})`}
                      stroke={COLOR.GOOD}
                      fill="url(#rangeGrad)"
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <EmptyState /* no-action: transient empty state — surfaces when source data is missing; no specific recovery action available */
                icon={<Activity className="h-8 w-8" />}
                message={t('battery.chart.noRange', 'No range data yet')}
                className="py-8"
              />
            )
          }
        </ChartContainer>
      </FadeIn>

      {/* ── 7. Charge Level Distribution ─────────────────────────── */}
      <SectionErrorBoundary name="battery:charge-level-dist" fallbackTitle={t('battery.section.chargeDistFailed', 'Charge level distribution failed to load')}>
        <FadeIn delay={0.3}>
          <GlassPanel className="p-6">
          <h3 className="section-title mb-4 flex items-center gap-2">
            <Zap className="h-4 w-4 text-neon-amber" />
            {t('battery.chart.chargeDist', 'Charge Level Distribution')}
            <span className="text-xs text-[var(--text-muted)] font-normal ml-2">
              {t('battery.chart.chargeDistSub', 'Recent 100 sessions')}
            </span>
          </h3>
          {chargeLevelDist.length > 0 ? (
            <>
              <div className="h-40 sm:h-56">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={chargeLevelDist}>
                    {chartGrid}
                    <XAxis dataKey="range" tick={axisTickSm} tickLine={false} axisLine={false} />
                    <YAxis tick={axisTickSm} tickLine={false} axisLine={false} />
                    <Tooltip content={<ChartTooltip />} />
                    <Bar dataKey="startCount" name={t('battery.chart.chargeStarted', 'Charge Started')} fill="#ef4444" fillOpacity={0.5} radius={[3, 3, 0, 0]} />
                    <Bar dataKey="endCount" name={t('battery.chart.chargeEnded', 'Charge Ended')} fill="#10b981" fillOpacity={0.5} radius={[3, 3, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
              {chargingHabits && (
                <div className="mt-4 grid grid-cols-2 sm:grid-cols-4 gap-3">
                  <div className="text-center">
                    <p className="text-lg font-bold text-[var(--text-primary)]">{fmtPercent(chargingHabits.avgStart)}</p>
                    <p className="text-[10px] text-[var(--text-muted)]">{t('battery.habit.avgStart', 'Avg Start Level')}</p>
                  </div>
                  <div className="text-center">
                    <p className="text-lg font-bold text-emerald-300">{fmtPercent(chargingHabits.avgEnd)}</p>
                    <p className="text-[10px] text-[var(--text-muted)]">{t('battery.habit.avgEnd', 'Avg End Level')}</p>
                  </div>
                  <div className="text-center">
                    <p className="text-lg font-bold text-amber-300">{chargingHabits.superchargerCount}</p>
                    <p className="text-[10px] text-[var(--text-muted)]">{t('battery.habit.supercharger', 'Supercharger Sessions')}</p>
                  </div>
                  <div className="text-center">
                    <p className="text-lg font-bold text-cyan-300">
                      {chargingHabits.total - chargingHabits.superchargerCount - chargingHabits.dcFastCount}
                    </p>
                    <p className="text-[10px] text-[var(--text-muted)]">{t('battery.habit.home', 'Home Charges')}</p>
                  </div>
                </div>
              )}
            </>
          ) : (
            <EmptyState /* no-action: transient empty state — surfaces when source data is missing; no specific recovery action available */
              icon={<Zap className="h-8 w-8" />}
              message={t('battery.chart.noSessions', 'No charging session data yet')}
              className="py-8"
            />
          )}
        </GlassPanel>
      </FadeIn>
      </SectionErrorBoundary>

      {/* ── 8. Capacity & Range: New vs Now ──────────────────────── */}
      <SectionErrorBoundary name="battery:capacity-range" fallbackTitle={t('battery.section.capacityRangeFailed', 'Capacity & range comparison failed to load')}>
        <FadeIn delay={0.35}>
          <GlassPanel className="p-6">
          <h3 className="section-title mb-6 flex items-center gap-2">
            <Activity className="h-4 w-4 text-neon-cyan" />
            {t('battery.newVsNow.title', 'Capacity & Range: New vs Now')}
          </h3>
          <Grid cols={{ default: 2, md: 4 }} gap={4}>
            <GlassPanel className="p-4 text-center">
              <p className="text-[10px] uppercase tracking-wider text-[var(--text-muted)] mb-1">
                {t('battery.newVsNow.capNew', 'Capacity When New')}
              </p>
              <p className="text-2xl font-bold text-[var(--text-primary)]">
                {fmtNumber(health.original_capacity, 1)}
                <span className="text-sm text-[var(--text-muted)]"> kWh</span>
              </p>
            </GlassPanel>
            <GlassPanel className="p-4 text-center">
              <p className="text-[10px] uppercase tracking-wider text-[var(--text-muted)] mb-1">
                {t('battery.newVsNow.capNow', 'Capacity Now')}
              </p>
              <p className="text-2xl font-bold text-cyan-300">
                {fmtNumber(health.estimated_capacity, 1)}
                <span className="text-sm text-[var(--text-muted)]"> kWh</span>
              </p>
              <p className="text-[10px] text-rose-300 mt-1">
                -{fmtNumber(health.original_capacity - health.estimated_capacity, 1)} kWh
              </p>
            </GlassPanel>
            <GlassPanel className="p-4 text-center">
              <p className="text-[10px] uppercase tracking-wider text-[var(--text-muted)] mb-1">
                {t('battery.newVsNow.rangeNew', 'Range When New')}
              </p>
              <p className="text-2xl font-bold text-[var(--text-primary)]">
                {health.history.length > 0
                  ? fmtInt(convertDistance(health.history[0].range_km))
                  : '—'}
                <span className="text-sm text-[var(--text-muted)]"> {distanceUnit}</span>
              </p>
            </GlassPanel>
            <GlassPanel className="p-4 text-center">
              <p className="text-[10px] uppercase tracking-wider text-[var(--text-muted)] mb-1">
                {t('battery.newVsNow.rangeNow', 'Range Now')}
              </p>
              <p className="text-2xl font-bold text-emerald-300">
                {health.history.length > 0
                  ? fmtInt(convertDistance(health.history[health.history.length - 1].range_km))
                  : '—'}
                <span className="text-sm text-[var(--text-muted)]"> {distanceUnit}</span>
              </p>
              {health.history.length >= 2 && (
                <p className="text-[10px] text-rose-300 mt-1">
                  -{fmtInt(convertDistance(
                    health.history[0].range_km - health.history[health.history.length - 1].range_km,
                  ))} {distanceUnit} {t('battery.newVsNow.lost', 'lost')}
                </p>
              )}
            </GlassPanel>
          </Grid>
        </GlassPanel>
      </FadeIn>
      </SectionErrorBoundary>

      {/* ── 9. AC/DC Energy Breakdown ────────────────────────────── */}
      <SectionErrorBoundary name="battery:acdc-breakdown" fallbackTitle={t('battery.section.acdcFailed', 'AC/DC energy breakdown failed to load')}>
        <FadeIn delay={0.4}>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <ChartContainer title={t('battery.chart.acdc', 'AC / DC Energy Breakdown')} exportable exportFilename="energy-breakdown">
            {energyBreakdown ? (
              <div className="h-52">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={energyBreakdown.pieData}
                      dataKey="value"
                      nameKey="name"
                      cx="50%"
                      cy="50%"
                      outerRadius={80}
                      innerRadius={40}
                      strokeWidth={2}
                      stroke="rgba(0,0,0,0.3)"
                    >
                      {energyBreakdown.pieData.map((entry) => (
                        <Cell key={entry.name} fill={entry.fill} />
                      ))}
                    </Pie>
                    <Legend />
                    <Tooltip content={<ChartTooltip />} />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <EmptyState /* no-action: transient empty state — surfaces when source data is missing; no specific recovery action available */
                icon={<Zap className="h-8 w-8" />}
                message={t('battery.chart.noBreakdown', 'No charging data for breakdown')}
                className="py-8"
              />
            )}
          </ChartContainer>

          <GlassPanel className="p-6">
            <h3 className="section-title mb-6 flex items-center gap-2">
              <Gauge className="h-4 w-4 text-neon-purple" />
              {t('battery.stats.title', 'Charging Statistics')}
            </h3>
            {energyBreakdown ? (
              <div className="space-y-3">
                {[
                  { label: t('battery.stats.totalSessions', 'Total Sessions'), value: String(energyBreakdown.totalSessions) },
                  { label: t('battery.stats.acSessions', 'AC Sessions'), value: String(energyBreakdown.acCount) },
                  { label: t('battery.stats.dcSessions', 'DC / Supercharger'), value: String(energyBreakdown.dcCount) },
                  { label: t('battery.stats.totalEnergy', 'Total Energy Added'), value: `${fmtNumber(energyBreakdown.totalEnergy, 1)} kWh` },
                  { label: t('battery.stats.cycles', 'Charge Cycles'), value: String(health.total_cycles) },
                ].map((row) => (
                  <div key={row.label} className="flex justify-between items-center py-2 border-b border-[var(--border-subtle)]">
                    <span className="text-xs text-[var(--text-secondary)]">{row.label}</span>
                    <span className="text-sm font-semibold text-[var(--text-primary)]">{row.value}</span>
                  </div>
                ))}
              </div>
            ) : (
              <EmptyState /* no-action: transient empty state — surfaces when source data is missing; no specific recovery action available */
                icon={<Activity className="h-8 w-8" />}
                message={t('battery.stats.empty', 'No charging statistics yet')}
                className="py-8"
              />
            )}
          </GlassPanel>
        </div>
      </FadeIn>
      </SectionErrorBoundary>

      {/* ── 10. Quick Links ──────────────────────────────────────── */}
      <SectionErrorBoundary name="battery:quick-links" fallbackTitle={t('battery.section.quickLinksFailed', 'Quick links failed to load')}>
        <FadeIn delay={0.45}>
          <GlassPanel>
            <Grid cols={{ default: 2, md: 3 }} gap={3}>
              {QUICK_LINKS.map((link) => (
                <Link key={link.to} to={link.to}>
                  <Button
                    variant="outline"
                    className="w-full justify-between"
                    icon={<ArrowRight className="h-4 w-4" />}
                  >
                    {t(link.labelKey, link.fallback)}
                  </Button>
                </Link>
              ))}
            </Grid>
          </GlassPanel>
        </FadeIn>
      </SectionErrorBoundary>

      {/* ── 11. Recommendations ──────────────────────────────────── */}
      <SectionErrorBoundary name="battery:recommendations" fallbackTitle={t('battery.section.recommendationsFailed', 'Recommendations failed to load')}>
        <FadeIn delay={0.5}>
          <GlassPanel glow="green">
            <Badge variant="success" className="mb-3">
              <Lightbulb className="mr-1 inline h-4 w-4" />
              {t('battery.recommendations.title', 'Recommendations')}
            </Badge>
            <ul className="space-y-2 text-sm text-[var(--text-secondary)]">
              {recommendations.map((tip, idx) => (
                <li key={idx} className="flex items-start gap-2">
                  <Lightbulb className="mt-0.5 h-4 w-4 shrink-0 text-green-400" />
                  {tip}
                </li>
              ))}
            </ul>
          </GlassPanel>
        </FadeIn>
      </SectionErrorBoundary>
    </PageContainer>
  );
}
