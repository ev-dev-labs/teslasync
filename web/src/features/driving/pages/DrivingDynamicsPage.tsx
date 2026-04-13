import { useState, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Gauge,
  Activity,
  TrendingDown,
  CornerDownRight,
  Zap,
  BarChart3,
  Lightbulb,
  ShieldCheck,
  AlertTriangle,
} from 'lucide-react';

import { PageContainer, Grid } from '@/components/layout';
import { GlassPanel, Badge, Select } from '@/components/ui';
import {
  ChartContainer,
  ChartTooltip,
  ChartGradient,
  RadialGauge,
  BarChart,
  Bar,
  ScatterChart,
  Scatter,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
  Legend,
} from '@/components/charts';
import {
  AnimatedNumber,
  StatCard,
  MetricBar,
  MetricCard,
} from '@/components/data-display';
import { DateRangeFilter } from '@/components/forms';
import { FadeIn, StaggerContainer, StaggerItem } from '@/components/motion';

import {
  useDrivingDynamics,
  useDrives,
  useDrivingStats,
} from '@/api/hooks/useDriving';
import { useVehicles } from '@/api/hooks/useVehicles';
import { useSettings } from '@/hooks/useSettings';
import { usePageTitle } from '@/hooks/usePageTitle';
import { formatDateShort } from '@/lib/dateFormat';
import { fmtNumber } from '@/lib/numberFormat';
import { cn } from '@/lib/cn';

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

interface SpeedBucket {
  range: string;
  count: number;
}

interface AccelPoint {
  distance: number;
  powerMax: number;
}

interface PowerPoint {
  index: number;
  label: string;
  powerMax: number;
  powerMin: number;
}

type SmoothnessGrade = 'smooth' | 'moderate' | 'aggressive';

function getSmoothnessGrade(score: number): SmoothnessGrade {
  if (score >= 70) return 'smooth';
  if (score >= 40) return 'moderate';
  return 'aggressive';
}

function gradeColor(grade: SmoothnessGrade): string {
  switch (grade) {
    case 'smooth':
      return '#22c55e';
    case 'moderate':
      return '#eab308';
    case 'aggressive':
      return '#ef4444';
  }
}

function gradeBadgeVariant(
  grade: SmoothnessGrade,
): 'success' | 'warning' | 'danger' {
  switch (grade) {
    case 'smooth':
      return 'success';
    case 'moderate':
      return 'warning';
    case 'aggressive':
      return 'danger';
  }
}

function gForceColor(g: number): string {
  if (g < 0.2) return '#22c55e';
  if (g < 0.4) return '#3b82f6';
  if (g < 0.6) return '#eab308';
  return '#ef4444';
}

const SPEED_BUCKETS_RANGES = [
  { min: 0, max: 30, label: '0–30' },
  { min: 30, max: 60, label: '30–60' },
  { min: 60, max: 90, label: '60–90' },
  { min: 90, max: 120, label: '90–120' },
  { min: 120, max: Infinity, label: '120+' },
];

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export default function DrivingDynamicsPage() {
  const { t } = useTranslation();
  usePageTitle(t('dynamics.title', 'Driving Dynamics'));

  /* ---- vehicle selection ---- */
  const { data: vehicles } = useVehicles();
  const [selectedVehicle, setSelectedVehicle] = useState<number | null>(null);
  const vehicleId = selectedVehicle ?? vehicles?.[0]?.id ?? null;
  const vehicleIdStr = vehicleId != null ? String(vehicleId) : undefined;

  const vehicleOptions = useMemo(
    () =>
      (vehicles ?? []).map((v) => ({
        value: String(v.id),
        label: v.display_name ?? `Vehicle ${v.id}`,
      })),
    [vehicles],
  );

  /* ---- data hooks ---- */
  const {
    data: dynamics,
    isLoading: dynLoading,
    error: dynError,
  } = useDrivingDynamics(vehicleIdStr);
  const { data: drives } = useDrives(vehicleIdStr);
  const { data: stats } = useDrivingStats(vehicleIdStr);

  /* ---- settings ---- */
  const {
    convertDistance,
    convertSpeed,
    distanceUnit,
    speedUnit,
  } = useSettings();

  /* ---- date filter ---- */
  const [startDate, setStartDate] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() - 30);
    return d.toISOString().slice(0, 10);
  });
  const [endDate, setEndDate] = useState(
    () => new Date().toISOString().slice(0, 10),
  );

  /* ---- filtered drives ---- */
  const filteredDrives = useMemo(() => {
    if (!drives) return [];
    return drives.filter((d) => {
      const driveDate = d.startDate.slice(0, 10);
      return driveDate >= startDate && driveDate <= endDate;
    });
  }, [drives, startDate, endDate]);

  /* ---- speed distribution buckets ---- */
  const speedDistribution = useMemo<SpeedBucket[]>(() => {
    const buckets = SPEED_BUCKETS_RANGES.map((b) => ({
      range: `${b.label} ${speedUnit}`,
      count: 0,
    }));
    for (const d of filteredDrives) {
      const spd = d.speedAvg != null ? convertSpeed(d.speedAvg) : null;
      if (spd == null) continue;
      for (let i = 0; i < SPEED_BUCKETS_RANGES.length; i++) {
        const r = SPEED_BUCKETS_RANGES[i];
        const hi = r.max === Infinity ? Infinity : convertSpeed(r.max);
        const lo = convertSpeed(r.min);
        if (spd >= lo && spd < hi) {
          buckets[i].count += 1;
          break;
        }
      }
    }
    return buckets;
  }, [filteredDrives, convertSpeed, speedUnit]);

  /* ---- acceleration patterns (scatter) ---- */
  const accelPatterns = useMemo<AccelPoint[]>(() => {
    return filteredDrives
      .filter((d) => d.powerMax != null)
      .map((d) => ({
        distance: Math.round(convertDistance(d.distance)),
        powerMax: d.powerMax as number,
      }));
  }, [filteredDrives, convertDistance]);

  /* ---- power profile (area) ---- */
  const powerProfile = useMemo<PowerPoint[]>(() => {
    const recent = filteredDrives.slice(-20);
    return recent.map((d, i) => ({
      index: i + 1,
      label: formatDateShort(d.startDate),
      powerMax: d.powerMax ?? 0,
      powerMin: d.powerMin ?? 0,
    }));
  }, [filteredDrives]);

  /* ---- derived metrics ---- */
  const grade = dynamics ? getSmoothnessGrade(dynamics.smoothnessScore) : null;

  /* ---- tips based on smoothness ---- */
  const tips = useMemo(() => {
    if (!dynamics) return [];
    const list: string[] = [];
    const g = getSmoothnessGrade(dynamics.smoothnessScore);
    if (g === 'aggressive') {
      list.push(
        t(
          'dynamics.tipEaseAccel',
          'Ease into the accelerator — gradual inputs save energy and tire wear.',
        ),
      );
      list.push(
        t(
          'dynamics.tipBrakeEarly',
          'Brake earlier and lighter to improve regen capture.',
        ),
      );
      list.push(
        t(
          'dynamics.tipCorner',
          'Slow before corners, not in them — smoother arcs reduce lateral G.',
        ),
      );
    } else if (g === 'moderate') {
      list.push(
        t(
          'dynamics.tipSmoothThrottle',
          'Smooth throttle transitions can improve your score by 10–15 points.',
        ),
      );
      list.push(
        t(
          'dynamics.tipCoast',
          'Lift off the pedal earlier to let regen do the work.',
        ),
      );
    } else {
      list.push(
        t(
          'dynamics.tipGreat',
          'Excellent driving style! Maintaining this maximizes range and comfort.',
        ),
      );
      list.push(
        t(
          'dynamics.tipKeep',
          'Keep monitoring your scores — consistency is key.',
        ),
      );
    }
    return list;
  }, [dynamics, t]);

  /* ---- loading skeleton ---- */
  const isLoading = dynLoading;

  /* ================================================================ */
  /*  RENDER                                                           */
  /* ================================================================ */

  return (
    <PageContainer
      title={t('dynamics.title', 'Driving Dynamics')}
      subtitle={t(
        'dynamics.subtitle',
        'Acceleration, braking & cornering analysis',
      )}
      loading={isLoading}
      error={dynError as Error | null}
      empty={!dynamics}
      emptyMessage={t('dynamics.empty', 'No dynamics data available.')}
      actions={
        vehicleOptions.length > 1 ? (
          <Select
            options={vehicleOptions}
            value={vehicleId != null ? String(vehicleId) : ''}
            onChange={(e) => setSelectedVehicle(Number(e.target.value))}
            placeholder={t('dynamics.selectVehicle', 'Select vehicle')}
          />
        ) : undefined
      }
    >
      {dynamics && (
        <>
          {/* ------- Date Range Filter ------- */}
          <FadeIn>
            <DateRangeFilter
              startDate={startDate}
              endDate={endDate}
              onStartDateChange={setStartDate}
              onEndDateChange={setEndDate}
              presets
            />
          </FadeIn>

          {/* ========================================================= */}
          {/*  SECTION 1 — G-Force Circular Gauges                      */}
          {/* ========================================================= */}
          <FadeIn delay={0.05}>
            <GlassPanel className="p-6">
              <h2 className="mb-4 text-lg font-semibold text-white/90">
                {t('dynamics.gForceGauges', 'G-Force Overview')}
              </h2>
              <Grid cols={{ default: 2, md: 4 }} gap={6}>
                <div className="flex flex-col items-center gap-2">
                  <RadialGauge
                    value={dynamics.maxAccelerationG}
                    max={1.5}
                    label={t('dynamics.accel', 'Accel')}
                    unit="g"
                    color="#3b82f6"
                    size={120}
                  />
                  <span className="text-xs text-white/50">
                    {t('dynamics.peakAcceleration', 'Peak Acceleration')}
                  </span>
                </div>
                <div className="flex flex-col items-center gap-2">
                  <RadialGauge
                    value={dynamics.maxBrakingG}
                    max={1.5}
                    label={t('dynamics.braking', 'Braking')}
                    unit="g"
                    color="#ef4444"
                    size={120}
                  />
                  <span className="text-xs text-white/50">
                    {t('dynamics.peakBraking', 'Peak Braking')}
                  </span>
                </div>
                <div className="flex flex-col items-center gap-2">
                  <RadialGauge
                    value={dynamics.maxCorneringG}
                    max={1.5}
                    label={t('dynamics.cornering', 'Cornering')}
                    unit="g"
                    color="#a855f7"
                    size={120}
                  />
                  <span className="text-xs text-white/50">
                    {t('dynamics.peakCornering', 'Peak Cornering')}
                  </span>
                </div>
                <div className="flex flex-col items-center gap-2">
                  <RadialGauge
                    value={dynamics.smoothnessScore}
                    max={100}
                    label={t('dynamics.smoothLabel', 'Smooth')}
                    unit="/100"
                    color={grade ? gradeColor(grade) : '#22c55e'}
                    size={120}
                  />
                  <span className="text-xs text-white/50">
                    {t('dynamics.smoothnessScore', 'Smoothness Score')}
                  </span>
                </div>
              </Grid>
            </GlassPanel>
          </FadeIn>

          {/* ========================================================= */}
          {/*  SECTION 2 — G-Force Metric Cards                         */}
          {/* ========================================================= */}
          <FadeIn delay={0.1}>
            <StaggerContainer className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-6">
              <StaggerItem>
                <MetricCard
                  label={t('dynamics.peakAccel', 'Peak Accel')}
                  value={`${fmtNumber(dynamics.maxAccelerationG, 2)} g`}
                  icon={<Zap className="h-4 w-4" />}
                  color="cyan"
                />
              </StaggerItem>
              <StaggerItem>
                <MetricCard
                  label={t('dynamics.avgAccel', 'Avg Accel')}
                  value={`${fmtNumber(dynamics.avgAccelerationG, 2)} g`}
                  icon={<Activity className="h-4 w-4" />}
                  color="cyan"
                />
              </StaggerItem>
              <StaggerItem>
                <MetricCard
                  label={t('dynamics.peakBraking', 'Peak Braking')}
                  value={`${fmtNumber(dynamics.maxBrakingG, 2)} g`}
                  icon={<TrendingDown className="h-4 w-4" />}
                  color="purple"
                />
              </StaggerItem>
              <StaggerItem>
                <MetricCard
                  label={t('dynamics.avgBraking', 'Avg Braking')}
                  value={`${fmtNumber(dynamics.avgBrakingG, 2)} g`}
                  icon={<TrendingDown className="h-4 w-4" />}
                  color="purple"
                />
              </StaggerItem>
              <StaggerItem>
                <MetricCard
                  label={t('dynamics.maxCornering', 'Max Cornering')}
                  value={`${fmtNumber(dynamics.maxCorneringG, 2)} g`}
                  icon={<CornerDownRight className="h-4 w-4" />}
                  color="green"
                />
              </StaggerItem>
              <StaggerItem>
                <MetricCard
                  label={t('dynamics.smoothnessScore', 'Smoothness Score')}
                  value={`${dynamics.smoothnessScore}/100`}
                  icon={<Gauge className="h-4 w-4" />}
                  color="green"
                />
              </StaggerItem>
            </StaggerContainer>
          </FadeIn>

          {/* ========================================================= */}
          {/*  SECTION 3 — Smoothness Assessment                        */}
          {/* ========================================================= */}
          <FadeIn delay={0.15}>
            <GlassPanel className="p-6">
              <div className="flex items-start justify-between">
                <div>
                  <h2 className="text-lg font-semibold text-white/90">
                    {t('dynamics.smoothnessAssessment', 'Smoothness Assessment')}
                  </h2>
                  <p className="mt-1 text-sm text-white/50">
                    {t(
                      'dynamics.smoothnessDesc',
                      'Based on acceleration, braking and cornering patterns',
                    )}
                  </p>
                </div>
                {grade && (
                  <Badge variant={gradeBadgeVariant(grade)} size="lg">
                    {grade === 'smooth'
                      ? t('dynamics.gradeSmooth', 'Smooth')
                      : grade === 'moderate'
                        ? t('dynamics.gradeModerate', 'Moderate')
                        : t('dynamics.gradeAggressive', 'Aggressive')}
                  </Badge>
                )}
              </div>

              <div className="mt-6 flex items-center gap-6">
                <div className="flex flex-col items-center">
                  <AnimatedNumber
                    value={dynamics.smoothnessScore}
                    suffix="/100"
                    className="text-4xl font-bold text-white"
                  />
                  <span className="mt-1 text-xs text-white/50">
                    {t('dynamics.overallScore', 'Overall Score')}
                  </span>
                </div>

                <div className="flex-1 space-y-3">
                  <MetricBar
                    value={dynamics.maxAccelerationG}
                    max={1.5}
                    color={gForceColor(dynamics.maxAccelerationG)}
                    label={t('dynamics.acceleration', 'Acceleration')}
                    sublabel={`${fmtNumber(dynamics.maxAccelerationG, 2)} g`}
                  />
                  <MetricBar
                    value={dynamics.maxBrakingG}
                    max={1.5}
                    color={gForceColor(dynamics.maxBrakingG)}
                    label={t('dynamics.braking', 'Braking')}
                    sublabel={`${fmtNumber(dynamics.maxBrakingG, 2)} g`}
                  />
                  <MetricBar
                    value={dynamics.maxCorneringG}
                    max={1.5}
                    color={gForceColor(dynamics.maxCorneringG)}
                    label={t('dynamics.cornering', 'Cornering')}
                    sublabel={`${fmtNumber(dynamics.maxCorneringG, 2)} g`}
                  />
                </div>
              </div>
            </GlassPanel>
          </FadeIn>

          {/* ========================================================= */}
          {/*  SECTION 4 & 5 — Speed Distribution + Acceleration Chart  */}
          {/* ========================================================= */}
          <FadeIn delay={0.2}>
            <Grid cols={{ default: 1, lg: 2 }} gap={4}>
              {/* Speed Distribution */}
              <ChartContainer
                title={t('dynamics.speedDistribution', 'Speed Distribution')}
                subtitle={t(
                  'dynamics.speedDistDesc',
                  'Drives grouped by average speed',
                )}
                height={300}
              >
                <ResponsiveContainer width="100%" height={300}>
                  <BarChart data={speedDistribution}>
                    <defs>
                      <ChartGradient id="speedFill" color="#3b82f6" />
                    </defs>
                    <CartesianGrid
                      strokeDasharray="3 3"
                      stroke="rgba(255,255,255,0.06)"
                    />
                    <XAxis
                      dataKey="range"
                      tick={{ fill: 'rgba(255,255,255,0.5)', fontSize: 12 }}
                    />
                    <YAxis
                      tick={{ fill: 'rgba(255,255,255,0.5)', fontSize: 12 }}
                      allowDecimals={false}
                    />
                    <Tooltip content={<ChartTooltip />} />
                    <Bar
                      dataKey="count"
                      fill="url(#speedFill)"
                      radius={[4, 4, 0, 0]}
                      name={t('dynamics.drives', 'Drives')}
                    />
                  </BarChart>
                </ResponsiveContainer>
              </ChartContainer>

              {/* Acceleration Patterns (Scatter) */}
              <ChartContainer
                title={t('dynamics.accelPatterns', 'Acceleration Patterns')}
                subtitle={t(
                  'dynamics.accelPatternsDesc',
                  'Peak power vs trip distance',
                )}
                height={300}
              >
                <ResponsiveContainer width="100%" height={300}>
                  <ScatterChart>
                    <CartesianGrid
                      strokeDasharray="3 3"
                      stroke="rgba(255,255,255,0.06)"
                    />
                    <XAxis
                      dataKey="distance"
                      type="number"
                      name={t('dynamics.distance', 'Distance')}
                      unit={` ${distanceUnit}`}
                      tick={{ fill: 'rgba(255,255,255,0.5)', fontSize: 12 }}
                    />
                    <YAxis
                      dataKey="powerMax"
                      type="number"
                      name={t('dynamics.peakPower', 'Peak Power')}
                      unit=" kW"
                      tick={{ fill: 'rgba(255,255,255,0.5)', fontSize: 12 }}
                    />
                    <Tooltip content={<ChartTooltip />} />
                    <Scatter
                      data={accelPatterns}
                      fill="#a855f7"
                      name={t('dynamics.drives', 'Drives')}
                    />
                    {accelPatterns.length > 0 && (
                      <ReferenceLine
                        y={
                          accelPatterns.reduce(
                            (sum, p) => sum + p.powerMax,
                            0,
                          ) / accelPatterns.length
                        }
                        stroke="#eab308"
                        strokeDasharray="4 4"
                        label={{
                          value: t('dynamics.avg', 'Avg'),
                          fill: '#eab308',
                          fontSize: 11,
                        }}
                      />
                    )}
                  </ScatterChart>
                </ResponsiveContainer>
              </ChartContainer>
            </Grid>
          </FadeIn>

          {/* ========================================================= */}
          {/*  SECTION 6 — Power Profile (Area)                         */}
          {/* ========================================================= */}
          <FadeIn delay={0.25}>
            <ChartContainer
              title={t('dynamics.powerProfile', 'Power Profile')}
              subtitle={t(
                'dynamics.powerProfileDesc',
                'Peak & regen power for recent drives',
              )}
              height={320}
            >
              <ResponsiveContainer width="100%" height={320}>
                <AreaChart data={powerProfile}>
                  <defs>
                    <ChartGradient id="powerMaxGrad" color="#3b82f6" />
                    <ChartGradient
                      id="powerMinGrad"
                      color="#ef4444"
                      opacity={0.25}
                    />
                  </defs>
                  <CartesianGrid
                    strokeDasharray="3 3"
                    stroke="rgba(255,255,255,0.06)"
                  />
                  <XAxis
                    dataKey="label"
                    tick={{ fill: 'rgba(255,255,255,0.5)', fontSize: 12 }}
                  />
                  <YAxis
                    tick={{ fill: 'rgba(255,255,255,0.5)', fontSize: 12 }}
                    unit=" kW"
                  />
                  <Tooltip content={<ChartTooltip />} />
                  <Legend
                    wrapperStyle={{ color: 'rgba(255,255,255,0.6)' }}
                  />
                  <ReferenceLine y={0} stroke="rgba(255,255,255,0.2)" />
                  <Area
                    type="monotone"
                    dataKey="powerMax"
                    stroke="#3b82f6"
                    fill="url(#powerMaxGrad)"
                    name={t('dynamics.maxPower', 'Max Power (kW)')}
                  />
                  <Area
                    type="monotone"
                    dataKey="powerMin"
                    stroke="#ef4444"
                    fill="url(#powerMinGrad)"
                    name={t('dynamics.regenPower', 'Regen Power (kW)')}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </ChartContainer>
          </FadeIn>

          {/* ========================================================= */}
          {/*  SECTION 9 — G-Force Comparison Bars                      */}
          {/* ========================================================= */}
          <FadeIn delay={0.3}>
            <GlassPanel className="p-6">
              <h2 className="mb-4 text-lg font-semibold text-white/90">
                {t('dynamics.gForceComparison', 'G-Force Comparison')}
              </h2>
              <div className="space-y-4">
                <MetricBar
                  value={dynamics.maxAccelerationG}
                  max={1.5}
                  color="#3b82f6"
                  label={t('dynamics.maxAcceleration', 'Max Acceleration')}
                  sublabel={`${fmtNumber(dynamics.maxAccelerationG, 2)} g`}
                />
                <MetricBar
                  value={dynamics.avgAccelerationG}
                  max={1.5}
                  color="#60a5fa"
                  label={t('dynamics.avgAcceleration', 'Avg Acceleration')}
                  sublabel={`${fmtNumber(dynamics.avgAccelerationG, 2)} g`}
                />
                <MetricBar
                  value={dynamics.maxBrakingG}
                  max={1.5}
                  color="#ef4444"
                  label={t('dynamics.maxBrakingForce', 'Max Braking')}
                  sublabel={`${fmtNumber(dynamics.maxBrakingG, 2)} g`}
                />
                <MetricBar
                  value={dynamics.avgBrakingG}
                  max={1.5}
                  color="#f87171"
                  label={t('dynamics.avgBrakingForce', 'Avg Braking')}
                  sublabel={`${fmtNumber(dynamics.avgBrakingG, 2)} g`}
                />
                <MetricBar
                  value={dynamics.maxCorneringG}
                  max={1.5}
                  color="#a855f7"
                  label={t('dynamics.maxCorneringForce', 'Max Cornering')}
                  sublabel={`${fmtNumber(dynamics.maxCorneringG, 2)} g`}
                />
                <MetricBar
                  value={dynamics.smoothnessScore / 100}
                  max={1}
                  color={grade ? gradeColor(grade) : '#22c55e'}
                  label={t('dynamics.smoothnessRatio', 'Smoothness')}
                  sublabel={`${dynamics.smoothnessScore}/100`}
                />
              </div>
            </GlassPanel>
          </FadeIn>

          {/* ========================================================= */}
          {/*  SECTION 10 — Driving Style Recommendations               */}
          {/* ========================================================= */}
          <FadeIn delay={0.35}>
            <GlassPanel className="p-6">
              <div className="mb-4 flex items-center gap-3">
                <Lightbulb className="h-5 w-5 text-yellow-400" />
                <h2 className="text-lg font-semibold text-white/90">
                  {t('dynamics.recommendations', 'Driving Style Recommendations')}
                </h2>
              </div>

              <div className="space-y-3">
                {tips.map((tip, i) => (
                  <div
                    key={i}
                    className={cn(
                      'flex items-start gap-3 rounded-lg p-3',
                      'bg-white/[0.03] border border-white/[0.06]',
                    )}
                  >
                    {grade === 'smooth' ? (
                      <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-green-400" />
                    ) : (
                      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-yellow-400" />
                    )}
                    <span className="text-sm text-white/70">{tip}</span>
                  </div>
                ))}
              </div>

              {/* Summary stats row */}
              {stats && (
                <Grid cols={{ default: 2, md: 4 }} gap={4} className="mt-6">
                  <StatCard
                    label={t('dynamics.totalDrives', 'Total Drives')}
                    value={stats.totalDrives}
                    icon={<BarChart3 className="h-4 w-4" />}
                  />
                  <StatCard
                    label={t('dynamics.totalDistance', 'Total Distance')}
                    value={fmtNumber(
                      convertDistance(stats.totalDistanceKm),
                      0,
                    )}
                    unit={distanceUnit}
                    icon={<Activity className="h-4 w-4" />}
                  />
                  <StatCard
                    label={t('dynamics.avgSpeed', 'Avg Speed')}
                    value={fmtNumber(convertSpeed(stats.avgSpeedKmh), 0)}
                    unit={speedUnit}
                    icon={<Gauge className="h-4 w-4" />}
                  />
                  <StatCard
                    label={t('dynamics.topSpeed', 'Top Speed')}
                    value={fmtNumber(convertSpeed(stats.topSpeedKmh), 0)}
                    unit={speedUnit}
                    icon={<Zap className="h-4 w-4" />}
                  />
                </Grid>
              )}
            </GlassPanel>
          </FadeIn>
        </>
      )}
    </PageContainer>
  );
}
