/**
 * @module hooks/useTelemetryFreshness
 *
 * Authoritative **fleet-wide** "when did any vehicle last tell us something?"
 * clock.
 *
 * ## Scope: fleet, not the selected vehicle
 *
 * The value is a high-water mark across every vehicle streaming into this
 * browser session. It answers "is the telemetry pipeline producing data?" —
 * NOT "is the vehicle I am currently looking at reporting?". A page that
 * needs the latter must derive it per vehicle from that vehicle's own signal
 * reads; treating this value as per-vehicle would let a chatty second car
 * mask a silent selected one, which is a worse lie than the heartbeat bug
 * this module was written to fix.
 *
 * ## Why this is not `useLiveConnection().lastMessageAt`
 *
 * `sseManager` stamps `lastMessageAt` on **every** frame it receives from the
 * server — `connected`, `heartbeat`, `alert`, `export_status`,
 * `achievement_unlocked` — because that field exists to answer "is the pipe
 * alive?". A backend heartbeat therefore refreshes it every few seconds
 * regardless of whether any car has produced a signal.
 *
 * Using that value for telemetry freshness makes the UI claim the fleet is
 * `fresh` forever: a vehicle can be asleep, unreachable, or dropped from the
 * telemetry config for hours, and the heartbeat keeps resetting the clock.
 * That is precisely the "looks healthy while silently stale" failure mode the
 * live-state contract exists to prevent.
 *
 * This module therefore tracks **only** `vehicle_update` frames — the event
 * emitted by `SideEffectsObserver.broadcastSSE` after the normalize pipeline
 * has processed real atomics — and prefers the payload's own `ts` (the
 * pipeline's observation instant) over local receipt time, so queueing or
 * cross-pod Redis fan-out delay is visible rather than hidden.
 *
 * ## Monotonicity
 *
 * Because the payload instant is preferred over arrival order, frames can
 * arrive out of order: Redis fan-out, per-vehicle MQTT queue depth and
 * multi-pod publishing all reorder freely, so a *newer* frame for vehicle A
 * can be followed by an *older* (but perfectly plausible) frame for vehicle
 * B. Storing the last-seen value would regress the clock and flip a fresh
 * fleet to `stale` purely because a lagging car caught up. The store keeps a
 * monotonic high-water mark instead: the value only ever moves forward.
 *
 * Heartbeats still drive SSE health via `useLiveConnection`. The two axes stay
 * separate on purpose: a healthy pipe carrying no telemetry is a real and
 * common state (a parked, sleeping car), and it must not read as either a
 * broken connection or as fresh data.
 */

import { useSyncExternalStore } from 'react'

import { sseManager } from '@/lib/sseManager'

/**
 * Live values older than this are treated as stale, matching the backend's
 * cross-pod live-state contract (see the "Signal Data — Layered Live-State
 * Contract" section of the repository instructions).
 *
 * Defined here rather than in `useConnectionModel` because the store below
 * schedules the boundary timer; `useConnectionModel` re-exports it so existing
 * importers are unaffected.
 */
export const TELEMETRY_STALE_AFTER_MS = 2 * 60 * 1_000

/**
 * Coarse re-render cadence while a timestamp is known, so a rendered
 * "N minutes ago" keeps counting. ONE shared interval for the whole app — a
 * per-consumer timer would multiply by every mounted indicator.
 */
export const TELEMETRY_AGE_TICK_MS = 30_000

/**
 * Payload timestamps further ahead of local time than this are treated as
 * clock skew and discarded in favour of receipt time. Without the guard a
 * mis-set server clock would pin telemetry to "fresh" permanently.
 */
export const MAX_TELEMETRY_CLOCK_SKEW_MS = 60_000

/**
 * Lower bound for a plausible telemetry instant (2000-01-01). Rejects `0`,
 * negative values and epoch-second timestamps accidentally parsed as
 * milliseconds, all of which would otherwise register as "impossibly stale"
 * and permanently red.
 */
const MIN_PLAUSIBLE_MS = 946_684_800_000

/** Keys the backend has used for the observation instant on a vehicle_update. */
const TIMESTAMP_KEYS = ['ts', 'timestamp', 'updated_at', 'last_updated'] as const

function parseCandidate(raw: unknown): number | null {
  if (typeof raw === 'number') {
    return Number.isFinite(raw) ? raw : null
  }
  if (typeof raw === 'string' && raw.trim() !== '') {
    const parsed = Date.parse(raw)
    return Number.isNaN(parsed) ? null : parsed
  }
  return null
}

/**
 * Resolve the instant a `vehicle_update` payload describes.
 *
 * Prefers the payload's own timestamp when it is plausible; otherwise falls
 * back to local receipt time. Never returns `null` for a well-formed event —
 * the event itself proves telemetry arrived, even if we cannot date it
 * precisely.
 *
 * Exported for direct unit testing; the store below is the runtime consumer.
 */
export function extractTelemetryTimestamp(
  payload: unknown,
  receivedAtMs: number,
  maxSkewMs: number = MAX_TELEMETRY_CLOCK_SKEW_MS,
): number {
  if (payload == null || typeof payload !== 'object' || Array.isArray(payload)) {
    return receivedAtMs
  }
  const record = payload as Record<string, unknown>
  for (const key of TIMESTAMP_KEYS) {
    const candidate = parseCandidate(record[key])
    if (candidate == null) continue
    if (candidate < MIN_PLAUSIBLE_MS) continue
    if (candidate > receivedAtMs + maxSkewMs) continue
    return candidate
  }
  return receivedAtMs
}

// ── Module-level store ─────────────────────────────────────────────────────
// One `vehicle_update` subscription for the whole app no matter how many
// components read the value. The snapshot is a primitive, so
// useSyncExternalStore never sees a spurious identity change.
//
// The stored value is a monotonic high-water mark across the whole fleet: an
// out-of-order frame carrying an older (but plausible) instant is recorded as
// evidence the pipe is alive without dragging the clock backwards.
//
// ## Why the store owns a clock
//
// Freshness is a function of `now`, but nothing in the event stream fires when
// a reading merely *ages*. A fleet that goes quiet produces no `vehicle_update`
// at all, so any consumer memoising on the timestamp alone would report
// `fresh` forever — SSE heartbeats re-render `useLiveConnection`, but
// `streamStatus` is unchanged and the memo stays cached. The store therefore
// schedules a notification at the EXACT stale boundary (plus a coarse age
// tick), from a single shared pair of timers rather than one per consumer.

let lastTelemetryAtMs: number | null = null
let clockVersion = 0
const listeners = new Set<() => void>()

let staleBoundaryTimer: ReturnType<typeof setTimeout> | null = null
let ageTicker: ReturnType<typeof setInterval> | null = null

function notify(): void {
  for (const listener of listeners) listener()
}

function clearClockTimers(): void {
  if (staleBoundaryTimer != null) {
    clearTimeout(staleBoundaryTimer)
    staleBoundaryTimer = null
  }
  if (ageTicker != null) {
    clearInterval(ageTicker)
    ageTicker = null
  }
}

/**
 * (Re)arm the shared clock. Idempotent: called whenever the timestamp moves or
 * the subscriber set changes, and a no-op when nothing is subscribed or no
 * reading exists — an unknown timestamp has no boundary to cross.
 */
function rescheduleClock(): void {
  clearClockTimers()
  if (listeners.size === 0 || lastTelemetryAtMs == null) return
  if (typeof setTimeout !== 'function') return

  const msUntilStale = lastTelemetryAtMs + TELEMETRY_STALE_AFTER_MS - Date.now()
  if (msUntilStale > 0) {
    // +1ms so the callback runs strictly AFTER the boundary, never on it.
    staleBoundaryTimer = setTimeout(() => {
      staleBoundaryTimer = null
      clockVersion += 1
      notify()
    }, msUntilStale + 1)
  }

  ageTicker = setInterval(() => {
    clockVersion += 1
    notify()
  }, TELEMETRY_AGE_TICK_MS)
}

function onVehicleUpdate(data: unknown): void {
  const observedAt = extractTelemetryTimestamp(data, Date.now())
  if (lastTelemetryAtMs != null && observedAt <= lastTelemetryAtMs) {
    // A lagging vehicle catching up must not make the fleet look staler than
    // it is, and re-notifying subscribers for a no-op change would churn
    // every consumer of the connection model.
    return
  }
  lastTelemetryAtMs = observedAt
  clockVersion += 1
  rescheduleClock()
  notify()
}

function subscribe(onStoreChange: () => void): () => void {
  listeners.add(onStoreChange)
  if (listeners.size === 1) {
    sseManager.subscribe('vehicle_update', onVehicleUpdate)
    rescheduleClock()
  }
  return () => {
    listeners.delete(onStoreChange)
    if (listeners.size === 0) {
      sseManager.unsubscribe('vehicle_update', onVehicleUpdate)
      clearClockTimers()
    }
  }
}

function getSnapshot(): number | null {
  return lastTelemetryAtMs
}

function getServerSnapshot(): number | null {
  return null
}

function getClockSnapshot(): number {
  return clockVersion
}

function getServerClockSnapshot(): number {
  return 0
}

/**
 * Epoch-ms instant of the most recent `vehicle_update` seen from **any**
 * vehicle, or `null` when no vehicle telemetry has been observed this
 * session. Monotonic: never moves backwards.
 *
 * `null` means **unknown**, not stale: at first paint we have no basis to
 * claim either.
 *
 * Fleet-scoped by definition — see the module comment. Do not read it as the
 * freshness of the currently selected vehicle.
 */
export function useFleetLastTelemetryAt(): number | null {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)
}

/** ISO form of {@link useFleetLastTelemetryAt}, for consumers that render it. */
export function useFleetLastTelemetryAtIso(): string | null {
  const ms = useFleetLastTelemetryAt()
  return ms == null ? null : new Date(ms).toISOString()
}

/**
 * Monotonic counter that increments whenever the shared clock says a
 * freshness-dependent value may have changed: a new reading, the stale
 * boundary being crossed, or a coarse age tick.
 *
 * Consumers include it in their `useMemo` dependency list so a derivation that
 * calls `Date.now()` is actually re-run. Without it, a fleet that goes silent
 * never re-renders and reports `fresh` indefinitely.
 */
export function useTelemetryClock(): number {
  return useSyncExternalStore(subscribe, getClockSnapshot, getServerClockSnapshot)
}

/**
 * Test-only reset of the module-level store so suites do not leak a timestamp
 * (or a live subscription / armed timer) into each other.
 */
export function __resetTelemetryFreshnessForTests(): void {
  lastTelemetryAtMs = null
  clockVersion = 0
  clearClockTimers()
  if (listeners.size > 0) {
    sseManager.unsubscribe('vehicle_update', onVehicleUpdate)
  }
  listeners.clear()
}
