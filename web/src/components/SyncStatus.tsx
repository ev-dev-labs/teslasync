import { RefreshCw, Check, Clock } from 'lucide-react'
import { useOfflineStatus } from '../hooks/useOfflineStatus'
import { formatDistanceToNow } from 'date-fns'
import clsx from 'clsx'

export function SyncStatus() {
  const { isOnline, syncPending, lastSyncedAt, queuedItems } = useOfflineStatus()

  if (!lastSyncedAt && queuedItems.length === 0) return null

  return (
    <div className="flex items-center gap-1.5 text-[10px]">
      {syncPending ? (
        <>
          <RefreshCw className="h-3 w-3 text-neon-cyan animate-spin" />
          <span className="text-neon-cyan">Syncing...</span>
        </>
      ) : queuedItems.length > 0 ? (
        <>
          <Clock className="h-3 w-3 text-amber-400" />
          <span className="text-amber-400">{queuedItems.length} queued</span>
        </>
      ) : lastSyncedAt ? (
        <>
          <Check className={clsx('h-3 w-3', isOnline ? 'text-neon-green' : 'text-[var(--text-muted)]')} />
          <span className="text-[var(--text-muted)]">
            Synced {formatDistanceToNow(lastSyncedAt, { addSuffix: true })}
          </span>
        </>
      ) : null}
    </div>
  )
}
