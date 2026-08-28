/**
 * @module sw/swProtocol
 *
 * Typed message contract between the page and the service worker.
 *
 * Both sides import this module, so a message can never drift: adding a
 * variant to {@link PageToSwMessage} without handling it in `sw.ts` is a
 * TypeScript error at the exhaustive switch, and the runtime guards below
 * keep a *stale* service worker (an older build still controlling the tab
 * after a deploy) from throwing on a message shape it has never seen.
 *
 * Pure module — no `self`, no DOM.
 */

import type { DeviceNotificationPrefs } from './notificationPolicy'

/**
 * Every message type is namespaced so a `postMessage` from an unrelated
 * library sharing the page (analytics SDKs frequently broadcast on the same
 * channel) is ignored rather than mis-parsed.
 */
export const SW_MESSAGE_NAMESPACE = 'teslasync/sw'

export const PAGE_TO_SW = {
  /** Legacy vite-plugin-pwa handshake — activates the waiting worker. */
  skipWaiting: 'SKIP_WAITING',
  /** Push the device notification policy into the worker. */
  deviceNotificationPrefs: 'teslasync/sw:device-notification-prefs',
  /** Toggle low-bandwidth behaviour (tile + image caching, prefetch). */
  lowBandwidth: 'teslasync/sw:low-bandwidth',
  /** Ask the worker to describe itself (build id, caches, cached-at times). */
  requestStatus: 'teslasync/sw:request-status',
  /** Drop every cached API read (used on sign-out and on contract breaks). */
  purgeApiCache: 'teslasync/sw:purge-api-cache',
} as const

export const SW_TO_PAGE = {
  status: 'teslasync/sw:status',
} as const

/** One cached API read, as reported by {@link SwStatusMessage}. */
export interface CachedApiEntry {
  /** Path WITHOUT the origin, e.g. `/api/v1/vehicles`. */
  path: string
  /** Epoch ms the entry was written, or `null` when unstamped. */
  cachedAt: number | null
}

export type PageToSwMessage =
  | { type: typeof PAGE_TO_SW.skipWaiting }
  | {
      type: typeof PAGE_TO_SW.deviceNotificationPrefs
      prefs: DeviceNotificationPrefs
    }
  | { type: typeof PAGE_TO_SW.lowBandwidth; enabled: boolean }
  | { type: typeof PAGE_TO_SW.requestStatus; requestId: string }
  | { type: typeof PAGE_TO_SW.purgeApiCache }

export interface SwStatusMessage {
  type: typeof SW_TO_PAGE.status
  requestId: string
  /** `BUILD_ID` of the worker actually serving this tab. */
  buildId: string
  apiContractVersion: number
  lowBandwidth: boolean
  entries: CachedApiEntry[]
}

export type SwToPageMessage = SwStatusMessage

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

/**
 * Runtime guard used by the worker's `message` handler.
 *
 * Only validates the discriminant and the fields the worker dereferences —
 * `prefs` is re-sanitised by `sanitizeDeviceNotificationPrefs` regardless, so
 * a partially-valid payload is repaired rather than rejected.
 */
export function isPageToSwMessage(value: unknown): value is PageToSwMessage {
  if (!isRecord(value) || typeof value.type !== 'string') return false
  switch (value.type) {
    case PAGE_TO_SW.skipWaiting:
    case PAGE_TO_SW.purgeApiCache:
      return true
    case PAGE_TO_SW.deviceNotificationPrefs:
      return isRecord(value.prefs)
    case PAGE_TO_SW.lowBandwidth:
      return typeof value.enabled === 'boolean'
    case PAGE_TO_SW.requestStatus:
      return typeof value.requestId === 'string' && value.requestId !== ''
    default:
      return false
  }
}

/** Runtime guard used by the page's `message` listener. */
export function isSwStatusMessage(value: unknown): value is SwStatusMessage {
  return (
    isRecord(value)
    && value.type === SW_TO_PAGE.status
    && typeof value.requestId === 'string'
    && typeof value.buildId === 'string'
    && typeof value.apiContractVersion === 'number'
    && Array.isArray(value.entries)
  )
}
