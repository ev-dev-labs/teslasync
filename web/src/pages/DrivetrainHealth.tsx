import { useState, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { getVehicles, getMotorData, getMotorLatest } from '../api'
import { PageHeader, GlassPanel, FadeIn, Skeleton, MetricCard, ChartContainer, AlertBanner, Select } from '../components/ui'
import { Cog, Thermometer, Activity, Gauge, AlertTriangle, CheckCircle, TrendingUp, Zap, Shield } from 'lucide-react'
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts'
import clsx from 'clsx'
import { useSettings } from '../hooks/useSettings'
import { useVehicleLive } from '../hooks/useVehicleLive'
import { cleanNil } from '../lib/cleanNil'
import { fmtNumber, fmtPercent, fmtInt } from '../lib/numberFormat'
import { formatDateTime } from '../lib/dateFormat'
import { usePageTitle } from '../hooks/usePageTitle'

/* ─── Chart tooltip (matches TirePressure pattern) ─── */
interface DrivetrainTooltipPayload { name: string; value: number; color?: string }
function DrivetrainTooltip({ active, payload, label, unit = '' }: { active?: boolean; payload?: DrivetrainTooltipPayload[]; label?: string; unit?: string }) {
  if (!active || !payload?.length) return null
  return (
    <div className="glass-panel p-3 text-xs" style={{ background: 'var(--surface-2)', borderColor: 'var(--glass-border)' }}>
      <p style={{ color: 'var(--text-secondary)' }} className="mb-1">{label}</p>
      {payload.map(p => (
        <p key={p.name} style={{ color: 'var(--text-primary)' }}>
          <span style={{ color: p.color }}>●</span> {p.name}: {fmtNumber(p.value)} {unit}
        </p>
      ))}
    </div>
  )
}

/* ─── Temperature color coding ─── */
function tempColor(celsius: number | null | undefined): 'text-neon-green' | 'text-neon-amber' | 'text-neon-red' | 'text-[var(--text-muted)]' {
  if (celsius == null) return 'text-[var(--text-muted)]'
  if (celsius < 60) return 'text-neon-green'
  if (celsius < 80) return 'text-neon-amber'
  return 'text-neon-red'
}
function tempBg(celsius: number | null | undefined) {
  if (celsius == null) return 'bg-white/5'
  if (celsius < 60) return 'bg-neon-green/10'
  if (celsius < 80) return 'bg-neon-amber/10'
  return 'bg-neon-red/10'
}
function tempLabel(celsius: number | null | undefined) {
  if (celsius == null) return 'N/A'
  if (celsius < 60) return 'Normal'
  if (celsius < 80) return 'Warm'
  return 'Hot'
}

/* ─── Motor card component ─── */
function MotorCard({ name, statorTemp, heatsinkTemp, inverterTemp, current, axleSpeed, state, vBat, torque, convertTemp, tempUnit }: {
  name: string
  statorTemp: number | null | undefined
  heatsinkTemp: number | null | undefined
  inverterTemp: number | null | undefined
  current: number | null | undefined
  axleSpeed: number | null | undefined
  state: string | null | undefined
  vBat: number | null | undefined
  torque: number | null | undefined
  convertTemp: (c: number) => number
  tempUnit: string
}) {
  const statorColor = tempColor(statorTemp)
  const heatsinkColor = tempColor(heatsinkTemp)
  const inverterColor = tempColor(inverterTemp)

  const fmtTemp = (c: number | null | undefined) =>
    c != null ? `${fmtNumber(convertTemp(c))} ${tempUnit}` : '--'

  const worstTemp = [statorTemp, heatsinkTemp, inverterTemp].filter((t): t is number => t != null)
  const peakCelsius = worstTemp.length ? Math.max(...worstTemp) : null
  const overallColor = tempColor(peakCelsius)
  const overallBg = tempBg(peakCelsius)

  return (
    <GlassPanel className={clsx('p-4 sm:p-5 relative overflow-hidden')}>
      {/* Top accent bar */}
      <div className={clsx('absolute top-0 left-0 right-0 h-1', overallBg)} />
      <div className="flex items-center gap-2 mb-4">
        <div className={clsx('p-2 rounded-lg', overallBg)}>
          <Cog className={clsx('h-5 w-5', overallColor)} />
        </div>
        <div>
          <p className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>{name}</p>
          <p className={clsx('text-xs font-medium', overallColor)}>{tempLabel(peakCelsius)}</p>
        </div>
      </div>

      <div className="space-y-3">
        {/* Stator */}
        <div className="flex items-center justify-between">
          <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>Stator Temp</span>
          <span className={clsx('text-sm font-semibold', statorColor)}>{fmtTemp(statorTemp)}</span>
        </div>
        {/* Heatsink */}
        <div className="flex items-center justify-between">
          <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>Heatsink Temp</span>
          <span className={clsx('text-sm font-semibold', heatsinkColor)}>{fmtTemp(heatsinkTemp)}</span>
        </div>
        {/* Inverter */}
        <div className="flex items-center justify-between">
          <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>Inverter Temp</span>
          <span className={clsx('text-sm font-semibold', inverterColor)}>{fmtTemp(inverterTemp)}</span>
        </div>
        {/* Current */}
        <div className="flex items-center justify-between">
          <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>Current</span>
          <span className="text-sm font-semibold text-neon-cyan">{current != null ? `${fmtNumber(current)} A` : '--'}</span>
        </div>
        {/* Axle Speed */}
        <div className="flex items-center justify-between">
          <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>Axle Speed</span>
          <span className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>{axleSpeed != null ? `${fmtInt(axleSpeed)} RPM` : '--'}</span>
        </div>
        {/* Torque */}
        <div className="flex items-center justify-between">
          <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>Torque</span>
          <span className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>{torque != null ? `${fmtNumber(torque)} Nm` : '--'}</span>
        </div>
        {/* Battery Voltage */}
        <div className="flex items-center justify-between">
          <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>Battery Voltage</span>
          <span className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>{vBat != null ? `${fmtNumber(vBat)} V` : '--'}</span>
        </div>
        {/* State */}
        <div className="flex items-center justify-between">
          <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>Inverter State</span>
          <span className={clsx('text-xs px-2 py-0.5 rounded-full font-medium',
            state === 'Enabled' ? 'bg-neon-green/10 text-neon-green'
            : state === 'Standby' ? 'bg-neon-amber/10 text-neon-amber'
            : 'bg-white/5 text-[var(--text-muted)]'
          )}>{state ?? '--'}</span>
        </div>
      </div>

      {/* Gauge ring */}
      {peakCelsius != null && (
        <div className="flex justify-center mt-4">
          <div className="relative w-16 h-16 flex items-center justify-center">
            <svg className="absolute inset-0 w-full h-full -rotate-90" viewBox="0 0 100 100">
              <circle cx="50" cy="50" r="42" fill="none" stroke="currentColor" strokeWidth="5" className="text-white/5" />
              <circle cx="50" cy="50" r="42" fill="none" stroke="currentColor" strokeWidth="5"
                strokeDasharray={`${Math.min(100, (peakCelsius / 120) * 100) * 2.64} 264`}
                strokeLinecap="round" className={overallColor} />
            </svg>
            <span className={clsx('text-xs font-bold', overallColor)}>{fmtInt(convertTemp(peakCelsius))}°</span>
          </div>
        </div>
      )}
    </GlassPanel>
  )
}

/* ─── Status badge ─── */
function StatusBadge({ label, value, color = 'text-neon-cyan' }: { label: string; value: string | undefined | null; color?: string }) {
  return (
    <GlassPanel className="p-4 flex items-center gap-3">
      <div className={clsx('px-3 py-1 rounded-full text-xs font-semibold', color,
        color === 'text-neon-green' ? 'bg-neon-green/10' :
        color === 'text-neon-red' ? 'bg-neon-red/10' :
        color === 'text-neon-amber' ? 'bg-neon-amber/10' : 'bg-neon-cyan/10'
      )}>
        {value ?? 'Unknown'}
      </div>
      <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>{label}</span>
    </GlassPanel>
  )
}

/* ═══════════════════════════════════════════════════════
   Main Component
   ═══════════════════════════════════════════════════════ */
export default function DrivetrainHealth() {
  usePageTitle('Drivetrain Health')
  const { data: vehicles } = useQuery({ queryKey: ['vehicles'], queryFn: getVehicles })
  const [selectedVehicle, setSelectedVehicle] = useState<number | null>(null)
  const vehicleId = selectedVehicle ?? vehicles?.[0]?.id ?? null
  const { state: live } = useVehicleLive(vehicleId ?? undefined)
  const { convertTemp, convertSpeed, tempUnit, speedUnit } = useSettings()

  /* ── Latest motor snapshot ── */
  const { data: latest } = useQuery({
    queryKey: ['motor-latest', vehicleId],
    queryFn: () => getMotorLatest(vehicleId!),
    enabled: vehicleId !== null,
    refetchInterval: 5000,
  })

  /* ── Motor history ── */
  const { data: history, isLoading } = useQuery({
    queryKey: ['motor-history', vehicleId],
    queryFn: () => getMotorData(vehicleId!, 200),
    enabled: vehicleId !== null,
    refetchInterval: 5000,
  })

  /* ── Formatted timestamp helper ── */
  const fmtTime = (iso: string) => formatDateTime(iso)

  /* ── Torque chart data ── */
  const torqueData = useMemo(() => {
    if (!history?.length) return []
    return history.slice().reverse().map(d => ({
      time: fmtTime(d.created_at),
      torque: d.di_torque ?? null,
    }))
  }, [history])

  /* ── Stator temp chart data ── */
  const statorTempData = useMemo(() => {
    if (!history?.length) return []
    return history.slice().reverse().map(d => ({
      time: fmtTime(d.created_at),
      stator: d.di_stator_temp != null ? convertTemp(d.di_stator_temp) : null,
    }))
  }, [history, convertTemp])

  /* ── Vehicle speed chart data ── */
  const speedData = useMemo(() => {
    if (!history?.length) return []
    return history.slice().reverse().map(d => ({
      time: fmtTime(d.created_at),
      speed: d.vehicle_speed ?? null,
      axle: d.di_axle_speed ?? null,
    }))
  }, [history])

  /* ── Acceleration chart data ── */
  const accelData = useMemo(() => {
    if (!history?.length) return []
    return history.slice().reverse().map(d => ({
      time: fmtTime(d.created_at),
      lateral: d.lateral_accel ?? null,
      longitudinal: d.longitudinal_accel ?? null,
    }))
  }, [history])

  /* ── Pedal position chart data ── */
  const pedalData = useMemo(() => {
    if (!history?.length) return []
    return history.slice().reverse().map(d => ({
      time: fmtTime(d.created_at),
      pedal: d.pedal_position ?? null,
      brake: d.brake_pedal === true ? 100 : 0,
    }))
  }, [history])

  /* ── Summary statistics ── */
  const stats = useMemo(() => {
    if (!history?.length) return null
    const nums = (arr: (number | undefined | null)[]) => arr.filter((v): v is number => typeof v === 'number')
    const avg = (a: number[]) => a.length ? a.reduce((s, v) => s + v, 0) / a.length : null
    const max = (a: number[]) => a.length ? Math.max(...a) : null
    const min = (a: number[]) => a.length ? Math.min(...a) : null

    const torques = nums(history.map(d => d.di_torque))
    const statorTemps = nums(history.map(d => d.di_stator_temp))
    const speeds = nums(history.map(d => d.vehicle_speed))
    const axleSpeeds = nums(history.map(d => d.di_axle_speed))
    const latAccels = nums(history.map(d => d.lateral_accel))
    const longAccels = nums(history.map(d => d.longitudinal_accel))

    return {
      peakTorque: max(torques),
      avgTorque: avg(torques),
      peakStatorTemp: max(statorTemps),
      avgStatorTemp: avg(statorTemps),
      minStatorTemp: min(statorTemps),
      peakSpeed: max(speeds),
      avgSpeed: avg(speeds),
      peakAxleSpeed: max(axleSpeeds),
      peakLatAccel: max(latAccels.map(Math.abs)),
      peakLongAccel: max(longAccels.map(Math.abs)),
      avgLongAccel: avg(longAccels),
      totalSnapshots: history.length,
    }
  }, [history])

  /* ── Motor positions: map available data to motor cards ── */
  const motors = useMemo(() => [
    { name: 'Front Motor', stator: latest?.di_stator_temp_f ?? null, heatsink: latest?.di_heatsink_t_f ?? null, inverter: latest?.di_inverter_t_f ?? null, current: latest?.di_motor_current_f ?? null, axleSpeed: latest?.di_axle_speed_f ?? null, state: cleanNil(latest?.di_state_f), vBat: latest?.di_v_bat_f ?? null, torque: latest?.di_torque_actual_f ?? null },
    { name: 'Rear Motor', stator: latest?.di_stator_temp ?? null, heatsink: latest?.di_heatsink_t_r ?? null, inverter: latest?.di_inverter_t_r ?? null, current: latest?.di_motor_current_r ?? null, axleSpeed: latest?.di_axle_speed ?? null, state: cleanNil(latest?.di_state), vBat: latest?.di_v_bat_r ?? null, torque: latest?.di_torque_actual_r ?? null },
    { name: 'Rear-Left Motor', stator: latest?.di_stator_temp_rel ?? null, heatsink: latest?.di_heatsink_t_rel ?? null, inverter: latest?.di_inverter_t_rel ?? null, current: latest?.di_motor_current_rel ?? null, axleSpeed: latest?.di_axle_speed_rel ?? null, state: cleanNil(latest?.di_state_rel), vBat: latest?.di_v_bat_rel ?? null, torque: latest?.di_torque_actual_rel ?? null },
    { name: 'Rear-Right Motor', stator: latest?.di_stator_temp_rer ?? null, heatsink: latest?.di_heatsink_t_rer ?? null, inverter: latest?.di_inverter_t_rer ?? null, current: latest?.di_motor_current_rer ?? null, axleSpeed: latest?.di_axle_speed_rer ?? null, state: cleanNil(latest?.di_state_rer), vBat: latest?.di_v_bat_rer ?? null, torque: latest?.di_torque_actual_rer ?? null },
  ], [latest])

  /* ── Drive state helpers ── */
  const diStateColor = cleanNil(latest?.di_state) === 'drive' ? 'text-neon-green'
    : cleanNil(latest?.di_state) === 'idle' ? 'text-neon-cyan'
    : cleanNil(latest?.di_state) === 'charge' ? 'text-yellow-400'
    : 'text-[var(--text-muted)]'

  const gearValue = live.gear || cleanNil(latest?.gear)
  const gearColor = gearValue === 'D' ? 'text-neon-green'
    : gearValue === 'R' ? 'text-neon-amber'
    : gearValue === 'P' ? 'text-neon-cyan'
    : 'text-[var(--text-muted)]'

  const noData = !isLoading && (!history || history.length === 0)

  /* ═══════════════════ Render ═══════════════════ */
  return (
    <FadeIn>
      {/* ── 1. Header + Vehicle Selector ── */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 sm:gap-0 mb-6 sm:mb-8">
        <PageHeader
          title="Drivetrain Health"
          subtitle="Motor temperatures, currents, voltages, and thermal management"
          icon={<Cog className="h-7 w-7 text-neon-cyan" />}
        />
        {vehicles && vehicles.length > 1 && (
          <Select
            label="Vehicle"
            value={String(vehicleId ?? '')}
            onChange={e => setSelectedVehicle(Number(e.target.value))}
            options={vehicles.map(v => ({ value: String(v.id), label: v.display_name || v.vin }))}
          />
        )}
      </div>

      {/* ── Empty state ── */}
      {noData && (
        <GlassPanel className="p-12 text-center">
          <Cog className="h-12 w-12 mx-auto mb-4 text-[var(--text-muted)]" />
          <p className="text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>No Drivetrain Data</p>
          <p className="text-sm mt-2" style={{ color: 'var(--text-muted)' }}>
            Motor telemetry will appear here once the vehicle reports drivetrain data.
          </p>
        </GlassPanel>
      )}

      {/* ── 3. Motor Overview Cards ── */}
      {isLoading ? (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4 mb-6 sm:mb-8">
          {[1, 2, 3, 4].map(i => <Skeleton key={i} className="h-64 rounded-xl" />)}
        </div>
      ) : !noData && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4 mb-6 sm:mb-8">
          {motors.map(m => (
            <MotorCard
              key={m.name}
              name={m.name}
              statorTemp={m.stator}
              heatsinkTemp={m.heatsink}
              inverterTemp={m.inverter}
              current={m.current}
              axleSpeed={m.axleSpeed}
              state={m.state}
              vBat={m.vBat}
              torque={m.torque}
              convertTemp={convertTemp}
              tempUnit={tempUnit}
            />
          ))}
        </div>
      )}

      {/* ── Live drive state row ── */}
      {!noData && latest && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6 sm:mb-8">
          <StatusBadge label="Drive Inverter State" value={cleanNil(latest.di_state)} color={diStateColor} />
          <StatusBadge label="Gear" value={gearValue} color={gearColor} />
          <GlassPanel className="p-4 flex items-center gap-3">
            <div className="p-2 rounded-lg bg-neon-cyan/10">
              <Activity className="h-5 w-5 text-neon-cyan" />
            </div>
            <div>
              <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>Vehicle Speed</p>
              <p className="text-sm font-semibold text-neon-cyan">
                {live.speed || latest.vehicle_speed != null ? `${fmtNumber(convertSpeed(live.speed || latest.vehicle_speed!))} ${speedUnit}` : '--'}
              </p>
            </div>
          </GlassPanel>
          <GlassPanel className="p-4 flex items-center gap-3">
            <div className="p-2 rounded-lg bg-yellow-400/10">
              <TrendingUp className="h-5 w-5 text-yellow-400" />
            </div>
            <div>
              <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>Axle Speed</p>
              <p className="text-sm font-semibold text-yellow-400">
                {latest.di_axle_speed != null ? `${fmtInt(latest.di_axle_speed)} RPM` : '--'}
              </p>
            </div>
          </GlassPanel>
        </div>
      )}

      {/* ── Powertrain command signals ── */}
      {!noData && latest && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6 sm:mb-8">
          <GlassPanel className="p-4 flex items-center gap-3">
            <div className="p-2 rounded-lg bg-neon-purple/10">
              <Cog className="h-5 w-5 text-neon-purple" />
            </div>
            <div>
              <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>Motor Torque Cmd</p>
              <p className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
                {latest.di_torque != null ? `${fmtNumber(latest.di_torque)} Nm` : '--'}
              </p>
            </div>
          </GlassPanel>
          <GlassPanel className="p-4 flex items-center gap-3">
            <div className="p-2 rounded-lg bg-neon-amber/10">
              <Cog className="h-5 w-5 text-neon-amber" />
            </div>
            <div>
              <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>Slave Torque Cmd</p>
              <p className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
                {latest.di_slave_torque_cmd != null ? `${fmtNumber(latest.di_slave_torque_cmd)} Nm` : '--'}
              </p>
            </div>
          </GlassPanel>
          <GlassPanel className="p-4 flex items-center gap-3">
            <div className="p-2 rounded-lg bg-neon-cyan/10">
              <Gauge className="h-5 w-5 text-neon-cyan" />
            </div>
            <div>
              <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>Brake Pedal Pos</p>
              <p className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
                {latest.brake_pedal_pos != null ? `${fmtPercent(latest.brake_pedal_pos * 100)}` : '--'}
              </p>
            </div>
          </GlassPanel>
          <GlassPanel className="p-4 flex items-center gap-3">
            <div className={clsx('p-2 rounded-lg', cleanNil(latest.hvil) === 'Fault' ? 'bg-neon-red/10' : 'bg-neon-green/10')}>
              <Shield className={clsx('h-5 w-5', cleanNil(latest.hvil) === 'Fault' ? 'text-neon-red' : 'text-neon-green')} />
            </div>
            <div>
              <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>HV Interlock (HVIL)</p>
              <p className={clsx('text-sm font-semibold', cleanNil(latest.hvil) === 'Fault' ? 'text-neon-red' : 'text-neon-green')}>
                {cleanNil(latest.hvil) ?? '--'}
              </p>
            </div>
          </GlassPanel>
        </div>
      )}

      {/* ── 4. Torque Over Time ── */}
      {!noData && torqueData.length > 0 && (
        <ChartContainer title="Motor Torque" subtitle="Drive inverter torque output over time. Per-motor breakdown (Front/Rear/REL/RER) will display when available from the vehicle." className="mb-6 sm:mb-8" height={280}>
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={torqueData}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--glass-border)" strokeOpacity={0.5} />
              <XAxis dataKey="time" tick={{ fontSize: 10, fill: 'var(--text-muted)' }} />
              <YAxis tick={{ fontSize: 10, fill: 'var(--text-muted)' }} />
              <Tooltip content={<DrivetrainTooltip unit="Nm" />} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Line type="monotone" dataKey="torque" name="Torque" stroke="#00f0ff" strokeWidth={2} dot={false} connectNulls />
            </LineChart>
          </ResponsiveContainer>
        </ChartContainer>
      )}

      {/* ── 5. Stator Temperature Over Time ── */}
      {!noData && statorTempData.length > 0 && (
        <ChartContainer title="Stator Temperature" className="mb-6 sm:mb-8" height={280}>
          <div className="flex items-center gap-4 mb-4">
            {latest?.di_stator_temp != null && (
              <div className="flex items-center gap-2">
                <div className={clsx('w-3 h-3 rounded-full', tempBg(latest.di_stator_temp))} />
                <span className={clsx('text-sm font-semibold', tempColor(latest.di_stator_temp))}>
                  Current: {fmtNumber(convertTemp(latest.di_stator_temp))} {tempUnit}
                </span>
                <span className={clsx('text-xs px-2 py-0.5 rounded-full', tempBg(latest.di_stator_temp), tempColor(latest.di_stator_temp))}>
                  {tempLabel(latest.di_stator_temp)}
                </span>
              </div>
            )}
          </div>
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={statorTempData}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--glass-border)" strokeOpacity={0.5} />
              <XAxis dataKey="time" tick={{ fontSize: 10, fill: 'var(--text-muted)' }} />
              <YAxis tick={{ fontSize: 10, fill: 'var(--text-muted)' }} domain={['auto', 'auto']} />
              <Tooltip content={<DrivetrainTooltip unit={tempUnit} />} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Line type="monotone" dataKey="stator" name="Stator Temp" stroke="#ef4444" strokeWidth={2} dot={false} connectNulls />
            </LineChart>
          </ResponsiveContainer>
          <div className="flex items-center gap-4 mt-3 text-xs" style={{ color: 'var(--text-muted)' }}>
            <span><span className="inline-block w-2 h-2 rounded-full bg-neon-green mr-1" /> &lt; {fmtInt(convertTemp(60))}{tempUnit} Normal</span>
            <span><span className="inline-block w-2 h-2 rounded-full bg-neon-amber mr-1" /> {fmtInt(convertTemp(60))}–{fmtInt(convertTemp(80))}{tempUnit} Warm</span>
            <span><span className="inline-block w-2 h-2 rounded-full bg-neon-red mr-1" /> &gt; {fmtInt(convertTemp(80))}{tempUnit} Hot</span>
          </div>
        </ChartContainer>
      )}

      {/* ── 6. Heatsink Temperature ── */}
      {!noData && (
        <GlassPanel className="p-4 sm:p-6 mb-6 sm:mb-8">
          <h3 className="text-sm font-semibold mb-4" style={{ color: 'var(--text-primary)' }}>
            <Thermometer className="inline h-4 w-4 mr-1.5 text-orange-400" />Heatsink Temperature
          </h3>
          <div className="flex items-center justify-center h-40 text-[var(--text-muted)] text-sm">
            <div className="text-center">
              <Thermometer className="h-8 w-8 mx-auto mb-2 opacity-30" />
              <p>Per-motor heatsink temperature data will display when reported by the vehicle.</p>
            </div>
          </div>
        </GlassPanel>
      )}

      {/* ── 7. Inverter Temperature ── */}
      {!noData && (
        <GlassPanel className="p-4 sm:p-6 mb-6 sm:mb-8">
          <h3 className="text-sm font-semibold mb-4" style={{ color: 'var(--text-primary)' }}>
            <Zap className="inline h-4 w-4 mr-1.5 text-purple-400" />Inverter Temperature
          </h3>
          <div className="flex items-center justify-center h-40 text-[var(--text-muted)] text-sm">
            <div className="text-center">
              <Zap className="h-8 w-8 mx-auto mb-2 opacity-30" />
              <p>Per-motor inverter temperature data will display when reported by the vehicle.</p>
            </div>
          </div>
        </GlassPanel>
      )}

      {/* ── 8. Motor Current ── */}
      {!noData && (
        <GlassPanel className="p-4 sm:p-6 mb-6 sm:mb-8">
          <h3 className="text-sm font-semibold mb-4" style={{ color: 'var(--text-primary)' }}>
            <Activity className="inline h-4 w-4 mr-1.5 text-neon-cyan" />Motor Current
          </h3>
          <div className="flex items-center justify-center h-40 text-[var(--text-muted)] text-sm">
            <div className="text-center">
              <Activity className="h-8 w-8 mx-auto mb-2 opacity-30" />
              <p>Per-motor current data will display when reported by the vehicle.</p>
            </div>
          </div>
        </GlassPanel>
      )}

      {/* ── Vehicle Speed & Axle Speed ── */}
      {!noData && speedData.length > 0 && (
        <ChartContainer title="Speed &amp; Axle RPM" className="mb-6 sm:mb-8" height={280}>
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={speedData}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--glass-border)" strokeOpacity={0.5} />
              <XAxis dataKey="time" tick={{ fontSize: 10, fill: 'var(--text-muted)' }} />
              <YAxis yAxisId="speed" tick={{ fontSize: 10, fill: 'var(--text-muted)' }} />
              <YAxis yAxisId="rpm" orientation="right" tick={{ fontSize: 10, fill: 'var(--text-muted)' }} />
              <Tooltip content={<DrivetrainTooltip />} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Line yAxisId="speed" type="monotone" dataKey="speed" name="Vehicle Speed (km/h)" stroke="#10b981" strokeWidth={2} dot={false} connectNulls />
              <Line yAxisId="rpm" type="monotone" dataKey="axle" name="Axle Speed (RPM)" stroke="#f59e0b" strokeWidth={2} dot={false} connectNulls />
            </LineChart>
          </ResponsiveContainer>
        </ChartContainer>
      )}

      {/* ── Acceleration ── */}
      {!noData && accelData.length > 0 && (
        <ChartContainer title="Acceleration" className="mb-6 sm:mb-8" height={280}>
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={accelData}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--glass-border)" strokeOpacity={0.5} />
              <XAxis dataKey="time" tick={{ fontSize: 10, fill: 'var(--text-muted)' }} />
              <YAxis tick={{ fontSize: 10, fill: 'var(--text-muted)' }} />
              <Tooltip content={<DrivetrainTooltip unit="g" />} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Line type="monotone" dataKey="lateral" name="Lateral" stroke="#a855f7" strokeWidth={2} dot={false} connectNulls />
              <Line type="monotone" dataKey="longitudinal" name="Longitudinal" stroke="#00f0ff" strokeWidth={2} dot={false} connectNulls />
            </LineChart>
          </ResponsiveContainer>
        </ChartContainer>
      )}

      {/* ── Pedal Position & Brake ── */}
      {!noData && pedalData.length > 0 && (
        <ChartContainer title="Pedal &amp; Brake" className="mb-6 sm:mb-8" height={240}>
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={pedalData}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--glass-border)" strokeOpacity={0.5} />
              <XAxis dataKey="time" tick={{ fontSize: 10, fill: 'var(--text-muted)' }} />
              <YAxis domain={[0, 100]} tick={{ fontSize: 10, fill: 'var(--text-muted)' }} />
              <Tooltip content={<DrivetrainTooltip unit="%" />} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Line type="monotone" dataKey="pedal" name="Pedal %" stroke="#10b981" strokeWidth={2} dot={false} connectNulls />
              <Line type="stepAfter" dataKey="brake" name="Brake" stroke="#ef4444" strokeWidth={2} dot={false} connectNulls />
            </LineChart>
          </ResponsiveContainer>
        </ChartContainer>
      )}

      {/* ── 10. HVIL / Drive State Status ── */}
      {!noData && latest && (
        <GlassPanel className="p-4 sm:p-6 mb-6 sm:mb-8">
          <h3 className="text-sm font-semibold mb-4" style={{ color: 'var(--text-primary)' }}>
            <Shield className="inline h-4 w-4 mr-1.5 text-emerald-400" />Drive Inverter Status
          </h3>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <GlassPanel className="p-4 text-center">
              <p className="text-[10px] uppercase tracking-wider" style={{ color: 'var(--text-secondary)' }}>DI State</p>
              <p className={clsx('text-lg font-bold', diStateColor)}>{cleanNil(latest.di_state) ?? '--'}</p>
            </GlassPanel>
            <GlassPanel className="p-4 text-center">
              <p className="text-[10px] uppercase tracking-wider" style={{ color: 'var(--text-secondary)' }}>Gear</p>
              <p className={clsx('text-lg font-bold', gearColor)}>{cleanNil(latest.gear) ?? '--'}</p>
            </GlassPanel>
            <GlassPanel className="p-4 text-center">
              <p className="text-[10px] uppercase tracking-wider" style={{ color: 'var(--text-secondary)' }}>Stator Temp</p>
              <p className={clsx('text-lg font-bold', tempColor(latest.di_stator_temp))}>
                {latest.di_stator_temp != null ? `${fmtNumber(convertTemp(latest.di_stator_temp))} ${tempUnit}` : '--'}
              </p>
            </GlassPanel>
            <GlassPanel className="p-4 text-center">
              <p className="text-[10px] uppercase tracking-wider" style={{ color: 'var(--text-secondary)' }}>Torque</p>
              <p className="text-lg font-bold text-neon-cyan">{latest.di_torque != null ? `${fmtNumber(latest.di_torque)} Nm` : '--'}</p>
            </GlassPanel>
          </div>
          {/* Brake pedal status */}
          <div className="mt-4 flex items-center gap-3">
            {latest.brake_pedal ? (
              <AlertBanner variant="danger" icon={<AlertTriangle className="h-4 w-4" />}>
                Brake Engaged
              </AlertBanner>
            ) : (
              <AlertBanner variant="success" icon={<CheckCircle className="h-4 w-4" />}>
                Brake Released
              </AlertBanner>
            )}
            {latest.pedal_position != null && (
              <AlertBanner variant="info" icon={<Gauge className="h-4 w-4" />}>
                Pedal: {fmtPercent(latest.pedal_position)}
              </AlertBanner>
            )}
          </div>
        </GlassPanel>
      )}

      {/* ── 11. Summary ── */}
      {stats && (
        <div className="mb-6 sm:mb-8">
          <h3 className="text-sm font-semibold mb-4" style={{ color: 'var(--text-primary)' }}>
            <Gauge className="inline h-4 w-4 mr-1.5 text-purple-400" />Summary
          </h3>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 mb-6">
            <MetricCard label="Peak Torque" value={stats.peakTorque != null ? `${fmtNumber(stats.peakTorque)} Nm` : '--'} color="cyan" />
            <MetricCard label="Avg Torque" value={stats.avgTorque != null ? `${fmtNumber(stats.avgTorque)} Nm` : '--'} color="blue" />
            <MetricCard label="Peak Stator" value={stats.peakStatorTemp != null ? `${fmtNumber(convertTemp(stats.peakStatorTemp))} ${tempUnit}` : '--'} color="red" />
            <MetricCard label="Avg Stator" value={stats.avgStatorTemp != null ? `${fmtNumber(convertTemp(stats.avgStatorTemp))} ${tempUnit}` : '--'} color="amber" />
            <MetricCard label="Peak Speed" value={stats.peakSpeed != null ? `${fmtNumber(convertSpeed(stats.peakSpeed))} ${speedUnit}` : '--'} color="green" />
            <MetricCard label="Peak Lat-G" value={stats.peakLatAccel != null ? `${fmtNumber(stats.peakLatAccel)} g` : '--'} color="purple" />
          </div>

          {/* Thermal efficiency insights */}
          <GlassPanel className="p-4 sm:p-6">
            <h4 className="text-sm font-semibold mb-3" style={{ color: 'var(--text-primary)' }}>
              <Thermometer className="inline h-4 w-4 mr-1.5 text-orange-400" />Thermal Insights
            </h4>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              {/* Stator thermal range */}
              <GlassPanel className="p-4">
                <p className="text-xs mb-2" style={{ color: 'var(--text-secondary)' }}>Stator Thermal Range</p>
                {stats.peakStatorTemp != null && stats.minStatorTemp != null ? (
                  <>
                    <p className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
                      {fmtNumber(convertTemp(stats.minStatorTemp))} – {fmtNumber(convertTemp(stats.peakStatorTemp))} {tempUnit}
                    </p>
                    <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>
                      Δ {fmtNumber(convertTemp(stats.peakStatorTemp - stats.minStatorTemp + (stats.minStatorTemp > 0 ? 0 : stats.minStatorTemp)))} {tempUnit} spread
                    </p>
                  </>
                ) : (
                  <p className="text-sm text-[var(--text-muted)]">--</p>
                )}
              </GlassPanel>
              {/* Operating efficiency */}
              <GlassPanel className="p-4">
                <p className="text-xs mb-2" style={{ color: 'var(--text-secondary)' }}>Thermal Status</p>
                {stats.peakStatorTemp != null ? (
                  <>
                    <div className="flex items-center gap-2">
                      {stats.peakStatorTemp < 60 ? (
                        <><CheckCircle className="h-4 w-4 text-neon-green" /><span className="text-sm font-semibold text-neon-green">Excellent</span></>
                      ) : stats.peakStatorTemp < 80 ? (
                        <><AlertTriangle className="h-4 w-4 text-neon-amber" /><span className="text-sm font-semibold text-neon-amber">Moderate</span></>
                      ) : (
                        <><AlertTriangle className="h-4 w-4 text-neon-red" /><span className="text-sm font-semibold text-neon-red">High Load</span></>
                      )}
                    </div>
                    <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>
                      Peak stator reached {fmtInt(convertTemp(stats.peakStatorTemp))} {tempUnit}
                    </p>
                  </>
                ) : (
                  <p className="text-sm text-[var(--text-muted)]">--</p>
                )}
              </GlassPanel>
              {/* Data coverage */}
              <GlassPanel className="p-4">
                <p className="text-xs mb-2" style={{ color: 'var(--text-secondary)' }}>Data Points</p>
                <p className="text-sm font-semibold text-neon-cyan">{stats.totalSnapshots.toLocaleString()} snapshots</p>
                <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>
                  {stats.avgSpeed != null ? `Avg speed: ${fmtNumber(convertSpeed(stats.avgSpeed))} ${speedUnit}` : 'Collecting data...'}
                </p>
              </GlassPanel>
            </div>
          </GlassPanel>
        </div>
      )}
    </FadeIn>
  )
}
