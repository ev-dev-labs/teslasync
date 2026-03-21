import { useState, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { getVehicles, getDrives, Drive, Vehicle } from '../api'
import { Route, Clock, Gauge, Battery, ChevronRight, TrendingUp, TrendingDown, Zap, ArrowUpDown, Calendar, MapPin, Download, Award, AlertTriangle } from 'lucide-react'
import { PageHeader, GlassPanel, FadeIn, StaggerContainer, StaggerItem, Skeleton, EmptyState, Pagination, DateRangeFilter } from '../components/ui'
import { RadialGauge, MetricBar, AnimatedNumber } from '../components/Widgets'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, AreaChart, Area, ScatterChart, Scatter, ReferenceLine
} from 'recharts'
import clsx from 'clsx'
import { useSettings } from '../hooks/useSettings'
import { computeDriveScore, getScoreColor } from '../components/DriveScore'

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

function formatDuration(min: number): string {
  const h = Math.floor(min / 60)
  const m = Math.round(min % 60)
  return h > 0 ? `${h}h ${m}m` : `${m}m`
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

function getEfficiency(drive: Drive): number | null {
  const batteryUsed = (drive.start_battery_level ?? 0) - (drive.end_battery_level ?? 0)
  if (drive.distance > 0 && batteryUsed > 0) return (batteryUsed * 0.75 * 1000) / drive.distance
  return null
}

function getEfficiencyScore(eff: number | null): { score: number; label: string; color: string } {
  if (!eff) return { score: 0, label: '—', color: '#6b7280' }
  if (eff < 130) return { score: 100, label: 'A+', color: '#10b981' }
  if (eff < 160) return { score: 85, label: 'A', color: '#10b981' }
  if (eff < 190) return { score: 70, label: 'B', color: '#00f0ff' }
  if (eff < 220) return { score: 55, label: 'C', color: '#f59e0b' }
  return { score: 30, label: 'D', color: '#ef4444' }
}

function DriveCard({ drive, convertDistance, convertSpeed, convertEfficiency, distanceUnit, speedUnit, efficiencyUnit }: { drive: Drive; convertDistance: (v: number) => number; convertSpeed: (v: number) => number; convertEfficiency: (v: number) => number; distanceUnit: string; speedUnit: string; efficiencyUnit: string }) {
  const avgSpeed = drive.duration_min > 0 ? convertSpeed(drive.distance / (drive.duration_min / 60)).toFixed(0) : '—'
  const eff = getEfficiency(drive)
  const effConverted = eff ? convertEfficiency(eff) : null
  const score = getEfficiencyScore(eff)

  return (
    <Link to={`/drives/${drive.id}`}>
      <GlassPanel hover glow="cyan" className="p-4 transition-all duration-200 group cursor-pointer">
        <div className="flex items-center gap-4">
          {/* Efficiency score badge */}
          <div className="flex flex-col items-center shrink-0 w-12">
            <span className="text-lg font-bold" style={{ color: score.color }}>{score.label}</span>
            <span className="text-[9px] text-gray-600 uppercase">score</span>
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-3 mb-1">
              <p className="text-sm font-semibold text-[var(--text-primary)]">{formatDate(drive.start_date)}</p>
              <span className="text-xs px-2 py-0.5 rounded-full bg-neon-cyan/10 text-neon-cyan font-medium">
                {convertDistance(drive.distance).toFixed(1)} {distanceUnit}
              </span>
              {drive.speed_max !== null && drive.speed_max > 130 && (
                <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-neon-red/10 text-neon-red font-medium">
                  High speed
                </span>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-[var(--text-muted)]">
              <span className="flex items-center gap-1"><Clock className="h-3 w-3" /> {formatDuration(drive.duration_min)}</span>
              <span className="flex items-center gap-1"><Gauge className="h-3 w-3" /> Avg {avgSpeed} {speedUnit}</span>
              {drive.speed_max !== null && (
                <span className="flex items-center gap-1"><TrendingUp className="h-3 w-3" /> Max {convertSpeed(drive.speed_max).toFixed(0)} {speedUnit}</span>
              )}
              {drive.start_battery_level !== null && drive.end_battery_level !== null && (
                <span className="flex items-center gap-1">
                  <Battery className="h-3 w-3" />
                  <span className="text-neon-green">{drive.start_battery_level}%</span> → <span className={clsx(drive.end_battery_level < 20 ? 'text-neon-red' : 'text-neon-amber')}>{drive.end_battery_level}%</span>
                </span>
              )}
              {effConverted && (
                <span className="flex items-center gap-1" style={{ color: score.color }}>
                  <Zap className="h-3 w-3" /> {effConverted.toFixed(0)} {efficiencyUnit}
                </span>
              )}
            </div>
          </div>
          <ChevronRight className="h-4 w-4 text-gray-700 group-hover:text-neon-cyan transition-colors" />
        </div>
      </GlassPanel>
    </Link>
  )
}

function DriveScoreTrends({ drives }: { drives: Drive[] }) {
  const scores = useMemo(() => {
    return drives.filter(d => d.distance > 0).map(d => {
      const { total } = computeDriveScore(d)
      return { date: d.start_date, score: total, distance: d.distance }
    }).reverse() // oldest first for chart
  }, [drives])

  const avg = scores.length > 0 ? Math.round(scores.reduce((s, d) => s + d.score, 0) / scores.length) : 0
  const best = scores.length > 0 ? Math.max(...scores.map(s => s.score)) : 0
  const worst = scores.length > 0 ? Math.min(...scores.map(s => s.score)) : 0

  // Trend: compare last 10 vs previous 10
  const recent = scores.slice(-10)
  const previous = scores.slice(-20, -10)
  const recentAvg = recent.length > 0 ? recent.reduce((s, d) => s + d.score, 0) / recent.length : 0
  const prevAvg = previous.length > 0 ? previous.reduce((s, d) => s + d.score, 0) / previous.length : 0
  const trend = previous.length > 0 ? Math.round(recentAvg - prevAvg) : 0

  const chartData = scores.map(s => ({
    date: new Date(s.date).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }),
    score: s.score,
  }))

  if (scores.length < 3) return null

  return (
    <GlassPanel className="p-6">
      <h3 className="section-title mb-4 flex items-center gap-2">
        <Award className="h-4 w-4 text-neon-amber" /> Drive Score Trends
      </h3>

      {/* Stat cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
        <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-3 text-center">
          <p className="text-[10px] text-[var(--text-muted)] uppercase tracking-wider">Average</p>
          <p className="text-2xl font-bold" style={{ color: getScoreColor(avg) }}>{avg}</p>
        </div>
        <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-3 text-center">
          <p className="text-[10px] text-[var(--text-muted)] uppercase tracking-wider">Best</p>
          <p className="text-2xl font-bold text-neon-green">{best}</p>
        </div>
        <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-3 text-center">
          <p className="text-[10px] text-[var(--text-muted)] uppercase tracking-wider">Worst</p>
          <p className="text-2xl font-bold text-neon-red">{worst}</p>
        </div>
        <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-3 text-center">
          <p className="text-[10px] text-[var(--text-muted)] uppercase tracking-wider">Trend</p>
          <div className="flex items-center justify-center gap-1">
            {trend >= 0
              ? <TrendingUp className="h-4 w-4 text-neon-green" />
              : <TrendingDown className="h-4 w-4 text-neon-red" />
            }
            <p className={`text-2xl font-bold ${trend >= 0 ? 'text-neon-green' : 'text-neon-red'}`}>
              {trend > 0 ? '+' : ''}{trend}
            </p>
          </div>
        </div>
      </div>

      {/* Trend message */}
      {previous.length > 0 && (
        <div className={`mb-4 flex items-center gap-2 text-sm font-medium px-3 py-2 rounded-lg ${
          trend >= 0 ? 'bg-neon-green/10 text-neon-green' : 'bg-neon-red/10 text-neon-red'
        }`}>
          {trend >= 0
            ? <><TrendingUp className="h-4 w-4" /> Improving +{Math.abs(trend)}% vs previous drives</>
            : <><AlertTriangle className="h-4 w-4" /> Declining {trend}% vs previous drives</>
          }
        </div>
      )}

      {/* Area chart */}
      <div className="h-48 sm:h-64">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={chartData}>
            <defs>
              <linearGradient id="scoreGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#f59e0b" stopOpacity={0.3} />
                <stop offset="95%" stopColor="#f59e0b" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--glass-border)" strokeOpacity={0.4} />
            <XAxis dataKey="date" tick={{ fill: 'var(--text-muted)', fontSize: 9 }} tickLine={false} axisLine={false} />
            <YAxis domain={[0, 100]} tick={{ fill: 'var(--text-muted)', fontSize: 10 }} tickLine={false} axisLine={false} />
            <Tooltip content={<ChartTooltip />} />
            <ReferenceLine y={70} stroke="#10b981" strokeDasharray="4 4" strokeOpacity={0.5} />
            <ReferenceLine y={40} stroke="#ef4444" strokeDasharray="4 4" strokeOpacity={0.5} />
            <Area
              type="monotone"
              dataKey="score"
              name="Drive Score"
              stroke="#f59e0b"
              fill="url(#scoreGrad)"
              strokeWidth={2}
              dot={({ cx, cy, payload }: any) => (
                <circle
                  key={`${cx}-${cy}`}
                  cx={cx}
                  cy={cy}
                  r={3}
                  fill={getScoreColor(payload.score)}
                  stroke="none"
                />
              )}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>

      {/* Legend */}
      <div className="mt-3 flex items-center gap-4 text-[10px] text-[var(--text-muted)]">
        <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-neon-green" /> 70+ Great</span>
        <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-neon-amber" /> 40-70 Good</span>
        <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-neon-red" /> &lt;40 Needs improvement</span>
      </div>
    </GlassPanel>
  )
}

export default function Drives() {
  const { data: vehicles } = useQuery({ queryKey: ['vehicles'], queryFn: getVehicles })
  const [selectedVehicle, setSelectedVehicle] = useState<number | null>(null)
  const [sortBy, setSortBy] = useState<'date' | 'distance' | 'efficiency'>('date')
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(50)
  const [startDate, setStartDate] = useState(() => {
    const d = new Date(); d.setDate(d.getDate() - 365); return d.toISOString().split('T')[0]
  })
  const [endDate, setEndDate] = useState(() => new Date().toISOString().split('T')[0])
  const { convertDistance, convertSpeed, convertEfficiency, distanceUnit, speedUnit, efficiencyUnit } = useSettings()

  const vehicleId = selectedVehicle ?? vehicles?.[0]?.id ?? null
  const { data: drives, isLoading } = useQuery({
    queryKey: ['drives', vehicleId, startDate, endDate, page, pageSize],
    queryFn: () => getDrives(vehicleId!, pageSize, (page - 1) * pageSize, startDate, endDate),
    enabled: vehicleId !== null,
  })

  const stats = useMemo(() => {
    if (!drives || drives.length === 0) return null
    const totalDistance = drives.reduce((s, d) => s + d.distance, 0)
    const totalDuration = drives.reduce((s, d) => s + d.duration_min, 0)
    const efficiencies = drives.map(d => getEfficiency(d)).filter((e): e is number => e !== null)
    const avgEff = efficiencies.length > 0 ? efficiencies.reduce((a, b) => a + b, 0) / efficiencies.length : 0
    const bestEff = efficiencies.length > 0 ? Math.min(...efficiencies) : 0
    const longestDrive = drives.reduce((best, d) => d.distance > best.distance ? d : best, drives[0])
    const topSpeed = Math.max(...drives.map(d => d.speed_max ?? 0))
    return { totalDistance, totalDuration, avgEff, bestEff, longestDrive, topSpeed, count: drives.length }
  }, [drives])

  const sortedDrives = useMemo(() => {
    if (!drives) return []
    const sorted = [...drives]
    switch (sortBy) {
      case 'distance': return sorted.sort((a, b) => b.distance - a.distance)
      case 'efficiency': return sorted.sort((a, b) => (getEfficiency(a) ?? 999) - (getEfficiency(b) ?? 999))
      default: return sorted
    }
  }, [drives, sortBy])

  // Distance distribution for histogram
  const distDist = useMemo(() => {
    if (!drives) return []
    const buckets = [
      { range: '0-5', min: 0, max: 5, count: 0 },
      { range: '5-15', min: 5, max: 15, count: 0 },
      { range: '15-30', min: 15, max: 30, count: 0 },
      { range: '30-60', min: 30, max: 60, count: 0 },
      { range: '60-100', min: 60, max: 100, count: 0 },
      { range: '100+', min: 100, max: Infinity, count: 0 },
    ]
    drives.forEach(d => {
      const b = buckets.find(b => d.distance >= b.min && d.distance < b.max)
      if (b) b.count++
    })
    return buckets.map(b => ({ range: b.range + ` ${distanceUnit}`, count: b.count }))
  }, [drives])

  // Speed vs Efficiency scatter
  const scatterData = useMemo(() => {
    if (!drives) return []
    return drives
      .filter(d => d.speed_max && d.duration_min > 0)
      .map(d => {
        const avgSpd = d.distance / (d.duration_min / 60)
        const eff = getEfficiency(d)
        return eff ? { speed: Math.round(avgSpd), efficiency: Math.round(eff) } : null
      })
      .filter(Boolean)
  }, [drives])

  // Daily distance trend (last 20 drives)
  const distanceTrend = useMemo(() => {
    if (!drives) return []
    return drives.slice(0, 20).reverse().map(d => ({
      date: new Date(d.start_date).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }),
      distance: parseFloat(d.distance.toFixed(1)),
      efficiency: getEfficiency(d) ? Math.round(getEfficiency(d)!) : 0,
    }))
  }, [drives])

  return (
    <div className="space-y-8">
      <PageHeader
        title="Drive History"
        subtitle="Trip scoring, efficiency analysis, distance patterns, and performance data"
        actions={
          vehicles && vehicles.length > 0 ? (
            <select value={vehicleId ?? ''} onChange={e => setSelectedVehicle(Number(e.target.value))} className="glass-input text-sm px-3 py-2">
              {vehicles.map((v: Vehicle) => <option key={v.id} value={v.id}>{v.display_name || v.vin}</option>)}
            </select>
          ) : undefined
        }
      />

      <FadeIn>
        <DateRangeFilter
          startDate={startDate}
          endDate={endDate}
          onStartDateChange={setStartDate}
          onEndDateChange={setEndDate}
          onApply={() => setPage(1)}
        />
      </FadeIn>

      {/* Hero gauges */}
      {stats && (
        <FadeIn>
          <GlassPanel className="p-4 sm:p-6">
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-4 sm:gap-6 items-center">
              <RadialGauge value={stats.count} max={Math.max(stats.count, 100)} label="Total Drives" unit="" color="#00f0ff" />
              <RadialGauge value={Math.round(convertDistance(stats.totalDistance))} max={Math.max(convertDistance(stats.totalDistance), 1000)} label={`Total ${distanceUnit}`} unit="" color="#10b981" />
              <RadialGauge value={Math.round(convertEfficiency(stats.avgEff))} max={300} label={`Avg ${efficiencyUnit}`} unit="" color={stats.avgEff < 180 ? '#10b981' : '#f59e0b'} />
              <RadialGauge value={Math.round(convertEfficiency(stats.bestEff))} max={300} label={`Best ${efficiencyUnit}`} unit="" color="#a855f7" />
              <div className="flex flex-col items-center text-center">
                <p className="text-2xl font-bold text-[var(--text-primary)]"><AnimatedNumber value={Math.round(convertSpeed(stats.topSpeed))} /></p>
                <p className="text-[10px] text-[var(--text-muted)] uppercase tracking-wider mt-1">Top Speed</p>
                <p className="text-[10px] text-gray-600">{speedUnit}</p>
              </div>
            </div>
          </GlassPanel>
        </FadeIn>
      )}

      {/* Quick metrics strip */}
      {stats && (
        <FadeIn delay={0.05}>
          <GlassPanel className="p-3 sm:p-5">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 sm:gap-4">
              <div>
                <MetricBar label="Total Drive Time" value={stats.totalDuration} max={Math.max(stats.totalDuration, 600)} color="#00f0ff" />
                <p className="text-[10px] text-gray-600 mt-1">{formatDuration(stats.totalDuration)}</p>
              </div>
              <div>
                <MetricBar label="Avg Trip Distance" value={stats.totalDistance / stats.count} max={100} color="#10b981" />
                <p className="text-[10px] text-gray-600 mt-1">{convertDistance(stats.totalDistance / stats.count).toFixed(1)} {distanceUnit}</p>
              </div>
              <div>
                <MetricBar label="Longest Drive" value={stats.longestDrive.distance} max={Math.max(stats.longestDrive.distance, 200)} color="#a855f7" />
                <p className="text-[10px] text-gray-600 mt-1">{convertDistance(stats.longestDrive.distance).toFixed(1)} {distanceUnit}</p>
              </div>
              <div>
                <MetricBar label="Avg Duration" value={stats.totalDuration / stats.count} max={120} color="#f59e0b" />
                <p className="text-[10px] text-gray-600 mt-1">{formatDuration(stats.totalDuration / stats.count)}</p>
              </div>
            </div>
          </GlassPanel>
        </FadeIn>
      )}

      {/* Charts row */}
      {drives && drives.length > 3 && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Distance trend */}
          <FadeIn delay={0.1}>
            <GlassPanel className="p-6">
              <h3 className="section-title mb-4 flex items-center gap-2">
                <Calendar className="h-4 w-4 text-neon-cyan" /> Recent Drives
              </h3>
              <div className="h-40 sm:h-52">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={distanceTrend}>
                    <defs>
                      <linearGradient id="distGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#00f0ff" stopOpacity={0.3} />
                        <stop offset="95%" stopColor="#00f0ff" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--glass-border)" strokeOpacity={0.4} />
                    <XAxis dataKey="date" tick={{ fill: 'var(--text-muted)', fontSize: 9 }} />
                    <YAxis tick={{ fill: 'var(--text-muted)', fontSize: 10 }} />
                    <Tooltip content={<ChartTooltip />} />
                    <Area type="monotone" dataKey="distance" name={`Distance (${distanceUnit})`} stroke="#00f0ff" fill="url(#distGrad)" strokeWidth={2} />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </GlassPanel>
          </FadeIn>

          {/* Trip distance distribution */}
          <FadeIn delay={0.15}>
            <GlassPanel className="p-6">
              <h3 className="section-title mb-4 flex items-center gap-2">
                <MapPin className="h-4 w-4 text-neon-green" /> Trip Distance Distribution
              </h3>
              <div className="h-40 sm:h-52">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={distDist}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--glass-border)" strokeOpacity={0.4} />
                    <XAxis dataKey="range" tick={{ fill: 'var(--text-muted)', fontSize: 9 }} />
                    <YAxis tick={{ fill: 'var(--text-muted)', fontSize: 10 }} />
                    <Tooltip content={<ChartTooltip />} />
                    <Bar dataKey="count" name="Drives" fill="#10b981" fillOpacity={0.6} radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </GlassPanel>
          </FadeIn>
        </div>
      )}

      {/* Speed vs Efficiency scatter */}
      {scatterData.length > 5 && (
        <FadeIn delay={0.2}>
          <GlassPanel className="p-6">
            <h3 className="section-title mb-4 flex items-center gap-2">
              <Zap className="h-4 w-4 text-neon-amber" /> Speed vs Efficiency
              <span className="text-xs text-[var(--text-muted)] font-normal ml-2">Lower {efficiencyUnit} = better</span>
            </h3>
            <div className="h-40 sm:h-56">
              <ResponsiveContainer width="100%" height="100%">
                <ScatterChart>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--glass-border)" strokeOpacity={0.4} />
                  <XAxis dataKey="speed" name="Avg Speed" unit={` ${speedUnit}`} tick={{ fill: 'var(--text-muted)', fontSize: 10 }} />
                  <YAxis dataKey="efficiency" name="Efficiency" unit={` ${efficiencyUnit}`} tick={{ fill: 'var(--text-muted)', fontSize: 10 }} />
                  <Tooltip content={<ChartTooltip />} />
                  <Scatter data={scatterData} fill="#f59e0b" fillOpacity={0.6} />
                </ScatterChart>
              </ResponsiveContainer>
            </div>
          </GlassPanel>
        </FadeIn>
      )}

      {/* Drive Score Trends */}
      {drives && drives.length > 3 && (
        <FadeIn delay={0.22}>
          <DriveScoreTrends drives={drives} />
        </FadeIn>
      )}

      {/* Sort controls + Drive list */}
      {drives && drives.length > 0 && (
        <FadeIn delay={0.25}>
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 mb-3">
            <h3 className="section-title flex items-center gap-2">
              <Route className="h-4 w-4 text-neon-cyan" /> All Drives
            </h3>
            <div className="flex items-center gap-2">
              <ArrowUpDown className="h-3.5 w-3.5 text-[var(--text-muted)]" />
              {(['date', 'distance', 'efficiency'] as const).map(s => (
                <button key={s} onClick={() => setSortBy(s)}
                  className={clsx('text-xs px-2.5 py-1 rounded-lg transition-colors', sortBy === s ? 'bg-neon-cyan/10 text-neon-cyan' : 'text-[var(--text-muted)] hover:text-gray-300')}>
                  {s === 'date' ? 'Recent' : s === 'distance' ? 'Distance' : 'Efficiency'}
                </button>
              ))}
              <span className="mx-1 h-4 w-px bg-white/10" />
              <a
                href={`/api/v1/export/drives?format=csv${startDate ? `&start=${startDate}` : ''}${endDate ? `&end=${endDate}` : ''}${vehicleId ? `&vehicle_id=${vehicleId}` : ''}`}
                download="teslasync-drives.csv"
                className="glass-button text-xs flex items-center gap-1.5 px-2.5 py-1"
              >
                <Download className="h-3.5 w-3.5" /> CSV
              </a>
              <a
                href={`/api/v1/export/drives?format=json${startDate ? `&start=${startDate}` : ''}${endDate ? `&end=${endDate}` : ''}${vehicleId ? `&vehicle_id=${vehicleId}` : ''}`}
                download="teslasync-drives.json"
                className="glass-button text-xs flex items-center gap-1.5 px-2.5 py-1"
              >
                <Download className="h-3.5 w-3.5" /> JSON
              </a>
            </div>
          </div>
        </FadeIn>
      )}

      {isLoading ? (
        <div className="space-y-3">{[1, 2, 3, 4, 5].map(i => <Skeleton key={i} className="h-20" />)}</div>
      ) : sortedDrives.length > 0 ? (
        <>
          <StaggerContainer className="space-y-3">
            {sortedDrives.map((d: Drive) => (
              <StaggerItem key={d.id}><DriveCard drive={d} convertDistance={convertDistance} convertSpeed={convertSpeed} convertEfficiency={convertEfficiency} distanceUnit={distanceUnit} speedUnit={speedUnit} efficiencyUnit={efficiencyUnit} /></StaggerItem>
            ))}
          </StaggerContainer>
          <Pagination page={page} pageSize={pageSize} total={sortedDrives.length < pageSize ? (page - 1) * pageSize + sortedDrives.length : page * pageSize + 1} onPageChange={setPage} onPageSizeChange={s => { setPageSize(s); setPage(1) }} />
        </>
      ) : (
        <EmptyState icon={<Route className="h-8 w-8" />} title="No drives recorded yet" description="Drive data will appear here once your vehicle records trips." />
      )}
    </div>
  )
}
