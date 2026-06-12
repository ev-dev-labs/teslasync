package io.teslasync.android.featureviews.totpenrollmentsection

import io.teslasync.android.data.UiPhase
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.data.repo.TOTPRepository
import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.LogRecord
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.net.ApiError
import io.teslasync.shared.core.presentation.totp.TOTPBackupCodesResponse
import io.teslasync.shared.core.presentation.totp.TOTPDerivations
import io.teslasync.shared.core.presentation.totp.TOTPEnrollment
import io.teslasync.shared.core.presentation.totp.TOTPStatus
import io.teslasync.shared.core.presentation.totp.TOTPStore
import io.teslasync.shared.core.presentation.totp.TOTPSudoToken
import io.teslasync.shared.core.presentation.totp.TOTPVerifyResult
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.asFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Drives [TOTPEnrollmentSectionViewModel] over the in-memory fake source (and the shared-store binding over a
 * fake repository for the adapter path) — covering every state the surface renders (loading / open-mode empty /
 * session content / hard error / offline-cached), the full dialog flow (enroll → verify → backup codes; the
 * incomplete-code inline error; regenerate; the typed-confirmation disable), the toasts each mutation raises,
 * the refresh re-fetch, and the one-shot `view.opened` diagnostic. Run by the offline
 * `:android:testReleaseUnitTest` gate.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class TOTPEnrollmentSectionViewModelTest {
    // ── state projection ──────────────────────────────────────────────────────────
    @Test
    fun loadingWithNoCacheIsLoadingPhase() =
        runTest(UnconfinedTestDispatcher()) {
            val vm = viewModel(source(Resource.Loading(cached = null, fetchedAt = null, stale = false)))
            backgroundScope.launch { vm.status.collect {} }
            advanceUntilIdle()
            assertEquals(UiPhase.Loading, vm.status.value.phase)
        }

    @Test
    fun openModeIsEmptyPhase() =
        runTest(UnconfinedTestDispatcher()) {
            val vm = viewModel(source(success(TOTPStatus.Open)))
            backgroundScope.launch { vm.status.collect {} }
            advanceUntilIdle()
            assertEquals(UiPhase.Empty, vm.status.value.phase)
        }

    @Test
    fun sessionIsContentPhase() =
        runTest(UnconfinedTestDispatcher()) {
            val vm = viewModel(source(success(TOTPStatus.Session(activated = true, backupCodesRemaining = 5))))
            backgroundScope.launch { vm.status.collect {} }
            advanceUntilIdle()
            assertEquals(UiPhase.Content, vm.status.value.phase)
        }

    @Test
    fun hardErrorWithNoCacheIsErrorPhase() =
        runTest(UnconfinedTestDispatcher()) {
            val vm =
                viewModel(
                    source(Resource.Error(cached = null, fetchedAt = null, stale = false, error = ApiError.Network())),
                )
            backgroundScope.launch { vm.status.collect {} }
            advanceUntilIdle()
            val ui = vm.status.value
            assertEquals(UiPhase.Error, ui.phase)
            assertTrue(ui.hasError)
            assertFalse(ui.hasData)
        }

    @Test
    fun offlineKeepsCachedSessionWithStaleAndRetry() =
        runTest(UnconfinedTestDispatcher()) {
            val vm =
                viewModel(
                    source(
                        Resource.Error(
                            cached = TOTPStatus.Session(activated = true, backupCodesRemaining = 3),
                            fetchedAt = 100L,
                            stale = true,
                            error = ApiError.Network(),
                        ),
                    ),
                )
            backgroundScope.launch { vm.status.collect {} }
            advanceUntilIdle()
            val ui = vm.status.value
            assertEquals(UiPhase.Content, ui.phase)
            assertTrue(ui.isOffline)
            assertTrue(ui.canRetry)
        }

    // ── enroll → verify → backup codes ──────────────────────────────────────────────
    @Test
    fun beginEnrollOpensEnrollModalOnSuccess() =
        runTest(UnconfinedTestDispatcher()) {
            val src = source(success(TOTPStatus.Session(activated = false)), enroll = Result.success(enrollment()))
            val vm = viewModel(src)
            vm.beginEnroll()
            advanceUntilIdle()
            assertEquals(1, src.enrollCalls)
            assertEquals(TOTPDialogStep.Enroll, vm.dialog.value.step)
            assertEquals(
                "SECRET",
                vm.dialog.value.enrollment
                    ?.secret,
            )
        }

    @Test
    fun beginEnrollEmitsToastOnFailure() =
        runTest(UnconfinedTestDispatcher()) {
            val src = source(success(TOTPStatus.Session(activated = false)), enroll = Result.failure(ApiError.Network()))
            val vm = viewModel(src)
            val toasts = collectToasts(vm)
            vm.beginEnroll()
            advanceUntilIdle()
            assertEquals(TOTPDialogStep.Closed, vm.dialog.value.step)
            assertTrue(toasts.contains(TOTPToast.EnrollFailed))
        }

    @Test
    fun submitVerifyIncompleteSetsInlineErrorWithoutCall() =
        runTest(UnconfinedTestDispatcher()) {
            val src = source(success(TOTPStatus.Session(activated = false)))
            val vm = viewModel(src)
            vm.verifyCodeChanged("123")
            vm.submitVerify()
            advanceUntilIdle()
            assertEquals(0, src.verifyCalls)
            assertEquals(TOTPVerifyError.CodeIncomplete, vm.dialog.value.verifyError)
        }

    @Test
    fun submitVerifySuccessRevealsBackupCodesAndToast() =
        runTest(UnconfinedTestDispatcher()) {
            val src =
                source(
                    success(TOTPStatus.Session(activated = false)),
                    enroll = Result.success(enrollment(codes = listOf("AAAA", "BBBB"))),
                    verify = Result.success(TOTPVerifyResult(activated = true)),
                )
            val vm = viewModel(src)
            val toasts = collectToasts(vm)
            vm.beginEnroll()
            advanceUntilIdle()
            vm.verifyCodeChanged("123456")
            vm.submitVerify()
            advanceUntilIdle()
            assertEquals("123456", src.lastVerifiedCode)
            assertEquals(TOTPDialogStep.BackupCodes, vm.dialog.value.step)
            assertEquals(listOf("AAAA", "BBBB"), vm.dialog.value.revealedCodes)
            assertTrue(toasts.contains(TOTPToast.Verified))
        }

    @Test
    fun submitVerifyFailureSetsClassifiedInlineError() =
        runTest(UnconfinedTestDispatcher()) {
            val src =
                source(
                    success(TOTPStatus.Session(activated = false)),
                    enroll = Result.success(enrollment()),
                    verify = Result.failure(ApiError.Http(status = 400, code = TOTPDerivations.TOTP_INVALID_CODE)),
                )
            val vm = viewModel(src)
            vm.beginEnroll()
            advanceUntilIdle()
            vm.verifyCodeChanged("000000")
            vm.submitVerify()
            advanceUntilIdle()
            assertEquals(TOTPVerifyError.InvalidCode, vm.dialog.value.verifyError)
            assertEquals(TOTPDialogStep.Enroll, vm.dialog.value.step)
        }

    @Test
    fun verifyCodeChangedSanitizesInput() =
        runTest(UnconfinedTestDispatcher()) {
            val vm = viewModel(source(success(TOTPStatus.Session(activated = false))))
            vm.verifyCodeChanged("12-34-56-78")
            assertEquals("123456", vm.dialog.value.verifyCode)
        }

    // ── regenerate / disable ────────────────────────────────────────────────────────
    @Test
    fun beginRegenerateRevealsCodesAndToast() =
        runTest(UnconfinedTestDispatcher()) {
            val src =
                source(
                    success(TOTPStatus.Session(activated = true, backupCodesRemaining = 1)),
                    regenerate = Result.success(TOTPBackupCodesResponse(listOf("ZZZZ"))),
                )
            val vm = viewModel(src)
            val toasts = collectToasts(vm)
            vm.beginRegenerate()
            advanceUntilIdle()
            assertEquals(TOTPDialogStep.BackupCodes, vm.dialog.value.step)
            assertEquals(listOf("ZZZZ"), vm.dialog.value.revealedCodes)
            assertTrue(toasts.contains(TOTPToast.BackupRegenerated))
        }

    @Test
    fun confirmDisableRevokesEmitsToastAndClosesDialog() =
        runTest(UnconfinedTestDispatcher()) {
            val src = source(success(TOTPStatus.Session(activated = true)), revoke = Result.success(Unit))
            val vm = viewModel(src)
            val toasts = collectToasts(vm)
            vm.requestDisable()
            assertTrue(vm.dialog.value.showDisableConfirm)
            vm.confirmDisable()
            advanceUntilIdle()
            assertEquals(1, src.revokeCalls)
            assertFalse(vm.dialog.value.showDisableConfirm)
            assertTrue(toasts.contains(TOTPToast.Disabled))
        }

    @Test
    fun cancelDisableClosesConfirmWithoutRevoking() =
        runTest(UnconfinedTestDispatcher()) {
            val src = source(success(TOTPStatus.Session(activated = true)))
            val vm = viewModel(src)
            vm.requestDisable()
            vm.cancelDisable()
            advanceUntilIdle()
            assertEquals(0, src.revokeCalls)
            assertFalse(vm.dialog.value.showDisableConfirm)
        }

    @Test
    fun closeDialogResetsFlowState() =
        runTest(UnconfinedTestDispatcher()) {
            val src = source(success(TOTPStatus.Session(activated = false)), enroll = Result.success(enrollment()))
            val vm = viewModel(src)
            vm.beginEnroll()
            advanceUntilIdle()
            vm.verifyCodeChanged("123456")
            vm.closeDialog()
            assertEquals(TOTPDialogStep.Closed, vm.dialog.value.step)
            assertNull(vm.dialog.value.enrollment)
            assertEquals("", vm.dialog.value.verifyCode)
            assertNull(vm.dialog.value.verifyError)
        }

    // ── refresh / telemetry ─────────────────────────────────────────────────────────
    @Test
    fun refreshReCollectsAndLogs() =
        runTest(UnconfinedTestDispatcher()) {
            val logger = RecordingLogger()
            val src = source(success(TOTPStatus.Session(activated = true)))
            val vm = TOTPEnrollmentSectionViewModel(src, logger, backgroundScope)
            backgroundScope.launch { vm.status.collect {} }
            advanceUntilIdle()

            vm.refresh()
            advanceUntilIdle()

            assertTrue(src.refreshCalls > 0)
            assertTrue(logger.records.any { it.event == "totpEnrollment.refresh" })
        }

    @Test
    fun viewOpenedEmitsDiagnosticsOnceWithSurfaceSlug() =
        runTest(UnconfinedTestDispatcher()) {
            val logger = RecordingLogger()
            val vm = TOTPEnrollmentSectionViewModel(source(success(TOTPStatus.Open)), logger, backgroundScope)

            vm.onViewOpened()
            vm.onViewOpened()

            val opened = logger.records.filter { it.event == "view.opened" }
            assertEquals(1, opened.size)
            assertEquals("TOTPEnrollmentSection", opened.first().fields["surface"])
        }

    // ── adapter: shared-store binding ────────────────────────────────────────────────
    @Test
    fun storeBindingProjectsStatusAndMutationRefreshesFeed() =
        runTest(UnconfinedTestDispatcher()) {
            val repo = FakeTOTPRepository(listOf(success(TOTPStatus.Session(activated = false))))
            val store = TOTPStore(repo, backgroundScope)
            val vm = TOTPEnrollmentSectionViewModel(bindTOTPEnrollmentSectionSource(store), RecordingLogger(), backgroundScope)
            backgroundScope.launch { vm.status.collect {} }
            advanceUntilIdle()
            assertEquals(UiPhase.Content, vm.status.value.phase)
            val before = repo.statusCalls

            vm.verifyCodeChanged("123456")
            vm.submitVerify()
            advanceUntilIdle()

            assertTrue(repo.verifyCalls > 0)
            assertTrue("verify success should refresh the status feed", repo.statusCalls > before)
        }

    // ── fakes / helpers ─────────────────────────────────────────────────────────────
    private fun TestScope.viewModel(source: InMemoryTOTPEnrollmentSectionSource): TOTPEnrollmentSectionViewModel =
        TOTPEnrollmentSectionViewModel(source, RecordingLogger(), backgroundScope)

    private fun TestScope.collectToasts(vm: TOTPEnrollmentSectionViewModel): MutableList<TOTPToast> {
        val collected = mutableListOf<TOTPToast>()
        backgroundScope.launch { vm.toasts.collect { collected += it } }
        return collected
    }

    private fun source(
        status: Resource<TOTPStatus>,
        enroll: Result<TOTPEnrollment> = Result.failure(IllegalStateException("no enroll")),
        verify: Result<TOTPVerifyResult> = Result.success(TOTPVerifyResult(activated = true)),
        revoke: Result<Unit> = Result.success(Unit),
        regenerate: Result<TOTPBackupCodesResponse> = Result.success(TOTPBackupCodesResponse()),
    ): InMemoryTOTPEnrollmentSectionSource =
        InMemoryTOTPEnrollmentSectionSource(
            initial = status,
            enrollResult = enroll,
            verifyResult = verify,
            revokeResult = revoke,
            regenerateResult = regenerate,
        )

    private class FakeTOTPRepository(
        private val statuses: List<Resource<TOTPStatus>>,
    ) : TOTPRepository {
        var statusCalls = 0
            private set
        var verifyCalls = 0
            private set

        override fun status(): Flow<Resource<TOTPStatus>> {
            statusCalls++
            return statuses.asFlow()
        }

        override suspend fun enroll(): Result<TOTPEnrollment> = Result.success(sampleEnrollment())

        override suspend fun verify(code: String): Result<TOTPVerifyResult> {
            verifyCalls++
            return Result.success(TOTPVerifyResult(activated = true))
        }

        override suspend fun stepUp(
            code: String?,
            backupCode: String?,
        ): Result<TOTPSudoToken> = Result.failure(IllegalStateException("unused"))

        override suspend fun revoke(): Result<Unit> = Result.success(Unit)

        override suspend fun regenerateBackupCodes(): Result<TOTPBackupCodesResponse> =
            Result.success(TOTPBackupCodesResponse(listOf("CODE")))
    }

    private class RecordingLogger : Logger {
        val records = mutableListOf<LogRecord>()

        override fun log(
            level: LogLevel,
            event: String,
            fields: Map<String, String>,
        ) {
            records.add(LogRecord(level, event, fields))
        }
    }

    private companion object {
        fun success(status: TOTPStatus): Resource<TOTPStatus> = Resource.Success(status, fetchedAt = 100L, stale = false)

        fun enrollment(codes: List<String> = listOf("AAAA")): TOTPEnrollment =
            TOTPEnrollment(
                secret = "SECRET",
                otpauthUri = "otpauth://totp/teslasync",
                qrDataUri = "data:image/png;base64,",
                backupCodes = codes,
                expiresAt = "2026-01-01T00:15:00Z",
            )

        fun sampleEnrollment(): TOTPEnrollment =
            TOTPEnrollment(
                secret = "SECRET",
                otpauthUri = "otpauth://totp/teslasync",
                qrDataUri = "data:image/png;base64,",
                backupCodes = listOf("AAAA"),
                expiresAt = "2026-01-01T00:15:00Z",
            )
    }
}
