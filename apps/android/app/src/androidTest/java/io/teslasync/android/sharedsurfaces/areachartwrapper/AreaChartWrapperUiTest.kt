package io.teslasync.android.sharedsurfaces.areachartwrapper

import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import io.teslasync.android.ui.theme.TeslaSyncTheme
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test

/**
 * On-device Compose UI + accessibility verification of [AreaChartWrapperContent] across every state the
 * surface renders: the loading chrome, the hard-error retry surface, the no-data empty state, the populated
 * gradient area chart with its accessible description + fallback-table affordance, and the stale/offline
 * cached views. Asserts the rendered i18n strings and the TalkBack content descriptions (the always-visible
 * title/subtitle, the "Chart: …" accessible name, the offline freshness chip). The offline gate's
 * `testReleaseUnitTest` covers the pure logic; this covers render + a11y. Mirrors the web spec
 * (web/src/components/charts/AreaChartWrapper.tsx).
 */
class AreaChartWrapperUiTest {
    @get:Rule
    val compose = createComposeRule()

    private companion object {
        const val TITLE = "State of Charge"
        const val SUBTITLE = "Battery level over the last drive"
        const val X_AXIS_LABEL = "Time"
        const val X_KEY = "t"
        const val ACCESSIBLE_NAME = "Chart: State of Charge"
    }

    private val series =
        listOf(
            AreaSeries(key = "soc", label = "SOC %", colorArgb = 0xFF10B981.toInt()),
            AreaSeries(key = "range", label = "Range", colorArgb = 0xFF3B82F6.toInt()),
        )

    private fun rows(): List<AreaChartRow> =
        listOf(
            AreaChartRow(X_KEY to "08:00", "soc" to 82, "range" to 305),
            AreaChartRow(X_KEY to "08:30", "soc" to 74, "range" to 271),
        )

    private fun setContent(
        state: UiState<List<AreaChartRow>>,
        onRetry: () -> Unit = {},
    ) {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                AreaChartWrapperContent(
                    state = state,
                    xKey = X_KEY,
                    series = series,
                    title = TITLE,
                    xAxisLabel = X_AXIS_LABEL,
                    onRetry = onRetry,
                    subtitle = SUBTITLE,
                )
            }
        }
    }

    @Test
    fun loadingShowsTitleChromeNotABlankPanel() {
        setContent(UiState(UiPhase.Loading))
        compose.onNodeWithText(TITLE).assertIsDisplayed()
    }

    @Test
    fun errorShowsRetryAffordanceAndInvokesRetry() {
        var retried = false
        setContent(state = UiState(UiPhase.Error, errorKind = ErrorKind.Network), onRetry = { retried = true })
        compose.onNodeWithText(TITLE).assertIsDisplayed()
        compose.onNodeWithText("Retry").performClick()
        assertTrue(retried)
    }

    @Test
    fun emptyShowsTitleAndNoDataMessage() {
        setContent(UiState(UiPhase.Empty, data = emptyList()))
        compose.onNodeWithText(TITLE).assertIsDisplayed()
        compose.onNodeWithText("No data available").assertIsDisplayed()
    }

    @Test
    fun contentRendersTitleSubtitleAndAccessibleChartName() {
        setContent(UiState(UiPhase.Content, data = rows()))
        compose.onNodeWithText(TITLE).assertIsDisplayed()
        compose.onNodeWithText(SUBTITLE).assertIsDisplayed()
        // The chart body carries the localized accessible name for TalkBack (translation_chart_a11y_summary).
        compose.onNodeWithContentDescription(ACCESSIBLE_NAME).assertExists()
        // The accessible fallback data table is offered (translation_Details).
        compose.onNodeWithText("Details").assertExists()
    }

    @Test
    fun offlineShowsCachedChartWithOfflineChip() {
        setContent(
            UiState(
                phase = UiPhase.Content,
                data = rows(),
                stale = true,
                fetchedAt = 1_700_000_000_000L,
                errorKind = ErrorKind.Network,
            ),
        )
        compose.onNodeWithText(TITLE).assertIsDisplayed()
        compose.onNodeWithContentDescription("Offline").assertExists()
    }

    @Test
    fun staleContentAutoRefreshesAndKeepsCachedContent() {
        var refreshed = false
        setContent(
            state =
                UiState(
                    phase = UiPhase.Content,
                    data = rows(),
                    stale = true,
                    fetchedAt = 1_700_000_000_000L,
                ),
            onRetry = { refreshed = true },
        )
        compose.waitForIdle()
        compose.onNodeWithText(TITLE).assertIsDisplayed()
        assertTrue(refreshed)
    }
}
