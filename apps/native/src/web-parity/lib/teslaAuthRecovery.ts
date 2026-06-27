// Native parity port of web/src/lib/teslaAuthRecovery.ts.
//
// PURPOSE (web, source L1-23): a best-effort, per-tab FIFO queue that holds
// Tesla-bound mutations which failed because the user's third-party Tesla
// refresh token expired, then replays them after the user reconnects. The web
// flow is:
//   1. A Tesla-bound mutation throws TeslaAuthExpiredError; the mutation hook
//      calls queueTeslaMutation(replay) with a closure that re-issues the
//      original request (source L4-9; useVehicleCommand.ts L56).
//   2. When auth recovers, <TeslaAccountSection> calls notifyTeslaAuthRecovered()
//      which dispatches the `teslasync:tesla-auth-recovered` DOM CustomEvent on
//      `document` (source L9-11, L75-86; TeslaAccountSection.tsx L52).
//   3. <TeslaReauthBanner> (and TeslaAccountSection itself) listen for that
//      document event and call drainQueuedTeslaMutations() (source L11-13;
//      TeslaReauthBanner.tsx L47-53), replaying each queued closure in FIFO
//      order.
// The four intentional constraints (source L15-22) are preserved verbatim:
//   • TTL 5 minutes — older entries dropped silently on drain (source L16-17,
//     L36, L65). Users who reconnect later are not surprised by stale commands.
//   • Cap 10 entries — queue bounded; overflow dropped at queue-time (source
//     L18-19, L33, L49).
//   • Per-tab only — the queue lives in module memory; reload clears it (source
//     L20). On React Native the analog is "per app session" — module memory is
//     cleared on app reload/restart, the identical lifetime guarantee.
//   • Replay errors swallowed — the hook's own onError surfaces them again
//     (source L21-22, L69-71).
//
// NATIVE ADAPTATION (contract rule 7 — browser-only behaviour made native-safe):
//   The ONLY browser-only line is notifyTeslaAuthRecovered's
//   `document.dispatchEvent(new CustomEvent('teslasync:tesla-auth-recovered'))`
//   (source L85), guarded by `typeof document === 'undefined'` (source L84). On
//   React Native `document` is permanently undefined, so the web function would
//   be a permanent no-op and the queue could never drain. To preserve the SOURCE
//   INTENT (recovery is a pub/sub bus that decouples the emitter — the Tesla
//   account UI — from the consumer(s) — the reauth banner — and on the web BOTH
//   TeslaReauthBanner and TeslaAccountSection subscribe to the same document
//   event), the DOM event bus is replaced by an in-process subscriber registry
//   with identical fan-out semantics:
//     - subscribeTeslaAuthRecovered(listener) → unsubscribe   (native analog of
//       document.addEventListener / removeEventListener for the event)
//     - notifyTeslaAuthRecovered() notifies every current subscriber  (native
//       analog of document.dispatchEvent(new CustomEvent(...)))
//   The exact event-channel string `teslasync:tesla-auth-recovered` is exported
//   verbatim as TESLA_AUTH_RECOVERED_EVENT so a native TeslaReauthBanner port can
//   subscribe on the identical channel. Subscribers are snapshotted before
//   fan-out (mirroring DOM dispatch listener snapshotting) and each listener is
//   isolated in try/catch so one throwing listener cannot starve the rest. The
//   web `typeof document === 'undefined'` early-return (the "no event bus
//   available" branch) becomes "no subscribers registered" — a documented no-op,
//   the explicit unavailable state.
//
// No DOM (document / CustomEvent), window, Recharts, Leaflet, or web-UI import
// reaches the native output — this is plain TypeScript with zero imports, the
// browserCompat.ts precedent.

interface QueuedMutation {
  at: number;
  replay: () => Promise<unknown>;
}

const QUEUE: QueuedMutation[] = [];

/** Maximum number of pending mutations held during the disconnected window. */
export const TESLA_AUTH_QUEUE_MAX = 10;

/** Mutations older than this are dropped silently when the queue drains. */
export const TESLA_AUTH_QUEUE_TTL_MS = 5 * 60 * 1000;

/**
 * Native recovery event-channel name, preserved verbatim from the web DOM
 * CustomEvent type `teslasync:tesla-auth-recovered` (web source L10, L76, L85).
 * Exported so a native TeslaReauthBanner / TeslaAccountSection port subscribes on
 * the identical channel.
 */
export const TESLA_AUTH_RECOVERED_EVENT = 'teslasync:tesla-auth-recovered';

/** Listener invoked when {@link notifyTeslaAuthRecovered} fires. */
type TeslaAuthRecoveredListener = () => void;

// Native-safe replacement for the web `document` event bus. The web emitter
// (TeslaAccountSection) and consumer(s) (TeslaReauthBanner + TeslaAccountSection)
// are decoupled through document.addEventListener/dispatchEvent on the
// `teslasync:tesla-auth-recovered` channel; React Native has no document, so the
// same pub/sub fan-out lives in this in-process Set (the established
// useSidebarStyle `listeners` Set precedent).
const RECOVERED_LISTENERS = new Set<TeslaAuthRecoveredListener>();

/**
 * Adds a mutation replay closure to the queue. The closure should
 * re-invoke the original mutation with the user's original arguments
 * (typically `() => mutate(originalVariables)` from the hook's onError
 * callback).
 *
 * Drops the entry silently when the queue is full — the user has
 * already had visible error feedback for the original failure, and a
 * "queue full" toast on top of that would be noise.
 */
export function queueTeslaMutation(replay: () => Promise<unknown>): void {
  if (QUEUE.length >= TESLA_AUTH_QUEUE_MAX) {
    return;
  }
  QUEUE.push({ at: Date.now(), replay });
}

/**
 * Replays every queued mutation that is still within the TTL window, in
 * FIFO order. Resolves once every replay has settled (success or
 * failure); replay errors are swallowed because the underlying mutation
 * hook's own onError surfaces them again.
 *
 * Idempotent — calling repeatedly with no queued entries is a no-op.
 */
export async function drainQueuedTeslaMutations(): Promise<void> {
  if (QUEUE.length === 0) {
    return;
  }
  const now = Date.now();
  const drained = QUEUE.splice(0, QUEUE.length);
  const live = drained.filter(q => now - q.at <= TESLA_AUTH_QUEUE_TTL_MS);
  for (const item of live) {
    try {
      await item.replay();
    } catch {
      /* surfaces in the mutation's normal onError → toast path */
    }
  }
}

/**
 * Native analog of the web `document.addEventListener('teslasync:tesla-auth-
 * recovered', listener)`. Registers a listener that runs whenever
 * {@link notifyTeslaAuthRecovered} fires and returns an unsubscribe function
 * (the native analog of `document.removeEventListener`). A native
 * TeslaReauthBanner port wires `drainQueuedTeslaMutations` here.
 */
export function subscribeTeslaAuthRecovered(
  listener: TeslaAuthRecoveredListener,
): () => void {
  RECOVERED_LISTENERS.add(listener);
  return () => {
    RECOVERED_LISTENERS.delete(listener);
  };
}

/**
 * Emits the `teslasync:tesla-auth-recovered` event. Called by the
 * Tesla-account UI when an auth-status poll flips from `authenticated:
 * false` to `authenticated: true`, or when a manual refresh succeeds.
 *
 * The matching listeners live in {@link subscribeTeslaAuthRecovered} consumers
 * (the native TeslaReauthBanner port) which both hide the banner and trigger the
 * queue drain.
 *
 * Native-safe replacement for the web `document.dispatchEvent(new
 * CustomEvent('teslasync:tesla-auth-recovered'))` (source L84-85): React Native
 * has no `document`, so subscribers are notified through the in-process registry
 * instead. Listeners are snapshotted before fan-out (mirroring DOM dispatch) and
 * each is isolated in try/catch so one throwing listener cannot starve the rest.
 * With no subscribers registered this is a documented no-op — the explicit
 * unavailable state that replaces the web `typeof document === 'undefined'`
 * early return.
 */
export function notifyTeslaAuthRecovered(): void {
  if (RECOVERED_LISTENERS.size === 0) {
    return;
  }
  for (const listener of [...RECOVERED_LISTENERS]) {
    try {
      listener();
    } catch {
      /* one bad listener must not starve the rest — parity with DOM dispatch */
    }
  }
}

/**
 * Native-only flags documenting the explicit unavailable/replacement state for
 * the browser-only recovery event bus (contract rule 7). Mirrors the
 * `nativeVehicleCommandAuthRecovery` descriptor in useVehicleCommand.ts.
 */
export const nativeTeslaAuthRecovery = {
  documentEventBridgeAvailable: false,
  inProcessSubscriberBridgeAvailable: true,
  recoveredEvent: TESLA_AUTH_RECOVERED_EVENT,
} as const;

/** Test-only — wipes the queue. Not exported from the barrel. */
export function _resetTeslaAuthRecoveryQueue(): void {
  QUEUE.length = 0;
}

/** Test-only — current queue depth (does not drain). */
export function _peekTeslaAuthRecoveryQueueSize(): number {
  return QUEUE.length;
}

/** Test-only — clears the native recovery subscriber registry. */
export function _resetTeslaAuthRecoveredListeners(): void {
  RECOVERED_LISTENERS.clear();
}
