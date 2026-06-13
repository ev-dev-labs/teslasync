// Pure, framework-free model + projection for the SessionExpiringModal modal/dialog — the native analogue of
// everything the web component derives before it returns JSX
// (web/src/components/feedback/SessionExpiringModal.tsx). No Compose, no Android, no HTTP: every declaration
// here is exercised off-device by the :android:testReleaseUnitTest gate, so the composable stays a thin render
// layer over these pure functions.
//
// The web component pops up ~60 seconds before the upstream ForwardAuth cookie expires, with a live countdown
// and two affordances: "Stay signed in" (re-polls /auth/session, which sliding-session proxies treat as the
// renewal) and "Sign out now" (hands off to the identity provider). It binds a single data source —
// `useSessionMonitor` — plus `useTranslation`. On native there is no ForwardAuth cookie: the session is the
// OIDC access token (`AuthService`/`AuthState`), whose absolute `expiresAtEpochSeconds` is the faithful
// analogue of the proxy's cookie expiry. [deriveSessionExpiry] is the native port of the hook's
// `deriveSessionState`; the app shell that owns the monitor + the 1 Hz clock feeds the resulting
// [SessionExpiryState] to the surface (the data lifecycle lives on the OWNING surface, exactly like the sibling
// ConfirmDialog / IncidentForm dialogs — see SessionExpiringModal.kt).
//
// States: the web source defines visibility branches only. The modal renders nothing unless
// `mode === 'session' && isExpiringSoon && !hasExpired` ([isOpen]); open-mode, not-expiring, and the
// hard-expired hand-off to SessionExpiredModal all hide it. When visible it has four sub-branches the render
// layer reproduces: no drafts, drafts ≤ the display limit, drafts over the limit (`+N more`), and the in-flight
// "refreshing" state. The generic loading / empty / error / stale / offline chrome is intentionally absent: the
// expiry is read from the locally-stored OIDC token (no fetch in the view), so there is no fetch loading/error/
// offline/stale surface to render — reproducing one would invent behaviour the web spec does not have (drift).
// The "empty" branch is the no-drafts case ([DraftProjection.visible] empty -> the drafts panel is omitted).
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/modals-dialogs/SessionExpiringModal — the P3 prompt's allowed-files path) cannot form a valid
// Kotlin package (a hyphen and a PascalCase segment are illegal in a package identifier), so the package
// intentionally diverges from the path — exactly as the sibling surfaces do. `MatchingDeclarationName` is
// suppressed for the co-located supporting declarations.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.modalsdialogs.sessionexpiringmodal

import io.teslasync.shared.core.diagnostics.Logger

/** Diagnostics + registry identifiers for the surface (P1/S11). */
object SessionExpiringRegistration {
    /** Stable surface id. */
    const val ID: String = "session-expiring-modal"

    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). */
    const val SLUG: String = "SessionExpiringModal"
}

/** The window (in seconds) before expiry at which the modal opens — the web `SESSION_EXPIRING_THRESHOLD_S`. */
const val SESSION_EXPIRING_THRESHOLD_S: Long = 60L

/** How many drafts the panel lists before collapsing the remainder into a `+N more` row (web `slice(0, 5)`). */
const val DRAFT_DISPLAY_LIMIT: Int = 5

private const val SECONDS_PER_MINUTE: Long = 60L

// The single positional argument token the generated i18n catalog (P1/S10) uses in the countdown body
// (`...%1$s.`) and the overflow row (`+%1$s more`). Substituted at the render boundary by [applyArg].
private const val ARG_TOKEN: String = "%1\$s"

/**
 * Resolved deployment mode — the native port of the web `SessionInfo.mode` plus the hook's `'unknown'`
 * pending state.
 *
 * - [Open]: no auth provider is configured; session timeout does not apply and the modal never opens.
 * - [Session]: a forward-auth / OIDC session is active and may expire.
 * - [Unknown]: the monitor has not resolved a snapshot yet (web `!data`).
 */
enum class SessionMode { Open, Session, Unknown }

/**
 * The raw session snapshot the host feeds the adapter — the native analogue of the web `SessionInfo` the
 * `useSessionMonitor` query returns. On native it is projected from the OIDC `AuthState`/`TokenSet`.
 *
 * @property mode the resolved deployment mode.
 * @property authenticated whether the session is currently authenticated (web `SessionInfo.authenticated`).
 * @property expiresAtEpochSeconds absolute token expiry (seconds since epoch); `null` when unavailable. The
 *   preferred source — clock-skew-safe relative to a static remaining-seconds snapshot (web `expires_at`).
 * @property expiresInFallbackSeconds the server-/issuer-computed remaining-seconds snapshot used when
 *   [expiresAtEpochSeconds] is absent (web `expires_in` fallback).
 */
data class SessionSnapshot(
    val mode: SessionMode,
    val authenticated: Boolean,
    val expiresAtEpochSeconds: Long?,
    val expiresInFallbackSeconds: Long? = null,
)

/**
 * The derived monitor state the modal consumes — the native port of the `useSessionMonitor` return shape the
 * web component reads. Pure data (no Compose types) so [SessionExpiringProjection.deriveSessionExpiry] is
 * unit-tested without a host.
 *
 * @property mode the resolved deployment mode.
 * @property expiresInSeconds seconds until expiry against the live clock; `null` when unavailable.
 * @property isExpiringSoon true when [expiresInSeconds] is in `(0, SESSION_EXPIRING_THRESHOLD_S)`.
 * @property hasExpired true when expiry has passed or the session reports unauthenticated.
 */
data class SessionExpiryState(
    val mode: SessionMode,
    val expiresInSeconds: Long?,
    val isExpiringSoon: Boolean,
    val hasExpired: Boolean,
)

/**
 * One unsaved form draft the user would keep (but could not finish) after a forced sign-out — the native port
 * of the web `DraftSummary` read from the `teslasync:draft:v*:*` registry. The label is the readable form-key
 * tail; [savedAtEpochMillis] orders the list most-recent-first and is `null` when the envelope is unparseable.
 *
 * @property label the readable draft key (web `tail`).
 * @property savedAtEpochMillis last-saved time in epoch millis; `null` when unknown.
 */
data class DraftSummary(
    val label: String,
    val savedAtEpochMillis: Long? = null,
)

/**
 * The drafts panel's render-ready projection: the [visible] rows (most-recent-first, capped at
 * [DRAFT_DISPLAY_LIMIT]) and the [overflowCount] collapsed into the `+N more` row (web `drafts.length - 5`).
 */
data class DraftProjection(
    val visible: List<DraftSummary>,
    val overflowCount: Int,
)

/**
 * The fully projected, render-ready view — the native analogue of every value the web component computes
 * before returning JSX. Pure data (no Compose types) so the projection is unit-tested without a UI host.
 *
 * @property open whether the modal renders at all (web `open = mode === 'session' && isExpiringSoon &&
 *   !hasExpired`); the render layer emits nothing when false.
 * @property countdownText the formatted `m:ss` remaining time (web `formatCountdown`).
 * @property drafts the drafts-panel projection; an empty [DraftProjection.visible] omits the panel.
 * @property refreshing whether the "Stay signed in" action is in flight (label -> "Refreshing…", disabled).
 */
data class SessionExpiringDisplay(
    val open: Boolean,
    val countdownText: String,
    val drafts: DraftProjection,
    val refreshing: Boolean,
)

/**
 * Pure projections from the surface's inputs to its render-ready values — a 1:1 port of the derivations the web
 * component and its `useSessionMonitor` hook perform: the `deriveSessionState` expiry computation, the
 * `formatCountdown` formatting, the `open` visibility gate, the draft ordering/slicing, and the i18n argument
 * substitution. No Compose; everything here runs in the off-device unit gate.
 */
object SessionExpiringProjection {
    private val unresolved =
        SessionExpiryState(SessionMode.Unknown, expiresInSeconds = null, isExpiringSoon = false, hasExpired = false)

    private val openMode =
        SessionExpiryState(SessionMode.Open, expiresInSeconds = null, isExpiringSoon = false, hasExpired = false)

    /**
     * Computes the derived [SessionExpiryState] from a [snapshot] and [nowEpochSeconds] — the native port of the
     * web hook's `deriveSessionState`. Unknown and open modes short-circuit all expiry logic; an unauthenticated
     * session is already expired; otherwise the remaining seconds are computed from the absolute expiry (falling
     * back to the snapshot's remaining-seconds value) and classified into expiring-soon / expired.
     */
    fun deriveSessionExpiry(
        snapshot: SessionSnapshot,
        nowEpochSeconds: Long,
    ): SessionExpiryState =
        when (snapshot.mode) {
            SessionMode.Unknown -> unresolved
            SessionMode.Open -> openMode
            SessionMode.Session -> deriveSessionMode(snapshot, nowEpochSeconds)
        }

    private fun deriveSessionMode(
        snapshot: SessionSnapshot,
        nowEpochSeconds: Long,
    ): SessionExpiryState {
        if (!snapshot.authenticated) {
            return SessionExpiryState(
                mode = SessionMode.Session,
                expiresInSeconds = null,
                isExpiringSoon = false,
                hasExpired = true,
            )
        }
        val expiresIn = resolveExpiresIn(snapshot, nowEpochSeconds)
        return SessionExpiryState(
            mode = SessionMode.Session,
            expiresInSeconds = expiresIn,
            isExpiringSoon = expiresIn != null && expiresIn > 0 && expiresIn < SESSION_EXPIRING_THRESHOLD_S,
            hasExpired = expiresIn != null && expiresIn <= 0,
        )
    }

    // Prefer the absolute expiry (clock-skew-safe) computed against the live clock; fall back to the static
    // remaining-seconds snapshot when the absolute value is unavailable (web expires_at -> expires_in).
    private fun resolveExpiresIn(
        snapshot: SessionSnapshot,
        nowEpochSeconds: Long,
    ): Long? = snapshot.expiresAtEpochSeconds?.let { it - nowEpochSeconds } ?: snapshot.expiresInFallbackSeconds

    /**
     * Formats remaining [seconds] as `m:ss` — the web `formatCountdown`. A non-positive value renders `0:00`
     * (never a negative or empty string), and the seconds field is always zero-padded to two digits.
     */
    fun formatCountdown(seconds: Long): String =
        if (seconds <= 0L) {
            "0:00"
        } else {
            val minutes = seconds / SECONDS_PER_MINUTE
            val remainder = seconds % SECONDS_PER_MINUTE
            "$minutes:${remainder.toString().padStart(2, '0')}"
        }

    /**
     * The web `open` gate: the modal renders only for an active session that is expiring soon and has not yet
     * hard-expired (the hard-expired case yields to the companion SessionExpiredModal).
     */
    fun isOpen(state: SessionExpiryState): Boolean = state.mode == SessionMode.Session && state.isExpiringSoon && !state.hasExpired

    /**
     * Orders the [drafts] most-recent-first and splits them into the [DRAFT_DISPLAY_LIMIT] visible rows plus the
     * overflow count — the web `sort(...).slice(0, 5)` plus `drafts.length - 5`. A draft with no timestamp sorts
     * last (treated as epoch 0), mirroring the web fallback.
     */
    fun projectDrafts(
        drafts: List<DraftSummary>,
        limit: Int = DRAFT_DISPLAY_LIMIT,
    ): DraftProjection {
        val ordered = drafts.sortedByDescending { it.savedAtEpochMillis ?: 0L }
        return DraftProjection(
            visible = ordered.take(limit),
            overflowCount = (ordered.size - limit).coerceAtLeast(0),
        )
    }

    /**
     * Assembles the render-ready [SessionExpiringDisplay] from the derived [state], the user's [drafts], and the
     * in-flight [refreshing] flag — the single projection the composable reads.
     */
    fun display(
        state: SessionExpiryState,
        drafts: List<DraftSummary>,
        refreshing: Boolean,
    ): SessionExpiringDisplay =
        SessionExpiringDisplay(
            open = isOpen(state),
            countdownText = formatCountdown(state.expiresInSeconds ?: 0L),
            drafts = projectDrafts(drafts),
            refreshing = refreshing,
        )

    /**
     * Substitutes the single positional argument into an i18n [template] from the generated catalog — the
     * render-boundary analogue of the web `t(key, { countdown })` / `t(key, { count })` interpolation. The
     * catalog uses Android's `%1$s` token; this swaps it for [value] without locale-sensitive number formatting.
     */
    fun applyArg(
        template: String,
        value: String,
    ): String = template.replace(ARG_TOKEN, value)
}

/**
 * Emits the one PII-safe `view.opened` diagnostic with the surface [SessionExpiringRegistration.SLUG] (P1/S11).
 * Carries only the slug — never the countdown, the remaining seconds, or any draft label — so a diagnostics line
 * can never leak session timing or what the user was editing. Kept free of Compose so it is unit-tested with a
 * recording [Logger]; the composable calls it from its first-composition effect.
 */
fun recordSessionExpiringOpened(logger: Logger) {
    logger.info("view.opened", mapOf("surface" to SessionExpiringRegistration.SLUG))
}
