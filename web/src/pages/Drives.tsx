import { useState, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { getVehicles, getDrives, Drive, Vehicle } from '../api'
import { Route, Clock, Gauge, Battery, ChevronRight, TrendingUp, Zap, ArrowUpDown, Calendar, MapPin, Download } from 'lucide-react'
import { PageHeader, GlassPanel, FadeIn, StaggerContainer, StaggerItem, Skeleton, EmptyState, Pagination, DateRangeFilter } from '../components/ui'
import { RadialGauge, MetricBar, AnimatedNumber } from '../components/Widgets'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, AreaChart, Area, ScatterChart, Scatter
} from 'recharts'
import clsx from 'clsx'
import { useSettings } from '../hooks/useSettings'
import { formatDateTime, formatDateShort } from '../lib/dateFormat'
import { ChartTooltip } from '../components/Charts'

function formatDuration(min: number): string {
  const h = Math.floor(min / 60)
  const m = Math.round(min % 60)
  return h > 0 ? `${h}h ${m}m` : `${m}m`
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
  const actualDistance = drive.start_odometer != null && drive.end_odometer != null && drive.end_odometer > drive.start_odometer
    ? drive.end_odometer - drive.start_odometer
    : drive.distance
  const isCompleted = drive.end_date != null
  const hasData = actualDistance > 0 || (drive.duration_min > 0)
  const avgSpeed = drive.speed_avg != null
    ? convertSpeed(drive.speed_avg).toFixed(0)
    : drive.duration_min > 0 && actualDistance > 0 ? convertSpeed(actualDistance / (drive.duration_min / 60)).toFixed(0) : '—'
  const eff = getEfficiency(drive)
  const effConverted = eff ? convertEfficiency(eff) : null
  const score = getEfficiencyScore(eff)
  const hasBattery = drive.start_battery_level !== null && drive.end_battery_level !== null
    && !(drive.start_battery_level === 0 && drive.end_battery_level === 0 && isCompleted)

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
              <p className="text-sm font-semibold text-[var(--text-primary)]">{formatDateTime(drive.start_date)}</p>
              {hasData ? (
                <span className="text-xs px-2 py-0.5 rounded-full bg-neon-cyan/10 text-neon-cyan font-medium">
                  {convertDistance(actualDistance).toFixed(1)} {distanceUnit}
                </span>
              ) : isCompleted ? (
                <span className="text-xs px-2 py-0.5 rounded-full bg-neon-amber/10 text-neon-amber font-medium">
                  No telemetry
                </span>
              ) : (
                <span className="text-xs px-2 py-0.5 rounded-full bg-neon-green/10 text-neon-green font-medium">
                  In progress
                </span>
              )}
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
              {hasBattery && (
                <span className="flex items-center gap-1">
                  <Battery className="h-3 w-3" />
                  <span className="text-neon-green">{drive.start_battery_level}%</span> → <span className={clsx(drive.end_battery_level! < 20 ? 'text-neon-red' : 'text-neon-amber')}>{drive.end_battery_level}%</span>
                </span>
              )}
              {effConverted && (
                <span className="flex items-center gap-1" style={{ color: score.color }}>
                  <Zap className="h-3 w-3" /> {effConverted.toFixed(0)} {efficiencyUnit}
                </span>
              )}
            </div>
            {(drive.start_address || drive.end_address) && (
              <div className="mt-1 text-[10px] text-[var(--text-secondary)] flex items-center gap-1 truncate">
                <MapPin className="h-2.5 w-2.5 shrink-0" />
                <span className="truncate">{drive.start_address || '?'} → {drive.end_address || '?'}</span>
              </div>
            )}
          </div>
          <ChevronRight className="h-4 w-4 text-gray-700 group-hover:text-neon-cyan transition-colors" />
        </div>
      </GlassPanel>
    </Link>
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
        const avgSpd = d.duration_min > 0 ? d.distance / (d.duration_min / 60) : 0
        const eff = getEfficiency(d)
        return eff ? { speed: Math.round(avgSpd), efficiency: Math.round(eff) } : null
      })
      .filter(Boolean)
  }, [drives])

  // Daily distance trend (last 20 drives)
  const distanceTrend = useMemo(() => {
    if (!drives) return []
    return drives.slice(0, 20).reverse().map(d => ({
      date: formatDateShort(d.start_date),
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
