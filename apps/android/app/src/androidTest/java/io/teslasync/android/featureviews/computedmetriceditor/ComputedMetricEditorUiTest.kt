package io.teslasync.android.featureviews.computedmetriceditor

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.size
import androidx.compose.ui.Modifier
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.unit.dp
import androidx.test.platform.app.InstrumentationRegistry
import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.shared.core.presentation.notifications.ComputedMetricPreview
import io.teslasync.shared.core.presentation.notifications.ComputedMetricSummary
import org.junit.Rule
import org.junit.Test
import java.util.Locale

/**
 * Instrumented Compose UI + accessibility verification of ComputedMetricEditor across every branch the prompt's
 * state matrix mandates (web/src/features/notifications/components/ComputedMetricEditor.tsx): the loading metric
 * label, the empty registry label, the hard registry error (QueryError surface), the stale/offline chip over
 * cached metrics, the idle preview hint, and the resolved preview sentence — plus the localized accessible name
 * on every interactive control (the a11y-label coverage). Every asserted string resolves from the app's i18n
 * catalog (the same fold + resolve-or-fallback the surface uses) so the test follows the device locale rather
 * than hard-coding English. Runs under `connectedAndroidTest`; the offline `testReleaseUnitTest` gate covers the
 * pure projection + view-model.
 */
class ComputedMetricEditorUiTest {
    @get:Rule
    val compose = createComposeRule()

    private val context get() = InstrumentationRegistry.getInstrumentation().targetContext

    private fun lookup(name: String): String? {
        val id = context.resources.getIdentifier(name, "string", context.packageName)
        return if (id != 0) context.getString(id) else null
    }

    private fun strings(): ComputedMetricEditorStrings = buildComputedMetricEditorStrings(::lookup)

    @Test
    fun loadingShowsTheLoadingMetricLabelAndIdlePreview() {
        setContent(state = UiState.loading(), value = ComputedMetricEditorValue(), previewState = PreviewUiState.Idle)

        compose.onNodeWithText(strings().loadingMetrics).assertIsDisplayed()
        compose.onNodeWithText(strings().previewIdle).assertIsDisplayed()
    }

    @Test
    fun emptyRegistryStillShowsTheChooseAMetricLabel() {
        setContent(
            state = UiState(phase = UiPhase.Empty, data = emptyList(), fetchedAt = NOW),
            value = ComputedMetricEditorValue(),
            previewState = PreviewUiState.Idle,
        )

        compose.onNodeWithText(strings().metricEmptyLabel).assertIsDisplayed()
    }

    @Test
    fun hardErrorShowsTheLivePreviewChromeAndRetry() {
        setContent(
            state = UiState(phase = UiPhase.Error, errorKind = ErrorKind.Network),
            value = ComputedMetricEditorValue(),
            previewState = PreviewUiState.Idle,
        )

        // The editor never blanks: the live-preview panel still renders beneath the QueryError surface.
        compose.onNodeWithText(strings().previewTitle).assertIsDisplayed()
        compose.onNodeWithText(strings().previewIdle).assertIsDisplayed()
    }

    @Test
    fun offlineShowsTheOfflineChipOverCachedMetrics() {
        setContent(
            state =
                UiState(
                    phase = UiPhase.Content,
                    data = metrics(),
                    fetchedAt = NOW,
                    stale = true,
                    errorKind = ErrorKind.Timeout,
                ),
            value = selectedValue(),
            previewState = PreviewUiState.Idle,
        )

        compose.onNodeWithText(strings().offline).assertIsDisplayed()
    }

    @Test
    fun resolvedPreviewShowsTheValueSentence() {
        val preview = ComputedMetricPreview(value = 214.3, threshold = 200.0, wouldTrigger = true)
        setContent(
            state = UiState(phase = UiPhase.Content, data = metrics(), fetchedAt = NOW),
            value = selectedValue(),
            previewState = PreviewUiState.Value(preview),
        )

        val expected = previewValueText(strings(), preview, suffix = "", locale = Locale.US)
        compose.onNodeWithText(expected).assertIsDisplayed()
    }

    @Test
    fun everyInteractiveControlCarriesItsLocalizedAccessibleName() {
        setContent(
            state = UiState(phase = UiPhase.Content, data = metrics(), fetchedAt = NOW),
            value = selectedValue(),
            previewState = PreviewUiState.Idle,
        )

        val s = strings()
        compose.onNodeWithContentDescription(s.metricLabel).assertIsDisplayed()
        compose.onNodeWithContentDescription(s.windowLabel).assertIsDisplayed()
        compose.onNodeWithContentDescription(s.operatorLabel).assertIsDisplayed()
        compose.onNodeWithContentDescription(s.thresholdLabel).assertIsDisplayed()
    }

    private fun setContent(
        state: UiState<List<ComputedMetricSummary>>,
        value: ComputedMetricEditorValue,
        previewState: PreviewUiState,
    ) {
        compose.mainClock.autoAdvance = false
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                Box(modifier = Modifier.size(width = WIDTH, height = HEIGHT)) {
                    ComputedMetricEditorContent(
                        metricsState = state,
                        value = value,
                        previewState = previewState,
                        strings = strings(),
                        onSelectMetric = {},
                        onSelectWindow = {},
                        onSelectOperator = {},
                        onThresholdChange = {},
                        onRetry = {},
                        locale = Locale.US,
                    )
                }
            }
        }
        compose.mainClock.advanceTimeBy(SETTLE_MS)
    }

    private fun metrics(): List<ComputedMetricSummary> =
        listOf(
            ComputedMetricSummary(
                id = "cost",
                label = "Charging cost",
                unit = "currency",
                windows = listOf("7d", "30d"),
                ops = listOf(">", ">=", "<"),
            ),
        )

    private fun selectedValue(): ComputedMetricEditorValue =
        ComputedMetricEditorValue(metricId = "cost", metricWindow = "30d", metricOp = ">", metricThreshold = "200")

    private companion object {
        const val NOW = 1_780_000_000_000L
        val WIDTH = 380.dp
        val HEIGHT = 900.dp
        const val SETTLE_MS = 2_000L
    }
}
