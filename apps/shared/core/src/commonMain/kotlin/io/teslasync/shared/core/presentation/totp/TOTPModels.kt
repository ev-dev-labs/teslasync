package io.teslasync.shared.core.presentation.totp

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

/**
 * The discriminated result of the TOTP status read — the cross-platform port of the web
 * `TOTPStatus` union (web/src/api/types.ts):
 *  - [Open] mirrors `{ mode: 'open' }`: the deployment runs without a forward-auth header so
 *    per-user TOTP cannot be tracked. The web hook normalises the backend's 501 `AUTH_MODE_OPEN`
 *    sentinel to this value and treats it as a *successful* no-op (not an error) so the section can
 *    render an inline "requires login" empty state; the S7 repository reproduces that mapping.
 *  - [Session] mirrors `{ mode: 'session', activated, last_used_at?, backup_codes_remaining }`: the
 *    enrollment state of the current subject's credential.
 *
 * Annotated [Serializable] with stable [SerialName] discriminators so the value can round-trip
 * through the offline cache (ADR-013) independently of the wire shape. No field is unit-bearing, so
 * there is no SI conversion at this layer — display formatting is the render boundary's job (S5).
 */
@Serializable
public sealed interface TOTPStatus {
    /** The deployment is in open mode — TOTP cannot be tracked (web `{ mode: 'open' }`). */
    @Serializable
    @SerialName("open")
    public data object Open : TOTPStatus

    /**
     * The current subject's TOTP enrollment state (web `{ mode: 'session', ... }`).
     *
     * @property activated whether an active TOTP credential exists for the subject.
     * @property lastUsedAt ISO-8601 timestamp the credential was last used; `null` if never / not
     *   yet enrolled.
     * @property backupCodesRemaining how many single-use backup codes are still unspent.
     */
    @Serializable
    @SerialName("session")
    public data class Session(
        val activated: Boolean = false,
        @SerialName("last_used_at") val lastUsedAt: String? = null,
        @SerialName("backup_codes_remaining") val backupCodesRemaining: Int = 0,
    ) : TOTPStatus
}

/**
 * The fresh-enrollment payload returned by `POST /auth/totp/enroll` — the cross-platform port of the
 * web `TOTPEnrollment` interface (web/src/api/types.ts). The plain-text [backupCodes] are returned
 * exactly once; the platform surface must show a copy/download step before the user dismisses the
 * modal. Keys arrive snake_case and are matched verbatim via [SerialName] so the cached payload
 * round-trips unchanged.
 *
 * @property secret the base32 TOTP shared secret (shown as the manual-entry code).
 * @property otpauthUri the `otpauth://` provisioning URI.
 * @property qrDataUri the QR image as a `data:` URI for inline rendering.
 * @property backupCodes the one-time plain-text backup codes (shown once, never re-fetchable).
 * @property expiresAt ISO-8601 timestamp the pending enrollment lapses if not verified.
 */
@Serializable
public data class TOTPEnrollment(
    val secret: String,
    @SerialName("otpauth_uri") val otpauthUri: String,
    @SerialName("qr_data_uri") val qrDataUri: String,
    @SerialName("backup_codes") val backupCodes: List<String> = emptyList(),
    @SerialName("expires_at") val expiresAt: String,
)

/**
 * The verify-enrollment result returned by `POST /auth/totp/verify` — the port of the web hook's
 * inline `{ activated: boolean }` shape. A `true` value promotes the pending enrollment to active.
 *
 * @property activated whether the credential is now active.
 */
@Serializable
public data class TOTPVerifyResult(
    val activated: Boolean = false,
)

/**
 * The step-up token minted by `POST /auth/totp/sudo` — the cross-platform port of the web
 * `TOTPSudoToken` interface (web/src/api/types.ts). Same shape as the password reauth response so the
 * networking layer's reauth seam can consume it without a discriminator.
 *
 * @property mode always `session` (the route only exists in forward-auth mode); carried verbatim.
 * @property sudoToken the freshly minted step-up token (sent as `X-Sudo-Token` on follow-up calls).
 * @property expiresAt ISO-8601 timestamp the token lapses; parsed to epoch millis at the call site.
 */
@Serializable
public data class TOTPSudoToken(
    val mode: String = "session",
    @SerialName("sudo_token") val sudoToken: String,
    @SerialName("expires_at") val expiresAt: String,
)

/**
 * The fresh backup-code set returned by `POST /auth/totp/backup-codes/regenerate` — the port of the
 * web `TOTPBackupCodesResponse` interface. The secret itself is unchanged; only the codes rotate,
 * and they are returned exactly once.
 *
 * @property backupCodes the regenerated one-time plain-text codes.
 */
@Serializable
public data class TOTPBackupCodesResponse(
    @SerialName("backup_codes") val backupCodes: List<String> = emptyList(),
)

/**
 * The raw `GET /auth/totp` session body before the SPA reshapes it into [TOTPStatus.Session] — the
 * wire payload the backend always sends in forward-auth mode (`{ mode: 'session', activated,
 * last_used_at?, backup_codes_remaining }`). The open path is signalled out-of-band by the 501
 * `AUTH_MODE_OPEN` error, never in this body. [backupCodesRemaining] is tolerated as nullable on the
 * wire and normalised to `0` by [TOTPDerivations.statusResponse].
 */
@Serializable
internal data class TOTPStatusPayload(
    val mode: String = "session",
    val activated: Boolean = false,
    @SerialName("last_used_at") val lastUsedAt: String? = null,
    @SerialName("backup_codes_remaining") val backupCodesRemaining: Int? = null,
)
