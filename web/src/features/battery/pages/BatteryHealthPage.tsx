import { lazy, useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Heart, Gauge, Lightbulb, Info, Activity,
} from 'lucide-react';

import { Grid, Stack, PageLayout } from '@/components/layout';
import {
  BatteryPanelGrid, HealthSummary,
  HealthThermalPanel, HealthQuickLinksPanel, HealthUnavailableOutline,
} from '../components/modernization';
import { BatteryEvidenceBrief } from '../components/operationalbrief-all/BatteryEvidenceBrief';

import {
  GlassPanel, Badge,
  SectionTitle, PanelTitle, Text, MetricLabel, GlossaryTerm,
} from '@/components/ui';
import { gaugeTone, severityTokens, type GaugeTone, type Severity } from '@/lib/tokens';
import { LinearGauge } from '@/components/charts';
import {
  DataFreshnessAuto,
  DataProvenanceBadge,
  MetricBar,
  OperationalBrief,
  type OperationalTone,
} from '@/components/data-display';
import { EmptyState, LiveStaleDataBanner, SectionErrorBoundary, ChartBlockSkeleton, QueryError, StaleRefreshWarning } from '@/components/feedback';
import { FadeIn } from '@/components/motion';
import { AIBatteryHealthForecastNarrative } from '@/components/ai';

import { useBatteryHealthAnalytics } from '@/api/hooks/useEnergy';
import { useChargingTelemetryLatest } from '@/api/hooks/useVehicles';
import { useUnits } from '@/hooks/useUnits';
import { convertDistanceFromSI, convertTempFromSI } from '@/lib/unitConversion';
import { usePageTitle } from '@/hooks/usePageTitle';
import { useSelectedVehicle } from '@/hooks/useSelectedVehicle';
import { useDataState } from '@/hooks/useDataState';
import { NoVehicleSelected } from '@/features/onboarding/components/NoVehicleSelected';
import { cn } from '@/lib/cn';

import type { OperationalNarrative } from '@/types/operationalNarrative';
import DeferredBatterySection from '../components/battery-health/DeferredBatterySection';
import {
  buildInsights,
  buildRecommendations,
  healthLabel,
  healthVariant,
  hasHealthMeasurement,
  isProjectionTrustworthy,
} from '../components/battery-health/helpers';
import { BATTERY_PANEL_CLASS, BATTERY_PANEL_HEADER_CLASS } from '../components/battery-health/layout';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';

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

/* ── Page ─────────────────────────────────────────────────────────── */

export default function BatteryHealthPage() {
  const { fmtNumber, fmtPercent, fmtInt, precision: displayPrecision, locale: displayLocale } = useNumberFormatting();
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
  const { data: health, isLoading: healthLoading } = healthQuery;
  const healthDataState = useDataState(healthQuery, { provenance: 'inferred' });
  const chargingLiveQuery = useChargingTelemetryLatest(vehicleId ?? 0);
  const { data: chargingLive } = chargingLiveQuery;
  const chargingLiveState = useDataState(chargingLiveQuery, { provenance: 'live' });

  /* ── Derived: insights & recommendations ───────────────────────── */
  const insights = useMemo(
    () => (health ? buildInsights(health, health.charging_analysis, t) : []),
    [health, t, displayPrecision, displayLocale],
  );
  const recommendations = useMemo(
    () => (health ? buildRecommendations(health, t) : []),
    [health, t],
  );
  const healthMeasured = health != null && hasHealthMeasurement(health);
  const healthValue = healthMeasured ? fmtPercent(health!.current_soh) : '—';
  const healthUnavailable = t('battery.health.missingMeasurement', 'Capacity measurements are not available yet; battery health cannot be assessed.');

  /* ── Derived: degradation projection sanity ────────────────────────
   * Backend regression on a short history window can produce absurd
   * slopes (>50 %/yr) and project health to 0 within a month. Treat
   * those as "not enough data" so we don't surface misleading "0 years
   * to 80 %" or a predicted line collapsing to the X-axis.
   */
  const projectionTrustworthy = isProjectionTrustworthy(health?.prediction);

  const yearsTo80 = projectionTrustworthy
    ? fmtNumber(health!.prediction.years_to_80_pct)
    : '—';

  /* ── No vehicle: defensive guard ─────────────────────────────── */
  if (vehicleId == null) {
    return <NoVehicleSelected pageTitle={t('battery.title', 'Battery Health')} />;
  }

  const thermalPanel = (
    <HealthThermalPanel
      state={chargingLiveState}
      loading={chargingLiveQuery.isLoading}
      retry={() => { void chargingLiveQuery.refetch(); }}
      formatNumber={fmtNumber}
      toTemperatureDisplay={toTemperatureDisplay}
      tempUnit={tempUnit}
    />
  );

  /* ── Empty / error ─────────────────────────────────────────────── */
  if (!health) {
    return (
      <PageLayout
        title={t('battery.title', 'Battery Health')}
        subtitle={t('battery.subtitle', 'Degradation tracking, prediction, charging habits & longevity insights')}
        busy={healthLoading}
      >
        <Stack gap={6} className="min-w-0 w-full">
        <LiveStaleDataBanner />
        <FadeIn>
          <AIBatteryHealthForecastNarrative vehicleId={vehicleId} />
        </FadeIn>
        {healthDataState.fatalError && <QueryError error={healthDataState.fatalError} onRetry={() => { void healthQuery.refetch(); }} />}
        {!healthLoading && !healthDataState.fatalError && <Text variant="bodySm">{t('battery.empty', 'No battery health data available yet.')}</Text>}
        <HealthUnavailableOutline
          loading={healthLoading}
          thermal={thermalPanel}
          links={<HealthQuickLinksPanel />}
          summary={<HealthSummary
            chargingLive={chargingLive}
            healthMeasured={false}
            healthValue="—"
            capacityMeasured={false}
            originalCapacityMeasured={false}
            formatEnergy={formatEnergy}
            formatNumber={fmtNumber}
          />}
        />
        </Stack>
      </PageLayout>
    );
  }

  const capacityMeasured = Number.isFinite(health.estimated_capacity_wh) && health.estimated_capacity_wh > 0;
  const originalCapacityMeasured = Number.isFinite(health.original_capacity_wh) && health.original_capacity_wh > 0;
  const capacityNowPct = capacityMeasured && originalCapacityMeasured
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
    !healthMeasured
      ? 'neutral'
      : health.current_soh >= 90
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
  const narrativeEvidence: OperationalNarrative['evidence'] = history
    .slice(-5)
    .reverse()
    .map((snapshot) => ({
      id: `battery-health-${snapshot.date}`,
      summary: t(
        'operations.battery.narrative.snapshotSummary',
        '{{date}}: {{health}} state of health with {{capacity}} estimated usable capacity.',
        {
          date: snapshot.date,
          health: fmtPercent(snapshot.soh_pct),
          capacity: formatEnergy(snapshot.capacity_wh),
        },
      ),
      observedAt: snapshot.date,
      provenance: {
        source: t('operations.battery.narrative.historySource', 'Battery health history'),
        recordId: snapshot.date,
        method: t(
          'operations.battery.narrative.snapshotMethod',
          'Direct capacity and range snapshot retained by battery analytics.',
        ),
      },
    }));
  const narrative: OperationalNarrative = {
    whatChanged: !healthMeasured ? healthUnavailable : t(
      'operations.battery.narrative.whatChanged',
      'Modeled pack health is {{health}}, with {{rate}} annualized degradation across the available history.',
      {
        health: fmtPercent(health.current_soh),
        rate: `${fmtNumber(health.degradation_rate_pct_per_year)}%`,
      },
    ),
    whyItMatters:
      !healthMeasured ? healthUnavailable : healthAttention[0]?.description
      ?? t(
        'operations.battery.narrative.healthyImpact',
        'Stable capacity preserves usable range and reduces near-term service uncertainty.',
      ),
    confidence: {
      label:
        rangeConfidence === 'high'
          ? 'high'
          : rangeConfidence === 'developing'
            ? 'medium'
            : 'low',
      score: null,
      basis: [
        t(
          'operations.battery.narrative.snapshotBasis',
          '{{count}} retained battery-health snapshots support this assessment.',
          { count: history.length },
        ),
        projectionTrustworthy
          ? t(
              'operations.battery.narrative.projectionBasis',
              'The degradation projection passed the page stability bounds.',
            )
          : t(
              'operations.battery.narrative.projectionLimitedBasis',
              'The projection is withheld because the available trend did not pass stability bounds.',
            ),
      ],
    },
    likelyCause: null,
    recommendedResponse:
      !healthMeasured
        ? t('battery.tip.needMeasurements', 'Keep monitoring as capacity measurements arrive; battery health cannot be assessed yet.')
        : health.current_soh < 70
        ? t(
            'operations.battery.narrative.serviceResponse',
            'Arrange an independent battery-health review and preserve the supporting snapshots.',
          )
        : chargingStressTone === 'danger'
          ? t(
              'operations.battery.narrative.chargingResponse',
              'Review repeated fast charging and deep discharge exposure before the pattern continues.',
            )
          : t(
              'operations.battery.narrative.monitorResponse',
              'Continue monitoring capacity, thermal exposure, and charging stress as new snapshots arrive.',
            ),
    limitations: [
      t(
        'operations.battery.narrative.causeLimitation',
        'Capacity history can identify a trend but does not diagnose the physical cause of degradation.',
      ),
      ...(health.temp_exposure_score == null
        ? [
            t(
              'operations.battery.narrative.temperatureLimitation',
              'Temperature history is insufficient to score thermal exposure.',
            ),
          ]
        : []),
      ...(!projectionTrustworthy
        ? [
            t(
              'operations.battery.narrative.projectionLimitation',
              'Time-to-threshold projections remain directional until a stable trend is available.',
            ),
          ]
        : []),
      t(
        'operations.battery.narrative.evidenceLimit',
        'Supporting evidence is limited to the five most recent retained snapshots.',
      ),
    ],
    evidence: narrativeEvidence,
    provenance: [
      {
        source: t('operations.battery.analyticsSource', 'Battery analytics'),
        method: t(
          'operations.battery.narrative.analyticsMethod',
          'Models state of health and degradation from retained battery snapshots.',
        ),
      },
      {
        source: t('operations.battery.narrative.chargingSource', 'Charging history'),
        method: t(
          'operations.battery.narrative.chargingMethod',
          'Measures fast-charge, depth-of-discharge, and cycle exposure from recorded sessions.',
        ),
      },
    ],
  };

  /* ── Main render ───────────────────────────────────────────────── */
  return (
    <PageLayout
      title={t('battery.title', 'Battery Health')}
      subtitle={t('battery.subtitle', 'Degradation tracking, prediction, charging habits & longevity insights')}
    >
      <Stack gap={6} className="min-w-0 w-full" data-testid="battery-health-sections">
      <LiveStaleDataBanner />
      <StaleRefreshWarning state={healthDataState} label={t('battery.title', 'Battery Health')} />

      <OperationalBrief
        compact
        testId="battery-operational-brief"
        eyebrow={t('operations.battery.eyebrow', 'Battery posture')}
        title={t('operations.battery.title', 'Long-term pack health remains measurable and actionable')}
        description={t(
          'operations.battery.description',
          'Health, degradation, range confidence, charging stress, thermal impact, and cycle exposure are summarized before the deeper evidence.',
        )}
        statusLabel={
          !healthMeasured
            ? t('battery.health.unavailable', 'Not measured')
            : health.current_soh >= 90
            ? t('operations.battery.statusHealthy', 'Healthy')
            : health.current_soh >= 70
              ? t('operations.battery.statusMonitor', 'Monitor')
              : t('operations.battery.statusService', 'Service review')
        }
        statusTone={healthOperationalTone}
        narrative={narrative}
        metricColumns={3}
        freshness={
          <div className="flex flex-wrap items-center gap-2">
            <DataProvenanceBadge
              provenance={healthDataState.provenance}
              status={healthDataState.status}
              updatedAt={healthDataState.updatedAt}
            />
            <DataFreshnessAuto
              query={healthQuery}
              source={t('operations.battery.analyticsSource', 'Battery analytics')}
            />
          </div>
        }
        scope={
          <Badge variant="neutral" size="sm">
            {t('operations.scope.lifetime', 'Lifetime model')}
          </Badge>
        }
        metrics={[
          {
            key: 'health',
            rawValue: healthMeasured ? health.current_soh : null,
            valueState: healthMeasured ? 'value' : 'missing',
            label: t('operations.battery.packScore', 'Pack score'),
            value: healthValue,
            detail: t(
              'operations.battery.healthDetail',
              'Current modeled health relative to the original usable pack.',
            ),
            tone: healthOperationalTone,
          },
          {
            key: 'degradation',
            rawValue: healthMeasured ? health.degradation_rate_pct_per_year : null,
            valueState: healthMeasured && Number.isFinite(health.degradation_rate_pct_per_year) ? 'value' : 'missing',
            label: t('operations.battery.degradationPace', 'Degradation pace'),
            value: healthMeasured ? `${fmtNumber(health.degradation_rate_pct_per_year)}%/${t('battery.yr', 'yr')}` : '—',
            detail: t(
              'operations.battery.degradationDetail',
              'Annualized capacity change inferred from available history.',
            ),
            tone: !healthMeasured ? 'neutral' : health.degradation_rate_pct_per_year <= 5 ? 'success' : 'warning',
          },
          {
            key: 'range-confidence',
            rawValue: rangeConfidenceLabel,
            valueState: 'value',
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
            rawValue: chargingStressLabel,
            valueState: 'value',
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
            rawValue: health.temp_exposure_score,
            valueState: health.temp_exposure_score == null ? 'missing' : 'value',
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
            rawValue: health.total_cycles,
            valueState: Number.isFinite(health.total_cycles) ? 'value' : 'missing',
            label: t('operations.battery.cycleExposure', 'Cycle exposure'),
            value: fmtNumber(health.total_cycles),
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
          {/* HELP-03. These four words drive most of the misreadings on this
              page: SoH looks like a fault code, degradation looks like a
              defect, rated range looks like a measurement, and SOC looks like
              a fuel gauge. Defining them where they are used — rather than
              only in the Help glossary — is the whole point of the inline
              affordance. Each `<GlossaryTerm>` self-gates on the user's
              contextual-help preference and degrades to plain text. */}
          <Text as="p" variant="caption"
            className="mb-4 flex flex-wrap items-center gap-x-4 gap-y-1"
            data-testid="battery-glossary-strip"
          >
            <span>{t('battery.glossary.lead', 'Terms on this page:')}</span>
            <GlossaryTerm term="state_of_health" />
            <GlossaryTerm term="degradation" />
            <GlossaryTerm term="soc" />
            <GlossaryTerm term="rated_range" />
          </Text>
          <HealthSummary
            health={health}
            chargingLive={chargingLive}
            healthMeasured={healthMeasured}
            healthValue={healthValue}
            capacityMeasured={capacityMeasured}
            originalCapacityMeasured={originalCapacityMeasured}
            formatEnergy={formatEnergy}
            formatNumber={fmtNumber}
            retained={healthDataState.status === 'stale'}
          />
        </FadeIn>
      </SectionErrorBoundary>

      {/* ── 2. Hero: health gauges + capacity/wear bars ───────────── */}
      <FadeIn delay={0.05} className="min-w-0 w-full">
        <BatteryPanelGrid
          label={t('battery.section.overview', 'Health score and capacity')}
          ids={['battery-health-hero', 'battery-metric-bars']}
          sizes={['half', 'third']}
        >
          <SectionErrorBoundary name="battery:health-hero" fallbackTitle={t('battery.section.heroFailed', 'Health score panel failed to load')}>
            <GlassPanel className={BATTERY_PANEL_CLASS}>
              <PanelTitle className={BATTERY_PANEL_HEADER_CLASS}>
                <Heart className="h-4 w-4 text-cyan-300" aria-hidden="true" />
                {t('battery.hero.title', 'Health Overview')}
              </PanelTitle>
              <div className="grid min-w-0 grid-cols-2 items-center gap-4 sm:grid-cols-3 2xl:grid-cols-5">
                <div className="col-span-2 flex flex-col items-center sm:col-span-1">
                  {healthMeasured ? <LinearGauge
                    value={health.current_soh}
                    max={100}
                    label={t('battery.gauge.health', 'Health Score')}
                    unit="/100"
                    hideScale
                    size={130}
                    tone={healthTone(health.current_soh)}
                  /> : <Text variant="bodySm" className="text-center">{healthUnavailable}</Text>}
                  <Badge variant={healthMeasured ? healthVariant(health.current_soh) : 'neutral'} className="mt-2">
                    {healthMeasured ? healthLabel(health.current_soh, t) : t('battery.health.unavailable', 'Not measured')}
                  </Badge>
                </div>
                {capacityMeasured && originalCapacityMeasured ? <LinearGauge
                  value={capacityNowPct}
                  max={100}
                  label={t('battery.gauge.capacity', 'Capacity')}
                  unit="%"
                  tone="info"
                /> : <Text variant="bodySm">{t('battery.gauge.capacity', 'Capacity')}: —</Text>}
                {healthMeasured ? <LinearGauge
                  value={health.degradation_rate_pct_per_year}
                  max={10}
                  label={t('battery.gauge.degradation', 'Degradation')}
                  unit="%/yr"
                  tone={degradationTone(health.degradation_rate_pct_per_year)}
                /> : <Text variant="bodySm">{t('battery.gauge.degradation', 'Degradation')}: —</Text>}
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
            <GlassPanel className={BATTERY_PANEL_CLASS}>
              <PanelTitle className={BATTERY_PANEL_HEADER_CLASS}>
                <Gauge className="h-4 w-4 text-cyan-300" aria-hidden="true" />
                {t('battery.bars.title', 'Capacity & Wear')}
              </PanelTitle>
              <Stack gap={4}>
                <div>
                  {capacityMeasured && originalCapacityMeasured ? <MetricBar
                    label={t('battery.bar.capacity', 'Current Capacity')}
                    value={Math.round(capacityNowPct)}
                    max={100}
                    color={gaugeTone.info}
                  /> : <Text variant="bodySm">{t('battery.bar.capacity', 'Current Capacity')}: —</Text>}
                  <Text as="p" size="2xs" color="muted" className="mt-1">
                    {capacityMeasured ? formatEnergy(health.estimated_capacity_wh) : '—'} / {originalCapacityMeasured ? formatEnergy(health.original_capacity_wh) : '—'}
                  </Text>
                </div>
                <div>
                  {healthMeasured ? <MetricBar
                    label={t('battery.bar.degradation', 'Degradation')}
                    value={health.degradation_rate_pct_per_year}
                    max={10}
                    color={gaugeTone[degradationTone(health.degradation_rate_pct_per_year)]}
                  /> : <Text variant="bodySm">{t('battery.bar.degradation', 'Degradation')}: —</Text>}
                  <Text as="p" size="2xs" color="muted" className="mt-1">
                    {healthMeasured ? `${fmtNumber(health.degradation_rate_pct_per_year)}% ${t('battery.perYear', 'per year')}` : '—'}
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
              </Stack>
            </GlassPanel>
          </SectionErrorBoundary>
        </BatteryPanelGrid>
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
      <FadeIn delay={0.15} className="min-w-0 w-full">
        <BatteryPanelGrid
          label={t('battery.section.thermalCompare', 'Thermal monitoring and capacity comparison')}
          ids={['battery-thermal', 'battery-capacity-range']}
        >
          <SectionErrorBoundary name="battery:thermal" fallbackTitle={t('battery.section.thermalFailed', 'Thermal monitoring failed to load')}>
            {thermalPanel}
          </SectionErrorBoundary>

          <SectionErrorBoundary name="battery:capacity-range" fallbackTitle={t('battery.section.capacityRangeFailed', 'Capacity & range comparison failed to load')}>
            <GlassPanel className={BATTERY_PANEL_CLASS}>
              <PanelTitle className={BATTERY_PANEL_HEADER_CLASS}>
                <Activity className="h-4 w-4 text-cyan-300" aria-hidden="true" />
                {t('battery.newVsNow.title', 'Capacity & Range: New vs Now')}
              </PanelTitle>
              <BatteryEvidenceBrief
                title={t('battery.newVsNow.brief.summary', 'Capacity and range evidence')}
                retained={healthDataState.status === 'stale'}
                period={{ kind: 'unknown', label: t('battery.newVsNow.brief.scope', 'Reference capacity and first / latest range snapshots'),
                  reason: t('battery.newVsNow.brief.description', 'Capacity values are modeled estimates; range comparison uses the first and latest available history points, not a controlled capacity test.') }}
                metrics={[
                  { metricId: 'energy', occurrenceId: 'capacity-new', rawValue: originalCapacityMeasured ? health.original_capacity_wh : null,
                    label: t('battery.newVsNow.capNew', 'Capacity When New'),
                    display: { formatter: raw => ({ value: formatEnergy(raw), unit: '' }) } },
                  { metricId: 'energy', occurrenceId: 'capacity-now', rawValue: capacityMeasured ? health.estimated_capacity_wh : null,
                    label: t('battery.newVsNow.capNow', 'Capacity Now'),
                    display: { formatter: raw => ({ value: formatEnergy(raw), unit: '' }) },
                    context: capacityMeasured && originalCapacityMeasured
                      ? `-${formatEnergy(Math.max(0, health.original_capacity_wh - health.estimated_capacity_wh))}` : undefined },
                  { metricId: 'distance', occurrenceId: 'range-new', rawValue: history.length > 0 ? history[0].range_m : null,
                    label: t('battery.newVsNow.rangeNew', 'Range When New'),
                    display: { formatter: raw => ({ value: fmtInt(fromMeters(raw)), unit: unitPrefs.distance }) } },
                  { metricId: 'distance', occurrenceId: 'range-now', rawValue: history.length > 0 ? history[history.length - 1].range_m : null,
                    label: t('battery.newVsNow.rangeNow', 'Range Now'),
                    display: { formatter: raw => ({ value: fmtInt(fromMeters(raw)), unit: unitPrefs.distance }) },
                    context: history.length >= 2
                      ? `-${fmtInt(fromMeters(history[0].range_m - history[history.length - 1].range_m))} ${unitPrefs.distance} ${t('battery.newVsNow.lost', 'lost')}` : undefined },
                ]}
              />
            </GlassPanel>
          </SectionErrorBoundary>
        </BatteryPanelGrid>
      </FadeIn>

      {/* ── 5. Smart insights — full-width reflow ─────────────────── */}
      <SectionErrorBoundary name="battery:insights" fallbackTitle={t('battery.section.insightsFailed', 'Smart insights failed to load')}>
        <FadeIn delay={0.2} className="min-w-0 w-full">
          <section aria-label={t('battery.insights.title', 'Smart Insights')} className="min-w-0 w-full space-y-4">
            <SectionTitle className="flex min-w-0 items-center gap-2">
              <Heart className="h-4 w-4 text-rose-300" aria-hidden="true" />
              {t('battery.insights.title', 'Smart Insights')}
            </SectionTitle>
            {insights.length > 0 ? (
              <Grid minItemWidth="wide" gap={4} className="min-w-0 w-full">
                {insights.map((ins, i) => {
                  const sev = severityTokens[insightSeverity[ins.status]];
                  return (
                    <GlassPanel
                      key={i}
                      data-severity={insightSeverity[ins.status]}
                      className={cn(BATTERY_PANEL_CLASS, 'border transition-all duration-normal', sev.border, sev.bg)}
                    >
                      <div className="flex items-start gap-3">
                        <div className={cn('mt-0.5 shrink-0', sev.fg)}>{ins.icon}</div>
                        <div className="min-w-0">
                          <Text as="p" size="sm" weight="medium" color="primary">{ins.title}</Text>
                          <Text as="p" variant="bodySm" className="mt-2">{ins.description}</Text>
                        </div>
                      </div>
                    </GlassPanel>
                  );
                })}
              </Grid>
            ) : (
              <GlassPanel className={BATTERY_PANEL_CLASS}>
              <EmptyState /* no-action: transient empty state — surfaces when source data is missing; no specific recovery action available */
                icon={<Info className="h-8 w-8" aria-hidden="true" />}
                message={t('battery.insights.empty', 'Not enough data for insights yet')}
                className="py-6"
              />
              </GlassPanel>
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
      <FadeIn delay={0.35} className="min-w-0 w-full">
        <BatteryPanelGrid
          label={t('battery.section.linksTips', 'Related pages and recommendations')}
          ids={['battery-quick-links', 'battery-recommendations']}
        >
          <SectionErrorBoundary name="battery:quick-links" fallbackTitle={t('battery.section.quickLinksFailed', 'Quick links failed to load')}>
            <HealthQuickLinksPanel />
          </SectionErrorBoundary>

          <SectionErrorBoundary name="battery:recommendations" fallbackTitle={t('battery.section.recommendationsFailed', 'Recommendations failed to load')}>
            <GlassPanel className={BATTERY_PANEL_CLASS}>
              <div className={BATTERY_PANEL_HEADER_CLASS}>
              <Badge variant="success">
                <Lightbulb className="mr-1 inline h-4 w-4" aria-hidden="true" />
                {t('battery.recommendations.title', 'Recommendations')}
              </Badge>
              </div>
              <ul className="space-y-4">
                {recommendations.map((tip, idx) => (
                  <li key={idx} className="flex items-start gap-2">
                    <Lightbulb className="mt-0.5 h-4 w-4 shrink-0 text-emerald-300" aria-hidden="true" />
                    <Text variant="body">{tip}</Text>
                  </li>
                ))}
              </ul>
            </GlassPanel>
          </SectionErrorBoundary>
        </BatteryPanelGrid>
      </FadeIn>
      </Stack>
    </PageLayout>
  );
}
