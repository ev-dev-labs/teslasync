import { useParams, Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useQuery, useMutation } from '@tanstack/react-query'
import {
  ArrowLeft, Power, Battery, BatteryCharging, Gauge, Thermometer,
  Navigation, Eye, Lock, Unlock, Shield, Wind, Cog, Car, Route,
  Clock, ChevronRight, Zap, Activity, Settings, BarChart3,
  Snowflake, CircleDot, MapPin,
} from 'lucide-react'

import { PageContainer } from '@/components/layout'
import { GlassPanel, Badge, Button, DataTable, type Column } from '@/components/ui'
import { MetricCard, AnimatedNumber, KVList } from '@/components/data-display'
import { useBreadcrumbs } from '@/hooks/useBreadcrumbs'
import {
  RadialGauge, ChartTooltip, CHART_COLORS,
  AreaChart, Area, BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, Legend,
} from '@/components/charts'
import { Skeleton, EmptyState } from '@/components/feedback'
import { FadeIn } from '@/components/motion'

import { usePageTitle } from '@/hooks/usePageTitle'
import { useSettings } from '@/hooks/useSettings'
import { formatDateTime, formatDate } from '@/lib/dateFormat'
import { fmtNumber, fmtInt } from '@/lib/numberFormat'
import { cn } from '@/lib/cn'
import { request } from '@/api/client'
import type {
  Vehicle,
  VehicleState,
  VehicleStatus,
  MotorSnapshot,
  ClimateSnapshot,
  SecurityEvent,
  TirePressureSnapshot,
  ChargingTelemetry,
  Drive,
  ChargingSession,
  VehicleConfigSnapshot,
} from '@/api/types'

/* ═══════════════════════════════════════════════════════════════════
 * Types
 * ═══════════════════════════════════════════════════════════════════ */

interface StateResponse {
  state: VehicleState
  live: boolean
}

/* ═══════════════════════════════════════════════════════════════════
 * Helpers
 * ═══════════════════════════════════════════════════════════════════ */

function deriveStatus(v: Vehicle, s?: VehicleState | null): VehicleStatus {
  if (s?.is_charging) return 'charging'
  if (s?.speed && s.speed > 0) return 'driving'
  if (v.state === 'online') return 'online'
  if (v.state === 'asleep') return 'asleep'
  return 'offline'
}

function batteryColor(level: number): string {
  if (level > 60) return '#10b981'
  if (level > 25) return '#f59e0b'
  return '#ef4444'
}

function statusVariant(status: VehicleStatus): 'success' | 'warning' | 'danger' | 'info' | 'neutral' {
  switch (status) {
    case 'online':
    case 'driving':
      return 'success'
    case 'charging':
      return 'warning'
    case 'asleep':
      return 'info'
    default:
      return 'danger'
  }
}

function tirePressureVariant(psi: number | null): 'success' | 'warning' | 'danger' | 'neutral' {
  if (psi == null) return 'neutral'
  if (psi >= 2.5 && psi <= 3.5) return 'success'
  if (psi >= 2.0 && psi < 2.5) return 'warning'
  return 'danger'
}

function durationStr(minutes: number): string {
  const h = Math.floor(minutes / 60)
  const m = fmtInt(minutes % 60)
  return h > 0 ? `${h}h ${m}m` : `${m}m`
}

/* ═══════════════════════════════════════════════════════════════════
 * Drive table columns
 * ═══════════════════════════════════════════════════════════════════ */

function useDriveColumns(convertDistance: (v: number) => number, distanceUnit: string): Column<Drive>[] {
  const { t } = useTranslation()
  return [
    {
      key: 'date',
      header: t('common.date', 'Date'),
      render: (d) => formatDateTime(d.start_date),
    },
    {
      key: 'distance',
      header: t('common.distance', 'Distance'),
      render: (d) => `${fmtNumber(convertDistance(d.distance))} ${distanceUnit}`,
      sortable: true,
    },
    {
      key: 'duration',
      header: t('common.duration', 'Duration'),
      render: (d) => durationStr(d.duration_min),
    },
    {
      key: 'battery',
      header: t('common.battery', 'Battery'),
      render: (d) =>
        d.start_battery_level != null && d.end_battery_level != null
          ? `${d.start_battery_level}% → ${d.end_battery_level}%`
          : '—',
    },
  ]
}

/* ═══════════════════════════════════════════════════════════════════
 * Charge session table columns
 * ═══════════════════════════════════════════════════════════════════ */

function useChargeColumns(): Column<ChargingSession>[] {
  const { t } = useTranslation()
  return [
    {
      key: 'date',
      header: t('common.date', 'Date'),
      render: (s) => formatDateTime(s.start_date),
    },
    {
      key: 'energy',
      header: t('common.energy', 'Energy'),
      render: (s) => `${fmtNumber(s.charge_energy_added)} kWh`,
      sortable: true,
    },
    {
      key: 'duration',
      header: t('common.duration', 'Duration'),
      render: (s) => durationStr(s.duration_min),
    },
    {
      key: 'cost',
      header: t('common.cost', 'Cost'),
      render: (s) => (s.cost != null ? `$${fmtNumber(s.cost)}` : '—'),
    },
    {
      key: 'battery',
      header: t('common.battery', 'Battery'),
      render: (s) =>
        s.end_battery_level != null
          ? `${s.start_battery_level}% → ${s.end_battery_level}%`
          : `${s.start_battery_level}%`,
    },
  ]
}

/* ═══════════════════════════════════════════════════════════════════
 * MAIN PAGE
 * ═══════════════════════════════════════════════════════════════════ */

export default function VehicleDetailPage() {
  const { t } = useTranslation()
  const { id } = useParams<{ id: string }>()
  const vehicleId = Number(id)
  usePageTitle(t('vehicles.detail.title', 'Vehicle Detail'))

  const {
    convertDistance,
    convertSpeed,
    convertTemp,
    convertPressure,
    distanceUnit,
    speedUnit,
    tempUnit,
    pressureUnit,
  } = useSettings()

  /* ─── Queries ─── */

  const { data: vehicle, isLoading: vehicleLoading, error: vehicleError } = useQuery({
    queryKey: ['vehicles', String(vehicleId)],
    queryFn: () => request<Vehicle>(`/vehicles/${vehicleId}`),
    enabled: vehicleId > 0,
  })

  const breadcrumbs = useBreadcrumbs({
    '/vehicles/:id': vehicle?.display_name ?? `Vehicle #${id}`,
  })

  const { data: stateData, refetch: refetchState } = useQuery({
    queryKey: ['vehicle-state', vehicleId],
    queryFn: () => request<StateResponse>(`/vehicles/${vehicleId}/state`),
    enabled: vehicleId > 0,
    refetchInterval: 30_000,
  })

  const { data: motorData } = useQuery({
    queryKey: ['motor-latest', vehicleId],
    queryFn: () => request<MotorSnapshot | null>(`/motor/latest?vehicle_id=${vehicleId}`),
    enabled: vehicleId > 0,
    refetchInterval: 15_000,
  })

  const { data: climateData } = useQuery({
    queryKey: ['climate-latest', vehicleId],
    queryFn: () => request<ClimateSnapshot | null>(`/climate/latest?vehicle_id=${vehicleId}`),
    enabled: vehicleId > 0,
    refetchInterval: 15_000,
  })

  const { data: securityData } = useQuery({
    queryKey: ['security-latest', vehicleId],
    queryFn: () => request<SecurityEvent | null>(`/security/latest?vehicle_id=${vehicleId}`),
    enabled: vehicleId > 0,
    refetchInterval: 15_000,
  })

  const { data: tireData } = useQuery({
    queryKey: ['tire-latest', vehicleId],
    queryFn: () => request<TirePressureSnapshot | null>(`/tire-pressure/latest?vehicle_id=${vehicleId}`),
    enabled: vehicleId > 0,
    refetchInterval: 30_000,
  })

  const { data: chargingTelemetry } = useQuery({
    queryKey: ['charging-telemetry-latest', vehicleId],
    queryFn: () => request<ChargingTelemetry | null>(`/charging-telemetry/latest?vehicle_id=${vehicleId}`),
    enabled: vehicleId > 0,
    refetchInterval: 5_000,
  })

  const { data: drives } = useQuery({
    queryKey: ['drives', vehicleId],
    queryFn: () => request<Drive[]>(`/drives?vehicle_id=${vehicleId}&limit=5`),
    enabled: vehicleId > 0,
  })

  const { data: sessions } = useQuery({
    queryKey: ['charging', vehicleId],
    queryFn: () => request<ChargingSession[]>(`/charging?vehicle_id=${vehicleId}&limit=5`),
    enabled: vehicleId > 0,
  })

  const { data: vehicleConfig } = useQuery({
    queryKey: ['vehicle-config-latest', vehicleId],
    queryFn: () => request<VehicleConfigSnapshot | null>(`/vehicle-config/latest?vehicle_id=${vehicleId}`),
    enabled: vehicleId > 0,
    refetchInterval: 30_000,
  })

  const wakeMutation = useMutation({
    mutationFn: () => request<{ status: string }>(`/vehicles/${vehicleId}/wake`, { method: 'POST' }),
    onSuccess: () => {
      setTimeout(() => { refetchState() }, 5000)
    },
  })

  /* ─── Derived state ─── */

  const state = stateData?.state
  const status: VehicleStatus = vehicle ? deriveStatus(vehicle, state) : 'offline'
  const driveColumns = useDriveColumns(convertDistance, distanceUnit)
  const chargeColumns = useChargeColumns()

  /* ─── Battery chart data from charging telemetry ─── */

  const batteryChartData = state
    ? [
        { name: t('common.current', 'Current'), value: state.battery_level },
        { name: t('common.remaining', 'Remaining'), value: 100 - state.battery_level },
      ]
    : []

  /* ─── Drive trend chart data ─── */

  const driveChartData = (drives ?? []).map((d) => ({
    date: formatDate(d.start_date),
    distance: Math.round(convertDistance(d.distance)),
    duration: Math.round(d.duration_min),
  })).reverse()

  /* ─── Tire pressure list ─── */

  const tirePressures: { label: string; value: number | null }[] = tireData
    ? [
        { label: t('vehicles.detail.tireFl', 'Front Left'), value: tireData.front_left },
        { label: t('vehicles.detail.tireFr', 'Front Right'), value: tireData.front_right },
        { label: t('vehicles.detail.tireRl', 'Rear Left'), value: tireData.rear_left },
        { label: t('vehicles.detail.tireRr', 'Rear Right'), value: tireData.rear_right },
      ]
    : []

  /* ─── Vehicle config KV items ─── */

  const configItems = vehicleConfig
    ? [
        { label: t('vehicles.detail.carType', 'Car Type'), value: vehicleConfig.car_type ?? '—' },
        { label: t('vehicles.detail.trim', 'Trim'), value: vehicleConfig.trim ?? '—' },
        { label: t('vehicles.detail.color', 'Exterior Color'), value: vehicleConfig.exterior_color ?? '—' },
        { label: t('vehicles.detail.wheels', 'Wheels'), value: vehicleConfig.wheel_type ?? '—' },
        { label: t('vehicles.detail.roofColor', 'Roof Color'), value: vehicleConfig.roof_color ?? '—' },
        { label: t('vehicles.detail.chargePort', 'Charge Port'), value: vehicleConfig.charge_port ?? '—' },
        { label: t('vehicles.detail.rhd', 'Right-Hand Drive'), value: vehicleConfig.right_hand_drive != null ? (vehicleConfig.right_hand_drive ? t('common.yes', 'Yes') : t('common.no', 'No')) : '—' },
        { label: t('vehicles.detail.softwareVersion', 'Software'), value: vehicleConfig.software_update_version ?? state?.software_version ?? '—' },
      ]
    : []

  /* ─── Quick link routes ─── */

  const quickLinks = [
    { label: t('nav.drives', 'Drives'), icon: Route, to: '/drives' },
    { label: t('nav.charging', 'Charging'), icon: BatteryCharging, to: '/charging' },
    { label: t('nav.battery', 'Battery'), icon: Battery, to: '/battery' },
    { label: t('nav.climate', 'Climate'), icon: Thermometer, to: '/climate' },
    { label: t('nav.efficiency', 'Efficiency'), icon: BarChart3, to: '/efficiency' },
    { label: t('nav.settings', 'Settings'), icon: Settings, to: '/settings' },
  ]

  /* ═══════════════════════════════════════════════════════════════════
   * RENDER
   * ═══════════════════════════════════════════════════════════════════ */

  return (
    <PageContainer
      title={vehicle?.display_name ?? t('vehicles.detail.title', 'Vehicle Detail')}
      loading={vehicleLoading}
      error={vehicleError as Error | null}
      breadcrumbs={breadcrumbs}
    >
      {/* ── 1. Vehicle Header ── */}
      <FadeIn>
        <GlassPanel className="p-6">
          <div className="flex items-center gap-4">
            <Link
              to="/vehicles"
              className="rounded-xl p-2.5 text-[var(--text-muted)] hover:bg-white/5 hover:text-[var(--text-primary)] transition-all"
            >
              <ArrowLeft className="h-5 w-5" />
            </Link>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-3 flex-wrap">
                <Badge variant={statusVariant(status)} dot size="lg">
                  {status}
                </Badge>
                <Badge variant="neutral" size="sm">
                  {vehicle?.model ?? ''} {vehicle?.trim_badging ?? ''}
                </Badge>
              </div>
              <p className="text-sm text-[var(--text-muted)] mt-1 truncate font-mono">
                {vehicle?.vin ?? ''}
              </p>
            </div>
            <Button
              onClick={() => wakeMutation.mutate()}
              loading={wakeMutation.isPending}
              icon={<Power className="h-4 w-4" />}
            >
              {t('common.wakeUp', 'Wake Up')}
            </Button>
          </div>
        </GlassPanel>
      </FadeIn>

      {!state ? (
        <FadeIn delay={0.05}>
          <GlassPanel className="p-8">
            <Skeleton lines={5} height={20} />
          </GlassPanel>
        </FadeIn>
      ) : (
        <>
          {/* ── 2. Battery & Range ── */}
          <FadeIn delay={0.04}>
            <GlassPanel className="p-6">
              <div className="flex flex-col items-center gap-6 sm:flex-row sm:items-start">
                <div className="relative">
                  <RadialGauge
                    value={state.battery_level}
                    max={100}
                    label={t('common.battery', 'Battery')}
                    unit="%"
                    color={batteryColor(state.battery_level)}
                    size={140}
                  />
                </div>
                <div className="flex-1 grid grid-cols-2 gap-4 sm:grid-cols-3">
                  <MetricCard
                    label={t('vehicles.detail.ratedRange', 'Rated Range')}
                    value={`${fmtInt(convertDistance(state.rated_range))} ${distanceUnit}`}
                    icon={<Navigation className="h-4 w-4" />}
                    color="cyan"
                  />
                  <MetricCard
                    label={t('vehicles.detail.idealRange', 'Ideal Range')}
                    value={`${fmtInt(convertDistance(state.ideal_range))} ${distanceUnit}`}
                    icon={<MapPin className="h-4 w-4" />}
                    color="green"
                  />
                  <MetricCard
                    label={t('common.charging', 'Charging')}
                    value={state.is_charging ? `${fmtNumber(state.charge_rate)} kW` : t('common.notCharging', 'Not Charging')}
                    icon={<BatteryCharging className="h-4 w-4" />}
                    color={state.is_charging ? 'green' : 'cyan'}
                    subtitle={
                      state.is_charging && state.time_to_full_charge > 0
                        ? `${t('vehicles.detail.fullIn', 'Full in')} ${fmtNumber(state.time_to_full_charge, 1)}h`
                        : undefined
                    }
                  />
                </div>
              </div>
            </GlassPanel>
          </FadeIn>

          {/* ── 3. Live State Indicators ── */}
          <FadeIn delay={0.06}>
            <div className="flex flex-wrap gap-2">
              <Badge
                variant={state.speed > 0 ? 'success' : 'neutral'}
                dot
                size="lg"
              >
                {t('common.speed', 'Speed')}: {fmtInt(convertSpeed(state.speed))} {speedUnit}
              </Badge>
              <Badge
                variant={state.is_locked ? 'success' : 'danger'}
                dot
                size="lg"
              >
                {state.is_locked ? t('common.locked', 'Locked') : t('common.unlocked', 'Unlocked')}
              </Badge>
              <Badge
                variant={state.sentry_mode ? 'warning' : 'neutral'}
                dot
                size="lg"
              >
                {t('common.sentry', 'Sentry')}: {state.sentry_mode ? t('common.active', 'Active') : t('common.off', 'Off')}
              </Badge>
              <Badge
                variant={state.is_climate_on ? 'info' : 'neutral'}
                dot
                size="lg"
              >
                {t('common.climate', 'Climate')}: {state.is_climate_on ? t('common.on', 'On') : t('common.off', 'Off')}
              </Badge>
              <Badge
                variant={state.is_charging ? 'warning' : 'neutral'}
                dot
                size="lg"
              >
                {state.is_charging ? t('common.charging', 'Charging') : t('common.notCharging', 'Not Charging')}
              </Badge>
            </div>
          </FadeIn>

          {/* ── 4. Quick Stats Grid (8 MetricCards) ── */}
          <FadeIn delay={0.08}>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
              <MetricCard
                label={t('common.battery', 'Battery')}
                value={`${state.battery_level}%`}
                icon={<Battery className="h-4 w-4" />}
                color={state.battery_level > 50 ? 'green' : state.battery_level > 20 ? 'cyan' : 'cyan'}
              />
              <MetricCard
                label={t('common.range', 'Range')}
                value={`${fmtInt(convertDistance(state.rated_range))} ${distanceUnit}`}
                icon={<Navigation className="h-4 w-4" />}
                color="cyan"
              />
              <MetricCard
                label={t('common.odometer', 'Odometer')}
                value={`${fmtInt(convertDistance(state.odometer))} ${distanceUnit}`}
                icon={<Car className="h-4 w-4" />}
                color="purple"
              />
              <MetricCard
                label={t('common.speed', 'Speed')}
                value={`${fmtInt(convertSpeed(state.speed))} ${speedUnit}`}
                icon={<Gauge className="h-4 w-4" />}
                color="cyan"
                subtitle={state.speed > 0 ? t('common.driving', 'Driving') : t('common.parked', 'Parked')}
              />
              <MetricCard
                label={t('common.insideTemp', 'Inside Temp')}
                value={`${fmtNumber(convertTemp(state.inside_temp))}${tempUnit}`}
                icon={<Thermometer className="h-4 w-4" />}
                color="green"
              />
              <MetricCard
                label={t('common.outsideTemp', 'Outside Temp')}
                value={`${fmtNumber(convertTemp(state.outside_temp))}${tempUnit}`}
                icon={<Thermometer className="h-4 w-4" />}
                color="cyan"
              />
              <MetricCard
                label={t('common.power', 'Power')}
                value={`${fmtNumber(state.power)} kW`}
                icon={<Zap className="h-4 w-4" />}
                color="purple"
              />
              <MetricCard
                label={t('common.state', 'State')}
                value={status}
                icon={<Activity className="h-4 w-4" />}
                color="cyan"
              />
            </div>
          </FadeIn>

          {/* ── 5. Motor Section ── */}
          <FadeIn delay={0.1}>
            <GlassPanel className="p-6">
              <div className="flex items-center gap-2 mb-4">
                <Cog className="h-4 w-4 text-[var(--neon-cyan)]" />
                <span className="text-lg font-bold text-[var(--text-primary)]">
                  {t('vehicles.detail.motor', 'Powertrain')}
                </span>
              </div>
              {motorData ? (
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
                  <MetricCard
                    label={t('vehicles.detail.motorState', 'Motor State')}
                    value={motorData.di_state ?? '—'}
                    icon={<Cog className="h-4 w-4" />}
                    color="cyan"
                  />
                  <MetricCard
                    label={t('vehicles.detail.torque', 'Torque')}
                    value={motorData.di_torque != null ? `${fmtNumber(motorData.di_torque)} Nm` : '—'}
                    icon={<Activity className="h-4 w-4" />}
                    color="purple"
                  />
                  <MetricCard
                    label={t('vehicles.detail.statorTemp', 'Stator Temp')}
                    value={motorData.di_stator_temp != null ? `${fmtNumber(convertTemp(motorData.di_stator_temp))}${tempUnit}` : '—'}
                    icon={<Thermometer className="h-4 w-4" />}
                    color="green"
                  />
                  <MetricCard
                    label={t('vehicles.detail.axleSpeed', 'Axle Speed')}
                    value={motorData.di_axle_speed != null ? `${fmtInt(motorData.di_axle_speed)} RPM` : '—'}
                    icon={<Gauge className="h-4 w-4" />}
                    color="cyan"
                  />
                  <MetricCard
                    label={t('vehicles.detail.pedalPos', 'Pedal Position')}
                    value={motorData.pedal_position != null ? `${fmtNumber(motorData.pedal_position)}%` : '—'}
                    icon={<Activity className="h-4 w-4" />}
                    color="cyan"
                  />
                  <MetricCard
                    label={t('vehicles.detail.gear', 'Gear')}
                    value={motorData.gear ?? '—'}
                    icon={<Settings className="h-4 w-4" />}
                    color="purple"
                  />
                </div>
              ) : (
                <Skeleton lines={3} height={16} />
              )}
            </GlassPanel>
          </FadeIn>

          {/* ── 6. Climate Section ── */}
          <FadeIn delay={0.12}>
            <GlassPanel className="p-6">
              <div className="flex items-center gap-2 mb-4">
                <Wind className="h-4 w-4 text-[var(--neon-cyan)]" />
                <span className="text-lg font-bold text-[var(--text-primary)]">
                  {t('vehicles.detail.climate', 'Climate')}
                </span>
              </div>
              {climateData ? (
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
                  <MetricCard
                    label={t('common.insideTemp', 'Inside Temp')}
                    value={climateData.inside_temp != null ? `${fmtNumber(convertTemp(climateData.inside_temp))}${tempUnit}` : '—'}
                    icon={<Thermometer className="h-4 w-4" />}
                    color="green"
                  />
                  <MetricCard
                    label={t('common.outsideTemp', 'Outside Temp')}
                    value={climateData.outside_temp != null ? `${fmtNumber(convertTemp(climateData.outside_temp))}${tempUnit}` : '—'}
                    icon={<Thermometer className="h-4 w-4" />}
                    color="cyan"
                  />
                  <MetricCard
                    label={t('vehicles.detail.hvacPower', 'HVAC Power')}
                    value={climateData.hvac_power != null ? `${fmtNumber(climateData.hvac_power)} W` : '—'}
                    icon={<Zap className="h-4 w-4" />}
                    color="purple"
                  />
                  <MetricCard
                    label={t('vehicles.detail.fanSpeed', 'Fan Speed')}
                    value={climateData.hvac_fan_speed != null ? String(climateData.hvac_fan_speed) : '—'}
                    icon={<Wind className="h-4 w-4" />}
                    color="cyan"
                  />
                  <MetricCard
                    label={t('vehicles.detail.seatHeaterL', 'Seat Heater Left')}
                    value={climateData.seat_heater_left != null ? `${t('common.level', 'Level')} ${climateData.seat_heater_left}` : '—'}
                    icon={<CircleDot className="h-4 w-4" />}
                    color="green"
                  />
                  <MetricCard
                    label={t('vehicles.detail.seatHeaterR', 'Seat Heater Right')}
                    value={climateData.seat_heater_right != null ? `${t('common.level', 'Level')} ${climateData.seat_heater_right}` : '—'}
                    icon={<CircleDot className="h-4 w-4" />}
                    color="green"
                  />
                  <MetricCard
                    label={t('vehicles.detail.defrost', 'Defrost')}
                    value={climateData.defrost_mode && climateData.defrost_mode !== 'Off' ? climateData.defrost_mode : t('common.off', 'Off')}
                    icon={<Snowflake className="h-4 w-4" />}
                    color={climateData.defrost_mode && climateData.defrost_mode !== 'Off' ? 'green' : 'cyan'}
                  />
                  <MetricCard
                    label={t('vehicles.detail.acEnabled', 'A/C Enabled')}
                    value={climateData.hvac_ac_enabled ? t('common.on', 'On') : t('common.off', 'Off')}
                    icon={<Wind className="h-4 w-4" />}
                    color={climateData.hvac_ac_enabled ? 'green' : 'cyan'}
                  />
                </div>
              ) : (
                <Skeleton lines={3} height={16} />
              )}
            </GlassPanel>
          </FadeIn>

          {/* ── 7. Security Section ── */}
          <FadeIn delay={0.14}>
            <GlassPanel className="p-6">
              <div className="flex items-center gap-2 mb-4">
                <Shield className="h-4 w-4 text-[var(--neon-cyan)]" />
                <span className="text-lg font-bold text-[var(--text-primary)]">
                  {t('vehicles.detail.security', 'Security')}
                </span>
              </div>
              {securityData ? (
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
                  <MetricCard
                    label={t('common.locked', 'Locked')}
                    value={state.is_locked ? t('common.yes', 'Yes') : t('common.no', 'No')}
                    icon={state.is_locked ? <Lock className="h-4 w-4" /> : <Unlock className="h-4 w-4" />}
                    color={state.is_locked ? 'green' : 'cyan'}
                  />
                  <MetricCard
                    label={t('common.sentry', 'Sentry')}
                    value={state.sentry_mode ? t('common.active', 'Active') : t('common.off', 'Off')}
                    icon={<Eye className="h-4 w-4" />}
                    color={state.sentry_mode ? 'green' : 'cyan'}
                  />
                  <MetricCard
                    label={t('vehicles.detail.doors', 'Doors')}
                    value={securityData.door_state ?? '—'}
                    icon={<Car className="h-4 w-4" />}
                    color="cyan"
                  />
                  <MetricCard
                    label={t('vehicles.detail.windows', 'Windows')}
                    value={
                      [securityData.fd_window, securityData.fp_window, securityData.rd_window, securityData.rp_window]
                        .every((w) => w === 'Closed')
                        ? t('common.allClosed', 'All Closed')
                        : t('common.someOpen', 'Some Open')
                    }
                    icon={<Car className="h-4 w-4" />}
                    color={
                      [securityData.fd_window, securityData.fp_window, securityData.rd_window, securityData.rp_window]
                        .every((w) => w === 'Closed')
                        ? 'green'
                        : 'cyan'
                    }
                  />
                </div>
              ) : (
                <Skeleton lines={2} height={16} />
              )}
            </GlassPanel>
          </FadeIn>

          {/* ── 8. Tire Pressure ── */}
          <FadeIn delay={0.16}>
            <GlassPanel className="p-6">
              <div className="flex items-center gap-2 mb-4">
                <CircleDot className="h-4 w-4 text-[var(--neon-cyan)]" />
                <span className="text-lg font-bold text-[var(--text-primary)]">
                  {t('vehicles.detail.tirePressure', 'Tire Pressure')}
                </span>
              </div>
              {tireData ? (
                <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
                  {tirePressures.map((tp) => (
                    <GlassPanel key={tp.label} className="p-4 text-center">
                      <p className="text-xs text-[var(--text-muted)] mb-1">{tp.label}</p>
                      <p className="text-2xl font-bold text-[var(--text-primary)]">
                        {tp.value != null ? fmtNumber(convertPressure(tp.value)) : '—'}
                      </p>
                      <p className="text-xs text-[var(--text-muted)]">{pressureUnit}</p>
                      <Badge
                        variant={tirePressureVariant(tp.value)}
                        size="sm"
                        className="mt-2"
                      >
                        {tp.value != null
                          ? tp.value >= 2.5 && tp.value <= 3.5
                            ? t('common.normal', 'Normal')
                            : tp.value >= 2.0
                              ? t('common.low', 'Low')
                              : t('common.critical', 'Critical')
                          : t('common.noData', 'No Data')}
                      </Badge>
                    </GlassPanel>
                  ))}
                </div>
              ) : (
                <EmptyState
                  icon={<CircleDot className="h-8 w-8" />}
                  message={t('vehicles.detail.noTireData', 'No tire pressure data available')}
                />
              )}
            </GlassPanel>
          </FadeIn>

          {/* ── 9. Charging Telemetry ── */}
          <FadeIn delay={0.18}>
            <GlassPanel className="p-6">
              <div className="flex items-center gap-2 mb-4">
                <Zap className="h-4 w-4 text-[var(--neon-green)]" />
                <span className="text-lg font-bold text-[var(--text-primary)]">
                  {t('vehicles.detail.chargingTelemetry', 'Charging Telemetry')}
                </span>
              </div>
              {chargingTelemetry ? (
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
                  <MetricCard
                    label={t('vehicles.detail.dcPower', 'DC Power')}
                    value={chargingTelemetry.dc_charging_power != null ? `${fmtNumber(chargingTelemetry.dc_charging_power)} kW` : '—'}
                    icon={<Zap className="h-4 w-4" />}
                    color="green"
                  />
                  <MetricCard
                    label={t('vehicles.detail.voltage', 'Voltage')}
                    value={chargingTelemetry.charger_voltage != null ? `${fmtNumber(chargingTelemetry.charger_voltage)} V` : '—'}
                    icon={<Activity className="h-4 w-4" />}
                    color="cyan"
                  />
                  <MetricCard
                    label={t('vehicles.detail.current', 'Current')}
                    value={chargingTelemetry.charge_amps != null ? `${fmtNumber(chargingTelemetry.charge_amps)} A` : '—'}
                    icon={<Activity className="h-4 w-4" />}
                    color="purple"
                  />
                  <MetricCard
                    label={t('vehicles.detail.energyAdded', 'Energy Added')}
                    value={chargingTelemetry.dc_charging_energy_in != null ? `${fmtNumber(chargingTelemetry.dc_charging_energy_in)} kWh` : '—'}
                    icon={<BatteryCharging className="h-4 w-4" />}
                    color="green"
                  />
                  <MetricCard
                    label={t('vehicles.detail.chargeState', 'Charge State')}
                    value={chargingTelemetry.charge_state ?? '—'}
                    icon={<Battery className="h-4 w-4" />}
                    color="cyan"
                  />
                  <MetricCard
                    label={t('vehicles.detail.soc', 'SOC')}
                    value={chargingTelemetry.soc != null ? `${fmtNumber(chargingTelemetry.soc)}%` : '—'}
                    icon={<Battery className="h-4 w-4" />}
                    color="green"
                  />
                  <MetricCard
                    label={t('vehicles.detail.timeToFull', 'Time to Full')}
                    value={chargingTelemetry.time_to_full_charge != null ? `${fmtNumber(chargingTelemetry.time_to_full_charge, 1)}h` : '—'}
                    icon={<Clock className="h-4 w-4" />}
                    color="cyan"
                  />
                  <MetricCard
                    label={t('vehicles.detail.packVoltage', 'Pack Voltage')}
                    value={chargingTelemetry.pack_voltage != null ? `${fmtNumber(chargingTelemetry.pack_voltage)} V` : '—'}
                    icon={<Zap className="h-4 w-4" />}
                    color="purple"
                  />
                </div>
              ) : (
                <EmptyState
                  icon={<Zap className="h-8 w-8" />}
                  message={t('vehicles.detail.noChargingTelemetry', 'No charging telemetry available')}
                />
              )}
            </GlassPanel>
          </FadeIn>

          {/* ── 10. Battery & Range Overview Charts ── */}
          <FadeIn delay={0.2}>
            <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
              {/* Battery bar chart */}
              <GlassPanel className="p-6">
                <div className="flex items-center gap-2 mb-4">
                  <Battery className="h-4 w-4 text-[var(--neon-cyan)]" />
                  <span className="text-lg font-bold text-[var(--text-primary)]">
                    {t('vehicles.detail.batteryOverview', 'Battery Overview')}
                  </span>
                </div>
                <div className="flex items-center gap-4 mb-4">
                  <RadialGauge
                    value={state.battery_level}
                    max={100}
                    label={t('common.battery', 'Battery')}
                    unit="%"
                    color={batteryColor(state.battery_level)}
                    size={100}
                  />
                  <div className="flex-1">
                    <GlassPanel className="p-3 mb-2">
                      <span className="text-xs text-[var(--text-muted)]">{t('common.battery', 'Battery')}</span>
                      <AnimatedNumber value={state.battery_level} suffix="%" className="block text-xl font-bold text-[var(--text-primary)]" />
                    </GlassPanel>
                    <GlassPanel className="p-3">
                      <span className="text-xs text-[var(--text-muted)]">{t('common.range', 'Range')}</span>
                      <AnimatedNumber
                        value={convertDistance(state.rated_range)}
                        decimals={0}
                        suffix={` ${distanceUnit}`}
                        className="block text-xl font-bold text-[var(--text-primary)]"
                      />
                    </GlassPanel>
                  </div>
                </div>
                <div className="h-48">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={batteryChartData}>
                      <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
                      <XAxis dataKey="name" stroke="rgba(255,255,255,0.4)" fontSize={12} />
                      <YAxis stroke="rgba(255,255,255,0.4)" fontSize={12} domain={[0, 100]} />
                      <Tooltip content={<ChartTooltip />} />
                      <Bar dataKey="value" fill={CHART_COLORS[0]} radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </GlassPanel>

              {/* Recent drives distance trend chart */}
              <GlassPanel className="p-6">
                <div className="flex items-center gap-2 mb-4">
                  <Route className="h-4 w-4 text-[var(--neon-cyan)]" />
                  <span className="text-lg font-bold text-[var(--text-primary)]">
                    {t('vehicles.detail.driveTrend', 'Drive Distance Trend')}
                  </span>
                </div>
                {driveChartData.length > 0 ? (
                  <div className="h-64">
                    <ResponsiveContainer width="100%" height="100%">
                      <AreaChart data={driveChartData}>
                        <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
                        <XAxis dataKey="date" stroke="rgba(255,255,255,0.4)" fontSize={11} />
                        <YAxis stroke="rgba(255,255,255,0.4)" fontSize={11} />
                        <Tooltip content={<ChartTooltip />} />
                        <Legend />
                        <Area
                          type="monotone"
                          dataKey="distance"
                          name={t('common.distance', 'Distance')}
                          stroke={CHART_COLORS[0]}
                          fill={CHART_COLORS[0]}
                          fillOpacity={0.15}
                        />
                        <Area
                          type="monotone"
                          dataKey="duration"
                          name={t('common.duration', 'Duration')}
                          stroke={CHART_COLORS[1]}
                          fill={CHART_COLORS[1]}
                          fillOpacity={0.1}
                        />
                      </AreaChart>
                    </ResponsiveContainer>
                  </div>
                ) : (
                  <EmptyState
                    icon={<Route className="h-8 w-8" />}
                    message={t('vehicles.detail.noDriveData', 'No drive data for chart')}
                  />
                )}
              </GlassPanel>
            </div>
          </FadeIn>

          {/* ── 11. Recent Drives ── */}
          <FadeIn delay={0.22}>
            <GlassPanel className="p-6">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                  <Route className="h-4 w-4 text-[var(--neon-cyan)]" />
                  <span className="text-lg font-bold text-[var(--text-primary)]">
                    {t('common.recentDrives', 'Recent Drives')}
                  </span>
                </div>
                <Link
                  to="/drives"
                  className="text-xs text-[var(--text-muted)] hover:text-[var(--neon-cyan)] transition-colors flex items-center gap-1"
                >
                  {t('common.viewAll', 'View all')} <ChevronRight className="h-3 w-3" />
                </Link>
              </div>
              {drives && drives.length > 0 ? (
                <DataTable
                  columns={driveColumns}
                  data={drives}
                  keyExtractor={(d) => d.id}
                  compact
                  pagination
                  emptyMessage={t('common.noDrives', 'No drives recorded yet')}
                />
              ) : (
                <EmptyState
                  icon={<Route className="h-8 w-8" />}
                  message={t('common.noDrives', 'No drives recorded yet')}
                />
              )}
            </GlassPanel>
          </FadeIn>

          {/* ── 12. Recent Charges ── */}
          <FadeIn delay={0.24}>
            <GlassPanel className="p-6">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                  <BatteryCharging className="h-4 w-4 text-[var(--neon-green)]" />
                  <span className="text-lg font-bold text-[var(--text-primary)]">
                    {t('common.recentCharges', 'Recent Charges')}
                  </span>
                </div>
                <Link
                  to="/charging"
                  className="text-xs text-[var(--text-muted)] hover:text-[var(--neon-green)] transition-colors flex items-center gap-1"
                >
                  {t('common.viewAll', 'View all')} <ChevronRight className="h-3 w-3" />
                </Link>
              </div>
              {sessions && sessions.length > 0 ? (
                <DataTable
                  columns={chargeColumns}
                  data={sessions}
                  keyExtractor={(s) => s.id}
                  compact
                  pagination
                  emptyMessage={t('common.noCharges', 'No charging sessions recorded yet')}
                />
              ) : (
                <EmptyState
                  icon={<BatteryCharging className="h-8 w-8" />}
                  message={t('common.noCharges', 'No charging sessions recorded yet')}
                />
              )}
            </GlassPanel>
          </FadeIn>

          {/* ── 13. Vehicle Configuration ── */}
          <FadeIn delay={0.26}>
            <GlassPanel className="p-6">
              <div className="flex items-center gap-2 mb-4">
                <Settings className="h-4 w-4 text-[var(--neon-cyan)]" />
                <span className="text-lg font-bold text-[var(--text-primary)]">
                  {t('vehicles.detail.vehicleConfig', 'Vehicle Configuration')}
                </span>
              </div>
              {configItems.length > 0 ? (
                <KVList items={configItems} columns={2} />
              ) : (
                <Skeleton lines={4} height={16} />
              )}
            </GlassPanel>
          </FadeIn>

          {/* ── 14. Quick Links ── */}
          <FadeIn delay={0.28}>
            <GlassPanel className="p-6">
              <div className="flex items-center gap-2 mb-4">
                <ChevronRight className="h-4 w-4 text-[var(--neon-cyan)]" />
                <span className="text-lg font-bold text-[var(--text-primary)]">
                  {t('vehicles.detail.quickLinks', 'Quick Links')}
                </span>
              </div>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
                {quickLinks.map((link) => {
                  const IconComp = link.icon
                  return (
                    <Link key={link.to} to={link.to}>
                      <GlassPanel
                        hover
                        glow="cyan"
                        className={cn(
                          'flex flex-col items-center gap-2 p-4 text-center',
                          'transition-all cursor-pointer',
                        )}
                      >
                        <IconComp className="h-5 w-5 text-[var(--text-muted)]" />
                        <span className="text-xs font-medium text-[var(--text-primary)]">
                          {link.label}
                        </span>
                      </GlassPanel>
                    </Link>
                  )
                })}
              </div>
            </GlassPanel>
          </FadeIn>
        </>
      )}
    </PageContainer>
  )
}
