package io.teslasync.shared.core.presentation.impersonation

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull

/**
 * The discriminated impersonation state — the cross-platform port of the web `ImpersonationStatus`
 * union (web/src/api/types.ts), surfaced by `useImpersonationStatus`
 * (web/src/api/hooks/useImpersonation.ts). The wire `mode` string is the discriminator, matched
 * (not enum-decoded) exactly as the web union compares against the literals, so an unknown/future
 * mode degrades to the safe [Inactive] rendering rather than failing the read.
 *
 *  - [Open] mirrors `{ mode: 'open' }`: the deployment runs in open (no-forward-auth) mode, where
 *    every impersonation endpoint answers `501 AUTH_MODE_OPEN`. The web hook normalises that 501
 *    into this value so the banner/button render their "feature requires forward-auth" empty state
 *    without treating it as an error; the data layer reproduces that by mapping the
 *    `AUTH_MODE_OPEN` code to an open sentinel that reads as a successful no-op.
 *  - [Inactive] mirrors `{ mode: 'inactive' }`: forward-auth mode, no impersonation cookie active.
 *  - [Active] mirrors `{ mode: 'active', original_admin, target, expires_at }`: currently
 *    impersonating; the three subject/expiry fields default to `""` exactly as the web hook
 *    coalesces each missing value with `?? ''`.
 *
 * None of the fields are display-unit-bearing, so the value round-trips verbatim with no SI
 * conversion (S5).
 */
public sealed interface ImpersonationStatus {
    /** The verbatim wire discriminator (`open` | `inactive` | `active`). */
    public val mode: String

    /** Open (no-forward-auth) deployment: the impersonation feature is unavailable. */
    public data object Open : ImpersonationStatus {
        override val mode: String get() = OPEN
    }

    /** Forward-auth deployment with no impersonation cookie active. */
    public data object Inactive : ImpersonationStatus {
        override val mode: String get() = INACTIVE
    }

    /**
     * An active impersonation session.
     *
     * @property originalAdmin the admin who started the session (web `original_admin ?? ''`).
     * @property target the subject being impersonated (web `target ?? ''`).
     * @property expiresAt RFC3339 cookie expiry (web `expires_at ?? ''`).
     */
    public data class Active(
        public val originalAdmin: String,
        public val target: String,
        public val expiresAt: String,
    ) : ImpersonationStatus {
        override val mode: String get() = ACTIVE
    }

    public companion object {
        public const val OPEN: String = "open"
        public const val INACTIVE: String = "inactive"
        public const val ACTIVE: String = "active"
    }
}

/**
 * One row in the impersonation candidates list — the port of the web `ImpersonationCandidate`
 * interface. [subject] is the opaque proxy-issued identity, rendered verbatim because a future
 * display-name column may be added without changing this contract.
 */
@Serializable
public data class ImpersonationCandidate(
    @SerialName("subject") public val subject: String,
)

/**
 * The discriminated candidates response — the port of the web `ImpersonationCandidatesResponse`
 * union, surfaced by `useImpersonationCandidates`. [Open] mirrors `{ mode: 'open' }` (the same 501
 * normalisation as [ImpersonationStatus.Open]); [Session] mirrors
 * `{ mode: 'session', candidates }`, whose list defaults to empty exactly as the web hook coalesces
 * the payload with `candidates ?? []`.
 */
public sealed interface ImpersonationCandidatesResponse {
    /** The verbatim wire discriminator (`open` | `session`). */
    public val mode: String

    /** Open (no-forward-auth) deployment: candidates cannot be listed. */
    public data object Open : ImpersonationCandidatesResponse {
        override val mode: String get() = ImpersonationStatus.OPEN
    }

    /**
     * Forward-auth deployment: the distinct subjects the calling admin could impersonate,
     * EXCLUDING themselves. An empty list is a valid single-subject install (the web hides the
     * "Impersonate" button in that case).
     *
     * @property candidates the impersonatable subjects (web `candidates ?? []`).
     */
    public data class Session(
        public val candidates: List<ImpersonationCandidate>,
    ) : ImpersonationCandidatesResponse {
        override val mode: String get() = SESSION
    }

    public companion object {
        public const val SESSION: String = "session"
    }
}

/**
 * The `POST /admin/impersonate` body — the port of the web `ImpersonationStartRequest`. Carries the
 * single [subject] to impersonate; serialized to `{"subject":"…"}` byte-for-byte with the web
 * `JSON.stringify(body)`.
 */
@Serializable
public data class ImpersonationStartRequest(
    @SerialName("subject") public val subject: String,
)

/**
 * Pure, side-effect-free derivations ported from the web `useImpersonation` hook domain
 * (web/src/api/hooks/useImpersonation.ts). Extracted so the KMP data port, its golden vectors, and
 * the future Windows C# port all derive identically (ADR-004) and can never drift.
 *
 * Two derivations parse the raw server envelope into the discriminated state ([status],
 * [candidates]); the other two are the web convenience predicates (`isImpersonationOpenMode`,
 * `isImpersonationActive`) that fold an already-resolved state. Every parser is total — a missing
 * or malformed envelope degrades to the safe value (Inactive / empty Session) rather than throwing,
 * mirroring the web hooks treating a non-`active` body as inactive and `candidates ?? []`.
 */
public object ImpersonationDerivations {
    /**
     * The sentinel error `code` the backend returns (inside a `501`) for every impersonation
     * endpoint in open mode — mirrored verbatim from `impersonate_handler.AuthModeOpenCode` so the
     * data layer matches it without snake-vs-camel drift. Treated as "feature unavailable", NOT an
     * error: it is mapped to the open sentinel that reads as a successful no-op.
     */
    public const val AUTH_MODE_OPEN_CODE: String = "AUTH_MODE_OPEN"

    /**
     * Parses the `GET /admin/impersonate` (or `POST` success) envelope into an
     * [ImpersonationStatus]. An `active` mode yields [ImpersonationStatus.Active] with each
     * subject/expiry field coalesced to `""`; the `open` sentinel yields [ImpersonationStatus.Open];
     * anything else (including a body the web hook would treat as not-active) yields
     * [ImpersonationStatus.Inactive] — verbatim with the web `queryFn`'s
     * `payload.mode === 'active' ? … : { mode: 'inactive' }` branch plus its 501 open mapping.
     */
    public fun status(payload: JsonElement): ImpersonationStatus {
        val obj = payload as? JsonObject ?: return ImpersonationStatus.Inactive
        return when (modeOf(obj)) {
            ImpersonationStatus.ACTIVE ->
                ImpersonationStatus.Active(
                    originalAdmin = stringOf(obj, "original_admin"),
                    target = stringOf(obj, "target"),
                    expiresAt = stringOf(obj, "expires_at"),
                )
            ImpersonationStatus.OPEN -> ImpersonationStatus.Open
            else -> ImpersonationStatus.Inactive
        }
    }

    /**
     * Parses the `GET /admin/impersonate/candidates` envelope into an
     * [ImpersonationCandidatesResponse]. The `open` sentinel yields
     * [ImpersonationCandidatesResponse.Open]; anything else yields
     * [ImpersonationCandidatesResponse.Session] whose list is the parsed `candidates` array (each
     * row's `subject`), defaulting to empty when the key is absent — verbatim with the web `queryFn`
     * returning `{ mode: 'session', candidates: payload.candidates ?? [] }`.
     */
    public fun candidates(payload: JsonElement): ImpersonationCandidatesResponse {
        val obj = payload as? JsonObject ?: return ImpersonationCandidatesResponse.Session(emptyList())
        if (modeOf(obj) == ImpersonationStatus.OPEN) return ImpersonationCandidatesResponse.Open
        val rows =
            (obj["candidates"] as? JsonArray)
                ?.mapNotNull { element ->
                    val subject = (element as? JsonObject)?.let { stringOrNull(it, "subject") }
                    subject?.let { ImpersonationCandidate(it) }
                }
                ?: emptyList()
        return ImpersonationCandidatesResponse.Session(rows)
    }

    /**
     * `true` when [status] is the open-mode value — the web `isImpersonationOpenMode`. A `null`
     * (not-yet-resolved) state is `false`, mirroring the web `status?.mode === 'open'`.
     */
    public fun isImpersonationOpenMode(status: ImpersonationStatus?): Boolean = status is ImpersonationStatus.Open

    /**
     * `true` when [status] is an active session (the banner should be visible) — the web
     * `isImpersonationActive`. A `null` state is `false`, mirroring `status?.mode === 'active'`.
     */
    public fun isImpersonationActive(status: ImpersonationStatus?): Boolean = status is ImpersonationStatus.Active

    private fun modeOf(obj: JsonObject): String? = stringOrNull(obj, "mode")

    private fun stringOf(
        obj: JsonObject,
        key: String,
    ): String = stringOrNull(obj, key) ?: ""

    private fun stringOrNull(
        obj: JsonObject,
        key: String,
    ): String? = (obj[key] as? JsonPrimitive)?.contentOrNull
}
