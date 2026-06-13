// Off-device unit tests for [BulkActionsToolbarViewModel] + its [DialogBulkConfirmer] adapter over controllable
// fakes (the :android:testReleaseUnitTest gate). They cover the run lifecycle the web `runAction` drives —
// performing with the current selection, the per-action pending flag raised in flight and always cleared
// afterwards (web `finally`), the in-flight re-entry guard (web `if (pending[id]) return`), the optional confirm
// gate (approved → perform, declined → skip), and a failed action clearing pending + emitting only a redacted
// diagnostic (no visible error surface, web parity) — plus the PII-safe `view.opened` diagnostic, and the
// confirmer round-trip the web `useConfirm` resolves (publish request → respond, and a new request cancelling a
// still-open one as declined).
//
// `InvalidPackageDeclaration` is not needed here — the test lives in the surface's real package directory.
package io.teslasync.android.sharedsurfaces.bulkactionstoolbar

import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.ExperimentalCoroutinesApi
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

@OptIn(ExperimentalCoroutinesApi::class)
class BulkActionsToolbarViewModelTest {
    // ── run lifecycle (web runAction) ───────────────────────────────────────────────────────────────────────────
    @Test
    fun runWithoutConfirmPerformsWithCurrentSelection() =
        runTest(UnconfinedTestDispatcher()) {
            val vm = viewModel()
            var performedWith: List<String>? = null

            vm.setSelection(listOf("1", "2"))
            vm.run("export") { ids -> performedWith = ids }
            advanceUntilIdle()

            assertEquals(listOf("1", "2"), performedWith)
            assertFalse(vm.state.value.isPending("export"))
        }

    @Test
    fun runRaisesPendingWhileInFlightAndClearsAfter() =
        runTest(UnconfinedTestDispatcher()) {
            val vm = viewModel()
            val gate = CompletableDeferred<Unit>()

            vm.run("export") { gate.await() }
            advanceUntilIdle()
            assertTrue(vm.state.value.isPending("export"))

            gate.complete(Unit)
            advanceUntilIdle()
            assertFalse(vm.state.value.isPending("export"))
        }

    @Test
    fun rerunWhilePendingIsIgnored() =
        runTest(UnconfinedTestDispatcher()) {
            val vm = viewModel()
            val gate = CompletableDeferred<Unit>()
            var calls = 0

            vm.run("export") {
                gate.await()
                calls++
            }
            advanceUntilIdle()
            vm.run("export") { calls++ }
            advanceUntilIdle()

            gate.complete(Unit)
            advanceUntilIdle()
            assertEquals(1, calls)
        }

    @Test
    fun failedActionClearsPendingAndLogsRedactedFailure() =
        runTest(UnconfinedTestDispatcher()) {
            val logger = RecordingLogger()
            val vm = viewModel(logger = logger)

            vm.run("delete") { throw IllegalStateException("boom") }
            advanceUntilIdle()

            assertFalse(vm.state.value.isPending("delete"))
            val failure = logger.events.single { it.first == "bulkActionsToolbar.actionFailed" }
            assertEquals("delete", failure.second["action"])
            assertEquals("IllegalStateException", failure.second["error"])
        }

    // ── confirm gate (web await confirm(...)) ───────────────────────────────────────────────────────────────────
    @Test
    fun confirmApprovedRunsThePerform() =
        runTest(UnconfinedTestDispatcher()) {
            val confirmer = FakeBulkConfirmer(approve = true)
            val vm = viewModel(confirmer)
            val request = dangerRequest()
            var performed = false

            vm.run("delete", request) { performed = true }
            advanceUntilIdle()

            assertEquals(listOf(request), confirmer.requests)
            assertTrue(performed)
            assertFalse(vm.state.value.isPending("delete"))
        }

    @Test
    fun confirmDeclinedSkipsThePerform() =
        runTest(UnconfinedTestDispatcher()) {
            val confirmer = FakeBulkConfirmer(approve = false)
            val vm = viewModel(confirmer)
            val request = dangerRequest()
            var performed = false

            vm.run("delete", request) { performed = true }
            advanceUntilIdle()

            assertEquals(listOf(request), confirmer.requests)
            assertFalse(performed)
            assertFalse(vm.state.value.isPending("delete"))
        }

    @Test
    fun confirmDialogRoundTripPerformsAfterRespond() =
        runTest(UnconfinedTestDispatcher()) {
            val confirmer = DialogBulkConfirmer()
            val vm = viewModel(confirmer)
            val request = dangerRequest()
            var performed = false

            vm.run("delete", request) { performed = true }
            advanceUntilIdle()
            assertEquals(request, vm.confirmDialog.value)

            vm.respondToConfirm(true)
            advanceUntilIdle()
            assertTrue(performed)
            assertNull(vm.confirmDialog.value)
        }

    // ── diagnostics (P1/S11) ────────────────────────────────────────────────────────────────────────────────────
    @Test
    fun onViewOpenedEmitsSlugExactlyOnce() =
        runTest(UnconfinedTestDispatcher()) {
            val logger = RecordingLogger()
            val vm = viewModel(logger = logger)

            vm.onViewOpened()
            vm.onViewOpened()

            val opened = logger.events.filter { it.first == "view.opened" }
            assertEquals(1, opened.size)
            assertEquals(mapOf("slug" to "BulkActionsToolbar"), opened.single().second)
        }

    // ── confirmer adapter (web useConfirm round-trip) ───────────────────────────────────────────────────────────
    @Test
    fun dialogConfirmerPublishesRequestAndResolvesTrueOnRespond() =
        runTest(UnconfinedTestDispatcher()) {
            val confirmer = DialogBulkConfirmer()
            val request = dangerRequest()
            var result: Boolean? = null

            backgroundScope.launch { result = confirmer.confirm(request) }
            advanceUntilIdle()
            assertEquals(request, confirmer.dialog.value)

            confirmer.respond(true)
            advanceUntilIdle()
            assertEquals(true, result)
            assertNull(confirmer.dialog.value)
        }

    @Test
    fun dialogConfirmerResolvesFalseOnCancel() =
        runTest(UnconfinedTestDispatcher()) {
            val confirmer = DialogBulkConfirmer()
            var result: Boolean? = null

            backgroundScope.launch { result = confirmer.confirm(warningRequest()) }
            advanceUntilIdle()

            confirmer.respond(false)
            advanceUntilIdle()
            assertEquals(false, result)
            assertNull(confirmer.dialog.value)
        }

    @Test
    fun newConfirmCancelsTheStillOpenOneAsDeclined() =
        runTest(UnconfinedTestDispatcher()) {
            val confirmer = DialogBulkConfirmer()
            val first = dangerRequest()
            val second = warningRequest()
            var firstResult: Boolean? = null
            var secondResult: Boolean? = null

            backgroundScope.launch { firstResult = confirmer.confirm(first) }
            advanceUntilIdle()
            assertEquals(first, confirmer.dialog.value)

            backgroundScope.launch { secondResult = confirmer.confirm(second) }
            advanceUntilIdle()
            assertEquals(false, firstResult)
            assertEquals(second, confirmer.dialog.value)

            confirmer.respond(true)
            advanceUntilIdle()
            assertEquals(true, secondResult)
        }

    // ── fixtures ────────────────────────────────────────────────────────────────────────────────────────────────
    private fun TestScope.viewModel(
        confirmer: BulkConfirmer = FakeBulkConfirmer(),
        logger: Logger = RecordingLogger(),
    ): BulkActionsToolbarViewModel = BulkActionsToolbarViewModel(confirmer, logger, scope = backgroundScope)

    private fun dangerRequest(): BulkConfirmRequest =
        BulkConfirmRequest(
            title = "Delete drives?",
            message = "This cannot be undone.",
            confirmLabel = "Delete",
            severity = BulkConfirmSeverity.Danger,
        )

    private fun warningRequest(): BulkConfirmRequest =
        BulkConfirmRequest(
            title = "Archive drives?",
            message = "You can restore them later.",
            confirmLabel = "Archive",
            severity = BulkConfirmSeverity.Warning,
        )
}
