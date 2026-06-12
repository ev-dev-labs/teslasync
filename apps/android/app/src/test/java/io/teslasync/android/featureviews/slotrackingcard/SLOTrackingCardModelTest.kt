package io.teslasync.android.featureviews.slotrackingcard

import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.UiPhase
import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.LogRecord
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.net.ApiError
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.util.Locale

/**
 * Off-device verification of the SLOTrackingCard's pure projection + state holder — the native port of the
 * web component's derivations (the window union, the personal-target `loadTarget`/`handleSaveTarget` clamp,
 * the `tone` thresholds, the `historical_source !== 'series'` caveat gate, the `fmtPercent`/`${target}%`
 * formatters) plus the [SLOTrackingCardViewModel]'s cache-then-network projection (loading → content →
 * empty → error → offline) and the PII-safe `view.opened` diagnostic. Mirrors the web spec
 * (web/src/features/system/components/status/SLOTrackingCard.tsx).
 */
@OptIn(ExperimentalCoroutinesApi::class)
class SLOTrackingCardModelTest {
    // ── StatusWindow (web Window union) ──────────────────────────────────────────────────────────────

    @Test
    fun windowFromWireMapsKnownAndFallsBackToDefault() {
        assertEquals(StatusWindow.H24, StatusWindow.fromWire("24h"))
        assertEquals(StatusWindow.Y1, StatusWindow.fromWire("1y"))
        assertEquals(StatusWindow.DEFAULT, StatusWindow.fromWire("nope"))
        assertEquals(StatusWindow.DEFAULT, StatusWindow.fromWire(null))
        assertEquals(StatusWindow.D30, StatusWindow.DEFAULT)
    }

    // ── UptimeTone (web tone memo) ───────────────────────────────────────────────────────────────────

    @Test
    fun toneClassifiesAgainstTarget() {
        assertEquals(UptimeTone.Unknown, UptimeTone.of(null, 99.0))
        assertEquals(UptimeTone.Unknown, UptimeTone.of(Double.NaN, 99.0))
        assertEquals(UptimeTone.Healthy, UptimeTone.of(99.0, 99.0))
        assertEquals(UptimeTone.Healthy, UptimeTone.of(99.99, 99.0))
        assertEquals(UptimeTone.Warning, UptimeTone.of(98.5, 99.0))
        assertEquals(UptimeTone.Warning, UptimeTone.of(98.0, 99.0))
        assertEquals(UptimeTone.Danger, UptimeTone.of(97.99, 99.0))
    }

    // ── Projection: empty / caveat ───────────────────────────────────────────────────────────────────

    @Test
    fun isEmptyWhenNoFinitePercent() {
        assertTrue(SLOTrackingCardProjection.isEmpty(UptimeWindow(uptimePercent = null)))
        assertTrue(SLOTrackingCardProjection.isEmpty(UptimeWindow(uptimePercent = Double.NaN)))
        assertFalse(SLOTrackingCardProjection.isEmpty(UptimeWindow(uptimePercent = 0.0)))
        assertFalse(SLOTrackingCardProjection.isEmpty(UptimeWindow(uptimePercent = 99.9)))
    }

    @Test
    fun showsCaveatOnlyForNonSeriesSource() {
        assertFalse(SLOTrackingCardProjection.showsCaveat("series"))
        assertFalse(SLOTrackingCardProjection.showsCaveat("  SERIES "))
        assertFalse(SLOTrackingCardProjection.showsCaveat(""))
        assertTrue(SLOTrackingCardProjection.showsCaveat("snapshot"))
    }

    @Test
    fun caveatTextPrefersBackendNote() {
        assertEquals("custom", SLOTrackingCardProjection.caveatText("custom", "fallback"))
        assertEquals("fallback", SLOTrackingCardProjection.caveatText(null, "fallback"))
        assertEquals("fallback", SLOTrackingCardProjection.caveatText("   ", "fallback"))
    }

    // ── Projection: target validation (web handleSaveTarget / loadTarget) ────────────────────────────

    @Test
    fun sanitizeTargetMatchesWebRules() {
        assertEquals(99.0, SLOTrackingCardProjection.sanitizeTarget("99"))
        assertEquals(99.5, SLOTrackingCardProjection.sanitizeTarget(" 99.5 "))
        assertEquals(100.0, SLOTrackingCardProjection.sanitizeTarget("100"))
        assertNull(SLOTrackingCardProjection.sanitizeTarget("0"))
        assertNull(SLOTrackingCardProjection.sanitizeTarget("-5"))
        assertNull(SLOTrackingCardProjection.sanitizeTarget("100.1"))
        assertNull(SLOTrackingCardProjection.sanitizeTarget("abc"))
        assertNull(SLOTrackingCardProjection.sanitizeTarget(""))
        assertNull(SLOTrackingCardProjection.sanitizeTarget(null))
    }

    @Test
    fun clampTargetFallsBackToDefault() {
        assertEquals(DEFAULT_SLO_TARGET, SLOTrackingCardProjection.clampTarget(null), 0.0)
        assertEquals(DEFAULT_SLO_TARGET, SLOTrackingCardProjection.clampTarget(0.0), 0.0)
        assertEquals(DEFAULT_SLO_TARGET, SLOTrackingCardProjection.clampTarget(150.0), 0.0)
        assertEquals(DEFAULT_SLO_TARGET, SLOTrackingCardProjection.clampTarget(Double.NaN), 0.0)
        assertEquals(50.0, SLOTrackingCardProjection.clampTarget(50.0), 0.0)
    }

    // ── Projection: formatters (web fmtPercent / ${target}% / counts) ────────────────────────────────

    @Test
    fun formatPercentMatchesWebFmtPercent() {
        assertEquals("99.95%", SLOTrackingCardProjection.formatPercent(99.95, Locale.US))
        assertEquals("100.00%", SLOTrackingCardProjection.formatPercent(100.0, Locale.US))
        assertEquals("0.00%", SLOTrackingCardProjection.formatPercent(null, Locale.US))
        assertEquals("99.96%", SLOTrackingCardProjection.formatPercent(99.956, Locale.US))
    }

    @Test
    fun targetFormattersStripTrailingZeros() {
        assertEquals("99", SLOTrackingCardProjection.targetText(99.0))
        assertEquals("99.5", SLOTrackingCardProjection.targetText(99.5))
        assertEquals("100", SLOTrackingCardProjection.targetText(100.0))
        assertEquals("99%", SLOTrackingCardProjection.formatTarget(99.0))
        assertEquals("99.5%", SLOTrackingCardProjection.formatTarget(99.5))
    }

    @Test
    fun countTextFallsBackToEmDash() {
        assertEquals("8", SLOTrackingCardProjection.countText(8))
        assertEquals(EM_DASH, SLOTrackingCardProjection.countText(null))
    }

    // ── Persisted target store ───────────────────────────────────────────────────────────────────────

    @Test
    fun inMemoryTargetStoreClampsAndEmits() {
        val store = InMemorySloTargetStore(initial = 150.0)
        assertEquals(DEFAULT_SLO_TARGET, store.target.value, 0.0)
        store.setTarget(95.0)
        assertEquals(95.0, store.target.value, 0.0)
        store.setTarget(0.0)
        assertEquals(DEFAULT_SLO_TARGET, store.target.value, 0.0)
    }

    // ── Diagnostics (P1/S11) ─────────────────────────────────────────────────────────────────────────

    @Test
    fun diagnosticsRecordsViewOpenedWithSlug() {
        val logger = RecordingLogger()
        SLOTrackingCardDiagnostics.recordViewOpened(logger)
        val opened = logger.records.single { it.event == "view.opened" }
        assertEquals("SLOTrackingCard", opened.fields["surface"])
        assertFalse(opened.fields.containsKey("uptime"))
    }

    // ── ViewModel: cache-then-network projection ─────────────────────────────────────────────────────

    @Test
    fun initialLoadSuccessProjectsContent() =
        runTest(UnconfinedTestDispatcher()) {
            val data = UptimeWindow(window = "30d", uptimePercent = 99.9, healthyCount = 8, totalCount = 8)
            val vm = viewModel(FakeSloSource(Result.success(data)))
            advanceUntilIdle()

            val state = vm.uptime.value
            assertEquals(UiPhase.Content, state.phase)
            assertEquals(data, state.data)
            assertEquals(DEFAULT_SLO_TARGET, vm.target.value, 0.0)
        }

    @Test
    fun successWithNoValueProjectsEmpty() =
        runTest(UnconfinedTestDispatcher()) {
            val vm = viewModel(FakeSloSource(Result.success(UptimeWindow(uptimePercent = null, totalCount = 0))))
            advanceUntilIdle()
            assertEquals(UiPhase.Empty, vm.uptime.value.phase)
        }

    @Test
    fun hardFailureProjectsError() =
        runTest(UnconfinedTestDispatcher()) {
            val vm = viewModel(FakeSloSource(Result.failure(ApiError.Network())))
            advanceUntilIdle()

            val state = vm.uptime.value
            assertEquals(UiPhase.Error, state.phase)
            assertEquals(ErrorKind.Network, state.errorKind)
            assertNull(state.data)
        }

    @Test
    fun refreshFailureKeepsLastValueAsOffline() =
        runTest(UnconfinedTestDispatcher()) {
            val data = UptimeWindow(window = "30d", uptimePercent = 99.9, healthyCount = 8, totalCount = 8)
            val source = FakeSloSource(Result.success(data))
            val vm = viewModel(source)
            advanceUntilIdle()
            assertEquals(UiPhase.Content, vm.uptime.value.phase)

            source.setResult(Result.failure(ApiError.Network()))
            vm.refresh()
            advanceUntilIdle()

            val state = vm.uptime.value
            assertTrue(state.isOffline)
            assertEquals(data, state.data)
            assertEquals(ErrorKind.Network, state.errorKind)
        }

    @Test
    fun setWindowLoadsFreshForNewWindowAndResetsCache() =
        runTest(UnconfinedTestDispatcher()) {
            val d30 = UptimeWindow(window = "30d", uptimePercent = 99.9)
            val source = FakeSloSource(Result.success(d30))
            source.byWindow =
                mapOf(
                    StatusWindow.D30 to Result.success(d30),
                    StatusWindow.D7 to Result.failure(ApiError.Network()),
                )
            val vm = viewModel(source)
            advanceUntilIdle()
            assertEquals(d30, vm.uptime.value.data)

            vm.setWindow(StatusWindow.D7)
            advanceUntilIdle()

            assertEquals(StatusWindow.D7, vm.window.value)
            // Cache reset on window change: the previous window's value is NOT shown as stale.
            assertEquals(UiPhase.Error, vm.uptime.value.phase)
            assertNull(vm.uptime.value.data)
            assertTrue(source.calls.contains(StatusWindow.D30))
            assertTrue(source.calls.contains(StatusWindow.D7))
        }

    @Test
    fun setTargetPersistsClampedValue() =
        runTest(UnconfinedTestDispatcher()) {
            val store = InMemorySloTargetStore()
            val vm = viewModel(FakeSloSource(Result.success(UptimeWindow(uptimePercent = 99.9))), store)
            advanceUntilIdle()

            vm.setTarget(95.0)
            assertEquals(95.0, vm.target.value, 0.0)
            vm.setTarget(150.0)
            assertEquals(DEFAULT_SLO_TARGET, vm.target.value, 0.0)
        }

    @Test
    fun onViewOpenedEmitsOnceWithSurfaceSlug() =
        runTest(UnconfinedTestDispatcher()) {
            val logger = RecordingLogger()
            val vm = viewModel(FakeSloSource(Result.success(UptimeWindow(uptimePercent = 99.9))), logger = logger)
            advanceUntilIdle()

            vm.onViewOpened()
            vm.onViewOpened()

            val opened = logger.records.filter { it.event == "view.opened" }
            assertEquals(1, opened.size)
            assertEquals("SLOTrackingCard", opened.first().fields["surface"])
        }

    // ── fakes / helpers ──────────────────────────────────────────────────────────────────────────────

    private fun TestScope.viewModel(
        source: SLOTrackingCardSource,
        store: SloTargetStore = InMemorySloTargetStore(),
        logger: Logger = RecordingLogger(),
    ): SLOTrackingCardViewModel =
        SLOTrackingCardViewModel(
            source = source,
            targetStore = store,
            logger = logger,
            scope = backgroundScope,
            now = { FIXED_NOW },
        )

    private class FakeSloSource(
        private var nextResult: Result<UptimeWindow> = Result.success(UptimeWindow(uptimePercent = 99.9)),
    ) : SLOTrackingCardSource {
        val calls = mutableListOf<StatusWindow>()
        var byWindow: Map<StatusWindow, Result<UptimeWindow>>? = null

        fun setResult(result: Result<UptimeWindow>) {
            nextResult = result
        }

        override suspend fun uptime(window: StatusWindow): Result<UptimeWindow> {
            calls.add(window)
            return byWindow?.get(window) ?: nextResult
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

    private companion object {
        const val FIXED_NOW = 1_749_643_200_000L
    }
}
