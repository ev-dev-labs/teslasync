import { useParams, Link } from 'react-router-dom'
import { useQuery, useMutation } from '@tanstack/react-query'
import { getVehicle, getVehicleState, getVehiclePositions, wakeVehicle, getDrives, getChargingSessions, getVehicleStatus, getMotorLatest, getClimateLatest, getSecurityLatest, getLatestTirePressure, getChargingTelemetryLatest, getMediaLatest, getLocationSnapshotLatest } from '../api'
import { cleanNil } from '../lib/cleanNil'
import { MapContainer, TileLayer, Polyline, Marker } from 'react-leaflet'
import { LatLngExpression } from 'leaflet'
import {
  Battery, Thermometer, Gauge, Navigation, Lock, Unlock, Shield,
  Zap, ArrowLeft, Power, Activity, Route, Clock, Eye, Wind,
  Cpu, BatteryCharging, ChevronRight, Cog, ShieldAlert, DoorClosed,
  Car, Fan, Snowflake, CircleDot, Headphones, Navigation2, MapPin,
} from 'lucide-react'
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts'
import { GlassPanel, FadeIn, StaggerContainer, StaggerItem, StatusBadge } from '../components/ui'
import { TeslaCarViz, parseModelKey } from '../components/TeslaCarViz'
import { RadialGauge, AnimatedNumber, MetricBar } from '../components/Widgets'
import { useSettings } from '../hooks/useSettings'
import clsx from 'clsx'

function InfoTile({ icon: Icon, label, value, color = 'text-[var(--text-primary)]', sub }: {
  icon: React.ElementType; label: string; value: string | number | boolean; color?: string; sub?: string
}) {
  const display = typeof value === 'boolean' ? (value ? 'Yes' : 'No') : value
  return (
    <GlassPanel className="p-4">
      <div className="flex items-center gap-2 text-[var(--text-muted)] text-xs mb-1.5">
        <Icon className="h-3.5 w-3.5" />
        {label}
      </div>
      <p className={clsx('text-lg font-semibold', color)}>{display}</p>
      {sub && <p className="text-[10px] text-gray-600 mt-0.5">{sub}</p>}
    </GlassPanel>
  )
}

function ChartTooltip({ active, payload, label }: { active?: boolean; payload?: Array<{ name: string; value: number; color: string }>; label?: string }) {
  if (!active || !payload?.length) return null
  return (
    <div className="glass-panel p-3 text-xs" style={{ background: 'var(--surface-2)', borderColor: 'var(--glass-border)' }}>
      <p style={{ color: 'var(--text-secondary)' }} className="mb-1">{label}</p>
      {payload.map(p => (
        <p key={p.name} style={{ color: 'var(--text-primary)' }}>
          <span style={{ color: p.color }}>●</span> {p.name}: {p.value}
        </p>
      ))}
    </div>
  )
}

export default function VehicleDetail() {
  const { id } = useParams<{ id: string }>()
  const vehicleId = Number(id)
  const { convertDistance, convertSpeed, convertTemp, convertPressure, distanceUnit, speedUnit, tempUnit, pressureUnit } = useSettings()

  const { data: vehicle } = useQuery({
    queryKey: ['vehicle', vehicleId],
    queryFn: () => getVehicle(vehicleId),
  })

  const { data: stateData, refetch: refetchState } = useQuery({
    queryKey: ['vehicle-state', vehicleId],
    queryFn: () => getVehicleState(vehicleId),
    refetchInterval: 30_000,
  })

  const { data: positions } = useQuery({
    queryKey: ['vehicle-positions', vehicleId],
    queryFn: () => getVehiclePositions(vehicleId, 200),
  })

  const { data: drives } = useQuery({
    queryKey: ['drives', vehicleId],
    queryFn: () => getDrives(vehicleId, 5),
  })

  const { data: sessions } = useQuery({
    queryKey: ['charging', vehicleId],
    queryFn: () => getChargingSessions(vehicleId, 5),
  })

  const wakeMut = useMutation({
    mutationFn: () => wakeVehicle(vehicleId),
    onSuccess: () => { setTimeout(() => refetchState(), 5000) },
  })

  const { data: motorData } = useQuery({
    queryKey: ['motor-latest', vehicleId],
    queryFn: () => getMotorLatest(vehicleId),
    refetchInterval: 3000,
  })

  const { data: climateData } = useQuery({
    queryKey: ['climate-latest', vehicleId],
    queryFn: () => getClimateLatest(vehicleId),
    refetchInterval: 3000,
  })

  const { data: securityData } = useQuery({
    queryKey: ['security-latest', vehicleId],
    queryFn: () => getSecurityLatest(vehicleId),
    refetchInterval: 3000,
  })

  const { data: tireData } = useQuery({
    queryKey: ['tire-latest', vehicleId],
    queryFn: () => getLatestTirePressure(vehicleId),
    refetchInterval: 3000,
  })
  const { data: chargingTelemetry } = useQuery({
    queryKey: ['charging-telemetry-latest', vehicleId],
    queryFn: () => getChargingTelemetryLatest(vehicleId),
    refetchInterval: 5000,
  })
  const { data: mediaData } = useQuery({
    queryKey: ['media-latest', vehicleId],
    queryFn: () => getMediaLatest(vehicleId),
    refetchInterval: 5000,
  })
  const { data: locationData } = useQuery({
    queryKey: ['location-latest', vehicleId],
    queryFn: () => getLocationSnapshotLatest(vehicleId),
    refetchInterval: 5000,
  })

  const state = stateData?.state
  const status = vehicle ? getVehicleStatus(vehicle, state) : 'offline'
  const trail: LatLngExpression[] = positions
    ?.filter(p => p.latitude && p.longitude)
    .map(p => [p.latitude, p.longitude] as LatLngExpression) ?? []

  const batteryData = positions?.map(p => ({
    time: new Date(p.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    battery: p.battery_level,
    speed: convertSpeed(p.speed ?? 0),
  })).reverse() ?? []

  return (
    <div className="space-y-6">
      {/* Back button + header */}
      <FadeIn>
        <div className="flex items-center gap-4">
          <Link to="/vehicles" className="rounded-xl p-2.5 text-[var(--text-muted)] hover:bg-white/5 hover:text-[var(--text-primary)] transition-all">
            <ArrowLeft className="h-5 w-5" />
          </Link>
          <div className="flex-1">
            <div className="flex items-center gap-3">
              <h1 className="text-3xl font-bold tracking-tight text-[var(--text-primary)]">
                {vehicle?.display_name || vehicle?.vin || 'Vehicle'}
              </h1>
              <StatusBadge status={status as 'online' | 'offline' | 'asleep' | 'driving' | 'charging' | 'updating'} size="md" />
            </div>
            <p className="text-sm text-[var(--text-muted)] mt-0.5">
              {vehicle?.model} {vehicle?.trim_badging} &middot; <span className="font-mono">{vehicle?.vin}</span>
            </p>
          </div>
          <button
            onClick={() => wakeMut.mutate()}
            disabled={wakeMut.isPending}
            className="neon-button flex items-center gap-2 text-sm"
          >
            <Power className="h-4 w-4" />
            {wakeMut.isPending ? 'Waking...' : 'Wake Up'}
          </button>
        </div>
      </FadeIn>

      {state ? (
        <>
          {/* ============ HERO: Car Viz + Gauges ============ */}
          <FadeIn delay={0.05}>
            <GlassPanel className="relative overflow-hidden">
              <div className="absolute inset-0 bg-gradient-to-br from-neon-cyan/[0.02] via-transparent to-neon-purple/[0.02]" />
              <div className="relative grid grid-cols-1 lg:grid-cols-[auto,1fr] gap-8 p-6 lg:p-8">
                {/* Car visualization */}
                <div className="flex items-center justify-center">
                  <TeslaCarViz
                    batteryLevel={state.battery_level}
                    isCharging={state.is_charging}
                    isLocked={state.is_locked}
                    isClimateOn={state.is_climate_on}
                    sentryMode={state.sentry_mode}
                    speed={state.speed}
                    size="lg"
                    model={parseModelKey(vehicle?.model)}
                  />
                </div>

                {/* Gauges + metrics */}
                <div className="flex flex-col gap-6">
                  {/* Radial gauge row */}
                  <div className="flex items-center gap-5 flex-wrap">
                    <RadialGauge
                      value={state.battery_level} max={100}
                      label="Battery" unit="%"
                      color={state.battery_level > 50 ? '#10b981' : state.battery_level > 20 ? '#f59e0b' : '#ef4444'}
                      size={110}
                    />
                    <RadialGauge
                      value={Math.round(convertDistance(state.rated_range))} max={Math.round(convertDistance(600))}
                      label="Range" unit={distanceUnit}
                      color="#00f0ff" size={110}
                    />
                    <RadialGauge
                      value={Math.round(convertSpeed(state.speed))} max={Math.round(convertSpeed(250))}
                      label="Speed" unit={speedUnit}
                      color={state.speed > 0 ? '#a855f7' : '#374151'}
                      size={110}
                    />
                    <RadialGauge
                      value={state.charger_power} max={250}
                      label="Power" unit="kW"
                      color={state.is_charging ? '#10b981' : '#374151'}
                      size={110}
                    />
                  </div>

                  {/* Metric bars */}
                  <div className="space-y-3">
                    <MetricBar value={state.battery_level} max={100} color={state.battery_level > 50 ? '#10b981' : '#f59e0b'} label="Battery Level" sublabel={`${state.battery_level}%`} />
                    <MetricBar value={convertDistance(state.rated_range)} max={convertDistance(600)} color="#00f0ff" label="Estimated Range" sublabel={`${Math.round(convertDistance(state.rated_range))} ${distanceUnit}`} />
                    {state.is_charging && (
                      <MetricBar value={convertSpeed(state.charge_rate)} max={state.charger_power || 100} color="#10b981" label="Charge Rate" sublabel={`${Math.round(convertSpeed(state.charge_rate))} ${speedUnit} added`} />
                    )}
                  </div>

                  {/* Quick info chips */}
                  <div className="flex flex-wrap gap-2">
                    {[
                      { icon: state.is_locked ? Lock : Unlock, label: state.is_locked ? 'Locked' : 'Unlocked', color: state.is_locked ? '#10b981' : '#f59e0b' },
                      { icon: Shield, label: state.sentry_mode ? 'Sentry ON' : 'Sentry OFF', color: state.sentry_mode ? '#ef4444' : '#4b5563' },
                      { icon: Wind, label: state.is_climate_on ? 'Climate ON' : 'Climate OFF', color: state.is_climate_on ? '#00f0ff' : '#4b5563' },
                      { icon: Cpu, label: state.software_version || 'N/A', color: '#a855f7' },
                    ].map(chip => (
                      <span key={chip.label} className="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[11px] font-medium border border-white/[0.06] bg-white/[0.02]">
                        <chip.icon className="h-3 w-3" style={{ color: chip.color }} />
                        <span className="text-gray-300">{chip.label}</span>
                      </span>
                    ))}
                  </div>
                </div>
              </div>
            </GlassPanel>
          </FadeIn>

          {/* ============ TELEMETRY GRID ============ */}
          <StaggerContainer className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
            <StaggerItem>
              <InfoTile icon={Battery} label="Battery" value={`${state.battery_level}%`}
                color={state.battery_level > 50 ? 'text-neon-green' : state.battery_level > 20 ? 'text-neon-amber' : 'text-neon-red'}
                sub={`${Math.round(convertDistance(state.rated_range))} ${distanceUnit} range`} />
            </StaggerItem>
            <StaggerItem>
              <InfoTile icon={Gauge} label="Speed" value={`${Math.round(convertSpeed(state.speed))} ${speedUnit}`}
                sub={state.speed > 0 ? 'Driving' : 'Parked'} />
            </StaggerItem>
            <StaggerItem>
              <InfoTile icon={Thermometer} label="Inside" value={`${convertTemp(state.inside_temp).toFixed(1)}${tempUnit}`}
                sub={`Outside: ${convertTemp(state.outside_temp).toFixed(1)}${tempUnit}`} />
            </StaggerItem>
            <StaggerItem>
              <InfoTile icon={Navigation} label="Odometer" value={`${Math.round(convertDistance(state.odometer)).toLocaleString()} ${distanceUnit}`} />
            </StaggerItem>
            <StaggerItem>
              <InfoTile icon={BatteryCharging} label="Charger" value={state.is_charging ? `${state.charger_power} kW` : 'Not charging'}
                color={state.is_charging ? 'text-neon-green' : 'text-[var(--text-muted)]'}
                sub={state.is_charging && state.time_to_full_charge != null ? `Full in ${state.time_to_full_charge.toFixed(1)}h` : undefined} />
            </StaggerItem>
            <StaggerItem>
              <InfoTile icon={Eye} label="Sentry" value={state.sentry_mode ? 'Active' : 'Off'}
                color={state.sentry_mode ? 'text-neon-red' : 'text-[var(--text-muted)]'} />
            </StaggerItem>
          </StaggerContainer>

          {/* ============ LIVE TELEMETRY ============ */}
          <FadeIn delay={0.12}>
            <div className="flex items-center gap-3 mt-2">
              <span className="relative flex h-3 w-3">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75" />
                <span className="relative inline-flex rounded-full h-3 w-3 bg-green-500" />
              </span>
              <h2 className="text-xl font-bold tracking-tight text-[var(--text-primary)]">Live Telemetry</h2>
            </div>
          </FadeIn>

          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            {/* ---- Powertrain Panel ---- */}
            <FadeIn delay={0.14}>
              <GlassPanel className="p-6 h-full">
                <h3 className="section-title flex items-center gap-2 mb-5">
                  <Cog className="h-4 w-4 text-neon-cyan" /> Powertrain
                </h3>
                {motorData ? (
                  <div className="space-y-4">
                    {/* Motor state badge */}
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-[var(--text-muted)]">Motor State</span>
                      <span className={clsx(
                        'inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[11px] font-semibold border',
                        motorData.di_state === 'Enabled' ? 'border-green-500/30 bg-green-500/10 text-green-400'
                          : motorData.di_state === 'Standby' ? 'border-amber-500/30 bg-amber-500/10 text-amber-400'
                          : 'border-gray-500/30 bg-gray-500/10 text-gray-400',
                      )}>
                        <CircleDot className="h-3 w-3" />
                        {cleanNil(motorData.di_state) ?? 'Unknown'}
                      </span>
                    </div>

                    {/* Torque gauge */}
                    <div>
                      <div className="flex items-center justify-between text-xs mb-1">
                        <span className="text-[var(--text-muted)]">Torque</span>
                        <span className="text-[var(--text-primary)] font-mono">{motorData.di_torque?.toFixed(0) ?? '—'} Nm</span>
                      </div>
                      <div className="relative h-3 rounded-full bg-white/[0.04] overflow-hidden">
                        <div className="absolute inset-y-0 left-1/2 w-px bg-white/10" />
                        {motorData.di_torque != null && (
                          <div
                            className={clsx('absolute inset-y-0 rounded-full transition-all duration-300',
                              motorData.di_torque >= 0 ? 'bg-green-500/60' : 'bg-red-500/60')}
                            style={motorData.di_torque >= 0
                              ? { left: '50%', width: `${Math.min(Math.abs(motorData.di_torque) / 500 * 50, 50)}%` }
                              : { right: '50%', width: `${Math.min(Math.abs(motorData.di_torque) / 500 * 50, 50)}%` }}
                          />
                        )}
                      </div>
                      <div className="flex justify-between text-[10px] text-[var(--text-muted)] mt-0.5">
                        <span>-500</span><span>0</span><span>+500</span>
                      </div>
                    </div>

                    {/* Axle Speed */}
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-[var(--text-muted)]">Axle Speed</span>
                      <span className="text-sm font-mono text-[var(--text-primary)]">{motorData.di_axle_speed?.toFixed(0) ?? '—'} RPM</span>
                    </div>

                    {/* Stator Temperature */}
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-[var(--text-muted)]">Stator Temp</span>
                      <span className={clsx('text-sm font-mono',
                        motorData.di_stator_temp != null && motorData.di_stator_temp > 80 ? 'text-red-400' : 'text-[var(--text-primary)]')}>
                        {motorData.di_stator_temp != null ? `${convertTemp(motorData.di_stator_temp).toFixed(1)} ${tempUnit}` : '—'}
                      </span>
                    </div>

                    {/* Throttle position bar */}
                    <div>
                      <div className="flex items-center justify-between text-xs mb-1">
                        <span className="text-[var(--text-muted)]">Throttle Position</span>
                        <span className="text-[var(--text-primary)] font-mono">{motorData.pedal_position != null ? `${(motorData.pedal_position * 100).toFixed(0)}%` : '—'}</span>
                      </div>
                      <div className="h-2 rounded-full bg-white/[0.04] overflow-hidden">
                        <div className="h-full rounded-full bg-neon-cyan/60 transition-all duration-300"
                          style={{ width: `${(motorData.pedal_position ?? 0) * 100}%` }} />
                      </div>
                    </div>

                    {/* Brake indicator */}
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-[var(--text-muted)]">Brake</span>
                      <span className={clsx('inline-flex items-center gap-1 text-xs font-semibold',
                        motorData.brake_pedal ? 'text-red-400' : 'text-gray-500')}>
                        <span className={clsx('h-2 w-2 rounded-full', motorData.brake_pedal ? 'bg-red-400' : 'bg-gray-600')} />
                        {motorData.brake_pedal ? 'Active' : 'Inactive'}
                      </span>
                    </div>

                    {/* G-Forces */}
                    <div className="grid grid-cols-2 gap-3">
                      <div className="rounded-xl bg-white/[0.02] border border-white/[0.06] p-3 text-center">
                        <p className="text-[10px] text-[var(--text-muted)] mb-1">Lateral G</p>
                        <p className="text-base font-mono text-[var(--text-primary)]">
                          {motorData.lateral_accel != null ? `${motorData.lateral_accel > 0 ? '+' : ''}${motorData.lateral_accel.toFixed(2)}g` : '—'}
                        </p>
                      </div>
                      <div className="rounded-xl bg-white/[0.02] border border-white/[0.06] p-3 text-center">
                        <p className="text-[10px] text-[var(--text-muted)] mb-1">Longitudinal G</p>
                        <p className="text-base font-mono text-[var(--text-primary)]">
                          {motorData.longitudinal_accel != null ? `${motorData.longitudinal_accel > 0 ? '+' : ''}${motorData.longitudinal_accel.toFixed(2)}g` : '—'}
                        </p>
                      </div>
                    </div>
                  </div>
                ) : (
                  <p className="text-xs text-gray-600 text-center py-6">No motor data available</p>
                )}
              </GlassPanel>
            </FadeIn>

            {/* ---- Climate Panel ---- */}
            <FadeIn delay={0.16}>
              <GlassPanel className="p-6 h-full">
                <h3 className="section-title flex items-center gap-2 mb-5">
                  <Thermometer className="h-4 w-4 text-neon-cyan" /> Climate
                </h3>
                {climateData ? (
                  <div className="space-y-4">
                    {/* Cabin + Outside temps */}
                    <div className="grid grid-cols-2 gap-3">
                      <div className="rounded-xl bg-white/[0.02] border border-white/[0.06] p-4 text-center">
                        <p className="text-[10px] text-[var(--text-muted)] mb-1">Cabin</p>
                        <p className="text-2xl font-bold text-[var(--text-primary)]">
                          {climateData.inside_temp != null ? convertTemp(climateData.inside_temp).toFixed(1) : '—'}
                        </p>
                        <p className="text-[10px] text-[var(--text-muted)]">{tempUnit}</p>
                      </div>
                      <div className="rounded-xl bg-white/[0.02] border border-white/[0.06] p-4 text-center">
                        <p className="text-[10px] text-[var(--text-muted)] mb-1">Outside</p>
                        <p className="text-2xl font-bold text-[var(--text-primary)]">
                          {climateData.outside_temp != null ? convertTemp(climateData.outside_temp).toFixed(1) : '—'}
                        </p>
                        <p className="text-[10px] text-[var(--text-muted)]">{tempUnit}</p>
                      </div>
                    </div>

                    {/* Target temps */}
                    <div className="grid grid-cols-2 gap-3">
                      <div className="flex items-center justify-between">
                        <span className="text-xs text-[var(--text-muted)]">Left Zone</span>
                        <span className="text-sm font-mono text-[var(--text-primary)]">
                          {climateData.hvac_left_temp_request != null ? `${convertTemp(climateData.hvac_left_temp_request).toFixed(1)} ${tempUnit}` : '—'}
                        </span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-xs text-[var(--text-muted)]">Right Zone</span>
                        <span className="text-sm font-mono text-[var(--text-primary)]">
                          {climateData.hvac_right_temp_request != null ? `${convertTemp(climateData.hvac_right_temp_request).toFixed(1)} ${tempUnit}` : '—'}
                        </span>
                      </div>
                    </div>

                    {/* HVAC Power bar */}
                    <div>
                      <div className="flex items-center justify-between text-xs mb-1">
                        <span className="text-[var(--text-muted)]">HVAC Power</span>
                        <span className="text-[var(--text-primary)] font-mono">{climateData.hvac_power != null ? `${climateData.hvac_power.toFixed(1)} kW` : '—'}</span>
                      </div>
                      <div className="h-2 rounded-full bg-white/[0.04] overflow-hidden">
                        <div className="h-full rounded-full bg-neon-cyan/60 transition-all duration-300"
                          style={{ width: `${Math.min(((climateData.hvac_power ?? 0) / 8) * 100, 100)}%` }} />
                      </div>
                    </div>

                    {/* Fan Speed */}
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-[var(--text-muted)] flex items-center gap-1"><Fan className="h-3 w-3" /> Fan Speed</span>
                      <div className="flex items-center gap-1">
                        {[1, 2, 3, 4, 5, 6].map(level => (
                          <div key={level} className={clsx('h-3 rounded-sm transition-colors',
                            level === 1 ? 'w-1.5' : level === 2 ? 'w-2' : level === 3 ? 'w-2.5' : level === 4 ? 'w-3' : level === 5 ? 'w-3.5' : 'w-4',
                            (climateData.hvac_fan_speed ?? 0) >= level ? 'bg-neon-cyan/70' : 'bg-white/[0.06]',
                          )} />
                        ))}
                        <span className="text-xs font-mono text-[var(--text-primary)] ml-1.5">{climateData.hvac_fan_speed ?? 0}</span>
                      </div>
                    </div>

                    {/* System badges */}
                    <div className="flex flex-wrap gap-2 pt-1">
                      <span className={clsx('inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[11px] font-medium border',
                        climateData.defrost_mode ? 'border-blue-400/30 bg-blue-400/10 text-blue-400' : 'border-white/[0.06] bg-white/[0.02] text-gray-500')}>
                        <Snowflake className="h-3 w-3" /> Defrost {climateData.defrost_mode ? 'ON' : 'OFF'}
                      </span>
                      <span className={clsx('inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[11px] font-medium border',
                        climateData.battery_heater_on ? 'border-amber-400/30 bg-amber-400/10 text-amber-400' : 'border-white/[0.06] bg-white/[0.02] text-gray-500')}>
                        <Zap className="h-3 w-3" /> Battery Heater {climateData.battery_heater_on ? 'ON' : 'OFF'}
                      </span>
                      <span className={clsx('inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[11px] font-medium border',
                        climateData.cabin_overheat_mode && climateData.cabin_overheat_mode !== 'Off'
                          ? 'border-red-400/30 bg-red-400/10 text-red-400' : 'border-white/[0.06] bg-white/[0.02] text-gray-500')}>
                        <ShieldAlert className="h-3 w-3" /> Overheat Protection {climateData.cabin_overheat_mode ?? 'Off'}
                      </span>
                    </div>
                  </div>
                ) : (
                  <p className="text-xs text-gray-600 text-center py-6">No climate data available</p>
                )}
              </GlassPanel>
            </FadeIn>

            {/* ---- Security Panel ---- */}
            <FadeIn delay={0.18}>
              <GlassPanel className="p-6 h-full">
                <h3 className="section-title flex items-center gap-2 mb-5">
                  <Shield className="h-4 w-4 text-neon-cyan" /> Security
                </h3>
                {securityData ? (
                  <div className="space-y-4">
                    {/* Lock status */}
                    <div className="flex items-center gap-4">
                      <div className={clsx('rounded-xl p-3 border',
                        securityData.locked ? 'border-green-500/30 bg-green-500/10' : 'border-amber-500/30 bg-amber-500/10')}>
                        {securityData.locked
                          ? <Lock className="h-6 w-6 text-green-400" />
                          : <Unlock className="h-6 w-6 text-amber-400" />}
                      </div>
                      <div>
                        <p className={clsx('text-lg font-semibold', securityData.locked ? 'text-green-400' : 'text-amber-400')}>
                          {securityData.locked ? 'Locked' : 'Unlocked'}
                        </p>
                        <p className="text-[10px] text-[var(--text-muted)]">Vehicle lock status</p>
                      </div>
                    </div>

                    {/* Sentry Mode */}
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-[var(--text-muted)] flex items-center gap-1"><Eye className="h-3 w-3" /> Sentry Mode</span>
                      <span className={clsx('inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[11px] font-semibold border',
                        securityData.sentry_mode ? 'border-red-500/30 bg-red-500/10 text-red-400' : 'border-white/[0.06] bg-white/[0.02] text-gray-500')}>
                        <ShieldAlert className="h-3 w-3" />
                        {securityData.sentry_mode ? 'Active' : 'Inactive'}
                      </span>
                    </div>

                    {/* Door State */}
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-[var(--text-muted)] flex items-center gap-1"><DoorClosed className="h-3 w-3" /> Door State</span>
                      <span className="text-sm font-mono text-[var(--text-primary)]">{securityData.door_state ?? '—'}</span>
                    </div>

                    {/* Windows grid */}
                    <div>
                      <p className="text-xs text-[var(--text-muted)] mb-2">Windows</p>
                      <div className="grid grid-cols-2 gap-2">
                        {([
                          ['FD', securityData.fd_window],
                          ['FP', securityData.fp_window],
                          ['RD', securityData.rd_window],
                          ['RP', securityData.rp_window],
                        ] as const).map(([label, val]) => (
                          <div key={label} className="flex items-center justify-between rounded-lg bg-white/[0.02] border border-white/[0.06] px-3 py-2">
                            <span className="text-[11px] text-[var(--text-muted)]">{label}</span>
                            <span className={clsx('text-[11px] font-semibold',
                              val === 'Closed' ? 'text-green-400' : val ? 'text-amber-400' : 'text-gray-500')}>
                              {val ?? '—'}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* HomeLink + Guest Mode */}
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-[var(--text-muted)] flex items-center gap-1"><Car className="h-3 w-3" /> HomeLink</span>
                      <span className={clsx('text-xs font-medium',
                        securityData.homelink_nearby ? 'text-green-400' : 'text-gray-500')}>
                        {securityData.homelink_nearby ? 'Nearby' : 'Not detected'}
                      </span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-[var(--text-muted)] flex items-center gap-1"><Shield className="h-3 w-3" /> Guest Mode</span>
                      <span className={clsx('text-xs font-medium',
                        securityData.guest_mode ? 'text-amber-400' : 'text-gray-500')}>
                        {securityData.guest_mode ? 'Enabled' : 'Disabled'}
                      </span>
                    </div>
                  </div>
                ) : (
                  <p className="text-xs text-gray-600 text-center py-6">No security data available</p>
                )}
              </GlassPanel>
            </FadeIn>

            {/* ---- Tire Pressure Panel ---- */}
            <FadeIn delay={0.2}>
              <GlassPanel className="p-6 h-full">
                <h3 className="section-title flex items-center gap-2 mb-5">
                  <Gauge className="h-4 w-4 text-neon-cyan" /> Tire Pressure
                </h3>
                {tireData ? (() => {
                  const toDisplay = (bar: number | null) => bar != null ? convertPressure(bar) : null
                  const tires = [
                    { label: 'FL', pressure: toDisplay(tireData.front_left) },
                    { label: 'FR', pressure: toDisplay(tireData.front_right) },
                    { label: 'RL', pressure: toDisplay(tireData.rear_left) },
                    { label: 'RR', pressure: toDisplay(tireData.rear_right) },
                  ]
                  const getColor = (val: number | null) => {
                    if (val == null) return 'text-gray-500'
                    const psi = val // already in display unit; thresholds converted below
                    const lowCrit = convertPressure(2.068) // ~30 PSI
                    const lowWarn = convertPressure(2.413) // ~35 PSI
                    const highWarn = convertPressure(3.103) // ~45 PSI
                    const highCrit = convertPressure(3.447) // ~50 PSI
                    if (psi < lowCrit || psi > highCrit) return 'text-red-400'
                    if (psi < lowWarn || psi > highWarn) return 'text-amber-400'
                    return 'text-green-400'
                  }
                  const getBorder = (val: number | null) => {
                    if (val == null) return 'border-gray-600/30'
                    const lowCrit = convertPressure(2.068)
                    const lowWarn = convertPressure(2.413)
                    const highWarn = convertPressure(3.103)
                    const highCrit = convertPressure(3.447)
                    if (val < lowCrit || val > highCrit) return 'border-red-500/30'
                    if (val < lowWarn || val > highWarn) return 'border-amber-500/30'
                    return 'border-green-500/30'
                  }
                  const lowWarn = convertPressure(2.413)
                  const highWarn = convertPressure(3.103)
                  const allGood = tires.every(t => t.pressure != null && t.pressure >= lowWarn && t.pressure <= highWarn)
                  const lowCrit = convertPressure(2.068)
                  const highCrit = convertPressure(3.447)
                  const anyBad = tires.some(t => t.pressure != null && (t.pressure < lowCrit || t.pressure > highCrit))
                  return (
                    <div className="space-y-4">
                      <div className="grid grid-cols-2 gap-3">
                        {tires.map(t => (
                          <div key={t.label} className={clsx('rounded-xl border bg-white/[0.02] p-4 text-center', getBorder(t.pressure))}>
                            <p className="text-[10px] text-[var(--text-muted)] mb-1">{t.label}</p>
                            <p className={clsx('text-xl font-bold font-mono', getColor(t.pressure))}>
                              {t.pressure != null ? t.pressure.toFixed(1) : '—'}
                            </p>
                            <p className="text-[10px] text-[var(--text-muted)]">{pressureUnit}</p>
                          </div>
                        ))}
                      </div>
                      <div className="text-center">
                        <span className={clsx('inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[11px] font-semibold border',
                          allGood ? 'border-green-500/30 bg-green-500/10 text-green-400'
                            : anyBad ? 'border-red-500/30 bg-red-500/10 text-red-400'
                            : 'border-amber-500/30 bg-amber-500/10 text-amber-400')}>
                          {allGood ? '✓ All Normal' : anyBad ? '✗ Attention Needed' : '⚠ Check Pressure'}
                        </span>
                      </div>
                    </div>
                  )
                })() : (
                  <p className="text-xs text-gray-600 text-center py-6">No tire pressure data available</p>
                )}
              </GlassPanel>
            </FadeIn>

            {/* ---- Energy & Charging Panel ---- */}
            <FadeIn delay={0.22}>
              <GlassPanel className="p-6 h-full">
                <h3 className="section-title flex items-center gap-2 mb-5">
                  <BatteryCharging className="h-4 w-4 text-neon-cyan" /> Energy &amp; Charging
                </h3>
                {chargingTelemetry ? (
                  <div className="space-y-4">
                    {/* Pack Voltage / Current */}
                    <div className="grid grid-cols-2 gap-3">
                      <div className="rounded-xl bg-white/[0.02] border border-white/[0.06] p-4 text-center">
                        <p className="text-[10px] text-[var(--text-muted)] mb-1">Pack Voltage</p>
                        <p className="text-2xl font-bold text-[var(--text-primary)]">
                          {chargingTelemetry.pack_voltage != null ? chargingTelemetry.pack_voltage.toFixed(1) : '—'}
                        </p>
                        <p className="text-[10px] text-[var(--text-muted)]">V</p>
                      </div>
                      <div className="rounded-xl bg-white/[0.02] border border-white/[0.06] p-4 text-center">
                        <p className="text-[10px] text-[var(--text-muted)] mb-1">Pack Current</p>
                        <p className="text-2xl font-bold text-[var(--text-primary)]">
                          {chargingTelemetry.pack_current != null ? chargingTelemetry.pack_current.toFixed(1) : '—'}
                        </p>
                        <p className="text-[10px] text-[var(--text-muted)]">A</p>
                      </div>
                    </div>

                    {/* Energy Remaining */}
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-[var(--text-muted)]">Energy Remaining</span>
                      <span className="text-sm font-mono text-[var(--text-primary)]">
                        {chargingTelemetry.energy_remaining != null ? `${chargingTelemetry.energy_remaining.toFixed(1)} kWh` : '—'}
                      </span>
                    </div>

                    {/* BMS State */}
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-[var(--text-muted)]">BMS State</span>
                      <span className={clsx(
                        'inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[11px] font-semibold border',
                        chargingTelemetry.bms_state === 'Standby' ? 'border-green-500/30 bg-green-500/10 text-green-400'
                          : chargingTelemetry.bms_state === 'Charging' ? 'border-cyan-500/30 bg-cyan-500/10 text-cyan-400'
                          : chargingTelemetry.bms_state === 'Fault' ? 'border-red-500/30 bg-red-500/10 text-red-400'
                          : 'border-gray-500/30 bg-gray-500/10 text-gray-400',
                      )}>
                        {chargingTelemetry.bms_state ?? 'Unknown'}
                      </span>
                    </div>

                    {/* Cell voltage spread */}
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-[var(--text-muted)]">Cell Voltage Spread</span>
                      <span className={clsx('text-sm font-mono',
                        chargingTelemetry.brick_voltage_max != null && chargingTelemetry.brick_voltage_min != null
                          && (chargingTelemetry.brick_voltage_max - chargingTelemetry.brick_voltage_min) > 0.05
                          ? 'text-amber-400' : 'text-[var(--text-primary)]')}>
                        {chargingTelemetry.brick_voltage_max != null && chargingTelemetry.brick_voltage_min != null
                          ? `${((chargingTelemetry.brick_voltage_max - chargingTelemetry.brick_voltage_min) * 1000).toFixed(0)} mV`
                          : '—'}
                      </span>
                    </div>

                    {/* Battery heater */}
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-[var(--text-muted)]">Battery Heater</span>
                      <span className={clsx('inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[11px] font-medium border',
                        chargingTelemetry.battery_heater_on
                          ? 'border-amber-400/30 bg-amber-400/10 text-amber-400'
                          : 'border-white/[0.06] bg-white/[0.02] text-gray-500')}>
                        <Zap className="h-3 w-3" /> {chargingTelemetry.battery_heater_on ? 'Active' : 'Off'}
                      </span>
                    </div>
                  </div>
                ) : (
                  <p className="text-xs text-gray-600 text-center py-6">No charging telemetry available</p>
                )}
              </GlassPanel>
            </FadeIn>

            {/* ---- Media & Navigation Panel ---- */}
            <FadeIn delay={0.24}>
              <GlassPanel className="p-6 h-full">
                <h3 className="section-title flex items-center gap-2 mb-5">
                  <Headphones className="h-4 w-4 text-neon-purple" /> Media &amp; Navigation
                </h3>
                <div className="space-y-5">
                  {/* Now Playing */}
                  <div>
                    <p className="text-[10px] uppercase tracking-wider text-[var(--text-muted)] mb-2">Now Playing</p>
                    {mediaData ? (
                      <div className="rounded-xl bg-white/[0.02] border border-white/[0.06] p-4 space-y-2">
                        <p className="text-sm font-bold text-[var(--text-primary)] truncate">
                          {cleanNil(mediaData.now_playing_title) || 'Nothing playing'}
                        </p>
                        <p className="text-xs text-[var(--text-secondary)] truncate">
                          {cleanNil(mediaData.now_playing_artist) || 'Unknown artist'}
                        </p>
                        <div className="flex items-center gap-2">
                          {cleanNil(mediaData.playback_source) && (
                            <span className="text-[10px] px-2 py-0.5 rounded-full bg-white/5 text-[var(--text-muted)]">
                              {cleanNil(mediaData.playback_source)}
                            </span>
                          )}
                          {cleanNil(mediaData.playback_status) && (
                            <span className={clsx('text-[10px] font-semibold px-2 py-0.5 rounded-full',
                              mediaData.playback_status === 'Playing' ? 'bg-green-500/10 text-green-400'
                                : mediaData.playback_status === 'Paused' ? 'bg-amber-500/10 text-amber-400'
                                : 'bg-white/5 text-[var(--text-muted)]')}>
                              {cleanNil(mediaData.playback_status)}
                            </span>
                          )}
                        </div>
                      </div>
                    ) : (
                      <p className="text-xs text-gray-600">No media data</p>
                    )}
                  </div>

                  {/* Navigation destination */}
                  <div>
                    <p className="text-[10px] uppercase tracking-wider text-[var(--text-muted)] mb-2 flex items-center gap-1">
                      <Navigation2 className="h-3 w-3" /> Navigation
                    </p>
                    {locationData ? (
                      <div className="space-y-3">
                        {locationData.destination_name ? (
                          <div className="rounded-xl bg-white/[0.02] border border-white/[0.06] p-4">
                            <p className="text-sm font-bold text-[var(--text-primary)] truncate flex items-center gap-1.5">
                              <MapPin className="h-3.5 w-3.5 text-neon-cyan flex-shrink-0" />
                              {locationData.destination_name}
                            </p>
                            <div className="flex items-center gap-3 mt-2 text-xs text-[var(--text-secondary)]">
                              {locationData.miles_to_arrival != null && (
                                <span>{convertDistance(locationData.miles_to_arrival * 1.60934).toFixed(1)} {distanceUnit}</span>
                              )}
                              {locationData.minutes_to_arrival != null && (
                                <span>{Math.round(locationData.minutes_to_arrival)} min</span>
                              )}
                            </div>
                          </div>
                        ) : (
                          <p className="text-xs text-gray-500">No active destination</p>
                        )}
                        <div className="flex items-center gap-2 flex-wrap">
                          {locationData.located_at_home && (
                            <span className="inline-flex items-center gap-1 text-[10px] font-medium px-2 py-0.5 rounded-full bg-green-500/10 text-green-400 border border-green-500/20">
                              🏠 Home
                            </span>
                          )}
                          {locationData.located_at_work && (
                            <span className="inline-flex items-center gap-1 text-[10px] font-medium px-2 py-0.5 rounded-full bg-blue-500/10 text-blue-400 border border-blue-500/20">
                              🏢 Work
                            </span>
                          )}
                          {locationData.located_at_favorite && (
                            <span className="inline-flex items-center gap-1 text-[10px] font-medium px-2 py-0.5 rounded-full bg-purple-500/10 text-purple-400 border border-purple-500/20">
                              ⭐ Favorite
                            </span>
                          )}
                        </div>
                      </div>
                    ) : (
                      <p className="text-xs text-gray-600">No location data</p>
                    )}
                  </div>
                </div>
              </GlassPanel>
            </FadeIn>
          </div>

          {/* ============ MAP + CHARTS ROW ============ */}
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            {/* Live Map */}
            {state.latitude && state.longitude && (
              <FadeIn delay={0.15}>
                <GlassPanel className="overflow-hidden h-full">
                  <div className="p-4 pb-0">
                    <h3 className="section-title flex items-center gap-2 mb-3">
                      <Navigation className="h-4 w-4 text-neon-cyan" /> Location
                    </h3>
                  </div>
                  <div className="h-72">
                    <MapContainer center={[state.latitude, state.longitude]} zoom={14} scrollWheelZoom className="h-full w-full">
                      <TileLayer
                        url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
                        attribution='&copy; <a href="https://carto.com/">CARTO</a>'
                      />
                      <Marker position={[state.latitude, state.longitude]} />
                      {trail.length > 1 && (
                        <Polyline positions={trail} pathOptions={{ color: '#00f0ff', weight: 3, opacity: 0.6 }} />
                      )}
                    </MapContainer>
                  </div>
                  <div className="p-3 text-center">
                    <p className="text-[10px] text-[var(--text-muted)] font-mono">
                      {state.latitude.toFixed(5)}, {state.longitude.toFixed(5)}
                    </p>
                  </div>
                </GlassPanel>
              </FadeIn>
            )}

            {/* Battery & Speed chart */}
            <FadeIn delay={0.2}>
              <GlassPanel className="p-6 h-full">
                <h3 className="section-title mb-4 flex items-center gap-2">
                  <Activity className="h-4 w-4 text-neon-cyan" />
                  Battery & Speed History
                </h3>
                {batteryData.length > 0 ? (
                  <div className="h-64">
                    <ResponsiveContainer width="100%" height="100%">
                      <AreaChart data={batteryData}>
                        <CartesianGrid strokeDasharray="3 3" stroke="var(--glass-border)" strokeOpacity={0.4} />
                        <XAxis dataKey="time" tick={{ fill: 'var(--text-muted)', fontSize: 11 }} />
                        <YAxis yAxisId="left" domain={[0, 100]} tick={{ fill: 'var(--text-muted)', fontSize: 11 }} />
                        <YAxis yAxisId="right" orientation="right" tick={{ fill: 'var(--text-muted)', fontSize: 11 }} />
                        <Tooltip content={<ChartTooltip />} />
                        <Area yAxisId="left" type="monotone" dataKey="battery" stroke="#10b981" fill="#10b981" fillOpacity={0.1} name="Battery %" />
                        <Area yAxisId="right" type="monotone" dataKey="speed" stroke="#00f0ff" fill="#00f0ff" fillOpacity={0.1} name={`Speed ${speedUnit}`} />
                      </AreaChart>
                    </ResponsiveContainer>
                  </div>
                ) : (
                  <div className="h-64 flex items-center justify-center">
                    <p className="text-xs text-gray-600">Position data will appear here</p>
                  </div>
                )}
              </GlassPanel>
            </FadeIn>
          </div>

          {/* ============ RECENT DRIVES & CHARGES ============ */}
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            <FadeIn delay={0.25}>
              <GlassPanel className="p-6">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="section-title flex items-center gap-2">
                    <Route className="h-4 w-4 text-neon-cyan" /> Recent Drives
                  </h3>
                  <Link to="/drives" className="text-xs text-[var(--text-muted)] hover:text-neon-cyan transition-colors flex items-center gap-1">
                    View all <ChevronRight className="h-3 w-3" />
                  </Link>
                </div>
                {drives && drives.length > 0 ? (
                  <div className="space-y-2">
                    {drives.slice(0, 5).map(d => (
                      <Link key={d.id} to={`/drives/${d.id}`} className="flex items-center gap-3 p-2.5 rounded-xl hover:bg-white/[0.03] transition-colors group">
                        <div className="rounded-lg bg-neon-cyan/10 p-2 text-neon-cyan">
                          <Route className="h-3.5 w-3.5" />
                        </div>
                        <div className="flex-1 text-sm">
                          <p className="text-[var(--text-primary)] font-medium group-hover:text-neon-cyan transition-colors">
                            <AnimatedNumber value={convertDistance(d.distance)} decimals={1} suffix={` ${distanceUnit}`} />
                          </p>
                          <p className="text-xs text-[var(--text-muted)]">{new Date(d.start_date).toLocaleDateString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</p>
                        </div>
                        <div className="text-right">
                          <span className="text-xs text-[var(--text-muted)] flex items-center gap-1">
                            <Clock className="h-3 w-3" />
                            {Math.floor(d.duration_min / 60)}h {Math.round(d.duration_min % 60)}m
                          </span>
                          {d.start_battery_level != null && d.end_battery_level != null && (
                            <span className="text-[10px] text-gray-600">{d.start_battery_level}% → {d.end_battery_level}%</span>
                          )}
                        </div>
                      </Link>
                    ))}
                  </div>
                ) : (
                  <p className="text-xs text-gray-600 text-center py-6">No drives recorded yet</p>
                )}
              </GlassPanel>
            </FadeIn>

            <FadeIn delay={0.3}>
              <GlassPanel className="p-6">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="section-title flex items-center gap-2">
                    <Zap className="h-4 w-4 text-neon-green" /> Recent Charges
                  </h3>
                  <Link to="/charging" className="text-xs text-[var(--text-muted)] hover:text-neon-cyan transition-colors flex items-center gap-1">
                    View all <ChevronRight className="h-3 w-3" />
                  </Link>
                </div>
                {sessions && sessions.length > 0 ? (
                  <div className="space-y-2">
                    {sessions.slice(0, 5).map(s => (
                      <Link key={s.id} to={`/charging/${s.id}`} className="flex items-center gap-3 p-2.5 rounded-xl hover:bg-white/[0.03] transition-colors group">
                        <div className="rounded-lg bg-neon-green/10 p-2 text-neon-green">
                          <Zap className="h-3.5 w-3.5" />
                        </div>
                        <div className="flex-1 text-sm">
                          <p className="text-[var(--text-primary)] font-medium group-hover:text-neon-green transition-colors">
                            <AnimatedNumber value={s.charge_energy_added} decimals={1} suffix=" kWh" />
                          </p>
                          <p className="text-xs text-[var(--text-muted)]">{new Date(s.start_date).toLocaleDateString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</p>
                        </div>
                        <div className="text-right">
                          <span className="text-xs text-[var(--text-muted)]">{s.start_battery_level}% → {s.end_battery_level ?? '—'}%</span>
                          {s.cost != null && s.cost > 0 && (
                            <p className="text-[10px] text-neon-amber">${s.cost.toFixed(2)}</p>
                          )}
                        </div>
                      </Link>
                    ))}
                  </div>
                ) : (
                  <p className="text-xs text-gray-600 text-center py-6">No charge sessions yet</p>
                )}
              </GlassPanel>
            </FadeIn>
          </div>
        </>
      ) : (
        <FadeIn delay={0.1}>
          <GlassPanel className="p-12 text-center relative overflow-hidden">
            <div className="absolute inset-0 bg-gradient-to-br from-neon-cyan/[0.02] via-transparent to-neon-purple/[0.02]" />
            <div className="relative">
              <TeslaCarViz batteryLevel={50} isCharging={false} isLocked={true} isClimateOn={false} sentryMode={false} speed={0} model={parseModelKey(vehicle?.model)} size="sm" />
              <p className="text-white/80 font-medium mt-4">No live state available</p>
              <p className="text-sm text-[var(--text-muted)] mt-1">The vehicle may be asleep. Try waking it to fetch current data.</p>
            </div>
          </GlassPanel>
        </FadeIn>
      )}
    </div>
  )
}
