import { useParams, Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { getChargingSession, getChargeTelemetry, getVehicle } from '../api'
import { formatDate, formatTime, formatDateTime } from '../lib/dateFormat'
import {
  ArrowLeft, Zap, Clock, Battery, DollarSign, Gauge,
  BatteryCharging, Timer, TrendingUp, Cable, Activity,
  Plug, MapPin, ArrowUpRight, Thermometer, Navigation,
} from 'lucide-react'
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
  ComposedChart, Line,
} from 'recharts'
import { useState } from 'react'
import { MapContainer, CircleMarker, Popup } from 'react-leaflet'
import { MapTileLayer, MapInvalidator } from '../components/MapTileLayer'
import { MapLayerSwitcher } from '../components/MapLayerSwitcher'
import type { MapStyle } from '../components/MapTileLayer'
import { GlassPanel, FadeIn, StaggerContainer, StaggerItem, Skeleton } from '../components/ui'
import { useSettings } from '../hooks/useSettings'
import { AnimatedNumber, RadialGauge, MetricBar } from '../components/Widgets'
import { ChartTooltip } from '../components/Charts'
import { fmtNumber } from '../lib/numberFormat'

function StatCard({ icon: Icon, color, value, label }: { icon: typeof Zap; color: string; value: React.ReactNode; label: string }) {
  return (
    <GlassPanel className="p-4 text-center">
      <Icon className="h-4 w-4 mx-auto mb-1" style={{ color }} />
      <p className="text-lg font-bold text-[var(--text-primary)]">{value}</p>
      <p className="text-[10px] text-[var(--text-muted)]">{label}</p>
    </GlassPanel>
  )
}

export default function ChargeDetail() {
  const { convertDistance, convertTemp, distanceUnit, tempUnit } = useSettings()
  const { id } = useParams<{ id: string }>()
  const sessionId = Number(id)
  const [mapStyle, setMapStyle] = useState<MapStyle>('dark')

  const { data: session } = useQuery({
    queryKey: ['charging-session', sessionId],
    queryFn: () => getChargingSession(sessionId),
  })

  const { data: vehicle } = useQuery({
    queryKey: ['vehicle', session?.vehicle_id],
    queryFn: () => getVehicle(session!.vehicle_id),
    enabled: !!session,
  })

  const { data: chargeTelemetry } = useQuery({
    queryKey: ['charge-telemetry', sessionId],
    queryFn: () => getChargeTelemetry(sessionId),
    enabled: !!session,
  })

  if (!session) {
    return (
      <div className="space-y-6">
        <div className="flex items-center gap-4">
          <Skeleton className="h-10 w-10" />
          <div className="flex-1 space-y-2"><Skeleton className="h-7 w-48" /><Skeleton className="h-4 w-32" /></div>
        </div>
        <Skeleton className="h-36" />
        <Skeleton className="h-28" />
        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-3">
          {[1,2,3,4,5,6,7,8].map(i => <Skeleton key={i} className="h-24" />)}
        </div>
        <Skeleton className="h-48" />
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <Skeleton className="h-56 sm:h-80" /><Skeleton className="h-56 sm:h-80" />
        </div>
      </div>
    )
  }

  const batteryGain = (session.end_battery_level ?? session.start_battery_level) - session.start_battery_level
  
  // Compute cost from electricity rate if not set by backend
  const electricityRate = 0.12 // $/kWh default — TODO: read from geofence settings
  const estimatedCost = session.cost ?? (session.charge_energy_added > 0 ? session.charge_energy_added * electricityRate : null)
  
  const costPerKwh = estimatedCost && session.charge_energy_added > 0
    ? fmtNumber(estimatedCost / session.charge_energy_added, 3)
    : null

  // Charging efficiency
  const chargingEfficiency = session.charge_energy_used && session.charge_energy_added > 0
    ? fmtNumber((session.charge_energy_added / session.charge_energy_used) * 100)
    : null

  // Range gained
  const rangeGained = session.start_range_km != null && session.end_range_km != null
    ? session.end_range_km - session.start_range_km
    : null

  // Charge speed (kWh/h)
  const chargeSpeedKwhH = session.duration_min > 0
    ? fmtNumber(session.charge_energy_added / (session.duration_min / 60))
    : null

  // Is DC fast charging?
  const isDC = !!(session.fast_charger_type || (session.charger_power && session.charger_power > 22))

  // Generate charge curve — use real telemetry if available, otherwise synthesize
  const chargeData = chargeTelemetry && chargeTelemetry.length > 0
    ? chargeTelemetry.map((t, i) => {
        const timeMin = chargeTelemetry.length > 1
          ? ((new Date(t.created_at).getTime() - new Date(chargeTelemetry[0].created_at).getTime()) / 60000)
          : i * (session.duration_min / Math.max(chargeTelemetry.length - 1, 1))
        return {
          time: `${Math.floor(timeMin)}m`,
          battery: t.battery_level ?? t.soc ?? 0,
          power: t.power_kw ?? 0,
          energy: t.energy_added ?? 0,
          range: t.rated_range != null ? Math.round(convertDistance(t.rated_range)) : null,
        }
      })
    : (() => {
        const curvePoints = 30
        return Array.from({ length: curvePoints }, (_, i) => {
          const progress = i / (curvePoints - 1)
          const batteryAtPoint = session.start_battery_level + batteryGain * progress
          const maxPower = session.charger_power ?? 50
          const powerAtPoint = batteryAtPoint < 50
            ? maxPower
            : maxPower * Math.max(0.15, 1 - (batteryAtPoint - 50) / 80)
          const timeMin = progress * session.duration_min
          const rangeAtPoint = session.start_range_km != null && rangeGained != null
            ? session.start_range_km + rangeGained * progress
            : null
          return {
            time: `${Math.floor(timeMin)}m`,
            battery: Math.round(batteryAtPoint),
            power: Math.round(powerAtPoint * 10) / 10,
            energy: Math.round(session.charge_energy_added * progress * 10) / 10,
            range: rangeAtPoint != null ? Math.round(convertDistance(rangeAtPoint)) : null,
          }
        })
      })()

  return (
    <div className="space-y-6">
      {/* Header */}
      <FadeIn>
        <div className="flex items-center gap-4">
          <Link to="/charging" className="rounded-xl p-2.5 text-[var(--text-muted)] hover:bg-white/5 hover:text-[var(--text-primary)] transition-all">
            <ArrowLeft className="h-5 w-5" />
          </Link>
          <div className="flex-1">
            <h1 className="text-2xl font-bold tracking-tight text-[var(--text-primary)] flex items-center gap-3">
              <BatteryCharging className="h-6 w-6 text-neon-green" />
              Charge Session
            </h1>
            <p className="text-sm text-[var(--text-muted)] mt-0.5">
              {vehicle?.display_name || 'Vehicle'} &middot; {formatDate(session.start_date)}
              {' '}&middot; {formatTime(session.start_date)}
              {session.end_date && ` → ${formatTime(session.end_date)}`}
              {session.location_name && <> &middot; <MapPin className="h-3 w-3 inline" /> {session.location_name}</>}
            </p>
          </div>
          <div className="flex items-center gap-2">
            {session.fast_charger_type && (
              <span className="rounded-full border border-neon-green/20 bg-neon-green/5 px-3 py-1 text-xs font-medium text-neon-green">
                <Zap className="h-3 w-3 inline mr-1" />
                {session.fast_charger_type}
              </span>
            )}
            {session.fast_charger_brand && (
              <span className="rounded-full border border-neon-purple/20 bg-neon-purple/5 px-3 py-1 text-xs font-medium text-neon-purple">
                {session.fast_charger_brand}
              </span>
            )}
            <span className={`rounded-full border px-3 py-1 text-xs font-medium ${isDC ? 'border-neon-amber/20 bg-neon-amber/5 text-neon-amber' : 'border-blue-400/20 bg-blue-400/5 text-blue-400'}`}>
              {isDC ? 'DC' : 'AC'}
            </span>
          </div>
        </div>
      </FadeIn>

      {/* Hero gauges */}
      <FadeIn delay={0.05}>
        <GlassPanel className="p-6 relative overflow-hidden">
          <div className="absolute inset-0 bg-gradient-to-r from-neon-green/[0.02] to-neon-cyan/[0.02]" />
          <div className="relative flex flex-wrap items-center gap-6 lg:gap-10 justify-center">
            <RadialGauge value={session.charge_energy_added} max={Math.max(session.charge_energy_added * 1.5, 50)} label="Energy Added" unit="kWh" color="#10b981" size={120} />
            <RadialGauge value={session.end_battery_level ?? session.start_battery_level} max={100} label="End SoC" unit="%" color="#00f0ff" size={120} />
            <RadialGauge value={Math.round((session.charger_power ?? 0) * 100) / 100} max={250} label="Peak Power" unit="kW" color="#a855f7" size={120} />
            <RadialGauge value={session.duration_min} max={Math.max(session.duration_min * 1.5, 30)} label="Duration" unit="min" color="#f59e0b" size={120} />
            {chargingEfficiency && (
              <RadialGauge value={Number(chargingEfficiency)} max={100} label="Efficiency" unit="%" color="#06b6d4" size={120} />
            )}
          </div>
        </GlassPanel>
      </FadeIn>

      {/* Battery meter */}
      <FadeIn delay={0.08}>
        <GlassPanel className="p-5">
          <h3 className="section-title flex items-center gap-2 mb-4">
            <Battery className="h-4 w-4 text-neon-green" /> Battery Fill
          </h3>
          <MetricBar value={Math.round(session.start_battery_level)} max={100} color="#f59e0b" label="Start" sublabel={`${Math.round(session.start_battery_level)}%`} />
          <div className="mt-3" />
          <MetricBar value={Math.round(session.end_battery_level ?? session.start_battery_level)} max={100} color="#10b981" label="End" sublabel={`${session.end_battery_level != null ? Math.round(session.end_battery_level) : '?'}%`} />
          <div className="mt-3 flex flex-wrap items-center justify-center gap-6 text-xs text-[var(--text-secondary)]">
            <span>+{Math.round(batteryGain)}% gained</span>
            <span>{fmtNumber(session.charge_energy_added)} kWh added</span>
            {rangeGained != null && <span className="text-neon-green">+{Math.round(convertDistance(rangeGained))} {distanceUnit} range</span>}
            {estimatedCost != null && <span className="text-neon-amber">${fmtNumber(estimatedCost, 2)} cost</span>}
          </div>
        </GlassPanel>
      </FadeIn>

      {/* Stat cards — 2 rows */}
      <StaggerContainer className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-8">
        <StaggerItem><StatCard icon={Zap} color="#10b981" value={<AnimatedNumber value={session.charge_energy_added} decimals={1} suffix=" kWh" />} label="Energy Added" /></StaggerItem>
        <StaggerItem><StatCard icon={Clock} color="#f59e0b" value={`${Math.floor(session.duration_min / 60)}h ${Math.round(session.duration_min % 60)}m`} label="Duration" /></StaggerItem>
        <StaggerItem><StatCard icon={Gauge} color="#a855f7" value={session.charger_power != null ? `${fmtNumber(session.charger_power, 2)} kW` : '—'} label="Peak Power" /></StaggerItem>
        <StaggerItem><StatCard icon={TrendingUp} color="#00f0ff" value={`${session.start_battery_level}% → ${session.end_battery_level ?? '?'}%`} label="SoC Range" /></StaggerItem>
        <StaggerItem><StatCard icon={DollarSign} color="#f59e0b" value={estimatedCost != null ? `$${fmtNumber(estimatedCost, 2)}` : '—'} label="Total Cost" /></StaggerItem>
        <StaggerItem><StatCard icon={Timer} color="#6b7280" value={costPerKwh ? `$${costPerKwh}` : '—'} label="Per kWh" /></StaggerItem>
        <StaggerItem><StatCard icon={ArrowUpRight} color="#10b981" value={rangeGained != null ? `+${Math.round(convertDistance(rangeGained))} ${distanceUnit}` : '—'} label="Range Gained" /></StaggerItem>
        <StaggerItem><StatCard icon={Activity} color="#06b6d4" value={chargeSpeedKwhH ? `${chargeSpeedKwhH}` : '—'} label="kWh/h Avg" /></StaggerItem>
      </StaggerContainer>

      {/* More Details Section */}
      <FadeIn delay={0.1}>
        <GlassPanel className="p-5">
          <h3 className="section-title flex items-center gap-2 mb-4">
            <Activity className="h-4 w-4 text-neon-cyan" /> More Details
          </h3>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4">
            {/* Charger Specs */}
            <div className="text-center">
              <p className="text-[10px] text-[var(--text-muted)] mb-1">Charger Voltage</p>
              <p className="text-lg font-bold text-neon-cyan">
                {session.charger_voltage != null ? `${session.charger_voltage}` : '—'} <span className="text-xs text-[var(--text-muted)]">V</span>
              </p>
            </div>
            <div className="text-center">
              <p className="text-[10px] text-[var(--text-muted)] mb-1">Charger Current</p>
              <p className="text-lg font-bold text-neon-purple">
                {session.charger_actual_current != null ? `${session.charger_actual_current}` : '—'} <span className="text-xs text-[var(--text-muted)]">A</span>
              </p>
            </div>
            <div className="text-center">
              <p className="text-[10px] text-[var(--text-muted)] mb-1">Charger Phases</p>
              <p className="text-lg font-bold text-neon-amber">
                {session.charger_phases != null ? `${session.charger_phases}Ø` : '—'}
              </p>
            </div>
            <div className="text-center">
              <p className="text-[10px] text-[var(--text-muted)] mb-1">Range (Start → End)</p>
              <p className="text-lg font-bold text-neon-green">
                {session.start_range_km != null ? `${Math.round(convertDistance(session.start_range_km))} → ${session.end_range_km != null ? Math.round(convertDistance(session.end_range_km)) : '?'}` : '—'} <span className="text-xs text-[var(--text-muted)]">{distanceUnit}</span>
              </p>
            </div>
            <div className="text-center">
              <p className="text-[10px] text-[var(--text-muted)] mb-1">Charging Efficiency</p>
              <p className="text-lg font-bold text-neon-green">
                {chargingEfficiency ? `${chargingEfficiency}%` : '—'}
              </p>
            </div>
            <div className="text-center">
              <p className="text-[10px] text-[var(--text-muted)] mb-1">Energy Used (grid)</p>
              <p className="text-lg font-bold text-orange-400">
                {session.charge_energy_used != null ? `${fmtNumber(session.charge_energy_used)}` : '—'} <span className="text-xs text-[var(--text-muted)]">kWh</span>
              </p>
            </div>
          </div>
          {/* Cable & Charger Info */}
          {(session.conn_charge_cable || session.fast_charger_brand || session.fast_charger_type) && (
            <div className="mt-4 pt-4 border-t border-white/5 flex flex-wrap items-center justify-center gap-4 text-xs">
              {session.conn_charge_cable && (
                <span className="flex items-center gap-1.5 text-[var(--text-secondary)]">
                  <Cable className="h-3.5 w-3.5 text-neon-cyan" /> Cable: <strong className="text-[var(--text-primary)]">{session.conn_charge_cable}</strong>
                </span>
              )}
              {session.fast_charger_brand && (
                <span className="flex items-center gap-1.5 text-[var(--text-secondary)]">
                  <Plug className="h-3.5 w-3.5 text-neon-purple" /> Brand: <strong className="text-[var(--text-primary)]">{session.fast_charger_brand}</strong>
                </span>
              )}
              {session.fast_charger_type && (
                <span className="flex items-center gap-1.5 text-[var(--text-secondary)]">
                  <MapPin className="h-3.5 w-3.5 text-neon-green" /> Type: <strong className="text-[var(--text-primary)]">{session.fast_charger_type}</strong>
                </span>
              )}
              <span className="flex items-center gap-1.5 text-[var(--text-secondary)]">
                <Zap className="h-3.5 w-3.5" style={{ color: isDC ? '#f59e0b' : '#60a5fa' }} />
                <strong style={{ color: isDC ? '#f59e0b' : '#60a5fa' }}>{isDC ? 'DC Fast Charging' : 'AC Charging'}</strong>
              </span>
            </div>
          )}
        </GlassPanel>
      </FadeIn>

      {/* Charge Location */}
      {(session.latitude != null && session.longitude != null) && (
        <FadeIn delay={0.11}>
          <GlassPanel className="p-5">
            <h3 className="section-title flex items-center gap-2 mb-4">
              <Navigation className="h-4 w-4 text-neon-cyan" /> Charge Location
            </h3>
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
              {/* Map */}
              <div className="lg:col-span-2 h-56 sm:h-72 rounded-lg overflow-hidden border border-white/5 relative">
                <MapLayerSwitcher current={mapStyle} onChange={setMapStyle} />
                <MapContainer
                  center={[session.latitude!, session.longitude!]}
                  zoom={15}
                  scrollWheelZoom
                  className="h-full w-full"
                  style={{ background: '#0a0a0f' }}
                >
                  <MapTileLayer style={mapStyle} />
            <MapInvalidator />
                  <CircleMarker
                    center={[session.latitude!, session.longitude!]}
                    radius={10}
                    pathOptions={{ color: '#10b981', fillColor: '#10b981', fillOpacity: 0.8, weight: 3 }}
                  >
                    <Popup>
                      <div className="text-xs">
                        <strong>{session.location_name || 'Charge Location'}</strong>
                        <br />
                        {fmtNumber(session.latitude!, 5)}, {fmtNumber(session.longitude!, 5)}
                      </div>
                    </Popup>
                  </CircleMarker>
                </MapContainer>
              </div>

              {/* Address details */}
              <div className="flex flex-col gap-3">
                {/* Location name */}
                <div className="p-3 rounded-lg bg-white/[0.03] border border-white/5">
                  <p className="text-[10px] text-[var(--text-muted)] uppercase tracking-wider mb-1">Location</p>
                  <p className="text-sm font-semibold text-[var(--text-primary)] flex items-center gap-1.5">
                    <MapPin className="h-3.5 w-3.5 text-neon-green flex-shrink-0" />
                    {session.location_name || session.address?.display_name || 'Unknown'}
                  </p>
                </div>

                {/* Address breakdown */}
                {session.address && (
                  <>
                    {(session.address.road || session.address.house_number) && (
                      <div className="p-3 rounded-lg bg-white/[0.03] border border-white/5">
                        <p className="text-[10px] text-[var(--text-muted)] uppercase tracking-wider mb-1">Street</p>
                        <p className="text-sm text-[var(--text-primary)]">
                          {[session.address.house_number, session.address.road].filter(Boolean).join(' ')}
                        </p>
                      </div>
                    )}
                    {(session.address.city || session.address.state) && (
                      <div className="p-3 rounded-lg bg-white/[0.03] border border-white/5">
                        <p className="text-[10px] text-[var(--text-muted)] uppercase tracking-wider mb-1">City / State</p>
                        <p className="text-sm text-[var(--text-primary)]">
                          {[session.address.city, session.address.state].filter(Boolean).join(', ')}
                        </p>
                      </div>
                    )}
                    {(session.address.country || session.address.postcode) && (
                      <div className="p-3 rounded-lg bg-white/[0.03] border border-white/5">
                        <p className="text-[10px] text-[var(--text-muted)] uppercase tracking-wider mb-1">Country / Postal</p>
                        <p className="text-sm text-[var(--text-primary)]">
                          {[session.address.country, session.address.postcode].filter(Boolean).join(' · ')}
                        </p>
                      </div>
                    )}
                  </>
                )}

                {/* Coordinates */}
                <div className="p-3 rounded-lg bg-white/[0.03] border border-white/5">
                  <p className="text-[10px] text-[var(--text-muted)] uppercase tracking-wider mb-1">Coordinates</p>
                  <p className="text-xs font-mono text-[var(--text-secondary)]">
                    {fmtNumber(session.latitude!, 6)}, {fmtNumber(session.longitude!, 6)}
                  </p>
                </div>
              </div>
            </div>
          </GlassPanel>
        </FadeIn>
      )}

      {/* Charge Curve Charts */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Power vs SoC charging curve */}
        <FadeIn delay={0.12}>
          <GlassPanel className="p-6">
            <h3 className="section-title flex items-center gap-2 mb-4">
              <BatteryCharging className="h-4 w-4 text-neon-green" /> Charge Curve — Power vs SoC
            </h3>
            <div className="h-48 sm:h-64">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={chargeData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--glass-border)" strokeOpacity={0.4} />
                  <XAxis dataKey="battery" tick={{ fill: 'var(--text-muted)', fontSize: 10 }} label={{ value: 'Battery %', fill: 'var(--text-muted)', fontSize: 10, position: 'insideBottom', offset: -5 }} />
                  <YAxis tick={{ fill: 'var(--text-muted)', fontSize: 10 }} />
                  <Tooltip content={<ChartTooltip />} />
                  <Area type="monotone" dataKey="power" stroke="#a855f7" fill="#a855f7" fillOpacity={0.15} strokeWidth={2} name="Power kW" />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </GlassPanel>
        </FadeIn>

        {/* SoC, Energy & Range over Time */}
        <FadeIn delay={0.14}>
          <GlassPanel className="p-6">
            <h3 className="section-title flex items-center gap-2 mb-4">
              <Zap className="h-4 w-4 text-neon-cyan" /> SoC · Energy · Range over Time
            </h3>
            <div className="h-48 sm:h-64">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={chargeData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--glass-border)" strokeOpacity={0.4} />
                  <XAxis dataKey="time" tick={{ fill: 'var(--text-muted)', fontSize: 10 }} />
                  <YAxis yAxisId="left" domain={[0, 100]} tick={{ fill: 'var(--text-muted)', fontSize: 10 }} />
                  <YAxis yAxisId="right" orientation="right" tick={{ fill: 'var(--text-muted)', fontSize: 10 }} />
                  <Tooltip content={<ChartTooltip />} />
                  <Legend wrapperStyle={{ fontSize: 10, color: '#9ca3af' }} />
                  <Area yAxisId="left" type="monotone" dataKey="battery" stroke="#10b981" fill="#10b981" fillOpacity={0.1} strokeWidth={2} name="Battery %" />
                  <Line yAxisId="right" type="monotone" dataKey="energy" stroke="#00f0ff" strokeWidth={2} dot={false} name="Energy kWh" />
                  {chargeData.some(d => d.range !== null) && (
                    <Line yAxisId="right" type="monotone" dataKey="range" stroke="#f59e0b" strokeWidth={1.5} dot={false} name={`Range ${distanceUnit}`} strokeDasharray="4 2" />
                  )}
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          </GlassPanel>
        </FadeIn>
      </div>

      {/* Temperature during charge — telemetry-based chart */}
      {chargeTelemetry && chargeTelemetry.length > 1 && chargeTelemetry.some(t => t.battery_temp != null || t.inside_temp != null || t.outside_temp != null) && (
        <FadeIn delay={0.16}>
          <GlassPanel className="p-6">
            <h3 className="section-title flex items-center gap-2 mb-4">
              <Thermometer className="h-4 w-4 text-orange-400" /> Temperature During Charge
            </h3>
            <div className="h-48 sm:h-64">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={chargeTelemetry.map((t, i) => {
                  const timeMin = chargeTelemetry!.length > 1
                    ? ((new Date(t.created_at).getTime() - new Date(chargeTelemetry![0].created_at).getTime()) / 60000)
                    : i * (session.duration_min / Math.max(chargeTelemetry!.length - 1, 1))
                  return {
                    time: `${Math.floor(timeMin)}m`,
                    batteryTemp: t.battery_temp != null ? convertTemp(t.battery_temp) : null,
                    insideTemp: t.inside_temp != null ? convertTemp(t.inside_temp) : null,
                    outsideTemp: t.outside_temp != null ? convertTemp(t.outside_temp) : null,
                  }
                })}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--glass-border)" strokeOpacity={0.4} />
                  <XAxis dataKey="time" tick={{ fill: 'var(--text-muted)', fontSize: 10 }} />
                  <YAxis tick={{ fill: 'var(--text-muted)', fontSize: 10 }} />
                  <Tooltip content={<ChartTooltip />} />
                  <Legend wrapperStyle={{ fontSize: 10, color: '#9ca3af' }} />
                  {chargeTelemetry.some(t => t.battery_temp != null) && (
                    <Line type="monotone" dataKey="batteryTemp" stroke="#ef4444" strokeWidth={2} dot={false} name={`Battery ${tempUnit}`} connectNulls />
                  )}
                  {chargeTelemetry.some(t => t.inside_temp != null) && (
                    <Line type="monotone" dataKey="insideTemp" stroke="#f97316" strokeWidth={1.5} dot={false} name={`Inside ${tempUnit}`} connectNulls />
                  )}
                  {chargeTelemetry.some(t => t.outside_temp != null) && (
                    <Line type="monotone" dataKey="outsideTemp" stroke="#3b82f6" strokeWidth={1.5} dot={false} name={`Outside ${tempUnit}`} connectNulls />
                  )}
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          </GlassPanel>
        </FadeIn>
      )}

      {/* Voltage & Current over time */}
      {chargeTelemetry && chargeTelemetry.length > 1 && chargeTelemetry.some(t => t.voltage != null || t.current_amps != null) && (
        <FadeIn delay={0.18}>
          <GlassPanel className="p-6">
            <h3 className="section-title flex items-center gap-2 mb-4">
              <Activity className="h-4 w-4 text-neon-purple" /> Voltage & Current
            </h3>
            <div className="h-48 sm:h-64">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={chargeTelemetry.map((t, i) => {
                  const timeMin = chargeTelemetry!.length > 1
                    ? ((new Date(t.created_at).getTime() - new Date(chargeTelemetry![0].created_at).getTime()) / 60000)
                    : i * (session.duration_min / Math.max(chargeTelemetry!.length - 1, 1))
                  return {
                    time: `${Math.floor(timeMin)}m`,
                    voltage: t.voltage,
                    current: t.current_amps,
                  }
                })}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--glass-border)" strokeOpacity={0.4} />
                  <XAxis dataKey="time" tick={{ fill: 'var(--text-muted)', fontSize: 10 }} />
                  <YAxis yAxisId="voltage" tick={{ fill: 'var(--text-muted)', fontSize: 10 }} />
                  <YAxis yAxisId="current" orientation="right" tick={{ fill: 'var(--text-muted)', fontSize: 10 }} />
                  <Tooltip content={<ChartTooltip />} />
                  <Legend wrapperStyle={{ fontSize: 10, color: '#9ca3af' }} />
                  {chargeTelemetry.some(t => t.voltage != null) && (
                    <Line yAxisId="voltage" type="monotone" dataKey="voltage" stroke="#00f0ff" strokeWidth={2} dot={false} name="Voltage (V)" connectNulls />
                  )}
                  {chargeTelemetry.some(t => t.current_amps != null) && (
                    <Line yAxisId="current" type="monotone" dataKey="current" stroke="#f59e0b" strokeWidth={2} dot={false} name="Current (A)" connectNulls />
                  )}
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          </GlassPanel>
        </FadeIn>
      )}

      {/* Temperature summary (fallback when no telemetry) */}
      {(!chargeTelemetry || chargeTelemetry.length < 2 || !chargeTelemetry.some(t => t.battery_temp != null || t.inside_temp != null)) &&
        (session.inside_temp_avg != null || session.outside_temp_avg != null) && (
        <FadeIn delay={0.16}>
          <GlassPanel className="p-4">
            <div className="flex items-center justify-center gap-6 text-sm">
              <Thermometer className="h-4 w-4 text-neon-cyan" />
              {session.inside_temp_avg != null && (
                <span className="text-[var(--text-secondary)]">
                  Inside: <strong className="text-orange-400">{fmtNumber(convertTemp(session.inside_temp_avg))} {tempUnit}</strong>
                </span>
              )}
              {session.outside_temp_avg != null && (
                <span className="text-[var(--text-secondary)]">
                  Outside: <strong className="text-blue-400">{fmtNumber(convertTemp(session.outside_temp_avg))} {tempUnit}</strong>
                </span>
              )}
            </div>
          </GlassPanel>
        </FadeIn>
      )}

      {/* Timestamps */}
      <FadeIn delay={0.18}>
        <GlassPanel className="p-4">
          <div className="flex items-center justify-between text-xs text-[var(--text-muted)]">
            <span>Started: {formatDateTime(session.start_date)}</span>
            {session.end_date && <span>Ended: {formatDateTime(session.end_date)}</span>}
          </div>
        </GlassPanel>
      </FadeIn>
    </div>
  )
}

