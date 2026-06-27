// Native parity port of web/src/lib/tourLauncher.ts.
//
// Tour launcher helper.
//
// Single entry point used by Settings, the command palette, and any other
// UI surface that wants to (re-)play a registered tour. Clears the per-tour
// completion flag (so the tour treats this as a fresh run) and triggers the
// tour state machine via `dispatchTourStart` (the existing `TOUR_START_EVENT`
// signal). Also broadcasts `tour.replay-requested` so peer surfaces of the same
// app stay in sync — `broadcast()` filters self-broadcasts so the local
// dispatch is what makes the current surface actually start.
//
// Why two delivery paths?
//
//   - `dispatchTourStart` → in-process `TOUR_START_EVENT` signal: same-surface,
//     synchronous, already wired into Layout via the `TOUR_START_EVENT`
//     listener that drives the local tour state machine. This is what drives
//     the local tour.
//   - `broadcast()` → cross-surface bus (BroadcastChannel/storage event on the
//     web build; host-injected/no-op on pure native): cross-surface, async.
//     `subscribe()` drops messages whose `_from === TAB_ID` (per the bus
//     contract in `broadcast.ts`), so the current surface will never see this
//     message — only sibling surfaces do. Layout subscribes to it and re-issues
//     the local start signal.
//
// ## Native conversion (contract rule 6)
//
// This is non-visual orchestration code: `startTour` simply sequences three
// already-ported sibling helpers. It touches no DOM, no browser HTML elements,
// no Recharts/Leaflet, and no web UI components, so the logic ports 1:1 with no
// behavioral change. Every browser-only seam (the `window` CustomEvent dispatch
// and the BroadcastChannel/localStorage transports) is already encapsulated by
// the native `tourRegistry`/`broadcast` parity ports, which keep real cross-tab
// parity on the react-native-web build and degrade to a documented no-op on pure
// native. `dispatchTourStart`/`resetTour` resolve to the sibling native
// tourRegistry port and `broadcast` to the sibling native broadcast port, both
// exposing the identical signatures used here.

import {broadcast} from './broadcast';
import {dispatchTourStart, resetTour} from './tourRegistry';

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
  resetTour(id);
  dispatchTourStart(id);
  broadcast({type: 'tour.replay-requested', tourId: id});
}
