// Off-device unit coverage for the DashboardsPage power-user surface — the framework-free model (the curated catalog
// sort + the copy-to-clipboard outcome machine the web `handleCopy` owns) and the [DashboardsPageViewModel] state
// (the immediate `success` surface + the draft / copy-status orchestration). No Compose, no Android framework, no
// HTTP — runs in :android:testDebugUnitTest.
//
// `InvalidPackageDeclaration` is suppressed: the surface's mandated directory (com/teslasync/poweruser) diverges from
// the `io.teslasync.android.*` package the rest of the app uses.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.poweruser.dashboards

import io.teslasync.android.data.NoopLogger
import io.teslasync.android.data.UiPhase
import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

@OptIn(ExperimentalCoroutinesApi::class)
class DashboardsPageTest {
    private class FakeClipboard(
        override val isAvailable: Boolean = true,
        private val writeResult: Boolean = true,
    ) : ClipboardTarget {
        var writeCalls = 0
        var lastWritten: String? = null

        override fun write(text: String): Boolean {
            writeCalls++
            lastWritten = text
            return writeResult
        }
    }

    private class RecordingLogger : Logger {
        val events = mutableListOf<Pair<String, Map<String, String>>>()

        override fun log(
            level: LogLevel,
            event: String,
            fields: Map<String, String>,
        ) {
            events += event to fields
        }
    }

    // ── Model: curated catalog ────────────────────────────────────────────────────────────────────────────────

    @Test
    fun curatedCatalog_holdsTheSixWebPanels() {
        assertEquals(6, CURATED_DASHBOARD_PANELS.size)
        assertTrue(CURATED_DASHBOARD_PANELS.any { it.name == "drives_per_day_timeseries" })
        assertTrue(CURATED_DASHBOARD_PANELS.any { it.name == "energy_used_per_day_barchart" })
        // Descriptions are the verbatim web reference data, not i18n.
        assertEquals(
            "Stat panel: latest BatteryLevel sample from signal_log_view",
            CURATED_DASHBOARD_PANELS.single { it.name == "battery_soc_stat" }.description,
        )
    }

    @Test
    fun sortedCuratedPanels_areAlphabeticalByName() {
        val names = sortedCuratedPanels().map { it.name }
        assertEquals(
            listOf(
                "alerts_count_stat",
                "battery_soc_stat",
                "charging_sessions_table",
                "drives_per_day_timeseries",
                "energy_used_per_day_barchart",
                "vehicles_table",
            ),
            names,
        )
    }

    // ── Model: copy-to-clipboard outcome machine ──────────────────────────────────────────────────────────────

    @Test
    fun evaluateCopyStatus_blankDraftIsEmptyAndNeverWrites() {
        val clipboard = FakeClipboard()
        assertEquals(CopyStatus.Empty, evaluateCopyStatus("", clipboard))
        assertEquals(CopyStatus.Empty, evaluateCopyStatus("   \n\t ", clipboard))
        assertEquals(0, clipboard.writeCalls)
    }

    @Test
    fun evaluateCopyStatus_unavailableClipboardIsUnavailable() {
        val clipboard = FakeClipboard(isAvailable = false)
        assertEquals(CopyStatus.Unavailable, evaluateCopyStatus("{\"title\":\"x\"}", clipboard))
        assertEquals(0, clipboard.writeCalls)
    }

    @Test
    fun evaluateCopyStatus_writesTrimmedEnvelopeOnSuccess() {
        val clipboard = FakeClipboard(writeResult = true)
        assertEquals(CopyStatus.Success, evaluateCopyStatus("   {\"title\":\"x\"}   ", clipboard))
        assertEquals("{\"title\":\"x\"}", clipboard.lastWritten)
    }

    @Test
    fun evaluateCopyStatus_failedWriteIsFailed() {
        val clipboard = FakeClipboard(writeResult = false)
        assertEquals(CopyStatus.Failed, evaluateCopyStatus("{\"title\":\"x\"}", clipboard))
        assertEquals(1, clipboard.writeCalls)
    }

    // ── Model: registration identity ──────────────────────────────────────────────────────────────────────────

    @Test
    fun registration_mirrorsTheWebRoute() {
        assertEquals("powerDashboards", DashboardsPageRegistration.ROUTE_ID)
        assertEquals("/power/dashboards", DashboardsPageRegistration.WEB_PATH)
        assertEquals("DashboardsPage", DashboardsPageRegistration.SLUG)
    }

    // ── ViewModel: success state + draft/copy orchestration ───────────────────────────────────────────────────

    @Test
    fun state_isImmediateSuccessOverTheSortedCatalog() =
        runTest(UnconfinedTestDispatcher()) {
            val vm = viewModel()
            val state = vm.state.value
            assertEquals(UiPhase.Content, state.phase)
            assertEquals(sortedCuratedPanels(), state.data?.panels)
        }

    @Test
    fun copy_emptyDraftPublishesEmptyStatus() =
        runTest(UnconfinedTestDispatcher()) {
            val vm = viewModel()
            vm.copy(FakeClipboard())
            assertEquals(CopyStatus.Empty, vm.copyStatus.value)
        }

    @Test
    fun copy_filledDraftPublishesSuccessAndKeepsTheDraft() =
        runTest(UnconfinedTestDispatcher()) {
            val vm = viewModel()
            vm.updateDraft("{\"title\":\"Fleet overview\"}")
            val clipboard = FakeClipboard(writeResult = true)
            vm.copy(clipboard)
            assertEquals(CopyStatus.Success, vm.copyStatus.value)
            assertEquals("{\"title\":\"Fleet overview\"}", clipboard.lastWritten)
            assertEquals("{\"title\":\"Fleet overview\"}", vm.draft.value)
        }

    @Test
    fun clear_resetsDraftAndStatus() =
        runTest(UnconfinedTestDispatcher()) {
            val vm = viewModel()
            vm.updateDraft("{}")
            vm.copy(FakeClipboard(isAvailable = false))
            assertEquals(CopyStatus.Unavailable, vm.copyStatus.value)

            vm.clear()
            assertEquals("", vm.draft.value)
            assertEquals(CopyStatus.None, vm.copyStatus.value)
        }

    @Test
    fun recordViewOpened_emitsSlugExactlyOnce() =
        runTest(UnconfinedTestDispatcher()) {
            val logger = RecordingLogger()
            val vm = viewModel(logger)

            vm.recordViewOpened()
            vm.recordViewOpened()

            val opened = logger.events.filter { it.first == "view.opened" }
            assertEquals(1, opened.size)
            assertEquals(mapOf("surface" to "DashboardsPage"), opened.single().second)
            assertNull(vm.state.value.errorKind)
        }

    private fun TestScope.viewModel(logger: Logger = NoopLogger): DashboardsPageViewModel =
        DashboardsPageViewModel(logger, backgroundScope)
}
