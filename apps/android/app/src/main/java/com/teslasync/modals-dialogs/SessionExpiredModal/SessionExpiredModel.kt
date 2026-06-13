// Pure, framework-free model + projection for the SessionExpiredModal modal/dialog — the native analogue of
// everything the web component derives before it returns JSX (web/src/components/feedback/SessionExpiredModal.tsx).
// No Compose, no Android, no HTTP: every declaration here is exercised off-device by the
// :android:testReleaseUnitTest gate, so the composable stays a thin render layer over these pure functions.
//
// The web component hard-blocks the UI when the upstream session has fully expired. It binds one data hook —
// `useSessionMonitor` — and reads exactly two of its fields, `mode` and `hasExpired`, plus a local
// `eventTriggered` latch driven by the `teslasync:session-expired` DOM event a 401 dispatches. Its render
// outcome is binary, computed in three lines:
//   1. `if (mode === 'open') return null` — suppressed entirely when the deployment has no auth provider,
//   2. `const open = hasExpired || eventTriggered` — otherwise the hard-block opens when the session expired,
//   3. when open, a non-dismissible modal whose only exit is the "Sign in again" re-auth handoff.
// Those are the complete states this surface has. It has NO cache-then-network lifecycle of its own (it owns no
// list/detail data), so modelling loading / empty / error / stale / offline phases here would invent behaviour
// the web spec does not have (drift) — exactly the reasoning the sibling ConfirmDialog surface records. The
// three branches the web source actually defines are projected here and unit-tested in full.
//
// Native data binding (P1/S8): the native counterpart of the web `useSessionMonitor` session holder is the
// OIDC auth state machine surfaced by `AuthController.uiState: StateFlow<AuthUiState>` (ADR-008). The native
// client always ships an auth provider, so it never reports the web's `mode === 'open'`; the projection still
// honours that branch verbatim for parity (and tests exercise it), while [sessionMonitorFrom] maps the live
// auth state onto the (mode, hasExpired) pair the projection consumes. The single state that means "a
// previously live session was invalidated, the user must sign in again" — [AuthUiState.ReauthRequired] — is the
// faithful native trigger for the hard block (it carries the same semantics and the same re-auth handoff as the
// web `hasExpired`). The transient [AuthUiState.Expired] (a silent token refresh is already in flight) is NOT a
// hard block; if that refresh fails the machine settles on ReauthRequired, so the native auth state subsumes
// BOTH web activation paths (the poll-based expiry and the 401 `session-expired` event) — which is why the
// composable always passes `eventTriggered = false` and there is no separate native event bus to invent.
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/modals-dialogs/SessionExpiredModal — the P3 prompt's allowed-files path) cannot form a valid
// Kotlin package (a hyphen and a PascalCase segment are illegal in a package identifier), so the package
// intentionally diverges from the path — exactly as the sibling modal/dialog + feature-view surfaces do.
// `MatchingDeclarationName` is suppressed for the co-located supporting declarations.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.modalsdialogs.sessionexpiredmodal

import io.teslasync.android.auth.AuthUiState
import io.teslasync.shared.core.diagnostics.Logger

/** Diagnostics + registry identifiers for the surface (P1/S11). */
object SessionExpiredRegistration {
    /** Stable surface id. */
    const val ID: String = "session-expired-modal"

    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). */
    const val SLUG: String = "SessionExpiredModal"
}

/**
 * Resolved deployment mode — the native mirror of the web `useSessionMonitor` `mode` field. The native client
 * always authenticates via OIDC, so it never reports [Open]; the value is retained for a faithful port of the
 * web's open-mode suppression and is exercised directly by the projection's unit tests.
 *
 * @property Open the deployment has no auth provider — the modal is suppressed (web `mode === 'open'`).
 * @property Session a session-backed deployment — the hard block is governed by `hasExpired` (web `'session'`).
 * @property Unknown the session state has not resolved yet (cold start) — never a hard block (web `'unknown'`).
 */
enum class SessionMonitorMode { Open, Session, Unknown }

/**
 * The two fields the web `SessionExpiredModal` reads from `useSessionMonitor`, captured as one pure carrier so
 * the projection takes plain data and stays trivially unit-testable.
 *
 * @property mode the resolved deployment mode (web `mode`).
 * @property hasExpired whether the session has fully expired and the user must re-authenticate (web `hasExpired`).
 */
data class SessionMonitorSnapshot(
    val mode: SessionMonitorMode,
    val hasExpired: Boolean,
)

/**
 * The fully projected, render-ready outcome — the native analogue of the web component's three-line render
 * decision. Pure data (no Compose types) so the projection is unit-tested without a UI host.
 *
 * @property suppressed the modal renders nothing because the deployment has no auth provider (web
 *   `mode === 'open' → return null`).
 * @property open the non-dismissible hard block is shown (web `hasExpired || eventTriggered`); always `false`
 *   while [suppressed].
 */
data class SessionExpiredDisplay(
    val suppressed: Boolean,
    val open: Boolean,
)

/**
 * Pure projection from the surface's inputs to its render-ready [SessionExpiredDisplay] — a 1:1 port of the web
 * component's render decision: the `mode === 'open'` suppression guard and the `hasExpired || eventTriggered`
 * open condition. No Compose, no side effects.
 */
object SessionExpiredProjection {
    /**
     * Projects the [snapshot] (+ the [eventTriggered] 401 latch) into the render-ready [SessionExpiredDisplay].
     *
     * @param snapshot the monitor fields the modal reads (web `{ mode, hasExpired }`).
     * @param eventTriggered the web `teslasync:session-expired` latch. The native auth state machine already
     *   reflects a failed 401 refresh as [AuthUiState.ReauthRequired], so the live composable passes `false`;
     *   the parameter is retained so the web's second activation path stays covered by the unit tests.
     */
    fun project(
        snapshot: SessionMonitorSnapshot,
        eventTriggered: Boolean,
    ): SessionExpiredDisplay {
        // Web `if (mode === 'open') return null` — suppressed before any open computation.
        if (snapshot.mode == SessionMonitorMode.Open) {
            return SessionExpiredDisplay(suppressed = true, open = false)
        }
        // Web `const open = hasExpired || eventTriggered`.
        return SessionExpiredDisplay(suppressed = false, open = snapshot.hasExpired || eventTriggered)
    }
}

/**
 * Maps the live OIDC auth surface [state] (P1/S8, `AuthController.uiState`) onto the [SessionMonitorSnapshot]
 * the projection consumes — the native bridge that stands in for the web `useSessionMonitor` hook.
 *
 * - [AuthUiState.ReauthRequired] is the one state meaning "a previously live session was invalidated; the user
 *   must sign in again" — the exact semantics of the web `hasExpired` hard block — so it maps to
 *   `hasExpired = true`.
 * - [AuthUiState.Authorizing] is the unresolved cold-start surface → [SessionMonitorMode.Unknown] (web
 *   `mode === 'unknown'`), never a hard block.
 * - every other state (authenticated, transparently refreshing, the transient token [AuthUiState.Expired]
 *   whose silent refresh is already in flight, a fresh sign-out, or a sign-in error) is not a fully expired
 *   session → `hasExpired = false`.
 */
fun sessionMonitorFrom(state: AuthUiState): SessionMonitorSnapshot {
    val mode = if (state == AuthUiState.Authorizing) SessionMonitorMode.Unknown else SessionMonitorMode.Session
    val hasExpired = state == AuthUiState.ReauthRequired
    return SessionMonitorSnapshot(mode = mode, hasExpired = hasExpired)
}

/**
 * Emits the one PII-safe `view.opened` diagnostic with the surface [SessionExpiredRegistration.SLUG] (P1/S11).
 * Carries only the slug — never any session token, expiry, or user identifier — so a diagnostics line can
 * never leak session state. Kept free of Compose so it is unit-tested with a recording [Logger]; the composable
 * calls it from its open-effect.
 */
fun recordSessionExpiredOpened(logger: Logger) {
    logger.info("view.opened", mapOf("surface" to SessionExpiredRegistration.SLUG))
}
