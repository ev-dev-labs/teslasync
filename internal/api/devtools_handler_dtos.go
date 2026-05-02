package api

// ---------------------------------------------------------------------------
// DevTools request and response DTO types
// ---------------------------------------------------------------------------
//
// Reservation file for top-level request/response DTO types used by devtools
// endpoints. The current devtools handler defines all request and response
// payloads as inline anonymous struct literals inside each handler function
// body, so no top-level DTO declarations exist to move at this time.
//
// This file is created so that any future devtools DTO that is promoted from
// an inline anonymous struct to a named top-level type lands in a single
// well-known location instead of accreting back into devtools_handler.go.
//
// Mechanical-only contract for Phase 37 prompt 29: this split must not add or
// remove any exported identifiers from the api package. Moving an inline
// anonymous struct into a named top-level type would add an identifier and
// would be rejected by the gate's exports invariant check, so DTO promotions
// are deferred to a follow-up phase that explicitly allows the change.
