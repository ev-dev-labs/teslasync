import { focusManager, onlineManager, type Query, type QueryClient } from '@tanstack/react-query'
import { isRateLimitContextCurrent, isSafeRead } from '@/lib/rateLimit'
import { isRateLimitError } from '@/lib/resilience'

const MAX_PENDING_READS = 64
const MAX_AUTOMATIC_RECOVERIES = 3
const MAX_TIMER_MS = 2_147_483_647

interface PendingRead {
  deadline: number
  timer?: ReturnType<typeof setTimeout>
}

function currentContext(error: { generation?: number }): boolean {
  return error.generation == null || isRateLimitContextCurrent(error.generation)
}

/** Recovery owns only failed, observed reads. It never invalidates the whole cache. */
export function installRateLimitRecovery(client: QueryClient): () => void {
  const pending = new Map<Query, PendingRead>()
  const attempts = new WeakMap<Query, number>()
  let stopFocus: (() => void) | undefined
  let stopOnline: (() => void) | undefined
  let stopReset: (() => void) | undefined

  const stopIfIdle = () => {
    if (pending.size !== 0) return
    stopFocus?.()
    stopOnline?.()
    stopReset?.()
    stopFocus = undefined
    stopOnline = undefined
    stopReset = undefined
  }
  const remove = (query: Query) => {
    clearTimeout(pending.get(query)?.timer)
    pending.delete(query)
    stopIfIdle()
  }
  const arm = (query: Query, entry: PendingRead) => {
    clearTimeout(entry.timer)
    entry.timer = undefined
    if (!focusManager.isFocused() || !onlineManager.isOnline()) return
    const remaining = Math.max(0, entry.deadline - Date.now())
    entry.timer = setTimeout(() => {
      entry.timer = undefined
      if (Date.now() < entry.deadline) {
        arm(query, entry)
        return
      }
      if (!focusManager.isFocused() || !onlineManager.isOnline()) return
      remove(query)
      const error = query.state.error
      if (!query.isActive() || !isRateLimitError(error) || !isSafeRead(error.requestMethod) || !currentContext(error)) return
      attempts.set(query, (attempts.get(query) ?? 0) + 1)
      void query.fetch(undefined, { cancelRefetch: false }).catch(() => undefined)
    }, Math.min(MAX_TIMER_MS, remaining))
  }
  const resume = () => {
    for (const [query, entry] of pending) {
      if (!query.isActive()) {
        remove(query)
        continue
      }
      // Focus/reconnect can wake many tabs at once; each read gets fresh jitter.
      entry.deadline = Math.max(entry.deadline, Date.now() + 100 + Math.random() * 900)
      arm(query, entry)
    }
  }
  const reset = () => {
    for (const query of pending.keys()) {
      attempts.delete(query)
      remove(query)
    }
  }
  const schedule = (query: Query) => {
    const error = query.state.error
    if (!isRateLimitError(error) || !isSafeRead(error.requestMethod) || !query.isActive() ||
        !currentContext(error) ||
        query.options.retry === false || query.options.retry === 0 ||
        !Number.isFinite(error.expiresAt) ||
        (attempts.get(query) ?? 0) >= MAX_AUTOMATIC_RECOVERIES ||
        (!pending.has(query) && pending.size >= MAX_PENDING_READS)) return
    const entry: PendingRead = {
      deadline: Math.max(Date.now(), error.expiresAt) + 100 + Math.random() * 900,
    }
    clearTimeout(pending.get(query)?.timer)
    pending.set(query, entry)
    stopFocus ??= focusManager.subscribe(resume)
    stopOnline ??= onlineManager.subscribe(resume)
    if (!stopReset && typeof document !== 'undefined') {
      document.addEventListener('teslasync:rate-limits-reset', reset)
      stopReset = () => document.removeEventListener('teslasync:rate-limits-reset', reset)
    }
    arm(query, entry)
  }
  const stopCache = client.getQueryCache().subscribe((event) => {
    const query = event.query
    if (event.type === 'removed' || (event.type === 'observerRemoved' && !query.isActive())) {
      remove(query)
      return
    }
    if (event.type !== 'updated') return
    if (event.action.type === 'success') {
      remove(query)
      attempts.delete(query)
    } else if (event.action.type === 'error') schedule(query)
  })
  // The failure that loaded this module has already reached the cache.
  for (const query of client.getQueryCache().getAll()) schedule(query)
  return () => {
    stopCache()
    for (const query of pending.keys()) remove(query)
  }
}
