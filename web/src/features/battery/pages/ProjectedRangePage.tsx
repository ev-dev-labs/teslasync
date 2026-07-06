import { useMemo, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Gauge, TrendingUp, Thermometer, Wind, Mountain,
  Car, Lightbulb, Zap, BatteryFull, Shield, Snowflake,
  Route, Grid3x3, SlidersHorizontal,
} from 'lucide-react';

import { PageContainer } from '@/components/layout';
import { VehicleSelect } from '@/components/forms';
import { GlassPanel, Badge, Slider, PanelTitle, Text, Caption, HelperText } from '@/components/ui';
import { MetricCard } from '@/components/data-display';
import {
  RadialGauge, ChartTooltip,
  chartMargin, axisTick, CHART_COLORS,
  AreaChart, Area, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, Legend, ReferenceLine,
  AREA_DEFAULTS, areaGradient,
} from '@/components/charts';
import { Skeleton, EmptyState, QueryError } from '@/components/feedback';
import { FadeIn, StaggerContainer, StaggerItem } from '@/components/motion';
import { AIRangePrediction } from '@/components/ai/AIRangePrediction';

import { usePageTitle } from '@/hooks/usePageTitle';
import { useSelectedVehicle } from '@/hooks/useSelectedVehicle';
import { useUnits } from '@/hooks/useUnits';
import {
  useRangeProjection,
  type EfficiencyBucket,
  type RangeScenario,
} from '@/api/hooks/useAnalytics';
import { fmtNumber } from '@/lib/numberFormat';
import { cn } from '@/lib/cn';

/* ── Static maps ── */

const FACTOR_ICONS: Record<string, ReactNode> = {
  temperature: <Thermometer className="h-4 w-4" aria-hidden="true" />,
  speed: <Car className="h-4 w-4" aria-hidden="true" />,
  hvac: <Wind className="h-4 w-4" aria-hidden="true" />,
  elevation: <Mountain className="h-4 w-4" aria-hidden="true" />,
  driving_style: <Gauge className="h-4 w-4" aria-hidden="true" />,
};

const TEMP_BUCKETS = ['freezing', 'cold', 'mild', 'hot'] as const;
const SPEED_BUCKETS = ['city', 'suburban', 'highway'] as const;

const TEMP_BUCKET_LABELS: Record<string, string> = {
  freezing: 'Freezing', cold: 'Cold', mild: 'Mild', hot: 'Hot',
};
const SPEED_BUCKET_LABELS: Record<string, string> = {
  city: 'City', suburban: 'Suburban', highway: 'Highway',
};

/**
 * Heatmap cell tint by efficiency (lower Wh/km is better).
 * Exported for unit testing of the band thresholds.
 */
export function effColor(whKm: number): string {
  if (whKm <= 155) return 'bg-neon-green';
  if (whKm <= 180) return 'bg-emerald-500';
  if (whKm <= 210) return 'bg-neon-amber';
  return 'bg-red-500';
}

/**
 * Pick the glyph that best summarises a scenario (Sentry drain, sub-zero,
 * high-speed, or the neutral baseline). Exported for unit testing the
 * precedence of the branches.
 */
export function scenarioIcon(scenario: RangeScenario): ReactNode {
  if ((scenario.extras ?? []).includes('sentry')) return <Shield className="h-4 w-4" aria-hidden="true" />;
  if ((scenario.temp_c ?? 0) < 0) return <Snowflake className="h-4 w-4" aria-hidden="true" />;
  if ((scenario.speed_kmh ?? 0) > 90) return <Car className="h-4 w-4" aria-hidden="true" />;
  return <Zap className="h-4 w-4" aria-hidden="true" />;
}

/* ── "What if" interpolation ── */

/**
 * "What-if" range interpolation for the calculator. Looks up the learned
 * efficiency for the (temp, speed) bucket, falling back to a smooth heuristic
 * when the driver has no drives in that cell, then derives usable range.
 *
 * Exported for unit testing. Guards every arithmetic input: a NaN/Infinity in
 * a matrix cell — or a nonsense capacity / battery % — must never surface as a
 * "NaN km" range to the driver. It collapses to a safe efficiency and a
 * clamped, finite range instead.
 */
export function interpolateRange(
  matrix: EfficiencyBucket[],
  speedKmh: number,
  tempC: number,
  batteryPct: number,
  capacityWh: number,
): { effWhKm: number; rangeKm: number } {
  const tempBucket = tempC < 0 ? 'freezing' : tempC < 10 ? 'cold' : tempC < 25 ? 'mild' : 'hot';
  const speedBucket = speedKmh < 50 ? 'city' : speedKmh < 90 ? 'suburban' : 'highway';

  const match = matrix.find((b) => b.temp_bucket === tempBucket && b.speed_bucket === speedBucket);
  let eff = match?.wh_km ?? (155 + (speedKmh - 35) * 0.5 + Math.max(0, 20 - tempC) * 1.5);
  // A non-positive OR non-finite efficiency (NaN/Infinity from a bad matrix
  // cell) would poison the division below — collapse to a safe default so the
  // calculator never renders "NaN km".
  if (!Number.isFinite(eff) || eff <= 0) eff = 170;

  const safePct = Number.isFinite(batteryPct) ? Math.min(Math.max(batteryPct, 0), 100) : 0;
  const safeCapacity = Number.isFinite(capacityWh) && capacityWh > 0 ? capacityWh : 0;
  const rangeKm = (safeCapacity * (safePct / 100)) / eff;

  return {
    effWhKm: Math.round(eff * 10) / 10,
    rangeKm: Math.round(Math.max(rangeKm, 0) * 10) / 10,
  };
}

/* ── Component ── */

export default function ProjectedRangePage() {
  const { t } = useTranslation();
  usePageTitle(t('range.title', 'Projected Range'));
  const { formatEnergy, formatTemperature, formatSpeed, formatDistance } = useUnits();

  // Header VehiclePicker is the source of truth.
  const { vehicleId: globalVehicleId } = useSelectedVehicle();
  const activeId = globalVehicleId != null ? String(globalVehicleId) : '';

  const rangeQuery = useRangeProjection(activeId);
  const { data, isLoading, isError, error, refetch } = rangeQuery;

  // What-if sliders (domain values are km/h and °C — display via useUnits).
  const [whatIfSpeed, setWhatIfSpeed] = useState(80);
  const [whatIfTemp, setWhatIfTemp] = useState(20);

  const whatIfResult = useMemo(() => {
    if (!data) return null;
    return interpolateRange(
      data.efficiency_matrix ?? [],
      whatIfSpeed, whatIfTemp,
      data.current_battery_pct ?? data.battery_level ?? 80,
      data.usable_capacity_wh ?? 75000,
    );
  }, [data, whatIfSpeed, whatIfTemp]);

  const efficiencyColor = (data?.efficiency_factor ?? 0) >= 0.9
    ? CHART_COLORS[1] : (data?.efficiency_factor ?? 0) >= 0.7 ? CHART_COLORS[3] : CHART_COLORS[5];

  // Efficiency heatmap lookup keyed by "temp|speed".
  const matrixLookup = useMemo(() => {
    const map: Record<string, EfficiencyBucket> = {};
    for (const b of data?.efficiency_matrix ?? []) {
      map[`${b.temp_bucket}|${b.speed_bucket}`] = b;
    }
    return map;
  }, [data]);

  const tips = useMemo<{ icon: ReactNode; text: string }[]>(() => [
    { icon: <Zap className="h-4 w-4" aria-hidden="true" />, text: t('range.tip.speed', 'Keep speed under 110 km/h for optimal efficiency.') },
    { icon: <Thermometer className="h-4 w-4" aria-hidden="true" />, text: t('range.tip.precondition', 'Pre-condition the cabin while still plugged in.') },
    { icon: <Wind className="h-4 w-4" aria-hidden="true" />, text: t('range.tip.seatHeaters', 'Use seat heaters instead of cabin heat in cold weather.') },
    { icon: <TrendingUp className="h-4 w-4" aria-hidden="true" />, text: t('range.tip.elevation', 'Plan routes to minimize elevation changes.') },
  ], [t]);

  const scenarios = data?.scenarios ?? [];
  const factors = data?.factors ?? [];
  const matrix = data?.efficiency_matrix ?? [];
  const curve = data?.projection_curve ?? [];

  const pageProps = {
    title: t('range.title', 'Projected Range'),
    subtitle: t('range.subtitle', 'Personalized range estimates based on your driving patterns, weather, and conditions'),
    actions: <VehicleSelect />,
  };

  // No vehicle scope yet — surface a single actionable prompt.
  if (activeId === '') {
    return (
      <PageContainer {...pageProps}>
        <GlassPanel className="p-6 sm:p-8">
          <EmptyState
            /* no-action: precondition — the header vehicle picker is the recovery affordance, not an in-panel CTA */
            icon={<Route className="h-8 w-8" aria-hidden="true" />}
            message={t('range.selectVehicle', 'Select a vehicle to see its projected range.')}
          />
        </GlassPanel>
      </PageContainer>
    );
  }

  return (
    <PageContainer {...pageProps} query={rangeQuery}>
      {/* 1 — KPI band: full-width responsive metric grid */}
      <FadeIn>
        <section aria-label={t('range.kpis', 'Range summary metrics')}>
          {isError ? (
            <GlassPanel className="p-4 sm:p-5">
              <QueryError error={error} onRetry={() => refetch()} />
            </GlassPanel>
          ) : isLoading && !data ? (
            <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-3 xl:grid-cols-5">
              {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} height={86} rounded />)}
            </div>
          ) : (
            <StaggerContainer className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-3 xl:grid-cols-5">
              <StaggerItem>
                <MetricCard label={t('range.yourEstimate', 'Your Estimate')} value={formatDistance((data?.your_estimate_km ?? 0) * 1000, { precision: 0 })} icon={<TrendingUp className="h-4 w-4" aria-hidden="true" />} color="green" />
              </StaggerItem>
              <StaggerItem>
                <MetricCard label={t('range.teslaEstimate', 'Tesla Estimate')} value={formatDistance((data?.tesla_estimate_km ?? 0) * 1000, { precision: 0 })} icon={<Car className="h-4 w-4" aria-hidden="true" />} color="cyan" />
              </StaggerItem>
              <StaggerItem>
                <MetricCard label={t('range.battery', 'Battery')} value={`${fmtNumber(data?.current_battery_pct ?? data?.battery_level ?? 0, 0)}%`} icon={<BatteryFull className="h-4 w-4" aria-hidden="true" />} color="purple" />
              </StaggerItem>
              <StaggerItem>
                <MetricCard label={t('range.usableCapacity', 'Usable Capacity')} value={formatEnergy(data?.usable_capacity_wh ?? 0)} icon={<Zap className="h-4 w-4" aria-hidden="true" />} color="amber" />
              </StaggerItem>
              <StaggerItem>
                <MetricCard label={t('range.healthFactor', 'Health Factor')} value={`${fmtNumber((data?.health_factor ?? 1) * 100, 1)}%`} icon={<Shield className="h-4 w-4" aria-hidden="true" />} color="green" />
              </StaggerItem>
            </StaggerContainer>
          )}
        </section>
      </FadeIn>

      {/* 2 — Primary visual: efficiency gauge + projection curve (hero) */}
      <FadeIn delay={0.05}>
        <section aria-label={t('range.projectionCurve', 'Range Projection Curve')} className="grid grid-cols-1 gap-3 sm:gap-4 md:grid-cols-3">
          <GlassPanel className="flex flex-col items-center gap-3 p-4 sm:p-5">
            <PanelTitle className="self-start">{t('range.efficiency', 'Efficiency')}</PanelTitle>
            {isLoading && !data ? (
              <Skeleton width="160px" height={160} rounded />
            ) : isError ? (
              <QueryError error={error} onRetry={() => refetch()} />
            ) : !data ? (
              <EmptyState /* no-action: transient — efficiency resolves once the projection loads */ message={t('range.noEfficiency', 'Efficiency data unavailable yet.')} />
            ) : (
              <div className="flex flex-1 flex-col items-center justify-center">
                <RadialGauge
                  value={Math.round((data.efficiency_factor ?? 0) * 100)}
                  max={100}
                  label={t('range.efficiency', 'Efficiency')}
                  unit="%"
                  color={efficiencyColor}
                  size={160}
                />
                {data.accuracy_note && <HelperText className="mt-2 text-center">{data.accuracy_note}</HelperText>}
              </div>
            )}
          </GlassPanel>

          <GlassPanel className="p-4 sm:p-5 md:col-span-2">
            <PanelTitle className="mb-3">{t('range.projectionCurve', 'Range Projection Curve')}</PanelTitle>
            {isLoading && !data ? (
              <Skeleton height={260} />
            ) : isError ? (
              <QueryError error={error} onRetry={() => refetch()} />
            ) : curve.length === 0 || !data ? (
              <EmptyState /* no-action: transient — curve populates once the vehicle logs drives */ message={t('range.noCurve', 'Range projection curve will appear once this vehicle logs drives.')} />
            ) : (
              <div className="h-56 sm:h-64 xl:h-72" role="img" aria-label={t('range.projectionCurveAria', 'Rated versus projected range across battery level')}>
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={curve} margin={chartMargin}>
                    {areaGradient('ratedFill', CHART_COLORS[0])}
                    {areaGradient('projectedFill', CHART_COLORS[1])}
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--border-subtle)" strokeOpacity={0.4} />
                    <XAxis dataKey="battery_pct" tick={axisTick} unit="%" />
                    <YAxis tick={axisTick} unit=" km" width={55} />
                    <Tooltip content={<ChartTooltip />} />
                    <Legend />
                    <ReferenceLine x={data.battery_level} stroke={CHART_COLORS[3]} strokeDasharray="4 4" label={t('range.current', 'Current')} />
                    <Area {...AREA_DEFAULTS} dataKey="rated_range" name={t('range.rated', 'Rated Range')} stroke={CHART_COLORS[0]} fill="url(#ratedFill)" />
                    <Area {...AREA_DEFAULTS} dataKey="projected_range" name={t('range.projected', 'Projected Range')} stroke={CHART_COLORS[1]} fill="url(#projectedFill)" />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            )}
          </GlassPanel>
        </section>
      </FadeIn>

      {/* 3 — Opt-in learned per-vehicle range model. Renders only when       */}
      {/* ai_mode != 'off' AND the range-prediction-model toggle is on. The   */}
      {/* deterministic heuristic curve above remains the canonical baseline. */}
      <FadeIn delay={0.1}>
        <AIRangePrediction vehicleId={globalVehicleId ?? undefined} />
      </FadeIn>

      {/* 4 — Scenario cards: full-width auto-reflowing bento */}
      <FadeIn delay={0.15}>
        <GlassPanel className="p-4 sm:p-5">
          <PanelTitle className="mb-3 flex items-center gap-2">
            <Route className="h-4 w-4 text-cyan-300" aria-hidden="true" />
            {t('range.scenarios', 'Range Scenarios')}
          </PanelTitle>
          {isLoading && !data ? (
            <Skeleton height={140} />
          ) : isError ? (
            <QueryError error={error} onRetry={() => refetch()} />
          ) : scenarios.length === 0 ? (
            <EmptyState /* no-action: transient empty state — surfaces when source data is missing; no specific recovery action available */ message={t('range.noScenarios', 'Drive more to see personalized scenario projections.')} />
          ) : (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 3xl:grid-cols-6">
              {scenarios.map((s) => (
                <GlassPanel key={s.name} className={cn('p-4', s.is_current && 'ring-1 ring-neon-green/30')}>
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <div className="flex min-w-0 items-center gap-2 text-cyan-300">
                      {scenarioIcon(s)}
                      <Text as="span" size="sm" weight="semibold" color="primary" className="truncate">{s.name}</Text>
                    </div>
                    {s.is_current && <Badge variant="success" size="sm">{t('range.current', 'Current')}</Badge>}
                  </div>
                  <Text as="p" size="2xl" weight="bold" color="primary" className="tabular-nums">{formatDistance((s.range_km ?? 0) * 1000, { precision: 0 })}</Text>
                  <div className="mt-2 flex flex-wrap gap-x-2 gap-y-1">
                    <Caption>{formatSpeed((s.speed_kmh ?? 0) / 3.6, { precision: 0 })}</Caption>
                    <Caption>{formatTemperature(s.temp_c ?? 0, { precision: 0 })}</Caption>
                    <Caption>{fmtNumber(s.efficiency_wh_km ?? 0)} {t('range.whPerKm', 'Wh/km')}</Caption>
                    {(s.sample_count ?? 0) > 0 && <Caption>{t('range.drivesCount', '{{count}} drives', { count: s.sample_count })}</Caption>}
                  </div>
                  {(s.extras ?? []).length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1">
                      {(s.extras ?? []).map((x) => <Badge key={x} variant="neutral" size="sm">{x}</Badge>)}
                    </div>
                  )}
                </GlassPanel>
              ))}
            </div>
          )}
        </GlassPanel>
      </FadeIn>

      {/* 5 — Efficiency matrix + What-if calculator, side-by-side on wide */}
      <FadeIn delay={0.2}>
        <section aria-label={t('range.efficiencyMatrix', 'Personal Efficiency Matrix (Wh/km)')} className="grid grid-cols-1 gap-3 sm:gap-4 xl:grid-cols-2">
          <GlassPanel className="p-4 sm:p-5">
            <PanelTitle className="mb-3 flex items-center gap-2">
              <Grid3x3 className="h-4 w-4 text-cyan-300" aria-hidden="true" />
              {t('range.efficiencyMatrix', 'Personal Efficiency Matrix (Wh/km)')}
            </PanelTitle>
            {isLoading && !data ? (
              <Skeleton height={200} />
            ) : isError ? (
              <QueryError error={error} onRetry={() => refetch()} />
            ) : matrix.length === 0 ? (
              <EmptyState /* no-action: transient empty state — surfaces when source data is missing; no specific recovery action available */ message={t('range.noMatrix', 'Efficiency data requires drives in different conditions.')} />
            ) : (
              <div className="overflow-x-auto">
                <div className="min-w-[360px]">
                  <div className="mb-1 grid grid-cols-4 gap-1">
                    <div className="p-2" />
                    {SPEED_BUCKETS.map((s) => (
                      <Caption key={s} className="block p-2 text-center">{t(`range.speedBucket.${s}`, SPEED_BUCKET_LABELS[s] ?? s)}</Caption>
                    ))}
                  </div>
                  {TEMP_BUCKETS.map((temp) => (
                    <div key={temp} className="mb-1 grid grid-cols-4 gap-1">
                      <Text as="span" size="xs" weight="medium" color="muted" className="flex items-center p-2">{t(`range.tempBucket.${temp}`, TEMP_BUCKET_LABELS[temp] ?? temp)}</Text>
                      {SPEED_BUCKETS.map((speed) => {
                        const bucket = matrixLookup[`${temp}|${speed}`];
                        return (
                          <div key={speed} className="p-1 text-center">
                            {bucket ? (
                              <div className={cn('rounded-lg px-3 py-2', effColor(bucket.wh_km), 'bg-opacity-20')}>
                                <Text as="span" size="xs" weight="bold" color="primary">{fmtNumber(bucket.wh_km, 0)}</Text>
                                <Caption className="block">({bucket.samples ?? 0})</Caption>
                              </div>
                            ) : (
                              <div className="rounded-lg bg-white/[0.03] px-3 py-2">
                                <Caption>—</Caption>
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </GlassPanel>

          <GlassPanel className="p-4 sm:p-5">
            <PanelTitle className="mb-3 flex items-center gap-2">
              <SlidersHorizontal className="h-4 w-4 text-cyan-300" aria-hidden="true" />
              {t('range.whatIf', 'What If Calculator')}
            </PanelTitle>
            {isLoading && !data ? (
              <Skeleton height={200} />
            ) : isError ? (
              <QueryError error={error} onRetry={() => refetch()} />
            ) : !data ? (
              <EmptyState /* no-action: transient — the calculator needs a loaded projection to interpolate */ message={t('range.noWhatIf', 'Adjust sliders to calculate projected range.')} />
            ) : (
              <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
                <div className="space-y-4">
                  <div>
                    <Slider
                      label={t('range.speed', 'Speed')}
                      formatValue={(n) => formatSpeed(n / 3.6, { precision: 0 })}
                      min={30}
                      max={150}
                      step={5}
                      value={whatIfSpeed}
                      onChange={setWhatIfSpeed}
                    />
                    <div className="mt-0.5 flex justify-between">
                      <Caption>{formatSpeed(30 / 3.6, { precision: 0 })}</Caption>
                      <Caption>{formatSpeed(90 / 3.6, { precision: 0 })}</Caption>
                      <Caption>{formatSpeed(150 / 3.6, { precision: 0 })}</Caption>
                    </div>
                  </div>
                  <div>
                    <Slider
                      label={t('range.temperature', 'Temperature')}
                      formatValue={(n) => formatTemperature(n, { precision: 0 })}
                      min={-20}
                      max={40}
                      step={1}
                      value={whatIfTemp}
                      onChange={setWhatIfTemp}
                    />
                    <div className="mt-0.5 flex justify-between">
                      <Caption>{formatTemperature(-20, { precision: 0 })}</Caption>
                      <Caption>{formatTemperature(10, { precision: 0 })}</Caption>
                      <Caption>{formatTemperature(40, { precision: 0 })}</Caption>
                    </div>
                  </div>
                </div>
                <div className="flex items-center justify-center rounded-xl bg-white/[0.02] p-4">
                  {whatIfResult ? (
                    <div className="text-center">
                      <Text as="p" size="3xl" weight="bold" className="text-cyan-300 tabular-nums">{formatDistance(whatIfResult.rangeKm * 1000, { precision: 0 })}</Text>
                      <HelperText className="mt-1">{fmtNumber(whatIfResult.effWhKm)} {t('range.whPerKm', 'Wh/km')}</HelperText>
                      <HelperText className="mt-1">{t('range.whatIfConditions', 'at {{speed}}, {{temp}}', { speed: formatSpeed(whatIfSpeed / 3.6, { precision: 0 }), temp: formatTemperature(whatIfTemp, { precision: 0 }) })}</HelperText>
                    </div>
                  ) : (
                    <EmptyState /* no-action: transient — result appears as soon as the sliders resolve */ message={t('range.noWhatIf', 'Adjust sliders to calculate projected range.')} />
                  )}
                </div>
              </div>
            )}
          </GlassPanel>
        </section>
      </FadeIn>

      {/* 6 — Range factors: full-width responsive grid */}
      <FadeIn delay={0.25}>
        <GlassPanel className="p-4 sm:p-5">
          <PanelTitle className="mb-3">{t('range.factors', 'Range Factors')}</PanelTitle>
          {isLoading && !data ? (
            <Skeleton height={120} />
          ) : isError ? (
            <QueryError error={error} onRetry={() => refetch()} />
          ) : factors.length === 0 ? (
            <EmptyState /* no-action: transient — factors surface once enough driving data accrues */ message={t('range.noFactors', 'Range factors will appear once enough driving data is collected.')} />
          ) : (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 3xl:grid-cols-4">
              {factors.map((f) => (
                <GlassPanel key={f.name} className="flex items-start gap-3 p-4">
                  <span className="mt-0.5 shrink-0 text-[var(--text-muted)]" aria-hidden="true">
                    {FACTOR_ICONS[(f.name ?? '').toLowerCase().replace(/\s+/g, '_')] ?? <Gauge className="h-4 w-4" />}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <Text as="span" size="sm" weight="medium" color="primary">{t(`range.factor.${f.name}`, f.name)}</Text>
                      <Badge variant={(f.impact_pct ?? 0) >= 0 ? 'success' : 'danger'} size="sm">
                        {(f.impact_pct ?? 0) >= 0 ? '+' : ''}{fmtNumber(f.impact_pct ?? 0, 1)}%
                      </Badge>
                    </div>
                    <HelperText className="mt-1 block">{t(`range.factorDesc.${f.name}`, f.description)}</HelperText>
                  </div>
                </GlassPanel>
              ))}
            </div>
          )}
        </GlassPanel>
      </FadeIn>

      {/* 7 — Tips: full-width card grid */}
      <FadeIn delay={0.3}>
        <GlassPanel className="p-4 sm:p-5">
          <PanelTitle className="mb-3 flex items-center gap-2">
            <Lightbulb className="h-4 w-4 text-emerald-300" aria-hidden="true" />
            {t('range.tips', 'Tips to Maximize Range')}
          </PanelTitle>
          <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {tips.map((tip, i) => (
              <li key={i} className="flex items-start gap-2 rounded-xl bg-white/[0.02] p-3">
                <span className="mt-0.5 shrink-0 text-emerald-300" aria-hidden="true">{tip.icon}</span>
                <Text as="span" size="sm" color="secondary">{tip.text}</Text>
              </li>
            ))}
          </ul>
        </GlassPanel>
      </FadeIn>
    </PageContainer>
  );
}
