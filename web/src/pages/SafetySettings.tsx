import { useState, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { getVehicles, getSafetyData, getSafetyLatest } from '../api'
import { useVehicleLive } from '../hooks/useVehicleLive'
import { PageHeader, GlassPanel, FadeIn, Skeleton, Badge } from '../components/ui'
import {
  Shield, ShieldCheck, ShieldAlert, Eye, AlertTriangle, Car, Gauge, Lock,
  Milestone, CheckCircle, XCircle, Activity, User, Bell,
} from 'lucide-react'
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts'
import clsx from 'clsx'
import { formatDateTime } from '../lib/dateFormat'

/* ------------------------------------------------------------------ */
/*  Chart Tooltip                                                      */
/* ------------------------------------------------------------------ */

interface SafetyTooltipPayload { name: string; value: number; color?: string }
function SafetyTooltip({ active, payload, label }: { active?: boolean; payload?: SafetyTooltipPayload[]; label?: string }) {
  if (!active || !payload?.length) return null
  return (
    <div className="glass-panel p-3 text-xs" style={{ background: 'var(--surface-2)', borderColor: 'var(--glass-border)' }}>
      <p style={{ color: 'var(--text-secondary)' }} className="mb-1">{label}</p>
      {payload.map(p => (
        <p key={p.name} style={{ color: 'var(--text-primary)' }}>
          <span style={{ color: p.color }}>●</span> {p.name}: {p.value === 1 ? 'Enabled' : 'Disabled'}
        </p>
      ))}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/*  Safety Setting Card                                                */
/* ------------------------------------------------------------------ */

function SafetyCard({
  icon,
  label,
  value,
  description,
}: {
  icon: React.ReactNode
  label: string
  value: { text: string; enabled: boolean } | null
  description?: string
}) {
  const isEnabled = value?.enabled ?? false
  const statusBg = isEnabled ? 'bg-neon-green/20' : 'bg-neon-red/20'

  return (
    <GlassPanel className="p-4 sm:p-5 flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <div className={clsx('p-2 rounded-lg', statusBg)}>
            {icon}
          </div>
          <div>
            <p className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>{label}</p>
            {description && (
              <p className="text-[10px] mt-0.5" style={{ color: 'var(--text-muted)' }}>{description}</p>
            )}
          </div>
        </div>
      </div>
      <div className="flex items-center gap-2 mt-auto">
        {value === null ? (
          <span className="text-xs" style={{ color: 'var(--text-muted)' }}>No data</span>
        ) : (
          <>
            {isEnabled ? (
              <CheckCircle className="h-3.5 w-3.5 text-neon-green" />
            ) : (
              <XCircle className="h-3.5 w-3.5 text-neon-red" />
            )}
            <Badge color={isEnabled ? 'green' : 'red'} size="sm">{value.text}</Badge>
          </>
        )}
      </div>
    </GlassPanel>
  )
}

/* ------------------------------------------------------------------ */
/*  Stats Card*/
/* ------------------------------------------------------------------ */

function StatsCard({
  icon,
  label,
  value,
  unit,
}: {
  icon: React.ReactNode
  label: string
  value: number | null | undefined
  unit: string
}) {
  const formatted = value != null ? value.toLocaleString(undefined, { maximumFractionDigits: 1 }) : '--'
  return (
    <GlassPanel className="p-4 sm:p-5 flex flex-col items-center gap-3 text-center">
      <div className="p-2.5 rounded-lg bg-neon-cyan/10">
        {icon}
      </div>
      <p className="text-xs font-medium uppercase tracking-wider" style={{ color: 'var(--text-secondary)' }}>{label}</p>
      <p className="text-2xl font-bold" style={{ color: 'var(--text-primary)' }}>{formatted}</p>
      <Badge color="cyan" size="sm">{unit}</Badge>
    </GlassPanel>
  )
}

/* ------------------------------------------------------------------ */
/*  Safety Score Badge*/
/* ------------------------------------------------------------------ */

function SafetyScoreBadge({ score, total }: { score: number; total: number }) {
  const pct = total > 0 ? Math.round((score / total) * 100) : 0
  const color = pct >= 80 ? 'text-neon-green' : pct >= 50 ? 'text-neon-amber' : 'text-neon-red'
  const assessment= pct >= 80 ? 'Excellent' : pct >= 60 ? 'Good' : pct >= 40 ? 'Fair' : 'Needs Attention'

  return (
    <GlassPanel className="p-5 sm:p-6 flex flex-col items-center gap-4 text-center">
      <div className="relative w-28 h-28 flex items-center justify-center">
        <svg className="absolute inset-0 w-full h-full -rotate-90" viewBox="0 0 100 100">
          <circle cx="50" cy="50" r="42" fill="none" stroke="currentColor" strokeWidth="6" className="text-white/5" />
          <circle
            cx="50" cy="50" r="42" fill="none" stroke="currentColor" strokeWidth="6"
            strokeDasharray={`${pct * 2.64} 264`} strokeLinecap="round" className={color}
          />
        </svg>
        <span className={clsx('text-3xl font-bold', color)}>{pct}%</span>
      </div>
      <div>
        <p className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>Safety Score</p>
        <p className="text-xs mt-1" style={{ color: 'var(--text-secondary)' }}>
          {score} of {total} features enabled
        </p>
      </div>
      <Badge color={pct >= 80 ? 'green' : pct >= 50 ? 'amber' : 'red'} size="md">{assessment}</Badge>
    </GlassPanel>
  )
}

/* ------------------------------------------------------------------ */
/*  Helper: format boolean/string fields for cards                     */
/* ------------------------------------------------------------------ */

function boolStatus(val: boolean | undefined, invertLogic = false): { text: string; enabled: boolean } | null {
  if (val === undefined) return null
  const enabled = invertLogic ? !val : val
  return { text: enabled ? 'Enabled' : 'Disabled', enabled }
}

function stringStatus(val: string | undefined): { text: string; enabled: boolean } | null {
  if (val === undefined || val === null) return null
  const lower = val.toLowerCase()
  const enabled = lower !== 'off' && lower !== 'disabled' && lower !== 'none' && lower !== ''
  const display = val.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
  return { text: display, enabled }
}

/* ------------------------------------------------------------------ */
/*  History Table Row                                                   */
/* ------------------------------------------------------------------ */

function StatusDot({ enabled }: { enabled: boolean }) {
  return (
    <span className={clsx(
      'inline-block w-2 h-2 rounded-full',
      enabled ? 'bg-neon-green' : 'bg-neon-red',
    )} />
  )
}

/* ------------------------------------------------------------------ */
/*  Main Component                                                     */
/* ------------------------------------------------------------------ */

export default function SafetySettings() {
  const { data: vehicles } = useQuery({ queryKey: ['vehicles'], queryFn: getVehicles })
  const [selectedVehicle, setSelectedVehicle] = useState<number | null>(null)
  const vehicleId = selectedVehicle ?? vehicles?.[0]?.id ?? null

  // SSE live state for real-time seat belt and safety signals
  const { state: live } = useVehicleLive(vehicleId ?? undefined)

  const { data: latest, isLoading: loadingLatest } = useQuery({
    queryKey: ['safety-latest', vehicleId],
    queryFn: () => getSafetyLatest(vehicleId!),
    enabled: vehicleId !== null,
    refetchInterval: 10000,
  })

  const { data: history, isLoading: loadingHistory } = useQuery({
    queryKey: ['safety-history', vehicleId],
    queryFn: () => getSafetyData(vehicleId!, 100),
    enabled: vehicleId !== null,
    refetchInterval: 10000,
  })

  /* ---- Chart data: boolean states over time ---- */
  const chartData = useMemo(() => {
    if (!history || history.length === 0) return []
    return history.slice().reverse().map(s => ({
      time: formatDateTime(s.created_at),
      aeb: s.automatic_emergency_braking_off === false ? 1 : 0,
      bscw: s.blind_spot_collision_warning ? 1 : 0,
      elda: s.emergency_lane_departure_avoidance ? 1 : 0,
    }))
  }, [history])

  /* ---- Safety score: count enabled features ---- */
  const safetyScore = useMemo(() => {
    if (!latest) return { score: 0, total: 0 }
    let score = 0
    let total = 0

    // AEB (inverted: off=false means enabled)
    if (latest.automatic_emergency_braking_off !== undefined) {
      total++
      if (!latest.automatic_emergency_braking_off) score++
    }
    // Blind spot camera
    if (latest.automatic_blind_spot_camera !== undefined) {
      total++
      if (latest.automatic_blind_spot_camera) score++
    }
    // Blind spot collision warning
    if (latest.blind_spot_collision_warning !== undefined) {
      total++
      if (latest.blind_spot_collision_warning) score++
    }
    // Emergency lane departure avoidance
    if (latest.emergency_lane_departure_avoidance !== undefined) {
      total++
      if (latest.emergency_lane_departure_avoidance) score++
    }
    // Forward collision warning (string — enabled if not off)
    if (latest.forward_collision_warning !== undefined) {
      total++
      if (latest.forward_collision_warning.toLowerCase() !== 'off') score++
    }
    // Lane departure avoidance (string)
    if (latest.lane_departure_avoidance !== undefined) {
      total++
      if (latest.lane_departure_avoidance.toLowerCase() !== 'off') score++
    }
    // Speed limit warning (string)
    if (latest.speed_limit_warning !== undefined) {
      total++
      if (latest.speed_limit_warning.toLowerCase() !== 'off') score++
    }
    // Pin to drive
    if (latest.pin_to_drive_enabled !== undefined) {
      total++
      if (latest.pin_to_drive_enabled) score++
    }

    return { score, total }
  }, [latest])

  return (
    <FadeIn>
      {/* ---- Header + Vehicle Selector ---- */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 sm:gap-0 mb-6 sm:mb-8">
        <PageHeader
          title="Safety Settings"
          subtitle="ADAS configuration, collision warnings, and driving statistics"
          icon={<Shield className="h-7 w-7 text-neon-cyan" />}
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

      {/* ---- Safety Score Cards ---- */}
      {loadingLatest ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 sm:gap-4 mb-6 sm:mb-8">
          {[1, 2, 3, 4, 5, 6, 7].map(i => <Skeleton key={i} className="h-32 rounded-xl" />)}
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 sm:gap-4 mb-6 sm:mb-8">
          <SafetyCard
            icon={<ShieldCheck className="h-5 w-5 text-neon-green" />}
            label="Auto Emergency Braking"
            description="AEB system status"
            value={boolStatus(latest?.automatic_emergency_braking_off, true)}
          />
          <SafetyCard
            icon={<Eye className="h-5 w-5 text-neon-cyan" />}
            label="Blind Spot Camera"
            description="Automatic side camera"
            value={boolStatus(latest?.automatic_blind_spot_camera)}
          />
          <SafetyCard
            icon={<AlertTriangle className="h-5 w-5 text-neon-amber" />}
            label="Forward Collision Warning"
            description="Sensitivity level"
            value={stringStatus(latest?.forward_collision_warning)}
          />
          <SafetyCard
            icon={<Car className="h-5 w-5 text-neon-purple" />}
            label="Lane Departure Avoidance"
            description="Correction level"
            value={stringStatus(latest?.lane_departure_avoidance)}
          />
          <SafetyCard
            icon={<Gauge className="h-5 w-5 text-neon-cyan" />}
            label="Cruise Follow Distance"
            description="Following distance setting"
            value={stringStatus(latest?.cruise_follow_distance)}
          />
          <SafetyCard
            icon={<Activity className="h-5 w-5 text-neon-amber" />}
            label="Speed Limit Warning"
            description="Alert configuration"
            value={stringStatus(latest?.speed_limit_warning)}
          />
          <SafetyCard
            icon={<Lock className="h-5 w-5 text-neon-green" />}
            label="Pin to Drive"
            description="PIN required to drive"
            value={boolStatus(latest?.pin_to_drive_enabled)}
          />
          <SafetyCard
            icon={<Bell className="h-5 w-5 text-neon-amber" />}
            label="Blind Spot Warning Chime"
            description="Audible collision alert"
            value={boolStatus(latest?.blind_spot_collision_warning)}
          />
          <SafetyCard
            icon={<ShieldAlert className="h-5 w-5 text-neon-red" />}
            label="Emergency Lane Departure"
            description="Lane keep assist"
            value={boolStatus(latest?.emergency_lane_departure_avoidance)}
          />
        </div>
      )}

      {/* ---- Live Seat Belt Status ---- */}
      <h3 className="text-sm font-semibold mb-3" style={{ color: 'var(--text-primary)' }}>Live Safety Signals</h3>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 sm:gap-4 mb-6 sm:mb-8">
        <GlassPanel className="p-4 flex flex-col items-center gap-2">
          <div className={clsx('p-2.5 rounded-lg', live.driverSeatBelt ? 'bg-neon-green/10' : 'bg-neon-red/10')}>
            <User className={clsx('h-5 w-5', live.driverSeatBelt ? 'text-neon-green' : 'text-neon-red')} />
          </div>
          <span className={clsx('text-sm font-bold', live.driverSeatBelt ? 'text-neon-green' : 'text-neon-red')}>
            {live.driverSeatBelt ? 'Buckled' : 'Unbuckled'}
          </span>
          <span className="text-[10px] uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>Driver Belt</span>
        </GlassPanel>
        <GlassPanel className="p-4 flex flex-col items-center gap-2">
          <div className={clsx('p-2.5 rounded-lg', live.passengerSeatBelt ? 'bg-neon-green/10' : 'bg-white/5')}>
            <User className={clsx('h-5 w-5', live.passengerSeatBelt ? 'text-neon-green' : 'text-[var(--text-muted)]')} />
          </div>
          <span className={clsx('text-sm font-bold', live.passengerSeatBelt ? 'text-neon-green' : 'text-[var(--text-muted)]')}>
            {live.passengerSeatBelt ? 'Buckled' : 'Unbuckled'}
          </span>
          <span className="text-[10px] uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>Passenger Belt</span>
        </GlassPanel>
        <GlassPanel className="p-4 flex flex-col items-center gap-2">
          <div className={clsx('p-2.5 rounded-lg', live.driverSeatOccupied ? 'bg-neon-green/10' : 'bg-white/5')}>
            <Car className={clsx('h-5 w-5', live.driverSeatOccupied ? 'text-neon-green' : 'text-[var(--text-muted)]')} />
          </div>
          <span className={clsx('text-sm font-bold', live.driverSeatOccupied ? 'text-neon-green' : 'text-[var(--text-muted)]')}>
            {live.driverSeatOccupied ? 'Occupied' : 'Empty'}
          </span>
          <span className="text-[10px] uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>Driver Seat</span>
        </GlassPanel>
        <GlassPanel className="p-4 flex flex-col items-center gap-2">
          <div className={clsx('p-2.5 rounded-lg', live.locked ? 'bg-neon-green/10' : 'bg-neon-red/10')}>
            <Lock className={clsx('h-5 w-5', live.locked ? 'text-neon-green' : 'text-neon-red')} />
          </div>
          <span className={clsx('text-sm font-bold', live.locked ? 'text-neon-green' : 'text-neon-red')}>
            {live.locked ? 'Locked' : 'Unlocked'}
          </span>
          <span className="text-[10px] uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>Vehicle Lock</span>
        </GlassPanel>
      </div>

      {/* ---- Self-Driving Stats ---- */}
      <h3 className="text-sm font-semibold mb-3" style={{ color: 'var(--text-primary)' }}>Driving Statistics</h3>
      {loadingLatest ? (
        <div className="grid grid-cols-2 gap-3 sm:gap-4 mb-6 sm:mb-8">
          <Skeleton className="h-40 rounded-xl" />
          <Skeleton className="h-40 rounded-xl" />
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:gap-4 mb-6 sm:mb-8">
          <StatsCard
            icon={<Milestone className="h-5 w-5 text-neon-cyan" />}
            label="Miles Since Reset"
            value={latest?.miles_since_reset}
            unit="miles"
          />
          <StatsCard
            icon={<Car className="h-5 w-5 text-neon-cyan" />}
            label="Self-Driving Miles"
            value={latest?.self_driving_miles_since_reset}
            unit="miles (autopilot)"
          />
        </div>
      )}

      {/* ---- Safety Configuration History ---- */}
      <GlassPanel className="p-4 sm:p-6 mb-6 sm:mb-8">
        <h3 className="text-sm font-semibold mb-4" style={{ color: 'var(--text-primary)' }}>Safety Configuration History</h3>
        {loadingHistory ? (
          <Skeleton className="h-64 rounded-xl" />
        ) : !history || history.length === 0 ? (
          <div className="flex items-center justify-center h-64 text-[var(--text-muted)] text-sm">
            No safety history data available
          </div>
        ) : (
          <div className="overflow-x-auto max-h-80 overflow-y-auto">
            <table className="w-full text-xs" style={{ color: 'var(--text-primary)' }}>
              <thead>
                <tr className="border-b" style={{ borderColor: 'var(--glass-border)' }}>
                  <th className="text-left py-2 px-3 font-medium sticky top-0" style={{ background: 'var(--surface-2)', color: 'var(--text-secondary)' }}>Time</th>
                  <th className="text-center py-2 px-3 font-medium sticky top-0" style={{ background: 'var(--surface-2)', color: 'var(--text-secondary)' }}>AEB</th>
                  <th className="text-center py-2 px-3 font-medium sticky top-0" style={{ background: 'var(--surface-2)', color: 'var(--text-secondary)' }}>Blind Spot</th>
                  <th className="text-center py-2 px-3 font-medium sticky top-0" style={{ background: 'var(--surface-2)', color: 'var(--text-secondary)' }}>FCW</th>
                  <th className="text-center py-2 px-3 font-medium sticky top-0" style={{ background: 'var(--surface-2)', color: 'var(--text-secondary)' }}>Lane Dept.</th>
                  <th className="text-center py-2 px-3 font-medium sticky top-0" style={{ background: 'var(--surface-2)', color: 'var(--text-secondary)' }}>Cruise Dist.</th>
                </tr>
              </thead>
              <tbody>
                {history.map(s => (
                  <tr key={s.id} className="border-b last:border-b-0 hover:bg-white/[0.02] transition-colors" style={{ borderColor: 'var(--glass-border)' }}>
                    <td className="py-2 px-3 whitespace-nowrap" style={{ color: 'var(--text-secondary)' }}>
                      {formatDateTime(s.created_at)}
                    </td>
                    <td className="py-2 px-3 text-center">
                      <StatusDot enabled={s.automatic_emergency_braking_off === false} />
                    </td>
                    <td className="py-2 px-3 text-center">
                      <StatusDot enabled={!!s.automatic_blind_spot_camera} />
                    </td>
                    <td className="py-2 px-3 text-center whitespace-nowrap">
                      <Badge color={s.forward_collision_warning && s.forward_collision_warning.toLowerCase() !== 'off' ? 'green' : 'red'} size="sm">
                        {s.forward_collision_warning
                          ? s.forward_collision_warning.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
                          : '--'}
                      </Badge>
                    </td>
                    <td className="py-2 px-3 text-center whitespace-nowrap">
                      <Badge color={s.lane_departure_avoidance && s.lane_departure_avoidance.toLowerCase() !== 'off' ? 'green' : 'red'} size="sm">
                        {s.lane_departure_avoidance
                          ? s.lane_departure_avoidance.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
                          : '--'}
                      </Badge>
                    </td>
                    <td className="py-2 px-3 text-center whitespace-nowrap" style={{ color: 'var(--text-secondary)' }}>
                      {s.cruise_follow_distance
                        ? s.cruise_follow_distance.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
                        : '--'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </GlassPanel>

      {/* ---- ADAS Status Timeline Chart ---- */}
      <GlassPanel className="p-4 sm:p-6 mb-6 sm:mb-8">
        <h3 className="text-sm font-semibold mb-4" style={{ color: 'var(--text-primary)' }}>ADAS Status Timeline</h3>
        {loadingHistory ? (
          <Skeleton className="h-72 rounded-xl" />
        ) : chartData.length === 0 ? (
          <div className="flex items-center justify-center h-72 text-[var(--text-muted)] text-sm">
            No ADAS timeline data available
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={300}>
            <LineChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--glass-border)" strokeOpacity={0.5} />
              <XAxis dataKey="time" tick={{ fontSize: 10, fill: 'var(--text-muted)' }} />
              <YAxis
                domain={[0, 1]}
                ticks={[0, 1]}
                tick={{ fontSize: 10, fill: 'var(--text-muted)' }}
                tickFormatter={v => (v === 1 ? 'On' : 'Off')}
              />
              <Tooltip content={<SafetyTooltip />} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Line type="stepAfter" dataKey="aeb" name="AEB Enabled" stroke="#10b981" strokeWidth={2} dot={false} />
              <Line type="stepAfter" dataKey="bscw" name="Blind Spot Warning" stroke="#00f0ff" strokeWidth={2} dot={false} />
              <Line type="stepAfter" dataKey="elda" name="Emergency Lane Dept." stroke="#a855f7" strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        )}
      </GlassPanel>

      {/* ---- Safety Summary ---- */}
      <h3 className="text-sm font-semibold mb-3" style={{ color: 'var(--text-primary)' }}>Safety Overview</h3>
      {loadingLatest ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4 mb-6 sm:mb-8">
          <Skeleton className="h-56 rounded-xl" />
          <Skeleton className="h-56 rounded-xl" />
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4 mb-6 sm:mb-8">
          <SafetyScoreBadge score={safetyScore.score} total={safetyScore.total} />
          <GlassPanel className="p-5 sm:p-6 flex flex-col gap-3">
            <div className="flex items-center gap-2 mb-2">
              <ShieldAlert className="h-5 w-5 text-neon-cyan" />
              <p className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>Feature Summary</p>
            </div>
            <div className="flex flex-col gap-2.5 text-xs">
              <div className="flex items-center justify-between">
                <span style={{ color: 'var(--text-secondary)' }}>Auto Emergency Braking</span>
                <span className={latest?.automatic_emergency_braking_off === false ? 'text-neon-green' : 'text-neon-red'}>
                  {latest?.automatic_emergency_braking_off === undefined ? '--' : latest.automatic_emergency_braking_off ? 'Disabled' : 'Enabled'}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span style={{ color: 'var(--text-secondary)' }}>Blind Spot Camera</span>
                <span className={latest?.automatic_blind_spot_camera ? 'text-neon-green' : 'text-neon-red'}>
                  {latest?.automatic_blind_spot_camera === undefined ? '--' : latest.automatic_blind_spot_camera ? 'Enabled' : 'Disabled'}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span style={{ color: 'var(--text-secondary)' }}>Blind Spot Collision Warning</span>
                <span className={latest?.blind_spot_collision_warning ? 'text-neon-green' : 'text-neon-red'}>
                  {latest?.blind_spot_collision_warning === undefined ? '--' : latest.blind_spot_collision_warning ? 'Enabled' : 'Disabled'}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span style={{ color: 'var(--text-secondary)' }}>Emergency Lane Departure</span>
                <span className={latest?.emergency_lane_departure_avoidance ? 'text-neon-green' : 'text-neon-red'}>
                  {latest?.emergency_lane_departure_avoidance === undefined ? '--' : latest.emergency_lane_departure_avoidance ? 'Enabled' : 'Disabled'}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span style={{ color: 'var(--text-secondary)' }}>Forward Collision Warning</span>
                <span className={
                  latest?.forward_collision_warning && latest.forward_collision_warning.toLowerCase() !== 'off'
                    ? 'text-neon-green' : 'text-neon-red'
                }>
                  {latest?.forward_collision_warning
                    ? latest.forward_collision_warning.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
                    : '--'}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span style={{ color: 'var(--text-secondary)' }}>Lane Departure Avoidance</span>
                <span className={
                  latest?.lane_departure_avoidance && latest.lane_departure_avoidance.toLowerCase() !== 'off'
                    ? 'text-neon-green' : 'text-neon-red'
                }>
                  {latest?.lane_departure_avoidance
                    ? latest.lane_departure_avoidance.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
                    : '--'}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span style={{ color: 'var(--text-secondary)' }}>Speed Limit Warning</span>
                <span className={
                  latest?.speed_limit_warning && latest.speed_limit_warning.toLowerCase() !== 'off'
                    ? 'text-neon-green' : 'text-neon-red'
                }>
                  {latest?.speed_limit_warning
                    ? latest.speed_limit_warning.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
                    : '--'}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span style={{ color: 'var(--text-secondary)' }}>Pin to Drive</span>
                <span className={latest?.pin_to_drive_enabled ? 'text-neon-green' : 'text-neon-red'}>
                  {latest?.pin_to_drive_enabled === undefined ? '--' : latest.pin_to_drive_enabled ? 'Enabled' : 'Disabled'}
                </span>
              </div>
            </div>
          </GlassPanel>
        </div>
      )}
    </FadeIn>
  )
}
