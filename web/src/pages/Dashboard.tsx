import { useState, useEffect, useMemo } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import {
  getVehicles, getAuthStatus, getVehicleState, getDrives, getChargingSessions,
  getFleetAnalytics, getAlerts, Vehicle, VehicleState, getVehicleStatus,
} from '../api'
import {
  Car, AlertCircle, Activity, Radio, Shield, Lock, Unlock,
  ArrowUpRight, ChevronRight, Zap, Route, BatteryCharging, Bell, Clock,
  TrendingUp, Gauge, MapPin, Thermometer, Eye, Navigation, RefreshCw,
} from 'lucide-react'
import {
  GlassPanel, FadeIn, StaggerContainer, StaggerItem, StatusBadge,
  Skeleton, PageHeader,
} from '../components/ui'
import { TeslaCarViz, TeslaCarMini, parseModelKey } from '../components/TeslaCarViz'
import { AnimatedNumber, TimelineItem, RadialGauge, StatusPill, MiniChart } from '../components/Widgets'
import { useRealtimeEvents } from '../hooks/useRealtimeEvents'
import { AreaChart, Area, ResponsiveContainer, XAxis, YAxis, CartesianGrid, Tooltip } from 'recharts'

interface TooltipPayload { name: string; value: number; color?: string; fill?: string }
function ChartTooltip({ active, payload, label }: { active?: boolean; payload?: TooltipPayload[]; label?: string }) {
  if (!active || !payload?.length) return null
  return (
    <div className="glass-panel p-3 text-xs" style={{ background: 'var(--surface-2)', borderColor: 'var(--glass-border)' }}>
      <p style={{ color: 'var(--text-secondary)' }} className="mb-1">{label}</p>
      {payload.map(p => (
        <p key={p.name} style={{ color: 'var(--text-primary)' }}>
          <span style={{ color: p.color || p.fill }}>●</span> {p.name}: {typeof p.value === 'number' ? p.value.toFixed(1) : p.value}
        </p>
      ))}
    </div>
  )
}

/* ---------- small hero vehicle card in the fleet strip ---------- */
function FleetVehicleStrip({ vehicle, state }: { vehicle: Vehicle; state?: VehicleState | null }) {
  const status = getVehicleStatus(vehicle, state)
  return (
    <Link to={`/vehicles/${vehicle.id}`} className="block group">
      <GlassPanel hover glow="cyan" className="p-3 sm:p-4 min-w-[160px] sm:min-w-[220px] transition-all group-hover:scale-[1.02]">
        <div className="flex items-center gap-3 mb-3">
          <TeslaCarMini batteryLevel={state?.battery_level ?? 0} isCharging={state?.is_charging ?? false} model={parseModelKey(vehicle.model)} />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-[var(--text-primary)] truncate">{vehicle.display_name || vehicle.vin}</p>
            <StatusBadge status={status} />
          </div>
        </div>
        {state ? (
          <div className="grid grid-cols-3 gap-2 text-center">
            <div>
              <p className="text-xs text-[var(--text-muted)]">Battery</p>
              <p className="text-sm font-bold" style={{ color: state.battery_level > 50 ? '#10b981' : '#f59e0b' }}>{state.battery_level}%</p>
            </div>
            <div>
              <p className="text-xs text-[var(--text-muted)]">Range</p>
              <p className="text-sm font-bold text-[var(--text-primary)]">{Math.round(state.rated_range)}</p>
            </div>
            <div>
              <p className="text-xs text-[var(--text-muted)]">Temp</p>
              <p className="text-sm font-bold text-[var(--text-primary)]">{state.inside_temp}°</p>
            </div>
          </div>
        ) : (
          <p className="text-xs text-gray-600 text-center">Asleep</p>
        )}
      </GlassPanel>
    </Link>
  )
}

/* Helper: time ago */
function formatTimeAgo(date: Date): string {
  const diff = Date.now() - date.getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'Just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  const days = Math.floor(hrs / 24)
  if (days < 7) return `${days}d ago`
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

/* ---------- Main Dashboard ---------- */
function SmartSuggestions({ drives, state }: { drives: any[]; state: any }) {
  const suggestions = useMemo(() => {
    const tips: Array<{ icon: string; title: string; description: string; priority: 'high'|'medium'|'low' }> = []

    // Analyze driving patterns
    if (drives?.length > 5) {
      // Find most common departure time
      const departureCounts: Record<number, number> = {}
      drives.forEach(d => {
        const hour = new Date(d.start_date).getHours()
        departureCounts[hour] = (departureCounts[hour] || 0) + 1
      })
      const peakHour = Object.entries(departureCounts).sort((a, b) => Number(b[1]) - Number(a[1]))[0]
      if (peakHour) {
        const h = Number(peakHour[0])
        tips.push({
          icon: '🕐',
          title: `Pre-condition at ${h-1 < 10 ? '0' : ''}${h-1}:${h > 12 ? '30' : '45'}`,
          description: `You usually start driving around ${h}:00. Pre-conditioning 15-30 min before saves range and warms/cools the cabin efficiently while plugged in.`,
          priority: 'high'
        })
      }

      // Check if mostly short trips
      const avgDistance = drives.reduce((s: number, d: any) => s + d.distance, 0) / drives.length
      if (avgDistance < 15) {
        tips.push({
          icon: '🔋',
          title: 'Set charge limit to 70%',
          description: `Your average trip is ${avgDistance.toFixed(0)} km. A 70% charge limit extends battery life while covering daily needs.`,
          priority: 'medium'
        })
      }

      // Check for night driving
      const nightDrives = drives.filter((d: any) => {
        const h = new Date(d.start_date).getHours()
        return h >= 22 || h <= 5
      })
      if (nightDrives.length > drives.length * 0.2) {
        tips.push({
          icon: '🌙',
          title: 'Enable scheduled departure',
          description: `${Math.round(nightDrives.length / drives.length * 100)}% of your drives start at night. Scheduled departure pre-conditions and charges to be ready on time.`,
          priority: 'low'
        })
      }
    }

    // Battery level suggestions
    if (state?.battery_level != null) {
      if (state.battery_level > 90 && !state.is_charging) {
        tips.push({ icon: '⚡', title: 'High battery notice', description: 'Battery above 90%. For daily use, charging to 80% extends battery longevity.', priority: 'medium' })
      }
      if (state.battery_level < 15 && !state.is_charging) {
        tips.push({ icon: '🪫', title: 'Low battery — charge soon', description: `Battery at ${state.battery_level}%. Find a charger to avoid deep discharge.`, priority: 'high' })
      }
    }

    // Sentry mode efficiency
    if (state?.sentry_mode) {
      tips.push({ icon: '👁️', title: 'Sentry mode is on', description: 'Sentry mode uses ~1-2% battery per hour. Disable at home to reduce vampire drain.', priority: 'low' })
    }

    return tips.sort((a, b) => { const p = { high: 0, medium: 1, low: 2 }; return p[a.priority] - p[b.priority] })
  }, [drives, state])

  if (suggestions.length === 0) return null

  return (
    <GlassPanel className="p-6">
      <h3>💡 Smart Suggestions</h3>
      <div className="space-y-3 mt-3">
        {suggestions.map((s, i) => (
          <div key={i} className="flex items-start gap-3 p-3 rounded-lg" style={{background:'var(--surface-2)'}}>
            <span className="text-xl mt-0.5">{s.icon}</span>
            <div>
              <p className="text-sm font-medium" style={{color:'var(--text-primary)'}}>{s.title}</p>
              <p className="text-xs mt-0.5" style={{color:'var(--text-secondary)'}}>{s.description}</p>
            </div>
            <span className={`text-[9px] px-1.5 py-0.5 rounded-full shrink-0 ${
              s.priority === 'high' ? 'bg-neon-red/10 text-neon-red' : s.priority === 'medium' ? 'bg-neon-amber/10 text-neon-amber' : 'bg-white/5 text-[var(--text-muted)]'}`}>
              {s.priority}
            </span>
          </div>
        ))}
      </div>
    </GlassPanel>
  )
}

export default function Dashboard() {
  const queryClient = useQueryClient()

  const { data: vehicles, isLoading: vehiclesLoading } = useQuery({
    queryKey: ['vehicles'], queryFn: getVehicles,
  })
  const { data: auth } = useQuery({
    queryKey: ['auth-status'], queryFn: getAuthStatus,
  })
  const { data: analytics } = useQuery({
    queryKey: ['fleet-analytics', '30'], queryFn: () => getFleetAnalytics(30),
  })
  const { data: alerts } = useQuery({
    queryKey: ['alerts'], queryFn: () => getAlerts(10),
  })
  const { connected } = useRealtimeEvents({
    onVehicleUpdate: () => queryClient.invalidateQueries({ queryKey: ['vehicles'] }),
  })

  // Get state for the primary (first) vehicle
  const primaryVehicle = vehicles?.[0]
  const { data: primaryStateData, dataUpdatedAt } = useQuery({
    queryKey: ['vehicle-state', primaryVehicle?.id],
    queryFn: () => getVehicleState(primaryVehicle!.id),
    enabled: !!primaryVehicle,
    refetchInterval: 30_000,
  })
  const primaryState = primaryStateData?.state

  // Get recent drives and charges for the primary vehicle
  const { data: recentDrives } = useQuery({
    queryKey: ['drives', primaryVehicle?.id],
    queryFn: () => getDrives(primaryVehicle!.id, 5),
    enabled: !!primaryVehicle,
  })
  const { data: recentCharges } = useQuery({
    queryKey: ['charging', primaryVehicle?.id],
    queryFn: () => getChargingSessions(primaryVehicle!.id, 5),
    enabled: !!primaryVehicle,
  })

  // Get states for all other vehicles
  const otherVehicles = vehicles?.slice(1) ?? []
  const { data: otherStates } = useQuery({
    queryKey: ['other-vehicle-states', otherVehicles.map(v => v.id)],
    queryFn: async () => {
      const entries = await Promise.all(
        otherVehicles.map(async v => {
          try { return [v.id, (await getVehicleState(v.id)).state ?? null] as const }
          catch { return [v.id, null] as const }
        })
      )
      return Object.fromEntries(entries) as Record<number, VehicleState | null>
    },
    enabled: otherVehicles.length > 0,
  })

  const onlineCount = vehicles?.filter(v => v.state === 'online').length ?? 0
  const totalCount = vehicles?.length ?? 0
  const totalDistance = analytics?.total_distance_km ?? 0
  const totalEnergy = analytics?.total_energy_kwh ?? 0
  const unreadAlerts = alerts?.filter(a => !a.read).length ?? 0

  // Last-updated timestamp state
  const [, setTick] = useState(0)
  const [isRefreshing, setIsRefreshing] = useState(false)

  // Re-render every 60s so the relative timestamp stays current
  useEffect(() => {
    const id = setInterval(() => setTick(t => t + 1), 60_000)
    return () => clearInterval(id)
  }, [])

  const lastUpdatedLabel = dataUpdatedAt
    ? `Updated ${formatTimeAgo(new Date(dataUpdatedAt))}`
    : undefined

  const handleRefresh = async () => {
    setIsRefreshing(true)
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['vehicle-state'] }),
      queryClient.invalidateQueries({ queryKey: ['vehicles'] }),
      queryClient.invalidateQueries({ queryKey: ['fleet-analytics'] }),
      queryClient.invalidateQueries({ queryKey: ['drives'] }),
      queryClient.invalidateQueries({ queryKey: ['charging'] }),
      queryClient.invalidateQueries({ queryKey: ['alerts'] }),
    ])
    setIsRefreshing(false)
  }

  // Build activity timeline items from drives + charges
  const activityItems: { type: string; title: string; subtitle: string; time: Date }[] = []
  recentDrives?.forEach(d => activityItems.push({
    type: 'drive',
    title: `${(d.distance ?? 0).toFixed(1)} km drive`,
    subtitle: `${Math.floor((d.duration_min ?? 0) / 60)}h ${Math.round((d.duration_min ?? 0) % 60)}m · ${d.start_battery_level ?? '?'}% → ${d.end_battery_level ?? '?'}%`,
    time: new Date(d.start_date),
  }))
  recentCharges?.forEach(s => activityItems.push({
    type: 'charge',
    title: `${(s.charge_energy_added ?? 0).toFixed(1)} kWh charged`,
    subtitle: `${s.start_battery_level ?? '?'}% → ${s.end_battery_level ?? '?'}% · ${typeof s.cost === 'number' ? `$${s.cost.toFixed(2)}` : ''}`,
    time: new Date(s.start_date),
  }))
  activityItems.sort((a, b) => b.time.getTime() - a.time.getTime())

  // Battery trend data for sparkline
  const batteryTrend = recentDrives?.map(d => d.end_battery_level ?? 50).reverse() ?? []

  return (
    <div className="space-y-6">
      {/* Header */}
      <PageHeader
        title="Command Center"
        subtitle="Real-time fleet intelligence and control"
        actions={
          <div className="flex items-center gap-3">
            {lastUpdatedLabel && (
              <span className="text-[10px] text-[var(--text-muted)] hidden sm:inline">
                {lastUpdatedLabel}
              </span>
            )}
            <button
              onClick={handleRefresh}
              disabled={isRefreshing}
              className="p-1 rounded-md hover:bg-white/5 transition-colors disabled:opacity-50"
              title="Refresh data"
            >
              <RefreshCw className={`h-3.5 w-3.5 text-[var(--text-secondary)] hover:text-neon-cyan transition-colors ${isRefreshing ? 'animate-spin' : ''}`} />
            </button>
            {unreadAlerts > 0 && (
              <Link to="/alerts" className="relative">
                <Bell className="h-5 w-5 text-[var(--text-secondary)] hover:text-neon-cyan transition-colors" />
                <span className="absolute -top-1 -right-1 flex h-4 w-4 items-center justify-center rounded-full bg-neon-red text-[9px] font-bold text-[var(--text-primary)]">
                  {unreadAlerts}
                </span>
              </Link>
            )}
            <StatusPill color={connected ? '#10b981' : '#6b7280'} pulse={connected}>
              <Radio className="h-3 w-3" />
              {connected ? 'LIVE' : 'OFFLINE'}
            </StatusPill>
          </div>
        }
      />

      {/* Auth warning */}
      {auth && !auth.authenticated && (
        <FadeIn>
          <GlassPanel className="flex items-center gap-4 p-4 border-neon-amber/30">
            <div className="rounded-xl bg-neon-amber/10 p-2.5 ring-1 ring-neon-amber/20">
              <AlertCircle className="h-5 w-5 text-neon-amber" />
            </div>
            <div className="flex-1">
              <p className="text-sm font-medium text-neon-amber">Tesla account not connected</p>
              <p className="text-xs text-[var(--text-muted)] mt-0.5">
                Connect your account in <Link to="/settings" className="text-neon-cyan hover:underline">Settings</Link> to start tracking.
              </p>
            </div>
            <Link to="/settings" className="neon-button text-xs px-3 py-1.5">
              Connect <ArrowUpRight className="h-3 w-3 ml-1 inline-block" />
            </Link>
          </GlassPanel>
        </FadeIn>
      )}

      {vehiclesLoading ? (
        <div className="space-y-6">
          <Skeleton className="h-72" />
          <div className="grid grid-cols-4 gap-4">
            {[1, 2, 3, 4].map(i => <Skeleton key={i} className="h-28" />)}
          </div>
        </div>
      ) : vehicles && vehicles.length > 0 ? (
        <>
          {/* ============ PRIMARY VEHICLE HERO ============ */}
          <FadeIn>
            <GlassPanel className="relative overflow-hidden">
              {/* Background gradient */}
              <div className="absolute inset-0 bg-gradient-to-br from-neon-cyan/[0.02] via-transparent to-neon-purple/[0.02]" />

              <div className="relative grid grid-cols-1 lg:grid-cols-[1fr,auto] gap-4 sm:gap-6 p-4 sm:p-6 lg:p-8">
                {/* Left: Vehicle info + stats */}
                <div className="flex flex-col justify-between">
                  <div>
                    <div className="flex items-center gap-3 mb-1">
                      <h2 className="text-2xl font-bold text-[var(--text-primary)]">
                        {primaryVehicle!.display_name || primaryVehicle!.vin}
                      </h2>
                      <StatusBadge status={getVehicleStatus(primaryVehicle!, primaryState)} size="md" />
                    </div>
                    <p className="text-sm text-[var(--text-muted)]">
                      {primaryVehicle!.model} {primaryVehicle!.trim_badging} · <span className="font-mono">{primaryVehicle!.vin}</span>
                    </p>
                  </div>

                  {primaryState ? (
                    <div className="mt-4 sm:mt-6">
                      {/* Radial gauges row */}
                      <div className="flex items-center gap-3 sm:gap-6 mb-4 sm:mb-6 overflow-x-auto pb-1">
                        <RadialGauge value={primaryState.battery_level} max={100} label="Battery" unit="%" color={primaryState.battery_level > 50 ? '#10b981' : '#f59e0b'} size={80} />
                        <RadialGauge value={Math.round(primaryState.rated_range)} max={600} label="Range" unit="km" color="#00f0ff" size={80} />
                        <RadialGauge value={primaryState.speed} max={250} label="Speed" unit="km/h" color={primaryState.speed > 0 ? '#a855f7' : '#374151'} size={80} />
                        <RadialGauge value={primaryState.inside_temp} max={50} label="Inside" unit="°C" color="#f97316" size={80} />
                        <RadialGauge value={primaryState.outside_temp} max={50} label="Outside" unit="°C" color="#3b82f6" size={80} />
                      </div>

                      {/* Charging details when currently charging */}
                      {primaryState.is_charging && (
                        <div className="mb-4 p-3 rounded-xl bg-neon-green/5 border border-neon-green/10">
                          <div className="flex items-center gap-2 mb-2">
                            <BatteryCharging className="h-4 w-4 text-neon-green animate-pulse" />
                            <span className="text-sm font-medium text-neon-green">Charging</span>
                          </div>
                          <div className="grid grid-cols-3 gap-3 text-center text-xs">
                            <div>
                              <p className="text-[var(--text-muted)]">Power</p>
                              <p className="text-sm font-bold text-neon-green">{primaryState.charger_power} kW</p>
                            </div>
                            <div>
                              <p className="text-[var(--text-muted)]">Rate</p>
                              <p className="text-sm font-bold text-[var(--text-primary)]">{primaryState.charge_rate} km/h</p>
                            </div>
                            <div>
                              <p className="text-[var(--text-muted)]">Time to Full</p>
                              <p className="text-sm font-bold text-[var(--text-primary)]">{primaryState.time_to_full_charge > 0 ? `${primaryState.time_to_full_charge.toFixed(1)}h` : '—'}</p>
                            </div>
                          </div>
                        </div>
                      )}

                      {/* Quick telemetry grid */}
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                        {[
                          { icon: Thermometer, label: 'Inside', value: `${primaryState.inside_temp}°C`, color: '#f97316' },
                          { icon: Thermometer, label: 'Outside', value: `${primaryState.outside_temp}°C`, color: '#3b82f6' },
                          { icon: Navigation, label: 'Odometer', value: `${Math.round(primaryState.odometer).toLocaleString()} km`, color: '#a855f7' },
                          { icon: primaryState.is_locked ? Lock : Unlock, label: 'Status', value: primaryState.is_locked ? 'Locked' : 'Unlocked', color: primaryState.is_locked ? '#10b981' : '#f59e0b' },
                          { icon: Shield, label: 'Sentry', value: primaryState.sentry_mode ? 'Active' : 'Off', color: primaryState.sentry_mode ? '#ef4444' : '#374151' },
                          { icon: Gauge, label: 'Firmware', value: primaryState.software_version || '—', color: '#6366f1' },
                          { icon: Zap, label: 'Power', value: `${primaryState.power} kW`, color: primaryState.power > 0 ? '#f59e0b' : primaryState.power < 0 ? '#10b981' : '#374151' },
                          { icon: Activity, label: 'Ideal Range', value: `${Math.round(primaryState.ideal_range)} km`, color: '#00f0ff' },
                        ].map(item => (
                          <div key={item.label} className="flex items-center gap-2 p-2.5 rounded-xl bg-white/[0.02] border border-white/[0.04]">
                            <item.icon className="h-4 w-4 shrink-0" style={{ color: item.color }} />
                            <div className="min-w-0">
                              <p className="text-[10px] text-[var(--text-muted)] uppercase tracking-wider">{item.label}</p>
                              <p className="text-sm font-semibold text-[var(--text-primary)] truncate">{item.value}</p>
                            </div>
                          </div>
                        ))}
                      </div>

                      {/* Quick actions */}
                      <div className="flex gap-2 mt-4">
                        <Link to={`/vehicles/${primaryVehicle!.id}`} className="glass-button text-xs flex items-center gap-1.5">
                          <Eye className="h-3.5 w-3.5" /> Details
                        </Link>
                        <Link to="/commands" className="glass-button text-xs flex items-center gap-1.5">
                          <Zap className="h-3.5 w-3.5" /> Commands
                        </Link>
                        <Link to="/live" className="glass-button text-xs flex items-center gap-1.5">
                          <MapPin className="h-3.5 w-3.5" /> Live Map
                        </Link>
                      </div>
                    </div>
                  ) : (
                    <div className="mt-6 p-4 rounded-xl bg-white/[0.02] border border-white/[0.04] text-center">
                      <p className="text-sm text-[var(--text-secondary)]">Vehicle asleep — wake to see live data</p>
                      <Link to="/commands" className="neon-button text-xs mt-3 inline-flex">Wake Up</Link>
                    </div>
                  )}
                </div>

                {/* Right: Car Visualization */}
                <div className="flex items-center justify-center lg:pr-4">
                  <TeslaCarViz
                    batteryLevel={primaryState?.battery_level ?? 50}
                    isCharging={primaryState?.is_charging ?? false}
                    isLocked={primaryState?.is_locked ?? true}
                    isClimateOn={primaryState?.is_climate_on ?? false}
                    sentryMode={primaryState?.sentry_mode ?? false}
                    speed={primaryState?.speed ?? 0}
                    size="lg"
                    model={parseModelKey(primaryVehicle?.model)}
                  />
                </div>
              </div>
            </GlassPanel>
          </FadeIn>

          {/* ============ FLEET STATS BAR ============ */}
          <StaggerContainer className="grid grid-cols-2 gap-2 sm:gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
            <StaggerItem>
              <GlassPanel className="p-3 sm:p-4 text-center">
                <p className="metric-label mb-1 text-[10px] sm:text-xs">Fleet Size</p>
                <p className="text-xl sm:text-2xl font-bold text-[var(--text-primary)]"><AnimatedNumber value={totalCount} /></p>
                <p className="text-[10px] text-gray-600 mt-1">{onlineCount} online</p>
              </GlassPanel>
            </StaggerItem>
            <StaggerItem>
              <GlassPanel className="p-3 sm:p-4 text-center">
                <p className="metric-label mb-1 text-[10px] sm:text-xs">Distance (30d)</p>
                <p className="text-xl sm:text-2xl font-bold text-neon-cyan"><AnimatedNumber value={totalDistance} suffix=" km" /></p>
                <MiniChart data={recentDrives?.map(d => d.distance).reverse() ?? [0]} color="#00f0ff" height={24} width={60} />
              </GlassPanel>
            </StaggerItem>
            <StaggerItem>
              <GlassPanel className="p-3 sm:p-4 text-center">
                <p className="metric-label mb-1 text-[10px] sm:text-xs">Energy (30d)</p>
                <p className="text-xl sm:text-2xl font-bold text-neon-green"><AnimatedNumber value={totalEnergy} decimals={1} suffix=" kWh" /></p>
                <MiniChart data={recentCharges?.map(s => s.charge_energy_added).reverse() ?? [0]} color="#10b981" height={24} width={60} />
              </GlassPanel>
            </StaggerItem>
            <StaggerItem>
              <GlassPanel className="p-3 sm:p-4 text-center">
                <p className="metric-label mb-1 text-[10px] sm:text-xs">Efficiency</p>
                <p className="text-xl sm:text-2xl font-bold text-neon-amber">
                  <AnimatedNumber value={analytics?.avg_efficiency_wh_km ?? 0} suffix=" Wh/km" />
                </p>
                <p className="text-[10px] text-gray-600 mt-1">fleet average</p>
              </GlassPanel>
            </StaggerItem>
            <StaggerItem>
              <GlassPanel className="p-3 sm:p-4 text-center">
                <p className="metric-label mb-1 text-[10px] sm:text-xs">Alerts</p>
                <p className="text-xl sm:text-2xl font-bold" style={{ color: unreadAlerts > 0 ? '#ef4444' : '#10b981' }}>
                  <AnimatedNumber value={unreadAlerts} />
                </p>
                <p className="text-[10px] text-gray-600 mt-1">unread</p>
              </GlassPanel>
            </StaggerItem>
          </StaggerContainer>

          {/* ============ CONTENT GRID: Activity + Charts + Battery ============ */}
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
            {/* Activity Feed */}
            <FadeIn delay={0.1}>
              <GlassPanel className="p-5 lg:col-span-1 h-full">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="section-title flex items-center gap-2">
                    <Activity className="h-4 w-4 text-neon-cyan" /> Recent Activity
                  </h3>
                  <Link to="/drives" className="text-[10px] text-[var(--text-muted)] hover:text-neon-cyan transition-colors">View all</Link>
                </div>
                {activityItems.length > 0 ? (
                  <div className="max-h-[320px] overflow-y-auto pr-1">
                    {activityItems.slice(0, 8).map((item, i) => (
                      <TimelineItem
                        key={`${item.type}-${i}`}
                        icon={item.type === 'drive'
                          ? <Route className="h-3.5 w-3.5" />
                          : <Zap className="h-3.5 w-3.5" />
                        }
                        title={item.title}
                        subtitle={item.subtitle}
                        time={formatTimeAgo(item.time)}
                        color={item.type === 'drive' ? '#00f0ff' : '#10b981'}
                        isLast={i === Math.min(activityItems.length, 8) - 1}
                      />
                    ))}
                  </div>
                ) : (
                  <div className="flex flex-col items-center justify-center py-8 text-center">
                    <Clock className="h-6 w-6 text-gray-600 mb-2" />
                    <p className="text-xs text-[var(--text-muted)]">No activity yet. Start driving!</p>
                  </div>
                )}
              </GlassPanel>
            </FadeIn>

            {/* Battery Trend + Fleet Health */}
            <FadeIn delay={0.15} className="lg:col-span-2">
              <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 h-full">
                {/* Battery trend chart */}
                <GlassPanel className="p-5">
                  <h3 className="section-title flex items-center gap-2 mb-4">
                    <BatteryCharging className="h-4 w-4 text-neon-green" /> Battery Trend
                  </h3>
                  {batteryTrend.length > 1 ? (
                    <div className="h-36 sm:h-48">
                      <ResponsiveContainer width="100%" height="100%">
                        <AreaChart data={batteryTrend.map((v, i) => ({ i, v }))} margin={{ top: 5, right: 10, left: -10, bottom: 0 }}>
                          <defs>
                            <linearGradient id="batteryTrendGrad" x1="0" y1="0" x2="0" y2="1">
                              <stop offset="5%" stopColor="#10b981" stopOpacity={0.35} />
                              <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
                            </linearGradient>
                          </defs>
                          <CartesianGrid strokeDasharray="3 3" stroke="var(--glass-border)" strokeOpacity={0.4} />
                          <XAxis dataKey="i" tick={{ fill: 'var(--text-muted)', fontSize: 10 }} tickLine={false} axisLine={false} />
                          <YAxis domain={[0, 100]} tick={{ fill: 'var(--text-muted)', fontSize: 10 }} tickLine={false} axisLine={false} unit="%" />
                          <Tooltip content={<ChartTooltip />} />
                          <Area type="monotone" dataKey="v" name="Battery %" stroke="#10b981" fill="url(#batteryTrendGrad)" strokeWidth={2} animationDuration={800} />
                        </AreaChart>
                      </ResponsiveContainer>
                    </div>
                  ) : (
                    <div className="h-36 sm:h-48 flex items-center justify-center">
                      <p className="text-xs text-gray-600">Charge data will appear here</p>
                    </div>
                  )}
                </GlassPanel>

                {/* Fleet overview */}
                <GlassPanel className="p-5">
                  <h3 className="section-title flex items-center gap-2 mb-4">
                    <TrendingUp className="h-4 w-4 text-neon-purple" /> Fleet Performance
                  </h3>
                  <div className="space-y-4">
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-[var(--text-secondary)]">Total Drives (30d)</span>
                      <span className="text-sm font-bold text-[var(--text-primary)]">{analytics?.total_drives ?? 0}</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-[var(--text-secondary)]">Charge Sessions</span>
                      <span className="text-sm font-bold text-[var(--text-primary)]">{analytics?.total_charging_sessions ?? 0}</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-[var(--text-secondary)]">Total Cost</span>
                      <span className="text-sm font-bold text-neon-amber">${((analytics?.total_cost ?? 0)).toFixed(2)}</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-[var(--text-secondary)]">CO2 Saved</span>
                      <span className="text-sm font-bold text-neon-green">{((analytics?.total_energy_kwh ?? 0) * 0.42).toFixed(0)} kg</span>
                    </div>
                    {analytics?.most_efficient_vehicle && (
                      <div className="mt-3 p-3 rounded-xl bg-neon-green/5 border border-neon-green/10">
                        <p className="text-[10px] text-[var(--text-muted)] uppercase tracking-wider">Most Efficient</p>
                        <p className="text-sm font-semibold text-neon-green">{analytics.most_efficient_vehicle.name}</p>
                        <p className="text-xs text-[var(--text-muted)]">{(analytics.most_efficient_vehicle.efficiency ?? 0).toFixed(0)} Wh/km</p>
                      </div>
                    )}
                  </div>
                </GlassPanel>
              </div>
            </FadeIn>
          </div>

          {/* ============ SMART SUGGESTIONS ============ */}
          {recentDrives && recentDrives.length > 0 && (
            <FadeIn delay={0.18}>
              <SmartSuggestions drives={recentDrives} state={primaryState} />
            </FadeIn>
          )}

          {/* ============ OTHER VEHICLES STRIP ============ */}
          {otherVehicles.length > 0 && (
            <FadeIn delay={0.2}>
              <div className="flex items-center justify-between mb-3">
                <h3 className="section-title flex items-center gap-2">
                  <Car className="h-4 w-4 text-[var(--text-secondary)]" /> Other Vehicles
                </h3>
                <Link to="/vehicles" className="text-xs text-[var(--text-muted)] hover:text-neon-cyan transition-colors flex items-center gap-1">
                  Manage fleet <ArrowUpRight className="h-3 w-3" />
                </Link>
              </div>
              <div className="flex gap-4 overflow-x-auto pb-2 scrollbar-thin">
                {otherVehicles.map(v => (
                  <FleetVehicleStrip key={v.id} vehicle={v} state={otherStates?.[v.id]} />
                ))}
              </div>
            </FadeIn>
          )}

          {/* ============ QUICK NAVIGATION ============ */}
          <FadeIn delay={0.25}>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {[
                { to: '/drives', icon: Route, label: 'Drives', desc: 'Trip history', color: '#00f0ff' },
                { to: '/charging', icon: BatteryCharging, label: 'Charging', desc: 'Sessions & costs', color: '#10b981' },
                { to: '/analytics', icon: Gauge, label: 'Analytics', desc: 'Fleet insights', color: '#a855f7' },
                { to: '/battery', icon: Activity, label: 'Battery', desc: 'Health & degradation', color: '#f59e0b' },
              ].map(nav => (
                <Link key={nav.to} to={nav.to} className="group">
                  <GlassPanel hover className="p-4 transition-all group-hover:border-white/[0.12]">
                    <div className="flex items-center gap-3">
                      <div className="rounded-lg p-2" style={{ backgroundColor: `${nav.color}10` }}>
                        <nav.icon className="h-5 w-5" style={{ color: nav.color }} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold text-[var(--text-primary)]">{nav.label}</p>
                        <p className="text-[10px] text-[var(--text-muted)]">{nav.desc}</p>
                      </div>
                      <ChevronRight className="h-4 w-4 text-gray-700 group-hover:text-[var(--text-secondary)] transition-colors" />
                    </div>
                  </GlassPanel>
                </Link>
              ))}
            </div>
          </FadeIn>
        </>
      ) : (
        /* ============ EMPTY / ONBOARDING STATE ============ */
        <FadeIn>
          <GlassPanel className="p-12 text-center relative overflow-hidden">
            <div className="absolute inset-0 bg-gradient-to-br from-neon-cyan/[0.02] via-transparent to-neon-purple/[0.02]" />
            <div className="relative">
              <div className="mx-auto mb-6">
                <TeslaCarViz
                  batteryLevel={75}
                  isCharging={false}
                  isLocked={true}
                  isClimateOn={false}
                  sentryMode={false}
                  speed={0}
                  size="md"
                  model="model3"
                />
              </div>
              <h2 className="text-2xl font-bold text-[var(--text-primary)] mb-2">Welcome to TeslaSync</h2>
              <p className="text-[var(--text-secondary)] max-w-md mx-auto mb-8">
                The next-generation Tesla fleet intelligence platform. Connect your Tesla account to start real-time monitoring, analytics, and vehicle control.
              </p>
              <div className="flex items-center justify-center gap-4">
                <Link to="/settings" className="neon-button">
                  Connect Tesla Account <ArrowUpRight className="h-4 w-4 ml-1 inline-block" />
                </Link>
              </div>
              <div className="mt-10 grid grid-cols-2 sm:grid-cols-4 gap-4 max-w-2xl mx-auto">
                {[
                  { icon: Activity, label: 'Real-time Tracking', color: '#00f0ff' },
                  { icon: Route, label: 'Drive History', color: '#a855f7' },
                  { icon: BatteryCharging, label: 'Charge Analytics', color: '#10b981' },
                  { icon: Shield, label: 'Vehicle Control', color: '#ef4444' },
                ].map(f => (
                  <div key={f.label} className="p-3 rounded-xl bg-white/[0.02] border border-white/[0.04] text-center">
                    <f.icon className="h-6 w-6 mx-auto mb-2" style={{ color: f.color }} />
                    <p className="text-xs font-medium text-gray-300">{f.label}</p>
                  </div>
                ))}
              </div>
            </div>
          </GlassPanel>
        </FadeIn>
      )}
    </div>
  )
}
