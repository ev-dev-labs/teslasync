package io.teslasync.android.miscsurfaces.tourlauncher

import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.LogRecord
import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Drives [TourLauncherViewModel] over a fake [TourLauncherSource] — covering the live completion snapshot it
 * re-publishes, the one-shot `view.opened` diagnostic (P1/S11), and the launcher actions (markSeen + refresh
 * on open, start telemetry, reset). Mirrors the web component's state + actions
 * (web/src/features/onboarding/TourLauncher.tsx: `markTourListSeen`, `dispatchTourStart`, `resetAllTours`).
 * Run by the offline `:android:testReleaseUnitTest` gate; the Compose render + accessibility live in
 * TourLauncherUiTest.
 */
class TourLauncherViewModelTest {
    @Test
    fun completionsReflectsTheSourceSnapshot() {
        val initial = TourCompletions(mapOf(TourStorage.completionKey("main", 2) to TourCompletionStatus.Completed))
        val vm = TourLauncherViewModel(FakeSource(initial), RecordingLogger())

        assertTrue(vm.completions.value.isCompleted("main", 2))
    }

    @Test
    fun viewOpenedEmitsDiagnosticOnceWithSurfaceSlug() {
        val logger = RecordingLogger()
        val vm = TourLauncherViewModel(FakeSource(), logger)

        vm.onViewOpened()
        vm.onViewOpened()

        val opened = logger.records.filter { it.event == "view.opened" }
        assertEquals(1, opened.size)
        assertEquals("TourLauncher", opened.single().fields["surface"])
    }

    @Test
    fun launcherOpenedMarksListSeenRefreshesAndLogs() {
        val logger = RecordingLogger()
        val source = FakeSource()
        val vm = TourLauncherViewModel(source, logger)

        vm.onLauncherOpened()

        assertEquals(1, source.markSeenCalls)
        assertEquals(1, source.refreshCalls)
        assertTrue(logger.records.any { it.event == "tourLauncher.opened" })
    }

    @Test
    fun startTourLogsWithTheTourId() {
        val logger = RecordingLogger()
        val vm = TourLauncherViewModel(FakeSource(), logger)

        vm.startTour("charging")

        val start = logger.records.single { it.event == "tourLauncher.start" }
        assertEquals("charging", start.fields["tour"])
        assertEquals("TourLauncher", start.fields["surface"])
    }

    @Test
    fun resetAllCallsSourceLogsAndClearsCompletions() {
        val logger = RecordingLogger()
        val source = FakeSource(TourCompletions(mapOf(TourStorage.completionKey("main", 2) to TourCompletionStatus.Completed)))
        val vm = TourLauncherViewModel(source, logger)
        assertTrue(vm.completions.value.isCompleted("main", 2))

        vm.resetAll()

        assertEquals(1, source.resetCalls)
        assertEquals(TourCompletions.EMPTY, vm.completions.value)
        assertTrue(logger.records.any { it.event == "tourLauncher.resetAll" })
    }

    // ── fakes ───────────────────────────────────────────────────────────────────────
    private class FakeSource(
        initial: TourCompletions = TourCompletions.EMPTY,
    ) : TourLauncherSource {
        private val state = MutableStateFlow(initial)
        var resetCalls = 0
            private set
        var markSeenCalls = 0
            private set
        var refreshCalls = 0
            private set

        override fun completions(): StateFlow<TourCompletions> = state.asStateFlow()

        override fun resetAll() {
            resetCalls++
            state.value = TourCompletions.EMPTY
        }

        override fun markListSeen() {
            markSeenCalls++
        }

        override fun refresh() {
            refreshCalls++
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
}
