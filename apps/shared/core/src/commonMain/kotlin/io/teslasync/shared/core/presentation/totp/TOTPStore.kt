package io.teslasync.shared.core.presentation.totp

import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.data.repo.TOTPRepository
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.flow.update

/**
 * UI-free shared state holder for per-user TOTP enrollment — the cross-platform port of the web
 * `useTOTP` hook domain (web/src/api/hooks/useTOTP.ts). Every native two-factor screen (Android/Apple
 * via KMP, Windows via the C# port) binds to this single holder rather than re-implementing the
 * endpoints, the 30s staleTime, the open-mode normalisation, or the invalidate-on-mutation rules.
 *
 * The single read is exposed as a hot [StateFlow] of a cache-then-network [Resource] (ADR-013): the
 * cached value first for an instant cold start, then the refreshed value, refreshable via [refresh].
 * It carries [TOTPStatus.Open] when the deployment is in open mode (the web hook's normalised 501
 * `AUTH_MODE_OPEN`) and [TOTPStatus.Session] with the enrollment state otherwise; the web hook
 * applies no `select`, so neither does this holder.
 *
 * The five mutations are non-throwing suspend [Result]s:
 *  - [enroll], [verify], [revoke] and [regenerateBackupCodes] each refresh the status feed on
 *    success ([refresh]) — exactly as the web hooks invalidate `totpKeys.status`; a failed mutation
 *    refreshes nothing (the web `onError` skips invalidation), and the S7 repository evicts the same
 *    status key on the same success so the refresh re-fetches rather than replaying a stale entry.
 *  - [stepUp] does NOT refresh the status feed (the web `useTOTPStepUp` declares no invalidation);
 *    instead, on success it hands the minted token + its parsed expiry to the injected
 *    [SudoTokenSink] (mirroring the web `setCachedSudoToken`), so subsequent requests can carry the
 *    `X-Sudo-Token` header.
 *
 * Values stay SI / verbatim; the holder makes no network calls itself and converts nothing
 * (formatting is the render boundary's job, S5). It mirrors the web hook's single-threaded usage and
 * is not internally synchronised; create and drive it from one confinement (the platform main scope).
 *
 * @property repo the S7 data port the feed and all five mutations are routed through.
 * @property scope the coroutine scope the shared feed runs in; cancelling it stops it.
 * @property sudoTokenSink the seam notified after a successful [stepUp]; defaults to the inert
 *   [SudoTokenSink.Noop] so the holder is independently testable until a platform wires a real sink.
 */
@OptIn(ExperimentalCoroutinesApi::class)
public class TOTPStore(
    private val repo: TOTPRepository,
    private val scope: CoroutineScope,
    private val sudoTokenSink: SudoTokenSink = SudoTokenSink.Noop,
) {
    private val trigger = MutableStateFlow(0)

    /**
     * The live TOTP status. Cold until first collected; then emits the cached value (if any)
     * followed by the network refresh, and re-fetches whenever [refresh] is called while it is being
     * observed.
     */
    public val status: StateFlow<Resource<TOTPStatus>> =
        trigger
            .flatMapLatest { repo.status() }
            .stateIn(
                scope = scope,
                started = SharingStarted.WhileSubscribed(STOP_TIMEOUT_MILLIS),
                initialValue = INITIAL,
            )

    /**
     * Starts a fresh enrollment, returning the secret / QR / one-time backup codes, then refreshes
     * the status feed on success (web `useTOTPEnroll`, which invalidates `totpKeys.status`). A failed
     * enroll refreshes nothing.
     */
    public suspend fun enroll(): Result<TOTPEnrollment> = repo.enroll().onSuccess { refresh() }

    /**
     * Promotes a pending enrollment to active using the supplied authenticator [code], then refreshes
     * the status feed on success (web `useTOTPVerify`, which invalidates `totpKeys.status`). A failed
     * verify refreshes nothing.
     */
    public suspend fun verify(code: String): Result<TOTPVerifyResult> = repo.verify(code).onSuccess { refresh() }

    /**
     * Mints a per-user step-up token from the supplied [code] or [backupCode] (web `useTOTPStepUp`).
     * On success the minted token + its parsed expiry are handed to [sudoTokenSink] (the web
     * `setCachedSudoToken`); the status feed is intentionally NOT refreshed. A failed step-up
     * notifies nothing.
     */
    public suspend fun stepUp(
        code: String? = null,
        backupCode: String? = null,
    ): Result<TOTPSudoToken> =
        repo.stepUp(code, backupCode).onSuccess { token ->
            sudoTokenSink.cache(token.sudoToken, TOTPDerivations.sudoExpiryMillis(token.expiresAt))
        }

    /**
     * Disables TOTP for the subject, then refreshes the status feed on success (web `useTOTPRevoke`,
     * which invalidates `totpKeys.status`). A failed revoke refreshes nothing.
     */
    public suspend fun revoke(): Result<Unit> = repo.revoke().onSuccess { refresh() }

    /**
     * Rotates the backup-code set, returning the fresh codes once, then refreshes the status feed on
     * success (web `useTOTPRegenerateBackupCodes`, which invalidates `totpKeys.status`). A failed
     * regenerate refreshes nothing.
     */
    public suspend fun regenerateBackupCodes(): Result<TOTPBackupCodesResponse> = repo.regenerateBackupCodes().onSuccess { refresh() }

    /** Re-fetches the status if it is being observed; a no-op when nobody is subscribed. */
    public fun refresh() {
        trigger.update { it + 1 }
    }

    private companion object {
        // Keep the feed's upstream alive briefly across config changes / fast re-subscribes.
        const val STOP_TIMEOUT_MILLIS = 5_000L

        val INITIAL: Resource<TOTPStatus> = Resource.Loading(cached = null, fetchedAt = null, stale = false)
    }
}
