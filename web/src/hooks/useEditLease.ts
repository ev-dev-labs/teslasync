import { useEffect, useState } from 'react'
import {
  TAB_ID,
  broadcast,
  subscribe,
  type BroadcastMessage,
} from '@/lib/broadcast'

/**
 * Phase-46 / Prompt 66 — Two-tab edit conflict detection.
 *
 * `useEditLease` coordinates "I am editing X" between browser tabs of the
 * same origin so that a tab opening a stale view of a shared resource can
 * warn the user before their save silently overwrites a peer tab's
 * changes.
 *
 * The protocol piggy-backs on the BroadcastChannel-backed bus already
 * shipped at {@link module:lib/broadcast} and does NOT require any
 * server-side coordination — it is a same-origin tab-to-tab handshake.
 *
 * ## Election protocol
 *
 *   1. On mount the hook posts `lease.request` for the resource key and
 *      starts a {@link ELECTION_TIMEOUT_MS} timer.
 *   2. Any peer tab that already owns the lease responds with
 *      `lease.granted` carrying its `tabId` + `claimedAt` so the new tab
 *      can render the conflict banner.
 *   3. If no peer responds before the timer fires, this tab becomes the
 *      owner and itself broadcasts `lease.granted` so any other peers
 *      that were also racing-elect see it.
 *   4. Simultaneous-mount races are resolved by a deterministic
 *      tiebreaker: newer `claimedAt` wins; equal `claimedAt` falls back
 *      to lower `tabId` lexicographic comparison. The losing tab yields
 *      and renders the banner.
 *   5. On unmount and `beforeunload` the hook posts `lease.released`. A
 *      non-owner peer that was watching this tab clears its `otherTab`
 *      and starts a fresh election so the surviving tab smoothly
 *      promotes itself.
 *
 * ## Multiple subscribers within a single tab
 *
 * State is keyed by `resourceKey` at the module level so multiple
 * components on the same key share one election + one broadcast
 * subscription. {@link getCurrentLease} reads that shared state without
 * subscribing — it is the entry point a future mutation hook can use to
 * implement client-side save-collision rejection (Step 4 of the design).
 *
 * ## What this hook is NOT
 *
 *   - Not a server-side ETag / `If-Match` enforcement layer. It cannot
 *     stop a third-party cURL from racing the SPA. It is defense in
 *     depth at the SPA layer only.
 *   - Not cross-origin. Same `BroadcastChannel` rules apply.
 *   - Not durable across reloads. Each page load is a fresh tab and
 *     re-runs the election.
 */

export interface OtherTabInfo {
  /** Stable per-tab identifier of the peer that holds the lease. */
  tabId: string
  /** Wall-clock time at which the peer claimed the lease. */
  claimedAt: number
}

export interface LeaseState {
  /** This tab currently owns the edit lease for the resource. */
  isOwner: boolean
  /**
   * Information about a peer tab that holds the lease. `null` when this
   * tab is the owner OR no other tab has announced ownership yet.
   */
  otherTab: OtherTabInfo | null
}

export interface UseEditLeaseResult extends LeaseState {
  /**
   * Forcibly take over the edit lease. Bumps `claimedAt` to the current
   * wall-clock + 1ms so the previous owner yields on receipt.
   *
   * Intended for the "Take over editing" affordance in
   * {@link EditConflictBanner}.
   */
  claim: () => void
}

/**
 * Error thrown by client-side save-collision guards (Step 4 of the
 * design). Future mutation hooks may import this and throw before
 * issuing the network request when {@link getCurrentLease} reports
 * `!isOwner`.
 */
export class EditConflictError extends Error {
  readonly resourceKey: string
  readonly otherTab: OtherTabInfo | null

  constructor(resourceKey: string, otherTab: OtherTabInfo | null) {
    super(
      `Edit conflict on "${resourceKey}": another browser tab holds the edit lease.`,
    )
    this.name = 'EditConflictError'
    this.resourceKey = resourceKey
    this.otherTab = otherTab
  }
}

/**
 * Election timeout — the wall-clock window we wait for any active owner
 * to respond to our `lease.request` before we self-grant. Kept tight
 * (250ms) so the user perceives the banner as "instant" when a peer
 * tab is open.
 */
export const ELECTION_TIMEOUT_MS = 250

interface LeaseInternal {
  resourceKey: string
  claimedAt: number
  isOwner: boolean
  otherTab: OtherTabInfo | null
  subscribers: Set<() => void>
  electionTimer: ReturnType<typeof setTimeout> | null
  unsubscribeBus: (() => void) | null
}

/**
 * Module-level registry of active leases keyed by `resourceKey`. Multiple
 * `useEditLease(sameKey)` callers within one tab share the same entry —
 * each component-instance is a notify-only subscriber, not an
 * independent election voter.
 */
const leases = new Map<string, LeaseInternal>()

function notifySubscribers(internal: LeaseInternal): void {
  for (const sub of internal.subscribers) {
    try {
      sub()
    } catch {
      // Subscriber threw — never let one consumer crash the registry.
    }
  }
}

function broadcastGrant(internal: LeaseInternal): void {
  broadcast({
    type: 'lease.granted',
    resourceKey: internal.resourceKey,
    tabId: TAB_ID,
    claimedAt: internal.claimedAt,
  })
}

function broadcastRequest(internal: LeaseInternal): void {
  broadcast({
    type: 'lease.request',
    resourceKey: internal.resourceKey,
    tabId: TAB_ID,
  })
}

function broadcastReleased(internal: LeaseInternal): void {
  broadcast({
    type: 'lease.released',
    resourceKey: internal.resourceKey,
    tabId: TAB_ID,
  })
}

/**
 * Begin an election: ask any active owner to re-announce, then after
 * {@link ELECTION_TIMEOUT_MS} self-grant if nobody responded.
 */
function startElection(internal: LeaseInternal): void {
  if (internal.electionTimer != null) {
    clearTimeout(internal.electionTimer)
  }
  broadcastRequest(internal)
  internal.electionTimer = setTimeout(() => {
    internal.electionTimer = null
    if (!internal.isOwner && internal.otherTab === null) {
      internal.claimedAt = Date.now()
      internal.isOwner = true
      broadcastGrant(internal)
      notifySubscribers(internal)
    }
  }, ELECTION_TIMEOUT_MS)
}

function handleMessage(internal: LeaseInternal, msg: BroadcastMessage): void {
  if (
    msg.type !== 'lease.request' &&
    msg.type !== 'lease.granted' &&
    msg.type !== 'lease.released'
  ) {
    return
  }
  if (msg.resourceKey !== internal.resourceKey) return
  // Defense in depth — `subscribe()` already filters self-broadcasts by
  // TAB_ID; this guard makes the contract obvious to readers.
  if (msg.tabId === TAB_ID) return

  if (msg.type === 'lease.request') {
    if (internal.isOwner) {
      broadcastGrant(internal)
    }
    return
  }

  if (msg.type === 'lease.granted') {
    const peer: OtherTabInfo = { tabId: msg.tabId, claimedAt: msg.claimedAt }
    if (internal.isOwner) {
      // Tiebreaker: newer `claimedAt` wins; equal claim falls back to
      // lower `tabId` lexicographic comparison. This deterministically
      // resolves simultaneous-mount races without a coordinator.
      const peerWins =
        peer.claimedAt > internal.claimedAt ||
        (peer.claimedAt === internal.claimedAt && peer.tabId < TAB_ID)
      if (peerWins) {
        internal.isOwner = false
        internal.otherTab = peer
        notifySubscribers(internal)
      } else {
        // We win — re-assert so the loser learns to yield.
        broadcastGrant(internal)
      }
    } else {
      const current = internal.otherTab
      const replace =
        !current ||
        peer.claimedAt > current.claimedAt ||
        (peer.claimedAt === current.claimedAt && peer.tabId < current.tabId)
      if (replace) {
        internal.otherTab = peer
        notifySubscribers(internal)
      }
    }
    return
  }

  if (msg.type === 'lease.released') {
    const current = internal.otherTab
    if (current && current.tabId === msg.tabId) {
      internal.otherTab = null
      notifySubscribers(internal)
      // The tab we were watching is gone; start a fresh election so we
      // smoothly promote ourselves (or learn about a third tab that's
      // also still around).
      startElection(internal)
    }
  }
}

function acquire(resourceKey: string): LeaseInternal {
  let internal = leases.get(resourceKey)
  if (!internal) {
    const created: LeaseInternal = {
      resourceKey,
      claimedAt: 0,
      isOwner: false,
      otherTab: null,
      subscribers: new Set(),
      electionTimer: null,
      unsubscribeBus: null,
    }
    leases.set(resourceKey, created)
    created.unsubscribeBus = subscribe((msg) => handleMessage(created, msg))
    startElection(created)
    internal = created
  }
  return internal
}

function release(internal: LeaseInternal): void {
  if (internal.subscribers.size > 0) return
  if (internal.electionTimer != null) {
    clearTimeout(internal.electionTimer)
    internal.electionTimer = null
  }
  if (internal.unsubscribeBus) {
    internal.unsubscribeBus()
    internal.unsubscribeBus = null
  }
  broadcastReleased(internal)
  leases.delete(internal.resourceKey)
}

function performClaim(internal: LeaseInternal): void {
  // +1ms guarantees we beat the previous owner's `claimedAt` even when
  // the user clicks "Take over" within the same millisecond they
  // received the granted message.
  internal.claimedAt = Date.now() + 1
  internal.isOwner = true
  internal.otherTab = null
  broadcastGrant(internal)
  notifySubscribers(internal)
}

/**
 * Read the current lease state for `resourceKey` without subscribing.
 *
 * Returns `null` when no `useEditLease` instance is mounted for that
 * key — callers should treat that as "no contention" since without a
 * mounted hook there is no peer-tab listener anyway.
 *
 * Intended entry point for client-side save-collision guards (Step 4
 * of the design): a mutation hook calls `getCurrentLease(key)` before
 * issuing the network request and throws {@link EditConflictError}
 * when the snapshot reports `!isOwner`.
 */
export function getCurrentLease(resourceKey: string): LeaseState | null {
  const internal = leases.get(resourceKey)
  if (!internal) return null
  return { isOwner: internal.isOwner, otherTab: internal.otherTab }
}

/**
 * React hook variant. Subscribes to the registry entry for the lifetime
 * of the calling component and re-renders on lease state changes.
 *
 * Pass `''` (empty string) to opt out — the hook then returns the
 * "no-op" defaults `{ isOwner: false, otherTab: null, claim: noop }`
 * and does NOT broadcast any messages. This lets callers conditionally
 * disable the lease without violating the rules-of-hooks ordering.
 */
export function useEditLease(resourceKey: string): UseEditLeaseResult {
  const [, force] = useState(0)

  useEffect(() => {
    if (!resourceKey) return undefined

    const internal = acquire(resourceKey)
    const sub = () => force((n) => n + 1)
    internal.subscribers.add(sub)
    // Push a render so the caller sees any state already accumulated
    // by a sibling subscriber (or the in-flight election).
    sub()

    const onBeforeUnload = () => {
      // The page is going away — give peer tabs a final hint so they
      // re-elect immediately instead of waiting for our next granted
      // to time out.
      broadcastReleased(internal)
    }
    if (typeof window !== 'undefined') {
      window.addEventListener('beforeunload', onBeforeUnload)
    }

    return () => {
      if (typeof window !== 'undefined') {
        window.removeEventListener('beforeunload', onBeforeUnload)
      }
      internal.subscribers.delete(sub)
      release(internal)
    }
  }, [resourceKey])

  if (!resourceKey) {
    return {
      isOwner: false,
      otherTab: null,
      claim: noop,
    }
  }

  const internal = leases.get(resourceKey)
  return {
    isOwner: internal?.isOwner ?? false,
    otherTab: internal?.otherTab ?? null,
    claim: () => {
      const cur = leases.get(resourceKey)
      if (cur) performClaim(cur)
    },
  }
}

function noop(): void {}

/**
 * Test seam — tears down every active lease registry entry so a fresh
 * test starts from a clean slate without leaking timers or subscribers.
 * Production callers must NOT use this.
 */
export function __resetEditLeasesForTests(): void {
  for (const internal of leases.values()) {
    if (internal.electionTimer != null) {
      clearTimeout(internal.electionTimer)
      internal.electionTimer = null
    }
    if (internal.unsubscribeBus) {
      try {
        internal.unsubscribeBus()
      } catch {
        // ignore
      }
      internal.unsubscribeBus = null
    }
    internal.subscribers.clear()
  }
  leases.clear()
}
