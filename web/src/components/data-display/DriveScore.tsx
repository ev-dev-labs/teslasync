import { useMemo } from 'react'
import { motion } from '@/components/motion'
import { useTranslation } from 'react-i18next'
import { GlassPanel } from '@/components/ui'
import { useMotionPreference } from '@/hooks/useMotionPreference'
import { COLOR } from '@/lib/colors'

function clamp(v: number, min: number, max: number) {
  return Math.max(min, Math.min(max, v))
}

/**
 * Coerce a possibly-null / NaN / Infinity value to a finite number.
 *
 * Drive fields arrive from a live telemetry flush and can be `null` (column
 * never written) or — after a partial/streamed flush — a non-finite `number`.
 * `??` alone only guards null/undefined, so a `NaN` distance used to propagate
 * straight through every arithmetic step and surface as a literal "NaN" in the
 * gauge (and an invalid `stroke-dashoffset` that collapses the SVG arc).
 */
function num(v: unknown, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback
}

type DriveLike = {
  distance_m?: number | null
  distanceM?: number | null
  duration_s?: number | null
  durationS?: number | null
  max_speed_mps?: number | null
  maxSpeedMps?: number | null
  start_battery_pct?: number | null
  startBatteryPct?: number | null
  end_battery_pct?: number | null
  endBatteryPct?: number | null
  [key: string]: unknown
}

export function computeDriveScore(drive: DriveLike | null | undefined): { total: number; efficiency: number; speed: number; range: number; trip: number } {
  // Drive fields are SI canonical: meters, seconds, and m/s. Every input is
  // funnelled through num() so a null or non-finite value can never poison the
  // score — see the num() docblock above.
  const d: DriveLike = drive ?? {}
  const distanceM = num(d.distance_m ?? d.distanceM, 0)
  const distanceKm = distanceM / 1000
  const durationS = num(d.duration_s ?? d.durationS, 0)
  const durationHours = durationS / 3600
  const avgSpeedMps = durationS > 0 ? distanceM / durationS : 0
  const maxSpeedMps = num(d.max_speed_mps ?? d.maxSpeedMps, avgSpeedMps)
  const startBattery = num(d.start_battery_pct ?? d.startBatteryPct, 100)
  const endBattery = num(d.end_battery_pct ?? d.endBatteryPct, startBattery)

  // Efficiency component (40 pts): closer to optimal 150 Wh/km is better
  const batteryUsed = Math.max(startBattery - endBattery, 0)
  // Estimate Wh/km: assume ~75 kWh usable battery, each % = 750 Wh
  const whPerKm = distanceKm > 0 ? (batteryUsed * 750) / distanceKm : 250
  const optimalWhKm = 150
  const effDeviation = Math.abs(whPerKm - optimalWhKm) / optimalWhKm
  const efficiency = clamp(40 * (1 - effDeviation), 0, 40)

  // Speed discipline (20 pts): avg/max ratio — smooth driving scores higher
  const speedRatio = maxSpeedMps > 0 ? avgSpeedMps / maxSpeedMps : 0.5
  const speed = clamp(20 * speedRatio, 0, 20)

  // Range preservation (20 pts): less battery used per km
  const batteryPerKm = distanceKm > 0 ? batteryUsed / distanceKm : 1
  // Best case: 0.1%/km, worst case: 1%/km
  const rangeScore = clamp(20 * (1 - (batteryPerKm - 0.1) / 0.9), 0, 20)

  // Trip length (20 pts): longer trips score higher (plateau at 50km)
  const tripScore = clamp(20 * Math.min(distanceKm / 50, 1), 0, 20)

  // Reference durationHours so it's part of the contract; reserved for
  // future heuristics (e.g. dwell penalty for slow city driving).
  void durationHours

  const total = Math.round(clamp(efficiency + speed + rangeScore + tripScore, 0, 100))

  return { total, efficiency: Math.round(efficiency), speed: Math.round(speed), range: Math.round(rangeScore), trip: Math.round(tripScore) }
}

export function getScoreColor(score: number): string {
  // A non-finite score (NaN/Infinity from malformed data) is unverifiable, so
  // fail closed to the "bad" tier. Left to JS defaults, `NaN < 40` is false and
  // the score would misleadingly render as reassuring green.
  if (!Number.isFinite(score)) return COLOR.BAD
  if (score < 40) return COLOR.BAD
  if (score < 70) return COLOR.WARN
  return COLOR.GOOD
}

export function DriveScore({ drive }: { drive: DriveLike }) {
  const { t } = useTranslation()
  const { reduce } = useMotionPreference()
  const score = useMemo(() => computeDriveScore(drive), [drive])
  const color = getScoreColor(score.total)

  const radius = 52
  const circumference = 2 * Math.PI * radius
  const dashOffset = circumference - (score.total / 100) * circumference

  const breakdown = useMemo(
    () => [
      { key: 'efficiency', label: t('driveScore.efficiency', 'Efficiency'), value: score.efficiency, max: 40, color: '#00f0ff' },
      { key: 'speed', label: t('driveScore.speedDiscipline', 'Speed Discipline'), value: score.speed, max: 20, color: '#a855f7' },
      { key: 'range', label: t('driveScore.rangePreservation', 'Range Preservation'), value: score.range, max: 20, color: '#10b981' },
      { key: 'trip', label: t('driveScore.tripLength', 'Trip Length'), value: score.trip, max: 20, color: '#f59e0b' },
    ],
    [t, score.efficiency, score.speed, score.range, score.trip],
  )

  const gaugeLabel = t('driveScore.gaugeLabel', 'Drive score: {{score}} out of 100', { score: score.total })

  return (
    <GlassPanel className="p-5">
      <div className="flex items-center gap-6">
        {/* Animated circular gauge */}
        <div className="relative flex-shrink-0" role="img" aria-label={gaugeLabel}>
          <svg width="130" height="130" viewBox="0 0 130 130" aria-hidden="true">
            {/* Background circle */}
            <circle
              cx="65" cy="65" r={radius}
              fill="none" stroke="var(--glass-border)" strokeWidth="10"
            />
            {/* Animated score arc */}
            <motion.circle
              cx="65" cy="65" r={radius}
              fill="none" stroke={color} strokeWidth="10"
              strokeLinecap="round"
              strokeDasharray={circumference}
              initial={reduce ? false : { strokeDashoffset: circumference }}
              animate={{ strokeDashoffset: dashOffset }}
              transition={{ duration: reduce ? 0 : 1.2, ease: [0.16, 1, 0.3, 1] }}
              transform="rotate(-90 65 65)"
              style={{ filter: `drop-shadow(0 0 6px ${color}60)` }}
            />
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <motion.span
              className="text-3xl font-bold"
              style={{ color }}
              initial={reduce ? false : { opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: reduce ? 0 : 0.5 }}
            >
              {score.total}
            </motion.span>
            <span className="text-2xs text-[var(--text-muted)] uppercase tracking-wider">{t('driveScore.score', 'Score')}</span>
          </div>
        </div>

        {/* Breakdown */}
        <div className="flex-1 space-y-2">
          <h3 className="text-sm font-semibold text-[var(--text-primary)] mb-3">{t('driveScore.title', 'Drive Score')}</h3>
          {breakdown.map(item => (
            <div key={item.key}>
              <div className="flex justify-between text-xs mb-0.5">
                <span className="text-[var(--text-secondary)]">{item.label}</span>
                <span style={{ color: item.color }} className="font-medium">{item.value}/{item.max}</span>
              </div>
              <div
                className="h-1.5 rounded-full bg-[var(--surface-2)] overflow-hidden"
                role="progressbar"
                aria-label={item.label}
                aria-valuenow={item.value}
                aria-valuemin={0}
                aria-valuemax={item.max}
              >
                <motion.div
                  className="h-full rounded-full"
                  initial={reduce ? false : { width: 0 }}
                  animate={{ width: `${(item.value / item.max) * 100}%` }}
                  transition={{ duration: reduce ? 0 : 0.8, ease: [0.16, 1, 0.3, 1], delay: reduce ? 0 : 0.3 }}
                  style={{ background: item.color, boxShadow: `0 0 4px ${item.color}40` }}
                />
              </div>
            </div>
          ))}
        </div>
      </div>
    </GlassPanel>
  )
}

