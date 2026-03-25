import { WifiOff, RefreshCw, Clock, Loader2 } from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'
import { useOfflineStatus } from '../hooks/useOfflineStatus'
import { formatDistanceToNow } from 'date-fns'

export function OfflineBanner() {
  const { isOnline, queuedItems, syncPending, lastSyncedAt } = useOfflineStatus()

  if (isOnline && queuedItems.length === 0) return null

  return (
    <AnimatePresence>
      {!isOnline && (
        <motion.div
          initial={{ height: 0, opacity: 0 }}
          animate={{ height: 'auto', opacity: 1 }}
          exit={{ height: 0, opacity: 0 }}
          className="overflow-hidden"
        >
          <div className="flex items-center gap-3 px-4 py-2.5 text-xs border-b" style={{ backgroundColor: 'rgba(239, 68, 68, 0.08)', borderColor: 'rgba(239, 68, 68, 0.15)' }}>
            <WifiOff className="h-3.5 w-3.5 text-red-400 shrink-0" />
            <span className="text-red-300 font-medium">You're offline</span>
            <span className="text-red-400/60">— showing cached data</span>
            {lastSyncedAt && (
              <span className="ml-auto flex items-center gap-1 text-red-400/50">
                <Clock className="h-3 w-3" />
                Last synced {formatDistanceToNow(lastSyncedAt, { addSuffix: true })}
              </span>
            )}
          </div>
        </motion.div>
      )}

      {isOnline && syncPending && (
        <motion.div
          initial={{ height: 0, opacity: 0 }}
          animate={{ height: 'auto', opacity: 1 }}
          exit={{ height: 0, opacity: 0 }}
          className="overflow-hidden"
        >
          <div className="flex items-center gap-3 px-4 py-2.5 text-xs border-b" style={{ backgroundColor: 'rgba(0, 240, 255, 0.05)', borderColor: 'rgba(0, 240, 255, 0.15)' }}>
            <Loader2 className="h-3.5 w-3.5 text-neon-cyan animate-spin shrink-0" />
            <span className="text-neon-cyan font-medium">Syncing queued items...</span>
            <span className="text-[var(--text-muted)]">{queuedItems.length} pending</span>
          </div>
        </motion.div>
      )}

      {isOnline && !syncPending && queuedItems.length > 0 && (
        <motion.div
          initial={{ height: 0, opacity: 0 }}
          animate={{ height: 'auto', opacity: 1 }}
          exit={{ height: 0, opacity: 0 }}
          className="overflow-hidden"
        >
          <div className="flex items-center gap-3 px-4 py-2.5 text-xs border-b" style={{ backgroundColor: 'rgba(245, 158, 11, 0.05)', borderColor: 'rgba(245, 158, 11, 0.15)' }}>
            <RefreshCw className="h-3.5 w-3.5 text-amber-400 shrink-0" />
            <span className="text-amber-300 font-medium">{queuedItems.length} queued item{queuedItems.length !== 1 ? 's' : ''}</span>
            <span className="text-amber-400/60">waiting to sync</span>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
