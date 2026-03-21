import { useState, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { getVehicles, getEnergyStats, getDrives, getFleetAnalytics } from '../api'
import { PageHeader, GlassPanel, FadeIn, DateRangeFilter, Skeleton } from '../components/ui'
import { Zap, TrendingUp, Thermometer, Gauge, Fuel, BarChart3, Lightbulb } from 'lucide-react'
import {
  AreaChart, Area, BarChart, Bar, ScatterChart, Scatter, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, Cell
} from 'recharts'

interface TooltipPayload { name: string; value: number; color?: string; fill?: string; stroke?: string }
function ChartTooltip({ active, payload, label }: { active?: boolean; payload?: TooltipPayload[]; label?: string }) {
  if (!active || !payload?.length) return null
  return (
    <div className="glass-panel p-3 text-xs" style={{ background: 'var(--surface-2)', borderColor: 'var(--glass-border)' }}>
      <p style={{ color: 'var(--text-secondary)' }} className="mb-1">{label}</p>
      {payload.map(p => (
        <p key={p.name} style={{ color: 'var(--text-primary)' }}>
          <span style={{ color: p.color || p.fill || p.stroke }}>●</span> {p.name}: {typeof p.value === 'number' ? p.value.toFixed(1) : p.value}
        </p>
      ))}
    </div>
  )
}

function EfficiencyLeaderboard({ analytics }: { vehicles: any[]; analytics: any }) {
  const rankings = useMemo(() => {
    const comparison = analytics?.vehicle_comparison ?? []
    return comparison
      .filter((v: any) => v.efficiency > 0)
      .sort((a: any, b: any) => a.efficiency - b.efficiency) // Lower Wh/km = better
      .map((v: any, i: number) => ({
        ...v,
        rank: i + 1,
        badge: i === 0 ? '🏆' : i === 1 ? '🥈' : i === 2 ? '🥉' : `#${i + 1}`,
      }))
  }, [analytics])

  if (rankings.length < 2) return null // Need at least 2 vehicles

  // Community averages (simulated)
  const communityAvg = 165 // Wh/km average for Model 3/Y
  const yourBest = rankings[0]?.efficiency || communityAvg
  const betterThanPct = Math.round((1 - (yourBest / (communityAvg * 1.3))) * 100) // rough estimate

  return (
    <GlassPanel className="p-6">
      <h3>🏆 Efficiency Leaderboard</h3>

      {/* Community comparison */}
      <div className="rounded-lg p-3 mb-4" style={{background:'rgba(16,185,129,0.05)',border:'1px solid rgba(16,185,129,0.15)'}}>
        <p className="text-xs text-neon-green">
          Your best efficiency ({yourBest.toFixed(0)} Wh/km) is better than ~{betterThanPct}% of Tesla drivers
        </p>
      </div>

      {/* Rankings */}
      <div className="space-y-2">
        {rankings.map((v: any) => (
          <div key={v.name} className="flex items-center gap-3 p-3 rounded-lg" style={{background:'var(--surface-2)'}}>
            <span className="text-xl w-8 text-center">{v.badge}</span>
            <div className="flex-1">
              <p className="text-sm font-medium" style={{color:'var(--text-primary)'}}>{v.name}</p>
              <p className="text-[10px] text-[var(--text-muted)]">{v.distance?.toFixed(0)} km · {v.drives} drives</p>
            </div>
            <div className="text-right">
              <p className="text-sm font-bold text-neon-cyan">{v.efficiency?.toFixed(0)} Wh/km</p>
              <p className="text-[9px] text-[var(--text-muted)]">{v.energy?.toFixed(0)} kWh total</p>
            </div>
          </div>
        ))}
      </div>
    </GlassPanel>
  )
}

function PersonalizedTips({ drives, energy: _energy }: { drives: any[]; energy: any }) {
  const tips = useMemo(() => {
    const result: Array<{ icon: string; title: string; tip: string; impact: string; priority: 'high'|'medium'|'low' }> = []
    if (!drives?.length) return result

    // Analyze speed patterns
    const avgMaxSpeed = drives.reduce((s, d) => s + (d.speed_max || 0), 0) / drives.length
    if (avgMaxSpeed > 120) {
      result.push({
        icon: '🏎️', title: 'Reduce highway speed',
        tip: `Your average max speed is ${avgMaxSpeed.toFixed(0)} km/h. Driving at 110 instead of ${avgMaxSpeed.toFixed(0)} can improve range by ~15%.`,
        impact: '10-20% more range', priority: 'high'
      })
    }

    // Analyze short trips
    const shortTrips = drives.filter(d => d.distance < 5)
    if (shortTrips.length > drives.length * 0.3) {
      result.push({
        icon: '🚶', title: 'Consider walking short distances',
        tip: `${Math.round(shortTrips.length / drives.length * 100)}% of your trips are under 5 km. Short trips are less efficient due to cabin heating/cooling overhead.`,
        impact: 'Save 5-10 kWh/month', priority: 'medium'
      })
    }

    // Analyze cold weather driving
    const coldDrives = drives.filter(d => d.outside_temp_avg != null && d.outside_temp_avg < 5)
    if (coldDrives.length > 5) {
      result.push({
        icon: '❄️', title: 'Pre-condition while plugged in',
        tip: `${coldDrives.length} cold weather drives detected. Pre-conditioning while plugged in uses grid power instead of battery for cabin heating.`,
        impact: '15-30% range saved in cold', priority: 'high'
      })
    }

    // Analyze regenerative braking
    const qualifiedDrives = drives.filter(d => d.distance > 5 && d.start_battery_level && d.end_battery_level)
    const avgEfficiency = qualifiedDrives.length > 0
      ? qualifiedDrives.reduce((s, d) => {
          return s + ((d.start_battery_level - d.end_battery_level) / 100 * 75000) / d.distance
        }, 0) / qualifiedDrives.length
      : 0

    if (avgEfficiency > 200) {
      result.push({
        icon: '🔄', title: 'Use one-pedal driving',
        tip: `Your average consumption is ${avgEfficiency.toFixed(0)} Wh/km. One-pedal driving maximizes regenerative braking and can improve efficiency by 10-15%.`,
        impact: '10-15% efficiency gain', priority: 'medium'
      })
    }

    // Tire pressure
    result.push({
      icon: '🛞', title: 'Check tire pressure monthly',
      tip: 'Under-inflated tires increase rolling resistance by 3-5%. Keep tires at recommended PSI (42 PSI cold for most Teslas).',
      impact: '3-5% range improvement', priority: 'low'
    })

    // Aero
    if (avgMaxSpeed > 100) {
      result.push({
        icon: '💨', title: 'Use aero wheel covers',
        tip: 'Aero wheel covers reduce drag coefficient and improve highway efficiency by 3-5%. Most noticeable above 100 km/h.',
        impact: '3-5% at highway speeds', priority: 'low'
      })
    }

    return result.sort((a, b) => ({ high: 0, medium: 1, low: 2 }[a.priority] - { high: 0, medium: 1, low: 2 }[b.priority]))
  }, [drives])

  return (
    <GlassPanel className="p-6">
      <h3 className="flex items-center gap-2 text-sm font-semibold mb-4" style={{color:'var(--text-primary)'}}>
        <Lightbulb className="h-4 w-4 text-neon-amber" /> Personalized Efficiency Tips
      </h3>
      <div className="space-y-3">
        {tips.map((t, i) => (
          <div key={i} className="flex items-start gap-3 p-3 rounded-lg" style={{background:'var(--surface-2)'}}>
            <span className="text-xl mt-0.5 shrink-0">{t.icon}</span>
            <div className="flex-1">
              <p className="text-sm font-medium" style={{color:'var(--text-primary)'}}>{t.title}</p>
              <p className="text-xs mt-0.5" style={{color:'var(--text-secondary)'}}>{t.tip}</p>
              <span className="inline-block mt-1 px-2 py-0.5 rounded text-[9px] font-medium bg-neon-green/10 text-neon-green">{t.impact}</span>
            </div>
          </div>
        ))}
      </div>
    </GlassPanel>
  )
}

function WeatherImpact({ drives }: { drives: any[] }) {
  const tempBucketsWeather = useMemo(() => {
    const buckets = [
      { label: 'Cold (<5°C)', min: -40, max: 5, drives: [] as any[], color: '#3b82f6' },
      { label: 'Cool (5-15°C)', min: 5, max: 15, drives: [] as any[], color: '#06b6d4' },
      { label: 'Mild (15-25°C)', min: 15, max: 25, drives: [] as any[], color: '#10b981' },
      { label: 'Warm (25-35°C)', min: 25, max: 35, drives: [] as any[], color: '#f59e0b' },
      { label: 'Hot (>35°C)', min: 35, max: 60, drives: [] as any[], color: '#ef4444' },
    ]

    drives.forEach(d => {
      const temp = d.outside_temp_avg ?? d.inside_temp_avg
      if (temp == null) return
      const bucket = buckets.find(b => temp >= b.min && temp < b.max)
      if (bucket) bucket.drives.push(d)
    })

    return buckets.map(b => ({
      ...b,
      count: b.drives.length,
      avgEfficiency: b.drives.length > 0
        ? b.drives.reduce((s: number, d: any) => {
            if (d.distance > 0 && d.start_battery_level != null && d.end_battery_level != null) {
              return s + ((d.start_battery_level - d.end_battery_level) / 100 * 75000) / d.distance
            }
            return s
          }, 0) / b.drives.filter((d: any) => d.distance > 0 && d.start_battery_level != null && d.end_battery_level != null).length
        : 0,
      avgDistance: b.drives.length > 0 ? b.drives.reduce((s: number, d: any) => s + d.distance, 0) / b.drives.length : 0,
    })).filter(b => b.count > 0)
  }, [drives])

  const bestTemp = tempBucketsWeather.length > 0
    ? tempBucketsWeather.reduce((best, b) => b.avgEfficiency > 0 && (best.avgEfficiency === 0 || b.avgEfficiency < best.avgEfficiency) ? b : best, tempBucketsWeather[0])
    : null

  if (tempBucketsWeather.length === 0) return null

  return (
    <GlassPanel className="p-6">
      <h3 className="flex items-center gap-2 text-sm font-semibold mb-4" style={{ color: 'var(--text-primary)' }}>
        <Thermometer className="h-4 w-4 text-neon-amber" /> Weather Impact on Efficiency
      </h3>

      <p className="text-xs text-[var(--text-muted)] mb-4">
        Analysis based on {drives.length} drives. Best efficiency in <span className="text-neon-green font-medium">{bestTemp?.label}</span> conditions.
      </p>

      {/* Horizontal bars showing efficiency by temperature */}
      <div className="space-y-3">
        {tempBucketsWeather.map(b => (
          <div key={b.label}>
            <div className="flex justify-between text-xs mb-1">
              <span style={{ color: 'var(--text-secondary)' }}>{b.label}</span>
              <span className="font-mono" style={{ color: b.color }}>{b.avgEfficiency.toFixed(0)} Wh/km · {b.count} drives</span>
            </div>
            <div className="h-3 rounded-full" style={{ background: 'var(--surface-2)' }}>
              <div className="h-full rounded-full transition-all" style={{
                background: b.color,
                width: `${Math.min(100, (b.avgEfficiency / 300) * 100)}%`,
                opacity: 0.7
              }} />
            </div>
          </div>
        ))}
      </div>

      {/* Tips */}
      <div className="mt-4 rounded-lg p-3 text-xs" style={{ background: 'rgba(0,240,255,0.05)', border: '1px solid rgba(0,240,255,0.1)' }}>
        <p className="font-medium text-neon-cyan mb-1">💡 Tips</p>
        <ul className="space-y-1 text-[var(--text-secondary)]">
          <li>• Cold weather (&lt;5°C) can increase consumption by 30-50%</li>
          <li>• Pre-condition while plugged in to save battery in cold weather</li>
          <li>• Hot weather (&gt;35°C) increases A/C usage, reducing range ~10-15%</li>
          <li>• Optimal efficiency is typically at 15-25°C</li>
        </ul>
      </div>
    </GlassPanel>
  )
}

export default function Efficiency() {
  const { data: vehicles } = useQuery({ queryKey: ['vehicles'], queryFn: getVehicles })
  const [selectedVehicle, setSelectedVehicle] = useState<number | null>(null)
  const [startDate, setStartDate] = useState(() => {
    const d = new Date(); d.setDate(d.getDate() - 30); return d.toISOString().split('T')[0]
  })
  const [endDate, setEndDate] = useState(() => new Date().toISOString().split('T')[0])
  const vehicleId = selectedVehicle ?? vehicles?.[0]?.id ?? null

  const { data: energy, isLoading } = useQuery({
    queryKey: ['energy-stats', vehicleId, startDate],
    queryFn: () => getEnergyStats(vehicleId!, 30, startDate),
    enabled: vehicleId !== null,
  })

  const { data: drives } = useQuery({
    queryKey: ['drives', vehicleId],
    queryFn: () => getDrives(vehicleId!, 200),
    enabled: vehicleId !== null,
  })

  const { data: analytics } = useQuery({
    queryKey: ['fleet-analytics', startDate],
    queryFn: () => getFleetAnalytics(30, startDate),
  })

  // Daily efficiency chart
  const dailyEfficiency = (energy?.daily_breakdown ?? []).map(d => ({
    date: new Date(d.date).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }),
    efficiency: d.efficiency,
    energy: d.energy_kwh,
    distance: d.distance_km,
  }))

  // Speed vs efficiency from drives
  const speedEffData = (drives ?? [])
    .filter(d => d.distance > 0 && d.speed_max && d.start_range_km && d.end_range_km && d.start_battery_level && d.end_battery_level)
    .map(d => {
      const battUsed = (d.start_battery_level! - d.end_battery_level!)
      const efficiency = d.distance > 0 && battUsed > 0 ? (battUsed / d.distance * 1000) : 0
      return { speed: d.speed_max!, efficiency: Math.round(efficiency), distance: d.distance }
    })
    .filter(d => d.efficiency > 0 && d.efficiency < 500)

  // Temperature vs efficiency from analytics
  const tempEffData = analytics?.drive_analytics?.temp_vs_efficiency ?? []

  // Speed distribution
  const speedDist = analytics?.drive_analytics?.speed_distribution ?? []

  // Temperature-bucketed efficiency analysis
  const tempBuckets = useMemo(() => {
    if (!drives || drives.length === 0) return []
    const buckets: Record<string, { count: number; totalEff: number; totalDist: number; totalSpeed: number }> = {}
    const ranges = [
      { min: -Infinity, max: -10, label: '< -10°C' },
      { min: -10, max: 0, label: '-10 to 0°C' },
      { min: 0, max: 10, label: '0 to 10°C' },
      { min: 10, max: 20, label: '10 to 20°C' },
      { min: 20, max: 30, label: '20 to 30°C' },
      { min: 30, max: 40, label: '30 to 40°C' },
      { min: 40, max: Infinity, label: '> 40°C' },
    ]
    ranges.forEach(r => { buckets[r.label] = { count: 0, totalEff: 0, totalDist: 0, totalSpeed: 0 } })
    drives.forEach(d => {
      if (!d.outside_temp_avg || d.distance <= 0) return
      const battUsed = (d.start_battery_level ?? 0) - (d.end_battery_level ?? 0)
      if (battUsed <= 0) return
      const eff = (battUsed * 0.75 * 1000) / d.distance // Wh/km estimate
      if (eff <= 0 || eff > 500) return
      const range = ranges.find(r => d.outside_temp_avg! >= r.min && d.outside_temp_avg! < r.max)
      if (range) {
        const b = buckets[range.label]
        b.count++
        b.totalEff += eff
        b.totalDist += d.distance
        b.totalSpeed += d.speed_max ?? 0
      }
    })
    return ranges
      .map(r => ({
        range: r.label,
        count: buckets[r.label].count,
        avgEff: buckets[r.label].count > 0 ? buckets[r.label].totalEff / buckets[r.label].count : 0,
        totalDist: buckets[r.label].totalDist,
        avgSpeed: buckets[r.label].count > 0 ? buckets[r.label].totalSpeed / buckets[r.label].count : 0,
      }))
      .filter(b => b.count > 0)
  }, [drives])

  // Per-drive consumption stats
  const consumptionStats = useMemo(() => {
    if (!drives || drives.length === 0) return null
    let totalDist = 0, count = 0, totalEff = 0
    drives.forEach(d => {
      if (d.distance <= 0) return
      const battUsed = (d.start_battery_level ?? 0) - (d.end_battery_level ?? 0)
      if (battUsed <= 0) return
      const eff = (battUsed * 0.75 * 1000) / d.distance
      if (eff <= 0 || eff > 500) return
      totalDist += d.distance
      totalEff += eff
      count++
    })
    const avgEff = count > 0 ? totalEff / count : 0
    const kmPerKwh = avgEff > 0 ? 1000 / avgEff : 0
    return { totalDist, count, avgEff, kmPerKwh }
  }, [drives])

  const avgEff = energy?.avg_efficiency_wh_km ?? 0
  const totalEnergy = energy?.total_energy_used_kwh ?? 0
  const totalDist = energy?.total_distance_km ?? 0
  const co2Saved = energy?.co2_saved_kg ?? 0

  return (
    <FadeIn>
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 sm:gap-0 mb-6 sm:mb-8">
        <PageHeader title="Efficiency" subtitle="Energy consumption and driving efficiency analysis" icon={<Zap className="h-7 w-7 text-neon-blue" />} />
        <div className="flex items-center gap-3 w-full sm:w-auto">
          <DateRangeFilter
            startDate={startDate}
            endDate={endDate}
            onStartDateChange={setStartDate}
            onEndDateChange={setEndDate}
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
      </div>

      {/* Stats Cards */}
      {isLoading ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-3 mb-6 sm:mb-8">
          {[1,2,3,4,5].map(i => <Skeleton key={i} className="h-24 rounded-xl" />)}
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-3 mb-6 sm:mb-8">
          {[
            { label: 'Avg Efficiency', value: `${avgEff.toFixed(0)} Wh/km`, sub: `${(avgEff * 1.60934).toFixed(0)} Wh/mi`, icon: Gauge, color: '#00f0ff' },
            { label: 'Energy Used', value: `${totalEnergy.toFixed(1)} kWh`, sub: `selected period`, icon: Zap, color: '#f59e0b' },
            { label: 'Distance', value: `${totalDist.toFixed(0)} km`, sub: `${(totalDist * 0.621371).toFixed(0)} mi`, icon: TrendingUp, color: '#10b981' },
            { label: 'Cost', value: `$${energy?.total_cost?.toFixed(2) ?? '0'}`, sub: `$${totalDist > 0 ? ((energy?.total_cost ?? 0) / totalDist * 100).toFixed(1) : '0'}/100km`, icon: Fuel, color: '#8b5cf6' },
            { label: 'CO₂ Saved', value: `${co2Saved.toFixed(0)} kg`, sub: 'vs ICE vehicle', icon: Thermometer, color: '#ec4899' },
          ].map(card => (
            <GlassPanel key={card.label} className="p-4">
              <div className="flex items-center gap-2 mb-2">
                <card.icon className="h-4 w-4" style={{ color: card.color }} />
                <span className="text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>{card.label}</span>
              </div>
              <p className="text-xl font-bold" style={{ color: 'var(--text-primary)' }}>{card.value}</p>
              <p className="text-[10px] text-[var(--text-muted)] mt-1">{card.sub}</p>
            </GlassPanel>
          ))}
        </div>
      )}

      {/* Daily Efficiency Trend */}
      <GlassPanel className="p-4 sm:p-6 mb-6">
        <h3 className="text-sm font-semibold mb-4" style={{ color: 'var(--text-primary)' }}>Daily Efficiency Trend (Wh/km)</h3>
        {dailyEfficiency.length === 0 ? (
          <div className="flex items-center justify-center h-48 sm:h-64 text-[var(--text-muted)] text-sm">No efficiency data</div>
        ) : (
          <ResponsiveContainer width="100%" height={280}>
            <AreaChart data={dailyEfficiency}>
              <defs>
                <linearGradient id="effGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#00f0ff" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="#00f0ff" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--glass-border)" strokeOpacity={0.5} />
              <XAxis dataKey="date" tick={{ fontSize: 10, fill: 'var(--text-muted)' }} />
              <YAxis tick={{ fontSize: 10, fill: 'var(--text-muted)' }} />
              <Tooltip content={<ChartTooltip />} />
              <Area type="monotone" dataKey="efficiency" stroke="#00f0ff" fill="url(#effGrad)" strokeWidth={2} name="Efficiency (Wh/km)" />
            </AreaChart>
          </ResponsiveContainer>
        )}
      </GlassPanel>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-6 mb-6">
        {/* Speed vs Efficiency Scatter */}
        <GlassPanel className="p-4 sm:p-6">
          <h3 className="text-sm font-semibold mb-4" style={{ color: 'var(--text-primary)' }}>Speed vs Energy Consumption</h3>
          {speedEffData.length === 0 ? (
            <div className="flex items-center justify-center h-48 sm:h-64 text-[var(--text-muted)] text-sm">Not enough drive data</div>
          ) : (
            <ResponsiveContainer width="100%" height={280}>
              <ScatterChart>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--glass-border)" strokeOpacity={0.5} />
                <XAxis dataKey="speed" name="Speed (km/h)" tick={{ fontSize: 10, fill: 'var(--text-muted)' }} />
                <YAxis dataKey="efficiency" name="Wh/km" tick={{ fontSize: 10, fill: 'var(--text-muted)' }} />
                <Tooltip content={<ChartTooltip />} />
                <Scatter data={speedEffData} name="Drives">
                  {speedEffData.map((_, i) => <Cell key={i} fill="#00f0ff" fillOpacity={0.6} />)}
                </Scatter>
              </ScatterChart>
            </ResponsiveContainer>
          )}
        </GlassPanel>

        {/* Temperature vs Efficiency */}
        <GlassPanel className="p-4 sm:p-6">
          <h3 className="text-sm font-semibold mb-4" style={{ color: 'var(--text-primary)' }}>
            <Thermometer className="h-4 w-4 inline mr-1" /> Temperature vs Efficiency
          </h3>
          {tempEffData.length === 0 ? (
            <div className="flex items-center justify-center h-48 sm:h-64 text-[var(--text-muted)] text-sm">No temperature data</div>
          ) : (
            <ResponsiveContainer width="100%" height={280}>
              <ScatterChart>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--glass-border)" strokeOpacity={0.5} />
                <XAxis dataKey="temp" name="Temp (°C)" tick={{ fontSize: 10, fill: 'var(--text-muted)' }} />
                <YAxis dataKey="efficiency" name="Wh/km" tick={{ fontSize: 10, fill: 'var(--text-muted)' }} />
                <Tooltip content={<ChartTooltip />} />
                <Scatter data={tempEffData} name="Drives">
                  {tempEffData.map((_, i) => <Cell key={i} fill="#f59e0b" fillOpacity={0.6} />)}
                </Scatter>
              </ScatterChart>
            </ResponsiveContainer>
          )}
        </GlassPanel>
      </div>

      {/* Speed Distribution */}
      <GlassPanel className="p-4 sm:p-6">
        <h3 className="text-sm font-semibold mb-4" style={{ color: 'var(--text-primary)' }}>Speed Distribution</h3>
        {speedDist.length === 0 ? (
          <div className="flex items-center justify-center h-48 sm:h-64 text-[var(--text-muted)] text-sm">No speed distribution data</div>
        ) : (
          <ResponsiveContainer width="100%" height={250}>
            <BarChart data={speedDist}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--glass-border)" strokeOpacity={0.5} />
              <XAxis dataKey="range" tick={{ fontSize: 10, fill: 'var(--text-muted)' }} />
              <YAxis tick={{ fontSize: 10, fill: 'var(--text-muted)' }} />
              <Tooltip content={<ChartTooltip />} />
              <Bar dataKey="count" fill="#8b5cf6" name="Drives" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        )}
      </GlassPanel>

      {/* Temperature-Bucketed Efficiency Table */}
      {tempBuckets.length > 0 && (
        <GlassPanel className="p-4 sm:p-6 mt-6">
          <h3 className="text-sm font-semibold mb-4 flex items-center gap-2" style={{ color: 'var(--text-primary)' }}>
            <Thermometer className="h-4 w-4 text-neon-amber" /> Efficiency by Temperature Range
          </h3>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs uppercase tracking-wider text-[var(--text-muted)] border-b border-white/5">
                  <th className="text-left py-2 pr-4">Temp Range</th>
                  <th className="text-right py-2 px-3">Drives</th>
                  <th className="text-right py-2 px-3">Avg Wh/km</th>
                  <th className="text-right py-2 px-3">km/kWh</th>
                  <th className="text-right py-2 px-3">Total km</th>
                  <th className="text-right py-2 px-3">Avg Speed</th>
                </tr>
              </thead>
              <tbody>
                {tempBuckets.map(b => (
                  <tr key={b.range} className="border-b border-white/5 hover:bg-white/[0.02] transition-colors">
                    <td className="py-2 pr-4 font-medium text-[var(--text-primary)]">{b.range}</td>
                    <td className="text-right py-2 px-3 text-[var(--text-secondary)]">{b.count}</td>
                    <td className="text-right py-2 px-3">
                      <span style={{ color: b.avgEff < 160 ? '#10b981' : b.avgEff < 200 ? '#f59e0b' : '#ef4444' }}>
                        {b.avgEff.toFixed(0)}
                      </span>
                    </td>
                    <td className="text-right py-2 px-3 text-neon-cyan">{b.avgEff > 0 ? (1000 / b.avgEff).toFixed(1) : '—'}</td>
                    <td className="text-right py-2 px-3 text-[var(--text-secondary)]">{b.totalDist.toFixed(0)}</td>
                    <td className="text-right py-2 px-3 text-[var(--text-secondary)]">{b.avgSpeed.toFixed(0)} km/h</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </GlassPanel>
      )}

      {/* Consumption Summary */}
      {consumptionStats && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-6 mt-6">
          <GlassPanel className="p-4 sm:p-6">
            <h3 className="text-sm font-semibold mb-4 flex items-center gap-2" style={{ color: 'var(--text-primary)' }}>
              <BarChart3 className="h-4 w-4 text-neon-purple" /> Driving Efficiency Summary
            </h3>
            <div className="space-y-3">
              {[
                { label: 'Drives Analyzed', value: consumptionStats.count.toString() },
                { label: 'Total Distance', value: `${consumptionStats.totalDist.toFixed(0)} km` },
                { label: 'Avg Consumption', value: `${consumptionStats.avgEff.toFixed(0)} Wh/km` },
                { label: 'Avg Efficiency', value: `${consumptionStats.kmPerKwh.toFixed(1)} km/kWh` },
                { label: 'Avg Consumption (mi)', value: `${(consumptionStats.avgEff * 1.60934).toFixed(0)} Wh/mi` },
              ].map(row => (
                <div key={row.label} className="flex justify-between items-center py-2 border-b border-white/5">
                  <span className="text-xs text-[var(--text-secondary)]">{row.label}</span>
                  <span className="text-sm font-semibold text-[var(--text-primary)]">{row.value}</span>
                </div>
              ))}
            </div>
          </GlassPanel>

          <GlassPanel className="p-4 sm:p-6">
            <h3 className="text-sm font-semibold mb-4 flex items-center gap-2" style={{ color: 'var(--text-primary)' }}>
              <Zap className="h-4 w-4 text-neon-green" /> Energy Summary
            </h3>
            <div className="space-y-3">
              {[
                { label: 'Total Energy Used', value: `${totalEnergy.toFixed(1)} kWh` },
                { label: 'Distance Covered', value: `${totalDist.toFixed(0)} km (${(totalDist * 0.621371).toFixed(0)} mi)` },
                { label: 'Cost per km', value: totalDist > 0 ? `$${((energy?.total_cost ?? 0) / totalDist).toFixed(3)}` : '$0' },
                { label: 'Cost per mile', value: totalDist > 0 ? `$${((energy?.total_cost ?? 0) / (totalDist * 0.621371)).toFixed(3)}` : '$0' },
                { label: 'CO₂ Saved vs ICE', value: `${co2Saved.toFixed(0)} kg` },
              ].map(row => (
                <div key={row.label} className="flex justify-between items-center py-2 border-b border-white/5">
                  <span className="text-xs text-[var(--text-secondary)]">{row.label}</span>
                  <span className="text-sm font-semibold text-[var(--text-primary)]">{row.value}</span>
                </div>
              ))}
            </div>
          </GlassPanel>
        </div>
      )}
      {/* Weather Impact */}
      {drives && drives.length > 0 && (
        <div className="mt-6">
          <WeatherImpact drives={drives} />
        </div>
      )}
      {/* Efficiency Leaderboard */}
      {vehicles && analytics && (
        <div className="mt-6">
          <EfficiencyLeaderboard vehicles={vehicles ?? []} analytics={analytics} />
        </div>
      )}
      {/* Personalized Tips */}
      {drives && drives.length > 0 && (
        <div className="mt-6">
          <PersonalizedTips drives={drives} energy={energy} />
        </div>
      )}
    </FadeIn>
  )
}
