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
  Thermometer,
  Footprints,
  Cog,
} from 'lucide-react';

import { PageContainer, Grid } from '@/components/layout';
import { GlassPanel, Badge, Select, DataTable, type Column } from '@/components/ui';
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
  LineChart,
  Line,
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
} from '@/components/data-display';
import { DateRangeFilter } from '@/components/forms';
import { EmptyState } from '@/components/feedback';
import { FadeIn, StaggerContainer, StaggerItem } from '@/components/motion';

import { useDrives, useDrivingCoach } from '@/api/hooks/useDriving';
import { useVehicles, useMotorLatest, useMotorHistory } from '@/api/hooks/useVehicles';
import { useSettings } from '@/hooks/useSettings';
import { usePageTitle } from '@/hooks/usePageTitle';
import { formatDateShort } from '@/lib/dateFormat';
import { fmtNumber } from '@/lib/numberFormat';
import { cn } from '@/lib/cn';
import type { CoachDriveScore } from '@/types/driving';

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

type ThrottleStyle = 'conservative' | 'moderate' | 'aggressive';

function getThrottleStyle(avgPedal: number): ThrottleStyle {
  if (avgPedal < 25) return 'conservative';
  if (avgPedal < 55) return 'moderate';
  return 'aggressive';
}

function gForceColor(g: number): string {
  if (g < 0.2) return '#22c55e';
  if (g < 0.4) return '#3b82f6';
  if (g < 0.6) return '#eab308';
  return '#ef4444';
}

function gearColor(gear: string | undefined): string {
  switch (gear) {
    case 'D': return 'text-emerald-400';
    case 'R': return 'text-red-400';
    case 'N': return 'text-yellow-400';
    case 'P': return 'text-gray-400';
    default: return 'text-white/50';
  }
}

function gearBadgeVariant(gear: string | undefined): 'success' | 'danger' | 'warning' | 'neutral' {
  switch (gear) {
    case 'D': return 'success';
    case 'R': return 'danger';
    case 'N': return 'warning';
    default: return 'neutral';
  }
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
  const vehicleIdNum = vehicleId ?? 0;
  const { data: motorLatest, isLoading: motorLoading } = useMotorLatest(vehicleIdNum, 5000);
  const { data: motorHistory } = useMotorHistory(vehicleIdNum, 200);
  const { data: drives } = useDrives(vehicleIdStr);
  const { data: coachData } = useDrivingCoach(vehicleIdStr);

  /* ---- coach table columns ---- */
  const coachColumns: Column<CoachDriveScore>[] = useMemo(
    () => [
      { key: 'date', header: t('Date'), render: (r: CoachDriveScore) => formatDateShort(r.date), sortable: true },
      {
        key: 'score', header: t('Score'), sortable: true,
        render: (r: CoachDriveScore) => (
          <Badge variant={r.score >= 75 ? 'success' : r.score >= 50 ? 'warning' : 'danger'} size="sm">
            {r.score}
          </Badge>
        ),
      },
      {
        key: 'style', header: t('Style'), sortable: true,
        render: (r: CoachDriveScore) => (
          <Badge
            variant={r.style === 'efficient' ? 'success' : r.style === 'moderate' ? 'warning' : 'danger'}
            size="sm"
          >
            {r.style}
          </Badge>
        ),
      },
      { key: 'efficiency', header: t('Wh/km'), render: (r: CoachDriveScore) => fmtNumber(r.efficiency), sortable: true },
      { key: 'distance', header: t('Distance'), render: (r: CoachDriveScore) => `${fmtNumber(r.distance)} km`, sortable: true },
    ],
    [t],
  );

  /* ---- settings ---- */
  const {
    convertDistance,
    convertSpeed,
    convertTemp,
    distanceUnit,
    speedUnit,
    tempUnit,
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
      const driveDate = d.startDate?.slice(0, 10) ?? '';
      return driveDate >= startDate && driveDate <= endDate;
    });
  }, [drives, startDate, endDate]);

  /* ---- motor history chart data ---- */
  const speedChartData = useMemo(() =>
    (motorHistory ?? []).map((s) => ({
      time: new Date(s.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      speed: s.vehicle_speed != null ? convertSpeed(s.vehicle_speed) : null,
    })), [motorHistory, convertSpeed],
  );

  const torqueChartData = useMemo(() =>
    (motorHistory ?? []).map((s) => ({
      time: new Date(s.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      torque: s.di_torque ?? null,
    })), [motorHistory],
  );

  const gForceChartData = useMemo(() =>
    (motorHistory ?? []).map((s) => ({
      time: new Date(s.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      lateral: s.lateral_accel ?? null,
      longitudinal: s.longitudinal_accel ?? null,
    })), [motorHistory],
  );

  /* ---- motor history computed stats ---- */
  const motorStats = useMemo(() => {
    const h = motorHistory ?? [];
    if (h.length === 0) return null;

    const vals = (fn: (s: typeof h[0]) => number | undefined | null) =>
      h.map(fn).filter((v): v is number => v != null);

    const avg = (arr: number[]) => arr.length > 0 ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;
    const max = (arr: number[]) => arr.length > 0 ? Math.max(...arr) : 0;

    const torques = vals((s) => s.di_torque);
    const laterals = vals((s) => s.lateral_accel);
    const longitudinals = vals((s) => s.longitudinal_accel);
    const pedals = vals((s) => s.pedal_position);
    const statorTemps = vals((s) => s.di_stator_temp);

    return {
      totalReadings: h.length,
      avgTorque: avg(torques),
      maxTorque: max(torques),
      maxLateralG: max(laterals.map(Math.abs)),
      maxLongitudinalG: max(longitudinals.map(Math.abs)),
      avgPedalPosition: avg(pedals),
      avgStatorTemp: avg(statorTemps),
      maxStatorTemp: max(statorTemps),
      peakLateralG: max(laterals.map(Math.abs)),
      peakLongitudinalG: max(longitudinals.map(Math.abs)),
      highTorquePct: torques.length > 0
        ? (torques.filter((t) => t > 200).length / torques.length) * 100
        : 0,
    };
  }, [motorHistory]);

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
  const accelPatterns = useMemo<AccelPoint[]>(() =>
    filteredDrives
      .filter((d) => d.powerMax != null)
      .map((d) => ({
        distance: Math.round(convertDistance(d.distance)),
        powerMax: d.powerMax as number,
      })),
  [filteredDrives, convertDistance]);

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

  /* ---- throttle style ---- */
  const throttleStyle = motorStats ? getThrottleStyle(motorStats.avgPedalPosition) : null;

  /* ---- tips based on motor data ---- */
  const tips = useMemo(() => {
    const list: string[] = [];
    if (!motorStats) {
      list.push(t('dynamics.tipNoData', 'Drive your vehicle to start collecting dynamics data.'));
      return list;
    }
    if (motorStats.avgPedalPosition > 55) {
      list.push(t('dynamics.tipEaseAccel', 'Ease into the accelerator — gradual inputs save energy and tire wear.'));
      list.push(t('dynamics.tipBrakeEarly', 'Brake earlier and lighter to improve regen capture.'));
    } else if (motorStats.avgPedalPosition > 25) {
      list.push(t('dynamics.tipSmoothThrottle', 'Smooth throttle transitions can improve efficiency by 10–15%.'));
      list.push(t('dynamics.tipCoast', 'Lift off the pedal earlier to let regen do the work.'));
    } else {
      list.push(t('dynamics.tipGreat', 'Excellent driving style! Maintaining this maximizes range and comfort.'));
      list.push(t('dynamics.tipKeep', 'Keep monitoring your scores — consistency is key.'));
    }
    if (motorStats.maxStatorTemp > 120) {
      list.push(t('dynamics.tipThermal', 'Motor temps are running high — consider easing off sustained high power.'));
    }
    return list;
  }, [motorStats, t]);

  /* ---- placeholder ---- */
  const noDataPlaceholder = (msg?: string) => (
    <div className="flex h-32 items-center justify-center text-sm text-white/30">
      <Activity className="mr-2 h-5 w-5 opacity-30" />
      {msg ?? t('dynamics.awaitingData', 'Awaiting motor telemetry data...')}
    </div>
  );

  /* ================================================================ */
  /*  RENDER                                                           */
  /* ================================================================ */

  return (
    <PageContainer
      title={t('dynamics.title', 'Driving Dynamics')}
      subtitle={t('dynamics.subtitle', 'Live motor telemetry, G-forces & driving analysis')}
      loading={motorLoading}
      error={null}
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
      <div className="space-y-6">
        {/* ========================================================= */}
        {/*  SECTION 1 — Live Motor Status (4 gauges)                  */}
        {/* ========================================================= */}
        <FadeIn>
          <GlassPanel className="p-6">
            <h2 className="mb-4 text-lg font-semibold text-white/90">
              {t('dynamics.liveMotor', 'Live Motor Status')}
            </h2>
            <Grid cols={{ default: 2, md: 4 }} gap={6}>
              <div className="flex flex-col items-center gap-2">
                <RadialGauge
                  value={motorLatest?.di_torque ?? 0}
                  max={500}
                  label={t('dynamics.torque', 'Torque')}
                  unit="Nm"
                  color="#3b82f6"
                  size={120}
                />
                <span className="text-xs text-white/50">
                  {motorLatest ? `${fmtNumber(motorLatest.di_torque ?? 0)} Nm` : t('dynamics.awaiting', 'Awaiting data')}
                </span>
              </div>
              <div className="flex flex-col items-center gap-2">
                <RadialGauge
                  value={motorLatest?.di_axle_speed ?? 0}
                  max={18000}
                  label={t('dynamics.axleSpeed', 'Axle RPM')}
                  unit="RPM"
                  color="#a855f7"
                  size={120}
                />
                <span className="text-xs text-white/50">
                  {motorLatest ? `${fmtNumber(motorLatest.di_axle_speed ?? 0, 0)} RPM` : t('dynamics.awaiting', 'Awaiting data')}
                </span>
              </div>
              <div className="flex flex-col items-center gap-2">
                <RadialGauge
                  value={motorLatest?.di_stator_temp != null ? convertTemp(motorLatest.di_stator_temp) : 0}
                  max={200}
                  label={t('dynamics.statorTemp', 'Stator')}
                  unit={`°${tempUnit}`}
                  color="#f59e0b"
                  size={120}
                />
                <span className="text-xs text-white/50">
                  {motorLatest?.di_stator_temp != null
                    ? `${fmtNumber(convertTemp(motorLatest.di_stator_temp), 1)}°${tempUnit}`
                    : t('dynamics.awaiting', 'Awaiting data')}
                </span>
              </div>
              <div className="flex flex-col items-center gap-3">
                <div className="flex h-[120px] w-[120px] items-center justify-center">
                  <Badge
                    variant={motorLatest?.di_state === 'drive' ? 'success' : 'neutral'}
                    size="lg"
                  >
                    <Cog className="mr-1 h-4 w-4" />
                    {motorLatest?.di_state ?? t('dynamics.unknown', 'Unknown')}
                  </Badge>
                </div>
                <span className="text-xs text-white/50">
                  {t('dynamics.motorState', 'Motor State')}
                </span>
              </div>
            </Grid>
          </GlassPanel>
        </FadeIn>

        {/* ========================================================= */}
        {/*  SECTION 2 — Acceleration G-Force                          */}
        {/* ========================================================= */}
        <FadeIn delay={0.05}>
          <GlassPanel className="p-6">
            <h2 className="mb-4 text-lg font-semibold text-white/90">
              {t('dynamics.gForce', 'Acceleration G-Force')}
            </h2>
            <Grid cols={{ default: 1, md: 3 }} gap={6}>
              {/* Lateral / Longitudinal values */}
              <div className="flex flex-col gap-4">
                <div>
                  <span className="text-xs text-white/50">{t('dynamics.lateralG', 'Lateral G')}</span>
                  <AnimatedNumber
                    value={motorLatest?.lateral_accel ?? 0}
                    decimals={3}
                    suffix=" g"
                    className="text-3xl font-bold text-white"
                  />
                </div>
                <div>
                  <span className="text-xs text-white/50">{t('dynamics.longitudinalG', 'Longitudinal G')}</span>
                  <AnimatedNumber
                    value={motorLatest?.longitudinal_accel ?? 0}
                    decimals={3}
                    suffix=" g"
                    className="text-3xl font-bold text-white"
                  />
                </div>
                <div className="mt-2 flex gap-4 text-xs text-white/40">
                  <span>{t('dynamics.peakLat', 'Peak Lat')}: {fmtNumber(motorStats?.peakLateralG ?? 0, 3)} g</span>
                  <span>{t('dynamics.peakLon', 'Peak Lon')}: {fmtNumber(motorStats?.peakLongitudinalG ?? 0, 3)} g</span>
                </div>
              </div>

              {/* G-Force vector dot visualization */}
              <div className="flex items-center justify-center">
                <svg viewBox="-1.5 -1.5 3 3" className="h-48 w-48">
                  {/* Grid lines */}
                  <line x1="-1.2" y1="0" x2="1.2" y2="0" stroke="rgba(255,255,255,0.1)" strokeWidth="0.02" />
                  <line x1="0" y1="-1.2" x2="0" y2="1.2" stroke="rgba(255,255,255,0.1)" strokeWidth="0.02" />
                  <circle cx="0" cy="0" r="0.3" fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="0.02" />
                  <circle cx="0" cy="0" r="0.6" fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="0.02" />
                  <circle cx="0" cy="0" r="0.9" fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="0.02" />
                  <circle cx="0" cy="0" r="1.2" fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="0.02" />
                  {/* G-force dot */}
                  <circle
                    cx={Math.max(-1.2, Math.min(1.2, motorLatest?.lateral_accel ?? 0))}
                    cy={Math.max(-1.2, Math.min(1.2, -(motorLatest?.longitudinal_accel ?? 0)))}
                    r="0.08"
                    fill="#3b82f6"
                    filter="drop-shadow(0 0 4px rgba(59,130,246,0.6))"
                  />
                  {/* Labels */}
                  <text x="0" y="-1.35" textAnchor="middle" fill="rgba(255,255,255,0.3)" fontSize="0.12">{t('dynamics.accelLabel', 'ACCEL')}</text>
                  <text x="0" y="1.45" textAnchor="middle" fill="rgba(255,255,255,0.3)" fontSize="0.12">{t('dynamics.brakeLabel', 'BRAKE')}</text>
                  <text x="-1.35" y="0.04" textAnchor="middle" fill="rgba(255,255,255,0.3)" fontSize="0.12">{t('dynamics.leftLabel', 'L')}</text>
                  <text x="1.35" y="0.04" textAnchor="middle" fill="rgba(255,255,255,0.3)" fontSize="0.12">{t('dynamics.rightLabel', 'R')}</text>
                </svg>
              </div>

              {/* Peak values from history */}
              <div className="flex flex-col gap-3">
                <MetricBar
                  value={motorStats?.peakLateralG ?? 0}
                  max={1.5}
                  color={gForceColor(motorStats?.peakLateralG ?? 0)}
                  label={t('dynamics.peakLateralG', 'Peak Lateral G')}
                  sublabel={`${fmtNumber(motorStats?.peakLateralG ?? 0, 3)} g`}
                />
                <MetricBar
                  value={motorStats?.peakLongitudinalG ?? 0}
                  max={1.5}
                  color={gForceColor(motorStats?.peakLongitudinalG ?? 0)}
                  label={t('dynamics.peakLongG', 'Peak Longitudinal G')}
                  sublabel={`${fmtNumber(motorStats?.peakLongitudinalG ?? 0, 3)} g`}
                />
              </div>
            </Grid>
          </GlassPanel>
        </FadeIn>

        {/* ========================================================= */}
        {/*  SECTION 3 — Pedal Usage                                   */}
        {/* ========================================================= */}
        <FadeIn delay={0.1}>
          <GlassPanel className="p-6">
            <h2 className="mb-4 text-lg font-semibold text-white/90">
              {t('dynamics.pedalUsage', 'Pedal Usage')}
            </h2>
            <Grid cols={{ default: 2 }} gap={6}>
              <div className="flex flex-col items-center gap-2">
                <RadialGauge
                  value={motorLatest?.pedal_position ?? 0}
                  max={100}
                  label={t('dynamics.throttle', 'Throttle')}
                  unit="%"
                  color="#06b6d4"
                  size={140}
                />
                <span className="text-xs text-white/50">
                  {t('dynamics.throttlePosition', 'Throttle Position')}
                </span>
              </div>
              <div className="flex flex-col items-center justify-center gap-3">
                <Footprints className="h-8 w-8 text-white/20" />
                <Badge
                  variant={motorLatest?.brake_pedal ? 'danger' : 'success'}
                  size="lg"
                >
                  {motorLatest?.brake_pedal
                    ? t('dynamics.brakeActive', 'Brake Active')
                    : t('dynamics.brakeInactive', 'Brake Inactive')}
                </Badge>
                <span className="text-xs text-white/50">
                  {t('dynamics.brakePedal', 'Brake Pedal Status')}
                </span>
              </div>
            </Grid>
          </GlassPanel>
        </FadeIn>

        {/* ========================================================= */}
        {/*  SECTION 4 — Speed & Gear                                  */}
        {/* ========================================================= */}
        <FadeIn delay={0.15}>
          <GlassPanel className="p-6">
            <h2 className="mb-4 text-lg font-semibold text-white/90">
              {t('dynamics.speedGear', 'Speed & Gear')}
            </h2>
            <Grid cols={{ default: 2, md: 4 }} gap={6}>
              <div className="flex flex-col items-center gap-2">
                <AnimatedNumber
                  value={motorLatest?.vehicle_speed != null ? convertSpeed(motorLatest.vehicle_speed) : 0}
                  decimals={0}
                  className="text-5xl font-bold text-white"
                />
                <span className="text-sm text-white/50">{speedUnit}</span>
              </div>
              <div className="flex flex-col items-center justify-center gap-2">
                <span className={cn('text-5xl font-bold', gearColor(motorLatest?.gear))}>
                  {motorLatest?.gear ?? '—'}
                </span>
                <Badge variant={gearBadgeVariant(motorLatest?.gear)} size="sm">
                  {t('dynamics.gear', 'Gear')}
                </Badge>
              </div>
              <div className="flex flex-col items-center gap-1">
                <span className="text-xs text-white/50">{t('dynamics.avgDriveSpeed', 'Avg Drive Speed')}</span>
                <span className="text-2xl font-semibold text-white">
                  {filteredDrives.length > 0
                    ? fmtNumber(convertSpeed(
                        filteredDrives.reduce((s, d) => s + (d.speedAvg ?? 0), 0) / filteredDrives.length,
                      ), 0)
                    : '—'}
                </span>
                <span className="text-xs text-white/40">{speedUnit}</span>
              </div>
              <div className="flex flex-col items-center gap-1">
                <span className="text-xs text-white/50">{t('dynamics.topDriveSpeed', 'Top Drive Speed')}</span>
                <span className="text-2xl font-semibold text-white">
                  {filteredDrives.length > 0
                    ? fmtNumber(convertSpeed(
                        Math.max(...filteredDrives.map((d) => d.speedMax ?? 0)),
                      ), 0)
                    : '—'}
                </span>
                <span className="text-xs text-white/40">{speedUnit}</span>
              </div>
            </Grid>
          </GlassPanel>
        </FadeIn>

        {/* ========================================================= */}
        {/*  SECTION 5 — Speed Over Time Chart                         */}
        {/* ========================================================= */}
        <FadeIn delay={0.2}>
          <ChartContainer
            title={t('dynamics.speedOverTime', 'Speed Over Time')}
            subtitle={t('dynamics.speedOverTimeDesc', 'Vehicle speed from motor telemetry')}
            height={280}
          >
            {speedChartData.length > 0 ? (
              <ResponsiveContainer width="100%" height={280}>
                <AreaChart data={speedChartData}>
                  <defs>
                    <ChartGradient id="speedAreaGrad" color="#06b6d4" />
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
                  <XAxis dataKey="time" tick={{ fill: 'rgba(255,255,255,0.5)', fontSize: 11 }} />
                  <YAxis tick={{ fill: 'rgba(255,255,255,0.5)', fontSize: 11 }} unit={` ${speedUnit}`} />
                  <Tooltip content={<ChartTooltip />} />
                  <Area type="monotone" dataKey="speed" stroke="#06b6d4" fill="url(#speedAreaGrad)" name={t('dynamics.speed', 'Speed')} />
                </AreaChart>
              </ResponsiveContainer>
            ) : noDataPlaceholder()}
          </ChartContainer>
        </FadeIn>

        {/* ========================================================= */}
        {/*  SECTION 6 — Motor Torque History Chart                    */}
        {/* ========================================================= */}
        <FadeIn delay={0.25}>
          <ChartContainer
            title={t('dynamics.torqueHistory', 'Motor Torque History')}
            subtitle={t('dynamics.torqueHistoryDesc', 'Drive inverter torque over time')}
            height={280}
          >
            {torqueChartData.length > 0 ? (
              <ResponsiveContainer width="100%" height={280}>
                <AreaChart data={torqueChartData}>
                  <defs>
                    <ChartGradient id="torqueGrad" color="#3b82f6" />
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
                  <XAxis dataKey="time" tick={{ fill: 'rgba(255,255,255,0.5)', fontSize: 11 }} />
                  <YAxis tick={{ fill: 'rgba(255,255,255,0.5)', fontSize: 11 }} unit=" Nm" />
                  <Tooltip content={<ChartTooltip />} />
                  <Area type="monotone" dataKey="torque" stroke="#3b82f6" fill="url(#torqueGrad)" name={t('dynamics.torqueNm', 'Torque (Nm)')} />
                </AreaChart>
              </ResponsiveContainer>
            ) : noDataPlaceholder()}
          </ChartContainer>
        </FadeIn>

        {/* ========================================================= */}
        {/*  SECTION 7 — G-Force History Chart                         */}
        {/* ========================================================= */}
        <FadeIn delay={0.3}>
          <ChartContainer
            title={t('dynamics.gForceHistory', 'G-Force History')}
            subtitle={t('dynamics.gForceHistoryDesc', 'Lateral & longitudinal acceleration over time')}
            height={280}
          >
            {gForceChartData.length > 0 ? (
              <ResponsiveContainer width="100%" height={280}>
                <LineChart data={gForceChartData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
                  <XAxis dataKey="time" tick={{ fill: 'rgba(255,255,255,0.5)', fontSize: 11 }} />
                  <YAxis tick={{ fill: 'rgba(255,255,255,0.5)', fontSize: 11 }} unit=" g" />
                  <Tooltip content={<ChartTooltip />} />
                  <Legend wrapperStyle={{ color: 'rgba(255,255,255,0.6)' }} />
                  <Line type="monotone" dataKey="lateral" stroke="#a855f7" strokeWidth={2} dot={false} name={t('dynamics.lateralGLine', 'Lateral G')} />
                  <Line type="monotone" dataKey="longitudinal" stroke="#22c55e" strokeWidth={2} dot={false} name={t('dynamics.longGLine', 'Longitudinal G')} />
                </LineChart>
              </ResponsiveContainer>
            ) : noDataPlaceholder()}
          </ChartContainer>
        </FadeIn>

        {/* ========================================================= */}
        {/*  SECTION 8 — Motor Efficiency Insights (3 cards)           */}
        {/* ========================================================= */}
        <FadeIn delay={0.35}>
          <Grid cols={{ default: 1, md: 3 }} gap={4}>
            {/* Torque Distribution */}
            <GlassPanel className="p-5">
              <div className="mb-3 flex items-center gap-2">
                <Zap className="h-4 w-4 text-blue-400" />
                <h3 className="text-sm font-semibold text-white/90">
                  {t('dynamics.torqueDistribution', 'Torque Distribution')}
                </h3>
              </div>
              {motorStats ? (
                <div className="space-y-2 text-sm text-white/70">
                  <div className="flex justify-between"><span>{t('dynamics.avgTorque', 'Avg Torque')}</span><span className="font-mono">{fmtNumber(motorStats.avgTorque, 1)} Nm</span></div>
                  <div className="flex justify-between"><span>{t('dynamics.maxTorque', 'Max Torque')}</span><span className="font-mono">{fmtNumber(motorStats.maxTorque, 1)} Nm</span></div>
                  <div className="flex justify-between"><span>{t('dynamics.highTorqueTime', 'High Torque Time')}</span><span className="font-mono">{fmtNumber(motorStats.highTorquePct, 1)}%</span></div>
                </div>
              ) : noDataPlaceholder(t('dynamics.noMotorData', 'No motor data recorded yet'))}
            </GlassPanel>

            {/* Throttle Behavior */}
            <GlassPanel className="p-5">
              <div className="mb-3 flex items-center gap-2">
                <Gauge className="h-4 w-4 text-cyan-400" />
                <h3 className="text-sm font-semibold text-white/90">
                  {t('dynamics.throttleBehavior', 'Throttle Behavior')}
                </h3>
              </div>
              {motorStats ? (
                <div className="space-y-3">
                  <div className="flex items-center justify-between text-sm text-white/70">
                    <span>{t('dynamics.avgPedalPos', 'Avg Pedal Position')}</span>
                    <span className="font-mono">{fmtNumber(motorStats.avgPedalPosition, 1)}%</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-white/70">{t('dynamics.drivingStyle', 'Style')}</span>
                    <Badge
                      variant={throttleStyle === 'conservative' ? 'success' : throttleStyle === 'moderate' ? 'warning' : 'danger'}
                      size="sm"
                    >
                      {throttleStyle === 'conservative'
                        ? t('dynamics.conservative', 'Conservative')
                        : throttleStyle === 'moderate'
                          ? t('dynamics.moderate', 'Moderate')
                          : t('dynamics.aggressive', 'Aggressive')}
                    </Badge>
                  </div>
                  <MetricBar
                    value={motorStats.avgPedalPosition}
                    max={100}
                    color={throttleStyle === 'conservative' ? '#22c55e' : throttleStyle === 'moderate' ? '#eab308' : '#ef4444'}
                    label=""
                    sublabel=""
                  />
                </div>
              ) : noDataPlaceholder(t('dynamics.noMotorData', 'No motor data recorded yet'))}
            </GlassPanel>

            {/* Motor Thermal */}
            <GlassPanel className="p-5">
              <div className="mb-3 flex items-center gap-2">
                <Thermometer className="h-4 w-4 text-amber-400" />
                <h3 className="text-sm font-semibold text-white/90">
                  {t('dynamics.motorThermal', 'Motor Thermal')}
                </h3>
              </div>
              {motorStats ? (
                <div className="space-y-3">
                  <div className="flex items-center justify-between text-sm text-white/70">
                    <span>{t('dynamics.avgStatorTemp', 'Avg Stator Temp')}</span>
                    <span className="font-mono">{fmtNumber(convertTemp(motorStats.avgStatorTemp), 1)}°{tempUnit}</span>
                  </div>
                  <div className="flex items-center justify-between text-sm text-white/70">
                    <span>{t('dynamics.maxStatorTemp', 'Max Stator Temp')}</span>
                    <span className="font-mono">{fmtNumber(convertTemp(motorStats.maxStatorTemp), 1)}°{tempUnit}</span>
                  </div>
                  <Badge
                    variant={motorStats.maxStatorTemp < 100 ? 'success' : motorStats.maxStatorTemp < 140 ? 'warning' : 'danger'}
                    size="sm"
                  >
                    {motorStats.maxStatorTemp < 100
                      ? t('dynamics.thermalGood', 'Thermal: Good')
                      : motorStats.maxStatorTemp < 140
                        ? t('dynamics.thermalWarm', 'Thermal: Warm')
                        : t('dynamics.thermalHot', 'Thermal: Hot')}
                  </Badge>
                </div>
              ) : noDataPlaceholder(t('dynamics.noMotorData', 'No motor data recorded yet'))}
            </GlassPanel>
          </Grid>
        </FadeIn>

        {/* ========================================================= */}
        {/*  SECTION 9 — Summary Stats                                 */}
        {/* ========================================================= */}
        <FadeIn delay={0.4}>
          <StaggerContainer className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-6">
            <StaggerItem>
              <StatCard
                label={t('dynamics.totalReadings', 'Total Readings')}
                value={motorStats?.totalReadings ?? 0}
                icon={<BarChart3 className="h-4 w-4" />}
              />
            </StaggerItem>
            <StaggerItem>
              <StatCard
                label={t('dynamics.avgTorque', 'Avg Torque')}
                value={`${fmtNumber(motorStats?.avgTorque ?? 0, 1)} Nm`}
                icon={<Zap className="h-4 w-4" />}
              />
            </StaggerItem>
            <StaggerItem>
              <StatCard
                label={t('dynamics.maxLatG', 'Max Lat G')}
                value={`${fmtNumber(motorStats?.maxLateralG ?? 0, 3)} g`}
                icon={<CornerDownRight className="h-4 w-4" />}
              />
            </StaggerItem>
            <StaggerItem>
              <StatCard
                label={t('dynamics.maxLonG', 'Max Lon G')}
                value={`${fmtNumber(motorStats?.maxLongitudinalG ?? 0, 3)} g`}
                icon={<TrendingDown className="h-4 w-4" />}
              />
            </StaggerItem>
            <StaggerItem>
              <StatCard
                label={t('dynamics.avgPedal', 'Avg Pedal')}
                value={`${fmtNumber(motorStats?.avgPedalPosition ?? 0, 1)}%`}
                icon={<Gauge className="h-4 w-4" />}
              />
            </StaggerItem>
            <StaggerItem>
              <StatCard
                label={t('dynamics.avgStator', 'Avg Stator')}
                value={motorStats
                  ? `${fmtNumber(convertTemp(motorStats.avgStatorTemp), 1)}°${tempUnit}`
                  : '—'}
                icon={<Thermometer className="h-4 w-4" />}
              />
            </StaggerItem>
          </StaggerContainer>
        </FadeIn>

        {/* ========================================================= */}
        {/*  DRIVING COACH — Scoring, patterns & recommendations       */}
        {/* ========================================================= */}
        <FadeIn delay={0.42}>
          <div className="mt-4 mb-2">
            <h2 className="text-lg font-semibold text-white/80">
              {t('dynamics.coach.title', 'Driving Coach')}
            </h2>
          </div>
        </FadeIn>

        {/* Coach: Score + Style + Efficiency */}
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          <FadeIn delay={0.43}>
            <GlassPanel className="flex flex-col items-center justify-center p-6">
              <RadialGauge
                value={coachData?.overall_score ?? 0}
                max={100}
                label={t('dynamics.coach.overallScore', 'Driving Score')}
                color={
                  (coachData?.overall_score ?? 0) >= 75 ? '#22c55e' :
                  (coachData?.overall_score ?? 0) >= 50 ? '#f59e0b' : '#ef4444'
                }
                size={160}
              />
              <p className="mt-2 text-xs text-white/50">
                {t('dynamics.coach.drivesAnalyzed', '{{count}} drives analyzed', { count: coachData?.total_drives_analyzed ?? 0 })}
              </p>
            </GlassPanel>
          </FadeIn>

          <FadeIn delay={0.44}>
            <GlassPanel className="p-6">
              <h3 className="text-sm font-semibold mb-4">
                {t('dynamics.coach.styleBreakdown', 'Style Breakdown')}
              </h3>
              {coachData && coachData.total_drives_analyzed > 0 ? (
                <>
                  <div className="flex h-4 rounded-full overflow-hidden mb-4">
                    {(['efficient', 'moderate', 'aggressive'] as const).map((style) => {
                      const count = coachData.style_breakdown[style] ?? 0;
                      const pct = (count / coachData.total_drives_analyzed) * 100;
                      if (pct <= 0) return null;
                      return (
                        <div
                          key={style}
                          className={cn(
                            style === 'efficient' ? 'bg-neon-green' :
                            style === 'moderate' ? 'bg-neon-amber' : 'bg-red-500',
                          )}
                          style={{ width: `${pct}%` }}
                          title={`${style}: ${count}`}
                        />
                      );
                    })}
                  </div>
                  <div className="space-y-2">
                    {([
                      { key: 'efficient', color: 'bg-neon-green', text: 'text-neon-green' },
                      { key: 'moderate', color: 'bg-neon-amber', text: 'text-neon-amber' },
                      { key: 'aggressive', color: 'bg-red-500', text: 'text-red-400' },
                    ] as const).map(({ key, color, text }) => (
                      <div key={key} className="flex items-center justify-between text-xs">
                        <div className="flex items-center gap-2">
                          <span className={cn('inline-block h-2 w-2 rounded-full', color)} />
                          <span className="capitalize text-white/70">{t(`dynamics.coach.style.${key}`, key)}</span>
                        </div>
                        <span className={cn('font-bold tabular-nums', text)}>
                          {coachData.style_breakdown[key] ?? 0}
                        </span>
                      </div>
                    ))}
                  </div>
                </>
              ) : (
                <EmptyState message={t('dynamics.coach.noData', 'Drive more to see your style breakdown.')} />
              )}
            </GlassPanel>
          </FadeIn>

          <FadeIn delay={0.45}>
            <GlassPanel className="p-6 space-y-3">
              <StatCard
                label={t('dynamics.coach.avgEfficiency', 'Avg Efficiency')}
                value={`${fmtNumber(coachData?.efficiency_wh_km ?? 0)} Wh/km`}
                icon={<Zap className="h-4 w-4" />}
              />
              <StatCard
                label={t('dynamics.coach.bestEfficiency', 'Best Efficiency')}
                value={`${fmtNumber(coachData?.best_efficiency_wh_km ?? 0)} Wh/km`}
                icon={<ShieldCheck className="h-4 w-4" />}
              />
            </GlassPanel>
          </FadeIn>
        </div>

        {/* Coach: Weekly Trend */}
        <FadeIn delay={0.46}>
          <GlassPanel className="p-6">
            <h3 className="text-sm font-semibold mb-4">
              {t('dynamics.coach.weeklyTrend', 'Weekly Score Trend')}
            </h3>
            {(coachData?.weekly_trend ?? []).length > 1 ? (
              <ResponsiveContainer width="100%" height={200}>
                <LineChart data={coachData?.weekly_trend ?? []}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                  <XAxis dataKey="week" tick={{ fontSize: 11, fill: 'rgba(255,255,255,0.5)' }} tickLine={false} axisLine={false} />
                  <YAxis domain={[0, 100]} tick={{ fontSize: 11, fill: 'rgba(255,255,255,0.5)' }} tickLine={false} axisLine={false} />
                  <Tooltip content={<ChartTooltip />} />
                  <Line type="monotone" dataKey="score" stroke="#22c55e" strokeWidth={2} dot={{ fill: '#22c55e', r: 3 }} name={t('Score')} />
                </LineChart>
              </ResponsiveContainer>
            ) : (
              <EmptyState message={t('dynamics.coach.needWeeks', 'Need at least 2 weeks of data for trend analysis.')} />
            )}
          </GlassPanel>
        </FadeIn>

        {/* Coach: Pattern Indicators */}
        <FadeIn delay={0.47}>
          <GlassPanel className="p-6">
            <h3 className="text-sm font-semibold mb-4">
              {t('dynamics.coach.patterns', 'Driving Patterns')}
            </h3>
            <div className="space-y-3">
              {[
                { label: t('dynamics.coach.hardAccel', 'Hard Acceleration'), value: coachData?.patterns.hard_accel_pct ?? 0, lo: 20, hi: 40 },
                { label: t('dynamics.coach.hardBrake', 'Hard Braking'), value: coachData?.patterns.hard_brake_pct ?? 0, lo: 15, hi: 30 },
                { label: t('dynamics.coach.highway', 'Highway Driving'), value: coachData?.patterns.highway_pct ?? 0, lo: 50, hi: 70 },
                { label: t('dynamics.coach.shortTrips', 'Short Trips (<5 km)'), value: coachData?.patterns.short_trip_pct ?? 0, lo: 30, hi: 50 },
                { label: t('dynamics.coach.coldStarts', 'Cold Starts'), value: coachData?.patterns.cold_start_pct ?? 0, lo: 15, hi: 30 },
              ].map((p) => (
                <div key={p.label} className="space-y-1">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-white/70">{p.label}</span>
                    <span className={cn('font-bold tabular-nums',
                      p.value <= p.lo ? 'text-neon-green' :
                      p.value <= p.hi ? 'text-neon-amber' : 'text-red-400',
                    )}>
                      {fmtNumber(p.value)}%
                    </span>
                  </div>
                  <div className="h-1.5 rounded-full bg-white/[0.06] overflow-hidden">
                    <div
                      className={cn('h-full rounded-full',
                        p.value <= p.lo ? 'bg-neon-green' :
                        p.value <= p.hi ? 'bg-neon-amber' : 'bg-red-500',
                      )}
                      style={{ width: `${Math.min(100, p.value)}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </GlassPanel>
        </FadeIn>

        {/* Coach: Recommendations */}
        <FadeIn delay={0.48}>
          <GlassPanel className="p-6">
            <h3 className="text-sm font-semibold mb-4 flex items-center gap-2">
              <Lightbulb className="h-4 w-4 text-neon-amber" />
              {t('dynamics.coach.recommendations', 'Recommendations')}
            </h3>
            {(coachData?.recommendations ?? []).length > 0 ? (
              <div className="space-y-3">
                {(coachData?.recommendations ?? []).map((rec, i) => (
                  <div
                    key={i}
                    className="flex items-start gap-3 rounded-xl p-3 bg-white/[0.03] border border-white/[0.06]"
                  >
                    <Badge
                      variant={rec.impact === 'high' ? 'danger' : rec.impact === 'medium' ? 'warning' : 'success'}
                      size="sm"
                      className="mt-0.5 shrink-0"
                    >
                      {rec.impact}
                    </Badge>
                    <p className="text-sm text-white/70">{rec.tip}</p>
                  </div>
                ))}
              </div>
            ) : (
              <EmptyState message={t('dynamics.coach.noRecs', 'Recommendations will appear after more drives.')} />
            )}
          </GlassPanel>
        </FadeIn>

        {/* Coach: Per-Drive Scores */}
        <FadeIn delay={0.49}>
          <GlassPanel className="p-6">
            <h3 className="text-sm font-semibold mb-4">
              {t('dynamics.coach.perDriveScores', 'Per-Drive Scores')}
            </h3>
            {(coachData?.per_drive_scores ?? []).length > 0 ? (
              <DataTable
                columns={coachColumns}
                data={coachData?.per_drive_scores ?? []}
                keyExtractor={(row: CoachDriveScore) => String(row.drive_id)}
                compact
                pagination
                emptyMessage={t('dynamics.coach.noDrives', 'No drives found.')}
              />
            ) : (
              <EmptyState message={t('dynamics.coach.noDrives', 'Drive data will appear after your first trip.')} />
            )}
          </GlassPanel>
        </FadeIn>

        {/* ========================================================= */}
        {/*  DRIVE ANALYTICS — Date filter + charts from drives data   */}
        {/* ========================================================= */}
        <FadeIn delay={0.45}>
          <div className="mt-2 mb-2">
            <h2 className="text-lg font-semibold text-white/80">
              {t('dynamics.driveAnalytics', 'Drive Analytics')}
            </h2>
          </div>
          <DateRangeFilter
            startDate={startDate}
            endDate={endDate}
            onStartDateChange={setStartDate}
            onEndDateChange={setEndDate}
            presets
          />
        </FadeIn>

        {/* Speed Distribution + Acceleration Patterns */}
        <FadeIn delay={0.5}>
          <Grid cols={{ default: 1, lg: 2 }} gap={4}>
            <ChartContainer
              title={t('dynamics.speedDistribution', 'Speed Distribution')}
              subtitle={t('dynamics.speedDistDesc', 'Drives grouped by average speed')}
              height={300}
            >
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={speedDistribution}>
                  <defs>
                    <ChartGradient id="speedFill" color="#3b82f6" />
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
                  <XAxis dataKey="range" tick={{ fill: 'rgba(255,255,255,0.5)', fontSize: 12 }} />
                  <YAxis tick={{ fill: 'rgba(255,255,255,0.5)', fontSize: 12 }} allowDecimals={false} />
                  <Tooltip content={<ChartTooltip />} />
                  <Bar dataKey="count" fill="url(#speedFill)" radius={[4, 4, 0, 0]} name={t('dynamics.drives', 'Drives')} />
                </BarChart>
              </ResponsiveContainer>
            </ChartContainer>

            <ChartContainer
              title={t('dynamics.accelPatterns', 'Acceleration Patterns')}
              subtitle={t('dynamics.accelPatternsDesc', 'Peak power vs trip distance')}
              height={300}
            >
              <ResponsiveContainer width="100%" height={300}>
                <ScatterChart>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
                  <XAxis dataKey="distance" type="number" name={t('dynamics.distance', 'Distance')} unit={` ${distanceUnit}`} tick={{ fill: 'rgba(255,255,255,0.5)', fontSize: 12 }} />
                  <YAxis dataKey="powerMax" type="number" name={t('dynamics.peakPower', 'Peak Power')} unit=" kW" tick={{ fill: 'rgba(255,255,255,0.5)', fontSize: 12 }} />
                  <Tooltip content={<ChartTooltip />} />
                  <Scatter data={accelPatterns} fill="#a855f7" name={t('dynamics.drives', 'Drives')} />
                  {accelPatterns.length > 0 && (
                    <ReferenceLine
                      y={accelPatterns.reduce((sum, p) => sum + p.powerMax, 0) / accelPatterns.length}
                      stroke="#eab308"
                      strokeDasharray="4 4"
                      label={{ value: t('dynamics.avg', 'Avg'), fill: '#eab308', fontSize: 11 }}
                    />
                  )}
                </ScatterChart>
              </ResponsiveContainer>
            </ChartContainer>
          </Grid>
        </FadeIn>

        {/* Power Profile */}
        <FadeIn delay={0.55}>
          <ChartContainer
            title={t('dynamics.powerProfile', 'Power Profile')}
            subtitle={t('dynamics.powerProfileDesc', 'Peak & regen power for recent drives')}
            height={320}
          >
            <ResponsiveContainer width="100%" height={320}>
              <AreaChart data={powerProfile}>
                <defs>
                  <ChartGradient id="powerMaxGrad" color="#3b82f6" />
                  <ChartGradient id="powerMinGrad" color="#ef4444" opacity={0.25} />
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
                <XAxis dataKey="label" tick={{ fill: 'rgba(255,255,255,0.5)', fontSize: 12 }} />
                <YAxis tick={{ fill: 'rgba(255,255,255,0.5)', fontSize: 12 }} unit=" kW" />
                <Tooltip content={<ChartTooltip />} />
                <Legend wrapperStyle={{ color: 'rgba(255,255,255,0.6)' }} />
                <ReferenceLine y={0} stroke="rgba(255,255,255,0.2)" />
                <Area type="monotone" dataKey="powerMax" stroke="#3b82f6" fill="url(#powerMaxGrad)" name={t('dynamics.maxPower', 'Max Power (kW)')} />
                <Area type="monotone" dataKey="powerMin" stroke="#ef4444" fill="url(#powerMinGrad)" name={t('dynamics.regenPower', 'Regen Power (kW)')} />
              </AreaChart>
            </ResponsiveContainer>
          </ChartContainer>
        </FadeIn>

        {/* ========================================================= */}
        {/*  Driving Style Recommendations                             */}
        {/* ========================================================= */}
        <FadeIn delay={0.6}>
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
                  {throttleStyle === 'conservative' ? (
                    <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-green-400" />
                  ) : (
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-yellow-400" />
                  )}
                  <span className="text-sm text-white/70">{tip}</span>
                </div>
              ))}
            </div>
          </GlassPanel>
        </FadeIn>
      </div>
    </PageContainer>
  );
}
