// Off-device coverage of [PinButtonViewModel] against the [PinButtonSource] seam with a fake pin feed +
// recording toggle — every behaviour the web `PinButton` composition over `usePinned` + `useTogglePin`
// defines: the feed projects to the pin state (web `isPinned`), a tap pins an unpinned item / unpins a
// pinned item with the right direction + localized toast (web `onSuccess`), a failed toggle raises the
// error toast and clears the pending flag (web `onError`), a tap while a toggle is in flight is ignored
// (web `if (toggle.isPending) return`), retry re-fetches the feed, a null toast host degrades gracefully
// (web `useOptionalToast`), the PII-safe toggle diagnostics never carry the item id, and the one-shot
// `view.opened` diagnostic. The framework-free model is covered by PinButtonModelTest. Runs in
// :android:testReleaseUnitTest.
package io.teslasync.android.sharedsurfaces.pinbutton

import io.teslasync.android.sharedsurfaces.toast.DefaultToastController
import io.teslasync.android.sharedsurfaces.toast.ToastController
import io.teslasync.android.sharedsurfaces.toast.ToastTone
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.LogRecord
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.presentation.pinned.PinnedItem
import io.teslasync.shared.core.presentation.pinned.PinnedItemType
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

@OptIn(ExperimentalCoroutinesApi::class)
class PinButtonViewModelTest {
    private data class ToggleCall(
        val type: PinnedItemType,
        val itemId: String,
        val pin: Boolean,
        val context: String?,
    )

    private class FakeSource(
        initial: Resource<List<PinnedItem>>,
    ) : PinButtonSource {
        val pinnedFlow = MutableStateFlow(initial)
        val toggleCalls = mutableListOf<ToggleCall>()
        var toggleResult: Result<PinnedItem?> = Result.success(null)
        var refreshCount = 0
            private set

        /** When set, [togglePin] suspends on this gate so a test can observe the in-flight pending state. */
        var gate: CompletableDeferred<Unit>? = null

        override fun pinned(
            type: PinnedItemType,
            context: String?,
        ): Flow<Resource<List<PinnedItem>>> = pinnedFlow

        override suspend fun togglePin(
            type: PinnedItemType,
            itemId: String,
            pin: Boolean,
            context: String?,
        ): Result<PinnedItem?> {
            toggleCalls += ToggleCall(type, itemId, pin, context)
            gate?.await()
            return toggleResult
        }

        override fun refresh() {
            refreshCount++
        }
    }

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

    private val copy =
        PinButtonToastCopy(
            pinnedSuccess = "Pinned",
            pinnedError = "Failed to pin",
            unpinnedSuccess = "Unpinned",
            unpinnedError = "Failed to unpin",
        )

    private fun pin(itemId: String): PinnedItem =
        PinnedItem(id = 1, itemType = PinnedItemType.Vehicle, itemId = itemId, position = 0, pinnedAt = "2026-01-01T00:00:00Z")

    private fun success(items: List<PinnedItem>): Resource<List<PinnedItem>> = Resource.Success(items, fetchedAt = 100L, stale = false)

    private fun vm(
        source: PinButtonSource,
        scope: CoroutineScope,
        itemId: String = "42",
        logger: Logger = RecordingLogger(),
    ): PinButtonViewModel = PinButtonViewModel(source, PinnedItemType.Vehicle, itemId, null, logger, scope)

    private fun outcomes(logger: RecordingLogger): List<String> =
        logger.records.filter { it.event == EVENT_TOGGLE }.map { it.fields.getValue(FIELD_OUTCOME) }

    @Test
    fun feedProjectsToThePinState() =
        runTest(UnconfinedTestDispatcher()) {
            val source = FakeSource(success(listOf(pin("42"))))
            val model = vm(source, backgroundScope)
            backgroundScope.launch { model.state.collect {} }
            advanceUntilIdle()

            val state = model.state.value
            assertTrue(state.data?.isPinned ?: false)
            assertTrue(state.isContent)
        }

    @Test
    fun unrelatedPinsLeaveTheItemUnpinned() =
        runTest(UnconfinedTestDispatcher()) {
            val source = FakeSource(success(listOf(pin("7"))))
            val model = vm(source, backgroundScope, itemId = "42")
            backgroundScope.launch { model.state.collect {} }
            advanceUntilIdle()

            val state = model.state.value
            assertFalse(state.data?.isPinned ?: true)
        }

    @Test
    fun togglePinsAnUnpinnedItemAndRaisesTheSuccessToast() =
        runTest(UnconfinedTestDispatcher()) {
            val source = FakeSource(success(emptyList()))
            val logger = RecordingLogger()
            val toast = DefaultToastController()
            val model = vm(source, backgroundScope, logger = logger)
            backgroundScope.launch { model.state.collect {} }
            advanceUntilIdle()

            model.toggle(copy, toast)
            advanceUntilIdle()

            val call = source.toggleCalls.single()
            assertEquals(ToggleCall(PinnedItemType.Vehicle, "42", true, null), call)
            val raised = toast.toasts.value.single()
            assertEquals(ToastTone.Success, raised.tone)
            assertEquals("Pinned", raised.title)
            assertEquals(listOf("pinned"), outcomes(logger))
        }

    @Test
    fun toggleUnpinsAPinnedItemAndRaisesTheUnpinnedToast() =
        runTest(UnconfinedTestDispatcher()) {
            val source = FakeSource(success(listOf(pin("42"))))
            val logger = RecordingLogger()
            val toast = DefaultToastController()
            val model = vm(source, backgroundScope, logger = logger)
            backgroundScope.launch { model.state.collect {} }
            advanceUntilIdle()

            model.toggle(copy, toast)
            advanceUntilIdle()

            assertFalse(source.toggleCalls.single().pin)
            val raised = toast.toasts.value.single()
            assertEquals(ToastTone.Success, raised.tone)
            assertEquals("Unpinned", raised.title)
            assertEquals(listOf("unpinned"), outcomes(logger))
        }

    @Test
    fun failedToggleRaisesTheErrorToastAndClearsPending() =
        runTest(UnconfinedTestDispatcher()) {
            val source = FakeSource(success(emptyList()))
            source.toggleResult = Result.failure(IllegalStateException("network down"))
            val logger = RecordingLogger()
            val toast = DefaultToastController()
            val model = vm(source, backgroundScope, logger = logger)
            backgroundScope.launch { model.state.collect {} }
            advanceUntilIdle()

            model.toggle(copy, toast)
            advanceUntilIdle()

            val raised = toast.toasts.value.single()
            assertEquals(ToastTone.Error, raised.tone)
            assertEquals("Failed to pin", raised.title)
            assertEquals(listOf("failed"), outcomes(logger))
            assertFalse(model.toggling.value)
        }

    @Test
    fun togglingFlagIsTrueWhileInFlightAndFalseAfter() =
        runTest(UnconfinedTestDispatcher()) {
            val source = FakeSource(success(emptyList()))
            val gate = CompletableDeferred<Unit>()
            source.gate = gate
            val model = vm(source, backgroundScope)
            backgroundScope.launch { model.state.collect {} }
            advanceUntilIdle()

            model.toggle(copy, DefaultToastController())
            runCurrent()
            assertTrue(model.toggling.value)

            gate.complete(Unit)
            advanceUntilIdle()
            assertFalse(model.toggling.value)
        }

    @Test
    fun aSecondTapWhilePendingIsIgnored() =
        runTest(UnconfinedTestDispatcher()) {
            val source = FakeSource(success(emptyList()))
            val gate = CompletableDeferred<Unit>()
            source.gate = gate
            val model = vm(source, backgroundScope)
            backgroundScope.launch { model.state.collect {} }
            advanceUntilIdle()

            model.toggle(copy, DefaultToastController())
            runCurrent()
            // Web `if (toggle.isPending) return` — the second tap must not start a second mutation.
            model.toggle(copy, DefaultToastController())
            runCurrent()
            assertEquals(1, source.toggleCalls.size)

            gate.complete(Unit)
            advanceUntilIdle()
        }

    @Test
    fun retryReFetchesTheFeedAndLogs() =
        runTest(UnconfinedTestDispatcher()) {
            val source = FakeSource(success(listOf(pin("42"))))
            val logger = RecordingLogger()
            val model = vm(source, backgroundScope, logger = logger)
            backgroundScope.launch { model.state.collect {} }
            advanceUntilIdle()

            model.retry()

            assertEquals(1, source.refreshCount)
            assertTrue(logger.records.any { it.event == EVENT_RETRY })
        }

    @Test
    fun nullToastHostNeverCrashes() =
        runTest(UnconfinedTestDispatcher()) {
            val source = FakeSource(success(emptyList()))
            val logger = RecordingLogger()
            val noHost: ToastController? = null
            val model = vm(source, backgroundScope, logger = logger)
            backgroundScope.launch { model.state.collect {} }
            advanceUntilIdle()

            model.toggle(copy, noHost)
            advanceUntilIdle()

            assertEquals(listOf("pinned"), outcomes(logger))
        }

    @Test
    fun toggleDiagnosticsNeverCarryTheItemId() =
        runTest(UnconfinedTestDispatcher()) {
            val source = FakeSource(success(emptyList()))
            val logger = RecordingLogger()
            val model = vm(source, backgroundScope, itemId = "vin-secret-42", logger = logger)
            backgroundScope.launch { model.state.collect {} }
            advanceUntilIdle()

            model.toggle(copy, DefaultToastController())
            advanceUntilIdle()

            assertTrue(logger.records.all { record -> record.fields.values.none { it == "vin-secret-42" } })
            val record = logger.records.single { it.event == EVENT_TOGGLE }
            assertEquals(setOf(FIELD_SURFACE, FIELD_OUTCOME), record.fields.keys)
        }

    @Test
    fun viewOpenedEmitsDiagnosticOnceWithSlug() =
        runTest(UnconfinedTestDispatcher()) {
            val logger = RecordingLogger()
            val model = vm(FakeSource(success(emptyList())), backgroundScope, logger = logger)

            model.onViewOpened()
            model.onViewOpened()

            val opened = logger.records.filter { it.event == EVENT_VIEW_OPENED }
            assertEquals(1, opened.size)
            assertEquals(PinButtonRegistration.SLUG, opened.single().fields[FIELD_SURFACE])
        }
}
