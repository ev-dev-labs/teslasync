import { useState, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { getVehicles, getChargingTelemetry, getChargingTelemetryLatest } from '../api'
import { PageHeader, GlassPanel, FadeIn, Skeleton } from '../components/ui'
import { Zap, Battery, Activity, Gauge, AlertTriangle, CheckCircle, Thermometer, Shield, BatteryCharging } from 'lucide-react'
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend, AreaChart, Area } from 'recharts'
import clsx from 'clsx'
import { useSettings } from '../hooks/useSettings'
import { formatDateTime } from '../lib/dateFormat'

/* ─── Chart tooltip (matches TirePressure pattern) ─── */
interface EnergyTooltipPayload { name: string; value: number; color?: string }
function EnergyTooltip({ active, payload, label, unit = '' }: { active?: boolean; payload?: EnergyTooltipPayload[]; label?: string; unit?: string }) {
  if (!active || !payload?.length) return null
  return (
    <div className="glass-panel p-3 text-xs" style={{ background: 'var(--surface-2)', borderColor: 'var(--glass-border)' }}>
      <p style={{ color: 'var(--text-secondary)' }} className="mb-1">{label}</p>
      {payload.map(p => (
        <p key={p.name} style={{ color: 'var(--text-primary)' }}>
          <span style={{ color: p.color }}>●</span> {p.name}: {p.value?.toFixed(2)} {unit}
        </p>
      ))}
    </div>
  )
}

/* ─── Gauge card (generic version of PressureGauge) ─── */
function StatusGauge({ label, value, unit, min, max, color = 'text-neon-cyan', formatValue }: {
  label: string
  value: number | null | undefined
  unit: string
  min: number
  max: number
  color?: string
  formatValue?: (v: number) => string
}) {
  const val = value ?? 0
  const pct = Math.min(100, Math.max(0, ((val - min) / (max - min)) * 100))
  const fmt = formatValue ?? ((v: number) => v.toFixed(1))
  return (
    <div className="glass-card p-4 sm:p-5 flex flex-col items-center gap-3">
      <p className="text-xs font-medium uppercase tracking-wider" style={{ color: 'var(--text-secondary)' }}>{label}</p>
      <div className="relative w-24 h-24 flex items-center justify-center">
        <svg className="absolute inset-0 w-full h-full -rotate-90" viewBox="0 0 100 100">
          <circle cx="50" cy="50" r="42" fill="none" stroke="currentColor" strokeWidth="6" className="text-white/5" />
          <circle cx="50" cy="50" r="42" fill="none" stroke="currentColor" strokeWidth="6"
            strokeDasharray={`${pct * 2.64} 264`} strokeLinecap="round" className={color} />
        </svg>
        <span className={clsx('text-2xl font-bold', color)}>{value != null ? fmt(val) : '--'}</span>
      </div>
      <span className={clsx('text-[10px] px-2 py-0.5 rounded-full font-medium', color)}>
        {value != null ? `${fmt(val)} ${unit}` : 'N/A'}
      </span>
    </div>
  )
}

/* ─── BMS status indicator ─── */
function BmsIndicator({ label, active, icon: Icon }: { label: string; active: boolean | undefined; icon: React.ElementType }) {
  const isOn = active === true
  return (
    <div className={clsx('glass-card p-4 flex items-center gap-3', isOn ? 'border-neon-green/20' : 'border-white/5')}>
      <div className={clsx('p-2 rounded-lg', isOn ? 'bg-neon-green/10' : 'bg-white/5')}>
        <Icon className={clsx('h-5 w-5', isOn ? 'text-neon-green' : 'text-[var(--text-muted)]')} />
      </div>
      <div>
        <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>{label}</p>
        <p className={clsx('text-sm font-semibold', isOn ? 'text-neon-green' : 'text-[var(--text-muted)]')}>
          {isOn ? 'Active' : 'Inactive'}
        </p>
      </div>
    </div>
  )
}

/* ─── Power flow direction SVG ─── */
function PowerFlowArrow({ dcPower, acPower, energyRemaining }: { dcPower?: number | null; acPower?: number | null; energyRemaining?: number | null }) {
  const hasDc = dcPower != null && dcPower > 0
  const hasAc = acPower != null && acPower > 0
  const activeColor = hasDc ? '#00f0ff' : hasAc ? '#a855f7' : '#334155'
  const powerLabel = hasDc ? `DC ${dcPower?.toFixed(1)} kW` : hasAc ? `AC ${acPower?.toFixed(1)} kW` : 'No Charge'
  return (
    <svg viewBox="0 0 480 120" className="w-full" style={{ maxWidth: 480 }}>
      <defs>
        <linearGradient id="pf-grad" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor={activeColor} stopOpacity="0.1" />
          <stop offset="50%" stopColor={activeColor} stopOpacity="0.6" />
          <stop offset="100%" stopColor={activeColor} stopOpacity="0.1" />
        </linearGradient>
      </defs>
      {/* Source */}
      <rect x="10" y="30" width="100" height="60" rx="12" fill="#0f172a" stroke={activeColor} strokeWidth="1.5" />
      <text x="60" y="55" textAnchor="middle" fontSize="11" fontWeight="bold" fill={activeColor}>
        {hasDc ? 'DC' : hasAc ? 'AC' : 'GRID'}
      </text>
      <text x="60" y="72" textAnchor="middle" fontSize="9" fill="#9ca3af">Source</text>
      {/* Flow line */}
      <line x1="115" y1="60" x2="365" y2="60" stroke="url(#pf-grad)" strokeWidth="3" strokeDasharray="8 4">
        {(hasDc || hasAc) && <animate attributeName="stroke-dashoffset" values="0;-24" dur="1s" repeatCount="indefinite" />}
      </line>
      {/* Power label */}
      <rect x="175" y="35" width="130" height="28" rx="8" fill="#0f172a" stroke={activeColor} strokeWidth="1" opacity="0.9" />
      <text x="240" y="54" textAnchor="middle" fontSize="12" fontWeight="bold" fill={activeColor}>{powerLabel}</text>
      {/* Arrow head */}
      <polygon points="355,45 375,60 355,75" fill={activeColor} opacity={hasDc || hasAc ? 0.8 : 0.2} />
      {/* Battery */}
      <rect x="380" y="30" width="90" height="60" rx="12" fill="#0f172a" stroke="#10b981" strokeWidth="1.5" />
      <text x="425" y="52" textAnchor="middle" fontSize="10" fontWeight="bold" fill="#10b981">
        {energyRemaining != null ? `${energyRemaining.toFixed(1)}` : '--'}
      </text>
      <text x="425" y="66" textAnchor="middle" fontSize="8" fill="#9ca3af">kWh</text>
      <text x="425" y="80" textAnchor="middle" fontSize="8" fill="#10b981">Battery</text>
    </svg>
  )
}

/* ─── Stat card for summary section ─── */
function StatCard({ label, value, unit, color = 'text-neon-cyan' }: { label: string; value: number | null; unit: string; color?: string }) {
  return (
    <div className="glass-card p-4 sm:p-5">
      <p className="text-xs font-medium uppercase tracking-wider mb-2" style={{ color: 'var(--text-secondary)' }}>{label}</p>
      <p className={clsx('text-2xl font-bold', color)}>{value != null ? value.toFixed(1) : '--'}</p>
      <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>{unit}</p>
    </div>
  )
}

/* ═══════════════════════════════════════════════════════
   Main Component
   ═══════════════════════════════════════════════════════ */
export default function EnergyFlow() {
  const { data: vehicles } = useQuery({ queryKey: ['vehicles'], queryFn: getVehicles })
  const [selectedVehicle, setSelectedVehicle] = useState<number | null>(null)
  const vehicleId = selectedVehicle ?? vehicles?.[0]?.id ?? null
  const { convertTemp, tempUnit } = useSettings()

  /* ── Live latest telemetry ── */
  const { data: latest } = useQuery({
    queryKey: ['charging-telemetry-latest', vehicleId],
    queryFn: () => getChargingTelemetryLatest(vehicleId!),
    enabled: vehicleId !== null,
    refetchInterval: 5000,
  })

  /* ── Historical telemetry ── */
  const { data: history, isLoading } = useQuery({
    queryKey: ['charging-telemetry', vehicleId],
    queryFn: () => getChargingTelemetry(vehicleId!, 200),
    enabled: vehicleId !== null,
    refetchInterval: 5000,
  })

  /* ── Formatted timestamp helper ── */
  const fmtTime = (iso: string) => formatDateTime(iso)

  /* ── Cell voltage chart data ── */
  const cellVoltageData = useMemo(() => {
    if (!history?.length) return []
    return history.slice().reverse().map(d => ({
      time: fmtTime(d.created_at),
      max: d.brick_voltage_max ?? null,
      min: d.brick_voltage_min ?? null,
      spread: d.brick_voltage_max != null && d.brick_voltage_min != null
        ? Number(((d.brick_voltage_max - d.brick_voltage_min) * 1000).toFixed(1))
        : null,
    }))
  }, [history])

  /* ── Module temperature chart data ── */
  const moduleTempData = useMemo(() => {
    if (!history?.length) return []
    return history.slice().reverse().map(d => ({
      time: fmtTime(d.created_at),
      max: d.module_temp_max != null ? convertTemp(d.module_temp_max) : null,
      min: d.module_temp_min != null ? convertTemp(d.module_temp_min) : null,
    }))
  }, [history, convertTemp])

  /* ── Power flow chart data ── */
  const powerFlowData = useMemo(() => {
    if (!history?.length) return []
    return history.slice().reverse().map(d => ({
      time: fmtTime(d.created_at),
      dc: d.dc_charging_power ?? null,
      ac: d.ac_charging_power ?? null,
      energy: d.energy_remaining ?? null,
    }))
  }, [history])

  /* ── Charging rate chart data ── */
  const chargingRateData = useMemo(() => {
    if (!history?.length) return []
    return history.slice().reverse().map(d => ({
      time: fmtTime(d.created_at),
      rate: d.charge_rate_mph ?? null,
      ttf: d.time_to_full_charge ?? null,
    }))
  }, [history])

  /* ── Pack voltage / current chart data ── */
  const packData = useMemo(() => {
    if (!history?.length) return []
    return history.slice().reverse().map(d => ({
      time: fmtTime(d.created_at),
      voltage: d.pack_voltage ?? null,
      current: d.pack_current ?? null,
    }))
  }, [history])

  /* ── Summary statistics ── */
  const stats = useMemo(() => {
    if (!history?.length) return null
    const nums = (arr: (number | undefined | null)[]) => arr.filter((v): v is number => typeof v === 'number')
    const avg = (a: number[]) => a.length ? a.reduce((s, v) => s + v, 0) / a.length : null
    const max = (a: number[]) => a.length ? Math.max(...a) : null
    const min = (a: number[]) => a.length ? Math.min(...a) : null

    const voltages = nums(history.map(d => d.pack_voltage))
    const currents = nums(history.map(d => d.pack_current))
    const energies = nums(history.map(d => d.energy_remaining))
    const socVals = nums(history.map(d => d.soc ?? d.battery_level))
    const dcPowers = nums(history.map(d => d.dc_charging_power))
    const chargeRates = nums(history.map(d => d.charge_rate_mph))

    return {
      avgVoltage: avg(voltages),
      peakCurrent: max(currents),
      avgEnergy: avg(energies),
      avgSoc: avg(socVals),
      peakDcPower: max(dcPowers),
      avgChargeRate: avg(chargeRates),
      minVoltage: min(voltages),
      maxVoltage: max(voltages),
    }
  }, [history])

  /* ── Derived indicators ── */
  const cellSpread = latest?.brick_voltage_max != null && latest?.brick_voltage_min != null
    ? (latest.brick_voltage_max - latest.brick_voltage_min) * 1000
    : null
  const cellHealthy = cellSpread != null && cellSpread < 30

  const hasPowershare = latest?.powershare_status != null && latest.powershare_status !== ''

  const noData = !isLoading && (!history || history.length === 0)

  /* ═══════════════════ Render ═══════════════════ */
  return (
    <FadeIn>
      {/* ── 1. Header + Vehicle Selector ── */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 sm:gap-0 mb-6 sm:mb-8">
        <PageHeader
          title="Energy Flow"
          subtitle="Battery pack voltage, current, cell balance, and power flow"
          icon={<Zap className="h-7 w-7 text-neon-cyan" />}
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

      {/* ── Empty state ── */}
      {noData && (
        <GlassPanel className="p-12 text-center">
          <Zap className="h-12 w-12 mx-auto mb-4 text-[var(--text-muted)]" />
          <p className="text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>No Energy Data</p>
          <p className="text-sm mt-2" style={{ color: 'var(--text-muted)' }}>
            Charging telemetry will appear here once the vehicle reports battery data.
          </p>
        </GlassPanel>
      )}

      {/* ── 3. Live Pack Status — 4 gauge cards ── */}
      {isLoading ? (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4 mb-6 sm:mb-8">
          {[1, 2, 3, 4].map(i => <Skeleton key={i} className="h-48 rounded-xl" />)}
        </div>
      ) : !noData && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4 mb-6 sm:mb-8">
          <StatusGauge label="Pack Voltage" value={latest?.pack_voltage} unit="V" min={300} max={420} color="text-neon-cyan" formatValue={v => v.toFixed(1)} />
          <StatusGauge label="Pack Current" value={latest?.pack_current} unit="A" min={-50} max={300} color="text-neon-green" formatValue={v => v.toFixed(1)} />
          <StatusGauge label="Energy Remaining" value={latest?.energy_remaining} unit="kWh" min={0} max={100} color="text-yellow-400" formatValue={v => v.toFixed(1)} />
          <StatusGauge label="State of Charge" value={latest?.soc ?? latest?.battery_level} unit="%" min={0} max={100} color="text-purple-400" formatValue={v => v.toFixed(0)} />
        </div>
      )}

      {/* ── 4. Power Flow Panel ── */}
      {!noData && (
        <GlassPanel className="p-4 sm:p-6 mb-6 sm:mb-8">
          <h3 className="text-sm font-semibold mb-4" style={{ color: 'var(--text-primary)' }}>
            <Zap className="inline h-4 w-4 mr-1.5 text-neon-cyan" />Power Flow
          </h3>
          <div className="flex justify-center mb-6">
            <PowerFlowArrow dcPower={latest?.dc_charging_power} acPower={latest?.ac_charging_power} energyRemaining={latest?.energy_remaining} />
          </div>
          {/* Charging info row */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="glass-card p-3 text-center">
              <p className="text-[10px] uppercase tracking-wider" style={{ color: 'var(--text-secondary)' }}>DC Power</p>
              <p className="text-lg font-bold text-neon-cyan">{latest?.dc_charging_power != null ? `${latest.dc_charging_power.toFixed(1)} kW` : '--'}</p>
            </div>
            <div className="glass-card p-3 text-center">
              <p className="text-[10px] uppercase tracking-wider" style={{ color: 'var(--text-secondary)' }}>AC Power</p>
              <p className="text-lg font-bold text-purple-400">{latest?.ac_charging_power != null ? `${latest.ac_charging_power.toFixed(1)} kW` : '--'}</p>
            </div>
            <div className="glass-card p-3 text-center">
              <p className="text-[10px] uppercase tracking-wider" style={{ color: 'var(--text-secondary)' }}>Charger Voltage</p>
              <p className="text-lg font-bold text-yellow-400">{latest?.charger_voltage != null ? `${latest.charger_voltage.toFixed(1)} V` : '--'}</p>
            </div>
            <div className="glass-card p-3 text-center">
              <p className="text-[10px] uppercase tracking-wider" style={{ color: 'var(--text-secondary)' }}>Charge Amps</p>
              <p className="text-lg font-bold text-neon-green">{latest?.charge_amps != null ? `${latest.charge_amps.toFixed(1)} A` : '--'}</p>
            </div>
          </div>
          {/* Power flow chart */}
          {powerFlowData.length > 0 && (
            <div className="mt-6">
              <ResponsiveContainer width="100%" height={240}>
                <AreaChart data={powerFlowData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--glass-border)" strokeOpacity={0.5} />
                  <XAxis dataKey="time" tick={{ fontSize: 10, fill: 'var(--text-muted)' }} />
                  <YAxis tick={{ fontSize: 10, fill: 'var(--text-muted)' }} />
                  <Tooltip content={<EnergyTooltip unit="kW" />} />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <Area type="monotone" dataKey="dc" name="DC Power" stroke="#00f0ff" fill="#00f0ff" fillOpacity={0.15} strokeWidth={2} dot={false} connectNulls />
                  <Area type="monotone" dataKey="ac" name="AC Power" stroke="#a855f7" fill="#a855f7" fillOpacity={0.15} strokeWidth={2} dot={false} connectNulls />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          )}
        </GlassPanel>
      )}

      {/* ── 5. Cell Voltage Spread ── */}
      {!noData && (
        <GlassPanel className="p-4 sm:p-6 mb-6 sm:mb-8">
          <h3 className="text-sm font-semibold mb-4" style={{ color: 'var(--text-primary)' }}>
            <Battery className="inline h-4 w-4 mr-1.5 text-yellow-400" />Cell Voltage Spread
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
            <div className="glass-card p-4 text-center">
              <p className="text-[10px] uppercase tracking-wider" style={{ color: 'var(--text-secondary)' }}>Brick Max</p>
              <p className="text-2xl font-bold text-neon-cyan">
                {latest?.brick_voltage_max != null ? `${latest.brick_voltage_max.toFixed(3)} V` : '--'}
              </p>
              {latest?.num_brick_voltage_max != null && (
                <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>Brick #{latest.num_brick_voltage_max}</p>
              )}
            </div>
            <div className="glass-card p-4 text-center">
              <p className="text-[10px] uppercase tracking-wider" style={{ color: 'var(--text-secondary)' }}>Brick Min</p>
              <p className="text-2xl font-bold text-purple-400">
                {latest?.brick_voltage_min != null ? `${latest.brick_voltage_min.toFixed(3)} V` : '--'}
              </p>
              {latest?.num_brick_voltage_min != null && (
                <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>Brick #{latest.num_brick_voltage_min}</p>
              )}
            </div>
            <div className="glass-card p-4 text-center">
              <p className="text-[10px] uppercase tracking-wider" style={{ color: 'var(--text-secondary)' }}>Spread</p>
              <p className={clsx('text-2xl font-bold', cellHealthy ? 'text-neon-green' : cellSpread != null ? 'text-neon-amber' : 'text-[var(--text-muted)]')}>
                {cellSpread != null ? `${cellSpread.toFixed(1)} mV` : '--'}
              </p>
              <div className="flex items-center justify-center gap-1.5 mt-1">
                {cellSpread != null ? cellHealthy ? (
                  <><CheckCircle className="h-3.5 w-3.5 text-neon-green" /><span className="text-xs text-neon-green">Healthy</span></>
                ) : (
                  <><AlertTriangle className="h-3.5 w-3.5 text-neon-amber" /><span className="text-xs text-neon-amber">Check Balance</span></>
                ) : (
                  <span className="text-xs text-[var(--text-muted)]">No data</span>
                )}
              </div>
            </div>
          </div>
          {cellVoltageData.length > 0 && (
            <ResponsiveContainer width="100%" height={260}>
              <LineChart data={cellVoltageData}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--glass-border)" strokeOpacity={0.5} />
                <XAxis dataKey="time" tick={{ fontSize: 10, fill: 'var(--text-muted)' }} />
                <YAxis yAxisId="v" tick={{ fontSize: 10, fill: 'var(--text-muted)' }} domain={['auto', 'auto']} />
                <YAxis yAxisId="mv" orientation="right" tick={{ fontSize: 10, fill: 'var(--text-muted)' }} />
                <Tooltip content={<EnergyTooltip />} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Line yAxisId="v" type="monotone" dataKey="max" name="Max (V)" stroke="#00f0ff" strokeWidth={2} dot={false} connectNulls />
                <Line yAxisId="v" type="monotone" dataKey="min" name="Min (V)" stroke="#a855f7" strokeWidth={2} dot={false} connectNulls />
                <Line yAxisId="mv" type="monotone" dataKey="spread" name="Spread (mV)" stroke="#f59e0b" strokeWidth={2} dot={false} connectNulls />
              </LineChart>
            </ResponsiveContainer>
          )}
        </GlassPanel>
      )}

      {/* ── 6. Module Temperature ── */}
      {!noData && (
        <GlassPanel className="p-4 sm:p-6 mb-6 sm:mb-8">
          <h3 className="text-sm font-semibold mb-4" style={{ color: 'var(--text-primary)' }}>
            <Thermometer className="inline h-4 w-4 mr-1.5 text-red-400" />Module Temperature
          </h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-6">
            <div className="glass-card p-4 text-center">
              <p className="text-[10px] uppercase tracking-wider" style={{ color: 'var(--text-secondary)' }}>Max Module Temp</p>
              <p className="text-2xl font-bold text-red-400">
                {latest?.module_temp_max != null ? `${convertTemp(latest.module_temp_max).toFixed(1)} ${tempUnit}` : '--'}
              </p>
              {latest?.num_module_temp_max != null && (
                <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>Module #{latest.num_module_temp_max}</p>
              )}
            </div>
            <div className="glass-card p-4 text-center">
              <p className="text-[10px] uppercase tracking-wider" style={{ color: 'var(--text-secondary)' }}>Min Module Temp</p>
              <p className="text-2xl font-bold text-blue-400">
                {latest?.module_temp_min != null ? `${convertTemp(latest.module_temp_min).toFixed(1)} ${tempUnit}` : '--'}
              </p>
              {latest?.num_module_temp_min != null && (
                <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>Module #{latest.num_module_temp_min}</p>
              )}
            </div>
          </div>
          {moduleTempData.length > 0 && (
            <ResponsiveContainer width="100%" height={260}>
              <LineChart data={moduleTempData}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--glass-border)" strokeOpacity={0.5} />
                <XAxis dataKey="time" tick={{ fontSize: 10, fill: 'var(--text-muted)' }} />
                <YAxis tick={{ fontSize: 10, fill: 'var(--text-muted)' }} />
                <Tooltip content={<EnergyTooltip unit={tempUnit} />} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Line type="monotone" dataKey="max" name="Max Temp" stroke="#ef4444" strokeWidth={2} dot={false} connectNulls />
                <Line type="monotone" dataKey="min" name="Min Temp" stroke="#3b82f6" strokeWidth={2} dot={false} connectNulls />
              </LineChart>
            </ResponsiveContainer>
          )}
        </GlassPanel>
      )}

      {/* ── 7. BMS Status Cards ── */}
      {!noData && (
        <div className="mb-6 sm:mb-8">
          <h3 className="text-sm font-semibold mb-4" style={{ color: 'var(--text-primary)' }}>
            <Shield className="inline h-4 w-4 mr-1.5 text-neon-green" />BMS Status
          </h3>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
            {/* BMS State */}
            <div className="glass-card p-4 flex items-center gap-3">
              <div className="p-2 rounded-lg bg-neon-cyan/10">
                <Activity className="h-5 w-5 text-neon-cyan" />
              </div>
              <div>
                <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>BMS State</p>
                <p className="text-sm font-semibold text-neon-cyan">{latest?.bms_state ?? 'Unknown'}</p>
              </div>
            </div>
            <BmsIndicator label="Full Charge Complete" active={latest?.bms_fullcharge_complete} icon={CheckCircle} />
            <BmsIndicator label="Battery Heater" active={latest?.battery_heater_on} icon={Thermometer} />
            <BmsIndicator label="DCDC Enable" active={latest?.dcdc_enable} icon={Zap} />
            {/* Isolation resistance */}
            <div className="glass-card p-4 flex items-center gap-3">
              <div className="p-2 rounded-lg bg-yellow-400/10">
                <Shield className="h-5 w-5 text-yellow-400" />
              </div>
              <div>
                <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>Isolation Ω</p>
                <p className="text-sm font-semibold text-yellow-400">
                  {latest?.isolation_resistance != null ? `${latest.isolation_resistance.toLocaleString()} kΩ` : '--'}
                </p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── 8. Powershare Panel ── */}
      {hasPowershare && (
        <GlassPanel className="p-4 sm:p-6 mb-6 sm:mb-8">
          <h3 className="text-sm font-semibold mb-4" style={{ color: 'var(--text-primary)' }}>
            <BatteryCharging className="inline h-4 w-4 mr-1.5 text-emerald-400" />Powershare
          </h3>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="glass-card p-4 text-center">
              <p className="text-[10px] uppercase tracking-wider" style={{ color: 'var(--text-secondary)' }}>Status</p>
              <p className="text-lg font-bold text-emerald-400">{latest?.powershare_status}</p>
            </div>
            <div className="glass-card p-4 text-center">
              <p className="text-[10px] uppercase tracking-wider" style={{ color: 'var(--text-secondary)' }}>Type</p>
              <p className="text-lg font-bold text-neon-cyan">{latest?.powershare_type ?? '--'}</p>
            </div>
            <div className="glass-card p-4 text-center">
              <p className="text-[10px] uppercase tracking-wider" style={{ color: 'var(--text-secondary)' }}>Hours Left</p>
              <p className="text-lg font-bold text-yellow-400">
                {latest?.powershare_hours_left != null ? `${latest.powershare_hours_left.toFixed(1)} h` : '--'}
              </p>
            </div>
            <div className="glass-card p-4 text-center">
              <p className="text-[10px] uppercase tracking-wider" style={{ color: 'var(--text-secondary)' }}>Power</p>
              <p className="text-lg font-bold text-purple-400">
                {latest?.powershare_power_kw != null ? `${latest.powershare_power_kw.toFixed(1)} kW` : '--'}
              </p>
            </div>
          </div>
          {latest?.powershare_stop_reason && (
            <div className="mt-4 flex items-center gap-2 rounded-lg border border-neon-amber/30 bg-neon-amber/5 p-3">
              <AlertTriangle className="h-4 w-4 text-neon-amber shrink-0" />
              <p className="text-xs text-neon-amber">Stop reason: {latest.powershare_stop_reason}</p>
            </div>
          )}
        </GlassPanel>
      )}

      {/* ── Pack Voltage & Current Trends ── */}
      {!noData && packData.length > 0 && (
        <GlassPanel className="p-4 sm:p-6 mb-6 sm:mb-8">
          <h3 className="text-sm font-semibold mb-4" style={{ color: 'var(--text-primary)' }}>
            <Gauge className="inline h-4 w-4 mr-1.5 text-neon-cyan" />Pack Voltage &amp; Current
          </h3>
          <ResponsiveContainer width="100%" height={280}>
            <LineChart data={packData}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--glass-border)" strokeOpacity={0.5} />
              <XAxis dataKey="time" tick={{ fontSize: 10, fill: 'var(--text-muted)' }} />
              <YAxis yAxisId="v" tick={{ fontSize: 10, fill: 'var(--text-muted)' }} domain={['auto', 'auto']} />
              <YAxis yAxisId="a" orientation="right" tick={{ fontSize: 10, fill: 'var(--text-muted)' }} />
              <Tooltip content={<EnergyTooltip />} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Line yAxisId="v" type="monotone" dataKey="voltage" name="Voltage (V)" stroke="#00f0ff" strokeWidth={2} dot={false} connectNulls />
              <Line yAxisId="a" type="monotone" dataKey="current" name="Current (A)" stroke="#10b981" strokeWidth={2} dot={false} connectNulls />
            </LineChart>
          </ResponsiveContainer>
        </GlassPanel>
      )}

      {/* ── 9. Charging Rate Trends ── */}
      {!noData && chargingRateData.length > 0 && (
        <GlassPanel className="p-4 sm:p-6 mb-6 sm:mb-8">
          <h3 className="text-sm font-semibold mb-4" style={{ color: 'var(--text-primary)' }}>
            <Activity className="inline h-4 w-4 mr-1.5 text-emerald-400" />Charging Rate Trends
          </h3>
          <ResponsiveContainer width="100%" height={280}>
            <LineChart data={chargingRateData}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--glass-border)" strokeOpacity={0.5} />
              <XAxis dataKey="time" tick={{ fontSize: 10, fill: 'var(--text-muted)' }} />
              <YAxis yAxisId="rate" tick={{ fontSize: 10, fill: 'var(--text-muted)' }} />
              <YAxis yAxisId="hours" orientation="right" tick={{ fontSize: 10, fill: 'var(--text-muted)' }} />
              <Tooltip content={<EnergyTooltip />} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Line yAxisId="rate" type="monotone" dataKey="rate" name="Charge Rate (mi/h)" stroke="#10b981" strokeWidth={2} dot={false} connectNulls />
              <Line yAxisId="hours" type="monotone" dataKey="ttf" name="Time to Full (h)" stroke="#f59e0b" strokeWidth={2} dot={false} connectNulls />
            </LineChart>
          </ResponsiveContainer>
        </GlassPanel>
      )}

      {/* ── 10. Summary Stats ── */}
      {stats && (
        <div className="mb-6 sm:mb-8">
          <h3 className="text-sm font-semibold mb-4" style={{ color: 'var(--text-primary)' }}>
            <Gauge className="inline h-4 w-4 mr-1.5 text-purple-400" />Summary
          </h3>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
            <StatCard label="Avg Voltage" value={stats.avgVoltage} unit="V" color="text-neon-cyan" />
            <StatCard label="Peak Current" value={stats.peakCurrent} unit="A" color="text-neon-green" />
            <StatCard label="Avg Energy" value={stats.avgEnergy} unit="kWh" color="text-yellow-400" />
            <StatCard label="Avg SOC" value={stats.avgSoc} unit="%" color="text-purple-400" />
            <StatCard label="Peak DC Power" value={stats.peakDcPower} unit="kW" color="text-neon-cyan" />
            <StatCard label="Avg Charge Rate" value={stats.avgChargeRate} unit="mi/h" color="text-emerald-400" />
          </div>
        </div>
      )}
    </FadeIn>
  )
}
