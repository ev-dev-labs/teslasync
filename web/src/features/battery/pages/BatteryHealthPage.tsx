import { lazy, useCallback, useMemo, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import {
  Heart, Battery, BatteryFull, Gauge, RefreshCcw, Clock,
  ArrowRight, Lightbulb,
  CheckCircle, Info, Activity,
  Thermometer, ThermometerSun, ThermometerSnowflake, Flame,
} from 'lucide-react';

import { PageContainer } from '@/components/layout';
import { VehicleSelect } from '@/components/forms';
import {
  GlassPanel, Badge, Button,
  SectionTitle, PanelTitle, Text, MetricLabel,
} from '@/components/ui';
import { gaugeTone, severityTokens, type GaugeTone, type Severity } from '@/lib/tokens';
import { LinearGauge } from '@/components/charts';
import {
  DataFreshnessAuto,
  MetricCard,
  MetricBar,
  LiveIndicator,
  OperationalBrief,
  type OperationalTone,
} from '@/components/data-display';
import { Skeleton, EmptyState, LiveStaleDataBanner, SectionErrorBoundary, StatGridSkeleton, ChartBlockSkeleton } from '@/components/feedback';
import { FadeIn } from '@/components/motion';
import { AIBatteryHealthForecastNarrative } from '@/components/ai/AIBatteryHealthForecastNarrative';

import { useBatteryHealthAnalytics } from '@/api/hooks/useEnergy';
import { useChargingTelemetryLatest } from '@/api/hooks/useVehicles';
import { useUnits } from '@/hooks/useUnits';
import { convertDistanceFromSI, convertTempFromSI } from '@/lib/unitConversion';
import { usePageTitle } from '@/hooks/usePageTitle';
import { useSelectedVehicle } from '@/hooks/useSelectedVehicle';
import { NoVehicleSelected } from '@/features/onboarding/components/NoVehicleSelected';
import { cn } from '@/lib/cn';
import { fmtNumber, fmtPercent, fmtInt } from '@/lib/numberFormat';
import DeferredBatterySection from '../components/battery-health/DeferredBatterySection';
import {
  buildInsights,
  buildRecommendations,
  healthLabel,
  healthVariant,
  isProjectionTrustworthy,
} from '../components/battery-health/helpers';

export {
  buildInsights,
  buildRecommendations,
  computeEnergyBreakdown,
  degradationColor,
  gaugeColor,
  healthLabel,
  healthVariant,
} from '../components/battery-health/helpers';

const BatteryTrendCharts = lazy(
  () => import('../components/battery-health/BatteryTrendCharts'),
);
const BatteryChargingCharts = lazy(
  () => import('../components/battery-health/BatteryChargingCharts'),
);

/**
 * Insight status → canonical severity.
 *
 * The page used to carry its own neon panel/icon maps (`border-neon-green/20
 * bg-neon-green/5`), which meant a "critical" battery insight looked nothing
 * like a critical alert anywhere else in the app and its neon fill did not
 * survive the light themes. Routing through `severityTokens` makes the three
 * insight states the same three states the rest of the app already speaks.
 */
const insightSeverity: Record<'good' | 'warning' | 'critical', Severity> = {
  good: 'success',
  warning: 'warn',
  critical: 'critical',
};

/**
 * Health score → semantic gauge tone.
 *
 * Mirrors the bands `gaugeColor()` uses, but expressed as meaning rather than
 * as a palette index so the gauge stays consistent with every other status bar
 * in the app.
 */
export function healthTone(score: number): GaugeTone {
  if (score >= 90) return 'success';
  if (score >= 70) return 'warning';
  return 'danger';
}

/** Degradation rate → semantic gauge tone (≤5 %/yr good, ≤15 %/yr watch). */
export function degradationTone(pct: number): GaugeTone {
  if (pct <= 5) return 'success';
  if (pct <= 15) return 'warning';
  return 'danger';
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

/* ── Loading skeleton ────────────────────────────────────────────── */

/**
 * Mirrors the BatteryHealthPage bento while data loads:
 * page header → 7 KPI metric cards → hero gauges + bars → trend charts →
 * thermal/new-vs-now → insights → distribution → breakdown.
 */
function BatteryHealthSkeleton() {
  return (
    <div className="space-y-6" data-testid="battery-health-skeleton">
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
  const { unitPrefs, formatEnergy } = useUnits();
  const toTemperatureDisplay = (value: number) => convertTempFromSI(value, unitPrefs.temperature);

  const tempUnit = unitPrefs.temperature;
  const fromMeters = useCallback(
    (meters: number): number => convertDistanceFromSI(meters, unitPrefs.distance),
    [unitPrefs.distance],
  );

  /* ── Vehicle selector: header picker is the source of truth ─ */
  const { vehicleId } = useSelectedVehicle();
  const vehicleIdStr = vehicleId != null ? String(vehicleId) : null;

  /* ── Data fetching ─────────────────────────────────────────────── */
  const healthQuery = useBatteryHealthAnalytics(vehicleIdStr);
  const { data: health, isLoading: healthLoading, error: healthError } = healthQuery;
  const { data: chargingLive } = useChargingTelemetryLatest(vehicleId ?? 0);

  /* ── Derived: insights & recommendations ───────────────────────── */
  const insights = useMemo(
    () => (health ? buildInsights(health, health.charging_analysis, t) : []),
    [health, t],
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
  const projectionTrustworthy = isProjectionTrustworthy(health?.prediction);

  const yearsTo80 = projectionTrustworthy
    ? fmtNumber(health!.prediction.years_to_80_pct, 1)
    : '—';

  /* ── No vehicle: defensive guard ─────────────────────────────── */
  if (vehicleId == null) {
    return <NoVehicleSelected pageTitle={t('battery.title', 'Battery Health')} />;
  }

  const pageContextActions = (
    <>
      <VehicleSelect />
      <LiveIndicator variant="compact" />
    </>
  );

  /* ── Empty / error ─────────────────────────────────────────────── */
  if (!health) {
    return (
      <PageContainer
        title={t('battery.title', 'Battery Health')}
        subtitle={t('battery.subtitle', 'Degradation tracking, prediction, charging habits & longevity insights')}
        error={healthLoading ? null : healthError as Error | null}
        contextActions={pageContextActions}
      >
        <LiveStaleDataBanner />
        <FadeIn>
          <AIBatteryHealthForecastNarrative vehicleId={vehicleId} />
        </FadeIn>
        {healthLoading ? (
          <BatteryHealthSkeleton />
        ) : (
          <EmptyState
            icon={<Battery className="h-10 w-10" aria-hidden="true" />}
            message={t('battery.empty', 'No battery health data available yet.')}
          />
        )}
      </PageContainer>
    );
  }

  const capacityNowPct = health.original_capacity_wh > 0
    ? Math.max(0, Math.min(100, (health.estimated_capacity_wh / health.original_capacity_wh) * 100))
    : 0;

  // Backend may omit the history array entirely; guard every render-time
  // access so the "New vs Now" range cells degrade to a placeholder instead
  // of throwing on `.length` / `[0]`.
  const history = health.history ?? [];
  const rangeSnapshotCount = history.filter(
    (point) => Number.isFinite(point.range_m) && point.range_m > 0,
  ).length;
  const rangeConfidence =
    projectionTrustworthy && rangeSnapshotCount >= 3
      ? 'high'
      : rangeSnapshotCount >= 2
        ? 'developing'
        : 'limited';
  const rangeConfidenceLabel =
    rangeConfidence === 'high'
      ? t('operations.battery.rangeConfidenceHigh', 'High')
      : rangeConfidence === 'developing'
        ? t('operations.battery.rangeConfidenceDeveloping', 'Developing')
        : t('operations.battery.rangeConfidenceLimited', 'Limited');
  const rangeConfidenceDetail =
    rangeConfidence === 'high'
      ? t('operations.battery.rangeConfidenceHighDetail', {
          count: rangeSnapshotCount,
          years: yearsTo80,
          defaultValue:
            '{{count}} historical range samples support a stable {{years}}-year threshold forecast.',
        })
      : rangeConfidence === 'developing'
        ? t('operations.battery.rangeConfidenceDevelopingDetail', {
            count: rangeSnapshotCount,
            defaultValue:
              '{{count}} historical range samples are available; more history will tighten the forecast.',
          })
        : t('operations.battery.rangeConfidenceLimitedDetail', {
            count: rangeSnapshotCount,
            defaultValue:
              'Only {{count}} usable range samples are available; treat projections as directional.',
          });
  const chargingStressTone: OperationalTone =
    health.stress_level === 'Low'
      ? 'success'
      : health.stress_level === 'Medium'
        ? 'warning'
        : 'danger';
  const chargingStressLabel =
    health.stress_level === 'Low'
      ? t('operations.battery.chargingStressLow', 'Low')
      : health.stress_level === 'Medium'
        ? t('operations.battery.chargingStressMedium', 'Medium')
        : t('operations.battery.chargingStressHigh', 'High');
  const thermalExposureTone: OperationalTone =
    health.temp_exposure_score == null
      ? 'neutral'
      : health.temp_exposure_score <= 25
        ? 'success'
        : health.temp_exposure_score <= 50
          ? 'warning'
          : 'danger';
  const healthOperationalTone: OperationalTone =
    health.current_soh >= 90
      ? 'success'
      : health.current_soh >= 70
        ? 'warning'
        : 'danger';
  const healthAttention = insights.slice(0, 4).map((item, index) => ({
    key: `battery-insight-${index}`,
    title: t('operations.battery.signalTitle', 'Signal: {{title}}', {
      title: item.title,
    }),
    description: item.description,
    tone: item.status === 'good'
      ? 'success' as const
      : item.status === 'warning'
        ? 'warning' as const
        : 'danger' as const,
  }));

  /* ── Main render ───────────────────────────────────────────────── */
  return (
    <PageContainer
      title={t('battery.title', 'Battery Health')}
      subtitle={t('battery.subtitle', 'Degradation tracking, prediction, charging habits & longevity insights')}
      contextActions={pageContextActions}
    >
      <LiveStaleDataBanner />

      <OperationalBrief
        testId="battery-operational-brief"
        eyebrow={t('operations.battery.eyebrow', 'Battery posture')}
        title={t('operations.battery.title', 'Long-term pack health remains measurable and actionable')}
        description={t(
          'operations.battery.description',
          'Health, degradation, range confidence, charging stress, thermal impact, and cycle exposure are summarized before the deeper evidence.',
        )}
        statusLabel={
          health.current_soh >= 90
            ? t('operations.battery.statusHealthy', 'Healthy')
            : health.current_soh >= 70
              ? t('operations.battery.statusMonitor', 'Monitor')
              : t('operations.battery.statusService', 'Service review')
        }
        statusTone={healthOperationalTone}
        metricColumns={3}
        freshness={
          <DataFreshnessAuto
            query={healthQuery}
            source={t('operations.battery.analyticsSource', 'Battery analytics')}
          />
        }
        scope={
          <Badge variant="neutral" size="sm">
            {t('operations.scope.lifetime', 'Lifetime model')}
          </Badge>
        }
        metrics={[
          {
            key: 'health',
            label: t('operations.battery.packScore', 'Pack score'),
            value: fmtPercent(health.current_soh),
            detail: t(
              'operations.battery.healthDetail',
              'Current modeled health relative to the original usable pack.',
            ),
            tone: healthOperationalTone,
          },
          {
            key: 'degradation',
            label: t('operations.battery.degradationPace', 'Degradation pace'),
            value: `${fmtNumber(health.degradation_rate_pct_per_year, 2)}%/${t('battery.yr', 'yr')}`,
            detail: t(
              'operations.battery.degradationDetail',
              'Annualized capacity change inferred from available history.',
            ),
            tone: health.degradation_rate_pct_per_year <= 5 ? 'success' : 'warning',
          },
          {
            key: 'range-confidence',
            label: t('operations.battery.rangeConfidence', 'Range confidence'),
            value: rangeConfidenceLabel,
            detail: rangeConfidenceDetail,
            tone:
              rangeConfidence === 'high'
                ? 'success'
                : rangeConfidence === 'developing'
                  ? 'info'
                  : 'warning',
          },
          {
            key: 'charging-stress',
            label: t('operations.battery.chargingStress', 'Charging stress'),
            value: chargingStressLabel,
            detail: t('operations.battery.chargingStressDetail', {
              fast: fmtPercent(health.fast_charge_pct),
              depth: fmtPercent(health.avg_depth_of_discharge_pct),
              defaultValue:
                '{{fast}} fast-charge sessions; {{depth}} average depth of discharge.',
            }),
            tone: chargingStressTone,
          },
          {
            key: 'thermal-impact',
            label: t('operations.battery.thermalImpact', 'Thermal impact'),
            value:
              health.temp_exposure_score == null
                ? '—'
                : `${fmtInt(health.temp_exposure_score)} / 100`,
            detail:
              health.temp_exposure_score == null
                ? t(
                    'operations.battery.thermalImpactUnavailable',
                    'More temperature history is required to estimate thermal exposure.',
                  )
                : t(
                    'operations.battery.thermalImpactDetail',
                    'Lower exposure is better; sustained high temperatures increase pack wear.',
                  ),
            tone: thermalExposureTone,
          },
          {
            key: 'cycles',
            label: t('operations.battery.cycleExposure', 'Cycle exposure'),
            value: fmtNumber(health.total_cycles, 0),
            detail: t(
              'operations.battery.cyclesDetail',
              'Equivalent full cycles accumulated across charging activity.',
            ),
            tone: 'neutral',
          },
        ]}
        attention={healthAttention}
        provenance={t(
          'operations.battery.provenance',
          'Calculated from battery-health snapshots, charging history, and the latest available BMS telemetry.',
        )}
      />

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
              value={formatEnergy(health.estimated_capacity_wh, { precision: 1 })}
              icon={<Battery className="h-5 w-5" aria-hidden="true" />}
              color="green"
            />
            <MetricCard
              label={t('battery.metric.originalCap', 'Original Capacity')}
              value={formatEnergy(health.original_capacity_wh, { precision: 1 })}
              icon={<BatteryFull className="h-5 w-5" aria-hidden="true" />}
              color="blue"
            />
            <MetricCard
              label={t('battery.metric.degradation', 'Degradation Rate')}
              value={`${fmtNumber(health.degradation_rate_pct_per_year, 2)}%/${t('battery.yr', 'yr')}`}
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
                    tone={healthTone(health.current_soh)}
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
                  tone="info"
                />
                <LinearGauge
                  value={health.degradation_rate_pct_per_year}
                  max={10}
                  label={t('battery.gauge.degradation', 'Degradation')}
                  unit="%/yr"
                  tone={degradationTone(health.degradation_rate_pct_per_year)}
                />
                <LinearGauge
                  value={health.total_cycles}
                  max={1500}
                  label={t('battery.gauge.cycles', 'Cycles')}
                  unit=""
                  tone="purple"
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
                    color={gaugeTone.info}
                  />
                  <Text as="p" size="2xs" color="muted" className="mt-1">
                    {formatEnergy(health.estimated_capacity_wh, { precision: 1 })} / {formatEnergy(health.original_capacity_wh, { precision: 1 })}
                  </Text>
                </div>
                <div>
                  <MetricBar
                    label={t('battery.bar.degradation', 'Degradation')}
                    value={health.degradation_rate_pct_per_year}
                    max={10}
                    color={gaugeTone[degradationTone(health.degradation_rate_pct_per_year)]}
                  />
                  <Text as="p" size="2xs" color="muted" className="mt-1">
                    {fmtNumber(health.degradation_rate_pct_per_year, 2)}% {t('battery.perYear', 'per year')}
                  </Text>
                </div>
                <div>
                  <MetricBar
                    label={t('battery.bar.cycles', 'Charge Cycles')}
                    value={health.total_cycles}
                    max={1500}
                    color={gaugeTone.purple}
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
      <DeferredBatterySection
        testId="battery-trend-charts"
        fallback={
          <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
            <ChartBlockSkeleton height={300} className="xl:col-span-2" />
            <ChartBlockSkeleton height={300} />
          </div>
        }
      >
        <BatteryTrendCharts health={health} vehicleId={vehicleId} />
      </DeferredBatterySection>

      {/* ── 4. Thermal monitoring + New vs Now bento ──────────────── */}
      <FadeIn delay={0.15}>
        <section
          aria-label={t('battery.section.thermalCompare', 'Thermal monitoring and capacity comparison')}
          className="grid grid-cols-1 gap-4 2xl:grid-cols-2"
        >
          <SectionErrorBoundary name="battery:thermal" fallbackTitle={t('battery.section.thermalFailed', 'Thermal monitoring failed to load')}>
            <GlassPanel className="h-full p-4 sm:p-5">
              <PanelTitle className="mb-4 flex items-center gap-2">
                <Thermometer className="h-4 w-4 text-amber-300" aria-hidden="true" />
                {t('battery.thermal.title', 'Thermal Monitoring')}
              </PanelTitle>
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
              <PanelTitle className="mb-4 flex items-center gap-2">
                <Activity className="h-4 w-4 text-cyan-300" aria-hidden="true" />
                {t('battery.newVsNow.title', 'Capacity & Range: New vs Now')}
              </PanelTitle>
              <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
                <StatCell
                  label={t('battery.newVsNow.capNew', 'Capacity When New')}
                  value={formatEnergy(health.original_capacity_wh, { precision: 1 })}
                />
                <StatCell
                  label={t('battery.newVsNow.capNow', 'Capacity Now')}
                  value={formatEnergy(health.estimated_capacity_wh, { precision: 1 })}
                  accent="text-cyan-300"
                  note={
                    <Text as="p" size="2xs" className="mt-1 text-rose-300">
                      -{formatEnergy(
                        Math.max(0, health.original_capacity_wh - health.estimated_capacity_wh),
                        { precision: 1 },
                      )}
                    </Text>
                  }
                />
                <StatCell
                  label={t('battery.newVsNow.rangeNew', 'Range When New')}
                  value={history.length > 0 ? fmtInt(fromMeters(history[0].range_m)) : '—'}
                  unit={unitPrefs.distance}
                />
                <StatCell
                  label={t('battery.newVsNow.rangeNow', 'Range Now')}
                  value={
                    history.length > 0
                      ? fmtInt(fromMeters(history[history.length - 1].range_m))
                      : '—'
                  }
                  unit={unitPrefs.distance}
                  accent="text-emerald-300"
                  note={
                    history.length >= 2 ? (
                      <Text as="p" size="2xs" className="mt-1 text-rose-300">
                        -{fmtInt(fromMeters(
                          history[0].range_m - history[history.length - 1].range_m,
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
                {insights.map((ins, i) => {
                  const sev = severityTokens[insightSeverity[ins.status]];
                  return (
                    <GlassPanel
                      key={i}
                      data-severity={insightSeverity[ins.status]}
                      className={cn('border p-4 transition-all duration-normal', sev.border, sev.bg)}
                    >
                      <div className="flex items-start gap-3">
                        <div className={cn('mt-0.5', sev.fg)}>{ins.icon}</div>
                        <div className="min-w-0">
                          <Text as="p" size="sm" weight="medium" color="primary">{ins.title}</Text>
                          <Text as="p" variant="bodySm" className="mt-0.5">{ins.description}</Text>
                        </div>
                      </div>
                    </GlassPanel>
                  );
                })}
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

      {/* ── 6–7. Charging distribution, energy mix, and statistics ── */}
      <DeferredBatterySection
        testId="battery-charging-charts"
        fallback={
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <ChartBlockSkeleton height={280} />
            <ChartBlockSkeleton height={280} />
          </div>
        }
      >
        <BatteryChargingCharts
          analysis={health.charging_analysis}
          totalCycles={health.total_cycles}
        />
      </DeferredBatterySection>

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
