package io.teslasync.android.featureviews.tirepressuresection

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
import java.util.Locale

/**
 * On-device Compose UI + accessibility verification of [TirePressureSectionContent] across every state the
 * surface renders: the loading chrome, the hard-error retry surface, the no-data empty state, the populated
 * tiles + line chart, and the stale/offline cached view. Asserts the rendered i18n strings, the chart's
 * accessible description (web `ariaLabel`, resolved via the catalog-absent fallback), a per-wheel tile's
 * grouped TalkBack label, and the freshness chip's TalkBack label. The offline gate's `testReleaseUnitTest`
 * covers the pure logic; this covers render + a11y. Mirrors the web spec
 * (web/src/features/driving/components/drive-detail/TirePressureSection.tsx).
 */
class TirePressureSectionUiTest {
    @get:Rule
    val compose = createComposeRule()

    private val ariaLabel = "Front and rear tire pressure lines over the drive timeline"

    private fun setContent(
        state: UiState<List<TirePressurePoint>>,
        onRetry: () -> Unit = {},
    ) {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                TirePressureSectionContent(
                    state = state,
                    onRetry = onRetry,
                    pressureUnit = "psi",
                    locale = Locale.US,
                )
            }
        }
    }

    private fun trace(): List<TirePressurePoint> =
        listOf(
            TirePressurePoint("09:00", frontLeft = 42.0, frontRight = 42.5, rearLeft = 41.0, rearRight = 41.5),
            TirePressurePoint("09:05", frontLeft = 42.5, frontRight = 43.0, rearLeft = 41.5, rearRight = 42.0),
            TirePressurePoint("09:10", frontLeft = 43.0, frontRight = 43.5, rearLeft = 42.0, rearRight = 42.5),
        )

    @Test
    fun loadingShowsTitleChromeNotABlankPanel() {
        setContent(UiState(UiPhase.Loading))
        compose.onNodeWithText("Tire Pressure During Drive").assertIsDisplayed()
    }

    @Test
    fun errorShowsRetryAffordanceAndInvokesRetry() {
        var retried = false
        setContent(state = UiState(UiPhase.Error, errorKind = ErrorKind.Network), onRetry = { retried = true })
        compose.onNodeWithText("Something went wrong on our end. Please try again.").assertIsDisplayed()
        compose.onNodeWithText("Retry").performClick()
        assertTrue(retried)
    }

    @Test
    fun emptyShowsTitleAndNoTelemetryMessage() {
        setContent(UiState(UiPhase.Empty, data = emptyList()))
        compose.onNodeWithText("Tire Pressure During Drive").assertIsDisplayed()
        compose.onNodeWithText("No telemetry data available").assertIsDisplayed()
    }

    @Test
    fun contentRendersTitleAccessibleChartDescriptionAndWheelTiles() {
        setContent(UiState(UiPhase.Content, data = trace()))
        compose.onNodeWithText("Tire Pressure During Drive").assertIsDisplayed()
        compose.onNodeWithContentDescription(ariaLabel).assertExists()
        // Each wheel tile is a grouped node whose TalkBack label carries the wheel name + its min–max value.
        compose.onNodeWithContentDescription("Front Left", substring = true).assertExists()
        compose.onNodeWithContentDescription("Rear Right", substring = true).assertExists()
    }

    @Test
    fun offlineShowsCachedTilesWithOfflineChip() {
        setContent(
            UiState(
                phase = UiPhase.Content,
                data = trace(),
                stale = true,
                fetchedAt = 1_700_000_000_000L,
                errorKind = ErrorKind.Network,
            ),
        )
        compose.onNodeWithText("Tire Pressure During Drive").assertIsDisplayed()
        compose.onNodeWithContentDescription("Offline").assertExists()
    }

    @Test
    fun staleContentAutoRefreshesAndKeepsCachedContent() {
        var refreshed = false
        setContent(
            state =
                UiState(
                    phase = UiPhase.Content,
                    data = trace(),
                    stale = true,
                    fetchedAt = 1_700_000_000_000L,
                ),
            onRetry = { refreshed = true },
        )
        compose.waitForIdle()
        compose.onNodeWithText("Tire Pressure During Drive").assertIsDisplayed()
        assertTrue(refreshed)
    }
}
