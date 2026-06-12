// Pure, framework-free model + projection for the TOTPEnrollmentSection feature view — the native analogue of
// everything the web component derives before returning JSX
// (web/src/features/settings/components/TOTPEnrollmentSection.tsx). No Compose, no Android framework, no HTTP:
// every declaration here is unit-tested off-device in the :android:testReleaseUnitTest gate, keeping the
// composable a thin render layer.
//
// The web component binds the `useTOTP` hook domain (status read + enroll / verify / revoke / regenerate
// mutations) and renders one GlassPanel with three top-level branches — a loading spinner, an "open mode"
// notice (deployment has no forward-auth header, so per-user TOTP cannot be tracked), and the live
// section (a status pill plus either an Enroll button when not enrolled, or the last-used stamp, the remaining
// backup-code count, and the Regenerate / Disable actions when active). Two modals (the QR + 6-digit verify,
// then the one-time backup-code reveal) and a typed-confirmation disable dialog complete the flow.
//
// The pure pieces extracted here are: the surface registration + the PII-safe `view.opened` diagnostic
// (P1/S11); the 6-digit code sanitiser the verify field applies (web `value.replace(/\D/g, '').slice(0, 6)`);
// the verify-error classification mapping the backend sentinel `code`s to a localizable enum (web's
// `TOTP_INVALID` / `TOTP_RATE_LIMITED` / `TOTP_ENROLLMENT_EXPIRED` branch); the backup-codes download payload
// builder (web `${header}\n\n${codes.join('\n')}\n`); and the active-credential projection that gates the
// last-used stamp + backup count behind the activated flag (web `activated ? … : …`). Every visible string is
// resolved through the i18n catalog (P1/S10) at the render boundary; nothing here carries English microcopy.
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/feature-views/TOTPEnrollmentSection — the P3 prompt's allowed-files path) cannot form a valid
// Kotlin package (a hyphen and a PascalCase segment are illegal in a package identifier), so the package
// intentionally diverges from the path — exactly as the sibling feature-view surfaces do.
// `MatchingDeclarationName` is suppressed for the co-located supporting types.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.totpenrollmentsection

import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.net.ApiError
import io.teslasync.shared.core.presentation.totp.TOTPDerivations
import io.teslasync.shared.core.presentation.totp.TOTPStatus

/** Diagnostics + registry identifiers for the surface (P1/S11). */
object TOTPEnrollmentSectionRegistration {
    /** Stable surface id. */
    const val ID: String = "totp-enrollment-section"

    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). Carries no secret / subject data. */
    const val SLUG: String = "TOTPEnrollmentSection"
}

/** The em dash the web renders for any null/absent value (`'—'`). */
internal const val EM_DASH: String = "\u2014"

/** The authenticator code length the verify step requires (web `code.length !== 6`). */
const val VERIFY_CODE_LENGTH: Int = 6

/** The download file name the backup-codes reveal writes (web `'teslasync-totp-backup-codes.txt'`). */
const val BACKUP_CODES_FILE_NAME: String = "teslasync-totp-backup-codes.txt"

/**
 * The render-ready active-credential fields — the native analogue of the web component's
 * `activated` / `lastUsedAt` / `backupRemaining` locals derived off the session status. The last-used stamp
 * and remaining-count are gated behind [activated] (web `activated ? sessionStatus.last_used_at : undefined`
 * and `activated ? sessionStatus.backup_codes_remaining ?? 0 : 0`), so a not-yet-active session never shows a
 * stale stamp or a non-zero count.
 *
 * @property activated whether an active TOTP credential exists for the subject.
 * @property lastUsedAtIso the ISO-8601 last-used stamp to format, or `null` (never used / not active).
 * @property backupCodesRemaining how many single-use backup codes are still unspent (0 when not active).
 */
data class TOTPSessionDisplay(
    val activated: Boolean,
    val lastUsedAtIso: String?,
    val backupCodesRemaining: Int,
)

/**
 * The localizable verify-failure reasons — the native port of the web `handleVerify` error branch. Each maps
 * at the render boundary to a P1/S10 catalog key; the holder never surfaces a raw exception message (PII-safe,
 * ADR-016), folding any unrecognised failure to [Generic] (web's `t('totp.errors.verifyGeneric', …)` fallback).
 */
enum class TOTPVerifyError {
    /** Fewer than [VERIFY_CODE_LENGTH] digits were entered (web `t('totp.errors.codeLength', …)`). */
    CodeIncomplete,

    /** The backend reported a code mismatch (web `TOTP_INVALID` → `t('totp.errors.invalidCode', …)`). */
    InvalidCode,

    /** The per-subject failure counter saturated (web `TOTP_RATE_LIMITED` → `t('totp.errors.rateLimited', …)`). */
    RateLimited,

    /** The 15-minute enrollment TTL lapsed (web `TOTP_ENROLLMENT_EXPIRED` → `t('totp.errors.enrollmentExpired', …)`). */
    EnrollmentExpired,

    /** Any other failure (web `err.message` / `t('totp.errors.verifyGeneric', …)` fallback). */
    Generic,
}

/**
 * Pure projections + derivations the web `TOTPEnrollmentSection` applies client-side. Extracted so the KMP
 * state holder's native binding, this surface's view-model, and the off-device unit gate all derive
 * identically and can never drift.
 */
object TOTPEnrollmentSectionProjection {
    /**
     * Whether the status is the "open mode" sentinel — the surface's empty boundary. The deployment runs
     * without a forward-auth header, so per-user TOTP cannot be tracked and the section shows the inline
     * "requires forward-auth" notice (web `!status.data || status.data.mode === 'open'`).
     */
    fun isOpenMode(status: TOTPStatus): Boolean = status is TOTPStatus.Open

    /**
     * Projects a session status into the render-ready [TOTPSessionDisplay], gating the last-used stamp +
     * backup-code count behind the activated flag (web `activated ? … : …`).
     */
    fun projectSession(session: TOTPStatus.Session): TOTPSessionDisplay =
        TOTPSessionDisplay(
            activated = session.activated,
            lastUsedAtIso = if (session.activated) session.lastUsedAt else null,
            backupCodesRemaining = if (session.activated) session.backupCodesRemaining else 0,
        )

    /**
     * Strips non-digits and clamps to [VERIFY_CODE_LENGTH] — the native port of the web verify field's
     * `onChange={(e) => setVerifyCode(e.target.value.replace(/\D/g, '').slice(0, 6))}`.
     */
    fun sanitizeCode(raw: String): String = raw.filter(Char::isDigit).take(VERIFY_CODE_LENGTH)

    /**
     * Whether [code] (already sanitised) is a complete authenticator code — the web verify guard
     * `code.replace(/\D/g, '').length !== 6` inverted.
     */
    fun isVerifyCodeComplete(code: String): Boolean = sanitizeCode(code).length == VERIFY_CODE_LENGTH

    /**
     * Classifies a verify failure into a localizable [TOTPVerifyError] using the backend's structured error
     * `code` (web `isApiError(err) ? err.code`), folding the three TOTP sentinels and defaulting everything
     * else to [TOTPVerifyError.Generic]. The matching is centralised on [TOTPDerivations]' shared constants so
     * the SPA and the native apps compare against the same sentinels.
     */
    fun classifyVerifyError(error: Throwable): TOTPVerifyError =
        when ((error as? ApiError.Http)?.code) {
            TOTPDerivations.TOTP_INVALID_CODE -> TOTPVerifyError.InvalidCode
            TOTPDerivations.TOTP_RATE_LIMITED_CODE -> TOTPVerifyError.RateLimited
            TOTPDerivations.TOTP_ENROLLMENT_EXPIRED_CODE -> TOTPVerifyError.EnrollmentExpired
            else -> TOTPVerifyError.Generic
        }

    /**
     * Builds the plain-text backup-codes download payload — the native port of the web
     * `${header}\n\n${revealedCodes.join('\n')}\n`. The [header] is the localized file-header comment; an empty
     * [codes] list yields just the header block (the web disables the download for an empty set, but the pure
     * builder stays total).
     */
    fun backupCodesFileContent(
        header: String,
        codes: List<String>,
    ): String = "$header\n\n${codes.joinToString("\n")}\n"
}

/**
 * Emits the one PII-safe `view.opened` diagnostic with the surface [TOTPEnrollmentSectionRegistration.SLUG]
 * (P1/S11). Kept free of Compose so it is unit-tested with a recording [Logger]; the view-model calls it from
 * the composable's first-composition effect. Carries only the slug — never a secret, backup code, or subject.
 */
fun recordTOTPEnrollmentSectionOpened(logger: Logger) {
    logger.info("view.opened", mapOf("surface" to TOTPEnrollmentSectionRegistration.SLUG))
}
