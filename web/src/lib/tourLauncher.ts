/**
 * Tour launcher helper — Phase-46 / Prompt 61.
 *
 * Single entry point used by Settings, the command palette, and any other
 * UI surface that wants to (re-)play a registered tour. Clears the per-tour
 * completion flag (so the tour treats this as a fresh run) and triggers
 * Layout's tour state machine via the existing `TOUR_START_EVENT` window
 * CustomEvent. Also broadcasts `tour.replay-requested` so peer tabs of the
 * same SPA stay in sync — `broadcast()` filters self-broadcasts so the
 * window event is what makes the local tab actually start.
 *
 * Why two delivery paths?
 *
 *   - `dispatchTourStart` → window CustomEvent: same-tab, synchronous,
 *     already wired into Layout via `TOUR_START_EVENT` listener since
 *     Phase-40 / Prompt 65. This is what drives the local tour.
 *   - `broadcast()` → BroadcastChannel/storage event: cross-tab, async.
 *     `subscribe()` drops messages whose `_from === TAB_ID` (per the bus
 *     contract in `broadcast.ts`), so the local tab will never see this
 *     message — only sibling tabs do. Layout subscribes to it and
 *     re-issues the local window event.
 */

import { broadcast } from './broadcast'
import { dispatchTourStart, resetTour } from './tourRegistry'

/**
 * Launches (or relaunches) a registered tour by id. Safe to call from any
 * UI surface; the Layout owns the actual tour state machine and will pick
 * up the request via the existing `TOUR_START_EVENT` listener.
 *
 * @param id  The tour id from the registry (`'main'`, `'debugger'`,
 *            `'automations'`, etc). Unknown ids are still broadcast and
 *            dispatched — Layout's listener guards against unknown ids and
 *            simply ignores them, so an outdated caller doesn't crash.
 */
export function startTour(id: string): void {
  resetTour(id)
  dispatchTourStart(id)
  broadcast({ type: 'tour.replay-requested', tourId: id })
}
