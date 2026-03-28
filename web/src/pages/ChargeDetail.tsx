import { useParams, Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { getChargingSession, getVehicle } from '../api'
import {
  ArrowLeft, Zap, Clock, Battery, DollarSign, Gauge,
  BatteryCharging, Timer, TrendingUp, Cable, Activity,
  Plug, MapPin, ArrowUpRight,
} from 'lucide-react'
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
  ComposedChart, Line,
} from 'recharts'
import { GlassPanel, FadeIn, StaggerContainer, StaggerItem, Skeleton } from '../components/ui'
import { useSettings } from '../hooks/useSettings'
import { AnimatedNumber, RadialGauge, MetricBar } from '../components/Widgets'

function ChartTooltip({ active, payload, label }: { active?: boolean; payload?: Array<{ name: string; value: number; color: string; unit?: string }>; label?: string }) {
  if (!active || !payload?.length) return null
  return (
    <div className="glass-panel p-3 text-xs" style={{ background: 'var(--surface-2)', borderColor: 'var(--glass-border)' }}>
      <p style={{ color: 'var(--text-secondary)' }} className="mb-1">{label}</p>
      {payload.map(p => (
        <p key={p.name} style={{ color: 'var(--text-primary)' }}>
          <span style={{ color: p.color }}>●</span> {p.name}: {typeof p.value === 'number' ? p.value.toFixed(1) : p.value}
        </p>
      ))}
    </div>
  )
}

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
  const { convertDistance, distanceUnit } = useSettings()
  const { id } = useParams<{ id: string }>()
  const sessionId = Number(id)

  const { data: session } = useQuery({
    queryKey: ['charging-session', sessionId],
    queryFn: () => getChargingSession(sessionId),
  })

  const { data: vehicle } = useQuery({
    queryKey: ['vehicle', session?.vehicle_id],
    queryFn: () => getVehicle(session!.vehicle_id),
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
  const costPerKwh = session.cost && session.charge_energy_added > 0
    ? (session.cost / session.charge_energy_added).toFixed(2)
    : null

  // Charging efficiency
  const chargingEfficiency = session.charge_energy_used && session.charge_energy_added > 0
    ? ((session.charge_energy_added / session.charge_energy_used) * 100).toFixed(1)
    : null

  // Range gained
  const rangeGained = session.start_range_km != null && session.end_range_km != null
    ? session.end_range_km - session.start_range_km
    : null

  // Charge speed (kWh/h)
  const chargeSpeedKwhH = session.duration_min > 0
    ? (session.charge_energy_added / (session.duration_min / 60)).toFixed(1)
    : null

  // Is DC fast charging?
  const isDC = !!(session.fast_charger_type || (session.charger_power && session.charger_power > 22))

  // Generate charge curve
  const curvePoints = 30
  const chargeData = Array.from({ length: curvePoints }, (_, i) => {
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
              {vehicle?.display_name || 'Vehicle'} &middot; {new Date(session.start_date).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}
              {' '}&middot; {new Date(session.start_date).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              {session.end_date && ` → ${new Date(session.end_date).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`}
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
            <RadialGauge value={session.charger_power ?? 0} max={250} label="Peak Power" unit="kW" color="#a855f7" size={120} />
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
          <MetricBar value={session.start_battery_level} max={100} color="#f59e0b" label="Start" sublabel={`${session.start_battery_level}%`} />
          <div className="mt-3" />
          <MetricBar value={session.end_battery_level ?? session.start_battery_level} max={100} color="#10b981" label="End" sublabel={`${session.end_battery_level ?? '?'}%`} />
          <div className="mt-3 flex flex-wrap items-center justify-center gap-6 text-xs text-[var(--text-secondary)]">
            <span>+{batteryGain}% gained</span>
            <span>{session.charge_energy_added.toFixed(1)} kWh added</span>
            {rangeGained != null && <span className="text-neon-green">+{Math.round(convertDistance(rangeGained))} {distanceUnit} range</span>}
            {session.cost != null && <span className="text-neon-amber">${session.cost.toFixed(2)} cost</span>}
          </div>
        </GlassPanel>
      </FadeIn>

      {/* Stat cards — 2 rows */}
      <StaggerContainer className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-8">
        <StaggerItem><StatCard icon={Zap} color="#10b981" value={<AnimatedNumber value={session.charge_energy_added} decimals={1} suffix=" kWh" />} label="Energy Added" /></StaggerItem>
        <StaggerItem><StatCard icon={Clock} color="#f59e0b" value={`${Math.floor(session.duration_min / 60)}h ${Math.round(session.duration_min % 60)}m`} label="Duration" /></StaggerItem>
        <StaggerItem><StatCard icon={Gauge} color="#a855f7" value={`${session.charger_power ?? '—'} kW`} label="Peak Power" /></StaggerItem>
        <StaggerItem><StatCard icon={TrendingUp} color="#00f0ff" value={`${session.start_battery_level}% → ${session.end_battery_level ?? '?'}%`} label="SoC Range" /></StaggerItem>
        <StaggerItem><StatCard icon={DollarSign} color="#f59e0b" value={session.cost != null ? `$${session.cost.toFixed(2)}` : '—'} label="Total Cost" /></StaggerItem>
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
                {session.charge_energy_used != null ? `${session.charge_energy_used.toFixed(1)}` : '—'} <span className="text-xs text-[var(--text-muted)]">kWh</span>
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

      {/* Timestamps */}
      <FadeIn delay={0.18}>
        <GlassPanel className="p-4">
          <div className="flex items-center justify-between text-xs text-[var(--text-muted)]">
            <span>Started: {new Date(session.start_date).toLocaleString()}</span>
            {session.end_date && <span>Ended: {new Date(session.end_date).toLocaleString()}</span>}
          </div>
        </GlassPanel>
      </FadeIn>
    </div>
  )
}
