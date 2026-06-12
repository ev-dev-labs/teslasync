// The data port the TOTPEnrollmentSection feature view binds to — the native analogue of the `useTOTP` hook
// domain the web component composes (web/src/api/hooks/useTOTP.ts → web/src/features/settings/components/
// TOTPEnrollmentSection.tsx): the cache-then-network status read plus the enroll / verify / revoke /
// regenerate-backup-codes mutations, each of which refreshes the status feed on success exactly as the web
// hooks invalidate `totpKeys.status`. The view performs NO HTTP itself; a shared adapter (the S8 TOTPStore or
// the S7 TOTPRepository) or a test/preview fake drives this seam. Cache-then-network freshness is preserved
// end to end (ADR-013): every status emission's cached/stale/error flags flow through unchanged so the
// view-model can render the full state matrix.
//
// `InvalidPackageDeclaration`/`ktlint:standard:filename`/`MatchingDeclarationName` are suppressed: the mandated
// surface directory (com/teslasync/feature-views/TOTPEnrollmentSection) cannot form a valid Kotlin package and
// the file hosts the seam plus its bindings + a preview/test fake, mirroring the sibling surfaces.
@file:Suppress("InvalidPackageDeclaration", "ktlint:standard:filename", "MatchingDeclarationName")

package io.teslasync.android.featureviews.totpenrollmentsection

import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.data.repo.TOTPRepository
import io.teslasync.shared.core.presentation.totp.TOTPBackupCodesResponse
import io.teslasync.shared.core.presentation.totp.TOTPEnrollment
import io.teslasync.shared.core.presentation.totp.TOTPStatus
import io.teslasync.shared.core.presentation.totp.TOTPStore
import io.teslasync.shared.core.presentation.totp.TOTPVerifyResult
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update

/**
 * The single seam the [TOTPEnrollmentSectionViewModel] depends on so it binds to an abstraction (real adapter
 * ↔ test fake), never to a concrete store/repository or the network. [status] is the cache-then-network feed
 * the web `useTOTPStatus` hook serves; [enroll]/[verify]/[revoke]/[regenerateBackupCodes] mirror the web
 * mutations (each non-throwing, refreshing the status feed on success); [refresh] re-runs the status read
 * backing the surface's retry affordance. No HTTP touches the view.
 */
interface TOTPEnrollmentSectionSource {
    /** Stream the cache-then-network per-user TOTP status (web `useTOTPStatus`, `GET /auth/totp`). */
    fun status(): Flow<Resource<TOTPStatus>>

    /** Start a fresh enrollment, returning the secret/QR/one-time codes (web `useTOTPEnroll`). */
    suspend fun enroll(): Result<TOTPEnrollment>

    /** Promote a pending enrollment to active with [code] (web `useTOTPVerify`). */
    suspend fun verify(code: String): Result<TOTPVerifyResult>

    /** Disable TOTP for the subject (web `useTOTPRevoke`). */
    suspend fun revoke(): Result<Unit>

    /** Rotate the backup-code set, returned once (web `useTOTPRegenerateBackupCodes`). */
    suspend fun regenerateBackupCodes(): Result<TOTPBackupCodesResponse>

    /** Re-run the status read (web `refetch()` / the hooks' `invalidateAndBroadcast`). */
    fun refresh()
}

/**
 * Binds the surface to the shared **S8** [TOTPStore] — the memoized, multi-observer holder every two-factor
 * surface shares app-wide. The store's hot status feed is re-collected through the view-model's refresh
 * trigger, and each mutation already refreshes that feed on success (the web invalidate-on-mutation rule), so
 * the section flips from "Not enrolled" to "Active" without a manual refetch. No HTTP touches the view.
 */
fun bindTOTPEnrollmentSectionSource(store: TOTPStore): TOTPEnrollmentSectionSource =
    object : TOTPEnrollmentSectionSource {
        override fun status(): Flow<Resource<TOTPStatus>> = store.status

        override suspend fun enroll(): Result<TOTPEnrollment> = store.enroll()

        override suspend fun verify(code: String): Result<TOTPVerifyResult> = store.verify(code)

        override suspend fun revoke(): Result<Unit> = store.revoke()

        override suspend fun regenerateBackupCodes(): Result<TOTPBackupCodesResponse> = store.regenerateBackupCodes()

        override fun refresh() = store.refresh()
    }

/**
 * Binds the surface directly to the shared **S7** [TOTPRepository]. Each [status] call starts a NEW
 * cache-then-network collection, so the view-model's refresh/retry trigger a genuine re-fetch (the web
 * `refetch()` behaviour); the repository evicts the status cache key on every mutation success exactly as the
 * web hooks invalidate `totpKeys.status`, so the post-mutation re-collection reflects the new state. Use this
 * binding when a host does not share a single app-wide store.
 */
fun bindTOTPEnrollmentSectionSource(repository: TOTPRepository): TOTPEnrollmentSectionSource =
    object : TOTPEnrollmentSectionSource {
        override fun status(): Flow<Resource<TOTPStatus>> = repository.status()

        override suspend fun enroll(): Result<TOTPEnrollment> = repository.enroll()

        override suspend fun verify(code: String): Result<TOTPVerifyResult> = repository.verify(code)

        override suspend fun revoke(): Result<Unit> = repository.revoke()

        override suspend fun regenerateBackupCodes(): Result<TOTPBackupCodesResponse> = repository.regenerateBackupCodes()

        override fun refresh() = Unit
    }

/**
 * An in-memory [TOTPEnrollmentSectionSource] for `@Preview`s and tests. It replays a mutable [status] value
 * (settable via [emit] to walk the surface through its states) and returns the canned mutation [Result]s,
 * counting each call so a test can assert the view-model invoked the right one. It performs no networking and
 * is the default a host injects when no shared store is wired (e.g. a preview harness).
 */
class InMemoryTOTPEnrollmentSectionSource(
    initial: Resource<TOTPStatus> = Resource.Loading(cached = null, fetchedAt = null, stale = false),
    private val enrollResult: Result<TOTPEnrollment> = Result.failure(IllegalStateException("no enroll configured")),
    private val verifyResult: Result<TOTPVerifyResult> = Result.success(TOTPVerifyResult(activated = true)),
    private val revokeResult: Result<Unit> = Result.success(Unit),
    private val regenerateResult: Result<TOTPBackupCodesResponse> = Result.success(TOTPBackupCodesResponse()),
) : TOTPEnrollmentSectionSource {
    private val statusState = MutableStateFlow(initial)

    /** Call counters a test asserts against to prove the view-model routed to the right mutation. */
    var enrollCalls: Int = 0
        private set
    var verifyCalls: Int = 0
        private set
    var revokeCalls: Int = 0
        private set
    var regenerateCalls: Int = 0
        private set
    var refreshCalls: Int = 0
        private set

    /** The last code passed to [verify]; lets a test confirm the sanitised code reached the seam. */
    var lastVerifiedCode: String? = null
        private set

    /** Pushes a new status [resource] so a test/preview can walk the surface through its state matrix. */
    fun emit(resource: Resource<TOTPStatus>) = statusState.update { resource }

    override fun status(): Flow<Resource<TOTPStatus>> = statusState.asStateFlow()

    override suspend fun enroll(): Result<TOTPEnrollment> {
        enrollCalls++
        return enrollResult
    }

    override suspend fun verify(code: String): Result<TOTPVerifyResult> {
        verifyCalls++
        lastVerifiedCode = code
        return verifyResult
    }

    override suspend fun revoke(): Result<Unit> {
        revokeCalls++
        return revokeResult
    }

    override suspend fun regenerateBackupCodes(): Result<TOTPBackupCodesResponse> {
        regenerateCalls++
        return regenerateResult
    }

    override fun refresh() {
        refreshCalls++
    }
}
