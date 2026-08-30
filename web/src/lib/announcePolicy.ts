/**
 * Announcement governance policy (A11Y-05).
 *
 * `announce()` in `@/hooks/useAnnouncer` is a dumb pipe: whatever you
 * hand it lands in a live region immediately. That is correct for a
 * one-shot "3 drives archived", but it is actively hostile for the
 * places this app actually needs live regions:
 *
 * - **Telemetry streams.** `useVehicleLive` can push several frames a
 *   second. Announcing each one turns a screen reader into a
 *   metronome and buries every other message on the page.
 * - **Query refresh loops.** TanStack Query refetches on focus, on
 *   interval, and on reconnect. A naive "Data refreshed" announcement
 *   fires on every one of those.
 * - **Duplicate errors.** Three panels on the same page failing the
 *   same request produce three identical "Could not refresh" strings
 *   back-to-back.
 *
 * This module is the pure, framework-free decision layer that sits in
 * front of the live region. It answers exactly one question — *should
 * this message be spoken right now, dropped, or deferred?* — so the
 * behaviour can be unit-tested without mounting React or a live
 * region.
 *
 * Decision model
 * --------------
 * Every request carries a `key` identifying the *logical channel*
 * (e.g. `stream:vehicle-live`, `refresh-error:drives`). Governance is
 * per-key, so a noisy telemetry channel can never starve a save
 * confirmation.
 *
 * For each request the policy returns one of:
 *
 * - `speak`   — emit immediately, record the timestamp.
 * - `drop`    — identical text within the dedupe window; say nothing.
 * - `defer`   — the channel spoke too recently, but the text is NEW.
 *               The caller should schedule a trailing emit after
 *               `delayMs`. Later `defer` results on the same key
 *               replace the pending text (coalescing), so a stream
 *               that changes 40 times in a second speaks once with
 *               the final value.
 *
 * `drop` is deliberately checked BEFORE the rate limit: repeating the
 * exact same sentence is never useful, no matter how much time has
 * passed within the window.
 */

/** Outcome of a governance decision. */
export type AnnounceDecisionKind = 'speak' | 'drop' | 'defer';

export interface AnnounceDecision {
  kind: AnnounceDecisionKind;
  /**
   * For `defer`, how long the caller should wait before emitting the
   * (possibly superseded) text. Zero for `speak` / `drop`.
   */
  delayMs: number;
  /** Why the policy decided this. Surfaced in tests and dev logging. */
  reason: 'new' | 'duplicate' | 'rate-limited';
}

export interface AnnounceGovernanceOptions {
  /**
   * Logical channel. Governance state is tracked per key, so unrelated
   * announcements never throttle each other.
   */
  key: string;
  /**
   * Identical text on the same key inside this window is dropped.
   * Defaults to 4000 ms — long enough to swallow a burst of duplicate
   * error announcements from sibling panels, short enough that a user
   * re-running the same action still hears confirmation.
   */
  dedupeWindowMs?: number;
  /**
   * Minimum gap between two spoken messages on the same key. New text
   * arriving inside the gap is deferred (and coalesced), not dropped.
   * Defaults to 1000 ms.
   */
  minIntervalMs?: number;
}

/** Defaults chosen for ordinary UI events (saves, loads, bulk results). */
export const DEFAULT_DEDUPE_WINDOW_MS = 4000;
export const DEFAULT_MIN_INTERVAL_MS = 1000;

/**
 * Stream-grade governance. Telemetry channels reconnect, drop, and
 * re-emit constantly; a 10 s floor keeps "Live data resumed" useful
 * without narrating every frame.
 */
export const STREAM_MIN_INTERVAL_MS = 10_000;
export const STREAM_DEDUPE_WINDOW_MS = 30_000;

interface ChannelState {
  lastText: string;
  lastTextAt: number;
  lastSpokeAt: number;
}

const channels = new Map<string, ChannelState>();

/**
 * Decide whether `text` may be announced on `key` right now.
 *
 * Calling this function COMMITS the decision — a `speak` result
 * updates the channel's last-spoken timestamp. Callers must therefore
 * only call it when they genuinely intend to emit, and must honour a
 * `defer` result by re-calling {@link commitDeferredAnnouncement} when
 * the timer fires.
 *
 * @param text - The exact sentence that would be spoken. Empty and
 *   whitespace-only strings always `drop`.
 * @param options - Channel key plus optional window overrides.
 * @param now - Injectable clock for tests. Defaults to `Date.now()`.
 */
export function decideAnnouncement(
  text: string,
  options: AnnounceGovernanceOptions,
  now: number = Date.now(),
): AnnounceDecision {
  const trimmed = text.trim();
  if (!trimmed) {
    return { kind: 'drop', delayMs: 0, reason: 'duplicate' };
  }

  const dedupeWindowMs = options.dedupeWindowMs ?? DEFAULT_DEDUPE_WINDOW_MS;
  const minIntervalMs = options.minIntervalMs ?? DEFAULT_MIN_INTERVAL_MS;
  const state = channels.get(options.key);

  if (state && state.lastText === trimmed && now - state.lastTextAt < dedupeWindowMs) {
    return { kind: 'drop', delayMs: 0, reason: 'duplicate' };
  }

  if (state && now - state.lastSpokeAt < minIntervalMs) {
    return {
      kind: 'defer',
      delayMs: Math.max(0, minIntervalMs - (now - state.lastSpokeAt)),
      reason: 'rate-limited',
    };
  }

  channels.set(options.key, {
    lastText: trimmed,
    lastTextAt: now,
    lastSpokeAt: now,
  });
  return { kind: 'speak', delayMs: 0, reason: 'new' };
}

/**
 * Record that a previously-deferred message has now been emitted.
 *
 * Separated from {@link decideAnnouncement} because the deferred text
 * may have been superseded while the timer was pending — the caller
 * emits the LATEST text, and tells the policy which text actually got
 * spoken so the dedupe window tracks reality.
 */
export function commitDeferredAnnouncement(
  key: string,
  text: string,
  now: number = Date.now(),
): void {
  channels.set(key, {
    lastText: text.trim(),
    lastTextAt: now,
    lastSpokeAt: now,
  });
}

/**
 * Test-only. Clears all per-channel governance state so each test
 * starts from a clean slate.
 */
export function __resetAnnouncePolicyForTests(): void {
  channels.clear();
}
