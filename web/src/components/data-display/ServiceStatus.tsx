import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { motion, AnimatePresence } from '@/components/motion'
import { WifiOff } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useMotionPreference } from '@/hooks/useMotionPreference'
import { getConnectionStatus, onStatusChange, fetchSystemStatus, type SystemStatus } from '../../lib/resilience'

export function ServiceStatusBanner() {
  const { t } = useTranslation()
  const { reduce } = useMotionPreference()
  const [connStatus, setConnStatus] = useState<string>(getConnectionStatus())

  useEffect(() => {
    return onStatusChange((s) => setConnStatus(s))
  }, [])

  const isOffline = connStatus === 'offline'

  return (
    <AnimatePresence>
      {isOffline && (
        <motion.div
          initial={reduce ? false : { height: 0, opacity: 0 }}
          animate={{ height: 'auto', opacity: 1 }}
          exit={reduce ? { opacity: 0 } : { height: 0, opacity: 0 }}
          transition={{ duration: reduce ? 0 : 0.3 }}
          className="overflow-hidden"
        >
          <div
            role="status"
            aria-live="polite"
            className="flex items-center justify-center gap-2 border-b border-red-500/20 bg-red-500/15 px-4 py-2 text-xs font-medium text-red-300"
          >
            <WifiOff className="h-3.5 w-3.5" aria-hidden="true" />
            <span>
              {t(
                'serviceStatus.offline',
                'You are offline. Data may be stale. Reconnecting automatically…',
              )}
            </span>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

// Compact system health indicator for the sidebar.
//
// `unknown` covers the loading/error/no-data path so the sidebar always shows
// an indicator (a muted dot) rather than silently disappearing while the
// 60s-interval query is in flight or after a fetch failure.
const HEALTH_TONE: Record<'healthy' | 'degraded' | 'unhealthy' | 'unknown', { dot: string; glow: string }> = {
  healthy: { dot: 'bg-neon-green', glow: 'shadow-[0_0_6px_rgba(16,185,129,0.5)]' },
  degraded: { dot: 'bg-neon-amber', glow: 'shadow-[0_0_6px_rgba(245,158,11,0.5)]' },
  unhealthy: { dot: 'bg-neon-red', glow: 'shadow-[0_0_6px_rgba(239,68,68,0.5)]' },
  unknown: { dot: 'bg-[var(--text-muted)]', glow: '' },
}

function healthTone(overall?: string): keyof typeof HEALTH_TONE {
  if (overall === 'healthy') return 'healthy'
  if (overall === 'degraded') return 'degraded'
  if (overall) return 'unhealthy'
  return 'unknown'
}

export function SystemHealthDot() {
  const { t } = useTranslation()
  const { data } = useQuery<SystemStatus>({
    queryKey: ['system-status'],
    queryFn: fetchSystemStatus,
    refetchInterval: 60_000,
    retry: 1,
  })

  const overall = data?.overall
  const { dot, glow } = HEALTH_TONE[healthTone(overall)]
  const label = t('serviceStatus.systemHealth', 'System: {{status}}', {
    status: overall ?? t('serviceStatus.unknown', 'unknown'),
  })

  return (
    <span
      role="img"
      aria-label={label}
      title={label}
      className={`inline-block h-2 w-2 rounded-full ${dot}${glow ? ` ${glow}` : ''}`}
    />
  )
}
