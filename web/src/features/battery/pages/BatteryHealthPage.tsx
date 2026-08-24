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
import { LinearGauge } from '@/components/charts';
import { MetricCard, MetricBar, LiveIndicator } from '@/components/data-display';
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
  degradationColor,
  gaugeColor,
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
  const { data: health, isLoading: healthLoading, error: healthError } =
    useBatteryHealthAnalytics(vehicleIdStr);
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

  const pageActions = (
    <span className="flex items-center gap-3">
      <VehicleSelect />
      <LiveIndicator variant="compact" />
    </span>
  );

  /* ── Empty / error ─────────────────────────────────────────────── */
  if (!health) {
    return (
      <PageContainer
        title={t('battery.title', 'Battery Health')}
        subtitle={t('battery.subtitle', 'Degradation tracking, prediction, charging habits & longevity insights')}
        error={healthLoading ? null : healthError as Error | null}
        actions={pageActions}
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

  /* ── Main render ───────────────────────────────────────────────── */
  return (
    <PageContainer
      title={t('battery.title', 'Battery Health')}
      subtitle={t('battery.subtitle', 'Degradation tracking, prediction, charging habits & longevity insights')}
      actions={pageActions}
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
                  value={health.degradation_rate_pct_per_year}
                  max={10}
                  label={t('battery.gauge.degradation', 'Degradation')}
                  unit="%/yr"
                  color={degradationColor(health.degradation_rate_pct_per_year)}
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
                    {formatEnergy(health.estimated_capacity_wh, { precision: 1 })} / {formatEnergy(health.original_capacity_wh, { precision: 1 })}
                  </Text>
                </div>
                <div>
                  <MetricBar
                    label={t('battery.bar.degradation', 'Degradation')}
                    value={health.degradation_rate_pct_per_year}
                    max={10}
                    color={degradationColor(health.degradation_rate_pct_per_year)}
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
