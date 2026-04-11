import { useState, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { getVehicles, getDrives, type Drive } from '../api'
import { PageHeader, GlassPanel, FadeIn, Skeleton, DateRangeFilter, ChartContainer, Select } from '../components/ui'
import { Trophy, Zap, Gauge, ShieldCheck, Star, AlertTriangle, Lightbulb, Target, Award, Fuel, Wind, ChevronDown, ChevronUp, ArrowUpRight, ArrowDownRight } from 'lucide-react'
import { LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine, Cell } from 'recharts'
import clsx from 'clsx'
import { useSettings } from '../hooks/useSettings'
import { COLOR } from '../lib/colors'
import { formatDate, formatDateShort } from '../lib/dateFormat'
import { ChartTooltip } from '../components/Charts'
import { fmtNumber, fmtInt } from '../lib/numberFormat'
import { usePageTitle } from '../hooks/usePageTitle'

/* ─── Types ─────────────────────────────────────────────────────────── */

interface ScoreBreakdown {
  total: number
  efficiency: number
  smoothness: number
  speed: number
  grade: string
}

interface ScoredDrive extends ScoreBreakdown {
  drive: Drive
  whPerKm: number
}

/* ─── Grade colors ──────────────────────────────────────────────────── */

const GRADE_COLORS: Record<string, string> = {
  'A+': '#39ff14',
  'A': '#4ade80',
  'B': '#22d3ee',
  'C': '#fbbf24',
  'D': '#fb923c',
  'F': '#f87171',
}

function gradeColor(grade: string): string {
  return GRADE_COLORS[grade] ?? COLOR.MUTED
}

function scoreColor(score: number): string {
  if (score >= 80) return '#4ade80'
  if (score >= 60) return '#22d3ee'
  if (score >= 40) return '#fbbf24'
  return '#f87171'
}

/* ─── Scoring Algorithm ─────────────────────────────────────────────── */

function scoreDrive(drive: Drive): ScoredDrive {
  const battUsed = (drive.start_battery_level ?? 50) - (drive.end_battery_level ?? 45)
  const energyKwh = battUsed / 100 * 75
  const whPerKm = drive.distance > 0 ? (energyKwh * 1000) / drive.distance : 200

  // Efficiency (0-40): 130 Wh/km = perfect, 250+ = 0
  const effScore = Math.max(0, Math.min(40, 40 - (whPerKm - 130) / 3))

  // Smoothness (0-30): lower power range = smoother
  const powerRange = (drive.power_max ?? 50) - (drive.power_min ?? -20)
  const smoothScore = Math.max(0, Math.min(30, 30 - powerRange / 5))

  // Speed discipline (0-30): 90 km/h = optimal, 140+ = 0
  const maxSpeed = drive.speed_max ?? 80
  const speedScore = Math.max(0, Math.min(30, 30 - Math.max(0, maxSpeed - 90) / 2))

  const total = Math.round(effScore + smoothScore + speedScore)
  const grade = total >= 90 ? 'A+' : total >= 80 ? 'A' : total >= 70 ? 'B' : total >= 60 ? 'C' : total >= 50 ? 'D' : 'F'

  return {
    drive,
    total,
    efficiency: Math.round(effScore),
    smoothness: Math.round(smoothScore),
    speed: Math.round(speedScore),
    grade,
    whPerKm: Math.round(whPerKm),
  }
}

/* ─── Animated Circular Gauge ───────────────────────────────────────── */

function ScoreRing({
  score,
  max,
  size = 180,
  strokeWidth = 10,
  label,
  sublabel,
  grade,
  showGrade = false,
}: {
  score: number
  max: number
  size?: number
  strokeWidth?: number
  label?: string
  sublabel?: string
  grade?: string
  showGrade?: boolean
}) {
  const radius = (size - strokeWidth) / 2
  const circumference = 2 * Math.PI * radius
  const pct = Math.min(1, Math.max(0, score / max))
  const dashOffset = circumference * (1 - pct)
  const color = showGrade && grade ? gradeColor(grade) : scoreColor((score / max) * 100)

  return (
    <div className="flex flex-col items-center gap-2">
      <div className="relative" style={{ width: size, height: size }}>
        <svg
          className="absolute inset-0 -rotate-90"
          width={size}
          height={size}
          viewBox={`0 0 ${size} ${size}`}
        >
          {/* Background ring */}
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            stroke="var(--glass-border)"
            strokeWidth={strokeWidth}
          />
          {/* Animated score ring */}
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            stroke={color}
            strokeWidth={strokeWidth}
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={dashOffset}
            style={{
              transition: 'stroke-dashoffset 1.2s cubic-bezier(0.4, 0, 0.2, 1)',
              filter: `drop-shadow(0 0 8px ${color}80)`,
            }}
          />
        </svg>
        {/* Center content */}
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          {showGrade && grade && (
            <span
              className="text-lg font-bold opacity-60"
              style={{ color }}
            >
              {grade}
            </span>
          )}
          <span
            className="font-black tabular-nums"
            style={{ color, fontSize: size > 120 ? '2.5rem' : '1.5rem', lineHeight: 1 }}
          >
            {score}
          </span>
          <span
            className="text-[10px] mt-0.5 font-medium"
            style={{ color: 'var(--text-muted)' }}
          >
            / {max}
          </span>
        </div>
      </div>
      {label && (
        <span className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text-secondary)' }}>
          {label}
        </span>
      )}
      {sublabel && (
        <span className="text-[10px]" style={{ color: 'var(--text-muted)' }}>
          {sublabel}
        </span>
      )}
    </div>
  )
}

/* ─── Mini progress bar ─────────────────────────────────────────────── */

function MiniBar({ value, max, color }: { value: number; max: number; color: string }) {
  const pct = Math.min(100, Math.max(0, (value / max) * 100))
  return (
    <div className="h-1.5 w-full rounded-full bg-white/[0.06] overflow-hidden">
      <div
        className="h-full rounded-full transition-all duration-700"
        style={{ width: `${pct}%`, background: color }}
      />
    </div>
  )
}

/* ─── Chart Tooltip ─────────────────────────────────────────────────── */

/* ─── Grade Badge ───────────────────────────────────────────────────── */

function GradeBadge({ grade, size = 'md' }: { grade: string; size?: 'sm' | 'md' | 'lg' }) {
  const color = gradeColor(grade)
  const sizeClasses = {
    sm: 'text-[10px] px-1.5 py-0.5',
    md: 'text-xs px-2 py-0.5',
    lg: 'text-sm px-3 py-1',
  }
  return (
    <span
      className={clsx('rounded-full font-bold tabular-nums', sizeClasses[size])}
      style={{ color, background: `${color}18`, border: `1px solid ${color}40` }}
    >
      {grade}
    </span>
  )
}

/* ─── Improvement Tips Logic ────────────────────────────────────────── */

interface Tip { icon: typeof Zap; title: string; description: string; color: string }

function getImprovementTips(avgBreakdown: ScoreBreakdown): Tip[] {
  const tips: Tip[] = []
  const effPct = (avgBreakdown.efficiency / 40) * 100
  const smoothPct = (avgBreakdown.smoothness / 30) * 100
  const speedPct = (avgBreakdown.speed / 30) * 100

  if (effPct < 70) {
    tips.push({
      icon: Fuel,
      title: 'Improve Energy Efficiency',
      description: 'Reduce highway speed by 10 km/h to improve efficiency by ~15%. Pre-condition the cabin while plugged in.',
      color: '#4ade80',
    })
    tips.push({
      icon: Zap,
      title: 'Optimize Regenerative Braking',
      description: 'Maximize regen by anticipating stops. Coast to decelerate instead of braking hard at the last moment.',
      color: '#22d3ee',
    })
  }

  if (smoothPct < 70) {
    tips.push({
      icon: Wind,
      title: 'Smoother Acceleration',
      description: 'Use one-pedal driving to reduce braking events. Gradual acceleration uses 20-30% less energy than hard launches.',
      color: '#a855f7',
    })
    tips.push({
      icon: ShieldCheck,
      title: 'Reduce Power Spikes',
      description: 'Avoid sudden full-throttle bursts. Smooth, steady power delivery dramatically improves your smoothness score.',
      color: '#fbbf24',
    })
  }

  if (speedPct < 70) {
    tips.push({
      icon: Gauge,
      title: 'Optimal Cruising Speed',
      description: 'Optimal efficiency is at 90-100 km/h. Every 10 km/h above 100 reduces range by ~10%.',
      color: '#fb923c',
    })
    tips.push({
      icon: Target,
      title: 'Use Speed Limiter',
      description: 'Set cruise control to 100 km/h on highways. Consistent speed is more efficient than varying speed.',
      color: '#22d3ee',
    })
  }

  if (tips.length === 0) {
    tips.push({
      icon: Trophy,
      title: 'Excellent Driving!',
      description: 'You\'re already driving very efficiently. Keep up the great work and maintain these habits.',
      color: '#39ff14',
    })
    tips.push({
      icon: Star,
      title: 'Challenge Yourself',
      description: 'Try to maintain an A+ average for a full month. Small improvements compound over many drives.',
      color: '#fbbf24',
    })
  }

  return tips.slice(0, 4)
}

/* ─── Main Component ────────────────────────────────────────────────── */

export default function DriveScore() {
  usePageTitle('Drive Score')
  const { data: vehicles } = useQuery({ queryKey: ['vehicles'], queryFn: getVehicles })
  const [selectedVehicle, setSelectedVehicle] = useState<number | null>(null)
  const vehicleId = selectedVehicle ?? vehicles?.[0]?.id ?? null
  const { convertDistance, convertSpeed, convertEfficiency, distanceUnit, speedUnit, efficiencyUnit } = useSettings()

  // Date range state
  const [startDate, setStartDate] = useState(() => {
    const d = new Date(); d.setDate(d.getDate() - 30); return d.toISOString().split('T')[0]
  })
  const [endDate, setEndDate] = useState(() => new Date().toISOString().split('T')[0])

  // Sort state for scoreboard
  const [sortBy, setSortBy] = useState<'date' | 'score' | 'distance'>('date')
  const [expandedDrive, setExpandedDrive] = useState<number | null>(null)

  // Fetch drives
  const { data: drives, isLoading } = useQuery({
    queryKey: ['drives-score', vehicleId, startDate, endDate],
    queryFn: () => getDrives(vehicleId!, 500, 0, startDate, endDate),
    enabled: vehicleId !== null,
  })

  // Score all valid drives (filter out <1 km)
  const scoredDrives = useMemo<ScoredDrive[]>(() => {
    if (!drives) return []
    return drives
      .filter(d => d.distance >= 1)
      .map(d => scoreDrive(d))
  }, [drives])

  // Average scores
  const avgScore = useMemo<ScoreBreakdown>(() => {
    if (scoredDrives.length === 0) return { total: 0, efficiency: 0, smoothness: 0, speed: 0, grade: 'F' }
    const sum = scoredDrives.reduce(
      (acc, s) => ({
        total: acc.total + s.total,
        efficiency: acc.efficiency + s.efficiency,
        smoothness: acc.smoothness + s.smoothness,
        speed: acc.speed + s.speed,
        grade: '',
      }),
      { total: 0, efficiency: 0, smoothness: 0, speed: 0, grade: '' }
    )
    const n = scoredDrives.length
    const avgTotal = Math.round(sum.total / n)
    const grade = avgTotal >= 90 ? 'A+' : avgTotal >= 80 ? 'A' : avgTotal >= 70 ? 'B' : avgTotal >= 60 ? 'C' : avgTotal >= 50 ? 'D' : 'F'
    return {
      total: avgTotal,
      efficiency: Math.round(sum.efficiency / n),
      smoothness: Math.round(sum.smoothness / n),
      speed: Math.round(sum.speed / n),
      grade,
    }
  }, [scoredDrives])

  // Trend data (weekly averages)
  const trendData = useMemo(() => {
    if (scoredDrives.length === 0) return []
    const weekMap = new Map<string, { scores: number[]; week: string }>()
    for (const sd of scoredDrives) {
      const d = new Date(sd.drive.start_date)
      const weekStart = new Date(d)
      weekStart.setDate(d.getDate() - d.getDay())
      const key = weekStart.toISOString().split('T')[0]
      const label = formatDateShort(weekStart)
      if (!weekMap.has(key)) weekMap.set(key, { scores: [], week: label })
      weekMap.get(key)!.scores.push(sd.total)
    }
    return Array.from(weekMap.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([, v]) => ({
        week: v.week,
        avg: Math.round(v.scores.reduce((a, b) => a + b, 0) / v.scores.length),
        count: v.scores.length,
      }))
  }, [scoredDrives])

  // Distribution histogram data
  const histogramData = useMemo(() => {
    const bins = [
      { range: '0-20', min: 0, max: 20, count: 0, color: '#f87171' },
      { range: '20-40', min: 20, max: 40, count: 0, color: '#fb923c' },
      { range: '40-60', min: 40, max: 60, count: 0, color: '#fbbf24' },
      { range: '60-80', min: 60, max: 80, count: 0, color: '#22d3ee' },
      { range: '80-100', min: 80, max: 100, count: 0, color: '#4ade80' },
    ]
    for (const sd of scoredDrives) {
      const idx = Math.min(4, Math.floor(sd.total / 20))
      bins[idx].count++
    }
    return bins
  }, [scoredDrives])

  // Best & worst drives
  const bestDrive = useMemo(() => {
    if (scoredDrives.length === 0) return null
    return scoredDrives.reduce((best, s) => s.total > best.total ? s : best)
  }, [scoredDrives])

  const worstDrive = useMemo(() => {
    if (scoredDrives.length === 0) return null
    return scoredDrives.reduce((worst, s) => s.total < worst.total ? s : worst)
  }, [scoredDrives])

  // Sorted drives for scoreboard
  const sortedDrives = useMemo(() => {
    const arr = [...scoredDrives]
    switch (sortBy) {
      case 'score': return arr.sort((a, b) => b.total - a.total)
      case 'distance': return arr.sort((a, b) => b.drive.distance - a.drive.distance)
      default: return arr.sort((a, b) => new Date(b.drive.start_date).getTime() - new Date(a.drive.start_date).getTime())
    }
  }, [scoredDrives, sortBy])

  // Weekly/monthly stats
  const periodStats = useMemo(() => {
    if (scoredDrives.length === 0) return null
    const now = new Date()
    const oneWeekAgo = new Date(now); oneWeekAgo.setDate(now.getDate() - 7)
    const twoWeeksAgo = new Date(now); twoWeeksAgo.setDate(now.getDate() - 14)
    const oneMonthAgo = new Date(now); oneMonthAgo.setMonth(now.getMonth() - 1)
    const twoMonthsAgo = new Date(now); twoMonthsAgo.setMonth(now.getMonth() - 2)

    const inRange = (sd: ScoredDrive, start: Date, end: Date) => {
      const d = new Date(sd.drive.start_date)
      return d >= start && d <= end
    }
    const avg = (items: ScoredDrive[]) => items.length > 0 ? Math.round(items.reduce((s, i) => s + i.total, 0) / items.length) : null

    const thisWeek = scoredDrives.filter(sd => inRange(sd, oneWeekAgo, now))
    const lastWeek = scoredDrives.filter(sd => inRange(sd, twoWeeksAgo, oneWeekAgo))
    const thisMonth = scoredDrives.filter(sd => inRange(sd, oneMonthAgo, now))
    const lastMonth = scoredDrives.filter(sd => inRange(sd, twoMonthsAgo, oneMonthAgo))

    // Best week/month ever
    const weekMap = new Map<string, number[]>()
    const monthMap = new Map<string, number[]>()
    for (const sd of scoredDrives) {
      const d = new Date(sd.drive.start_date)
      const wk = new Date(d); wk.setDate(d.getDate() - d.getDay())
      const weekKey = wk.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: '2-digit' })
      const monthKey = d.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })
      if (!weekMap.has(weekKey)) weekMap.set(weekKey, [])
      weekMap.get(weekKey)!.push(sd.total)
      if (!monthMap.has(monthKey)) monthMap.set(monthKey, [])
      monthMap.get(monthKey)!.push(sd.total)
    }

    let bestWeek = { label: '--', avg: 0 }
    for (const [label, scores] of weekMap) {
      const a = Math.round(scores.reduce((s, v) => s + v, 0) / scores.length)
      if (a > bestWeek.avg) bestWeek = { label, avg: a }
    }

    let bestMonth = { label: '--', avg: 0 }
    for (const [label, scores] of monthMap) {
      const a = Math.round(scores.reduce((s, v) => s + v, 0) / scores.length)
      if (a > bestMonth.avg) bestMonth = { label, avg: a }
    }

    const aOrBetter = scoredDrives.filter(sd => sd.total >= 80).length

    return {
      thisWeekAvg: avg(thisWeek),
      lastWeekAvg: avg(lastWeek),
      thisMonthAvg: avg(thisMonth),
      lastMonthAvg: avg(lastMonth),
      bestWeek,
      bestMonth,
      totalDrives: scoredDrives.length,
      aOrBetter,
    }
  }, [scoredDrives])

  // Improvement tips
  const tips = useMemo(() => getImprovementTips(avgScore), [avgScore])

  const formatDuration = (min: number) => {
    const h = Math.floor(min / 60)
    const m = Math.round(min % 60)
    return h > 0 ? `${h}h ${m}m` : `${m}m`
  }

  return (
    <FadeIn>
      {/* ── Section 1: Header ─────────────────────────────────────────── */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 sm:gap-0 mb-6 sm:mb-8">
        <PageHeader
          title="Drive Score"
          subtitle="Driving efficiency ratings, performance trends, and improvement tips"
          icon={<Trophy className="h-7 w-7 text-neon-cyan" />}
        />
        {vehicles && vehicles.length > 1 && (
          <Select
            value={vehicleId ?? ''}
            onChange={e => setSelectedVehicle(Number(e.target.value))}
            options={vehicles.map(v => ({ value: String(v.id), label: v.display_name || v.vin }))}
          />
        )}
      </div>

      {/* ── Section 2: Date Range ─────────────────────────────────────── */}
      <div className="mb-6 sm:mb-8">
        <DateRangeFilter
          startDate={startDate}
          endDate={endDate}
          onStartDateChange={setStartDate}
          onEndDateChange={setEndDate}
          presets
        />
      </div>

      {isLoading ? (
        <div className="space-y-6">
          <Skeleton className="h-64 rounded-xl" />
          <div className="grid grid-cols-3 gap-4">
            {[1, 2, 3].map(i => <Skeleton key={i} className="h-48 rounded-xl" />)}
          </div>
          <Skeleton className="h-72 rounded-xl" />
        </div>
      ) : scoredDrives.length === 0 ? (
        <GlassPanel className="p-12 text-center">
          <Gauge className="h-12 w-12 mx-auto mb-4 text-[var(--text-muted)]" />
          <p className="text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>No Drives Found</p>
          <p className="text-sm mt-2" style={{ color: 'var(--text-secondary)' }}>
            No drives recorded in the selected period, or all drives are under 1 km.
          </p>
        </GlassPanel>
      ) : (
        <div className="space-y-6 sm:space-y-8">

          {/* ── Section 3: Overall Score (Hero) ──────────────────────── */}
          <GlassPanel className="p-6 sm:p-10">
            <div className="flex flex-col items-center">
              <ScoreRing
                  score={avgScore.total}
                  max={100}
                  size={200}
                  strokeWidth={12}
                  grade={avgScore.grade}
                  showGrade
                />
              <p className="mt-4 text-sm font-medium" style={{ color: 'var(--text-secondary)' }}>
                Your average drive score
              </p>
              <p className="mt-1 text-xs" style={{ color: 'var(--text-muted)' }}>
                Based on {scoredDrives.length} drive{scoredDrives.length !== 1 ? 's' : ''} in this period
              </p>
            </div>
          </GlassPanel>

          {/* ── Section 4: Score Breakdown (3 sub-gauges) ─────────────── */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <GlassPanel className="p-5 sm:p-6 flex flex-col items-center">
              <ScoreRing score={avgScore.efficiency} max={40} size={120} strokeWidth={8} label="Efficiency" sublabel="Energy consumption" />
              <div className="mt-3 flex items-center gap-1.5">
                <Fuel className="h-3.5 w-3.5" style={{ color: scoreColor((avgScore.efficiency / 40) * 100) }} />
                <span className="text-xs" style={{ color: 'var(--text-muted)' }}>{avgScore.efficiency}/40 pts</span>
              </div>
            </GlassPanel>

            <GlassPanel className="p-5 sm:p-6 flex flex-col items-center">
              <ScoreRing score={avgScore.smoothness} max={30} size={120} strokeWidth={8} label="Smoothness" sublabel="Acceleration & braking" />
              <div className="mt-3 flex items-center gap-1.5">
                <Wind className="h-3.5 w-3.5" style={{ color: scoreColor((avgScore.smoothness / 30) * 100) }} />
                <span className="text-xs" style={{ color: 'var(--text-muted)' }}>{avgScore.smoothness}/30 pts</span>
              </div>
            </GlassPanel>

            <GlassPanel className="p-5 sm:p-6 flex flex-col items-center">
              <ScoreRing score={avgScore.speed} max={30} size={120} strokeWidth={8} label="Speed" sublabel="Highway speed discipline" />
              <div className="mt-3 flex items-center gap-1.5">
                <Gauge className="h-3.5 w-3.5" style={{ color: scoreColor((avgScore.speed / 30) * 100) }} />
                <span className="text-xs" style={{ color: 'var(--text-muted)' }}>{avgScore.speed}/30 pts</span>
              </div>
            </GlassPanel>
          </div>

          {/* ── Section 5: Score Trend Chart ──────────────────────────── */}
          <ChartContainer title="Score Trend" height={280}>
            {trendData.length < 2 ? (
              <div className="flex items-center justify-center h-56 text-[var(--text-muted)] text-sm">
                Not enough data for trend — need at least 2 weeks
              </div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={trendData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--glass-border)" strokeOpacity={0.5} />
                  <XAxis dataKey="week" tick={{ fontSize: 10, fill: 'var(--text-muted)' }} />
                  <YAxis domain={[0, 100]} tick={{ fontSize: 10, fill: 'var(--text-muted)' }} />
                  <Tooltip content={<ChartTooltip />} />
                  <ReferenceLine y={80} stroke="#4ade80" strokeDasharray="4 4" strokeOpacity={0.5} label={{ value: 'A', position: 'right', fill: '#4ade80', fontSize: 10 }} />
                  <ReferenceLine y={60} stroke="#fbbf24" strokeDasharray="4 4" strokeOpacity={0.5} label={{ value: 'C', position: 'right', fill: '#fbbf24', fontSize: 10 }} />
                  <Line
                    type="monotone"
                    dataKey="avg"
                    name="Avg Score"
                    stroke="#00f0ff"
                    strokeWidth={2.5}
                    dot={{ fill: '#00f0ff', strokeWidth: 0, r: 4 }}
                    activeDot={{ fill: '#00f0ff', strokeWidth: 2, stroke: '#fff', r: 6 }}
                  />
                </LineChart>
              </ResponsiveContainer>
            )}
          </ChartContainer>

          {/* ── Section 6: Recent Drives Scoreboard ──────────────────── */}
          <GlassPanel className="p-4 sm:p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
                <Award className="inline h-4 w-4 mr-1.5 text-neon-cyan" />
                Recent Drives Scoreboard
              </h3>
              <div className="flex items-center gap-1">
                {(['date', 'score', 'distance'] as const).map(key => (
                  <button
                    key={key}
                    onClick={() => setSortBy(key)}
                    className={clsx(
                      'rounded-md px-2 py-1 text-xs font-medium transition-colors capitalize',
                      sortBy === key
                        ? 'bg-white/[0.1] text-[var(--text-primary)]'
                        : 'text-[var(--text-muted)] hover:text-[var(--text-secondary)] hover:bg-white/[0.04]'
                    )}
                  >
                    {key}
                  </button>
                ))}
              </div>
            </div>

            <div className="max-h-[480px] overflow-y-auto space-y-2 pr-1 custom-scrollbar">
              {sortedDrives.slice(0, 50).map(sd => {
                const isExpanded = expandedDrive === sd.drive.id
                const driveDate = formatDate(sd.drive.start_date)
                const dist = convertDistance(sd.drive.distance)
                const dur = formatDuration(sd.drive.duration_min)

                return (
                  <GlassPanel
                    key={sd.drive.id}
                    className="rounded-lg overflow-hidden transition-all duration-200 hover:ring-1 hover:ring-white/[0.08]"
                  >
                    <button
                      onClick={() => setExpandedDrive(isExpanded ? null : sd.drive.id)}
                      className="w-full flex items-center gap-3 p-3 sm:p-4 text-left"
                    >
                      <GradeBadge grade={sd.grade} />

                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate" style={{ color: 'var(--text-primary)' }}>
                          {driveDate}
                        </p>
                        <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                          {fmtNumber(dist)} {distanceUnit} · {dur}
                        </p>
                      </div>

                      {/* Mini score bars */}
                      <div className="hidden sm:flex items-center gap-3 w-48">
                        <div className="flex-1 space-y-1">
                          <MiniBar value={sd.efficiency} max={40} color="#4ade80" />
                          <MiniBar value={sd.smoothness} max={30} color="#a855f7" />
                          <MiniBar value={sd.speed} max={30} color="#22d3ee" />
                        </div>
                      </div>

                      <span
                        className="text-lg font-bold tabular-nums w-10 text-right"
                        style={{ color: scoreColor(sd.total) }}
                      >
                        {sd.total}
                      </span>

                      {isExpanded ? (
                        <ChevronUp className="h-4 w-4 text-[var(--text-muted)] shrink-0" />
                      ) : (
                        <ChevronDown className="h-4 w-4 text-[var(--text-muted)] shrink-0" />
                      )}
                    </button>

                    {isExpanded && (
                      <div className="px-4 pb-4 pt-1 border-t border-white/[0.04]">
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
                          <div>
                            <span style={{ color: 'var(--text-muted)' }}>Efficiency</span>
                            <p className="font-semibold mt-0.5" style={{ color: '#4ade80' }}>
                              {sd.efficiency}/40 · {fmtInt(convertEfficiency(sd.whPerKm))} {efficiencyUnit}
                            </p>
                          </div>
                          <div>
                            <span style={{ color: 'var(--text-muted)' }}>Smoothness</span>
                            <p className="font-semibold mt-0.5" style={{ color: '#a855f7' }}>
                              {sd.smoothness}/30
                            </p>
                          </div>
                          <div>
                            <span style={{ color: 'var(--text-muted)' }}>Speed</span>
                            <p className="font-semibold mt-0.5" style={{ color: '#22d3ee' }}>
                              {sd.speed}/30 · Max {fmtInt(convertSpeed(sd.drive.speed_max ?? 0))} {speedUnit}
                            </p>
                          </div>
                          <div>
                            <span style={{ color: 'var(--text-muted)' }}>Battery Used</span>
                            <p className="font-semibold mt-0.5" style={{ color: 'var(--text-primary)' }}>
                              {sd.drive.start_battery_level ?? '--'}% → {sd.drive.end_battery_level ?? '--'}%
                            </p>
                          </div>
                        </div>
                      </div>
                    )}
                  </GlassPanel>
                )
              })}
            </div>
          </GlassPanel>

          {/* ── Section 7: Best & Worst Drives ───────────────────────── */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {/* Best Drive */}
            <GlassPanel className="p-5 sm:p-6">
              <div className="flex items-center gap-2 mb-4">
                <Star className="h-5 w-5 text-neon-green" />
                <h3 className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>Best Drive</h3>
              </div>
              {bestDrive ? (
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs" style={{ color: 'var(--text-muted)' }}>{formatDate(bestDrive.drive.start_date)}</span>
                    <GradeBadge grade={bestDrive.grade} size="lg" />
                  </div>
                  <div className="flex items-center gap-4">
                    <ScoreRing score={bestDrive.total} max={100} size={72} strokeWidth={6} />
                    <div className="flex-1 space-y-2">
                      <div className="flex items-center justify-between text-xs">
                        <span style={{ color: 'var(--text-muted)' }}>Distance</span>
                        <span style={{ color: 'var(--text-primary)' }}>
                          {fmtNumber(convertDistance(bestDrive.drive.distance))} {distanceUnit}
                        </span>
                      </div>
                      <div className="flex items-center justify-between text-xs">
                        <span style={{ color: 'var(--text-muted)' }}>Duration</span>
                        <span style={{ color: 'var(--text-primary)' }}>{formatDuration(bestDrive.drive.duration_min)}</span>
                      </div>
                      <div className="flex items-center justify-between text-xs">
                        <span style={{ color: 'var(--text-muted)' }}>Consumption</span>
                        <span style={{ color: 'var(--text-primary)' }}>{fmtInt(convertEfficiency(bestDrive.whPerKm))} {efficiencyUnit}</span>
                      </div>
                    </div>
                  </div>
                  <div className="rounded-lg bg-neon-green/5 border border-neon-green/20 p-3">
                    <p className="text-xs" style={{ color: '#4ade80' }}>
                      <Star className="inline h-3 w-3 mr-1" />
                      {bestDrive.efficiency >= 35
                        ? 'Outstanding energy efficiency — minimal energy wasted!'
                        : bestDrive.smoothness >= 25
                        ? 'Exceptionally smooth driving with controlled acceleration.'
                        : 'Great speed discipline, staying in the optimal range.'}
                    </p>
                  </div>
                </div>
              ) : (
                <p className="text-sm" style={{ color: 'var(--text-muted)' }}>No drives available</p>
              )}
            </GlassPanel>

            {/* Worst Drive */}
            <GlassPanel className="p-5 sm:p-6">
              <div className="flex items-center gap-2 mb-4">
                <AlertTriangle className="h-5 w-5 text-neon-red" />
                <h3 className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>Worst Drive</h3>
              </div>
              {worstDrive ? (
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs" style={{ color: 'var(--text-muted)' }}>{formatDate(worstDrive.drive.start_date)}</span>
                    <GradeBadge grade={worstDrive.grade} size="lg" />
                  </div>
                  <div className="flex items-center gap-4">
                    <ScoreRing score={worstDrive.total} max={100} size={72} strokeWidth={6} />
                    <div className="flex-1 space-y-2">
                      <div className="flex items-center justify-between text-xs">
                        <span style={{ color: 'var(--text-muted)' }}>Distance</span>
                        <span style={{ color: 'var(--text-primary)' }}>
                          {fmtNumber(convertDistance(worstDrive.drive.distance))} {distanceUnit}
                        </span>
                      </div>
                      <div className="flex items-center justify-between text-xs">
                        <span style={{ color: 'var(--text-muted)' }}>Duration</span>
                        <span style={{ color: 'var(--text-primary)' }}>{formatDuration(worstDrive.drive.duration_min)}</span>
                      </div>
                      <div className="flex items-center justify-between text-xs">
                        <span style={{ color: 'var(--text-muted)' }}>Consumption</span>
                        <span style={{ color: 'var(--text-primary)' }}>{fmtInt(convertEfficiency(worstDrive.whPerKm))} {efficiencyUnit}</span>
                      </div>
                    </div>
                  </div>
                  <div className="rounded-lg bg-neon-red/5 border border-neon-red/20 p-3">
                    <p className="text-xs" style={{ color: '#f87171' }}>
                      <AlertTriangle className="inline h-3 w-3 mr-1" />
                      {worstDrive.efficiency < 15
                        ? 'High energy consumption — possibly high speeds or cold weather.'
                        : worstDrive.smoothness < 10
                        ? 'Aggressive acceleration and braking detected.'
                        : 'Excessive highway speed reduced the overall score.'}
                    </p>
                  </div>
                </div>
              ) : (
                <p className="text-sm" style={{ color: 'var(--text-muted)' }}>No drives available</p>
              )}
            </GlassPanel>
          </div>

          {/* ── Section 8: Score Distribution Histogram ───────────────── */}
          <ChartContainer title="Score Distribution" height={220}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={histogramData} barCategoryGap="20%">
                <CartesianGrid strokeDasharray="3 3" stroke="var(--glass-border)" strokeOpacity={0.5} vertical={false} />
                <XAxis dataKey="range" tick={{ fontSize: 11, fill: 'var(--text-muted)' }} />
                <YAxis allowDecimals={false} tick={{ fontSize: 10, fill: 'var(--text-muted)' }} />
                <Tooltip content={<ChartTooltip />} />
                <Bar dataKey="count" name="Drives" radius={[6, 6, 0, 0]}>
                  {histogramData.map((entry, idx) => (
                    <Cell key={idx} fill={entry.color} fillOpacity={0.8} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </ChartContainer>

          {/* ── Section 9: Improvement Tips ───────────────────────────── */}
          <GlassPanel className="p-5 sm:p-6">
            <div className="flex items-center gap-2 mb-5">
              <Lightbulb className="h-5 w-5 text-neon-amber" />
              <h3 className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>Improvement Tips</h3>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {tips.map((tip, i) => {
                const Icon = tip.icon
                return (
                  <GlassPanel
                    key={i}
                    className="p-4 flex items-start gap-3 transition-all duration-200 hover:ring-1 hover:ring-white/[0.06]"
                  >
                    <div
                      className="shrink-0 w-9 h-9 rounded-lg flex items-center justify-center"
                      style={{ background: `${tip.color}15` }}
                    >
                      <Icon className="h-4.5 w-4.5" style={{ color: tip.color }} />
                    </div>
                    <div>
                      <p className="text-sm font-semibold mb-1" style={{ color: 'var(--text-primary)' }}>
                        {tip.title}
                      </p>
                      <p className="text-xs leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
                        {tip.description}
                      </p>
                    </div>
                  </GlassPanel>
                )
              })}
            </div>
          </GlassPanel>

          {/* ── Section 10: Weekly/Monthly Averages ───────────────────── */}
          {periodStats && (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 sm:gap-4">
              {/* This week vs last week */}
              <GlassPanel className="p-4 sm:p-5 flex flex-col gap-2">
                <span className="text-[10px] font-medium uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>
                  This Week
                </span>
                <div className="flex items-end gap-2">
                  <span className="text-2xl font-bold tabular-nums" style={{ color: periodStats.thisWeekAvg !== null ? scoreColor(periodStats.thisWeekAvg) : 'var(--text-muted)' }}>
                    {periodStats.thisWeekAvg ?? '--'}
                  </span>
                  {periodStats.thisWeekAvg !== null && periodStats.lastWeekAvg !== null && (
                    <span className={clsx('text-xs flex items-center', periodStats.thisWeekAvg >= periodStats.lastWeekAvg ? 'text-neon-green' : 'text-neon-red')}>
                      {periodStats.thisWeekAvg >= periodStats.lastWeekAvg
                        ? <ArrowUpRight className="h-3 w-3" />
                        : <ArrowDownRight className="h-3 w-3" />}
                      {Math.abs(periodStats.thisWeekAvg - periodStats.lastWeekAvg)}
                    </span>
                  )}
                </div>
                <span className="text-[10px]" style={{ color: 'var(--text-muted)' }}>
                  vs {periodStats.lastWeekAvg ?? '--'} last week
                </span>
              </GlassPanel>

              {/* This month vs last month */}
              <GlassPanel className="p-4 sm:p-5 flex flex-col gap-2">
                <span className="text-[10px] font-medium uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>
                  This Month
                </span>
                <div className="flex items-end gap-2">
                  <span className="text-2xl font-bold tabular-nums" style={{ color: periodStats.thisMonthAvg !== null ? scoreColor(periodStats.thisMonthAvg) : 'var(--text-muted)' }}>
                    {periodStats.thisMonthAvg ?? '--'}
                  </span>
                  {periodStats.thisMonthAvg !== null && periodStats.lastMonthAvg !== null && (
                    <span className={clsx('text-xs flex items-center', periodStats.thisMonthAvg >= periodStats.lastMonthAvg ? 'text-neon-green' : 'text-neon-red')}>
                      {periodStats.thisMonthAvg >= periodStats.lastMonthAvg
                        ? <ArrowUpRight className="h-3 w-3" />
                        : <ArrowDownRight className="h-3 w-3" />}
                      {Math.abs(periodStats.thisMonthAvg - periodStats.lastMonthAvg)}
                    </span>
                  )}
                </div>
                <span className="text-[10px]" style={{ color: 'var(--text-muted)' }}>
                  vs {periodStats.lastMonthAvg ?? '--'} last month
                </span>
              </GlassPanel>

              {/* Best week ever */}
              <GlassPanel className="p-4 sm:p-5 flex flex-col gap-2">
                <span className="text-[10px] font-medium uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>
                  Best Week
                </span>
                <span className="text-2xl font-bold tabular-nums" style={{ color: scoreColor(periodStats.bestWeek.avg) }}>
                  {periodStats.bestWeek.avg || '--'}
                </span>
                <span className="text-[10px]" style={{ color: 'var(--text-muted)' }}>
                  {periodStats.bestWeek.label}
                </span>
              </GlassPanel>

              {/* Best month ever */}
              <GlassPanel className="p-4 sm:p-5 flex flex-col gap-2">
                <span className="text-[10px] font-medium uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>
                  Best Month
                </span>
                <span className="text-2xl font-bold tabular-nums" style={{ color: scoreColor(periodStats.bestMonth.avg) }}>
                  {periodStats.bestMonth.avg || '--'}
                </span>
                <span className="text-[10px]" style={{ color: 'var(--text-muted)' }}>
                  {periodStats.bestMonth.label}
                </span>
              </GlassPanel>

              {/* Total drives */}
              <GlassPanel className="p-4 sm:p-5 flex flex-col gap-2">
                <span className="text-[10px] font-medium uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>
                  Total Drives
                </span>
                <span className="text-2xl font-bold tabular-nums" style={{ color: 'var(--text-primary)' }}>
                  {periodStats.totalDrives}
                </span>
                <span className="text-[10px]" style={{ color: 'var(--text-muted)' }}>
                  drives scored
                </span>
              </GlassPanel>

              {/* A or better */}
              <GlassPanel className="p-4 sm:p-5 flex flex-col gap-2">
                <span className="text-[10px] font-medium uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>
                  Rated A+/A
                </span>
                <span className="text-2xl font-bold tabular-nums text-neon-green">
                  {periodStats.aOrBetter}
                </span>
                <span className="text-[10px]" style={{ color: 'var(--text-muted)' }}>
                  {periodStats.totalDrives > 0 ? `${Math.round((periodStats.aOrBetter / periodStats.totalDrives) * 100)}% of drives` : 'no drives'}
                </span>
              </GlassPanel>
            </div>
          )}
        </div>
      )}
    </FadeIn>
  )
}
