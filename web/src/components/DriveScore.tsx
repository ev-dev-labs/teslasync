import { useMemo } from 'react'
import { motion } from 'framer-motion'
import { GlassPanel } from './ui'

function clamp(v: number, min: number, max: number) {
  return Math.max(min, Math.min(max, v))
}

function computeDriveScore(drive: any): { total: number; efficiency: number; speed: number; range: number; trip: number } {
  const distance = drive.distance ?? 0
  const durationMin = drive.duration_min ?? 0
  const avgSpeed = durationMin > 0 ? (distance / (durationMin / 60)) : 0
  const maxSpeed = drive.speed_max ?? avgSpeed
  const startBattery = drive.start_battery_level ?? 100
  const endBattery = drive.end_battery_level ?? startBattery

  // Efficiency component (40 pts): closer to optimal 150 Wh/km is better
  const batteryUsed = Math.max(startBattery - endBattery, 0)
  // Estimate Wh/km: assume ~75 kWh usable battery, each % = 750 Wh
  const whPerKm = distance > 0 ? (batteryUsed * 750) / distance : 250
  const optimalWhKm = 150
  const effDeviation = Math.abs(whPerKm - optimalWhKm) / optimalWhKm
  const efficiency = clamp(40 * (1 - effDeviation), 0, 40)

  // Speed discipline (20 pts): avg/max ratio — smooth driving scores higher
  const speedRatio = maxSpeed > 0 ? avgSpeed / maxSpeed : 0.5
  const speed = clamp(20 * speedRatio, 0, 20)

  // Range preservation (20 pts): less battery used per km
  const batteryPerKm = distance > 0 ? batteryUsed / distance : 1
  // Best case: 0.1%/km, worst case: 1%/km
  const rangeScore = clamp(20 * (1 - (batteryPerKm - 0.1) / 0.9), 0, 20)

  // Trip length (20 pts): longer trips score higher (plateau at 50km)
  const tripScore = clamp(20 * Math.min(distance / 50, 1), 0, 20)

  const total = Math.round(clamp(efficiency + speed + rangeScore + tripScore, 0, 100))

  return { total, efficiency: Math.round(efficiency), speed: Math.round(speed), range: Math.round(rangeScore), trip: Math.round(tripScore) }
}

function getScoreColor(score: number): string {
  if (score < 40) return '#ef4444'
  if (score < 70) return '#f59e0b'
  return '#10b981'
}

export function DriveScore({ drive }: { drive: any }) {
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
              fill="none" stroke="rgba(255,255,255,0.05)" strokeWidth="10"
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
            <span className="text-[10px] text-[var(--text-muted)] uppercase tracking-wider">Score</span>
          </div>
        </div>

        {/* Breakdown */}
        <div className="flex-1 space-y-2">
          <h3 className="text-sm font-semibold text-[var(--text-primary)] mb-3">Drive Score</h3>
          {[
            { label: 'Efficiency', value: score.efficiency, max: 40, color: '#00f0ff' },
            { label: 'Speed Discipline', value: score.speed, max: 20, color: '#a855f7' },
            { label: 'Range Preservation', value: score.range, max: 20, color: '#10b981' },
            { label: 'Trip Length', value: score.trip, max: 20, color: '#f59e0b' },
          ].map(item => (
            <div key={item.label}>
              <div className="flex justify-between text-[11px] mb-0.5">
                <span className="text-[var(--text-secondary)]">{item.label}</span>
                <span style={{ color: item.color }} className="font-medium">{item.value}/{item.max}</span>
              </div>
              <div className="h-1.5 rounded-full bg-white/5 overflow-hidden">
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
