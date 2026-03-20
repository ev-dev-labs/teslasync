import { useState, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { getVehicles, getBatteryReport, getChargingSessions, Vehicle } from '../api'
import { PageHeader, GlassPanel, FadeIn, Skeleton } from '../components/ui'
import { RadialGauge, MetricBar } from '../components/Widgets'
import { Activity, Gauge, Heart, Zap, AlertTriangle, CheckCircle, Info, Target } from 'lucide-react'
import {
  AreaChart, Area, Line, XAxis, YAxis, Tooltip,
  ResponsiveContainer, BarChart, Bar, ReferenceLine, ComposedChart,
  PieChart, Pie, Cell, Legend,
} from 'recharts'
import clsx from 'clsx'
import { ChartTooltip, axisTickSm, chartGrid } from '../components/Charts'

function InsightCard({ icon, title, description, status }: { icon: React.ReactNode; title: string; description: string; status: 'good' | 'warning' | 'critical' }) {
  const colors = { good: 'border-neon-green/20 bg-neon-green/5', warning: 'border-neon-amber/20 bg-neon-amber/5', critical: 'border-neon-red/20 bg-neon-red/5' }
  const iconColors = { good: 'text-neon-green', warning: 'text-neon-amber', critical: 'text-neon-red' }
  return (
    <div className={clsx('rounded-xl border p-4 transition-all duration-200', colors[status])}>
      <div className="flex items-start gap-3">
        <div className={clsx('mt-0.5', iconColors[status])}>{icon}</div>
        <div>
          <p className="text-sm font-medium text-[var(--text-primary)]">{title}</p>
          <p className="text-xs text-[var(--text-secondary)] mt-0.5">{description}</p>
        </div>
      </div>
    </div>
  )
}

export default function BatteryHealth() {
  const { data: vehicles } = useQuery({ queryKey: ['vehicles'], queryFn: getVehicles })
  const [selectedVehicle, setSelectedVehicle] = useState<number | null>(null)

  const vehicleId = selectedVehicle ?? vehicles?.[0]?.id ?? null
  const { data: report, isLoading } = useQuery({
    queryKey: ['battery-report', vehicleId],
    queryFn: () => getBatteryReport(vehicleId!),
    enabled: vehicleId !== null,
  })

  const { data: sessions } = useQuery({
    queryKey: ['charging-battery', vehicleId],
    queryFn: () => getChargingSessions(vehicleId!, 100),
    enabled: vehicleId !== null,
  })

  const healthScore = report?.health_score ?? 95
  const degradation = report?.degradation_pct ?? 5
  const currentCapacity = report?.current_capacity_pct ?? 95
  const cycles = report?.total_cycles ?? 0

  const trendData = report?.monthly_trend ?? Array.from({ length: 12 }, (_, i) => ({
    month: new Date(Date.now() - (11 - i) * 30 * 86400000).toLocaleDateString(undefined, { month: 'short' }),
    capacity_pct: 100 - (i * 0.4 + Math.random() * 0.3),
    range_km: 500 - (i * 2 + Math.random() * 3),
  }))

  // Degradation prediction: linear extrapolation
  const predictionData = useMemo(() => {
    if (trendData.length < 2) return []
    const first = trendData[0].capacity_pct
    const last = trendData[trendData.length - 1].capacity_pct
    const ratePerMonth = (first - last) / trendData.length
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
    const now = new Date()
    return Array.from({ length: 24 }, (_, i) => {
      const d = new Date(now.getFullYear(), now.getMonth() + i, 1)
      return {
        month: months[d.getMonth()] + ' ' + String(d.getFullYear()).slice(2),
        actual: i < trendData.length ? trendData[i]?.capacity_pct : undefined,
        predicted: last - ratePerMonth * (i - trendData.length + 1),
      }
    })
  }, [trendData])

  // Charging habits analysis
  const chargingHabits = useMemo(() => {
    if (!sessions || sessions.length === 0) return null
    const startLevels = sessions.map(s => s.start_battery_level)
    const endLevels = sessions.filter(s => s.end_battery_level).map(s => s.end_battery_level!)
    const avgStart = startLevels.reduce((a, b) => a + b, 0) / startLevels.length
    const avgEnd = endLevels.length > 0 ? endLevels.reduce((a, b) => a + b, 0) / endLevels.length : 80
    const chargesAbove90 = endLevels.filter(l => l > 90).length
    const chargesBelow10 = startLevels.filter(l => l < 10).length
    const superchargerCount = sessions.filter(s => s.fast_charger_type?.toLowerCase().includes('tesla')).length
    const dcFastCount = sessions.filter(s => s.fast_charger_type && !s.fast_charger_type.toLowerCase().includes('tesla')).length

    return { avgStart, avgEnd, chargesAbove90, chargesBelow10, superchargerCount, dcFastCount, total: sessions.length }
  }, [sessions])

  // Charge level distribution histogram
  const chargeLevelDist = useMemo(() => {
    if (!sessions || sessions.length === 0) return []
    const buckets = Array.from({ length: 10 }, (_, i) => ({ range: `${i * 10}-${i * 10 + 10}%`, startCount: 0, endCount: 0 }))
    sessions.forEach(s => {
      const si = Math.min(Math.floor(s.start_battery_level / 10), 9)
      buckets[si].startCount++
      if (s.end_battery_level) {
        const ei = Math.min(Math.floor(s.end_battery_level / 10), 9)
        buckets[ei].endCount++
      }
    })
    return buckets
  }, [sessions])

  // AC / DC energy breakdown
  const energyBreakdown = useMemo(() => {
    if (!sessions || sessions.length === 0) return null
    let acEnergy = 0, dcEnergy = 0, acCount = 0, dcCount = 0, totalEnergyUsed = 0
    sessions.forEach(s => {
      const isDC = s.fast_charger_type && (s.fast_charger_type.toLowerCase().includes('tesla') || s.fast_charger_type.toLowerCase().includes('dc') || s.fast_charger_type.toLowerCase().includes('ccs') || s.fast_charger_type.toLowerCase().includes('chademo'))
      const energy = s.charge_energy_added ?? 0
      const used = s.charge_energy_used ?? energy
      totalEnergyUsed += used
      if (isDC) { dcEnergy += energy; dcCount++ } else { acEnergy += energy; acCount++ }
    })
    const totalEnergy = acEnergy + dcEnergy
    const efficiency = totalEnergy > 0 && totalEnergyUsed > 0 ? (totalEnergy / totalEnergyUsed * 100) : 100
    return {
      pieData: [
        { name: 'AC', value: +acEnergy.toFixed(1), fill: '#10b981' },
        { name: 'DC', value: +dcEnergy.toFixed(1), fill: '#f59e0b' },
      ],
      acCount, dcCount, totalEnergy, totalEnergyUsed, efficiency,
      totalSessions: sessions.length,
    }
  }, [sessions])

  // Smart insights
  const insights = useMemo(() => {
    const items: { icon: React.ReactNode; title: string; description: string; status: 'good' | 'warning' | 'critical' }[] = []
    if (healthScore >= 90) items.push({ icon: <CheckCircle className="h-4 w-4" />, title: 'Excellent Health', description: `Battery health is ${healthScore}/100 — performing above average.`, status: 'good' })
    else if (healthScore >= 70) items.push({ icon: <Info className="h-4 w-4" />, title: 'Good Health', description: `Battery health is ${healthScore}/100 — normal degradation for age.`, status: 'warning' })
    else items.push({ icon: <AlertTriangle className="h-4 w-4" />, title: 'Health Concern', description: `Battery health dropped to ${healthScore}/100 — consider service check.`, status: 'critical' })

    if (chargingHabits) {
      if (chargingHabits.chargesAbove90 > chargingHabits.total * 0.5) {
        items.push({ icon: <AlertTriangle className="h-4 w-4" />, title: 'Frequent 90%+ Charging', description: `${chargingHabits.chargesAbove90} of ${chargingHabits.total} sessions charged above 90%. Keep daily charging below 80% for longevity.`, status: 'warning' })
      } else {
        items.push({ icon: <CheckCircle className="h-4 w-4" />, title: 'Good Charging Habits', description: `Most charges stay below 90% — ideal for battery longevity.`, status: 'good' })
      }
      if (chargingHabits.chargesBelow10 > 3) {
        items.push({ icon: <AlertTriangle className="h-4 w-4" />, title: 'Deep Discharges Detected', description: `${chargingHabits.chargesBelow10} sessions started below 10%. Avoid deep discharges when possible.`, status: 'warning' })
      }
      if (chargingHabits.superchargerCount > chargingHabits.total * 0.6) {
        items.push({ icon: <Info className="h-4 w-4" />, title: 'High Supercharger Usage', description: `${chargingHabits.superchargerCount} Supercharger sessions. Occasional slow charging helps battery health.`, status: 'warning' })
      }
    }
    const ratePerYear = (degradation / 12) * 12
    if (ratePerYear < 3) items.push({ icon: <Target className="h-4 w-4" />, title: 'Low Degradation Rate', description: `${ratePerYear.toFixed(1)}% per year — well below industry average of 3-5%.`, status: 'good' })
    return items
  }, [healthScore, chargingHabits, degradation])

  // Years until 70% capacity
  const yearsTo70 = degradation > 0 ? ((currentCapacity - 70) / (degradation / (trendData.length / 12))).toFixed(1) : '20+'

  return (
    <div className="space-y-8">
      <PageHeader
        title="Battery Health"
        subtitle="Degradation tracking, prediction, charging habit analysis, and longevity insights"
        actions={
          vehicles && vehicles.length > 1 ? (
            <select value={vehicleId ?? ''} onChange={e => setSelectedVehicle(Number(e.target.value))} className="glass-input text-sm px-3 py-2">
              {vehicles.map((v: Vehicle) => (
                <option key={v.id} value={v.id}>{v.display_name || v.vin}</option>
              ))}
            </select>
          ) : undefined
        }
      />

      {isLoading ? (
        <div className="space-y-6">
          <Skeleton className="h-40" />
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">{[1, 2, 3, 4].map(i => <Skeleton key={i} className="h-28" />)}</div>
        </div>
      ) : (
        <>
          {/* Health Score Hero with Gauges */}
          <FadeIn>
            <GlassPanel className="p-4 sm:p-6 lg:p-8">
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-4 sm:gap-6 items-center">
                <div className="col-span-2 sm:col-span-1 flex flex-col items-center">
                  <RadialGauge value={healthScore} max={100} label="Health Score" unit="/100" size={130}
                    color={healthScore >= 90 ? '#10b981' : healthScore >= 70 ? '#f59e0b' : '#ef4444'} />
                </div>
                <RadialGauge value={currentCapacity} max={100} label="Capacity" unit="%" color="#00f0ff" />
                <RadialGauge value={degradation} max={30} label="Degradation" unit="%" color={degradation < 10 ? '#10b981' : '#f59e0b'} />
                <RadialGauge value={cycles} max={1500} label="Cycles" unit="" color="#a855f7" />
                <div className="flex flex-col items-center text-center">
                  <p className="text-3xl font-bold text-[var(--text-primary)]">{yearsTo70}</p>
                  <p className="text-[10px] text-[var(--text-muted)] uppercase tracking-wider mt-1">Years to 70%</p>
                  <p className="text-[10px] text-gray-600">warranty threshold</p>
                </div>
              </div>
            </GlassPanel>
          </FadeIn>

          {/* Quick metric bars */}
          <FadeIn delay={0.05}>
            <GlassPanel className="p-6">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
                <div>
                  <MetricBar label="Current Capacity" value={currentCapacity} max={100} color="#00f0ff" />
                  <p className="text-[10px] text-gray-600 mt-1">{report?.estimated_range_current_km ? `${Math.round(report.estimated_range_current_km)} km current` : ''} {report?.estimated_range_new_km ? `/ ${Math.round(report.estimated_range_new_km)} km when new` : ''}</p>
                </div>
                <div>
                  <MetricBar label="Degradation" value={degradation} max={30} color={degradation < 10 ? '#10b981' : '#f59e0b'} />
                  <p className="text-[10px] text-gray-600 mt-1">Rate: {(degradation / Math.max(1, trendData.length) * 12).toFixed(2)}% per year</p>
                </div>
                <div>
                  <MetricBar label="Charge Cycles" value={cycles} max={1500} color="#a855f7" />
                  <p className="text-[10px] text-gray-600 mt-1">Tesla warranty: 1,500 cycles / 70%</p>
                </div>
              </div>
            </GlassPanel>
          </FadeIn>

          {/* Battery Cycle Counter */}
          <FadeIn delay={0.07}>
            <GlassPanel className="p-6">
              <h3 className="section-title flex items-center gap-2 mb-4">
                <Activity className="h-4 w-4 text-neon-purple" /> Battery Cycle Counter
              </h3>
              <div className="flex items-center gap-8">
                <div className="text-center">
                  <p className="text-4xl font-bold text-neon-purple">{cycles}</p>
                  <p className="text-xs text-[var(--text-muted)] mt-1">Total Cycles</p>
                </div>
                <div className="flex-1">
                  <div className="flex justify-between text-xs mb-1">
                    <span className="text-[var(--text-secondary)]">{cycles} of ~1,500 rated cycles</span>
                    <span className="text-[var(--text-muted)]">{((cycles / 1500) * 100).toFixed(1)}%</span>
                  </div>
                  <div className="h-3 rounded-full bg-white/5 overflow-hidden">
                    <div
                      className="h-full rounded-full transition-all"
                      style={{
                        width: `${Math.min((cycles / 1500) * 100, 100)}%`,
                        background: cycles < 500 ? '#10b981' : cycles < 1000 ? '#f59e0b' : '#ef4444',
                        boxShadow: `0 0 6px ${cycles < 500 ? '#10b98140' : cycles < 1000 ? '#f59e0b40' : '#ef444440'}`,
                      }}
                    />
                  </div>
                  <div className="flex justify-between text-[10px] text-[var(--text-muted)] mt-2">
                    <span>Remaining: ~{Math.max(1500 - cycles, 0)} cycles</span>
                    <span className={cycles < 500 ? 'text-neon-green' : cycles < 1000 ? 'text-neon-amber' : 'text-neon-red'}>
                      {cycles < 500 ? 'Excellent' : cycles < 1000 ? 'Good' : 'High Usage'}
                    </span>
                  </div>
                </div>
              </div>
            </GlassPanel>
          </FadeIn>

          {/* Smart Insights */}
          <FadeIn delay={0.1}>
            <div className="space-y-2">
              <h3 className="section-title flex items-center gap-2">
                <Heart className="h-4 w-4 text-neon-red" /> Smart Insights
              </h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {insights.map((ins, i) => (
                  <InsightCard key={i} {...ins} />
                ))}
              </div>
            </div>
          </FadeIn>

          {/* Capacity Trend with Prediction */}
          <FadeIn delay={0.15}>
            <GlassPanel className="p-6">
              <h3 className="section-title mb-6 flex items-center gap-2">
                <Activity className="h-4 w-4 text-neon-cyan" /> Capacity Trend & Prediction
                <span className="text-xs text-[var(--text-muted)] font-normal ml-2">Dashed = projected</span>
              </h3>
              <div className="h-48 sm:h-64 lg:h-72">
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={predictionData}>
                    <defs>
                      <linearGradient id="healthGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#00f0ff" stopOpacity={0.15} />
                        <stop offset="95%" stopColor="#00f0ff" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    {chartGrid}
                    <XAxis dataKey="month" tick={axisTickSm} tickLine={false} axisLine={false} />
                    <YAxis yAxisId="left" domain={[70, 100]} tick={axisTickSm} tickLine={false} axisLine={false} unit="%" />
                    <YAxis yAxisId="right" orientation="right" tick={axisTickSm} tickLine={false} axisLine={false} unit=" km" />
                    <Tooltip content={<ChartTooltip />} />
                    <ReferenceLine yAxisId="left" y={70} stroke="#ef4444" strokeDasharray="8 4" label={{ value: '70% warranty', fill: '#ef4444', fontSize: 10, position: 'insideTopLeft' }} />
                    <ReferenceLine yAxisId="left" y={80} stroke="#f59e0b" strokeDasharray="4 4" label={{ value: '80% threshold', fill: '#f59e0b', fontSize: 10, position: 'insideTopLeft' }} />
                    <ReferenceLine yAxisId="left" y={90} stroke="var(--glass-border)" strokeDasharray="2 6" />
                    <Area yAxisId="left" type="monotone" dataKey="actual" name="Actual %" stroke="transparent" fill="url(#healthGrad)" animationDuration={800} />
                    <Line yAxisId="left" type="monotone" dataKey="actual" name="Actual %" stroke="#00f0ff" strokeWidth={2} dot={{ fill: '#00f0ff', r: 3 }} connectNulls={false} animationDuration={800} />
                    <Line yAxisId="left" type="monotone" dataKey="predicted" name="Predicted %" stroke="#00f0ff" strokeWidth={2} strokeDasharray="6 4" dot={false} opacity={0.5} animationDuration={800} />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
            </GlassPanel>
          </FadeIn>

          {/* Range Trend */}
          <FadeIn delay={0.2}>
            <GlassPanel className="p-6">
              <h3 className="section-title mb-6 flex items-center gap-2">
                <Gauge className="h-4 w-4 text-neon-green" /> Estimated Range Over Time
              </h3>
              <div className="h-44 sm:h-56 lg:h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={trendData}>
                    <defs>
                      <linearGradient id="rangeGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#10b981" stopOpacity={0.3} />
                        <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    {chartGrid}
                    <XAxis dataKey="month" tick={axisTickSm} tickLine={false} axisLine={false} />
                    <YAxis tick={axisTickSm} tickLine={false} axisLine={false} />
                    <Tooltip content={<ChartTooltip />} />
                    <Area type="monotone" dataKey="range_km" name="Range (km)" stroke="#10b981" fill="url(#rangeGrad)" strokeWidth={2} animationDuration={800} />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </GlassPanel>
          </FadeIn>

          {/* Charging Habits Distribution */}
          {chargeLevelDist.length > 0 && (
            <FadeIn delay={0.25}>
              <GlassPanel className="p-6">
                <h3 className="section-title mb-6 flex items-center gap-2">
                  <Zap className="h-4 w-4 text-neon-amber" /> Charge Level Distribution
                  <span className="text-xs text-[var(--text-muted)] font-normal ml-2">How often you start/end at each battery level</span>
                </h3>
                <div className="h-40 sm:h-56">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={chargeLevelDist}>
                      {chartGrid}
                      <XAxis dataKey="range" tick={axisTickSm} />
                      <YAxis tick={axisTickSm} />
                      <Tooltip content={<ChartTooltip />} />
                      <Bar dataKey="startCount" name="Charge Started" fill="#ef4444" fillOpacity={0.5} radius={[3, 3, 0, 0]} animationDuration={800} />
                      <Bar dataKey="endCount" name="Charge Ended" fill="#10b981" fillOpacity={0.5} radius={[3, 3, 0, 0]} animationDuration={800} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
                {chargingHabits && (
                  <div className="mt-4 grid grid-cols-2 sm:grid-cols-4 gap-3">
                    <div className="text-center">
                      <p className="text-lg font-bold text-[var(--text-primary)]">{chargingHabits.avgStart.toFixed(0)}%</p>
                      <p className="text-[10px] text-[var(--text-muted)]">Avg Start Level</p>
                    </div>
                    <div className="text-center">
                      <p className="text-lg font-bold text-neon-green">{chargingHabits.avgEnd.toFixed(0)}%</p>
                      <p className="text-[10px] text-[var(--text-muted)]">Avg End Level</p>
                    </div>
                    <div className="text-center">
                      <p className="text-lg font-bold text-neon-amber">{chargingHabits.superchargerCount}</p>
                      <p className="text-[10px] text-[var(--text-muted)]">Supercharger Sessions</p>
                    </div>
                    <div className="text-center">
                      <p className="text-lg font-bold text-neon-cyan">{chargingHabits.total - chargingHabits.superchargerCount - chargingHabits.dcFastCount}</p>
                      <p className="text-[10px] text-[var(--text-muted)]">Home Charges</p>
                    </div>
                  </div>
                )}
              </GlassPanel>
            </FadeIn>
          )}

          {/* Battery Capacity: New vs Now */}
          <FadeIn delay={0.3}>
            <GlassPanel className="p-6">
              <h3 className="section-title mb-6 flex items-center gap-2">
                <Activity className="h-4 w-4 text-neon-cyan" /> Capacity &amp; Range: New vs Now
              </h3>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div className="text-center p-4 rounded-xl" style={{ background: 'var(--surface-2)' }}>
                  <p className="text-[10px] uppercase tracking-wider text-[var(--text-muted)] mb-1">Capacity When New</p>
                  <p className="text-2xl font-bold text-[var(--text-primary)]">100<span className="text-sm text-[var(--text-muted)]">%</span></p>
                </div>
                <div className="text-center p-4 rounded-xl" style={{ background: 'var(--surface-2)' }}>
                  <p className="text-[10px] uppercase tracking-wider text-[var(--text-muted)] mb-1">Capacity Now</p>
                  <p className="text-2xl font-bold text-neon-cyan">{currentCapacity.toFixed(1)}<span className="text-sm text-[var(--text-muted)]">%</span></p>
                  <p className="text-[10px] text-neon-red mt-1">-{degradation.toFixed(1)}%</p>
                </div>
                <div className="text-center p-4 rounded-xl" style={{ background: 'var(--surface-2)' }}>
                  <p className="text-[10px] uppercase tracking-wider text-[var(--text-muted)] mb-1">Range When New</p>
                  <p className="text-2xl font-bold text-[var(--text-primary)]">{report?.estimated_range_new_km ? Math.round(report.estimated_range_new_km) : '—'}<span className="text-sm text-[var(--text-muted)]"> km</span></p>
                </div>
                <div className="text-center p-4 rounded-xl" style={{ background: 'var(--surface-2)' }}>
                  <p className="text-[10px] uppercase tracking-wider text-[var(--text-muted)] mb-1">Range Now</p>
                  <p className="text-2xl font-bold text-neon-green">{report?.estimated_range_current_km ? Math.round(report.estimated_range_current_km) : '—'}<span className="text-sm text-[var(--text-muted)]"> km</span></p>
                  {report?.estimated_range_new_km && report?.estimated_range_current_km && (
                    <p className="text-[10px] text-neon-red mt-1">-{Math.round(report.estimated_range_new_km - report.estimated_range_current_km)} km lost</p>
                  )}
                </div>
              </div>
            </GlassPanel>
          </FadeIn>

          {/* AC/DC Energy & Charging Stats */}
          {energyBreakdown && (
            <FadeIn delay={0.35}>
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <GlassPanel className="p-6">
                  <h3 className="section-title mb-6 flex items-center gap-2">
                    <Zap className="h-4 w-4 text-neon-amber" /> AC / DC Energy Breakdown
                  </h3>
                  <div className="h-52">
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie data={energyBreakdown.pieData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={80} innerRadius={40} strokeWidth={2} stroke="rgba(0,0,0,0.3)">
                          {energyBreakdown.pieData.map(entry => (
                            <Cell key={entry.name} fill={entry.fill} />
                          ))}
                        </Pie>
                        <Legend verticalAlign="bottom" formatter={(v: string) => <span style={{ color: 'var(--text-primary)', fontSize: 12 }}>{v}</span>} />
                        <Tooltip content={({ active, payload }) => {
                          if (!active || !payload?.length) return null
                          const p = payload[0]
                          return (
                            <div className="glass-panel p-3 text-xs" style={{ background: 'var(--surface-2)' }}>
                              <p style={{ color: String(p.payload?.fill ?? '#fff') }}>● {p.name}: {Number(p.value).toFixed(1)} kWh</p>
                            </div>
                          )
                        }} />
                      </PieChart>
                    </ResponsiveContainer>
                  </div>
                </GlassPanel>

                <GlassPanel className="p-6">
                  <h3 className="section-title mb-6 flex items-center gap-2">
                    <Gauge className="h-4 w-4 text-neon-purple" /> Charging Statistics
                  </h3>
                  <div className="space-y-3">
                    {[
                      { label: 'Total Sessions', value: energyBreakdown.totalSessions.toString() },
                      { label: 'AC Sessions', value: energyBreakdown.acCount.toString() },
                      { label: 'DC / Supercharger Sessions', value: energyBreakdown.dcCount.toString() },
                      { label: 'Total Energy Added', value: `${energyBreakdown.totalEnergy.toFixed(1)} kWh` },
                      { label: 'Total Energy Used (from grid)', value: `${energyBreakdown.totalEnergyUsed.toFixed(1)} kWh` },
                      { label: 'Charging Efficiency', value: `${energyBreakdown.efficiency.toFixed(1)}%` },
                      { label: 'Charge Cycles', value: cycles.toString() },
                    ].map(row => (
                      <div key={row.label} className="flex justify-between items-center py-2 border-b border-white/5">
                        <span className="text-xs text-[var(--text-secondary)]">{row.label}</span>
                        <span className="text-sm font-semibold text-[var(--text-primary)]">{row.value}</span>
                      </div>
                    ))}
                  </div>
                </GlassPanel>
              </div>
            </FadeIn>
          )}
        </>
      )}
    </div>
  )
}
