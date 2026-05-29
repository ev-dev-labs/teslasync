import { useEffect, useState } from 'react'
import { request, ApiError } from '@/api/client'

/**
 * Proactive new-deploy detection.
 *
 * Polls the backend `/system/version` endpoint at a fixed cadence and
 * compares the returned `app_version` against the version captured when
 * the SPA first booted. When they diverge, `newVersionAvailable` flips to
 * `true` so the {@link NewVersionBanner} can surface a soft "Reload"
 * affordance ahead of an inevitable chunk-load failure.
 *
 * Cross-tab coordination uses a dedicated `BroadcastChannel` named
 * `'teslasync:version'`. The central `@/lib/broadcast` bus is intentionally
 * NOT extended for this signal — version-change events are infrastructural
 * and don't belong in the user-facing settings/theme/auth bus, AND keeping
 * the channel local lets this hook ship without a typed-union schema
 * coordination across many consumers. When tab A discovers the new
 * deploy, every other tab on the same origin learns within milliseconds
 * instead of waiting for its own poll to fire.
 *
 * The hook is SSR-safe (no DOM access during the render phase) and
 * degrades gracefully when `BroadcastChannel` is unavailable (every tab
 * still discovers the new version on its own poll cycle).
 */

interface SystemVersionResponse {
  app_version: string
}

const POLL_INTERVAL_MS = 5 * 60 * 1000 // 5 minutes
const VERSION_CHANNEL = 'teslasync:version'

interface VersionEnvelope {
  version: string
}

export interface VersionWatcherState {
  /** The `app_version` reported by the backend on the very first poll after mount. `null` until the boot probe resolves. */
  bootVersion: string | null
  /** The most recent `app_version` reported by either a local poll or a peer tab. `null` until the first poll completes. */
  latestVersion: string | null
  /** `true` iff `bootVersion && latestVersion && latestVersion !== bootVersion`. */
  newVersionAvailable: boolean
}

function readChannel(): BroadcastChannel | null {
  if (typeof window === 'undefined') return null
  if (typeof BroadcastChannel === 'undefined') return null
  try {
    return new BroadcastChannel(VERSION_CHANNEL)
  } catch {
    return null
  }
}

async function fetchVersion(): Promise<string | null> {
  try {
    const resp = await request<SystemVersionResponse>('/system/version')
    if (resp && typeof resp.app_version === 'string' && resp.app_version.length > 0) {
      return resp.app_version
    }
    return null
  } catch (err) {
    // Swallow transient errors silently — the next tick will retry.
    // Surface ApiError 4xx (e.g. 401 unauthenticated) as a single
    // console warning so an operator can spot a misconfigured deployment.
    if (err instanceof ApiError && err.status >= 400 && err.status < 500) {
      console.warn('[useVersionWatcher] /system/version returned', err.status, err.message)
    }
    return null
  }
}

export function useVersionWatcher(): VersionWatcherState {
  const [bootVersion, setBootVersion] = useState<string | null>(null)
  const [latestVersion, setLatestVersion] = useState<string | null>(null)

  // 1. Boot probe — captured ONCE on mount.
  useEffect(() => {
    let cancelled = false
    void fetchVersion().then((v) => {
      if (cancelled || !v) return
      setBootVersion(v)
      setLatestVersion(v)
    })
    return () => {
      cancelled = true
    }
  }, [])

  // 2. Periodic poll — only starts once we have a baseline to compare against.
  useEffect(() => {
    if (!bootVersion) return

    let cancelled = false
    const channel = readChannel()

    const tick = async () => {
      const v = await fetchVersion()
      if (cancelled || !v) return
      setLatestVersion(v)
      if (v !== bootVersion) {
        try {
          channel?.postMessage({ version: v } satisfies VersionEnvelope)
        } catch {
          // postMessage can throw in private mode / closed channels — ignore.
        }
      }
    }

    const id = window.setInterval(() => {
      void tick()
    }, POLL_INTERVAL_MS)

    return () => {
      cancelled = true
      window.clearInterval(id)
      if (channel) {
        try {
          channel.close()
        } catch {
          /* ignore */
        }
      }
    }
  }, [bootVersion])

  // 3. Cross-tab subscription — peer tab discovered a new version, hoist
  //    the banner without waiting for our own next poll.
  useEffect(() => {
    const channel = readChannel()
    if (!channel) return undefined
    const onMessage = (e: MessageEvent<VersionEnvelope>) => {
      const v = e.data?.version
      if (typeof v === 'string' && v.length > 0) {
        setLatestVersion(v)
      }
    }
    channel.addEventListener('message', onMessage)
    return () => {
      channel.removeEventListener('message', onMessage)
      try {
        channel.close()
      } catch {
        /* ignore */
      }
    }
  }, [])

  const newVersionAvailable = !!(
    bootVersion &&
    latestVersion &&
    latestVersion !== bootVersion
  )

  return { bootVersion, latestVersion, newVersionAvailable }
}
