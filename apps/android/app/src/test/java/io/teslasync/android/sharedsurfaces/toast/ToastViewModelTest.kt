// Tests [ToastViewModel] against the toast-queue seam — the contract the view depends on: each
// controller queue folds onto the [ToastHostState] the host renders, the per-toast auto-dismiss removes
// a toast after its `durationMillis` (the web `setTimeout(() => dismiss(id), duration)`), a pinned toast
// (duration 0) is never auto-dismissed, a manual dismiss cancels the timer so it fires once, action
// invocation navigates/runs-then-dismisses (web `handleAction`), and the one-shot `view.opened` fires
// exactly once with the surface slug. The framework-free model is covered by ToastModelTest. Runs in
// :android:testReleaseUnitTest.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.toast

import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.LogRecord
import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.advanceTimeBy
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

@OptIn(ExperimentalCoroutinesApi::class)
class ToastViewModelTest {
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

    private class FakeController(
        initial: List<ToastMessage> = emptyList(),
    ) : ToastController {
        val queue = MutableStateFlow(initial)
        val dismissed = mutableListOf<String>()

        override val toasts: StateFlow<List<ToastMessage>> = queue

        override fun show(message: ToastMessage): String {
            queue.update { enqueueToastMessage(it, message) }
            return message.id
        }

        override fun show(
            tone: ToastTone,
            title: String,
            message: String?,
            durationMillis: Long,
            action: ToastAction?,
        ): String = show(ToastMessage("auto", tone, title, message, durationMillis, action))

        override fun dismiss(id: String) {
            dismissed += id
            queue.update { dismissToastMessage(it, id) }
        }

        override fun clear() {
            queue.value = emptyList()
        }
    }

    private fun message(
        id: String,
        tone: ToastTone = ToastTone.Info,
        durationMillis: Long = ToastRegistration.DEFAULT_DURATION_MILLIS,
        action: ToastAction? = null,
    ) = ToastMessage(id = id, tone = tone, title = "t-$id", durationMillis = durationMillis, action = action)

    @Test
    fun stateReflectsTheControllerQueue() =
        runTest(UnconfinedTestDispatcher()) {
            val controller = FakeController(listOf(message("a"), message("b", ToastTone.Error)))
            val model = ToastViewModel(controller, RecordingLogger(), scope = backgroundScope)
            runCurrent()

            assertTrue(model.state.value.isVisible)
            assertEquals(
                listOf("a", "b"),
                model.state.value.toasts
                    .map { it.id },
            )
            assertTrue(model.state.value.hasAssertive)
        }

    @Test
    fun anEmptyControllerYieldsAnEmptyState() =
        runTest(UnconfinedTestDispatcher()) {
            val model = ToastViewModel(FakeController(), RecordingLogger(), scope = backgroundScope)
            runCurrent()

            assertTrue(model.state.value.isEmpty)
        }

    @Test
    fun autoDismissesEachToastAfterItsDuration() =
        runTest(UnconfinedTestDispatcher()) {
            val controller = FakeController(listOf(message("a", durationMillis = 1_000L)))
            ToastViewModel(controller, RecordingLogger(), scope = backgroundScope)
            runCurrent()

            advanceTimeBy(999L)
            runCurrent()
            assertTrue("must not dismiss before the duration elapses", controller.dismissed.isEmpty())

            advanceTimeBy(2L)
            runCurrent()
            assertEquals(listOf("a"), controller.dismissed)
        }

    @Test
    fun aPinnedToastIsNeverAutoDismissed() =
        runTest(UnconfinedTestDispatcher()) {
            val controller = FakeController(listOf(message("a", durationMillis = 0L)))
            ToastViewModel(controller, RecordingLogger(), scope = backgroundScope)
            runCurrent()

            advanceUntilIdle()
            assertTrue(controller.dismissed.isEmpty())
        }

    @Test
    fun manualDismissRemovesOnceAndCancelsTheAutoDismissTimer() =
        runTest(UnconfinedTestDispatcher()) {
            val controller = FakeController(listOf(message("a", durationMillis = 1_000L)))
            val model = ToastViewModel(controller, RecordingLogger(), scope = backgroundScope)
            runCurrent()

            model.dismiss("a")
            advanceUntilIdle()

            assertEquals("the auto-dismiss timer must not fire a second dismiss", listOf("a"), controller.dismissed)
        }

    @Test
    fun invokeNavigationActionRoutesThenDismisses() =
        runTest(UnconfinedTestDispatcher()) {
            val toast = message("a", action = ToastAction.Navigate(label = "View", route = "/battery"))
            val controller = FakeController(listOf(toast))
            val model = ToastViewModel(controller, RecordingLogger(), scope = backgroundScope)
            runCurrent()
            val routed = mutableListOf<String>()

            model.invokeAction(toast) { routed += it }

            assertEquals(listOf("/battery"), routed)
            assertEquals(listOf("a"), controller.dismissed)
        }

    @Test
    fun invokeCallbackActionRunsThenDismisses() =
        runTest(UnconfinedTestDispatcher()) {
            var fired = false
            val toast = message("a", action = ToastAction.Callback(label = "Undo", onInvoke = { fired = true }))
            val controller = FakeController(listOf(toast))
            val model = ToastViewModel(controller, RecordingLogger(), scope = backgroundScope)
            runCurrent()

            model.invokeAction(toast) {}

            assertTrue(fired)
            assertEquals(listOf("a"), controller.dismissed)
        }

    @Test
    fun invokeActionIsANoOpWhenThereIsNoAction() =
        runTest(UnconfinedTestDispatcher()) {
            val toast = message("a", durationMillis = 0L)
            val controller = FakeController(listOf(toast))
            val model = ToastViewModel(controller, RecordingLogger(), scope = backgroundScope)
            runCurrent()
            val routed = mutableListOf<String>()

            model.invokeAction(toast) { routed += it }

            assertTrue(routed.isEmpty())
            assertTrue(controller.dismissed.isEmpty())
        }

    @Test
    fun viewOpenedEmitsDiagnosticOnceWithSlug() =
        runTest(UnconfinedTestDispatcher()) {
            val logger = RecordingLogger()
            val model = ToastViewModel(FakeController(), logger, scope = backgroundScope)

            model.recordViewOpened()
            model.recordViewOpened()

            val opened = logger.records.filter { it.event == "view.opened" }
            assertEquals(1, opened.size)
            assertEquals("Toast", opened.first().fields["surface"])
            assertTrue("diagnostics carry only the surface slug", opened.first().fields.keys == setOf("surface"))
        }
}
