import { useState, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import {
  Gauge, TrendingUp, Thermometer, Wind, Mountain,
  Car, Lightbulb, Zap, BatteryFull, Shield, Snowflake,
} from 'lucide-react';

import { PageContainer } from '@/components/layout';
import { GlassPanel, Badge, Slider } from '@/components/ui';
import { MetricCard } from '@/components/data-display';
import {
  RadialGauge, ChartTooltip,
  chartMargin, axisTick, CHART_COLORS,
  AreaChart, Area, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, Legend, ReferenceLine,
  AREA_DEFAULTS, areaGradient,
} from '@/components/charts';
import { Skeleton, EmptyState } from '@/components/feedback';
import { FadeIn, StaggerContainer, StaggerItem } from '@/components/motion';

import { usePageTitle } from '@/hooks/usePageTitle';
import { useSelectedVehicle } from '@/hooks/useSelectedVehicle';
import { fmtNumber } from '@/lib/numberFormat';
import { cn } from '@/lib/cn';
import { request } from '@/api/client';
import { useUnits } from '@/hooks/useUnits';

/* ── Types ── */

interface RangeFactor { name: string; impact_pct: number; description: string }
interface CurvePoint { battery_pct: number; rated_range: number; projected_range: number }
interface EfficiencyBucket { temp_bucket: string; speed_bucket: string; wh_km: number; samples: number }
interface RangeScenario {
  name: string;
  speed_kmh: number;
  temp_c: number;
  efficiency_wh_km: number;
  range_km: number;
  range_mi: number;
  sample_count: number;
  extras: string[];
  is_current?: boolean;
}
interface RangeProjection {
  current_range_km: number;
  projected_range_km: number;
  battery_level: number;
  efficiency_factor: number;
  factors: RangeFactor[];
  projection_curve: CurvePoint[];
  current_battery_pct: number;
  usable_capacity_wh: number;
  health_factor: number;
  scenarios: RangeScenario[];
  efficiency_matrix: EfficiencyBucket[];
  tesla_estimate_km: number;
  your_estimate_km: number;
  accuracy_note: string;
}

const FACTOR_ICONS: Record<string, React.ReactNode> = {
  temperature: <Thermometer className="h-4 w-4" />,
  speed: <Car className="h-4 w-4" />,
  hvac: <Wind className="h-4 w-4" />,
  elevation: <Mountain className="h-4 w-4" />,
  driving_style: <Gauge className="h-4 w-4" />,
};

const TEMP_BUCKETS = ['freezing', 'cold', 'mild', 'hot'] as const;
const SPEED_BUCKETS = ['city', 'suburban', 'highway'] as const;

function effColor(whKm: number): string {
  if (whKm <= 155) return 'bg-neon-green';
  if (whKm <= 180) return 'bg-emerald-500';
  if (whKm <= 210) return 'bg-neon-amber';
  return 'bg-red-500';
}

function scenarioIcon(scenario: RangeScenario) {
  if ((scenario.extras ?? []).includes('sentry')) return <Shield className="h-4 w-4" />;
  if (scenario.temp_c < 0) return <Snowflake className="h-4 w-4" />;
  if (scenario.speed_kmh > 90) return <Car className="h-4 w-4" />;
  return <Zap className="h-4 w-4" />;
}

/* ── "What if" interpolation ── */

function interpolateRange(
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
  if (eff <= 0) eff = 170;
  const rangeKm = capacityWh * (batteryPct / 100) / eff;
  return { effWhKm: Math.round(eff * 10) / 10, rangeKm: Math.round(rangeKm * 10) / 10 };
}

/* ── Component ── */

export default function ProjectedRangePage() {
  const { t } = useTranslation();
  usePageTitle(t('range.title', 'Projected Range'));
  const { formatEnergy } = useUnits();

  // Phase 40 / Prompt 16: header VehiclePicker is the source of truth.
  const { vehicleId: globalVehicleId } = useSelectedVehicle();
  const activeId = globalVehicleId != null ? String(globalVehicleId) : '';

  const { data, isLoading, error } = useQuery<RangeProjection>({
    queryKey: ['range-projection', activeId],
    queryFn: () => request<RangeProjection>(`/analytics/range-projection?vehicle_id=${activeId}`),
    enabled: activeId !== '',
  });

  // What-if sliders
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

  // Build efficiency heatmap lookup
  const matrixLookup = useMemo(() => {
    const map: Record<string, EfficiencyBucket> = {};
    for (const b of data?.efficiency_matrix ?? []) {
      map[`${b.temp_bucket}|${b.speed_bucket}`] = b;
    }
    return map;
  }, [data]);

  const tips = useMemo(() => [
    { icon: <Zap className="h-4 w-4" />, text: t('range.tip.speed', 'Keep speed under 110 km/h for optimal efficiency.') },
    { icon: <Thermometer className="h-4 w-4" />, text: t('range.tip.precondition', 'Pre-condition the cabin while still plugged in.') },
    { icon: <Wind className="h-4 w-4" />, text: t('range.tip.seatHeaters', 'Use seat heaters instead of cabin heat in cold weather.') },
    { icon: <TrendingUp className="h-4 w-4" />, text: t('range.tip.elevation', 'Plan routes to minimize elevation changes.') },
  ], [t]);

  return (
    <PageContainer
      title={t('range.title', 'Projected Range')}
      subtitle={t('range.subtitle', 'Personalized range estimates based on your driving patterns, weather, and conditions')}
      loading={isLoading}
      error={error instanceof Error ? error : null}
    >
      {/* ── Hero: Current range vs Tesla estimate ───── */}
      <FadeIn>
        <StaggerContainer className="grid grid-cols-2 gap-4 lg:grid-cols-5">
          <StaggerItem>
            <MetricCard label={t('range.yourEstimate', 'Your Estimate')} value={`${fmtNumber(data?.your_estimate_km, 0)} km`} icon={<TrendingUp className="h-4 w-4" />} color="green" />
          </StaggerItem>
          <StaggerItem>
            <MetricCard label={t('range.teslaEstimate', 'Tesla Estimate')} value={`${fmtNumber(data?.tesla_estimate_km, 0)} km`} icon={<Car className="h-4 w-4" />} color="cyan" />
          </StaggerItem>
          <StaggerItem>
            <MetricCard label={t('range.battery', 'Battery')} value={`${fmtNumber(data?.current_battery_pct ?? data?.battery_level, 0)}%`} icon={<BatteryFull className="h-4 w-4" />} color="purple" />
          </StaggerItem>
          <StaggerItem>
            <MetricCard label={t('range.usableCapacity', 'Usable Capacity')} value={formatEnergy(data?.usable_capacity_wh)} icon={<Zap className="h-4 w-4" />} color="amber" />
          </StaggerItem>
          <StaggerItem>
            <MetricCard label={t('range.healthFactor', 'Health Factor')} value={`${fmtNumber((data?.health_factor ?? 1) * 100, 1)}%`} icon={<Shield className="h-4 w-4" />} color="green" />
          </StaggerItem>
        </StaggerContainer>
      </FadeIn>

      {/* ── Gauge + Projection Curve ───────────────── */}
      <FadeIn delay={0.05}>
        <div className="grid gap-4 grid-cols-1 md:grid-cols-3">
          <GlassPanel className="flex flex-col items-center justify-center p-6">
            {data ? (
              <RadialGauge
                value={Math.round(data.efficiency_factor * 100)}
                max={100}
                label={t('range.efficiency', 'Efficiency')}
                unit="%"
                color={efficiencyColor}
                size={160}
              />
            ) : (
              <Skeleton width="160px" height={160} rounded />
            )}
            {data?.accuracy_note && (
              <p className="mt-2 text-[10px] text-[var(--text-muted)] text-center">{data.accuracy_note}</p>
            )}
          </GlassPanel>

          <GlassPanel className="col-span-1 md:col-span-2 p-4">
            <span className="mb-2 block text-sm font-medium text-[var(--text-secondary)]">{t('range.projectionCurve', 'Range Projection Curve')}</span>
            {data?.projection_curve && data.projection_curve.length > 0 ? (
              <ResponsiveContainer width="100%" height={260}>
                <AreaChart data={data.projection_curve} margin={chartMargin}>
                  {areaGradient('ratedFill', CHART_COLORS[0])}
                  {areaGradient('projectedFill', CHART_COLORS[1])}
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" strokeOpacity={0.4} />
                  <XAxis dataKey="battery_pct" tick={axisTick} unit="%" />
                  <YAxis tick={axisTick} unit=" km" width={55} />
                  <Tooltip content={<ChartTooltip />} />
                  <Legend />
                  <ReferenceLine x={data.battery_level} stroke={CHART_COLORS[3]} strokeDasharray="4 4" label={t('range.current', 'Current')} />
                  <Area {...AREA_DEFAULTS} dataKey="rated_range" name={t('range.rated', 'Rated Range')} stroke={CHART_COLORS[0]} fill="url(#ratedFill)" />
                  <Area {...AREA_DEFAULTS} dataKey="projected_range" name={t('range.projected', 'Projected Range')} stroke={CHART_COLORS[1]} fill="url(#projectedFill)" />
                </AreaChart>
              </ResponsiveContainer>
            ) : (
              <Skeleton height={260} />
            )}
          </GlassPanel>
        </div>
      </FadeIn>

      {/* ── Scenario Cards ─────────────────────────── */}
      <FadeIn delay={0.1}>
        <GlassPanel className="p-6">
          <h3 className="mb-4 text-sm font-semibold">{t('range.scenarios', 'Range Scenarios')}</h3>
          {(data?.scenarios ?? []).length > 0 ? (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {(data?.scenarios ?? []).map((s) => (
                <GlassPanel
                  key={s.name}
                  className={cn(
                    'p-4',
                    s.is_current && 'ring-1 ring-neon-green/30',
                  )}
                >
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      {scenarioIcon(s)}
                      <span className="text-xs font-semibold text-[var(--text-primary)]">{s.name}</span>
                    </div>
                    {s.is_current && <Badge variant="success" size="sm">{t('range.current', 'Current')}</Badge>}
                  </div>
                  <p className="text-2xl font-bold text-[var(--text-primary)] tabular-nums">{fmtNumber(s.range_km, 0)} <span className="text-sm font-normal text-[var(--text-muted)]">km</span></p>
                  <p className="text-xs text-[var(--text-muted)]">{fmtNumber(s.range_mi, 0)} mi</p>
                  <div className="mt-2 flex flex-wrap gap-2 text-[10px] text-[var(--text-muted)]">
                    <span>{s.speed_kmh} km/h</span>
                    <span>{s.temp_c}°C</span>
                    <span>{fmtNumber(s.efficiency_wh_km)} Wh/km</span>
                    {s.sample_count > 0 && <span>({s.sample_count} drives)</span>}
                  </div>
                  {s.extras.length > 0 && (
                    <div className="mt-1 flex gap-1">
                      {s.extras.map((x) => (
                        <Badge key={x} variant="neutral" size="sm">{x}</Badge>
                      ))}
                    </div>
                  )}
                </GlassPanel>
              ))}
            </div>
          ) : (
            <EmptyState /* no-action: transient empty state — surfaces when source data is missing; no specific recovery action available */ message={t('range.noScenarios', 'Drive more to see personalized scenario projections.')} />
          )}
        </GlassPanel>
      </FadeIn>

      {/* ── Efficiency Matrix Heatmap ──────────────── */}
      <FadeIn delay={0.15}>
        <GlassPanel className="p-6">
          <h3 className="mb-4 text-sm font-semibold">{t('range.efficiencyMatrix', 'Personal Efficiency Matrix (Wh/km)')}</h3>
          {(data?.efficiency_matrix ?? []).length > 0 ? (
            <div className="overflow-x-auto">
              <div className="min-w-[400px]">
                {/* Header row */}
                <div className="grid grid-cols-4 gap-1 mb-1">
                  <div className="p-2" />
                  {SPEED_BUCKETS.map((s) => (
                    <div key={s} className="p-2 text-center text-xs text-[var(--text-muted)] capitalize">{s}</div>
                  ))}
                </div>
                {/* Data rows */}
                {TEMP_BUCKETS.map((temp) => (
                  <div key={temp} className="grid grid-cols-4 gap-1 mb-1">
                    <div className="p-2 text-xs text-[var(--text-muted)] capitalize font-medium">{temp}</div>
                    {SPEED_BUCKETS.map((speed) => {
                      const bucket = matrixLookup[`${temp}|${speed}`];
                      return (
                        <div key={speed} className="p-1 text-center">
                          {bucket ? (
                            <div className={cn('rounded-lg px-3 py-2', effColor(bucket.wh_km), 'bg-opacity-20')}>
                              <span className="font-bold text-[var(--text-primary)] text-xs">{fmtNumber(bucket.wh_km, 0)}</span>
                              <span className="block text-[9px] text-[var(--text-muted)]">({bucket.samples})</span>
                            </div>
                          ) : (
                            <div className="rounded-lg px-3 py-2 bg-white/[0.03]">
                              <span className="text-[var(--text-muted)] text-xs">—</span>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <EmptyState /* no-action: transient empty state — surfaces when source data is missing; no specific recovery action available */ message={t('range.noMatrix', 'Efficiency data requires drives in different conditions.')} />
          )}
        </GlassPanel>
      </FadeIn>

      {/* ── "What If" Sliders ─────────────────────── */}
      <FadeIn delay={0.2}>
        <GlassPanel className="p-6">
          <h3 className="mb-4 text-sm font-semibold">{t('range.whatIf', 'What If Calculator')}</h3>
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
            <div className="space-y-4">
              <div>
                <Slider
                  label={t('range.speed', 'Speed')}
                  formatValue={(n) => `${n} km/h`}
                  min={30}
                  max={150}
                  step={5}
                  value={whatIfSpeed}
                  onChange={setWhatIfSpeed}
                />
                <div className="flex justify-between text-[9px] text-[var(--text-muted)] mt-0.5">
                  <span>30</span><span>90</span><span>150</span>
                </div>
              </div>
              <div>
                <Slider
                  label={t('range.temperature', 'Temperature')}
                  formatValue={(n) => `${n}°C`}
                  min={-20}
                  max={40}
                  step={1}
                  value={whatIfTemp}
                  onChange={setWhatIfTemp}
                />
                <div className="flex justify-between text-[9px] text-[var(--text-muted)] mt-0.5">
                  <span>-20°C</span><span>10°C</span><span>40°C</span>
                </div>
              </div>
            </div>
            <div className="lg:col-span-2 flex items-center justify-center">
              {whatIfResult ? (
                <div className="text-center">
                  <p className="text-4xl font-bold text-cyan-300 tabular-nums">{fmtNumber(whatIfResult.rangeKm, 0)} <span className="text-lg font-normal text-[var(--text-muted)]">km</span></p>
                  <p className="text-sm text-[var(--text-muted)] mt-1">{fmtNumber(whatIfResult.effWhKm)} Wh/km</p>
                  <p className="text-xs text-[var(--text-muted)] mt-1">
                    {t('range.whatIfConditions', 'at {{speed}} km/h, {{temp}}°C', { speed: whatIfSpeed, temp: whatIfTemp })}
                  </p>
                </div>
              ) : (
                <EmptyState /* no-action: transient empty state — surfaces when source data is missing; no specific recovery action available */ message={t('range.noWhatIf', 'Adjust sliders to calculate projected range.')} />
              )}
            </div>
          </div>
        </GlassPanel>
      </FadeIn>

      {/* ── Range Factors ──────────────────────────── */}
      <FadeIn delay={0.25}>
        <GlassPanel className="p-5">
          <span className="mb-3 block text-sm font-semibold">{t('range.factors', 'Range Factors')}</span>
          <div className="grid gap-3 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
            {(data?.factors ?? []).map((f) => (
              <GlassPanel key={f.name} className="flex items-start gap-3 p-4">
                <span className="mt-0.5 shrink-0 text-[var(--text-muted)]">
                  {FACTOR_ICONS[(f.name ?? '').toLowerCase().replace(/\s+/g, '_')] ?? <Gauge className="h-4 w-4" />}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-[var(--text-primary)]">{t(`range.factor.${f.name}`, f.name)}</span>
                    <Badge variant={f.impact_pct >= 0 ? 'success' : 'danger'} size="sm">
                      {f.impact_pct >= 0 ? '+' : ''}{fmtNumber(f.impact_pct, 1)}%
                    </Badge>
                  </div>
                  <span className="mt-1 block text-xs text-[var(--text-muted)]">{t(`range.factorDesc.${f.name}`, f.description)}</span>
                </div>
              </GlassPanel>
            ))}
          </div>
        </GlassPanel>
      </FadeIn>

      {/* ── Tips ───────────────────────────────────── */}
      <FadeIn delay={0.3}>
        <GlassPanel className="p-5">
          <div className="mb-3 flex items-center gap-2">
            <Lightbulb className="h-5 w-5 text-neon-green" />
            <span className="text-sm font-semibold">{t('range.tips', 'Tips to Maximize Range')}</span>
          </div>
          <ul className="space-y-2">
            {tips.map((tip, i) => (
              <li key={i} className="flex items-start gap-2 text-sm text-[var(--text-secondary)]">
                <span className="mt-0.5 shrink-0 text-[var(--text-muted)]">{tip.icon}</span>
                <span>{tip.text}</span>
              </li>
            ))}
          </ul>
        </GlassPanel>
      </FadeIn>
    </PageContainer>
  );
}
