import { useState, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { getVehicles, getMotorData, getMotorLatest } from '../api'
import { PageHeader, GlassPanel, FadeIn, Skeleton } from '../components/ui'
import { Activity, Gauge, Thermometer, Zap, Circle, ArrowUp, ArrowDown, Disc } from 'lucide-react'
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Legend, AreaChart, Area,
} from 'recharts'
import clsx from 'clsx'
import { useSettings } from '../hooks/useSettings'
import { fmtNumber, fmtInt } from '../lib/numberFormat'
import { parseGear, GEAR_COLORS } from '../lib/gear'

/* ---------- Tooltip ---------- */
interface DynamicsTooltipPayload { name: string; value: number; color?: string; fill?: string; stroke?: string }
function DynamicsTooltip({ active, payload, label, unit }: { active?: boolean; payload?: DynamicsTooltipPayload[]; label?: string; unit?: string }) {
  if (!active || !payload?.length) return null
  return (
    <div className="glass-panel p-3 text-xs" style={{ background: 'var(--surface-2)', borderColor: 'var(--glass-border)' }}>
      <p style={{ color: 'var(--text-secondary)' }} className="mb-1">{label}</p>
      {payload.map(p => (
        <p key={p.name} style={{ color: 'var(--text-primary)' }}>
          <span style={{ color: p.color || p.fill || p.stroke }}>●</span> {p.name}: {typeof p.value === 'number' ? fmtNumber(p.value, 2) : p.value}{unit ? ` ${unit}` : ''}
        </p>
      ))}
    </div>
  )
}

/* ---------- Circular Gauge ---------- */
function CircularGauge({ value, min, max, label, unit, color }: {
  value: number | undefined; min: number; max: number; label: string; unit: string; color: string
}) {
  const v = value ?? 0
  const range = max - min
  const pct = Math.min(100, Math.max(0, ((v - min) / range) * 100))
  const hasData = value !== undefined && value !== null

  return (
    <div className="glass-card p-4 sm:p-5 flex flex-col items-center gap-3">
      <p className="text-xs font-medium uppercase tracking-wider" style={{ color: 'var(--text-secondary)' }}>{label}</p>
      <div className="relative w-24 h-24 flex items-center justify-center">
        <svg className="absolute inset-0 w-full h-full -rotate-90" viewBox="0 0 100 100">
          <circle cx="50" cy="50" r="42" fill="none" stroke="currentColor" strokeWidth="6" className="text-white/5" />
          <circle cx="50" cy="50" r="42" fill="none" stroke="currentColor" strokeWidth="6"
            strokeDasharray={`${pct * 2.64} 264`} strokeLinecap="round" className={color} />
        </svg>
        <span className={clsx('text-2xl font-bold', color)}>
          {hasData ? (Math.abs(v) >= 100 ? fmtInt(v) : fmtNumber(v)) : '--'}
        </span>
      </div>
      <span className={clsx('text-[10px] px-2 py-0.5 rounded-full font-medium', `${color.replace('text-', 'bg-')}/20`, color)}>
        {hasData ? `${fmtNumber(v)} ${unit}` : 'N/A'}
      </span>
    </div>
  )
}

/* ---------- G-Force Dot Visualization ---------- */
function GForceDot({ latG, lonG }: { latG: number; lonG: number }) {
  const clamp = (v: number) => Math.max(-1, Math.min(1, v))
  const cx = 50 + clamp(latG) * 40
  const cy = 50 - clamp(lonG) * 40

  return (
    <svg viewBox="0 0 100 100" className="w-full h-full" style={{ maxWidth: 200, maxHeight: 200 }}>
      {/* Background rings */}
      <circle cx="50" cy="50" r="40" fill="none" stroke="var(--glass-border)" strokeWidth="0.5" />
      <circle cx="50" cy="50" r="26.67" fill="none" stroke="var(--glass-border)" strokeWidth="0.3" strokeDasharray="2 2" />
      <circle cx="50" cy="50" r="13.33" fill="none" stroke="var(--glass-border)" strokeWidth="0.3" strokeDasharray="2 2" />
      {/* Crosshairs */}
      <line x1="10" y1="50" x2="90" y2="50" stroke="var(--glass-border)" strokeWidth="0.3" />
      <line x1="50" y1="10" x2="50" y2="90" stroke="var(--glass-border)" strokeWidth="0.3" />
      {/* Labels */}
      <text x="50" y="8" textAnchor="middle" fontSize="4" fill="var(--text-muted)">ACCEL</text>
      <text x="50" y="96" textAnchor="middle" fontSize="4" fill="var(--text-muted)">BRAKE</text>
      <text x="6" y="51" textAnchor="middle" fontSize="4" fill="var(--text-muted)">L</text>
      <text x="94" y="51" textAnchor="middle" fontSize="4" fill="var(--text-muted)">R</text>
      {/* G dot */}
      <circle cx={cx} cy={cy} r="4" fill="#00f0ff" opacity="0.8">
        <animate attributeName="opacity" values="0.6;1;0.6" dur="1.5s" repeatCount="indefinite" />
      </circle>
      <circle cx={cx} cy={cy} r="6" fill="none" stroke="#00f0ff" strokeWidth="0.5" opacity="0.4">
        <animate attributeName="r" values="4;10" dur="2s" repeatCount="indefinite" />
        <animate attributeName="opacity" values="0.4;0" dur="2s" repeatCount="indefinite" />
      </circle>
      {/* Scale labels */}
      <text x="92" y="48" textAnchor="end" fontSize="3" fill="var(--text-muted)">1g</text>
      <text x="70" y="48" textAnchor="end" fontSize="3" fill="var(--text-muted)">0.5g</text>
    </svg>
  )
}

/* ---------- Stat Card ---------- */
function StatCard({ label, value, unit, icon, color }: {
  label: string; value: string | number; unit?: string; icon: React.ReactNode; color: string
}) {
  return (
    <div className="glass-card p-4 sm:p-5">
      <div className="flex items-center gap-2 mb-2">
        <span className={color}>{icon}</span>
        <p className="text-xs font-medium uppercase tracking-wider" style={{ color: 'var(--text-secondary)' }}>{label}</p>
      </div>
      <p className={clsx('text-2xl font-bold', color)}>
        {value}{unit && <span className="text-sm font-normal ml-1" style={{ color: 'var(--text-muted)' }}>{unit}</span>}
      </p>
    </div>
  )
}

/* ========== MAIN COMPONENT ========== */
export default function DrivingDynamics() {
  const { convertSpeed, convertTemp, speedUnit, tempUnit } = useSettings()
  const { data: vehicles } = useQuery({ queryKey: ['vehicles'], queryFn: getVehicles })
  const [selectedVehicle, setSelectedVehicle] = useState<number | null>(null)
  const [limit] = useState(100)
  const vehicleId = selectedVehicle ?? vehicles?.[0]?.id ?? null

  /* --- Queries --- */
  const { data: motorData, isLoading: loadingHistory } = useQuery({
    queryKey: ['motor', vehicleId, limit],
    queryFn: () => getMotorData(vehicleId!, limit),
    enabled: !!vehicleId,
    refetchInterval: 5000,
  })

  const { data: latest, isLoading: loadingLatest } = useQuery({
    queryKey: ['motor-latest', vehicleId],
    queryFn: () => getMotorLatest(vehicleId!),
    enabled: !!vehicleId,
    refetchInterval: 3000,
  })

  /* --- Derived chart data --- */
  const history = motorData ?? []

  const torqueChartData = useMemo(() =>
    history.slice().reverse().map(s => ({
      time: new Date(s.created_at).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
      torque: s.di_torque ?? 0,
    })),
    [history],
  )

  const gForceChartData = useMemo(() =>
    history.slice().reverse().map(s => ({
      time: new Date(s.created_at).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
      lateral: s.lateral_accel ?? 0,
      longitudinal: s.longitudinal_accel ?? 0,
    })),
    [history],
  )

  const speedChartData = useMemo(() =>
    history.slice().reverse().map(s => ({
      time: new Date(s.created_at).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
      speed: s.vehicle_speed !== undefined ? convertSpeed(s.vehicle_speed) : 0,
    })),
    [history, convertSpeed],
  )

  /* --- Aggregate stats --- */
  const stats = useMemo(() => {
    if (!history.length) return null
    const torques = history.filter(s => s.di_torque !== undefined).map(s => s.di_torque!)
    const latGs = history.filter(s => s.lateral_accel !== undefined).map(s => s.lateral_accel!)
    const lonGs = history.filter(s => s.longitudinal_accel !== undefined).map(s => s.longitudinal_accel!)
    const pedals = history.filter(s => s.pedal_position !== undefined).map(s => s.pedal_position!)
    const temps = history.filter(s => s.di_stator_temp !== undefined).map(s => s.di_stator_temp!)
    const speeds = history.filter(s => s.vehicle_speed !== undefined).map(s => s.vehicle_speed!)
    const gears = history.filter(s => s.gear !== undefined).map(s => s.gear!)

    const avg = (arr: number[]) => arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0
    const max = (arr: number[]) => arr.length ? Math.max(...arr) : 0
    const min = (arr: number[]) => arr.length ? Math.min(...arr) : 0

    const gearCounts: Record<string, number> = {}
    gears.forEach(g => { gearCounts[g] = (gearCounts[g] || 0) + 1 })

    return {
      totalReadings: history.length,
      avgTorque: avg(torques),
      maxTorque: max(torques),
      minTorque: min(torques),
      maxLatG: max(latGs.map(Math.abs)),
      maxLonG: max(lonGs.map(Math.abs)),
      peakLatG: max(latGs),
      peakLatGNeg: min(latGs),
      peakLonG: max(lonGs),
      peakLonGNeg: min(lonGs),
      avgPedal: avg(pedals),
      avgTemp: avg(temps),
      maxTemp: max(temps),
      avgSpeed: avg(speeds),
      maxSpeed: max(speeds),
      gearCounts,
    }
  }, [history])

  /* --- Motor state badge --- */
  const motorStateBadge = (state?: string) => {
    if (!state) return { text: 'Unknown', color: 'text-[var(--text-muted)]', bg: 'bg-white/5' }
    const s = state.toLowerCase()
    if (s === 'enabled' || s === 'active' || s === 'running') return { text: 'Enabled', color: 'text-neon-green', bg: 'bg-neon-green/20' }
    if (s === 'standby' || s === 'idle') return { text: 'Standby', color: 'text-neon-amber', bg: 'bg-neon-amber/20' }
    return { text: 'Disabled', color: 'text-neon-red', bg: 'bg-neon-red/20' }
  }

  /* --- Gear badge --- */
  const gearBadge = (gear?: string) => {
    const parsed = parseGear(gear)
    if (!parsed) return { text: '--', color: 'text-[var(--text-muted)]' }
    return { text: parsed, color: GEAR_COLORS[parsed] ?? 'text-[var(--text-primary)]' }
  }

  const badge = motorStateBadge(latest?.di_state)
  const gear = gearBadge(latest?.gear)

  return (
    <FadeIn>
      {/* ===== Header & Vehicle Selector ===== */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 sm:gap-0 mb-6 sm:mb-8">
        <PageHeader
          title="Driving Dynamics"
          subtitle="Motor performance, acceleration patterns, and drivetrain telemetry"
          icon={<Activity className="h-7 w-7 text-neon-cyan" />}
        />
        {vehicles && vehicles.length > 1 && (
          <select
            value={vehicleId ?? ''}
            onChange={e => setSelectedVehicle(Number(e.target.value))}
            className="glass-card px-3 py-2 text-sm rounded-lg border-0 focus:ring-1 focus:ring-neon-cyan/50"
            style={{ background: 'var(--surface-2)', color: 'var(--text-primary)' }}
          >
            {vehicles.map(v => <option key={v.id} value={v.id}>{v.display_name || v.vin}</option>)}
          </select>
        )}
      </div>

      {/* ===== Empty state ===== */}
      {!loadingLatest && !loadingHistory && !latest && history.length === 0 && (
        <GlassPanel className="p-8 text-center">
          <Activity className="h-12 w-12 mx-auto mb-4" style={{ color: 'var(--text-muted)' }} />
          <p className="text-lg font-medium" style={{ color: 'var(--text-primary)' }}>No motor data available</p>
          <p className="text-sm mt-1" style={{ color: 'var(--text-muted)' }}>Motor telemetry will appear here once data is recorded.</p>
        </GlassPanel>
      )}

      {/* ===== Section 1: Live Motor Status (4 gauges) ===== */}
      <h3 className="text-sm font-semibold mb-3 uppercase tracking-wider" style={{ color: 'var(--text-secondary)' }}>
        Live Motor Status
      </h3>
      {loadingLatest ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4 mb-6 sm:mb-8">
          {[1, 2, 3, 4].map(i => <Skeleton key={i} className="h-48 rounded-xl" />)}
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4 mb-6 sm:mb-8">
          <CircularGauge
            label="Motor Torque"
            value={latest?.di_torque}
            min={-500} max={500}
            unit="Nm"
            color="text-neon-cyan"
          />
          <CircularGauge
            label="Motor Speed"
            value={latest?.di_axle_speed}
            min={0} max={18000}
            unit="RPM"
            color="text-neon-green"
          />
          <CircularGauge
            label="Stator Temp"
            value={latest?.di_stator_temp !== undefined ? convertTemp(latest.di_stator_temp) : undefined}
            min={0} max={isTempFahrenheit(tempUnit) ? 392 : 200}
            unit={tempUnit}
            color="text-neon-amber"
          />
          {/* Motor State card */}
          <div className="glass-card p-4 sm:p-5 flex flex-col items-center gap-3">
            <p className="text-xs font-medium uppercase tracking-wider" style={{ color: 'var(--text-secondary)' }}>Motor State</p>
            <div className="relative w-24 h-24 flex items-center justify-center">
              <Zap className={clsx('h-10 w-10', badge.color)} />
            </div>
            <span className={clsx('text-sm px-3 py-1 rounded-full font-semibold', badge.bg, badge.color)}>
              {badge.text}
            </span>
          </div>
        </div>
      )}

      {/* ===== Section 2: Acceleration G-Force Panel ===== */}
      <h3 className="text-sm font-semibold mb-3 uppercase tracking-wider" style={{ color: 'var(--text-secondary)' }}>
        Acceleration G-Force
      </h3>
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3 sm:gap-4 mb-6 sm:mb-8">
        {/* Lateral & Longitudinal G stats */}
        <div className="glass-card p-4 sm:p-5 flex flex-col gap-4">
          <div>
            <p className="text-xs font-medium uppercase tracking-wider mb-1" style={{ color: 'var(--text-secondary)' }}>Lateral G</p>
            <p className="text-3xl font-bold text-neon-amber">
              {latest?.lateral_accel !== undefined ? fmtNumber(latest.lateral_accel, 3) : '--'}
              <span className="text-sm font-normal ml-1" style={{ color: 'var(--text-muted)' }}>g</span>
            </p>
            {stats && (
              <div className="flex gap-3 mt-2 text-xs" style={{ color: 'var(--text-muted)' }}>
                <span>Peak L: {fmtNumber(stats.peakLatGNeg, 3)}g</span>
                <span>Peak R: {fmtNumber(stats.peakLatG, 3)}g</span>
              </div>
            )}
          </div>
          <div>
            <p className="text-xs font-medium uppercase tracking-wider mb-1" style={{ color: 'var(--text-secondary)' }}>Longitudinal G</p>
            <p className="text-3xl font-bold text-neon-cyan">
              {latest?.longitudinal_accel !== undefined ? fmtNumber(latest.longitudinal_accel, 3) : '--'}
              <span className="text-sm font-normal ml-1" style={{ color: 'var(--text-muted)' }}>g</span>
            </p>
            {stats && (
              <div className="flex gap-3 mt-2 text-xs" style={{ color: 'var(--text-muted)' }}>
                <span>Peak Brake: {fmtNumber(stats.peakLonGNeg, 3)}g</span>
                <span>Peak Accel: {fmtNumber(stats.peakLonG, 3)}g</span>
              </div>
            )}
          </div>
        </div>
        {/* G-Force Dot visualization */}
        <GlassPanel className="p-4 sm:p-5 flex flex-col items-center justify-center">
          <p className="text-xs font-medium uppercase tracking-wider mb-2" style={{ color: 'var(--text-secondary)' }}>G-Force Vector</p>
          <GForceDot
            latG={latest?.lateral_accel ?? 0}
            lonG={latest?.longitudinal_accel ?? 0}
          />
        </GlassPanel>
        {/* Peak G summary */}
        <div className="glass-card p-4 sm:p-5 flex flex-col gap-3">
          <p className="text-xs font-medium uppercase tracking-wider" style={{ color: 'var(--text-secondary)' }}>Peak G-Forces</p>
          {stats ? (
            <div className="space-y-3 flex-1 flex flex-col justify-center">
              <div className="flex items-center justify-between">
                <span className="text-xs" style={{ color: 'var(--text-muted)' }}>Max Lateral</span>
                <span className="text-sm font-bold text-neon-amber">{fmtNumber(stats.maxLatG, 3)}g</span>
              </div>
              <div className="w-full h-1.5 rounded-full bg-white/5">
                <div className="h-full rounded-full bg-neon-amber/60" style={{ width: `${Math.min(100, stats.maxLatG * 100)}%` }} />
              </div>
              <div className="flex items-center justify-between">
                <span className="text-xs" style={{ color: 'var(--text-muted)' }}>Max Longitudinal</span>
                <span className="text-sm font-bold text-neon-cyan">{fmtNumber(stats.maxLonG, 3)}g</span>
              </div>
              <div className="w-full h-1.5 rounded-full bg-white/5">
                <div className="h-full rounded-full bg-neon-cyan/60" style={{ width: `${Math.min(100, stats.maxLonG * 100)}%` }} />
              </div>
              <div className="flex items-center justify-between mt-2">
                <span className="text-xs" style={{ color: 'var(--text-muted)' }}>Combined Peak</span>
                <span className="text-sm font-bold text-neon-green">
                  {fmtNumber(Math.sqrt(stats.maxLatG ** 2 + stats.maxLonG ** 2), 3)}g
                </span>
              </div>
            </div>
          ) : (
            <p className="text-xs" style={{ color: 'var(--text-muted)' }}>No data</p>
          )}
        </div>
      </div>

      {/* ===== Section 3: Pedal Usage ===== */}
      <h3 className="text-sm font-semibold mb-3 uppercase tracking-wider" style={{ color: 'var(--text-secondary)' }}>
        Pedal Usage
      </h3>
      {loadingLatest ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4 mb-6 sm:mb-8">
          {[1, 2].map(i => <Skeleton key={i} className="h-48 rounded-xl" />)}
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4 mb-6 sm:mb-8">
          <CircularGauge
            label="Throttle Position"
            value={latest?.pedal_position}
            min={0} max={100}
            unit="%"
            color="text-neon-green"
          />
          <div className="glass-card p-4 sm:p-5 flex flex-col items-center gap-3">
            <p className="text-xs font-medium uppercase tracking-wider" style={{ color: 'var(--text-secondary)' }}>Brake Pedal</p>
            <div className="relative w-24 h-24 flex items-center justify-center">
              {latest?.brake_pedal ? (
                <div className="w-16 h-16 rounded-full bg-neon-red/20 flex items-center justify-center border-2 border-neon-red">
                  <ArrowDown className="h-8 w-8 text-neon-red" />
                </div>
              ) : (
                <div className="w-16 h-16 rounded-full bg-white/5 flex items-center justify-center border-2 border-white/10">
                  <Circle className="h-8 w-8" style={{ color: 'var(--text-muted)' }} />
                </div>
              )}
            </div>
            <span className={clsx(
              'text-sm px-3 py-1 rounded-full font-semibold',
              latest?.brake_pedal ? 'bg-neon-red/20 text-neon-red' : 'bg-white/5 text-[var(--text-muted)]',
            )}>
              {latest?.brake_pedal ? 'Active' : 'Inactive'}
            </span>
          </div>
        </div>
      )}

      {/* ===== Section 4: Speed & Gear ===== */}
      <h3 className="text-sm font-semibold mb-3 uppercase tracking-wider" style={{ color: 'var(--text-secondary)' }}>
        Speed & Gear
      </h3>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4 mb-6 sm:mb-8">
        {/* Current speed */}
        <div className="glass-card p-4 sm:p-5 flex flex-col items-center gap-3">
          <p className="text-xs font-medium uppercase tracking-wider" style={{ color: 'var(--text-secondary)' }}>Current Speed</p>
          <p className="text-5xl font-bold text-neon-cyan">
            {latest?.vehicle_speed !== undefined ? fmtInt(convertSpeed(latest.vehicle_speed)) : '--'}
          </p>
          <span className="text-sm" style={{ color: 'var(--text-muted)' }}>{speedUnit}</span>
        </div>
        {/* Current gear */}
        <div className="glass-card p-4 sm:p-5 flex flex-col items-center gap-3">
          <p className="text-xs font-medium uppercase tracking-wider" style={{ color: 'var(--text-secondary)' }}>Current Gear</p>
          <div className="flex gap-2 mt-2">
            {['P', 'R', 'N', 'D'].map(g => {
              const isActive = gear.text === g
              const gColor = g === 'D' ? 'text-neon-green' : g === 'R' ? 'text-neon-red' : g === 'P' ? 'text-neon-cyan' : 'text-neon-amber'
              return (
                <div
                  key={g}
                  className={clsx(
                    'w-12 h-12 rounded-lg flex items-center justify-center text-lg font-bold transition-all',
                    isActive ? `${gColor} ${gColor.replace('text-', 'bg-')}/20 border border-current` : 'text-white/20 bg-white/5',
                  )}
                >
                  {g}
                </div>
              )
            })}
          </div>
          <span className={clsx('text-sm font-semibold', gear.color)}>{gear.text === '--' ? 'No data' : gear.text}</span>
        </div>
        {/* Speed stats */}
        <div className="glass-card p-4 sm:p-5 flex flex-col gap-3">
          <p className="text-xs font-medium uppercase tracking-wider" style={{ color: 'var(--text-secondary)' }}>Speed Stats</p>
          {stats ? (
            <div className="space-y-2 flex-1 flex flex-col justify-center">
              <div className="flex items-center justify-between">
                <span className="text-xs" style={{ color: 'var(--text-muted)' }}>Average</span>
                <span className="text-sm font-bold text-neon-cyan">{fmtNumber(convertSpeed(stats.avgSpeed))} {speedUnit}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-xs" style={{ color: 'var(--text-muted)' }}>Maximum</span>
                <span className="text-sm font-bold text-neon-green">{fmtNumber(convertSpeed(stats.maxSpeed))} {speedUnit}</span>
              </div>
              <div className="mt-2 pt-2 border-t border-white/5">
                <p className="text-xs mb-1" style={{ color: 'var(--text-muted)' }}>Time in Gear</p>
                {Object.entries(stats.gearCounts).map(([g, count]) => (
                  <div key={g} className="flex items-center justify-between text-xs">
                    <span style={{ color: 'var(--text-muted)' }}>{g}</span>
                    <span style={{ color: 'var(--text-primary)' }}>{count} readings ({fmtInt(((count / stats.totalReadings) * 100))}%)</span>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <p className="text-xs" style={{ color: 'var(--text-muted)' }}>No data</p>
          )}
        </div>
      </div>

      {/* ===== Speed Over Time Chart ===== */}
      <GlassPanel className="p-4 sm:p-6 mb-6 sm:mb-8">
        <h3 className="text-sm font-semibold mb-4" style={{ color: 'var(--text-primary)' }}>Speed Over Time</h3>
        {loadingHistory ? <Skeleton className="h-72 rounded-xl" /> : speedChartData.length === 0 ? (
          <div className="flex items-center justify-center h-72 text-[var(--text-muted)] text-sm">No speed data available</div>
        ) : (
          <ResponsiveContainer width="100%" height={300}>
            <AreaChart data={speedChartData}>
              <defs>
                <linearGradient id="speedGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#00f0ff" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="#00f0ff" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--glass-border)" strokeOpacity={0.5} />
              <XAxis dataKey="time" tick={{ fontSize: 10, fill: 'var(--text-muted)' }} />
              <YAxis tick={{ fontSize: 10, fill: 'var(--text-muted)' }} />
              <Tooltip content={<DynamicsTooltip unit={speedUnit} />} />
              <Area type="monotone" dataKey="speed" name="Speed" stroke="#00f0ff" strokeWidth={2} fill="url(#speedGradient)" />
            </AreaChart>
          </ResponsiveContainer>
        )}
      </GlassPanel>

      {/* ===== Motor Torque History Chart ===== */}
      <GlassPanel className="p-4 sm:p-6 mb-6 sm:mb-8">
        <h3 className="text-sm font-semibold mb-4" style={{ color: 'var(--text-primary)' }}>Motor Torque History</h3>
        {loadingHistory ? <Skeleton className="h-72 rounded-xl" /> : torqueChartData.length === 0 ? (
          <div className="flex items-center justify-center h-72 text-[var(--text-muted)] text-sm">No torque data available</div>
        ) : (
          <ResponsiveContainer width="100%" height={300}>
            <LineChart data={torqueChartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--glass-border)" strokeOpacity={0.5} />
              <XAxis dataKey="time" tick={{ fontSize: 10, fill: 'var(--text-muted)' }} />
              <YAxis tick={{ fontSize: 10, fill: 'var(--text-muted)' }} />
              <Tooltip content={<DynamicsTooltip unit="Nm" />} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Line type="monotone" dataKey="torque" name="Torque" stroke="#00f0ff" strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        )}
      </GlassPanel>

      {/* ===== G-Force History Chart ===== */}
      <GlassPanel className="p-4 sm:p-6 mb-6 sm:mb-8">
        <h3 className="text-sm font-semibold mb-4" style={{ color: 'var(--text-primary)' }}>G-Force History</h3>
        {loadingHistory ? <Skeleton className="h-72 rounded-xl" /> : gForceChartData.length === 0 ? (
          <div className="flex items-center justify-center h-72 text-[var(--text-muted)] text-sm">No acceleration data available</div>
        ) : (
          <ResponsiveContainer width="100%" height={300}>
            <LineChart data={gForceChartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--glass-border)" strokeOpacity={0.5} />
              <XAxis dataKey="time" tick={{ fontSize: 10, fill: 'var(--text-muted)' }} />
              <YAxis tick={{ fontSize: 10, fill: 'var(--text-muted)' }} />
              <Tooltip content={<DynamicsTooltip unit="g" />} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Line type="monotone" dataKey="lateral" name="Lateral G" stroke="#f59e0b" strokeWidth={2} dot={false} />
              <Line type="monotone" dataKey="longitudinal" name="Longitudinal G" stroke="#00f0ff" strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        )}
      </GlassPanel>

      {/* ===== Speed Distribution / Motor Insights ===== */}
      <h3 className="text-sm font-semibold mb-3 uppercase tracking-wider" style={{ color: 'var(--text-secondary)' }}>
        Motor Efficiency Insights
      </h3>
      {stats ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4 mb-6 sm:mb-8">
          <div className="glass-card p-4 sm:p-5">
            <p className="text-xs font-medium uppercase tracking-wider mb-3" style={{ color: 'var(--text-secondary)' }}>Torque Distribution</p>
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs" style={{ color: 'var(--text-muted)' }}>Average Torque</span>
                <span className="text-sm font-bold text-neon-cyan">{fmtNumber(stats.avgTorque)} Nm</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-xs" style={{ color: 'var(--text-muted)' }}>Max Torque</span>
                <span className="text-sm font-bold text-neon-green">{fmtNumber(stats.maxTorque)} Nm</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-xs" style={{ color: 'var(--text-muted)' }}>Max Regen</span>
                <span className="text-sm font-bold text-neon-amber">{fmtNumber(stats.minTorque)} Nm</span>
              </div>
            </div>
          </div>
          <div className="glass-card p-4 sm:p-5">
            <p className="text-xs font-medium uppercase tracking-wider mb-3" style={{ color: 'var(--text-secondary)' }}>Throttle Behavior</p>
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs" style={{ color: 'var(--text-muted)' }}>Avg Pedal Position</span>
                <span className="text-sm font-bold text-neon-green">{fmtNumber(stats.avgPedal)}%</span>
              </div>
              <div className="w-full h-2 rounded-full bg-white/5 mt-1">
                <div className="h-full rounded-full bg-neon-green/60" style={{ width: `${stats.avgPedal}%` }} />
              </div>
              <p className="text-xs mt-2" style={{ color: 'var(--text-muted)' }}>
                {stats.avgPedal < 20 ? 'Conservative driving style' :
                  stats.avgPedal < 50 ? 'Moderate driving style' : 'Aggressive driving style'}
              </p>
            </div>
          </div>
          <div className="glass-card p-4 sm:p-5">
            <p className="text-xs font-medium uppercase tracking-wider mb-3" style={{ color: 'var(--text-secondary)' }}>Motor Thermal</p>
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs" style={{ color: 'var(--text-muted)' }}>Avg Stator Temp</span>
                <span className="text-sm font-bold text-neon-amber">{fmtNumber(convertTemp(stats.avgTemp))} {tempUnit}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-xs" style={{ color: 'var(--text-muted)' }}>Max Stator Temp</span>
                <span className="text-sm font-bold text-neon-red">{fmtNumber(convertTemp(stats.maxTemp))} {tempUnit}</span>
              </div>
              <div className="w-full h-2 rounded-full bg-white/5 mt-1">
                <div
                  className={clsx('h-full rounded-full', stats.maxTemp > 150 ? 'bg-neon-red/60' : stats.maxTemp > 100 ? 'bg-neon-amber/60' : 'bg-neon-green/60')}
                  style={{ width: `${Math.min(100, (stats.maxTemp / 200) * 100)}%` }}
                />
              </div>
              <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>
                {stats.maxTemp > 150 ? 'High thermal load detected' : stats.maxTemp > 100 ? 'Normal operating range' : 'Cool running'}
              </p>
            </div>
          </div>
        </div>
      ) : loadingHistory ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4 mb-6 sm:mb-8">
          {[1, 2, 3].map(i => <Skeleton key={i} className="h-40 rounded-xl" />)}
        </div>
      ) : null}

      {/* ===== Summary Stats Row ===== */}
      <h3 className="text-sm font-semibold mb-3 uppercase tracking-wider" style={{ color: 'var(--text-secondary)' }}>
        Summary
      </h3>
      {loadingHistory ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4">
          {[1, 2, 3, 4, 5, 6].map(i => <Skeleton key={i} className="h-24 rounded-xl" />)}
        </div>
      ) : stats ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4">
          <StatCard
            label="Total Readings"
            value={stats.totalReadings}
            icon={<Disc className="h-4 w-4" />}
            color="text-neon-cyan"
          />
          <StatCard
            label="Avg Torque"
            value={fmtNumber(stats.avgTorque)}
            unit="Nm"
            icon={<Gauge className="h-4 w-4" />}
            color="text-neon-green"
          />
          <StatCard
            label="Max Lateral G"
            value={fmtNumber(stats.maxLatG, 3)}
            unit="g"
            icon={<ArrowUp className="h-4 w-4" />}
            color="text-neon-amber"
          />
          <StatCard
            label="Max Longitudinal G"
            value={fmtNumber(stats.maxLonG, 3)}
            unit="g"
            icon={<ArrowDown className="h-4 w-4" />}
            color="text-neon-cyan"
          />
          <StatCard
            label="Avg Pedal Position"
            value={fmtNumber(stats.avgPedal)}
            unit="%"
            icon={<Activity className="h-4 w-4" />}
            color="text-neon-green"
          />
          <StatCard
            label="Avg Stator Temp"
            value={fmtNumber(convertTemp(stats.avgTemp))}
            unit={tempUnit}
            icon={<Thermometer className="h-4 w-4" />}
            color="text-neon-amber"
          />
        </div>
      ) : null}
    </FadeIn>
  )
}

/* Helper to check if temp unit is fahrenheit */
function isTempFahrenheit(unit: string): boolean {
  return unit.includes('F')
}
