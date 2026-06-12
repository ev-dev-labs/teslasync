package io.teslasync.android.featureviews.snapshotinspector

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.size
import androidx.compose.ui.Modifier
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.unit.dp
import androidx.test.platform.app.InstrumentationRegistry
import io.teslasync.android.R
import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.presentation.telemetry.SignalSnapshotEntry
import io.teslasync.shared.core.presentation.telemetry.SignalSnapshotResponse
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import org.junit.Rule
import org.junit.Test
import java.time.ZoneId

/**
 * Instrumented Compose UI + accessibility verification of SnapshotInspector across every branch the prompt's
 * state matrix mandates (web/src/features/system/components/state-machine/SnapshotInspector.tsx): the
 * no-selection prompt, the loading hint, the outside-window hint + Jump button, the selected snapshot's header
 * / grid / signals, the per-section no-signals empty state, the hard error with Retry, and the offline (cached
 * + freshness chip) surface — plus the accessible names on the Diff toggle and the Copy button. Every asserted
 * string resolves from the app's i18n resources so the test follows the device locale rather than hard-coding
 * English (the a11y-label coverage). The clock auto-advance is disabled so FadeIn's entrance and the freshness
 * chip's infinite refresh tick cannot stall `waitForIdle`. Runs under `connectedAndroidTest`; the offline
 * `testReleaseUnitTest` gate covers the pure projection + diagnostics.
 */
class SnapshotInspectorUiTest {
    @get:Rule
    val compose = createComposeRule()

    private val context get() = InstrumentationRegistry.getInstrumentation().targetContext

    private fun string(id: Int) = context.getString(id)

    @Test
    fun noSelectionShowsTheSelectPrompt() {
        setRaw(transition = null, snapshot = null)
        compose.onNodeWithText(string(R.string.translation_debugger_inspector_empty)).assertIsDisplayed()
    }

    @Test
    fun noSelectionLoadingShowsTheLoadingHint() {
        setRaw(transition = null, snapshot = null, loading = true)
        compose.onNodeWithText(string(R.string.translation_debugger_inspector_loading)).assertIsDisplayed()
    }

    @Test
    fun outsideWindowShowsTheHintAndJumpButton() {
        setRaw(
            transition = null,
            snapshot = null,
            lastTransition = transition(),
            inWindowCount = 0,
            onJumpToLast = {},
        )
        compose.onNodeWithText(string(R.string.translation_debugger_inspector_jumpToLast)).assertIsDisplayed()
    }

    @Test
    fun selectedShowsTheHeaderGridAndSignals() {
        setRaw(transition = transition(), snapshot = snapshotWithSignals())

        compose.onNodeWithText(string(R.string.translation_debugger_inspector_title)).assertIsDisplayed()
        compose.onNodeWithText(string(R.string.translation_debugger_inspector_from)).assertIsDisplayed()
        compose.onNodeWithText(string(R.string.translation_debugger_inspector_signalsTitle)).assertIsDisplayed()
        compose.onNodeWithText(FROM_STATE).assertIsDisplayed()
        compose.onNodeWithText(TO_STATE).assertIsDisplayed()
        compose.onNodeWithText(SIGNAL_NAME).assertIsDisplayed()
        compose.onNodeWithText(SIGNAL_VALUE).assertIsDisplayed()
    }

    @Test
    fun selectedWithNoSignalsShowsThePerSectionEmptyState() {
        setRaw(transition = transition(), snapshot = SignalSnapshotResponse(vehicleId = 7, at = AT, count = 0))
        compose.onNodeWithText(string(R.string.translation_debugger_inspector_noSignals)).assertIsDisplayed()
    }

    @Test
    fun selectedErrorShowsTheFailureAndRetry() {
        setState(
            transition = transition(),
            state = UiState(phase = UiPhase.Error, errorKind = ErrorKind.Network),
        )
        compose.onNodeWithText(string(R.string.translation_error_serverError_title)).assertIsDisplayed()
        compose.onNodeWithText(string(R.string.translation_common_retry)).assertIsDisplayed()
    }

    @Test
    fun offlineShowsTheFreshnessChipOverCachedSignals() {
        setState(
            transition = transition(),
            state =
                UiState(
                    phase = UiPhase.Content,
                    data = snapshotWithSignals(),
                    stale = true,
                    errorKind = ErrorKind.Network,
                    fetchedAt = 1L,
                ),
        )
        compose.onNodeWithContentDescription(string(R.string.translation_common_offline)).assertIsDisplayed()
        compose.onNodeWithText(SIGNAL_NAME).assertIsDisplayed()
    }

    @Test
    fun diffToggleAndCopyButtonExposeAccessibleNames() {
        setRaw(transition = transition(), snapshot = snapshotWithSignals())
        // The Diff toggle's accessible name (web `aria` label) and the Copy button's visible label.
        compose.onNodeWithContentDescription(string(R.string.translation_debugger_inspector_diffMode)).assertIsDisplayed()
        compose.onNodeWithText(string(R.string.translation_debugger_inspector_copy)).assertIsDisplayed()
    }

    // ── fixtures + harness ─────────────────────────────────────────────────────────────

    private fun transition(): SnapshotTransition =
        SnapshotTransition(
            id = 9,
            vehicleId = 7,
            ts = "2026-03-14T11:45:00Z",
            fsmName = "vehicle",
            fromState = FROM_STATE,
            toState = TO_STATE,
            trigger = "shift_to_park",
            details = buildJsonObject { put(DURATION_KEY, 1_834_567) },
        )

    private fun snapshotWithSignals(): SignalSnapshotResponse =
        SignalSnapshotResponse(
            vehicleId = 7,
            at = AT,
            count = 1,
            signals = mapOf(SIGNAL_NAME to SignalSnapshotEntry(value = JsonPrimitive(82), source = "l1", ageMs = 1_200)),
        )

    private fun setRaw(
        transition: SnapshotTransition?,
        snapshot: SignalSnapshotResponse?,
        loading: Boolean = false,
        lastTransition: SnapshotTransition? = null,
        inWindowCount: Int = 0,
        onJumpToLast: (() -> Unit)? = null,
    ) {
        compose.mainClock.autoAdvance = false
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                Box(modifier = Modifier.size(width = WIDTH, height = HEIGHT)) {
                    SnapshotInspector(
                        fsmType = "vehicle",
                        transition = transition,
                        snapshot = snapshot,
                        loading = loading,
                        lastTransition = lastTransition,
                        inWindowCount = inWindowCount,
                        onJumpToLast = onJumpToLast,
                        zoneId = ZoneId.of("UTC"),
                        logger = NoopLogger,
                    )
                }
            }
        }
        compose.mainClock.advanceTimeBy(SETTLE_MS)
    }

    private fun setState(
        transition: SnapshotTransition?,
        state: UiState<SignalSnapshotResponse>,
    ) {
        compose.mainClock.autoAdvance = false
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                Box(modifier = Modifier.size(width = WIDTH, height = HEIGHT)) {
                    SnapshotInspector(
                        fsmType = "vehicle",
                        transition = transition,
                        snapshotState = state,
                        onRetry = {},
                        zoneId = ZoneId.of("UTC"),
                        logger = NoopLogger,
                    )
                }
            }
        }
        compose.mainClock.advanceTimeBy(SETTLE_MS)
    }

    private object NoopLogger : Logger {
        override fun log(
            level: LogLevel,
            event: String,
            fields: Map<String, String>,
        ) = Unit
    }

    private companion object {
        const val FROM_STATE = "driving"
        const val TO_STATE = "parked"
        const val SIGNAL_NAME = "battery_level"
        const val SIGNAL_VALUE = "82"
        const val AT = "2026-03-14T11:45:00Z"
        const val SETTLE_MS = 800L
        val WIDTH = 420.dp
        val HEIGHT = 900.dp
    }
}
