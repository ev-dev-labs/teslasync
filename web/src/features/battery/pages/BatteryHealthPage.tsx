import { useCallback, useMemo, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { Link } from 'react-router-dom';
import {
  Heart, Battery, BatteryFull, Gauge, RefreshCcw, Clock,
  Zap, ArrowRight, Lightbulb, AlertTriangle,
  CheckCircle, Info, Target, Activity,
  Thermometer, ThermometerSun, ThermometerSnowflake, Flame,
} from 'lucide-react';

import { PageContainer } from '@/components/layout';
import { VehicleSelect } from '@/components/forms';
import {
  GlassPanel, Badge, Button,
  SectionTitle, PanelTitle, Text, Caption, MetricLabel,
} from '@/components/ui';
import {
  LinearGauge, ChartContainer, ChartTooltip, ChartGradient,
  chartGrid, axisTickSm, CHART_COLORS, renderAnnotationLines,
  AreaChart, Area, BarChart, Bar, ComposedChart, Line, ReferenceLine,
  PieChart, Pie, Cell, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend,
  AREA_DEFAULTS, TimeMarker,
} from '@/components/charts';
import { MetricCard, MetricBar, LiveIndicator } from '@/components/data-display';
import { Skeleton, EmptyState, LiveStaleDataBanner, SectionErrorBoundary, StatGridSkeleton, ChartBlockSkeleton, PageHeaderSkeleton } from '@/components/feedback';
import { FadeIn } from '@/components/motion';
import { AIBatteryHealthForecastNarrative } from '@/components/ai/AIBatteryHealthForecastNarrative';

import { useBatteryHealthAnalytics, useBatteryDegradation } from '@/api/hooks/useEnergy';
import { useChargingSessionsPaginated } from '@/api/hooks/useCharging';
import { useChargingTelemetryLatest } from '@/api/hooks/useVehicles';
import { useUnits } from '@/hooks/useUnits';
import { convertDistanceFromSI, convertTempFromSI, convertEnergyFromSI } from '@/lib/unitConversion';
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
  icon: ReactNode;
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

export function gaugeColor(score: number): string {
  if (score >= 90) return CHART_COLORS[1];
  if (score >= 70) return CHART_COLORS[3];
  return CHART_COLORS[5];
}

export function healthVariant(score: number): 'success' | 'warning' | 'danger' {
  if (score >= 90) return 'success';
  if (score >= 70) return 'warning';
  return 'danger';
}

export function healthLabel(score: number, t: (k: string, fb: string) => string): string {
  if (score >= 90) return t('battery.health.excellent', 'Excellent');
  if (score >= 70) return t('battery.health.good', 'Good');
  return t('battery.health.degraded', 'Degraded');
}

export function degradationColor(pct: number): string {
  if (pct <= 5) return '#10b981';
  if (pct <= 15) return '#f59e0b';
  return '#ef4444';
}

export function buildInsights(
  health: BatteryHealthAnalytics,
  sessions: ChargingSession[] | null,
  t: TFunction,
): InsightItem[] {
  const items: InsightItem[] = [];

  if (health.current_soh >= 90) {
    items.push({
      icon: <CheckCircle className="h-4 w-4" aria-hidden="true" />,
      title: t('battery.insight.excellentTitle', 'Excellent Health'),
      description: t('battery.insight.excellentDesc', { soh: fmtNumber(health.current_soh, 0), defaultValue: 'Battery health is {{soh}}/100 — performing above average.' }),
      status: 'good',
    });
  } else if (health.current_soh >= 70) {
    items.push({
      icon: <Info className="h-4 w-4" aria-hidden="true" />,
      title: t('battery.insight.goodTitle', 'Good Health'),
      description: t('battery.insight.goodDesc', { soh: fmtNumber(health.current_soh, 0), defaultValue: 'Battery health is {{soh}}/100 — normal degradation for age.' }),
      status: 'warning',
    });
  } else {
    items.push({
      icon: <AlertTriangle className="h-4 w-4" aria-hidden="true" />,
      title: t('battery.insight.concernTitle', 'Health Concern'),
      description: t('battery.insight.concernDesc', { soh: fmtNumber(health.current_soh, 0), defaultValue: 'Battery health dropped to {{soh}}/100 — consider service check.' }),
      status: 'critical',
    });
  }

  if (health.fast_charge_pct > 50) {
    items.push({
      icon: <AlertTriangle className="h-4 w-4" aria-hidden="true" />,
      title: t('battery.insight.highFastChargeTitle', 'High Fast-Charge Usage'),
      description: t('battery.insight.highFastChargeDesc', { pct: fmtPercent(health.fast_charge_pct), defaultValue: '{{pct}} of sessions are fast-charging. Mix in slow charging for longevity.' }),
      status: 'warning',
    });
  } else {
    items.push({
      icon: <CheckCircle className="h-4 w-4" aria-hidden="true" />,
      title: t('battery.insight.goodHabitsTitle', 'Good Charging Habits'),
      description: t('battery.insight.goodHabitsDesc', 'Most charges are slow/AC — ideal for battery longevity.'),
      status: 'good',
    });
  }

  if (sessions) {
    const deepDischarges = sessions.filter((s) => s.start_soc_pct < 10).length;
    if (deepDischarges > 3) {
      items.push({
        icon: <AlertTriangle className="h-4 w-4" aria-hidden="true" />,
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
        icon: <Info className="h-4 w-4" aria-hidden="true" />,
        title: t('battery.insight.highSuperchargerTitle', 'High Supercharger Usage'),
        description: t('battery.insight.highSuperchargerDesc', { count: superchargerCount, defaultValue: '{{count}} Supercharger sessions. Occasional slow charging helps battery health.' }),
        status: 'warning',
      });
    }
  }

  if (health.degradation_rate_yr < 3) {
    items.push({
      icon: <Target className="h-4 w-4" aria-hidden="true" />,
      title: t('battery.insight.lowDegTitle', 'Low Degradation Rate'),
      description: t('battery.insight.lowDegDesc', { rate: fmtNumber(health.degradation_rate_yr, 1), defaultValue: '{{rate}}% per year — well below industry average of 3–5%.' }),
      status: 'good',
    });
  }

  return items;
}

export function buildRecommendations(
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

/** Round to one decimal numerically (never via a locale string — `+"1,234.5"` is NaN). */
function roundTo1(n: number): number {
  return Math.round(n * 10) / 10;
}

interface EnergyBreakdown {
  pieData: { name: string; value: number; fill: string }[];
  acCount: number;
  dcCount: number;
  totalEnergy: number;
  totalSessions: number;
}

/**
 * Aggregate AC vs DC charging energy across sessions. A session counts as DC
 * when it carries a charger type or peaks above 20 kW. Returns `null` for an
 * empty input so callers render an empty state. Pie values are rounded
 * numerically so large totals (≥1000 kWh) stay finite instead of collapsing to
 * NaN through a thousands-separated string.
 */
export function computeEnergyBreakdown(
  sessions: ChargingSession[],
): EnergyBreakdown | null {
  if (sessions.length === 0) return null;
  let acEnergy = 0;
  let dcEnergy = 0;
  let acCount = 0;
  let dcCount = 0;
  sessions.forEach((s) => {
    const isDC =
      (s.charger_type != null && s.charger_type.length > 0) ||
      (s.peak_power_w != null && s.peak_power_w > 20_000);
    const energy = convertEnergyFromSI(s.total_energy_added_wh ?? 0, 'kWh');
    if (isDC) {
      dcEnergy += energy;
      dcCount++;
    } else {
      acEnergy += energy;
      acCount++;
    }
  });
  return {
    pieData: [
      { name: 'AC', value: roundTo1(acEnergy), fill: '#10b981' },
      { name: 'DC', value: roundTo1(dcEnergy), fill: '#f59e0b' },
    ],
    acCount,
    dcCount,
    totalEnergy: acEnergy + dcEnergy,
    totalSessions: sessions.length,
  };
}

const QUICK_LINKS: { to: string; labelKey: string; fallback: string }[] = [
  { to: '/battery-cells', labelKey: 'battery.links.cells', fallback: 'Battery Cells' },
  { to: '/battery-degradation', labelKey: 'battery.links.degradation', fallback: 'Degradation' },
  { to: '/energy-flow', labelKey: 'battery.links.energyFlow', fallback: 'Energy Flow' },
  { to: '/projected-range', labelKey: 'battery.links.projectedRange', fallback: 'Projected Range' },
  { to: '/vampire-drain', labelKey: 'battery.links.vampireDrain', fallback: 'Vampire Drain' },
  { to: '/sleep-efficiency', labelKey: 'battery.links.sleepEfficiency', fallback: 'Sleep Efficiency' },
];

/* ── Presentational sub-components (token-based typography) ────────── */

/** Big value + label cell used in the "New vs Now" bento. */
function StatCell({
  label, value, unit, accent, note,
}: {
  label: string;
  value: ReactNode;
  unit?: string;
  accent?: string;
  note?: ReactNode;
}) {
  return (
    <GlassPanel className="h-full p-4 text-center">
      <MetricLabel className="mb-1">{label}</MetricLabel>
      <Text
        as="p"
        size="2xl"
        weight="bold"
        color={accent ? undefined : 'primary'}
        className={cn('tabular-nums', accent)}
      >
        {value}
        {unit && (
          <Text as="span" size="sm" color="muted">{` ${unit}`}</Text>
        )}
      </Text>
      {note}
    </GlassPanel>
  );
}

/** Centered value + caption used under the charge-level chart. */
function HabitStat({ value, label, accent }: { value: ReactNode; label: string; accent?: string }) {
  return (
    <div className="text-center">
      <Text
        as="p"
        size="lg"
        weight="bold"
        color={accent ? undefined : 'primary'}
        className={cn('tabular-nums', accent)}
      >
        {value}
      </Text>
      <Text as="p" size="2xs" color="muted" className="mt-0.5">{label}</Text>
    </div>
  );
}

/** Label / value row used in the "Charging Statistics" panel. */
function StatRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between border-b border-[var(--border-subtle)] py-2">
      <Text size="xs" color="secondary">{label}</Text>
      <Text size="sm" weight="semibold" color="primary">{value}</Text>
    </div>
  );
}

/* ── Loading skeleton ────────────────────────────────────────────── */

/**
 * Mirrors the BatteryHealthPage bento while data loads:
 * page header → 7 KPI metric cards → hero gauges + bars → trend charts →
 * thermal/new-vs-now → insights → distribution → breakdown.
 */
function BatteryHealthSkeleton() {
  return (
    <div className="space-y-6" data-testid="battery-health-skeleton">
      <PageHeaderSkeleton />
      <StatGridSkeleton cards={7} className="md:grid-cols-3 lg:grid-cols-4 2xl:grid-cols-7" />
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <Skeleton className="h-64 rounded-xl xl:col-span-2" />
        <Skeleton className="h-64 rounded-xl" />
      </div>
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <ChartBlockSkeleton height={300} className="xl:col-span-2" />
        <ChartBlockSkeleton height={300} />
      </div>
      <div className="grid grid-cols-1 gap-4 2xl:grid-cols-2">
        <Skeleton className="h-40 rounded-xl" />
        <Skeleton className="h-40 rounded-xl" />
      </div>
    </div>
  );
}

/* ── Page ─────────────────────────────────────────────────────────── */

export default function BatteryHealthPage() {
  const { t } = useTranslation();
  usePageTitle(t('battery.title', 'Battery Health'));
  const { unitPrefs } = useUnits();
  const toTemperatureDisplay = (value: number) => convertTempFromSI(value, unitPrefs.temperature);

  const tempUnit = unitPrefs.temperature;
  // Backend analytics `range_km` is genuinely km (derived SI from
  // signal_log via `internal/api/battery_degradation_handler.go`). To convert
  // safely, route km → metres then through `convertDistanceFromSI`. Mixing
  // the legacy helper with km input caused incorrect range display.

  const fromKm = useCallback(
    (km: number): number => convertDistanceFromSI(km * 1000, unitPrefs.distance),
    [unitPrefs.distance],
  );

  /* ── Vehicle selector: header picker is the source of truth ─ */
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

  /* ── Derived: degradation projection sanity ────────────────────────
   * Backend regression on a short history window can produce absurd
   * slopes (>50 %/yr) and project health to 0 within a month. Treat
   * those as "not enough data" so we don't surface misleading "0 years
   * to 80 %" or a predicted line collapsing to the X-axis.
   */
  const projectionTrustworthy = useMemo(() => {
    const pred = degradation?.prediction;
    if (!pred?.has_enough_data) return false;
    const slope = Math.abs(pred.slope_per_year ?? 0);
    if (!Number.isFinite(slope) || slope > 50) return false;
    const yrs = pred.years_to_80_pct;
    if (yrs == null || !Number.isFinite(yrs) || yrs <= 0) return false;
    return true;
  }, [degradation]);

  /* ── Derived: prediction chart ─────────────────────────────────── */
  const predictionChartData = useMemo(() => {
    const hist = (health?.history ?? []).map((h) => ({
      label: formatDateShort(h.date),
      actual: h.soh_pct,
      predicted: undefined as number | undefined,
    }));
    const proj = projectionTrustworthy
      ? (degradation?.prediction?.projection_points ?? []).map((p) => ({
          label: p.month.slice(0, 7),
          actual: undefined as number | undefined,
          predicted: p.health,
        }))
      : [];
    // Overlap last actual point into prediction for continuity
    if (hist.length > 0 && proj.length > 0) {
      proj[0] = { ...proj[0], actual: hist[hist.length - 1].actual };
    }
    return [...hist, ...proj];
  }, [health, degradation, projectionTrustworthy]);

  /* ── Derived: range trend ──────────────────────────────────────── */
  const rangeTrend = useMemo(() => {
    const points = (health?.history ?? []).map((h) => ({
      label: formatDateShort(h.date),
      range: Math.round(fromKm(h.range_km)),
    }));
    // Backend may emit history rows with range_km=0 when no derivation
    // path is available — render empty state instead of a flat-zero chart.
    if (points.length === 0 || points.every((p) => p.range <= 0)) return [];
    return points;
  }, [health, fromKm]);

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
      const si = Math.min(Math.max(0, Math.floor((s.start_soc_pct ?? 0) / 10)), 9);
      buckets[si].startCount++;
      if (s.end_soc_pct != null) {
        const ei = Math.min(Math.max(0, Math.floor(s.end_soc_pct / 10)), 9);
        buckets[ei].endCount++;
      }
    });
    return buckets;
  }, [sessions]);

  /* ── Derived: charging habits from sessions ────────────────────── */
  const chargingHabits = useMemo(() => {
    const items = sessions ?? [];
    if (items.length === 0) return null;
    const startLevels = items.map((s) => s.start_soc_pct);
    const endLevels = items.filter((s) => s.end_soc_pct != null).map((s) => s.end_soc_pct!);
    const avgStart = startLevels.length > 0 ? startLevels.reduce((a, b) => a + b, 0) / startLevels.length : 0;
    const avgEnd = endLevels.length > 0 ? endLevels.reduce((a, b) => a + b, 0) / endLevels.length : 80;
    const superchargerCount = items.filter((s) => s.charger_type?.toLowerCase().includes('tesla')).length;
    const dcFastCount = items.filter((s) => s.charger_type && !s.charger_type.toLowerCase().includes('tesla')).length;
    return { avgStart, avgEnd, superchargerCount, dcFastCount, total: items.length };
  }, [sessions]);

  /* ── Derived: AC/DC breakdown ──────────────────────────────────── */
  const energyBreakdown = useMemo(
    () => computeEnergyBreakdown(sessions ?? []),
    [sessions],
  );

  const yearsTo80 = projectionTrustworthy
    ? fmtNumber(degradation!.prediction!.years_to_80_pct, 1)
    : '—';

  /* ── No vehicle: defensive guard ─────────────────────────────── */
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
          icon={<Battery className="h-10 w-10" aria-hidden="true" />}
          message={t('battery.empty', 'No battery health data available yet.')}
        />
      </PageContainer>
    );
  }

  const capacityNowPct = health.original_capacity > 0
    ? Math.max(0, Math.min(100, (health.estimated_capacity / health.original_capacity) * 100))
    : 0;

  // Backend may omit the history array entirely; guard every render-time
  // access so the "New vs Now" range cells degrade to a placeholder instead
  // of throwing on `.length` / `[0]`.
  const history = health.history ?? [];

  /* ── Main render ───────────────────────────────────────────────── */
  return (
    <PageContainer
      title={t('battery.title', 'Battery Health')}
      subtitle={t('battery.subtitle', 'Degradation tracking, prediction, charging habits & longevity insights')}
      actions={
        <span className="flex items-center gap-3">
          <VehicleSelect />
          <LiveIndicator variant="compact" />
        </span>
      }
    >
      <LiveStaleDataBanner />

      {/* AI battery-health forecast narrator. Hidden when ai_mode='off' or
          the per-feature toggle is off; baseline chart remains. */}
      <FadeIn>
        <AIBatteryHealthForecastNarrative vehicleId={vehicleId ?? undefined} />
      </FadeIn>

      {/* ── 1. KPI band — summary metrics ─────────────────────────── */}
      <SectionErrorBoundary name="battery:summary-cards" fallbackTitle={t('battery.section.summaryCardsFailed', 'Summary metrics failed to load')}>
        <FadeIn>
          <section
            aria-label={t('battery.section.kpis', 'Battery health summary metrics')}
            className="grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-3 lg:grid-cols-4 2xl:grid-cols-7"
          >
            <MetricCard
              label={t('battery.metric.soh', 'State of Health')}
              value={fmtPercent(health.current_soh)}
              icon={<Heart className="h-5 w-5" aria-hidden="true" />}
              color="cyan"
            />
            <MetricCard
              label={t('battery.metric.currentCap', 'Current Capacity')}
              value={`${fmtNumber(health.estimated_capacity, 1)} kWh`}
              icon={<Battery className="h-5 w-5" aria-hidden="true" />}
              color="green"
            />
            <MetricCard
              label={t('battery.metric.originalCap', 'Original Capacity')}
              value={`${fmtNumber(health.original_capacity, 1)} kWh`}
              icon={<BatteryFull className="h-5 w-5" aria-hidden="true" />}
              color="blue"
            />
            <MetricCard
              label={t('battery.metric.degradation', 'Degradation Rate')}
              value={`${fmtNumber(health.degradation_rate_yr, 2)}%/${t('battery.yr', 'yr')}`}
              icon={<Gauge className="h-5 w-5" aria-hidden="true" />}
              color="amber"
            />
            <MetricCard
              label={t('battery.metric.cycles', 'Total Cycles')}
              value={fmtNumber(health.total_cycles, 0)}
              icon={<RefreshCcw className="h-5 w-5" aria-hidden="true" />}
              color="purple"
            />
            <MetricCard
              label={t('battery.metric.age', 'Battery Age')}
              value={
                health.battery_age_months > 0
                  ? `${health.battery_age_months} ${t('battery.months', 'months')}`
                  : '—'
              }
              icon={<Clock className="h-5 w-5" aria-hidden="true" />}
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
              icon={<CheckCircle className="h-5 w-5" aria-hidden="true" />}
              color={chargingLive?.bms_fullcharge_complete ? 'green' : 'cyan'}
            />
          </section>
        </FadeIn>
      </SectionErrorBoundary>

      {/* ── 2. Hero: health gauges + capacity/wear bars ───────────── */}
      <FadeIn delay={0.05}>
        <section
          aria-label={t('battery.section.overview', 'Health score and capacity')}
          className="grid grid-cols-1 gap-4 xl:grid-cols-3"
        >
          <SectionErrorBoundary name="battery:health-hero" fallbackTitle={t('battery.section.heroFailed', 'Health score panel failed to load')}>
            <GlassPanel className="h-full p-4 sm:p-6 xl:col-span-2">
              <PanelTitle className="mb-4 flex items-center gap-2">
                <Heart className="h-4 w-4 text-cyan-300" aria-hidden="true" />
                {t('battery.hero.title', 'Health Overview')}
              </PanelTitle>
              <div className="grid grid-cols-2 items-center gap-4 sm:grid-cols-3 sm:gap-6 xl:grid-cols-3 2xl:grid-cols-5">
                <div className="col-span-2 flex flex-col items-center sm:col-span-1">
                  <LinearGauge
                    value={health.current_soh}
                    max={100}
                    label={t('battery.gauge.health', 'Health Score')}
                    unit="/100"
                    hideScale
                    size={130}
                    color={gaugeColor(health.current_soh)}
                  />
                  <Badge variant={healthVariant(health.current_soh)} className="mt-2">
                    {healthLabel(health.current_soh, t)}
                  </Badge>
                </div>
                <LinearGauge
                  value={capacityNowPct}
                  max={100}
                  label={t('battery.gauge.capacity', 'Capacity')}
                  unit="%"
                  color="#00f0ff"
                />
                <LinearGauge
                  value={health.degradation_rate_yr}
                  max={10}
                  label={t('battery.gauge.degradation', 'Degradation')}
                  unit="%/yr"
                  color={degradationColor(health.degradation_rate_yr)}
                />
                <LinearGauge
                  value={health.total_cycles}
                  max={1500}
                  label={t('battery.gauge.cycles', 'Cycles')}
                  unit=""
                  color="#a855f7"
                />
                <div className="flex flex-col items-center justify-center text-center">
                  <Text as="p" size="3xl" weight="bold" color="primary" className="tabular-nums">{yearsTo80}</Text>
                  <MetricLabel className="mt-1">{t('battery.yearsTo80', 'Years to 80%')}</MetricLabel>
                  <Text as="span" size="2xs" color="muted">{t('battery.warrantyNote', 'warranty threshold')}</Text>
                </div>
              </div>
            </GlassPanel>
          </SectionErrorBoundary>

          <SectionErrorBoundary name="battery:metric-bars" fallbackTitle={t('battery.section.metricBarsFailed', 'Metric bars failed to load')}>
            <GlassPanel className="h-full p-4 sm:p-6">
              <PanelTitle className="mb-4 flex items-center gap-2">
                <Gauge className="h-4 w-4 text-cyan-300" aria-hidden="true" />
                {t('battery.bars.title', 'Capacity & Wear')}
              </PanelTitle>
              <div className="space-y-5">
                <div>
                  <MetricBar
                    label={t('battery.bar.capacity', 'Current Capacity')}
                    value={Math.round(capacityNowPct)}
                    max={100}
                    color="#00f0ff"
                  />
                  <Text as="p" size="2xs" color="muted" className="mt-1">
                    {fmtNumber(health.estimated_capacity, 1)} / {fmtNumber(health.original_capacity, 1)} kWh
                  </Text>
                </div>
                <div>
                  <MetricBar
                    label={t('battery.bar.degradation', 'Degradation')}
                    value={health.degradation_rate_yr}
                    max={10}
                    color={degradationColor(health.degradation_rate_yr)}
                  />
                  <Text as="p" size="2xs" color="muted" className="mt-1">
                    {fmtNumber(health.degradation_rate_yr, 2)}% {t('battery.perYear', 'per year')}
                  </Text>
                </div>
                <div>
                  <MetricBar
                    label={t('battery.bar.cycles', 'Charge Cycles')}
                    value={health.total_cycles}
                    max={1500}
                    color="#a855f7"
                  />
                  <Text as="p" size="2xs" color="muted" className="mt-1">
                    {t('battery.warrantyLimit', 'Tesla warranty: 1,500 cycles / 70%')}
                  </Text>
                </div>
              </div>
            </GlassPanel>
          </SectionErrorBoundary>
        </section>
      </FadeIn>

      {/* ── 3. Trend charts: capacity prediction + range ──────────── */}
      <FadeIn delay={0.1}>
        <section
          aria-label={t('battery.section.trends', 'Capacity and range trends')}
          className="grid grid-cols-1 gap-4 xl:grid-cols-3"
        >
          {/* chart-a11y:no-table composed actual+predicted percentage trend; SR users get capacity numbers via the metric cards above */}
          <ChartContainer
            className="h-full xl:col-span-2"
            title={t('battery.chart.capacityTrend', 'Capacity Trend & Prediction')}
            subtitle={t('battery.chart.dashedProjected', 'Dashed = projected')}
            ariaLabel={t('battery.chart.capacityTrend.aria', 'Battery capacity trend with dashed projection line over time')}
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
                icon={<Activity className="h-8 w-8" aria-hidden="true" />}
                message={t('battery.chart.noTrend', 'Not enough snapshots for trend analysis')}
                className="py-8"
              />
            )}
          </ChartContainer>

          {/* chart-a11y:no-table per-snapshot range area chart; latest range surfaced in the summary card above */}
          <ChartContainer
            className="h-full"
            title={t('battery.chart.rangeTrend', 'Estimated Range Over Time')}
            ariaLabel={t('battery.chart.rangeTrend.aria', 'Estimated battery range over time area chart')}
            exportable
            exportFilename="range-trend"
            annotations={{ vehicleId, scope: 'battery', chartId: 'battery-health-range-trend' }}
          >
            {({ annotations: chartAnnotations }) =>
              rangeTrend.length > 0 ? (
                <div className="h-48 sm:h-72">
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
                        name={`${t('battery.chart.range', 'Range')} (${unitPrefs.distance})`}
                        stroke={COLOR.GOOD}
                        fill="url(#rangeGrad)"
                      />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              ) : (
                <EmptyState /* no-action: transient empty state — surfaces when source data is missing; no specific recovery action available */
                  icon={<Activity className="h-8 w-8" aria-hidden="true" />}
                  message={t('battery.chart.noRange', 'No range data yet')}
                  className="py-8"
                />
              )
            }
          </ChartContainer>
        </section>
      </FadeIn>

      {/* ── 4. Thermal monitoring + New vs Now bento ──────────────── */}
      <FadeIn delay={0.15}>
        <section
          aria-label={t('battery.section.thermalCompare', 'Thermal monitoring and capacity comparison')}
          className="grid grid-cols-1 gap-4 2xl:grid-cols-2"
        >
          <SectionErrorBoundary name="battery:thermal" fallbackTitle={t('battery.section.thermalFailed', 'Thermal monitoring failed to load')}>
            <GlassPanel className="h-full p-4 sm:p-5">
              <SectionTitle className="mb-4 flex items-center gap-2">
                <Thermometer className="h-4 w-4 text-amber-300" aria-hidden="true" />
                {t('battery.thermal.title', 'Thermal Monitoring')}
              </SectionTitle>
              <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
                <MetricCard
                  label={t('battery.thermal.moduleTempMax', 'Module Temp (Max)')}
                  value={
                    chargingLive?.module_temp_max != null
                      ? `${fmtNumber(toTemperatureDisplay(chargingLive.module_temp_max), 1)} ${tempUnit}`
                      : '—'
                  }
                  subtitle={
                    chargingLive?.num_module_temp_max != null
                      ? t('battery.thermal.moduleNumber', 'Module #{{n}}', {
                          n: chargingLive.num_module_temp_max,
                        })
                      : undefined
                  }
                  icon={<ThermometerSun className="h-5 w-5" aria-hidden="true" />}
                  color="amber"
                />
                <MetricCard
                  label={t('battery.thermal.moduleTempMin', 'Module Temp (Min)')}
                  value={
                    chargingLive?.module_temp_min != null
                      ? `${fmtNumber(toTemperatureDisplay(chargingLive.module_temp_min), 1)} ${tempUnit}`
                      : '—'
                  }
                  subtitle={
                    chargingLive?.num_module_temp_min != null
                      ? t('battery.thermal.moduleNumber', 'Module #{{n}}', {
                          n: chargingLive.num_module_temp_min,
                        })
                      : undefined
                  }
                  icon={<ThermometerSnowflake className="h-5 w-5" aria-hidden="true" />}
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
                  icon={<Flame className="h-5 w-5" aria-hidden="true" />}
                  color={chargingLive?.battery_heater_on ? 'red' : 'green'}
                />
                <MetricCard
                  label={t('battery.thermal.tempSpread', 'Temperature Spread')}
                  value={
                    chargingLive?.module_temp_max != null && chargingLive?.module_temp_min != null
                      ? `${fmtNumber(
                          toTemperatureDisplay(chargingLive.module_temp_max) -
                            toTemperatureDisplay(chargingLive.module_temp_min),
                          1,
                        )} ${tempUnit}`
                      : '—'
                  }
                  icon={<Activity className="h-5 w-5" aria-hidden="true" />}
                  color="purple"
                />
              </div>
            </GlassPanel>
          </SectionErrorBoundary>

          <SectionErrorBoundary name="battery:capacity-range" fallbackTitle={t('battery.section.capacityRangeFailed', 'Capacity & range comparison failed to load')}>
            <GlassPanel className="h-full p-4 sm:p-5">
              <SectionTitle className="mb-4 flex items-center gap-2">
                <Activity className="h-4 w-4 text-cyan-300" aria-hidden="true" />
                {t('battery.newVsNow.title', 'Capacity & Range: New vs Now')}
              </SectionTitle>
              <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
                <StatCell
                  label={t('battery.newVsNow.capNew', 'Capacity When New')}
                  value={fmtNumber(health.original_capacity, 1)}
                  unit="kWh"
                />
                <StatCell
                  label={t('battery.newVsNow.capNow', 'Capacity Now')}
                  value={fmtNumber(health.estimated_capacity, 1)}
                  unit="kWh"
                  accent="text-cyan-300"
                  note={
                    <Text as="p" size="2xs" className="mt-1 text-rose-300">
                      -{fmtNumber(health.original_capacity - health.estimated_capacity, 1)} kWh
                    </Text>
                  }
                />
                <StatCell
                  label={t('battery.newVsNow.rangeNew', 'Range When New')}
                  value={history.length > 0 ? fmtInt(fromKm(history[0].range_km)) : '—'}
                  unit={unitPrefs.distance}
                />
                <StatCell
                  label={t('battery.newVsNow.rangeNow', 'Range Now')}
                  value={
                    history.length > 0
                      ? fmtInt(fromKm(history[history.length - 1].range_km))
                      : '—'
                  }
                  unit={unitPrefs.distance}
                  accent="text-emerald-300"
                  note={
                    history.length >= 2 ? (
                      <Text as="p" size="2xs" className="mt-1 text-rose-300">
                        -{fmtInt(fromKm(
                          history[0].range_km - history[history.length - 1].range_km,
                        ))} {unitPrefs.distance} {t('battery.newVsNow.lost', 'lost')}
                      </Text>
                    ) : undefined
                  }
                />
              </div>
            </GlassPanel>
          </SectionErrorBoundary>
        </section>
      </FadeIn>

      {/* ── 5. Smart insights — full-width reflow ─────────────────── */}
      <SectionErrorBoundary name="battery:insights" fallbackTitle={t('battery.section.insightsFailed', 'Smart insights failed to load')}>
        <FadeIn delay={0.2}>
          <section aria-label={t('battery.insights.title', 'Smart Insights')} className="space-y-3">
            <SectionTitle className="flex items-center gap-2">
              <Heart className="h-4 w-4 text-rose-300" aria-hidden="true" />
              {t('battery.insights.title', 'Smart Insights')}
            </SectionTitle>
            {insights.length > 0 ? (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3 3xl:grid-cols-4">
                {insights.map((ins, i) => (
                  <GlassPanel
                    key={i}
                    className={cn('border p-4 transition-all duration-normal', insightPanelClass[ins.status])}
                  >
                    <div className="flex items-start gap-3">
                      <div className={cn('mt-0.5', insightIconClass[ins.status])}>{ins.icon}</div>
                      <div className="min-w-0">
                        <Text as="p" size="sm" weight="medium" color="primary">{ins.title}</Text>
                        <Text as="p" variant="bodySm" className="mt-0.5">{ins.description}</Text>
                      </div>
                    </div>
                  </GlassPanel>
                ))}
              </div>
            ) : (
              <EmptyState /* no-action: transient empty state — surfaces when source data is missing; no specific recovery action available */
                icon={<Info className="h-8 w-8" aria-hidden="true" />}
                message={t('battery.insights.empty', 'Not enough data for insights yet')}
                className="py-6"
              />
            )}
          </section>
        </FadeIn>
      </SectionErrorBoundary>

      {/* ── 6. Charge level distribution — full-width band ────────── */}
      <SectionErrorBoundary name="battery:charge-level-dist" fallbackTitle={t('battery.section.chargeDistFailed', 'Charge level distribution failed to load')}>
        <FadeIn delay={0.25}>
          <GlassPanel className="p-4 sm:p-5">
            <div className="mb-4 flex flex-wrap items-center gap-x-2 gap-y-1">
              <SectionTitle className="flex items-center gap-2">
                <Zap className="h-4 w-4 text-amber-300" aria-hidden="true" />
                {t('battery.chart.chargeDist', 'Charge Level Distribution')}
              </SectionTitle>
              <Caption>{t('battery.chart.chargeDistSub', 'Recent 100 sessions')}</Caption>
            </div>
            {chargeLevelDist.length > 0 ? (
              <>
                <div className="h-44 sm:h-56 2xl:h-64">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={chargeLevelDist}>
                      {chartGrid}
                      <XAxis dataKey="range" tick={axisTickSm} tickLine={false} axisLine={false} />
                      <YAxis tick={axisTickSm} tickLine={false} axisLine={false} />
                      <Tooltip content={<ChartTooltip />} />
                      <Legend />
                      <Bar dataKey="startCount" name={t('battery.chart.chargeStarted', 'Charge Started')} fill="#ef4444" fillOpacity={0.5} radius={[3, 3, 0, 0]} />
                      <Bar dataKey="endCount" name={t('battery.chart.chargeEnded', 'Charge Ended')} fill="#10b981" fillOpacity={0.5} radius={[3, 3, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
                {chargingHabits && (
                  <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
                    <HabitStat
                      value={fmtPercent(chargingHabits.avgStart)}
                      label={t('battery.habit.avgStart', 'Avg Start Level')}
                    />
                    <HabitStat
                      value={fmtPercent(chargingHabits.avgEnd)}
                      label={t('battery.habit.avgEnd', 'Avg End Level')}
                      accent="text-emerald-300"
                    />
                    <HabitStat
                      value={chargingHabits.superchargerCount}
                      label={t('battery.habit.supercharger', 'Supercharger Sessions')}
                      accent="text-amber-300"
                    />
                    <HabitStat
                      value={chargingHabits.total - chargingHabits.superchargerCount - chargingHabits.dcFastCount}
                      label={t('battery.habit.home', 'Home Charges')}
                      accent="text-cyan-300"
                    />
                  </div>
                )}
              </>
            ) : (
              <EmptyState /* no-action: transient empty state — surfaces when source data is missing; no specific recovery action available */
                icon={<Zap className="h-8 w-8" aria-hidden="true" />}
                message={t('battery.chart.noSessions', 'No charging session data yet')}
                className="py-8"
              />
            )}
          </GlassPanel>
        </FadeIn>
      </SectionErrorBoundary>

      {/* ── 7. AC/DC breakdown + charging statistics bento ────────── */}
      <SectionErrorBoundary name="battery:acdc-breakdown" fallbackTitle={t('battery.section.acdcFailed', 'AC/DC energy breakdown failed to load')}>
        <FadeIn delay={0.3}>
          <section
            aria-label={t('battery.section.chargingAnalysis', 'Charging energy analysis')}
            className="grid grid-cols-1 gap-4 lg:grid-cols-2"
          >
            {/* chart-a11y:no-table pie chart of aggregate AC vs DC energy share; raw counts surfaced in the Charging Statistics panel beside it */}
            <ChartContainer
              className="h-full"
              title={t('battery.chart.acdc', 'AC / DC Energy Breakdown')}
              ariaLabel={t('battery.chart.acdc.aria', 'AC versus DC energy share pie chart')}
              exportable
              exportFilename="energy-breakdown"
            >
              {energyBreakdown ? (
                <div className="h-52 2xl:h-60">
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
                  icon={<Zap className="h-8 w-8" aria-hidden="true" />}
                  message={t('battery.chart.noBreakdown', 'No charging data for breakdown')}
                  className="py-8"
                />
              )}
            </ChartContainer>

            <GlassPanel className="h-full p-4 sm:p-5">
              <SectionTitle className="mb-4 flex items-center gap-2">
                <Gauge className="h-4 w-4 text-purple-300" aria-hidden="true" />
                {t('battery.stats.title', 'Charging Statistics')}
              </SectionTitle>
              {energyBreakdown ? (
                <div className="space-y-1">
                  <StatRow label={t('battery.stats.totalSessions', 'Total Sessions')} value={String(energyBreakdown.totalSessions)} />
                  <StatRow label={t('battery.stats.acSessions', 'AC Sessions')} value={String(energyBreakdown.acCount)} />
                  <StatRow label={t('battery.stats.dcSessions', 'DC / Supercharger')} value={String(energyBreakdown.dcCount)} />
                  <StatRow label={t('battery.stats.totalEnergy', 'Total Energy Added')} value={`${fmtNumber(energyBreakdown.totalEnergy, 1)} kWh`} />
                  <StatRow label={t('battery.stats.cycles', 'Charge Cycles')} value={String(health.total_cycles)} />
                </div>
              ) : (
                <EmptyState /* no-action: transient empty state — surfaces when source data is missing; no specific recovery action available */
                  icon={<Activity className="h-8 w-8" aria-hidden="true" />}
                  message={t('battery.stats.empty', 'No charging statistics yet')}
                  className="py-8"
                />
              )}
            </GlassPanel>
          </section>
        </FadeIn>
      </SectionErrorBoundary>

      {/* ── 8. Quick links + recommendations bento ────────────────── */}
      <FadeIn delay={0.35}>
        <section
          aria-label={t('battery.section.linksTips', 'Related pages and recommendations')}
          className="grid grid-cols-1 gap-4 xl:grid-cols-2"
        >
          <SectionErrorBoundary name="battery:quick-links" fallbackTitle={t('battery.section.quickLinksFailed', 'Quick links failed to load')}>
            <GlassPanel className="h-full p-4 sm:p-5">
              <PanelTitle className="mb-3 flex items-center gap-2">
                <ArrowRight className="h-4 w-4 text-cyan-300" aria-hidden="true" />
                {t('battery.links.title', 'Explore More')}
              </PanelTitle>
              <nav aria-label={t('battery.links.title', 'Explore More')} className="grid grid-cols-2 gap-3 md:grid-cols-3">
                {QUICK_LINKS.map((link) => (
                  <Link key={link.to} to={link.to}>
                    <Button
                      variant="outline"
                      className="w-full justify-between"
                      icon={<ArrowRight className="h-4 w-4" aria-hidden="true" />}
                    >
                      {t(link.labelKey, link.fallback)}
                    </Button>
                  </Link>
                ))}
              </nav>
            </GlassPanel>
          </SectionErrorBoundary>

          <SectionErrorBoundary name="battery:recommendations" fallbackTitle={t('battery.section.recommendationsFailed', 'Recommendations failed to load')}>
            <GlassPanel glow="green" className="h-full p-4 sm:p-5">
              <Badge variant="success" className="mb-3">
                <Lightbulb className="mr-1 inline h-4 w-4" aria-hidden="true" />
                {t('battery.recommendations.title', 'Recommendations')}
              </Badge>
              <ul className="space-y-2">
                {recommendations.map((tip, idx) => (
                  <li key={idx} className="flex items-start gap-2">
                    <Lightbulb className="mt-0.5 h-4 w-4 shrink-0 text-emerald-300" aria-hidden="true" />
                    <Text variant="body">{tip}</Text>
                  </li>
                ))}
              </ul>
            </GlassPanel>
          </SectionErrorBoundary>
        </section>
      </FadeIn>
    </PageContainer>
  );
}
