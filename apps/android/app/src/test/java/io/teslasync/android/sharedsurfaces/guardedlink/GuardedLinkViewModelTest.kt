// Off-device coverage of [GuardedLinkViewModel] against the real [DefaultNavigationGuard] seam — every
// behaviour the web `GuardedLink` click handler defines over `useNavigationGuardContext`: a clean tree
// navigates at once, a bypass skips the guard, a dirty tree opens a confirmation whose discard navigates
// and whose keep-editing cancels, a duplicate tap while confirming is dropped (web in-flight reuse),
// an un-registered guard stops blocking, and the PII-safe `view.opened` / navigate diagnostics. The
// framework-free model is covered by GuardedLinkModelTest. Runs in :android:testReleaseUnitTest.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.guardedlink

import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.LogRecord
import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

@OptIn(ExperimentalCoroutinesApi::class)
class GuardedLinkViewModelTest {
    private class RecordingLogger : Logger {
        val records = mutableListOf<LogRecord>()

        override fun log(
            level: LogLevel,
            event: String,
            fields: Map<String, String>,
        ) {
            records += LogRecord(level, event, fields)
        }
    }

    private class NavRecorder {
        var count = 0
            private set

        val navigate: () -> Unit = { count++ }
    }

    private fun dirtyEntry(message: String? = null): NavigationGuardEntry =
        NavigationGuardEntry(id = "form", isDirty = { true }, getMessage = { message })

    private fun outcomes(logger: RecordingLogger): List<String> =
        logger.records.filter { it.event == EVENT_NAVIGATE }.map { it.fields.getValue(FIELD_OUTCOME) }

    @Test
    fun cleanTreeNavigatesImmediately() =
        runTest(UnconfinedTestDispatcher()) {
            val logger = RecordingLogger()
            val nav = NavRecorder()
            val model = GuardedLinkViewModel(DefaultNavigationGuard(), logger, backgroundScope)

            model.attemptNavigation(bypassGuard = false, navigate = nav.navigate)
            advanceUntilIdle()

            assertEquals(1, nav.count)
            assertFalse(model.state.value.isConfirming)
            assertNull(model.confirmRequest.value)
            assertEquals(listOf("allowed"), outcomes(logger))
        }

    @Test
    fun bypassSkipsTheGuardEvenWhenDirty() =
        runTest(UnconfinedTestDispatcher()) {
            val logger = RecordingLogger()
            val nav = NavRecorder()
            val guard = DefaultNavigationGuard()
            val model = GuardedLinkViewModel(guard, logger, backgroundScope)
            model.registerDirtyGuard(dirtyEntry("unsaved"))

            model.attemptNavigation(bypassGuard = true, navigate = nav.navigate)
            advanceUntilIdle()

            assertEquals(1, nav.count)
            assertNull(guard.confirmRequest.value)
            assertEquals(listOf("bypassed"), outcomes(logger))
        }

    @Test
    fun dirtyTreeOpensConfirmationThenDiscardNavigates() =
        runTest(UnconfinedTestDispatcher()) {
            val logger = RecordingLogger()
            val nav = NavRecorder()
            val model = GuardedLinkViewModel(DefaultNavigationGuard(), logger, backgroundScope)
            model.registerDirtyGuard(dirtyEntry("You have an unsaved alert rule."))

            model.attemptNavigation(bypassGuard = false, navigate = nav.navigate)
            advanceUntilIdle()

            // The confirmation is open: link is busy, the prompt carries the blocking guard's message.
            assertTrue(model.state.value.isConfirming)
            assertNotNull(model.confirmRequest.value)
            assertEquals("You have an unsaved alert rule.", model.confirmRequest.value?.message)
            assertEquals(0, nav.count)

            model.respondToConfirm(discard = true)
            advanceUntilIdle()

            assertEquals(1, nav.count)
            assertFalse(model.state.value.isConfirming)
            assertNull(model.confirmRequest.value)
            assertEquals(listOf("allowed"), outcomes(logger))
        }

    @Test
    fun keepEditingCancelsNavigation() =
        runTest(UnconfinedTestDispatcher()) {
            val logger = RecordingLogger()
            val nav = NavRecorder()
            val model = GuardedLinkViewModel(DefaultNavigationGuard(), logger, backgroundScope)
            model.registerDirtyGuard(dirtyEntry("unsaved"))

            model.attemptNavigation(bypassGuard = false, navigate = nav.navigate)
            advanceUntilIdle()
            model.respondToConfirm(discard = false)
            advanceUntilIdle()

            assertEquals(0, nav.count)
            assertFalse(model.state.value.isConfirming)
            assertNull(model.confirmRequest.value)
            assertEquals(listOf("blocked"), outcomes(logger))
        }

    @Test
    fun duplicateTapWhileConfirmingIsDropped() =
        runTest(UnconfinedTestDispatcher()) {
            val logger = RecordingLogger()
            val nav = NavRecorder()
            val model = GuardedLinkViewModel(DefaultNavigationGuard(), logger, backgroundScope)
            model.registerDirtyGuard(dirtyEntry("unsaved"))

            model.attemptNavigation(bypassGuard = false, navigate = nav.navigate)
            advanceUntilIdle()
            // Second tap while the dialog is open reuses the in-flight confirmation (web pendingPromiseRef).
            model.attemptNavigation(bypassGuard = false, navigate = nav.navigate)
            advanceUntilIdle()

            model.respondToConfirm(discard = true)
            advanceUntilIdle()

            // Only the first attempt's navigation runs; the duplicate was deferred, not stacked.
            assertEquals(1, nav.count)
            assertEquals(listOf("deferred", "allowed"), outcomes(logger))
        }

    @Test
    fun unregisteringTheGuardStopsBlocking() =
        runTest(UnconfinedTestDispatcher()) {
            val logger = RecordingLogger()
            val nav = NavRecorder()
            val model = GuardedLinkViewModel(DefaultNavigationGuard(), logger, backgroundScope)
            val unregister = model.registerDirtyGuard(dirtyEntry("unsaved"))

            unregister()
            model.attemptNavigation(bypassGuard = false, navigate = nav.navigate)
            advanceUntilIdle()

            assertEquals(1, nav.count)
            assertNull(model.confirmRequest.value)
            assertEquals(listOf("allowed"), outcomes(logger))
        }

    @Test
    fun viewOpenedEmitsDiagnosticOnceWithSlug() =
        runTest(UnconfinedTestDispatcher()) {
            val logger = RecordingLogger()
            val model = GuardedLinkViewModel(DefaultNavigationGuard(), logger, backgroundScope)

            model.onViewOpened()
            model.onViewOpened()

            val opened = logger.records.filter { it.event == EVENT_VIEW_OPENED }
            assertEquals(1, opened.size)
            assertEquals(GuardedLinkRegistration.SLUG, opened.single().fields[FIELD_SURFACE])
        }
}
