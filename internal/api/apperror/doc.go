// Package apperror is the canonical home for the TeslaSync API's structured
// application-error catalog and the wire-out helper that emits it.
//
// Layer: handler
//
// # Why this subpackage exists
//
// Before Phase R2.0e (2026-05-28) AppError + the 50+ pre-constructed Err*
// vars + ErrorCatalog() + writeAppError lived inside the flat
// internal/api parent. That worked when every handler was a top-level
// function in internal/api, but the R2a–R2e wave migrations need each
// resource handler (backup, geofence, vehicles, …) to live in its own
// subpackage. Those subpackages cannot import internal/api (the parent
// imports them to construct routes — that would be a cycle), so the
// AppError catalog has to move into a sibling subpackage that BOTH the
// parent and every resource subpkg can import.
//
// helpers.go anticipated this with a literal TODO:
// "A dedicated future carve is expected to land the AppError catalog at
// internal/api/apierr." This is that carve.
//
// # Exported surface
//
//   - AppError                        — structured error with Code, Status,
//     Message, Category.
//   - WithMessage(*AppError, string)  — method on *AppError; returns a
//     copy with a custom message.
//   - ErrCat*                         — 14 category constants (Auth,
//     Vehicle, Database, Validation,
//     Backup, Geofence, Tesla API, …).
//   - ErrCodeAuthModeOpen             — the AUTH_MODE_OPEN sentinel that
//     the SPA's auth-coupled hooks
//     (useAuthMode, useTOTP, useSessions,
//     useImpersonation, useRbacMatrix)
//     match against to render the
//     "feature requires authentication"
//     placeholder. Mirrored as
//     internal/auth.AuthModeOpenCode.
//   - ~50 Err* pre-constructed vars   — every catalog entry. Treat as
//     immutable: do NOT reassign or
//     mutate fields through these
//     pointers; WithMessage returns a
//     fresh copy.
//   - ErrorCatalog() []*AppError      — the union for /admin/errors.
//   - Write(w, r, err *AppError)      — write the JSON response + bump
//     the Prometheus APIErrors counter
//   - record into the optional
//     Tracker. Single source of truth
//     for the structured-error wire shape.
//   - Tracker / SetTracker            — atomic.Value-backed singleton so
//     NewRouter can hand the parent's
//     ErrorTracker into Write's pipeline
//     without a cycle and without races.
//
// # Wire-shape contract
//
// Write emits the SAME flat envelope shape as the rest of internal/api:
//
//	{"error": "<message>", "code": "<CODE>", "category": "<category>"}
//
// at the AppError's pre-declared Status. The frontend's resilience layer
// (web/src/lib/resilience.ts) byte-matches `code` to drive recovery flows
// (e.g. TESLA_TOKEN_EXPIRED triggers re-auth; AUTH_MODE_OPEN triggers the
// auth-required placeholder). Adding a new Err* entry MUST keep `code`
// SCREAMING_SNAKE_CASE and stable — these are public-API identifiers.
//
// # Tracker indirection
//
// internal/api/error_tracker.go owns the concrete *ErrorTracker that
// aggregates errors for the /admin/errors endpoint. It is a
// parent-bound type and cannot move here without dragging the admin
// handler + its DB queries along. Instead we expose a one-method Tracker
// interface, store the active tracker in an atomic.Value, and wire it
// once from NewRouter via SetTracker(errorTracker). The interface lives
// here; the concrete implementation stays in the parent.
//
// # Stability
//
// This catalog is part of the public HTTP contract. Adding a new Err*
// entry is fine. Removing or renaming one is a wire-break and needs
// frontend coordination + the SPA's resilience.ts match list refresh.
package apperror
