/**
 * Live-connection announcements (A11Y-06).
 *
 * `<LiveIndicator>` communicates the health of the SSE pipe with colour
 * and an icon. Both are invisible to a screen-reader user, so when the
 * wire drops they keep reading numbers that stopped updating minutes
 * ago — the single most dangerous failure mode in a telemetry UI,
 * because stale data looks exactly like fresh data.
 *
 * This hook turns the indicator's state machine into speech. It is
 * separate from the indicator itself so the announcement policy can be
 * unit-tested without rendering, and so other surfaces (the status-bar
 * segment, the stale-data banner) can opt in without duplicating the
 * transition logic.
 *
 * Chatter control
 * ---------------
 * A flapping connection can cycle connected → reconnecting → connected
 * several times a minute. Three defences keep that from becoming a
 * metronome:
 *
 * 1. **Edge-triggered.** Only a CHANGE of status is a candidate for
 *    announcement; re-renders (heartbeats tick the hook every few
 *    seconds) never speak.
 * 2. **No opening statement.** The status at mount is recorded, not
 *    announced — otherwise every page load would say "Live data
 *    connected" before the user has done anything.
 * 3. **Stream-grade governance.** The message is routed through
 *    `announceStreamState`, which enforces a 10 s floor and a 30 s
 *    dedupe window per channel, so even a hard flap speaks at most
 *    once per interval.
 *
 * Recovery is announced politely; a confirmed disconnect interrupts,
 * because continuing to read stale telemetry is a correctness problem
 * rather than a cosmetic one.
 */

import { useEffect, useRef } from 'react';
import { useStatusAnnouncer } from './useStatusAnnouncer';
import type { LiveConnectionStatus } from './useLiveConnection';

/** Statuses that carry no information worth speaking. */
const SILENT: ReadonlySet<LiveConnectionStatus> = new Set(['unknown']);

/**
 * Narrow the connection status to the subset the announcer can speak.
 *
 * `unknown` is the indicator's "not resolved yet" state — a rendering
 * detail, not an event. The remaining three overlap by name with
 * `StreamAnnounceState`, whose wider `updated` member has no connection
 * analogue, so the predicate targets the intersection explicitly.
 */
function isSpeakable(
  status: LiveConnectionStatus,
): status is Exclude<LiveConnectionStatus, 'unknown'> {
  return !SILENT.has(status);
}

export interface ConnectionAnnouncementOptions {
  /**
   * Scope name for the announcement, already translated (e.g. "Vehicle
   * telemetry"). Also the governance channel key, so two independent
   * streams never throttle each other. Defaults to the generic "Live
   * data" wording inside `useStatusAnnouncer`.
   */
  label?: string;
  /** Set false to mute (e.g. a hidden or duplicated indicator). */
  enabled?: boolean;
}

export function useConnectionAnnouncement(
  status: LiveConnectionStatus,
  { label, enabled = true }: ConnectionAnnouncementOptions = {},
): void {
  const { announceStreamState } = useStatusAnnouncer();
  const previous = useRef<LiveConnectionStatus | null>(null);

  useEffect(() => {
    const prior = previous.current;
    previous.current = status;

    if (!enabled) return;
    // Mount: record, never speak. The user did not just lose anything.
    if (prior === null) return;
    if (prior === status) return;
    if (!isSpeakable(status)) return;
    // Coming back from "unknown" is the indicator resolving its initial
    // state, not a recovery event.
    if (prior === 'unknown') return;

    announceStreamState(status, label);
  }, [status, label, enabled, announceStreamState]);
}
