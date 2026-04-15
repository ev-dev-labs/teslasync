import { useQuery } from '@tanstack/react-query'
import { getPollingStatus, getPollingSavings, type PollEngineStatus, type CostSnapshot, type VehiclePollingStatus } from '../../api/polling'
import {
  Gauge, Zap, BatteryCharging, Moon, TrendingDown,
  Activity, Clock, ChevronDown,
} from 'lucide-react'
import { GlassPanel } from '../ui/GlassPanel'
import { Button } from '../ui/Button'
import { AnimatedNumber } from './AnimatedNumber'
import { motion } from 'framer-motion'
import clsx from 'clsx'
import { useState } from 'react'

function activityColor(activity: string): string {
  switch (activity) {
    case 'active': case 'critical': return '#10b981'
    case 'moderate': return '#3b82f6'
    case 'low': return '#f59e0b'
    case 'idle': return '#6b7280'
    case 'sleeping': return '#4b5563'
    default: return '#6b7280'
  }
}

function activityIcon(activity: string) {
  switch (activity) {
    case 'active': case 'critical': return <Zap size={16} />
    case 'moderate': return <BatteryCharging size={16} />
    case 'low': return <Activity size={16} />
    case 'idle': return <Moon size={16} />
    case 'sleeping': return <Moon size={16} />
    default: return <Gauge size={16} />
  }
}

function profileLabel(profile: string): string {
  switch (profile) {
    case 'driving': return 'Driving'
    case 'charging': return 'Charging'
    case 'idle': return 'Idle'
    case 'sleeping': return 'Sleeping'
    default: return profile
  }
}

function formatDuration(ms: number): string {
  if (ms <= 0) return 'now'
  const seconds = Math.floor(ms / 1000)
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  return `${hours}h ${minutes % 60}m`
}

function formatTimeUntil(dateStr: string): string {
  const target = new Date(dateStr).getTime()
  const now = Date.now()
  const diff = target - now
  if (diff <= 0) return 'now'
  return formatDuration(diff)
}

function VehicleActivity({ vin, status }: { vin: string; status: VehiclePollingStatus }) {
  const [expanded, setExpanded] = useState(false)
  const color = activityColor(status.activity)

  return (
    <div className="border border-white/5 rounded-lg p-3 space-y-2">
      <Button variant="ghost" size="sm" onClick={() => setExpanded(!expanded)} className="!w-full !justify-between !rounded-lg !px-0 !py-0">
        <div className="flex items-center gap-2">
          <motion.div
            animate={{ scale: status.activity === 'active' ? [1, 1.2, 1] : 1 }}
            transition={{ repeat: status.activity === 'active' ? Infinity : 0, duration: 1.5 }}
            style={{ color }}
          >
            {activityIcon(status.activity)}
          </motion.div>
          <span className="text-sm font-mono text-white/80">{vin.slice(-8)}</span>
          <span className="text-xs px-2 py-0.5 rounded-full" style={{ backgroundColor: color + '20', color }}>
            {status.activity} ┬╖ {profileLabel(status.profile)}
          </span>
        </div>
        <div className="flex items-center gap-3 text-xs text-white/50">
          <span className="flex items-center gap-1">
            <Clock size={12} />
            Next: {formatTimeUntil(status.next_poll_after)}
          </span>
          <ChevronDown size={14} className={clsx('transition-transform', expanded && 'rotate-180')} />
        </div>
      </Button>

      {expanded && status.last_decision && (
        <div className="ml-6 space-y-1 text-xs text-white/60 border-t border-white/5 pt-2">
          <div>Interval: {formatDuration(status.last_decision.next_interval_ms)}</div>
          <div>Consecutive idle: {status.consec_idle}</div>
          <div>Battery: {status.battery_level}%</div>
          {status.last_decision.reasons.map((r, i) => (
            <div key={i} className="flex items-center gap-1">
              <span className="text-white/30">ΓåÆ</span> {r}
            </div>
          ))}
          {status.last_decision.prediction && (
            <div className="mt-1 text-blue-400">
              ≡ƒôè Prediction: {status.last_decision.prediction.next_state} in{' '}
              {formatDuration(status.last_decision.prediction.estimated_in / 1e6)}{' '}
              ({Math.round(status.last_decision.prediction.confidence * 100)}% conf)
              <br />
              Based on: {status.last_decision.prediction.based_on}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function SavingsCard({ savings }: { savings: CostSnapshot }) {
  const breakdown = savings.savings_breakdown || {}
  const total = Object.values(breakdown).reduce((a, b) => a + b, 0)

  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
      <div className="text-center">
        <div className="text-2xl font-bold text-emerald-400">
          <AnimatedNumber value={savings.savings_percent} decimals={1} />%
        </div>
        <div className="text-xs text-white/50">Polls Saved</div>
      </div>
      <div className="text-center">
        <div className="text-2xl font-bold text-emerald-400">
          $<AnimatedNumber value={savings.estimated_savings} decimals={2} />
        </div>
        <div className="text-xs text-white/50">$ Saved</div>
      </div>
      <div className="text-center">
        <div className="text-2xl font-bold text-white/80">
          <AnimatedNumber value={savings.polls_made} decimals={0} />
        </div>
        <div className="text-xs text-white/50">Polls Made</div>
      </div>
      <div className="text-center">
        <div className="text-2xl font-bold text-white/80">
          $<AnimatedNumber value={savings.remaining_credit} decimals={2} />
        </div>
        <div className="text-xs text-white/50">Credit Left</div>
      </div>

      {total > 0 && (
        <div className="col-span-full flex gap-1 h-2 rounded-full overflow-hidden bg-white/5">
          {(breakdown.fleet_telemetry || 0) > 0 && (
            <div
              className="bg-blue-500 rounded-full"
              style={{ width: `${((breakdown.fleet_telemetry || 0) / total) * 100}%` }}
              title={`Fleet Telemetry: ${breakdown.fleet_telemetry}`}
            />
          )}
          {(breakdown.idle_detection || 0) > 0 && (
            <div
              className="bg-amber-500 rounded-full"
              style={{ width: `${((breakdown.idle_detection || 0) / total) * 100}%` }}
              title={`Idle Detection: ${breakdown.idle_detection}`}
            />
          )}
          {(breakdown.prediction || 0) > 0 && (
            <div
              className="bg-purple-500 rounded-full"
              style={{ width: `${((breakdown.prediction || 0) / total) * 100}%` }}
              title={`Prediction: ${breakdown.prediction}`}
            />
          )}
          {(breakdown.sleep_detection || 0) > 0 && (
            <div
              className="bg-gray-500 rounded-full"
              style={{ width: `${((breakdown.sleep_detection || 0) / total) * 100}%` }}
              title={`Sleep: ${breakdown.sleep_detection}`}
            />
          )}
        </div>
      )}
      {total > 0 && (
        <div className="col-span-full flex gap-4 justify-center text-[10px] text-white/40">
          <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-blue-500" />Fleet Telemetry</span>
          <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-amber-500" />Idle Detection</span>
          <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-purple-500" />Prediction</span>
          <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-gray-500" />Sleep</span>
        </div>
      )}
    </div>
  )
}

export default function PollingEnginePanel() {
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

  const vehicles = Object.entries(status.vehicles || {})

  return (
    <GlassPanel className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold flex items-center gap-2">
          <TrendingDown size={20} className="text-emerald-400" />
          Adaptive Polling Engine
        </h3>
        <span className="text-xs px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-400">
          Active
        </span>
      </div>

      {savings && <SavingsCard savings={savings} />}

      {vehicles.length > 0 && (
        <div className="space-y-2">
          <h4 className="text-sm font-medium text-white/60 flex items-center gap-1">
            <Gauge size={14} /> Vehicle Activity
          </h4>
          {vehicles.map(([vin, vs]) => (
            <VehicleActivity key={vin} vin={vin} status={vs} />
          ))}
        </div>
      )}

      {vehicles.length === 0 && (
        <div className="text-center text-sm text-white/40 py-4">
          No vehicles tracked yet. Polling engine will activate on first poll.
        </div>
      )}
    </GlassPanel>
  )
}
