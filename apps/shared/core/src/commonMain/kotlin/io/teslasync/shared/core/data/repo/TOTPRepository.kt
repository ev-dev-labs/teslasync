package io.teslasync.shared.core.data.repo

import io.teslasync.shared.core.presentation.totp.TOTPBackupCodesResponse
import io.teslasync.shared.core.presentation.totp.TOTPEnrollment
import io.teslasync.shared.core.presentation.totp.TOTPStatus
import io.teslasync.shared.core.presentation.totp.TOTPSudoToken
import io.teslasync.shared.core.presentation.totp.TOTPVerifyResult
import kotlinx.coroutines.flow.Flow

/**
 * The S7 data port for per-user TOTP enrollment — the cross-platform analogue of the web `useTOTP`
 * hook domain (web/src/api/hooks/useTOTP.ts). Every native two-factor surface (Android/Apple via
 * KMP, Windows via the C# port) reaches the backend exclusively through this interface, so a single
 * fake stands in for the whole domain in the S8 state-holder tests.
 *
 * The single read ([status]) streams a cache-then-network [Resource] (ADR-013): the cached value
 * first for an instant cold start, then the refreshed value. It resolves to [TOTPStatus.Open] when
 * the backend reports the 501 `AUTH_MODE_OPEN` sentinel — normalised to a *successful* no-op exactly
 * as the web `queryFn` does (so the section renders an inline "requires login" empty state instead of
 * an error) — and otherwise to [TOTPStatus.Session].
 *
 * The five mutations are non-throwing suspend [Result]s. [enroll], [verify], [revoke] and
 * [regenerateBackupCodes] each evict the single status cache key on success (the data-layer analogue
 * of the web hooks invalidating `totpKeys.status`); [stepUp] performs NO invalidation (the web
 * `useTOTPStepUp` declares none — it only parks the minted token), so it touches no cache key here.
 *
 * Payloads are booleans, counts, secrets and ISO stamps — not display-unit-bearing — so the exact
 * server shape round-trips unchanged; any conversion would be display-only (S5).
 */
public interface TOTPRepository {
    /**
     * `GET /auth/totp` — the per-user TOTP status (web `useTOTPStatus`). Resolves to
     * [TOTPStatus.Open] on the 501 `AUTH_MODE_OPEN` sentinel (a successful no-op) and to
     * [TOTPStatus.Session] otherwise; a real transport/HTTP failure surfaces through [Resource.Error].
     */
    public fun status(): Flow<Resource<TOTPStatus>>

    /**
     * `POST /auth/totp/enroll` — start a fresh enrollment, returning the secret, QR data URI and
     * one-time backup codes (web `useTOTPEnroll`). On success the status key is evicted so the next
     * read reflects the pending state.
     */
    public suspend fun enroll(): Result<TOTPEnrollment>

    /**
     * `POST /auth/totp/verify` `{ code }` — promote a pending enrollment to active (web
     * `useTOTPVerify`). On success the status key is evicted so the section flips to "Active".
     */
    public suspend fun verify(code: String): Result<TOTPVerifyResult>

    /**
     * `POST /auth/totp/sudo` `{ code? , backup_code? }` — mint a per-user step-up token (web
     * `useTOTPStepUp`). Only the supplied of `code` / `backup_code` is sent. Performs NO cache
     * invalidation; the caller parks the returned token (S8 → [io.teslasync.shared.core.presentation.totp.SudoTokenSink]).
     */
    public suspend fun stepUp(
        code: String? = null,
        backupCode: String? = null,
    ): Result<TOTPSudoToken>

    /**
     * `DELETE /auth/totp` — disable TOTP for the subject (web `useTOTPRevoke`). RequireSudo-gated
     * upstream (handled transparently by the networking layer). On success the status key is evicted.
     */
    public suspend fun revoke(): Result<Unit>

    /**
     * `POST /auth/totp/backup-codes/regenerate` — rotate the backup-code set, returned once (web
     * `useTOTPRegenerateBackupCodes`). RequireSudo-gated upstream. On success the status key is
     * evicted so `backup_codes_remaining` refreshes.
     */
    public suspend fun regenerateBackupCodes(): Result<TOTPBackupCodesResponse>
}
