package io.teslasync.shared.core.presentation.sessions

/**
 * Pure, side-effect-free derivations the web `useSessions` hook applies client-side
 * (web/src/api/hooks/useSessions.ts). Extracted so the KMP state holder, its golden vectors, and the
 * future Windows C# port all derive identically (ADR-004) and can never drift.
 *
 * Two web behaviours live here:
 *  - [sessionResponse] mirrors the hook's `{ mode: 'session', sessions: payload.sessions ?? [] }`:
 *    a `null`/missing list normalises to an empty list and the row order is preserved verbatim
 *    (the hook applies no sort/filter — revoked rows stay in place).
 *  - [AUTH_MODE_OPEN_CODE] is the sentinel error `code` the hook maps to [ActiveSessionsResponse.Open]
 *    instead of surfacing as an error; the S7 repository performs the actual catch.
 */
public object SessionsDerivations {
    /**
     * Sentinel error code mirrored from `session_handler.AuthModeOpenCode` — treated as a
     * "feature unavailable" signal, NOT an error, exactly as the web `AUTH_MODE_OPEN_CODE` constant.
     */
    public const val AUTH_MODE_OPEN_CODE: String = "AUTH_MODE_OPEN"

    /**
     * Normalises the raw wire session list into [ActiveSessionsResponse.Session], defaulting a
     * `null`/absent list to empty (the web `payload.sessions ?? []`) and preserving order verbatim.
     */
    public fun sessionResponse(sessions: List<ActiveSession>?): ActiveSessionsResponse.Session =
        ActiveSessionsResponse.Session(sessions ?: emptyList())

    /** The open-mode value the web hook substitutes for the 501 `AUTH_MODE_OPEN` response. */
    public val openResponse: ActiveSessionsResponse get() = ActiveSessionsResponse.Open
}
