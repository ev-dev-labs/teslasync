import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { motion, AnimatePresence } from 'framer-motion'
import { WifiOff, AlertTriangle, X } from 'lucide-react'
import { getConnectionStatus, onStatusChange, fetchSystemStatus, type SystemStatus } from '../lib/resilience'

export function ServiceStatusBanner() {
  const [connStatus, setConnStatus] = useState<string>(getConnectionStatus())
  const [dismissed, setDismissed] = useState(false)

  useEffect(() => {
    return onStatusChange((s) => {
      setConnStatus(s)
      // Auto-show banner again when status changes
      if (s !== 'online') setDismissed(false)
    })
  }, [])

  // Poll system status every 60s (only when online)
  const { data: sysStatus } = useQuery<SystemStatus>({
    queryKey: ['system-status'],
    queryFn: fetchSystemStatus,
    refetchInterval: 60_000,
    enabled: connStatus !== 'offline',
    retry: 1,
  })

  const isDegraded = connStatus === 'degraded' || sysStatus?.overall === 'degraded'
  const isOffline = connStatus === 'offline'
  const isUnhealthy = sysStatus?.overall === 'unhealthy'

  const show = (isOffline || isDegraded || isUnhealthy) && !dismissed

  return (
    <AnimatePresence>
      {show && (
        <motion.div
          initial={{ height: 0, opacity: 0 }}
          animate={{ height: 'auto', opacity: 1 }}
          exit={{ height: 0, opacity: 0 }}
          transition={{ duration: 0.3 }}
          className="overflow-hidden"
        >
          <div
            className="flex items-center justify-center gap-2 px-4 py-2 text-xs font-medium relative"
            style={{
              background: isOffline
                ? 'rgba(239,68,68,0.15)'
                : isUnhealthy
                ? 'rgba(239,68,68,0.1)'
                : 'rgba(245,158,11,0.1)',
              color: isOffline || isUnhealthy ? '#f87171' : '#fbbf24',
              borderBottom: '1px solid',
              borderColor: isOffline || isUnhealthy
                ? 'rgba(239,68,68,0.2)'
                : 'rgba(245,158,11,0.2)',
            }}
          >
            {isOffline ? (
              <>
                <WifiOff className="h-3.5 w-3.5" />
                <span>You are offline. Data may be stale. Reconnecting automatically...</span>
              </>
            ) : isUnhealthy ? (
              <>
                <AlertTriangle className="h-3.5 w-3.5" />
                <span>System health issue detected. Some features may be unavailable.</span>
              </>
            ) : (
              <>
                <AlertTriangle className="h-3.5 w-3.5" />
                <span>Running in degraded mode. Some services may respond slowly.</span>
              </>
            )}
            {!isOffline && (
              <button
                onClick={() => setDismissed(true)}
                className="absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded hover:bg-white/10 transition-colors"
                aria-label="Dismiss"
              >
                <X className="h-3 w-3" />
              </button>
            )}
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
