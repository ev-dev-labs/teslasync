import { useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { useQuery, useMutation } from '@tanstack/react-query'
import { getVehicle, getVehicleState, getVehiclePositions, wakeVehicle, getDrives, getChargingSessions, getVehicleStatus } from '../api'
import { MapContainer, TileLayer, Polyline, Marker } from 'react-leaflet'
import { LatLngExpression } from 'leaflet'
import {
  Battery, Thermometer, Gauge, Navigation, Lock, Unlock, Shield,
  Zap, ArrowLeft, Power, Activity, Route, Clock, Eye, Wind,
  Cpu, BatteryCharging, ChevronRight, User, Wrench, AlertCircle,
} from 'lucide-react'
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts'
import { GlassPanel, FadeIn, StaggerContainer, StaggerItem, StatusBadge } from '../components/ui'
import { TeslaCarViz, parseModelKey } from '../components/TeslaCarViz'
import { RadialGauge, AnimatedNumber, MetricBar } from '../components/Widgets'
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

function VehicleModelSilhouette({ model }: { model?: string }) {
  const m = (model ?? '').toLowerCase()
  const isSUV = m.includes('model y') || m.includes('model x') || m.includes('my') || m.includes('mx')

  if (isSUV) {
    return (
      <svg viewBox="0 0 200 80" className="w-full max-w-[200px] opacity-30" fill="none" stroke="currentColor" strokeWidth="1.5">
        <path d="M20,60 L30,55 L45,40 L55,28 L75,22 L120,20 L155,22 L165,30 L175,42 L180,60" strokeLinecap="round" />
        <circle cx="50" cy="62" r="10" />
        <circle cx="155" cy="62" r="10" />
        <line x1="20" y1="60" x2="180" y2="60" />
      </svg>
    )
  }

  return (
    <svg viewBox="0 0 200 80" className="w-full max-w-[200px] opacity-30" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M20,55 L35,50 L55,35 L75,25 L120,23 L150,25 L165,35 L175,50 L180,55" strokeLinecap="round" />
      <circle cx="50" cy="58" r="10" />
      <circle cx="155" cy="58" r="10" />
      <line x1="20" y1="55" x2="180" y2="55" />
    </svg>
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

function DriverAssignment({ vehicleId }: { vehicleId: number }) {
  const storageKey = `teslasync-driver-${vehicleId}`
  const [driver, setDriver] = useState(() => localStorage.getItem(storageKey) ?? '')
  const [editing, setEditing] = useState(false)

  const save = (value: string) => {
    setDriver(value)
    localStorage.setItem(storageKey, value)
    setEditing(false)
  }

  return (
    <GlassPanel className="p-5">
      <h3 className="text-sm font-semibold mb-3 flex items-center gap-2" style={{ color: 'var(--text-primary)' }}>
        <User className="h-4 w-4 text-neon-cyan" /> Assigned Driver
      </h3>
      {editing ? (
        <div className="flex items-center gap-2">
          <input type="text" defaultValue={driver} autoFocus
            className="flex-1 px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-sm text-[var(--text-primary)] focus:outline-none focus:border-neon-cyan/40"
            onKeyDown={e => { if (e.key === 'Enter') save((e.target as HTMLInputElement).value) }}
            placeholder="Driver name" />
          <button onClick={() => { const input = document.querySelector('input[placeholder="Driver name"]') as HTMLInputElement; save(input?.value ?? '') }}
            className="glass-button text-xs">Save</button>
          <button onClick={() => setEditing(false)} className="text-xs text-[var(--text-muted)]">Cancel</button>
        </div>
      ) : (
        <div className="flex items-center gap-3">
          <span className="text-sm text-[var(--text-secondary)]">{driver || 'No driver assigned'}</span>
          <button onClick={() => setEditing(true)} className="text-xs text-neon-cyan hover:underline">
            {driver ? 'Change' : 'Assign'}
          </button>
        </div>
      )}
    </GlassPanel>
  )
}

function MaintenanceSchedule({ odometer }: { odometer: number }) {
  const items = [
    { name: 'Tire Rotation', intervalKm: 10000, icon: '🛞' },
    { name: 'Cabin Air Filter', intervalKm: 20000, icon: '🌬️' },
    { name: 'Brake Fluid Check', intervalKm: 40000, icon: '🛑' },
  ]

  return (
    <GlassPanel className="p-5">
      <h3 className="text-sm font-semibold mb-3 flex items-center gap-2" style={{ color: 'var(--text-primary)' }}>
        <Wrench className="h-4 w-4 text-neon-amber" /> Maintenance Schedule
      </h3>
      <div className="space-y-3">
        {items.map(item => {
          const currentCycleKm = odometer % item.intervalKm
          const dueInKm = item.intervalKm - currentCycleKm
          const overdue = dueInKm <= 0
          const nearDue = dueInKm < item.intervalKm * 0.1

          return (
            <div key={item.name} className="flex items-center gap-3 p-3 rounded-lg bg-white/[0.02] border border-white/[0.04]">
              <span className="text-lg">{item.icon}</span>
              <div className="flex-1">
                <p className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>{item.name}</p>
                <p className="text-[10px] text-[var(--text-muted)]">Every {(item.intervalKm / 1000).toFixed(0)}K km</p>
              </div>
              {overdue ? (
                <span className="flex items-center gap-1 px-2 py-1 rounded-full text-[10px] font-semibold bg-neon-red/10 text-neon-red">
                  <AlertCircle className="h-3 w-3" /> Overdue by {Math.abs(dueInKm).toFixed(0)} km
                </span>
              ) : (
                <span className={`px-2 py-1 rounded-full text-[10px] font-semibold ${nearDue ? 'bg-neon-amber/10 text-neon-amber' : 'bg-neon-green/10 text-neon-green'}`}>
                  Due in {dueInKm.toFixed(0)} km
                </span>
              )}
            </div>
          )
        })}
        {odometer > 0 && (
          <p className="text-[10px] text-[var(--text-muted)] text-center mt-2">Based on current odometer: {Math.round(odometer).toLocaleString()} km</p>
        )}
      </div>
    </GlassPanel>
  )
}

export default function VehicleDetail() {
  const { id } = useParams<{ id: string }>()
  const vehicleId = Number(id)

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

  const state = stateData?.state
  const status = vehicle ? getVehicleStatus(vehicle, state) : 'offline'
  const trail: LatLngExpression[] = positions
    ?.filter(p => p.latitude && p.longitude)
    .map(p => [p.latitude, p.longitude] as LatLngExpression) ?? []

  const batteryData = positions?.map(p => ({
    time: new Date(p.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    battery: p.battery_level,
    speed: p.speed ?? 0,
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
                      value={Math.round(state.rated_range)} max={600}
                      label="Range" unit="km"
                      color="#00f0ff" size={110}
                    />
                    <RadialGauge
                      value={state.speed} max={250}
                      label="Speed" unit="km/h"
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
                    <MetricBar value={state.rated_range} max={600} color="#00f0ff" label="Estimated Range" sublabel={`${Math.round(state.rated_range)} km`} />
                    {state.is_charging && (
                      <MetricBar value={state.charge_rate} max={state.charger_power || 100} color="#10b981" label="Charge Rate" sublabel={`${state.charge_rate} km/h added`} />
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
                sub={`${Math.round(state.rated_range)} km range`} />
            </StaggerItem>
            <StaggerItem>
              <InfoTile icon={Gauge} label="Speed" value={`${state.speed} km/h`}
                sub={state.speed > 0 ? 'Driving' : 'Parked'} />
            </StaggerItem>
            <StaggerItem>
              <InfoTile icon={Thermometer} label="Inside" value={`${state.inside_temp}°C`}
                sub={`Outside: ${state.outside_temp}°C`} />
            </StaggerItem>
            <StaggerItem>
              <InfoTile icon={Navigation} label="Odometer" value={`${Math.round(state.odometer).toLocaleString()} km`} />
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
                        <Area yAxisId="right" type="monotone" dataKey="speed" stroke="#00f0ff" fill="#00f0ff" fillOpacity={0.1} name="Speed km/h" />
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
                            <AnimatedNumber value={d.distance} decimals={1} suffix=" km" />
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

          {/* Driver Assignment */}
          <FadeIn delay={0.2}>
            <DriverAssignment vehicleId={vehicleId} />
          </FadeIn>

          {/* Maintenance Schedule */}
          <FadeIn delay={0.25}>
            <MaintenanceSchedule odometer={state?.odometer ?? 0} />
          </FadeIn>
        </>
      ) : (
        <FadeIn delay={0.1}>
          <GlassPanel className="p-12 text-center relative overflow-hidden">
            <div className="absolute inset-0 bg-gradient-to-br from-neon-cyan/[0.02] via-transparent to-neon-purple/[0.02]" />
            <div className="relative flex flex-col items-center">
              <VehicleModelSilhouette model={vehicle?.model} />
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
