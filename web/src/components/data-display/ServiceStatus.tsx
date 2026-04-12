import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { motion, AnimatePresence } from 'framer-motion'
import { WifiOff } from 'lucide-react'
import { getConnectionStatus, onStatusChange, fetchSystemStatus, type SystemStatus } from '../../lib/resilience'

export function ServiceStatusBanner() {
  const [connStatus, setConnStatus] = useState<string>(getConnectionStatus())

  useEffect(() => {
    return onStatusChange((s) => setConnStatus(s))
  }, [])

  const isOffline = connStatus === 'offline'

  return (
    <AnimatePresence>
      {isOffline && (
        <motion.div
          initial={{ height: 0, opacity: 0 }}
          animate={{ height: 'auto', opacity: 1 }}
          exit={{ height: 0, opacity: 0 }}
          transition={{ duration: 0.3 }}
          className="overflow-hidden"
        >
          <div
            className="flex items-center justify-center gap-2 px-4 py-2 text-xs font-medium"
            style={{
              background: 'rgba(239,68,68,0.15)',
              color: '#f87171',
              borderBottom: '1px solid rgba(239,68,68,0.2)',
            }}
          >
            <WifiOff className="h-3.5 w-3.5" />
            <span>You are offline. Data may be stale. Reconnecting automatically...</span>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

// Compact system health indicator for the sidebar
export function SystemHealthDot() {
  const { data } = useQuery<SystemStatus>({
    queryKey: ['system-status'],
    queryFn: fetchSystemStatus,
    refetchInterval: 60_000,
    retry: 1,
  })

  if (!data) return null

  const color =
    data.overall === 'healthy'
      ? 'bg-neon-green'
      : data.overall === 'degraded'
      ? 'bg-neon-amber'
      : 'bg-neon-red'

  const glow =
    data.overall === 'healthy'
      ? 'shadow-[0_0_6px_rgba(16,185,129,0.5)]'
      : data.overall === 'degraded'
      ? 'shadow-[0_0_6px_rgba(245,158,11,0.5)]'
      : 'shadow-[0_0_6px_rgba(239,68,68,0.5)]'

  return (
    <span
      className={`h-2 w-2 rounded-full ${color} ${glow}`}
      title={`System: ${data.overall}`}
    />
  )
}
