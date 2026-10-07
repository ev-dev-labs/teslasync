/* eslint-disable @typescript-eslint/ban-ts-comment */
// @ts-nocheck -- legacy API types; will be rewired in a later phase
import { useMemo } from 'react'
import {
  Lightbulb, TrendingUp, TrendingDown, ArrowRight, DollarSign,
  Battery, BatteryCharging, Zap, Shield, Car, Clock, Leaf,
} from 'lucide-react'
import { GlassPanel } from '@/components/ui'
import { FadeIn } from '@/components/motion'
import { fmtNumber } from '@/lib/numberFormat'
import { useFormatting } from '@/hooks/useFormatting'
import { trendColor } from '@/lib/colors'
import type {
  Drive, ChargingSession, EnergyStats, BatteryReport,
  MileageStats, VampireDrainStats,
} from '@/api/client'

// ─── Types ────────────────────────────────────────────────────

export interface InsightData {
  drives?: Drive[]
  chargingSessions?: ChargingSession[]
  energyStats?: EnergyStats
  batteryReport?: BatteryReport
  mileageStats?: MileageStats
  vampireDrainStats?: VampireDrainStats
}

type Severity = 'info' | 'success' | 'warning' | 'alert'
type Trend = 'up' | 'down' | 'neutral'

interface Insight {
  id: string
  icon: React.ElementType
  title: string
  description: string
  trend: Trend
  trendGood: boolean
  severity: Severity
}

// ─── Severity → border colour ─────────────────────────────────

const SEVERITY_BORDER: Record<Severity, string> = {
  info:    '#00f0ff',
  success: '#10b981',
  warning: '#f59e0b',
  alert:   '#ef4444',
}

const TREND_ICON: Record<Trend, { Icon: React.ElementType; color: string }> = {
  up:      { Icon: TrendingUp,   color: '#10b981' },
  down:    { Icon: TrendingDown,  color: '#ef4444' },
  neutral: { Icon: ArrowRight,    color: 'var(--text-secondary)' },
}

// ─── Analysis helpers ─────────────────────────────────────────

function analyzeChargingCost(sessions: ChargingSession[], formatCurrency: (amount: number, decimals?: number) => string): Insight | null {
  const withCost = sessions.filter(s => s.cost != null && s.charge_energy_added > 0)
  if (withCost.length < 2) return null

  const supercharger = withCost.filter(s => s.fast_charger_type)
  const home = withCost.filter(s => !s.fast_charger_type)

  const avgCost = (arr: ChargingSession[]) => {
    const totalCost = arr.reduce((a, s) => a + (s.cost ?? 0), 0)
    const totalEnergy = arr.reduce((a, s) => a + s.charge_energy_added, 0)
    return totalEnergy > 0 ? totalCost / totalEnergy : 0
  }

  const overall = avgCost(withCost)
  const homeCost = home.length > 0 ? avgCost(home) : null
  const scCost = supercharger.length > 0 ? avgCost(supercharger) : null

  let description = `Your average charging cost is ${formatCurrency(overall, 2)}/kWh.`
  let trend: Trend = 'neutral'
  let trendGood = true

  if (homeCost != null && scCost != null && scCost > 0) {
    const savings = ((scCost - homeCost) / scCost) * 100
    if (savings > 0) {
      description += ` Home charging saves you ${fmtNumber(savings, 0)}% compared to Supercharging.`
      trend = 'up'
    } else {
      description += ` Your home electricity rate is higher than Supercharger rates — consider off-peak charging.`
      trend = 'down'
      trendGood = false
    }
  }

  return {
    id: 'charging-cost',
    icon: DollarSign,
    title: 'Charging Cost',
    description,
    trend,
    trendGood,
    severity: 'info',
  }
}

function analyzeEfficiencyTrend(drives: Drive[]): Insight | null {
  const valid = drives
    .filter(d => d.distance_m > 0 && d.energy_used_wh != null)
  if (valid.length < 4) return null

  const half = Math.floor(valid.length / 2)
  const efficiency = (arr: Drive[]) => {
    const totalDist = arr.reduce((a, d) => a + d.distance_m, 0)
    const totalEnergy = arr.reduce((a, d) => a + (d.energy_used_wh ?? 0), 0)
    return totalDist > 0 ? (totalEnergy / totalDist) * 1000 : 0
  }

  const recent = efficiency(valid.slice(0, half))
  const older = efficiency(valid.slice(half))

  if (older === 0) return null
  const changePct = ((older - recent) / older) * 100

  const improved = changePct > 0
  const magnitude = fmtNumber(Math.abs(changePct), 1)

  return {
    id: 'efficiency-trend',
    icon: Zap,
    title: 'Efficiency Trend',
    description: improved
      ? `Your driving efficiency improved ${magnitude}% in recent drives compared to earlier drives. Keep up the smooth driving!`
      : `Your driving efficiency decreased ${magnitude}% in recent drives. Consider gentler acceleration and highway cruise control.`,
    trend: improved ? 'up' : 'down',
    trendGood: improved,
    severity: improved ? 'success' : 'warning',
  }
}

function analyzeBatteryHealth(report: BatteryReport): Insight | null {
  if (!report.health_score) return null

  const healthPct = report.current_capacity_pct
  const degradation = report.degradation_pct
  const trend = report.monthly_trend

  let agingQuality = 'as expected'
  let severity: Severity = 'success'
  if (degradation > 10) {
    agingQuality = 'worse than average'
    severity = 'warning'
  } else if (degradation < 5) {
    agingQuality = 'better than average'
  }

  let yearlyRate = degradation
  if (trend.length >= 2) {
    const first = trend[0]?.capacity_pct ?? 0
    const last = trend[trend.length - 1]?.capacity_pct ?? 0
    const months = trend.length
    yearlyRate = months > 0 ? ((first - last) / months) * 12 : degradation
  }

  return {
    id: 'battery-health',
    icon: Battery,
    title: 'Battery Health',
    description: `Battery health is at ${fmtNumber(healthPct, 1)}%. Degradation rate is ${fmtNumber(yearlyRate, 1)}% per year — your battery is aging ${agingQuality}.`,
    trend: degradation > 8 ? 'down' : 'up',
    trendGood: degradation <= 8,
    severity,
  }
}

function analyzeOptimalCharging(sessions: ChargingSession[]): Insight | null {
  const withEnd = sessions.filter(s => s.end_battery_level != null)
  if (withEnd.length < 3) return null

  const avgEndLevel = withEnd.reduce((a, s) => a + s.end_battery_level!, 0) / withEnd.length
  const above80 = withEnd.filter(s => s.end_battery_level! > 80).length
  const above80Pct = (above80 / withEnd.length) * 100

  let description = `You charge most often to ${fmtNumber(avgEndLevel, 0)}%.`
  let severity: Severity = 'info'
  let trendGood = true

  if (above80Pct > 50) {
    description += ` ${fmtNumber(above80Pct, 0)}% of your charges exceed 80%. For battery longevity, consider keeping charges between 20–80%.`
    severity = 'warning'
    trendGood = false
  } else {
    description += ` Great habit — most of your charges stay within the ideal 20–80% range for battery longevity.`
    severity = 'success'
  }

  return {
    id: 'optimal-charging',
    icon: BatteryCharging,
    title: 'Optimal Charging',
    description,
    trend: trendGood ? 'up' : 'down',
    trendGood,
    severity,
  }
}

function analyzeVampireDrain(stats: VampireDrainStats): Insight | null {
  const average = stats.avg_drain_pct_per_day
  if (stats.event_count < 1 || average == null || !Number.isFinite(average)) return null

  const elevated = average >= 3
  const p95 = stats.p95_drain_pct_per_day
  const description = p95 != null
    ? `Average parked drain is ${fmtNumber(average, 2)}% per day; P95 is ${fmtNumber(p95, 2)}% across ${stats.event_count} observed windows.`
    : `Average parked drain is ${fmtNumber(average, 2)}% per day across ${stats.event_count} observed windows.`

  return {
    id: 'vampire-drain',
    icon: Shield,
    title: 'Vampire Drain',
    description,
    trend: elevated ? 'down' : 'neutral',
    trendGood: !elevated,
    severity: elevated ? 'warning' : 'info',
  }
}

function analyzeDrivingPatterns(drives: Drive[]): Insight | null {
  if (drives.length < 3) return null

  const totalDist = drives.reduce((a, d) => a + d.distance_m, 0)
  const dates = drives.map(d => new Date(d.start_ts))

  const daySpan = dates.length > 1
    ? (dates[0].getTime() - dates[dates.length - 1].getTime()) / 86_400_000
    : 1
  const avgDaily = daySpan > 0 ? totalDist / Math.max(daySpan, 1) : totalDist

  const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
  const dayCounts = new Array(7).fill(0) as number[]
  const hourCounts = new Array(24).fill(0) as number[]

  dates.forEach(d => {
    dayCounts[d.getDay()]++
    hourCounts[d.getHours()]++
  })

  const busiestDay = dayNames[dayCounts.indexOf(Math.max(...dayCounts))]
  const peakHour = hourCounts.indexOf(Math.max(...hourCounts))
  const peakEnd = (peakHour + 1) % 24

  return {
    id: 'driving-patterns',
    icon: Car,
    title: 'Driving Patterns',
    description: `You drive an average of ${fmtNumber(avgDaily / 1000, 1)} km/day. Your most active day is ${busiestDay}. Peak driving time: ${peakHour}:00–${peakEnd}:00.`,
    trend: 'neutral',
    trendGood: true,
    severity: 'info',
  }
}

function analyzeCostSavings(energy: EnergyStats, formatCurrency: (amount: number, decimals?: number) => string): Insight | null {
  if (energy.total_energy_used_kwh <= 0) return null

  // Average gas car: 8.5 L/100km, avg gas price ~$1.50/L
  const gasEquivalent = (energy.total_distance_km / 100) * 8.5 * 1.50
  const evCost = energy.total_cost
  const savings = gasEquivalent - evCost

  if (savings <= 0) return null

  return {
    id: 'cost-savings',
    icon: Leaf,
    title: 'EV Cost Savings',
    description: `You've saved approximately ${formatCurrency(savings, 0)} vs. gasoline based on ${fmtNumber(energy.total_energy_used_kwh, 0)} kWh consumed over ${fmtNumber(energy.total_distance_km, 0)} km. That's also ${fmtNumber(energy.co2_saved_kg, 0)} kg of CO₂ saved!`,
    trend: 'up',
    trendGood: true,
    severity: 'success',
  }
}

function analyzeRangeOptimization(energy: EnergyStats, battery?: BatteryReport): Insight | null {
  if (energy.avg_efficiency_wh_km <= 0) return null

  const effWhKm = energy.avg_efficiency_wh_km
  const ratedRange = battery?.estimated_range_new_km ?? 500
  const currentRange = battery?.estimated_range_current_km ?? ratedRange

  // Nominal consumption ~150 Wh/km for base comparison
  const ratedEfficiency = 150
  const effectiveRange = (ratedEfficiency / effWhKm) * currentRange
  const rangePct = currentRange > 0 ? (effectiveRange / currentRange) * 100 : 100

  return {
    id: 'range-optimization',
    icon: Clock,
    title: 'Range Optimization',
    description: `At your average efficiency of ${fmtNumber(effWhKm, 0)} Wh/km, your effective range is ~${fmtNumber(effectiveRange, 0)} km (${fmtNumber(rangePct, 0)}% of rated range). ${
      rangePct < 85
        ? 'Consider preconditioning and reducing highway speed for better range.'
        : 'Your driving style is range-efficient — great work!'
    }`,
    trend: rangePct >= 90 ? 'up' : rangePct >= 80 ? 'neutral' : 'down',
    trendGood: rangePct >= 80,
    severity: rangePct >= 90 ? 'success' : rangePct >= 80 ? 'info' : 'warning',
  }
}

// ─── Main component ───────────────────────────────────────────

export function InsightsEngine({ data }: { data: InsightData }) {
  const { formatCurrency } = useFormatting()
  const insights = useMemo(() => {
    const results: Insight[] = []

    if (data.chargingSessions?.length) {
      const c = analyzeChargingCost(data.chargingSessions, formatCurrency)
      if (c) results.push(c)
    }
    if (data.drives?.length) {
      const e = analyzeEfficiencyTrend(data.drives)
      if (e) results.push(e)
    }
    if (data.batteryReport) {
      const b = analyzeBatteryHealth(data.batteryReport)
      if (b) results.push(b)
    }
    if (data.chargingSessions?.length) {
      const o = analyzeOptimalCharging(data.chargingSessions)
      if (o) results.push(o)
    }
    if (data.vampireDrainStats) {
      const v = analyzeVampireDrain(data.vampireDrainStats)
      if (v) results.push(v)
    }
    if (data.drives?.length) {
      const p = analyzeDrivingPatterns(data.drives)
      if (p) results.push(p)
    }
    if (data.energyStats) {
      const s = analyzeCostSavings(data.energyStats, formatCurrency)
      if (s) results.push(s)
    }
    if (data.energyStats) {
      const r = analyzeRangeOptimization(data.energyStats, data.batteryReport ?? undefined)
      if (r) results.push(r)
    }

    return results
  }, [data, formatCurrency])

  if (insights.length === 0) return null

  return (
    <FadeIn delay={0.15}>
      <div className="space-y-4">
        <h3
          className="section-title flex items-center gap-2 text-[var(--text-primary)]"
        >
          <Lightbulb className="h-4 w-4 text-neon-amber" />
          Smart Insights
        </h3>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {insights.map((insight) => {
            const borderColor = SEVERITY_BORDER[insight.severity]
            const { Icon: TrendIcon, color: trendClr } = insight.trendGood
              ? TREND_ICON[insight.trend]
              : {
                  Icon: TREND_ICON[insight.trend].Icon,
                  color: trendColor(insight.trend),
                }

            return (
              <GlassPanel
                key={insight.id}
                className="p-4 transition-all hover:scale-[1.01]"
                style={{ borderLeftWidth: 3, borderLeftColor: borderColor }}
              >
                <div className="flex items-start gap-3">
                  <div
                    className="rounded-lg p-2 shrink-0"
                    style={{ backgroundColor: `${borderColor}15` }}
                  >
                    <insight.icon className="h-5 w-5" style={{ color: borderColor }} />
                  </div>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span
                        className="text-sm font-semibold text-[var(--text-primary)]"
                      >
                        {insight.title}
                      </span>
                      <TrendIcon className="h-3.5 w-3.5" style={{ color: trendClr }} />
                    </div>
                    <p
                      className="text-xs leading-relaxed text-[var(--text-secondary)]"
                    >
                      {insight.description}
                    </p>
                  </div>
                </div>
              </GlassPanel>
            )
          })}
        </div>
      </div>
    </FadeIn>
  )
}

