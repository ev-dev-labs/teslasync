import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { motion } from 'framer-motion'
import {
  Gauge, Zap, BatteryCharging, Moon, TrendingDown,
  Activity, Clock, ChevronDown, ChevronRight, Sparkles,
} from 'lucide-react'
import {
  getPollingStatus,
  getPollingSavings,
  type PollEngineStatus,
  type CostSnapshot,
  type VehiclePollingStatus,
} from '@/api/polling'
import { activityColor } from '@/lib/colors'
import { cn } from '@/lib/cn'
import { GlassPanel } from '../ui/GlassPanel'
import { Button } from '../ui/Button'
import { AnimatedNumber } from './AnimatedNumber'

/** Shown in place of a value that is missing or non-finite. */
const PLACEHOLDER = '—'

export function activityIcon(activity: string) {
  switch (activity) {
    case 'active':
    case 'critical':
      return <Zap size={16} />
    case 'moderate':
      return <BatteryCharging size={16} />
    case 'low':
      return <Activity size={16} />
    case 'idle':
      return <Moon size={16} />
    case 'sleeping':
      return <Moon size={16} />
    default:
      return <Gauge size={16} />
  }
}

export function profileLabel(profile: string): string {
  switch (profile) {
    case 'driving':
      return 'Driving'
    case 'charging':
      return 'Charging'
    case 'idle':
      return 'Idle'
    case 'sleeping':
      return 'Sleeping'
    default:
      return profile
  }
}

export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms)) return PLACEHOLDER
  if (ms <= 0) return 'now'
  const seconds = Math.floor(ms / 1000)
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  return `${hours}h ${minutes % 60}m`
}

export function formatTimeUntil(dateStr: string): string {
  const target = new Date(dateStr).getTime()
  if (!Number.isFinite(target)) return PLACEHOLDER
  const diff = target - Date.now()
  if (diff <= 0) return 'now'
  return formatDuration(diff)
}

function VehicleActivity({ vin, status }: { vin: string; status: VehiclePollingStatus }) {
  const { t } = useTranslation()
  const [expanded, setExpanded] = useState(false)
  const color = activityColor(status.activity)
  const shortVin = vin.slice(-8)
  const decision = status.last_decision
  const reasons = decision?.reasons ?? []
  const prediction = decision?.prediction

  return (
    <div className="border border-[var(--border-subtle)] rounded-lg p-3 space-y-2">
      <Button
        variant="ghost"
        size="sm"
        onClick={() => setExpanded((prev) => !prev)}
        aria-expanded={expanded}
        aria-label={t('polling.toggleDetails', 'Toggle polling details for {{vin}}', { vin: shortVin })}
        className="!w-full !justify-between !rounded-lg !px-0 !py-0"
      >
        <div className="flex items-center gap-2">
          <motion.div
            className="inline-flex"
            animate={{ scale: status.activity === 'active' ? [1, 1.2, 1] : 1 }}
            transition={{ repeat: status.activity === 'active' ? Infinity : 0, duration: 1.5 }}
            style={{ color }}
            aria-hidden="true"
          >
            {activityIcon(status.activity)}
          </motion.div>
          <span className="text-sm font-mono text-[var(--text-primary)]">{shortVin}</span>
          <span className="text-xs px-2 py-0.5 rounded-full" style={{ backgroundColor: color + '20', color }}>
            {status.activity} · {t(`polling.profileValue.${status.profile}`, profileLabel(status.profile))}
          </span>
        </div>
        <div className="flex items-center gap-3 text-xs text-[var(--text-secondary)]">
          <span className="flex items-center gap-1">
            <Clock size={12} aria-hidden="true" />
            {t('polling.next', 'Next')}: {formatTimeUntil(status.next_poll_after)}
          </span>
          <ChevronDown
            size={14}
            aria-hidden="true"
            className={cn('transition-transform', expanded && 'rotate-180')}
          />
        </div>
      </Button>

      {expanded && decision && (
        <div className="ml-6 space-y-1 text-xs text-[var(--text-secondary)] border-t border-[var(--border-subtle)] pt-2">
          <div>{t('polling.interval', 'Interval')}: {formatDuration(decision.next_interval_ms ?? 0)}</div>
          <div>{t('polling.consecIdle', 'Consecutive idle')}: {status.consec_idle ?? 0}</div>
          <div>{t('polling.batteryLevel', 'Battery')}: {status.battery_level ?? 0}%</div>
          {reasons.map((reason, i) => (
            <div key={`${i}-${reason}`} className="flex items-center gap-1">
              <ChevronRight size={12} aria-hidden="true" className="text-[var(--text-muted)]" />
              {reason}
            </div>
          ))}
          {prediction && (
            <div className="mt-1 flex items-start gap-1 text-blue-400">
              <Sparkles size={12} aria-hidden="true" className="mt-0.5 shrink-0" />
              <span>
                {t('polling.prediction', 'Prediction')}: {prediction.next_state}{' '}
                {t('polling.inWord', 'in')} {formatDuration((prediction.estimated_in ?? 0) / 1e6)}{' '}
                ({Math.round((prediction.confidence ?? 0) * 100)}% {t('polling.confShort', 'conf')})
                <br />
                {t('polling.basedOn', 'Based on')}: {prediction.based_on}
              </span>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function SavingsCard({ savings }: { savings: CostSnapshot }) {
  const { t } = useTranslation()
  const breakdown = savings.savings_breakdown ?? {}

  const segments = [
    { key: 'fleet_telemetry', value: Number(breakdown.fleet_telemetry) || 0, barClass: 'bg-blue-500', label: t('polling.fleetTelemetry', 'Fleet Telemetry') },
    { key: 'idle_detection', value: Number(breakdown.idle_detection) || 0, barClass: 'bg-amber-500', label: t('polling.idleDetection', 'Idle Detection') },
    { key: 'prediction', value: Number(breakdown.prediction) || 0, barClass: 'bg-purple-500', label: t('polling.prediction', 'Prediction') },
    { key: 'sleep_detection', value: Number(breakdown.sleep_detection) || 0, barClass: 'bg-gray-500', label: t('polling.sleep', 'Sleep') },
  ]
  const total = segments.reduce((sum, s) => sum + s.value, 0)

  const stats = [
    { key: 'pollsSaved', valueClass: 'text-emerald-400', prefix: '', suffix: '%', value: savings.savings_percent ?? 0, decimals: 1, label: t('polling.pollsSaved', 'Polls Saved') },
    { key: 'savedAmount', valueClass: 'text-emerald-400', prefix: '$', suffix: '', value: savings.estimated_savings ?? 0, decimals: 2, label: t('polling.savedAmount', '$ Saved') },
    { key: 'pollsMade', valueClass: 'text-[var(--text-primary)]', prefix: '', suffix: '', value: savings.polls_made ?? 0, decimals: 0, label: t('polling.pollsMade', 'Polls Made') },
    { key: 'creditLeft', valueClass: 'text-[var(--text-primary)]', prefix: '$', suffix: '', value: savings.remaining_credit ?? 0, decimals: 2, label: t('polling.creditLeft', 'Credit Left') },
  ]

  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
      {stats.map((s) => (
        <div key={s.key} className="text-center">
          <div className={cn('text-2xl font-bold', s.valueClass)}>
            {s.prefix}
            <AnimatedNumber value={s.value} decimals={s.decimals} />
            {s.suffix}
          </div>
          <div className="text-xs text-[var(--text-secondary)]">{s.label}</div>
        </div>
      ))}

      {total > 0 && (
        <div className="col-span-full flex gap-1 h-2 rounded-full overflow-hidden bg-[var(--surface-2)]">
          {segments.map((s) =>
            s.value > 0 ? (
              <div
                key={s.key}
                className={cn(s.barClass, 'rounded-full')}
                style={{ width: `${(s.value / total) * 100}%` }}
                title={`${s.label}: ${s.value}`}
              />
            ) : null,
          )}
        </div>
      )}
      {total > 0 && (
        <div className="col-span-full flex gap-4 justify-center text-2xs text-[var(--text-muted)]">
          {segments.map((s) => (
            <span key={s.key} className="flex items-center gap-1">
              <span className={cn('w-2 h-2 rounded-full', s.barClass)} />
              {s.label}
            </span>
          ))}
        </div>
      )}
    </div>
  )
}

export default function PollingEnginePanel() {
  const { t } = useTranslation()

  const { data: status } = useQuery<PollEngineStatus>({
    queryKey: ['polling-status'],
    queryFn: getPollingStatus,
    refetchInterval: 15000,
  })

  const { data: savings } = useQuery<CostSnapshot>({
    queryKey: ['polling-savings'],
    queryFn: getPollingSavings,
    refetchInterval: 30000,
  })

  if (!status?.enabled) return null

  const vehicles = Object.entries(status.vehicles ?? {})

  return (
    <GlassPanel className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold flex items-center gap-2">
          <TrendingDown size={20} aria-hidden="true" className="text-emerald-400" />
          {t('polling.title', 'Adaptive Polling Engine')}
        </h3>
        <span className="text-xs px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-400">
          {t('polling.active', 'Active')}
        </span>
      </div>

      {savings && <SavingsCard savings={savings} />}

      {vehicles.length > 0 && (
        <div className="space-y-2">
          <h4 className="text-sm font-medium text-[var(--text-secondary)] flex items-center gap-1">
            <Gauge size={14} aria-hidden="true" /> {t('polling.vehicleActivity', 'Vehicle Activity')}
          </h4>
          {vehicles.map(([vin, vs]) => (
            <VehicleActivity key={vin} vin={vin} status={vs} />
          ))}
        </div>
      )}

      {vehicles.length === 0 && (
        <div className="text-center text-sm text-[var(--text-muted)] py-4">
          {t('polling.noVehicles', 'No vehicles tracked yet. Polling engine will activate on first poll.')}
        </div>
      )}
    </GlassPanel>
  )
}
