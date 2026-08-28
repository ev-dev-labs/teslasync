// Package fleetstatesvc is the use case behind the fleet-wide batch
// current-state read (GET /api/v1/vehicles/states).
//
// Layer: app
//
// It exists because the SPA previously issued ONE HTTP request per vehicle to
// build its fleet posture. At 100 vehicles and a 30-second poll that is 200
// requests a minute for a single open tab, each one repeating the same vehicle
// lookup, the same live-store round trip and the same FSM query. The batch
// collapses that into one request while keeping every per-vehicle fact —
// including the per-vehicle FAILURE facts — individually addressable.
//
// Design contract:
//
//   - ONE request-level `now`. Every vehicle in a response is classified
//     fresh/stale against the same instant, so two cars observed a
//     millisecond apart can never land on opposite sides of the freshness
//     boundary within one payload.
//   - Per-item isolation. A vehicle whose live read fails, times out, or
//     panics yields a `failed` item; it never fails the batch and never
//     removes the other vehicles from the answer.
//   - No internals on the wire. A failed item carries a stable machine code,
//     never a driver error string.
//   - No snapshot tables. Assembly goes through service.ResolveCurrentState,
//     which reads the L1/L2 live store plus the signal_log last-known-value
//     fallback (ADR-001 / ADR-007).
//   - Bulk storage reads. When the resolver exposes the bulk capability, the
//     batch takes ONE pipelined Redis read, ONE set-based signal_log query and
//     ONE set-based fsm_transitions query for the whole page instead of three
//     round trips per vehicle. The layering, the merge rule and every
//     per-vehicle verdict are unchanged — only the number of round trips is.
//   - Server-derived summary. Fleet Posture's totals are computed here, from
//     the same request-level `now` and the same trust precedence the items
//     use, so the panel cannot disagree with the list it summarises.
//   - Coalesced identical reads. Concurrent identical requests share one
//     execution and a 1–2s successful-result micro-cache; failures are never
//     cached and every caller receives its own deep copy.
package fleetstatesvc
