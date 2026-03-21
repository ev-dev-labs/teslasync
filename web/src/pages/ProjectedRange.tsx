import { useState, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { getVehicles, getBatteryReport, getMileageStats } from '../api'
import { PageHeader, GlassPanel, FadeIn, Skeleton } from '../components/ui'
import { Target, Battery, Thermometer, TrendingDown, Gauge, Compass } from 'lucide-react'
import clsx from 'clsx'
import {
  LineChart, Line, AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  ReferenceLine
} from 'recharts'

interface TooltipPayload { name: string; value: number; color?: string; stroke?: string }
function ChartTooltip({ active, payload, label }: { active?: boolean; payload?: TooltipPayload[]; label?: string }) {
  if (!active || !payload?.length) return null
  return (
    <div className="glass-panel p-3 text-xs" style={{ background: 'var(--surface-2)', borderColor: 'var(--glass-border)' }}>
      <p style={{ color: 'var(--text-secondary)' }} className="mb-1">{label}</p>
      {payload.map(p => (
        <p key={p.name} style={{ color: 'var(--text-primary)' }}>
          <span style={{ color: p.color || p.stroke }}>●</span> {p.name}: {typeof p.value === 'number' ? p.value.toFixed(1) : p.value}
        </p>
      ))}
    </div>
  )
}

function RangeAssistant({ battery, mileage }: { battery: any; mileage: any }) {
  const [destination, setDestination] = useState(100)
  const [currentBattery, setCurrentBattery] = useState(battery?.current_level ?? 80)
  const [elevation, setElevation] = useState<'flat' | 'hilly' | 'mountain'>('flat')
  const [passengers, setPassengers] = useState(1)
  const [cargo, setCargo] = useState(false)
  const [ac, setAc] = useState(true)
  const [speed, setSpeed] = useState<'city' | 'highway' | 'mixed'>('mixed')
  
  const baseEfficiency = 170 // Wh/km
  
  const adjustedEfficiency = useMemo(() => {
    let eff = baseEfficiency
    if (elevation === 'hilly') eff *= 1.15
    if (elevation === 'mountain') eff *= 1.35
    if (passengers > 2) eff *= 1.03
    if (cargo) eff *= 1.05
    if (ac) eff *= 1.08
    if (speed === 'highway') eff *= 1.25
    if (speed === 'city') eff *= 0.9
    return eff
  }, [elevation, passengers, cargo, ac, speed])
  
  const batteryCapacity = 75000
  const availableEnergy = (currentBattery / 100) * batteryCapacity
  const energyNeeded = destination * adjustedEfficiency
  const maxRange = availableEnergy / adjustedEfficiency
  const arrivalBattery = Math.max(0, ((availableEnergy - energyNeeded) / batteryCapacity) * 100)
  const canMakeIt = arrivalBattery > 5
  
  const confidence = arrivalBattery > 20 ? 'high' : arrivalBattery > 10 ? 'medium' : arrivalBattery > 0 ? 'low' : 'impossible'
  const confidenceColors: Record<string, string> = { high: '#10b981', medium: '#f59e0b', low: '#ef4444', impossible: '#ef4444' }
  const confidenceLabels: Record<string, string> = { high: 'High Confidence', medium: 'Moderate — plan a charging stop', low: 'Low — charging stop required', impossible: 'Cannot reach without charging' }
  
  // suppress unused-variable lint for props used only for future extension
  void mileage; void passengers; void setPassengers
  
  return (
    <GlassPanel className="p-6">
      <h3 className="flex items-center gap-2 text-sm font-semibold mb-4" style={{color:'var(--text-primary)'}}>
        <Compass className="h-4 w-4 text-neon-green" /> Range Assistant
      </h3>
      
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Inputs */}
        <div className="space-y-4">
          <div>
            <label className="text-[11px] text-[var(--text-muted)] uppercase">Distance to destination</label>
            <div className="flex items-center gap-3">
              <input type="range" min={10} max={500} value={destination} onChange={e => setDestination(Number(e.target.value))} className="flex-1" />
              <span className="text-lg font-bold text-neon-cyan w-20 text-right">{destination} km</span>
            </div>
          </div>
          
          <div>
            <label className="text-[11px] text-[var(--text-muted)] uppercase">Current battery</label>
            <div className="flex items-center gap-3">
              <input type="range" min={5} max={100} value={currentBattery} onChange={e => setCurrentBattery(Number(e.target.value))} className="flex-1" />
              <span className="text-lg font-bold w-16 text-right" style={{color: currentBattery > 50 ? '#10b981' : currentBattery > 20 ? '#f59e0b' : '#ef4444'}}>{currentBattery}%</span>
            </div>
          </div>
          
          <div className="grid grid-cols-3 gap-2">
            {(['flat','hilly','mountain'] as const).map(e => (
              <button key={e} onClick={() => setElevation(e)}
                className={clsx('py-2 rounded-lg text-xs font-medium transition-all', elevation === e ? 'bg-neon-cyan/20 text-neon-cyan ring-1 ring-neon-cyan/30' : 'bg-white/5 text-[var(--text-muted)]')}>
                {e === 'flat' ? '🏜️ Flat' : e === 'hilly' ? '⛰️ Hilly' : '🏔️ Mountain'}
              </button>
            ))}
          </div>
          
          <div className="grid grid-cols-3 gap-2">
            {(['city','mixed','highway'] as const).map(s => (
              <button key={s} onClick={() => setSpeed(s)}
                className={clsx('py-2 rounded-lg text-xs font-medium transition-all', speed === s ? 'bg-neon-purple/20 text-neon-purple ring-1 ring-neon-purple/30' : 'bg-white/5 text-[var(--text-muted)]')}>
                {s === 'city' ? '🏙️ City' : s === 'mixed' ? '🛣️ Mixed' : '🛤️ Highway'}
              </button>
            ))}
          </div>
          
          <div className="flex gap-3">
            <label className="flex items-center gap-2 text-xs cursor-pointer">
              <input type="checkbox" checked={ac} onChange={e => setAc(e.target.checked)} /> A/C On
            </label>
            <label className="flex items-center gap-2 text-xs cursor-pointer">
              <input type="checkbox" checked={cargo} onChange={e => setCargo(e.target.checked)} /> Heavy Cargo
            </label>
          </div>
        </div>
        
        {/* Result */}
        <div>
          <div className="rounded-xl p-5 text-center mb-4" style={{background: `${confidenceColors[confidence]}15`, border: `1px solid ${confidenceColors[confidence]}30`}}>
            <p className="text-3xl font-bold" style={{color: confidenceColors[confidence]}}>
              {canMakeIt ? `${arrivalBattery.toFixed(0)}%` : '⚠️'}
            </p>
            <p className="text-sm mt-1" style={{color: confidenceColors[confidence]}}>
              {canMakeIt ? `Arrive with ${arrivalBattery.toFixed(0)}% battery` : 'Charging stop needed'}
            </p>
            <p className="text-xs mt-2 text-[var(--text-muted)]">{confidenceLabels[confidence]}</p>
          </div>
          
          <div className="grid grid-cols-2 gap-3">
            <div className="glass-card p-3 rounded-lg text-center">
              <p className="text-lg font-bold text-neon-cyan">{maxRange.toFixed(0)} km</p>
              <p className="text-[10px] text-[var(--text-muted)]">Max Range</p>
            </div>
            <div className="glass-card p-3 rounded-lg text-center">
              <p className="text-lg font-bold text-neon-purple">{adjustedEfficiency.toFixed(0)} Wh/km</p>
              <p className="text-[10px] text-[var(--text-muted)]">Est. Efficiency</p>
            </div>
          </div>
          
          {/* Range bar */}
          <div className="mt-4">
            <div className="h-4 rounded-full overflow-hidden" style={{background:'var(--surface-2)'}}>
              <div className="h-full rounded-full transition-all duration-500" style={{
                width: `${Math.min(100, (destination / maxRange) * 100)}%`,
                background: canMakeIt ? 'linear-gradient(90deg, #10b981, #00f0ff)' : 'linear-gradient(90deg, #f59e0b, #ef4444)',
              }} />
            </div>
            <div className="flex justify-between text-[10px] text-[var(--text-muted)] mt-1">
              <span>0 km</span>
              <span>{destination} km (destination)</span>
              <span>{maxRange.toFixed(0)} km (max)</span>
            </div>
          </div>
        </div>
      </div>
    </GlassPanel>
  )
}

export default function ProjectedRange() {
  const { data: vehicles } = useQuery({ queryKey: ['vehicles'], queryFn: getVehicles })
  const [selectedVehicle, setSelectedVehicle] = useState<number | null>(null)
  const vehicleId = selectedVehicle ?? vehicles?.[0]?.id ?? null

  const { data: battery, isLoading: loadingBattery } = useQuery({
    queryKey: ['battery-report', vehicleId],
    queryFn: () => getBatteryReport(vehicleId!),
    enabled: vehicleId !== null,
  })

  const { data: mileageStats } = useQuery({
    queryKey: ['mileage-stats', vehicleId],
    queryFn: () => getMileageStats(vehicleId!),
    enabled: vehicleId !== null,
  })

  // Projected range based on battery degradation trend
  const trendData = (battery?.monthly_trend ?? []).map(m => ({
    month: m.month,
    range_km: m.range_km,
    capacity_pct: m.capacity_pct,
  }))

  // Simple linear projection: take degradation rate and project forward
  const degradationRate = battery ? battery.degradation_pct / Math.max(1, (battery.total_cycles || 1)) : 0
  const currentRange = battery?.estimated_range_current_km ?? 0
  const newRange = battery?.estimated_range_new_km ?? 0

  // Daily avg driving distance for "days of range" calc
  const avgDailyKm = mileageStats?.avg_daily ?? 0

  // Range at different temperatures (simplified model)
  const temps = [-20, -10, 0, 10, 20, 30, 40]
  const tempRangeData = temps.map(t => {
    // Cold weather reduces range ~30% at -20C, ~0% at 20C, heat slightly reduces at 40C
    let factor = 1.0
    if (t < 20) factor = 1.0 - (20 - t) * 0.015
    else if (t > 30) factor = 1.0 - (t - 30) * 0.005
    factor = Math.max(0.5, Math.min(1.0, factor))
    return { temp: `${t}°C`, range_km: Math.round(currentRange * factor), factor: Math.round(factor * 100) }
  })

  // Project future range (12 months)
  const projectionData = Array.from({ length: 13 }, (_, i) => {
    const monthsAhead = i
    const projectedDeg = Math.min(100, (battery?.degradation_pct ?? 0) + degradationRate * 50 * monthsAhead)
    const projectedRange = newRange * (1 - projectedDeg / 100)
    const now = new Date()
    now.setMonth(now.getMonth() + monthsAhead)
    return {
      month: now.toLocaleDateString(undefined, { year: 'numeric', month: 'short' }),
      range_km: Math.round(projectedRange),
      degradation: projectedDeg.toFixed(1),
    }
  })

  const daysOfRange = avgDailyKm > 0 ? (currentRange / avgDailyKm).toFixed(0) : '–'

  return (
    <FadeIn>
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 sm:gap-0 mb-6 sm:mb-8">
        <PageHeader title="Projected Range" subtitle="Range estimation based on degradation and conditions" icon={<Target className="h-7 w-7 text-neon-blue" />} />
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

      {/* Summary Cards */}
      {loadingBattery ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-3 mb-6 sm:mb-8">
          {[1,2,3,4,5].map(i => <Skeleton key={i} className="h-24 rounded-xl" />)}
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-3 mb-6 sm:mb-8">
          {[
            { label: 'Current Range', value: `${currentRange.toFixed(0)} km`, sub: `${(currentRange * 0.621371).toFixed(0)} mi`, icon: Gauge, color: '#00f0ff' },
            { label: 'When New', value: `${newRange.toFixed(0)} km`, sub: `${(newRange * 0.621371).toFixed(0)} mi`, icon: Battery, color: '#10b981' },
            { label: 'Degradation', value: `${(battery?.degradation_pct ?? 0).toFixed(1)}%`, sub: `${battery?.total_cycles ?? 0} cycles`, icon: TrendingDown, color: '#f59e0b' },
            { label: 'Health Score', value: `${battery?.health_score ?? 0}/100`, sub: `${(battery?.current_capacity_pct ?? 0).toFixed(1)}% capacity`, icon: Battery, color: '#8b5cf6' },
            { label: 'Days of Range', value: daysOfRange, sub: `at ${avgDailyKm.toFixed(0)} km/day avg`, icon: Target, color: '#ec4899' },
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

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-6 mb-6">
        {/* Historical Range Trend */}
        <GlassPanel className="p-4 sm:p-6">
          <h3 className="text-sm font-semibold mb-4" style={{ color: 'var(--text-primary)' }}>Historical Range Trend</h3>
          {trendData.length === 0 ? (
            <div className="flex items-center justify-center h-48 sm:h-64 text-[var(--text-muted)] text-sm">No trend data</div>
          ) : (
            <ResponsiveContainer width="100%" height={280}>
              <LineChart data={trendData}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--glass-border)" strokeOpacity={0.5} />
                <XAxis dataKey="month" tick={{ fontSize: 10, fill: 'var(--text-muted)' }} />
                <YAxis tick={{ fontSize: 10, fill: 'var(--text-muted)' }} />
                <Tooltip content={<ChartTooltip />} />
                <Line type="monotone" dataKey="range_km" stroke="#00f0ff" strokeWidth={2} dot={{ r: 3 }} name="Range (km)" />
                <ReferenceLine y={newRange} stroke="#10b981" strokeDasharray="5 5" label={{ value: 'New', fill: '#10b981', fontSize: 10 }} />
              </LineChart>
            </ResponsiveContainer>
          )}
        </GlassPanel>

        {/* Temperature Impact */}
        <GlassPanel className="p-4 sm:p-6">
          <h3 className="text-sm font-semibold mb-4" style={{ color: 'var(--text-primary)' }}>
            <Thermometer className="h-4 w-4 inline mr-1" /> Temperature Impact on Range
          </h3>
          <ResponsiveContainer width="100%" height={280}>
            <AreaChart data={tempRangeData}>
              <defs>
                <linearGradient id="tempGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#f59e0b" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="#f59e0b" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--glass-border)" strokeOpacity={0.5} />
              <XAxis dataKey="temp" tick={{ fontSize: 10, fill: 'var(--text-muted)' }} />
              <YAxis tick={{ fontSize: 10, fill: 'var(--text-muted)' }} />
              <Tooltip content={<ChartTooltip />} />
              <ReferenceLine y={currentRange} stroke="#00f0ff" strokeDasharray="5 5" label={{ value: 'Ideal', fill: '#00f0ff', fontSize: 10 }} />
              <Area type="monotone" dataKey="range_km" stroke="#f59e0b" fill="url(#tempGrad)" strokeWidth={2} name="Range (km)" />
            </AreaChart>
          </ResponsiveContainer>
        </GlassPanel>
      </div>

      {/* Projected Range */}
      <GlassPanel className="p-4 sm:p-6">
        <h3 className="text-sm font-semibold mb-4" style={{ color: 'var(--text-primary)' }}>12-Month Range Projection</h3>
        {projectionData.length === 0 ? (
          <div className="flex items-center justify-center h-48 sm:h-64 text-[var(--text-muted)] text-sm">No projection data</div>
        ) : (
          <ResponsiveContainer width="100%" height={300}>
            <AreaChart data={projectionData}>
              <defs>
                <linearGradient id="projGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#8b5cf6" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="#8b5cf6" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--glass-border)" strokeOpacity={0.5} />
              <XAxis dataKey="month" tick={{ fontSize: 10, fill: 'var(--text-muted)' }} />
              <YAxis tick={{ fontSize: 10, fill: 'var(--text-muted)' }} />
              <Tooltip content={<ChartTooltip />} />
              <ReferenceLine y={currentRange} stroke="#00f0ff" strokeDasharray="5 5" label={{ value: 'Current', fill: '#00f0ff', fontSize: 10 }} />
              <Area type="monotone" dataKey="range_km" stroke="#8b5cf6" fill="url(#projGrad)" strokeWidth={2} name="Projected Range (km)" />
            </AreaChart>
          </ResponsiveContainer>
        )}
      </GlassPanel>

      {/* Range Assistant */}
      <div className="mt-6">
        <RangeAssistant battery={battery} mileage={mileageStats} />
      </div>
    </FadeIn>
  )
}
