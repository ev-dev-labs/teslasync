import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { getVehicles, getClimateData, getClimateLatest } from '../api'
import { useVehicleLive } from '../hooks/useVehicleLive'
import { useAdaptiveInterval } from '../hooks/useAdaptiveInterval'
import { PageHeader, GlassPanel, FadeIn, Skeleton } from '../components/ui'
import { Thermometer, Wind, Snowflake, Sun, Fan, Flame, Shield, Zap, Activity, Car } from 'lucide-react'
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Legend, AreaChart, Area,
} from 'recharts'
import clsx from 'clsx'
import { useSettings } from '../hooks/useSettings'
import { formatDateTime } from '../lib/dateFormat'
import { fmtNumber } from '../lib/numberFormat'

// ---------------------------------------------------------------------------
// Custom chart tooltip
// ---------------------------------------------------------------------------
interface ClimateTooltipPayload { name: string; value: number; color?: string }

function ClimateTooltip({ active, payload, label, unit }: {
  active?: boolean; payload?: ClimateTooltipPayload[]; label?: string; unit?: string
}) {
  if (!active || !payload?.length) return null
  return (
    <div className="glass-panel p-3 text-xs" style={{ background: 'var(--surface-2)', borderColor: 'var(--glass-border)' }}>
      <p style={{ color: 'var(--text-secondary)' }} className="mb-1">{label}</p>
      {payload.map(p => (
        <p key={p.name} style={{ color: 'var(--text-primary)' }}>
          <span style={{ color: p.color }}>●</span> {p.name}: {p.value != null ? fmtNumber(p.value, 1) : ''}{unit ? ` ${unit}` : ''}
        </p>
      ))}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Circular gauge for temperature / power / fan
// ---------------------------------------------------------------------------
function CircularGauge({ label, value, displayValue, unit, min, max, icon, colorClass, bgClass }: {
  label: string
  value: number | null
  displayValue?: string
  unit?: string
  min: number
  max: number
  icon: React.ReactNode
  colorClass: string
  bgClass: string
}) {
  const v = value ?? 0
  const pct = Math.min(100, Math.max(0, ((v - min) / (max - min)) * 100))
  const hasData = value !== null && value !== undefined

  return (
    <div className="glass-card p-4 sm:p-5 flex flex-col items-center gap-3">
      <div className="flex items-center gap-2">
        {icon}
        <p className="text-xs font-medium uppercase tracking-wider" style={{ color: 'var(--text-secondary)' }}>{label}</p>
      </div>
      <div className="relative w-24 h-24 flex items-center justify-center">
        <svg className="absolute inset-0 w-full h-full -rotate-90" viewBox="0 0 100 100">
          <circle cx="50" cy="50" r="42" fill="none" stroke="currentColor" strokeWidth="6" className="text-white/5" />
          <circle cx="50" cy="50" r="42" fill="none" stroke="currentColor" strokeWidth="6"
            strokeDasharray={`${pct * 2.64} 264`} strokeLinecap="round" className={colorClass} />
        </svg>
        <span className={clsx('text-2xl font-bold', colorClass)}>
          {hasData ? (displayValue ?? fmtNumber(v, 1)) : '--'}
        </span>
      </div>
      <span className={clsx('text-[10px] px-2 py-0.5 rounded-full font-medium', bgClass, colorClass)}>
        {hasData ? `${displayValue ?? fmtNumber(v, 1)} ${unit ?? ''}` : 'N/A'}
      </span>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Fan speed visual indicator
// ---------------------------------------------------------------------------
function FanIndicator({ speed }: { speed: number | null }) {
  const s = speed ?? 0
  const isActive = s > 0
  const pct = Math.min(100, (s / 6) * 100)

  return (
    <div className="glass-card p-4 sm:p-5 flex flex-col items-center gap-3">
      <div className="flex items-center gap-2">
        <Fan className="h-4 w-4 text-neon-cyan" />
        <p className="text-xs font-medium uppercase tracking-wider" style={{ color: 'var(--text-secondary)' }}>Fan Speed</p>
      </div>
      <div className="relative w-24 h-24 flex items-center justify-center">
        <svg className="absolute inset-0 w-full h-full -rotate-90" viewBox="0 0 100 100">
          <circle cx="50" cy="50" r="42" fill="none" stroke="currentColor" strokeWidth="6" className="text-white/5" />
          <circle cx="50" cy="50" r="42" fill="none" stroke="currentColor" strokeWidth="6"
            strokeDasharray={`${pct * 2.64} 264`} strokeLinecap="round" className="text-neon-cyan" />
        </svg>
        <Fan className={clsx('h-8 w-8 text-neon-cyan', isActive && 'animate-spin')}
          style={isActive ? { animationDuration: `${Math.max(0.3, 1.5 - s * 0.2)}s` } : undefined} />
      </div>
      <div className="flex items-center gap-1.5">
        {isActive
          ? <span className="text-xs text-neon-cyan">Level {s}</span>
          : <span className="text-xs text-[var(--text-muted)]">Off</span>}
      </div>
      <span className={clsx('text-[10px] px-2 py-0.5 rounded-full font-medium',
        isActive ? 'bg-neon-cyan/20 text-neon-cyan' : 'bg-white/5 text-[var(--text-muted)]')}>
        {isActive ? `Level ${s}/6` : 'N/A'}
      </span>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Status badge
// ---------------------------------------------------------------------------
function StatusBadge({ label, active, icon, activeColor = 'text-neon-green', activeBg = 'bg-neon-green/20' }: {
  label: string; active: boolean | undefined | null; icon: React.ReactNode
  activeColor?: string; activeBg?: string
}) {
  const isOn = !!active
  return (
    <div className="glass-card p-4 sm:p-5 flex flex-col items-center gap-3">
      <div className="flex items-center gap-2">
        {icon}
        <p className="text-xs font-medium uppercase tracking-wider" style={{ color: 'var(--text-secondary)' }}>{label}</p>
      </div>
      <div className={clsx('w-16 h-16 rounded-full flex items-center justify-center',
        isOn ? activeBg : 'bg-white/5')}>
        {icon}
      </div>
      <span className={clsx('text-[10px] px-3 py-1 rounded-full font-semibold',
        isOn ? `${activeBg} ${activeColor}` : 'bg-white/5 text-[var(--text-muted)]')}>
        {isOn ? 'ACTIVE' : 'INACTIVE'}
      </span>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function tempColor(celsius: number | undefined | null): { cls: string; bg: string } {
  if (celsius == null) return { cls: 'text-[var(--text-muted)]', bg: 'bg-white/5' }
  if (celsius < 15) return { cls: 'text-neon-cyan', bg: 'bg-neon-cyan/20' }
  if (celsius < 22) return { cls: 'text-neon-green', bg: 'bg-neon-green/20' }
  if (celsius < 30) return { cls: 'text-neon-amber', bg: 'bg-neon-amber/20' }
  return { cls: 'text-neon-red', bg: 'bg-neon-red/20' }
}

function comfortScore(inside: number | undefined, leftReq: number | undefined, rightReq: number | undefined): number | null {
  if (inside == null) return null
  const target = (leftReq != null && rightReq != null)
    ? (leftReq + rightReq) / 2
    : leftReq ?? rightReq ?? null
  if (target == null) return null
  const delta = Math.abs(inside - target)
  return Math.max(0, Math.round(100 - delta * 10))
}

function comfortLabel(score: number | null): { text: string; cls: string; bg: string } {
  if (score == null) return { text: 'Unknown', cls: 'text-[var(--text-muted)]', bg: 'bg-white/5' }
  if (score >= 80) return { text: 'Comfortable', cls: 'text-neon-green', bg: 'bg-neon-green/20' }
  if (score >= 50) return { text: 'Moderate', cls: 'text-neon-amber', bg: 'bg-neon-amber/20' }
  return { text: 'Uncomfortable', cls: 'text-neon-red', bg: 'bg-neon-red/20' }
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------
export default function ClimateControl() {
  const { convertTemp, tempUnit } = useSettings()
  const { data: vehicles } = useQuery({ queryKey: ['vehicles'], queryFn: getVehicles })
  const [selectedVehicle, setSelectedVehicle] = useState<number | null>(null)
  const [limit] = useState(100)
  const vehicleId = selectedVehicle ?? vehicles?.[0]?.id ?? null

  // SSE live state for real-time climate signals
  const { state: live } = useVehicleLive(vehicleId ?? undefined)
  const pollInterval = useAdaptiveInterval()

  const { data: climateData, isLoading: loadingHistory } = useQuery({
    queryKey: ['climate', vehicleId, limit],
    queryFn: () => getClimateData(vehicleId!, limit),
    enabled: !!vehicleId,
    refetchInterval: 5000,
  })

  const { data: latest, isLoading: loadingLatest } = useQuery({
    queryKey: ['climate-latest', vehicleId],
    queryFn: () => getClimateLatest(vehicleId!),
    enabled: !!vehicleId,
    refetchInterval: pollInterval,
  })

  // ---- derived data -------------------------------------------------------
  const history = climateData ?? []
  const sorted = [...history].sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())

  const tempChartData = sorted.map(s => ({
    time: formatDateTime(s.created_at),
    inside: s.inside_temp != null ? +convertTemp(s.inside_temp).toFixed(1) : null,
    outside: s.outside_temp != null ? +convertTemp(s.outside_temp).toFixed(1) : null,
    leftTarget: s.hvac_left_temp_request != null ? +convertTemp(s.hvac_left_temp_request).toFixed(1) : null,
    rightTarget: s.hvac_right_temp_request != null ? +convertTemp(s.hvac_right_temp_request).toFixed(1) : null,
  }))

  const hvacChartData = sorted.map(s => ({
    time: formatDateTime(s.created_at),
    power: s.hvac_power ?? null,
    fanSpeed: s.hvac_fan_speed ?? null,
  }))

  // efficiency stats
  const validPower = history.filter(s => s.hvac_power != null).map(s => s.hvac_power!)
  const avgPower = validPower.length ? validPower.reduce((a, b) => a + b, 0) / validPower.length : null
  const peakPower = validPower.length ? Math.max(...validPower) : null

  const estimateEnergyKwh = (): number | null => {
    if (sorted.length < 2) return null
    let totalWh = 0
    for (let i = 1; i < sorted.length; i++) {
      const dt = (new Date(sorted[i].created_at).getTime() - new Date(sorted[i - 1].created_at).getTime()) / 3_600_000
      const p = sorted[i].hvac_power ?? sorted[i - 1].hvac_power ?? 0
      totalWh += p * dt
    }
    return totalWh
  }
  const totalEnergy = estimateEnergyKwh()

  const validInside = history.filter(s => s.inside_temp != null).map(s => s.inside_temp!)
  const avgInside = validInside.length ? validInside.reduce((a, b) => a + b, 0) / validInside.length : null
  const validOutside = history.filter(s => s.outside_temp != null).map(s => s.outside_temp!)
  const avgOutside = validOutside.length ? validOutside.reduce((a, b) => a + b, 0) / validOutside.length : null
  const maxPower = peakPower
  const defrostCount = history.filter(s => s.defrost_mode === true).length
  const heaterCount = history.filter(s => s.battery_heater_on === true).length

  const score = latest ? comfortScore(latest.inside_temp, latest.hvac_left_temp_request, latest.hvac_right_temp_request) : null
  const comfort = comfortLabel(score)

  const insideColor = tempColor(latest?.inside_temp)

  // temp delta
  const targetTemp = (latest?.hvac_left_temp_request != null && latest?.hvac_right_temp_request != null)
    ? (latest.hvac_left_temp_request + latest.hvac_right_temp_request) / 2
    : latest?.hvac_left_temp_request ?? latest?.hvac_right_temp_request ?? null
  const tempDelta = (latest?.inside_temp != null && targetTemp != null)
    ? latest.inside_temp - targetTemp
    : null

  // ---- render -------------------------------------------------------------
  return (
    <FadeIn>
      {/* Header + Vehicle Selector */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 sm:gap-0 mb-6 sm:mb-8">
        <PageHeader
          title="Climate Control"
          subtitle="HVAC performance, cabin comfort monitoring, and thermal management"
          icon={<Thermometer className="h-7 w-7 text-neon-cyan" />}
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

      {/* ================================================================ */}
      {/* Section 1 — Live Climate Status Gauges                          */}
      {/* ================================================================ */}
      {loadingLatest ? (
        <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-3 sm:gap-4 mb-6 sm:mb-8">
          {[1, 2, 3, 4, 5, 6].map(i => <Skeleton key={i} className="h-52 rounded-xl" />)}
        </div>
      ) : (
        <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-3 sm:gap-4 mb-6 sm:mb-8">
          {/* Cabin Temperature */}
          <CircularGauge
            label="Cabin Temp"
            value={latest?.inside_temp != null ? convertTemp(latest.inside_temp) : null}
            displayValue={latest?.inside_temp != null ? fmtNumber(convertTemp(latest.inside_temp), 1) : undefined}
            unit={tempUnit}
            min={convertTemp(0)} max={convertTemp(50)}
            icon={<Thermometer className="h-4 w-4" style={{ color: insideColor.cls.includes('cyan') ? '#22d3ee' : insideColor.cls.includes('green') ? '#10b981' : insideColor.cls.includes('amber') ? '#f59e0b' : insideColor.cls.includes('red') ? '#ef4444' : '#9ca3af' }} />}
            colorClass={insideColor.cls}
            bgClass={insideColor.bg}
          />

          {/* Outside Temperature */}
          {(() => {
            const oc = tempColor(latest?.outside_temp)
            return (
              <CircularGauge
                label="Outside Temp"
                value={latest?.outside_temp != null ? convertTemp(latest.outside_temp) : null}
                displayValue={latest?.outside_temp != null ? fmtNumber(convertTemp(latest.outside_temp), 1) : undefined}
                unit={tempUnit}
                min={convertTemp(-10)} max={convertTemp(50)}
                icon={<Sun className="h-4 w-4 text-neon-amber" />}
                colorClass={oc.cls}
                bgClass={oc.bg}
              />
            )
          })()}

          {/* HVAC Power */}
          <CircularGauge
            label="HVAC Power"
            value={latest?.hvac_power ?? null}
            displayValue={latest?.hvac_power != null ? fmtNumber(latest.hvac_power, 1) : undefined}
            unit="kW"
            min={0} max={6}
            icon={<Zap className="h-4 w-4 text-neon-purple" />}
            colorClass="text-neon-purple"
            bgClass="bg-neon-purple/20"
          />

          {/* Fan Speed */}
          <FanIndicator speed={latest?.hvac_fan_speed ?? null} />

          {/* Left Zone Temp */}
          <CircularGauge
            label="Left Zone"
            value={latest?.hvac_left_temp_request != null ? convertTemp(latest.hvac_left_temp_request) : null}
            displayValue={latest?.hvac_left_temp_request != null ? fmtNumber(convertTemp(latest.hvac_left_temp_request), 1) : undefined}
            unit={tempUnit}
            min={convertTemp(15)} max={convertTemp(30)}
            icon={<Thermometer className="h-4 w-4 text-neon-cyan" />}
            colorClass="text-neon-cyan"
            bgClass="bg-neon-cyan/20"
          />

          {/* Right Zone Temp */}
          <CircularGauge
            label="Right Zone"
            value={latest?.hvac_right_temp_request != null ? convertTemp(latest.hvac_right_temp_request) : null}
            displayValue={latest?.hvac_right_temp_request != null ? fmtNumber(convertTemp(latest.hvac_right_temp_request), 1) : undefined}
            unit={tempUnit}
            min={convertTemp(15)} max={convertTemp(30)}
            icon={<Thermometer className="h-4 w-4 text-neon-amber" />}
            colorClass="text-neon-amber"
            bgClass="bg-neon-amber/20"
          />
        </div>
      )}

      {/* ================================================================ */}
      {/* Section 2 — Thermal Comfort Indicator                           */}
      {/* ================================================================ */}
      <GlassPanel className="p-4 sm:p-6 mb-6 sm:mb-8">
        <h3 className="text-sm font-semibold mb-4" style={{ color: 'var(--text-primary)' }}>Thermal Comfort</h3>
        {loadingLatest ? <Skeleton className="h-28 rounded-xl" /> : (
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            {/* Comfort Score */}
            <div className="glass-card p-4 flex flex-col items-center gap-2">
              <p className="text-xs font-medium uppercase tracking-wider" style={{ color: 'var(--text-secondary)' }}>Comfort Score</p>
              <div className={clsx('w-20 h-20 rounded-full flex items-center justify-center', comfort.bg)}>
                <span className={clsx('text-2xl font-bold', comfort.cls)}>{score != null ? score : '--'}</span>
              </div>
              <span className={clsx('text-[10px] px-3 py-1 rounded-full font-semibold', comfort.bg, comfort.cls)}>
                {comfort.text}
              </span>
            </div>

            {/* Temperature Delta */}
            <div className="glass-card p-4 flex flex-col items-center gap-2">
              <p className="text-xs font-medium uppercase tracking-wider" style={{ color: 'var(--text-secondary)' }}>Temp Delta</p>
              <div className={clsx('w-20 h-20 rounded-full flex items-center justify-center',
                tempDelta == null ? 'bg-white/5' : tempDelta > 2 ? 'bg-neon-red/20' : tempDelta < -2 ? 'bg-neon-cyan/20' : 'bg-neon-green/20')}>
                <span className={clsx('text-2xl font-bold',
                  tempDelta == null ? 'text-[var(--text-muted)]' : tempDelta > 2 ? 'text-neon-red' : tempDelta < -2 ? 'text-neon-cyan' : 'text-neon-green')}>
                  {tempDelta != null ? `${tempDelta > 0 ? '+' : ''}${convertTemp(tempDelta + 20 ) - convertTemp(20) > 0 ? '+' : ''}${fmtNumber(convertTemp(tempDelta + 20) - convertTemp(20), 1)}` : '--'}
                </span>
              </div>
              <span className="text-[10px] px-3 py-1 rounded-full font-medium bg-white/5" style={{ color: 'var(--text-secondary)' }}>
                {tempDelta != null
                  ? tempDelta > 2 ? 'Above Target' : tempDelta < -2 ? 'Below Target' : 'Near Target'
                  : 'N/A'}
              </span>
            </div>

            {/* Comfort Status */}
            <div className="glass-card p-4 flex flex-col items-center gap-2">
              <p className="text-xs font-medium uppercase tracking-wider" style={{ color: 'var(--text-secondary)' }}>Status</p>
              <div className={clsx('w-20 h-20 rounded-full flex items-center justify-center', comfort.bg)}>
                {score != null && score >= 80
                  ? <Sun className={clsx('h-8 w-8', comfort.cls)} />
                  : score != null && score < 50
                    ? <Snowflake className={clsx('h-8 w-8', comfort.cls)} />
                    : <Wind className={clsx('h-8 w-8', comfort.cls)} />}
              </div>
              <span className={clsx('text-[10px] px-3 py-1 rounded-full font-semibold', comfort.bg, comfort.cls)}>
                {latest?.inside_temp != null && targetTemp != null
                  ? (latest.inside_temp > targetTemp ? 'Too Warm' : latest.inside_temp < targetTemp - 2 ? 'Too Cold' : 'Comfortable')
                  : 'Unknown'}
              </span>
            </div>
          </div>
        )}
      </GlassPanel>

      {/* ================================================================ */}
      {/* Section 3 — System Status Cards                                 */}
      {/* ================================================================ */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 sm:gap-4 mb-6 sm:mb-8">
        <StatusBadge
          label="Overheat Protection"
          active={latest?.cabin_overheat_mode != null && latest.cabin_overheat_mode !== 'Off'}
          icon={<Shield className={clsx('h-5 w-5', latest?.cabin_overheat_mode && latest.cabin_overheat_mode !== 'Off' ? 'text-neon-green' : 'text-[var(--text-muted)]')} />}
          activeColor="text-neon-green"
          activeBg="bg-neon-green/20"
        />
        <StatusBadge
          label="Defrost Mode"
          active={latest?.defrost_mode}
          icon={<Snowflake className={clsx('h-5 w-5', latest?.defrost_mode ? 'text-neon-cyan' : 'text-[var(--text-muted)]')} />}
          activeColor="text-neon-cyan"
          activeBg="bg-neon-cyan/20"
        />
        <StatusBadge
          label="Battery Heater"
          active={latest?.battery_heater_on}
          icon={<Flame className={clsx('h-5 w-5', latest?.battery_heater_on ? 'text-neon-red' : 'text-[var(--text-muted)]')} />}
          activeColor="text-neon-red"
          activeBg="bg-neon-red/20"
        />
      </div>

      {/* ================================================================ */}
      {/* Section 4 — Temperature History Chart                           */}
      {/* ================================================================ */}
      <GlassPanel className="p-4 sm:p-6 mb-6 sm:mb-8">
        <h3 className="text-sm font-semibold mb-4" style={{ color: 'var(--text-primary)' }}>Temperature History</h3>
        {loadingHistory ? <Skeleton className="h-72 rounded-xl" /> : tempChartData.length === 0 ? (
          <div className="flex items-center justify-center h-72 text-[var(--text-muted)] text-sm">No temperature history data available</div>
        ) : (
          <ResponsiveContainer width="100%" height={300}>
            <LineChart data={tempChartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--glass-border)" strokeOpacity={0.5} />
              <XAxis dataKey="time" tick={{ fontSize: 10, fill: 'var(--text-muted)' }} />
              <YAxis tick={{ fontSize: 10, fill: 'var(--text-muted)' }} />
              <Tooltip content={<ClimateTooltip unit={tempUnit} />} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Line type="monotone" dataKey="inside" name="Cabin Temp" stroke="#f97316" strokeWidth={2} dot={false} />
              <Line type="monotone" dataKey="outside" name="Outside Temp" stroke="#22d3ee" strokeWidth={2} dot={false} />
              <Line type="monotone" dataKey="leftTarget" name="Left Target" stroke="#a855f7" strokeWidth={1.5} strokeDasharray="5 5" dot={false} />
              <Line type="monotone" dataKey="rightTarget" name="Right Target" stroke="#10b981" strokeWidth={1.5} strokeDasharray="5 5" dot={false} />
            </LineChart>
          </ResponsiveContainer>
        )}
      </GlassPanel>

      {/* ================================================================ */}
      {/* Section 5 — HVAC Power & Fan Speed History                      */}
      {/* ================================================================ */}
      <GlassPanel className="p-4 sm:p-6 mb-6 sm:mb-8">
        <h3 className="text-sm font-semibold mb-4" style={{ color: 'var(--text-primary)' }}>HVAC Power &amp; Fan Speed</h3>
        {loadingHistory ? <Skeleton className="h-72 rounded-xl" /> : hvacChartData.length === 0 ? (
          <div className="flex items-center justify-center h-72 text-[var(--text-muted)] text-sm">No HVAC history data available</div>
        ) : (
          <ResponsiveContainer width="100%" height={300}>
            <AreaChart data={hvacChartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--glass-border)" strokeOpacity={0.5} />
              <XAxis dataKey="time" tick={{ fontSize: 10, fill: 'var(--text-muted)' }} />
              <YAxis yAxisId="power" tick={{ fontSize: 10, fill: 'var(--text-muted)' }} label={{ value: 'kW', angle: -90, position: 'insideLeft', style: { fontSize: 10, fill: 'var(--text-muted)' } }} />
              <YAxis yAxisId="fan" orientation="right" domain={[0, 6]} tick={{ fontSize: 10, fill: 'var(--text-muted)' }} label={{ value: 'Fan Level', angle: 90, position: 'insideRight', style: { fontSize: 10, fill: 'var(--text-muted)' } }} />
              <Tooltip content={<ClimateTooltip />} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Area yAxisId="power" type="monotone" dataKey="power" name="HVAC Power (kW)" stroke="#22d3ee" fill="#22d3ee" fillOpacity={0.15} strokeWidth={2} dot={false} />
              <Line yAxisId="fan" type="stepAfter" dataKey="fanSpeed" name="Fan Speed" stroke="#a855f7" strokeWidth={2} dot={false} />
            </AreaChart>
          </ResponsiveContainer>
        )}
      </GlassPanel>

      {/* ================================================================ */}
      {/* Section 6 — Climate Efficiency Panel                            */}
      {/* ================================================================ */}
      <GlassPanel className="p-4 sm:p-6 mb-6 sm:mb-8">
        <div className="flex items-center gap-2 mb-4">
          <Activity className="h-4 w-4 text-neon-cyan" />
          <h3 className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>Climate Efficiency</h3>
        </div>
        {loadingHistory ? (
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
            {[1, 2, 3, 4].map(i => <Skeleton key={i} className="h-28 rounded-xl" />)}
          </div>
        ) : (
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
            {/* Average HVAC Power */}
            <div className="glass-card p-4 flex flex-col items-center gap-2">
              <p className="text-xs font-medium uppercase tracking-wider" style={{ color: 'var(--text-secondary)' }}>Avg Power</p>
              <span className="text-2xl font-bold text-neon-cyan">{avgPower != null ? fmtNumber(avgPower, 2) : '--'}</span>
              <span className="text-[10px] px-2 py-0.5 rounded-full font-medium bg-neon-cyan/20 text-neon-cyan">kW</span>
            </div>
            {/* Peak HVAC Power */}
            <div className="glass-card p-4 flex flex-col items-center gap-2">
              <p className="text-xs font-medium uppercase tracking-wider" style={{ color: 'var(--text-secondary)' }}>Peak Power</p>
              <span className="text-2xl font-bold text-neon-purple">{peakPower != null ? fmtNumber(peakPower, 2) : '--'}</span>
              <span className="text-[10px] px-2 py-0.5 rounded-full font-medium bg-neon-purple/20 text-neon-purple">kW</span>
            </div>
            {/* Total Energy */}
            <div className="glass-card p-4 flex flex-col items-center gap-2">
              <p className="text-xs font-medium uppercase tracking-wider" style={{ color: 'var(--text-secondary)' }}>Est. Energy Used</p>
              <span className="text-2xl font-bold text-neon-amber">{totalEnergy != null ? fmtNumber(totalEnergy, 2) : '--'}</span>
              <span className="text-[10px] px-2 py-0.5 rounded-full font-medium bg-neon-amber/20 text-neon-amber">kWh</span>
            </div>
            {/* Temp Differential Efficiency */}
            <div className="glass-card p-4 flex flex-col items-center gap-2">
              <p className="text-xs font-medium uppercase tracking-wider" style={{ color: 'var(--text-secondary)' }}>Comfort Score</p>
              <span className={clsx('text-2xl font-bold', comfort.cls)}>{score != null ? `${score}%` : '--'}</span>
              <span className={clsx('text-[10px] px-2 py-0.5 rounded-full font-medium', comfort.bg, comfort.cls)}>{comfort.text}</span>
            </div>
          </div>
        )}
      </GlassPanel>

      {/* ================================================================ */}
      {/* Section 7 — Summary Stats Row                                   */}
      {/* ================================================================ */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-7 gap-3 sm:gap-4 mb-6 sm:mb-8">
        <div className="glass-card p-4 flex flex-col items-center gap-1">
          <p className="text-[10px] font-medium uppercase tracking-wider" style={{ color: 'var(--text-secondary)' }}>Avg Cabin</p>
          <span className="text-lg font-bold text-neon-cyan">
            {avgInside != null ? fmtNumber(convertTemp(avgInside), 1) : '--'}
          </span>
          <span className="text-[10px]" style={{ color: 'var(--text-muted)' }}>{tempUnit}</span>
        </div>
        <div className="glass-card p-4 flex flex-col items-center gap-1">
          <p className="text-[10px] font-medium uppercase tracking-wider" style={{ color: 'var(--text-secondary)' }}>Avg Outside</p>
          <span className="text-lg font-bold text-neon-green">
            {avgOutside != null ? fmtNumber(convertTemp(avgOutside), 1) : '--'}
          </span>
          <span className="text-[10px]" style={{ color: 'var(--text-muted)' }}>{tempUnit}</span>
        </div>
        <div className="glass-card p-4 flex flex-col items-center gap-1">
          <p className="text-[10px] font-medium uppercase tracking-wider" style={{ color: 'var(--text-secondary)' }}>Avg HVAC</p>
          <span className="text-lg font-bold text-neon-purple">
            {avgPower != null ? fmtNumber(avgPower, 2) : '--'}
          </span>
          <span className="text-[10px]" style={{ color: 'var(--text-muted)' }}>kW</span>
        </div>
        <div className="glass-card p-4 flex flex-col items-center gap-1">
          <p className="text-[10px] font-medium uppercase tracking-wider" style={{ color: 'var(--text-secondary)' }}>Max HVAC</p>
          <span className="text-lg font-bold text-neon-amber">
            {maxPower != null ? fmtNumber(maxPower, 2) : '--'}
          </span>
          <span className="text-[10px]" style={{ color: 'var(--text-muted)' }}>kW</span>
        </div>
        <div className="glass-card p-4 flex flex-col items-center gap-1">
          <p className="text-[10px] font-medium uppercase tracking-wider" style={{ color: 'var(--text-secondary)' }}>Defrost Count</p>
          <span className="text-lg font-bold text-neon-cyan">{defrostCount}</span>
          <span className="text-[10px]" style={{ color: 'var(--text-muted)' }}>activations</span>
        </div>
        <div className="glass-card p-4 flex flex-col items-center gap-1">
          <p className="text-[10px] font-medium uppercase tracking-wider" style={{ color: 'var(--text-secondary)' }}>Heater Count</p>
          <span className="text-lg font-bold text-neon-red">{heaterCount}</span>
          <span className="text-[10px]" style={{ color: 'var(--text-muted)' }}>activations</span>
        </div>
        <div className="glass-card p-4 flex flex-col items-center gap-1">
          <p className="text-[10px] font-medium uppercase tracking-wider" style={{ color: 'var(--text-secondary)' }}>Total Readings</p>
          <span className="text-lg font-bold text-neon-green">{history.length}</span>
          <span className="text-[10px]" style={{ color: 'var(--text-muted)' }}>snapshots</span>
        </div>
      </div>

      {/* ================================================================ */}
      {/* Section 8 — Live Climate Signals (SSE)                           */}
      {/* ================================================================ */}
      <GlassPanel className="p-4 sm:p-6 mb-6 sm:mb-8">
        <h3 className="text-sm font-semibold mb-4" style={{ color: 'var(--text-primary)' }}>
          <Car className="inline h-4 w-4 mr-1.5 text-neon-cyan" />
          Live Climate Signals
        </h3>

        {/* Seat Heaters — 5 positions */}
        <p className="text-xs font-medium uppercase tracking-wider mb-2" style={{ color: 'var(--text-muted)' }}>Seat Heaters</p>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 mb-5">
          {[
            { label: 'Driver', level: live.seatHeaterLeft },
            { label: 'Passenger', level: live.seatHeaterRight },
            { label: 'Rear Left', level: live.seatHeaterRearLeft },
            { label: 'Rear Center', level: live.seatHeaterRearCenter },
            { label: 'Rear Right', level: live.seatHeaterRearRight },
          ].map(seat => (
            <div key={seat.label} className="glass-card p-3 text-center">
              <p className="text-[10px] uppercase tracking-wider mb-1" style={{ color: 'var(--text-muted)' }}>{seat.label}</p>
              <div className="flex items-center justify-center gap-1 mb-1">
                {[1, 2, 3].map(lvl => (
                  <div key={lvl} className={clsx('w-3 h-3 rounded-sm', seat.level >= lvl ? 'bg-neon-red/70' : 'bg-white/[0.06]')} />
                ))}
              </div>
              <span className={clsx('text-xs font-medium', seat.level > 0 ? 'text-neon-red' : 'text-[var(--text-muted)]')}>
                {seat.level > 0 ? `Level ${seat.level}` : 'Off'}
              </span>
            </div>
          ))}
        </div>

        {/* Seat Cooling & Ventilation */}
        <p className="text-xs font-medium uppercase tracking-wider mb-2" style={{ color: 'var(--text-muted)' }}>Seat Cooling & Ventilation</p>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-5">
          <div className="glass-card p-3 text-center">
            <p className="text-[10px] uppercase tracking-wider mb-1" style={{ color: 'var(--text-muted)' }}>Front Left Cool</p>
            <span className={clsx('text-sm font-semibold', live.seatCoolingFrontLeft > 0 ? 'text-neon-cyan' : 'text-[var(--text-muted)]')}>
              {live.seatCoolingFrontLeft > 0 ? `Level ${live.seatCoolingFrontLeft}` : 'Off'}
            </span>
          </div>
          <div className="glass-card p-3 text-center">
            <p className="text-[10px] uppercase tracking-wider mb-1" style={{ color: 'var(--text-muted)' }}>Front Right Cool</p>
            <span className={clsx('text-sm font-semibold', live.seatCoolingFrontRight > 0 ? 'text-neon-cyan' : 'text-[var(--text-muted)]')}>
              {live.seatCoolingFrontRight > 0 ? `Level ${live.seatCoolingFrontRight}` : 'Off'}
            </span>
          </div>
          <div className="glass-card p-3 text-center">
            <p className="text-[10px] uppercase tracking-wider mb-1" style={{ color: 'var(--text-muted)' }}>Seat Vent</p>
            <span className={clsx('text-sm font-semibold', live.seatVentEnabled ? 'text-neon-cyan' : 'text-[var(--text-muted)]')}>
              {live.seatVentEnabled ? 'On' : 'Off'}
            </span>
          </div>
          <div className="glass-card p-3 text-center">
            <p className="text-[10px] uppercase tracking-wider mb-1" style={{ color: 'var(--text-muted)' }}>Auto Climate</p>
            <span className={clsx('text-sm font-semibold', live.autoSeatClimateLeft || live.autoSeatClimateRight ? 'text-neon-green' : 'text-[var(--text-muted)]')}>
              {live.autoSeatClimateLeft && live.autoSeatClimateRight ? 'Both' : live.autoSeatClimateLeft ? 'Left' : live.autoSeatClimateRight ? 'Right' : 'Off'}
            </span>
          </div>
        </div>

        {/* HVAC System Details */}
        <p className="text-xs font-medium uppercase tracking-wider mb-2" style={{ color: 'var(--text-muted)' }}>HVAC System</p>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 mb-5">
          <div className="glass-card p-3 flex flex-col items-center gap-1">
            <span className="text-[10px] uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>AC</span>
            <span className={clsx('text-sm font-semibold', live.hvacACEnabled ? 'text-neon-cyan' : 'text-[var(--text-muted)]')}>{live.hvacACEnabled ? 'On' : 'Off'}</span>
          </div>
          <div className="glass-card p-3 flex flex-col items-center gap-1">
            <span className="text-[10px] uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>Auto Mode</span>
            <span className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>{live.hvacAutoMode || 'Off'}</span>
          </div>
          <div className="glass-card p-3 flex flex-col items-center gap-1">
            <span className="text-[10px] uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>Climate Keeper</span>
            <span className={clsx('text-sm font-semibold', live.climateKeeperMode && live.climateKeeperMode !== 'Off' ? 'text-neon-green' : 'text-[var(--text-muted)]')}>{live.climateKeeperMode || 'Off'}</span>
          </div>
          <div className="glass-card p-3 flex flex-col items-center gap-1">
            <span className="text-[10px] uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>Overheat Limit</span>
            <span className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>{live.cabinOverheatTempLimit || '—'}</span>
          </div>
          <div className="glass-card p-3 flex flex-col items-center gap-1">
            <span className="text-[10px] uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>Fan Status</span>
            <span className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>{live.hvacFanStatus || '—'}</span>
          </div>
        </div>

        {/* Heating & Defrost */}
        <p className="text-xs font-medium uppercase tracking-wider mb-2" style={{ color: 'var(--text-muted)' }}>Heating & Defrost</p>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
          <div className="glass-card p-3 flex flex-col items-center gap-1">
            <span className="text-[10px] uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>Steering Wheel</span>
            <span className={clsx('text-sm font-semibold', live.steeringWheelHeatLevel > 0 ? 'text-neon-red' : 'text-[var(--text-muted)]')}>
              {live.steeringWheelHeatLevel > 0 ? `Level ${live.steeringWheelHeatLevel}` : 'Off'}
            </span>
            {live.steeringWheelHeatAuto && <span className="text-[9px] text-neon-green">Auto</span>}
          </div>
          <div className="glass-card p-3 flex flex-col items-center gap-1">
            <span className="text-[10px] uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>Preconditioning</span>
            <span className={clsx('text-sm font-semibold', live.defrostPreconditioning ? 'text-neon-cyan' : 'text-[var(--text-muted)]')}>{live.defrostPreconditioning ? 'Active' : 'Off'}</span>
          </div>
          <div className="glass-card p-3 flex flex-col items-center gap-1">
            <span className="text-[10px] uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>Rear Defrost</span>
            <span className={clsx('text-sm font-semibold', live.rearDefrost ? 'text-neon-cyan' : 'text-[var(--text-muted)]')}>{live.rearDefrost ? 'On' : 'Off'}</span>
          </div>
          <div className="glass-card p-3 flex flex-col items-center gap-1">
            <span className="text-[10px] uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>Rear Display HVAC</span>
            <span className={clsx('text-sm font-semibold', live.rearDisplayHvac ? 'text-neon-green' : 'text-[var(--text-muted)]')}>{live.rearDisplayHvac ? 'On' : 'Off'}</span>
          </div>
          <div className="glass-card p-3 flex flex-col items-center gap-1">
            <span className="text-[10px] uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>Wiper Heat</span>
            <span className={clsx('text-sm font-semibold', live.wiperHeat ? 'text-neon-amber' : 'text-[var(--text-muted)]')}>{live.wiperHeat ? 'On' : 'Off'}</span>
          </div>
        </div>
      </GlassPanel>
    </FadeIn>
  )
}
