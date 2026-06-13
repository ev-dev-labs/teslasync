// Pure, framework-free model + projection for the ReauthDialog modal/dialog — the native analogue of every value
// the web component derives before it returns JSX (web/src/components/feedback/ReauthDialog.tsx). No Compose, no
// Android, no HTTP: every declaration here is exercised off-device by the :android:testReleaseUnitTest gate, so the
// composable stays a thin render layer over these pure functions.
//
// The web component is the sudo-style step-up reauth dialog opened when the backend gates a sensitive action with
// the RequireSudo middleware (401 + `code: 'SUDO_REQUIRED'`). It is auth-mode aware:
//   • forward-auth installs render the credential form (a Password tab, plus an Authenticator/TOTP tab when
//     enrolled) and POST a credential to mint a sudo token — web `mode === 'credential'`;
//   • open-mode installs render a typed-confirmation form (type `CONFIRM`) and resolve locally with
//     `{ mode: 'open' }`, no token — web `mode === 'confirm'`.
// Every branch the web source defines is projected here so the view never re-derives anything:
//   1. the mode resolution (web Root `forceMode ?? (monitor.mode === 'open' ? 'confirm' : 'credential')`),
//   2. the Authenticator-tab visibility (web Root `totpTabAvailable` / `totpEnrolled` over the TOTP-status read),
//   3. the per-tab submit body (web `activeTab === 'password' ? { password } : { totp_code }`),
//   4. the client-side blank/typed-confirmation guards and the server error-code → message mapping
//      (web `REAUTH_NOT_CONFIGURED` / `INVALID_CREDENTIAL` / `err.message` / `sudo.errors.unknown`),
//   5. the Authenticator-input sanitiser (web `value.replace(/\D/g, '').slice(0, 8)`).
//
// Binding (P1/S8): the web hooks map to the shared KMP state holders — `useSessionMonitor`/`useAuthMode` →
// [AuthModeResponse] (its `mode` carries the same `open` literal the web compares against), and `useTOTP`/
// `useTOTPStatus` → [Resource]<[TOTPStatus]> (the cache-then-network status read). The projections below consume
// those exact shared-core types, so the binding is concrete and compile-checked; the owning host collects them
// and supplies the submit seam (no HTTP in the view), exactly as the sibling ConfirmDialog leaves its owner wiring
// to the host. The cache-then-network loading/error/stale/offline phases of the TOTP read are folded into
// [ReauthDialogProjection.totpTabAvailable] (which degrades to "tab available" while the status is unknown),
// reproducing the web's exact `!isFetched || isError || …` guard rather than inventing separate surfaces (drift).
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/modals-dialogs/ReauthDialog — the P3 prompt's allowed-files path) cannot form a valid Kotlin
// package (a hyphen and a PascalCase segment are illegal in a package identifier), so the package intentionally
// diverges from the path — exactly as the sibling ConfirmDialog / feature-view surfaces do.
// `MatchingDeclarationName` is suppressed for the co-located supporting declarations.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.modalsdialogs.reauthdialog

import io.teslasync.shared.core.data.repo.AuthModeResponse
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.presentation.totp.TOTPStatus

/** Diagnostics + registry identifiers for the surface (P1/S11). */
object ReauthDialogRegistration {
    /** Stable surface id. */
    const val ID: String = "reauth-dialog"

    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). */
    const val SLUG: String = "ReauthDialog"
}

/**
 * The deployment auth-mode literal the web compares against (`monitor.mode === 'open'`); the shared
 * [AuthModeResponse.mode] carries the same `open` value in open-mode installs.
 */
const val OPEN_MODE_WIRE: String = "open"

/** The fixed token the open-mode typed-confirmation form requires (web `TYPED_CONFIRMATION_TOKEN`). */
const val TYPED_CONFIRMATION_TOKEN: String = "CONFIRM"

/** Maximum Authenticator-code length the web input clamps to (web `slice(0, 8)`). */
const val MAX_TOTP_LENGTH: Int = 8

/** Backend sentinel: step-up reauth is not configured on the server (web `REAUTH_NOT_CONFIGURED`). */
const val REAUTH_NOT_CONFIGURED_CODE: String = "REAUTH_NOT_CONFIGURED"

/** Backend sentinel: the supplied credential was rejected (web `INVALID_CREDENTIAL`). */
const val INVALID_CREDENTIAL_CODE: String = "INVALID_CREDENTIAL"

/** The two reauth modes (web `DialogMode = 'credential' | 'confirm'`). */
enum class DialogMode { Credential, Confirm }

/** The credential-mode tabs (web `'password' | 'totp'`); [wire] mirrors the web tab key. */
enum class ReauthTab(
    val wire: String,
) {
    Password("password"),
    Totp("totp"),
    ;

    companion object {
        /** Maps a tab key back to its [ReauthTab]; anything but `totp` resolves to [Password] (web `k === 'totp'`). */
        fun fromWire(wire: String): ReauthTab = if (wire == Totp.wire) Totp else Password
    }
}

/** The reauth outcome's mode (web `SudoCredential.mode = 'session' | 'open'`). */
enum class SudoMode { Session, Open }

/**
 * The resolved reauth credential handed back to the host on success — the native port of the web `SudoCredential`.
 *
 * @property mode `open` for a locally-resolved typed confirmation, `session` for a minted step-up token.
 * @property token the minted sudo token (sent as `X-Sudo-Token` on follow-up calls); `null` in open mode.
 * @property expiresAt ISO-8601 expiry of [token]; `null` in open mode.
 */
data class SudoCredential(
    val mode: SudoMode,
    val token: String? = null,
    val expiresAt: String? = null,
)

/**
 * The reauth submission body — the native port of the web `SudoSubmitBody` (`{ password?, totp_code? }`). Exactly
 * one field is populated, selected by the active tab.
 */
data class SudoSubmitBody(
    val password: String? = null,
    val totpCode: String? = null,
)

/**
 * The discriminated result of a credential submission — the native, non-throwing analogue of the web
 * `onSubmitCredential` promise resolve/reject. The host adapter maps its data-layer call (reauth POST / TOTP
 * step-up) onto this so the view never touches HTTP or exceptions.
 */
sealed interface ReauthSubmitOutcome {
    /** The credential was accepted; [credential] is forwarded to the host's `onSubmit`. */
    data class Success(
        val credential: SudoCredential,
    ) : ReauthSubmitOutcome

    /**
     * The credential was rejected. [code] is the backend sentinel (web `err.code`) and [message] the human-readable
     * detail (web `err.message`); both feed [ReauthDialogProjection.mapSubmitFailure].
     */
    data class Failure(
        val code: String? = null,
        val message: String? = null,
    ) : ReauthSubmitOutcome
}

/**
 * The error the dialog surfaces in its single error slot — one case per web error branch. Each non-[Raw] case maps
 * to a localized `sudo.errors.*` string at the render boundary; [Raw] carries a verbatim server message (web
 * `err.message`).
 */
sealed interface ReauthError {
    /** web `sudo.errors.passwordRequired` — blank password on the Password tab. */
    data object PasswordRequired : ReauthError

    /** web `sudo.errors.totpRequired` — blank code on the Authenticator tab. */
    data object TotpRequired : ReauthError

    /** web `sudo.errors.typedConfirmationMismatch` — confirm text is not the token. */
    data object TypedConfirmationMismatch : ReauthError

    /** web `sudo.errors.notConfigured` — server has no step-up secret configured. */
    data object NotConfigured : ReauthError

    /** web `sudo.errors.invalidPassword` — `INVALID_CREDENTIAL` on the Password tab. */
    data object InvalidPassword : ReauthError

    /** web `sudo.errors.invalidTotp` — `INVALID_CREDENTIAL` on the Authenticator tab. */
    data object InvalidTotp : ReauthError

    /** web `sudo.errors.unknown` — a failure with no usable message. */
    data object Unknown : ReauthError

    /** web `err.message` — a verbatim, already-human-readable server message. */
    data class Raw(
        val message: String,
    ) : ReauthError
}

/**
 * Pure projection from the surface's inputs to its render-ready values — a 1:1 port of the derivations the web
 * `ReauthDialogRoot` + `ReauthDialog` perform before returning JSX. No Compose, no formatting beyond the trivial
 * string ops.
 */
object ReauthDialogProjection {
    /**
     * Resolves the dialog mode — web Root `forceMode ?? (monitor.mode === 'open' ? 'confirm' : 'credential')`. An
     * unresolved/absent auth-mode read (or any non-`open` deployment) yields [DialogMode.Credential], matching the
     * web default for everything but the explicit `open` literal.
     */
    fun modeFor(
        authMode: Resource<AuthModeResponse>?,
        forceMode: DialogMode?,
    ): DialogMode = forceMode ?: if (authModeWire(authMode) == OPEN_MODE_WIRE) DialogMode.Confirm else DialogMode.Credential

    /** The current deployment auth-mode wire string from the cache-then-network read, or `null` before it resolves. */
    fun authModeWire(authMode: Resource<AuthModeResponse>?): String? = authMode?.cached?.mode

    /**
     * Whether per-user TOTP is enrolled — web `data != null && data.mode === 'session' && data.activated === true`.
     * Reads the read's current value ([Resource.cached] covers Success/Loading/Error), so a cached-then-refreshing
     * status keeps the enrolled answer stable.
     */
    fun totpEnrolled(status: Resource<TOTPStatus>?): Boolean {
        val value = status?.cached
        return value is TOTPStatus.Session && value.activated
    }

    /**
     * Whether the Authenticator tab is shown — web Root
     * `!isFetched || isError || totpEnrolled || (data?.mode !== 'open')`. The tab stays available while the status is
     * still loading (`!isFetched`) or errored, preserving backward compatibility with shared-secret installs that
     * never resolve a per-user status; it is hidden only once a settled, non-enrolled `open`-mode status proves TOTP
     * cannot apply. This is where the TOTP read's loading/error/offline phases are honoured without a separate
     * surface (the web models none).
     */
    fun totpTabAvailable(status: Resource<TOTPStatus>?): Boolean {
        status ?: return true
        val isFetched = status !is Resource.Loading || status.fetchedAt != null
        return !isFetched || status is Resource.Error || totpEnrolled(status) || status.cached !is TOTPStatus.Open
    }

    /**
     * Assembles the per-tab submit body — web `activeTab === 'password' ? { password } : { totp_code: totp }`. Only
     * the active tab's field is populated.
     */
    fun submitBody(
        tab: ReauthTab,
        password: String,
        totp: String,
    ): SudoSubmitBody =
        when (tab) {
            ReauthTab.Password -> SudoSubmitBody(password = password)
            ReauthTab.Totp -> SudoSubmitBody(totpCode = totp)
        }

    /**
     * Client-side credential guard — web `password.trim() === ''` / `totp.trim() === ''`. Returns the matching
     * blank-field [ReauthError], or `null` when the active tab's field is non-blank.
     */
    fun validateCredential(
        tab: ReauthTab,
        password: String,
        totp: String,
    ): ReauthError? =
        when (tab) {
            ReauthTab.Password -> if (password.isBlank()) ReauthError.PasswordRequired else null
            ReauthTab.Totp -> if (totp.isBlank()) ReauthError.TotpRequired else null
        }

    /**
     * Confirm-mode guard — web `confirmText.trim() !== TYPED_CONFIRMATION_TOKEN`. Returns
     * [ReauthError.TypedConfirmationMismatch] unless the trimmed text is exactly the token.
     */
    fun validateConfirm(confirmText: String): ReauthError? =
        if (confirmText.trim() == TYPED_CONFIRMATION_TOKEN) null else ReauthError.TypedConfirmationMismatch

    /**
     * Maps a submission failure to the surfaced error — web's submit-catch branch:
     * `REAUTH_NOT_CONFIGURED` → notConfigured, `INVALID_CREDENTIAL` → invalidPassword/invalidTotp by active tab, and
     * otherwise the verbatim [message] (web `err.message`) or [ReauthError.Unknown] when none is usable.
     */
    fun mapSubmitFailure(
        code: String?,
        message: String?,
        tab: ReauthTab,
    ): ReauthError =
        when (code) {
            REAUTH_NOT_CONFIGURED_CODE -> ReauthError.NotConfigured
            INVALID_CREDENTIAL_CODE -> if (tab == ReauthTab.Password) ReauthError.InvalidPassword else ReauthError.InvalidTotp
            else -> message?.takeIf { it.isNotBlank() }?.let(ReauthError::Raw) ?: ReauthError.Unknown
        }

    /** Authenticator-input sanitiser — web `value.replace(/\D/g, '').slice(0, 8)`: digits only, capped at 8. */
    fun sanitizeTotp(input: String): String = input.filter(Char::isDigit).take(MAX_TOTP_LENGTH)
}

/**
 * Emits the one PII-safe `view.opened` diagnostic with the surface [ReauthDialogRegistration.SLUG] (P1/S11). Carries
 * only the slug — never a password, code, token, or subject — so a diagnostics line can never leak a credential.
 * Kept free of Compose so it is unit-tested with a recording [Logger]; the composable calls it from its
 * first-composition effect.
 */
fun recordReauthDialogOpened(logger: Logger) {
    logger.info("view.opened", mapOf("surface" to ReauthDialogRegistration.SLUG))
}
