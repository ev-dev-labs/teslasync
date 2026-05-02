package api

// ---------------------------------------------------------------------------
// DevTools log inspection / api-log endpoints
// ---------------------------------------------------------------------------
//
// Reservation file for log-inspection and api-log endpoints exposed under the
// devtools surface. The current devtools handler does not implement any
// log-reading endpoints (audit and api-log query endpoints live in their own
// handlers), so there is no existing top-level declaration to move into this
// file at this time.
//
// This file is created so that any future devtools endpoint that surfaces
// in-process log buffers, captured api-log rows, or structured log replays
// has a single well-known home instead of accreting back into
// devtools_handler.go.
//
// Mechanical-only contract for Phase 37 prompt 29: this split must not add or
// remove any exported identifiers from the api package. Adding new log
// endpoints would add identifiers and would be rejected by the gate's exports
// invariant check, so new endpoints are deferred to a follow-up phase that
// explicitly allows the change.
