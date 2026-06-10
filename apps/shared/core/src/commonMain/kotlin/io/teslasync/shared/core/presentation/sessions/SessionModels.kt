package io.teslasync.shared.core.presentation.sessions

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

/**
 * One active device session — the cross-platform port of the web `ActiveSession` interface
 * (web/src/api/types.ts). Keys arrive snake_case from `GET /api/v1/auth/sessions`; they are matched
 * verbatim via [SerialName] so the cached payload round-trips unchanged.
 *
 * [id], [userAgent], [ip], [createdAt], [lastSeenAt], and [current] are always present; [revokedAt]
 * is only carried for a row that has been signed out. No field is unit-bearing, so there is no SI
 * conversion at this layer — display formatting (relative times, user-agent prettifying) is the
 * render boundary's job (S5).
 *
 * @property id the opaque session identifier (used as the revoke path segment).
 * @property userAgent the raw `User-Agent` captured when the session was created.
 * @property ip the client IP captured when the session was created.
 * @property createdAt ISO-8601 timestamp the session was first established.
 * @property lastSeenAt ISO-8601 timestamp the session was last observed active.
 * @property revokedAt ISO-8601 timestamp the session was revoked; `null` while still active.
 * @property current whether this row is the request's own session (never offered for revoke in UI).
 */
@Serializable
public data class ActiveSession(
    val id: String,
    @SerialName("user_agent") val userAgent: String,
    val ip: String,
    @SerialName("created_at") val createdAt: String,
    @SerialName("last_seen_at") val lastSeenAt: String,
    @SerialName("revoked_at") val revokedAt: String? = null,
    val current: Boolean = false,
)

/**
 * The discriminated result of the sessions list read — the cross-platform port of the web
 * `ActiveSessionsResponse` union (web/src/api/types.ts):
 *  - [Open] mirrors `{ mode: 'open' }`: the deployment runs without a forward-auth header so
 *    per-device sessions cannot be tracked. The web hook normalises the backend's 501
 *    `AUTH_MODE_OPEN` sentinel to this value and treats it as a *successful* no-op (not an error)
 *    so the section can render an inline "requires forward-auth" empty state; the S7 repository
 *    reproduces that mapping.
 *  - [Session] mirrors `{ mode: 'session', sessions: [...] }`: the active rows (possibly empty).
 *
 * Annotated [Serializable] with stable [SerialName] discriminators so the value can round-trip
 * through the offline cache (ADR-013) independently of the wire shape.
 */
@Serializable
public sealed interface ActiveSessionsResponse {
    /** The deployment is in open mode — sessions cannot be tracked (web `{ mode: 'open' }`). */
    @Serializable
    @SerialName("open")
    public data object Open : ActiveSessionsResponse

    /** The active session rows (web `{ mode: 'session', sessions }`); always an array, never null. */
    @Serializable
    @SerialName("session")
    public data class Session(
        val sessions: List<ActiveSession>,
    ) : ActiveSessionsResponse
}

/**
 * The DELETE `/auth/sessions/all-others` response — the cross-platform port of the web
 * `RevokeAllOthersResponse` interface (web/src/api/types.ts). [revoked] is the count of rows the
 * backend signed out, surfaced so callers can confirm how many devices were affected.
 *
 * @property mode always `session` (the route only exists in forward-auth mode); carried verbatim.
 * @property revoked the number of other sessions that were revoked by this call.
 */
@Serializable
public data class RevokeAllOthersResponse(
    val mode: String = "session",
    val revoked: Int = 0,
)

/**
 * The raw `GET /auth/sessions` body before the SPA reshapes it — the port of the web
 * `SessionListPayload` interface. The handler always sends `{ mode: 'session', sessions }`; the open
 * path is signalled out-of-band by the 501 `AUTH_MODE_OPEN` error, never in this body. [sessions] is
 * nullable on the wire and normalised to an empty list by [SessionsDerivations.sessionResponse]
 * (the web `sessions ?? []`).
 */
@Serializable
internal data class SessionListPayload(
    val mode: String = "session",
    val sessions: List<ActiveSession>? = null,
)
