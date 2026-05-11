import { useMemo } from 'react'
import { motion } from 'framer-motion'
import { useTranslation } from 'react-i18next'
import { GlassPanel } from '@/components/ui'
import { COLOR } from '@/lib/colors'

function clamp(v: number, min: number, max: number) {
  return Math.max(min, Math.min(max, v))
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

export function computeDriveScore(drive: DriveLike): { total: number; efficiency: number; speed: number; range: number; trip: number } {
  // Phase-48 Slice 1: Drive fields are SI canonical (meters, seconds, m/s).
  const distanceM = drive.distance_m ?? drive.distanceM ?? 0
  const distanceKm = distanceM / 1000
  const durationS = drive.duration_s ?? drive.durationS ?? 0
  const durationHours = durationS / 3600
  const avgSpeedMps = durationS > 0 ? distanceM / durationS : 0
  const maxSpeedMps = drive.max_speed_mps ?? drive.maxSpeedMps ?? avgSpeedMps
  const startBattery = drive.start_battery_pct ?? drive.startBatteryPct ?? 100
  const endBattery = drive.end_battery_pct ?? drive.endBatteryPct ?? startBattery

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
  if (score < 40) return COLOR.BAD
  if (score < 70) return COLOR.WARN
  return COLOR.GOOD
}

export function DriveScore({ drive }: { drive: DriveLike }) {
  const { t } = useTranslation()
  const score = useMemo(() => computeDriveScore(drive), [drive])
  const color = getScoreColor(score.total)

  const radius = 52
  const circumference = 2 * Math.PI * radius
  const dashOffset = circumference - (score.total / 100) * circumference

  return (
    <GlassPanel className="p-5">
      <div className="flex items-center gap-6">
        {/* Animated circular gauge */}
        <div className="relative flex-shrink-0">
          <svg width="130" height="130" viewBox="0 0 130 130">
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
              initial={{ strokeDashoffset: circumference }}
              animate={{ strokeDashoffset: dashOffset }}
              transition={{ duration: 1.2, ease: [0.16, 1, 0.3, 1] }}
              transform="rotate(-90 65 65)"
              style={{ filter: `drop-shadow(0 0 6px ${color}60)` }}
            />
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <motion.span
              className="text-3xl font-bold"
              style={{ color }}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.5 }}
            >
              {score.total}
            </motion.span>
            <span className="text-[10px] text-[var(--text-muted)] uppercase tracking-wider">{t('driveScore.score', 'Score')}</span>
          </div>
        </div>

        {/* Breakdown */}
        <div className="flex-1 space-y-2">
          <h3 className="text-sm font-semibold text-[var(--text-primary)] mb-3">{t('driveScore.title', 'Drive Score')}</h3>
          {[
            { label: t('driveScore.efficiency', 'Efficiency'), value: score.efficiency, max: 40, color: '#00f0ff' },
            { label: t('driveScore.speedDiscipline', 'Speed Discipline'), value: score.speed, max: 20, color: '#a855f7' },
            { label: t('driveScore.rangePreservation', 'Range Preservation'), value: score.range, max: 20, color: '#10b981' },
            { label: t('driveScore.tripLength', 'Trip Length'), value: score.trip, max: 20, color: '#f59e0b' },
          ].map(item => (
            <div key={item.label}>
              <div className="flex justify-between text-[11px] mb-0.5">
                <span className="text-[var(--text-secondary)]">{item.label}</span>
                <span style={{ color: item.color }} className="font-medium">{item.value}/{item.max}</span>
              </div>
              <div className="h-1.5 rounded-full bg-[var(--surface-2)] overflow-hidden">
                <motion.div
                  className="h-full rounded-full"
                  initial={{ width: 0 }}
                  animate={{ width: `${(item.value / item.max) * 100}%` }}
                  transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1], delay: 0.3 }}
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

