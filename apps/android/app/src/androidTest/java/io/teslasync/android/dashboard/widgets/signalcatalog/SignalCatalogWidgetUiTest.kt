package io.teslasync.android.dashboard.widgets.signalcatalog

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.size
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.hasSetTextAction
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performTextInput
import androidx.compose.ui.unit.dp
import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.shared.core.presentation.telemetry.SignalCatalogEntry
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test

/**
 * Instrumented Compose UI + accessibility verification of [SignalCatalogWidgetContent] across every state
 * the web component renders (loading skeleton, the empty "No signals in catalog" state, the title + search
 * + grouped rows with the unit chip + observation count, the "No matching signals" filtered-empty state,
 * the compact total-count footprint, a hard error + retry, and the stale/offline cached path). Asserts the
 * rendered i18n strings and the TalkBack content descriptions are present. Runs under
 * `connectedAndroidTest`; the offline gate's `testReleaseUnitTest` covers the pure projection + adapter
 * logic, this covers the render + a11y.
 */
class SignalCatalogWidgetUiTest {
    @get:Rule
    val compose = createComposeRule()

    private fun setContent(
        state: UiState<SignalCatalogSnapshot>,
        size: SignalCatalogSize = SignalCatalogRegistration.defaultSize,
        onRefresh: () -> Unit = {},
        onRetry: () -> Unit = {},
    ) {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                Host {
                    SignalCatalogWidgetContent(
                        state = state,
                        size = size,
                        onRefresh = onRefresh,
                        onRetry = onRetry,
                    )
                }
            }
        }
    }

    @Test
    fun loadingShowsAccessibleSkeletonChrome() {
        setContent(UiState(UiPhase.Loading))
        compose.onNodeWithContentDescription("Loading").assertIsDisplayed()
    }

    @Test
    fun emptyShowsNoSignalsInCatalog() {
        setContent(UiState(UiPhase.Empty, data = SignalCatalogSnapshot.EMPTY, fetchedAt = NOW))
        compose.onNodeWithText("No signals in catalog").assertIsDisplayed()
    }

    @Test
    fun contentShowsTitleSearchRowsUnitAndRefresh() {
        setContent(UiState(UiPhase.Content, data = sampleSnapshot(), fetchedAt = NOW))
        compose.onNodeWithText("Signal Catalog").assertIsDisplayed()
        compose.onNodeWithText("Search signals…").assertIsDisplayed()
        compose.onNodeWithText("BatteryLevel").assertIsDisplayed()
        // The catalog unit chip (web `<Badge>`).
        compose.onNodeWithText("%").assertIsDisplayed()
        // The header refresh control exposes an accessible name (TalkBack).
        compose.onNodeWithContentDescription("Refresh").assertIsDisplayed()
    }

    @Test
    fun searchWithNoMatchesShowsNoMatchingSignals() {
        setContent(UiState(UiPhase.Content, data = sampleSnapshot(), fetchedAt = NOW))
        compose.onNode(hasSetTextAction()).performTextInput("zzz")
        compose.onNodeWithText("No matching signals").assertIsDisplayed()
    }

    @Test
    fun compactFootprintShowsCountWithoutTitle() {
        setContent(
            state = UiState(UiPhase.Content, data = sampleSnapshot(), fetchedAt = NOW),
            size = SignalCatalogSize(cols = 1, rows = 4),
        )
        compose.onNodeWithText("signals available").assertIsDisplayed()
        compose.onNodeWithText("Signal Catalog").assertDoesNotExist()
    }

    @Test
    fun errorShowsRetryAffordanceAndInvokesRetry() {
        var retried = false
        setContent(
            state = UiState(UiPhase.Error, errorKind = ErrorKind.Unknown),
            onRetry = { retried = true },
        )
        compose.onNodeWithText("Can't reach server").assertIsDisplayed()
        compose.onNodeWithText("Retry").performClick()
        assertTrue(retried)
    }

    @Test
    fun offlineKeepsCachedCatalogVisible() {
        setContent(
            UiState(
                phase = UiPhase.Content,
                data = sampleSnapshot(),
                fetchedAt = NOW,
                stale = true,
                errorKind = ErrorKind.Timeout,
            ),
        )
        // Cached rows stay visible (never blanked) when offline/stale.
        compose.onNodeWithText("BatteryLevel").assertIsDisplayed()
    }

    /** Two catalog entries across two categories, one carrying a unit chip + observation count. */
    private fun sampleSnapshot(): SignalCatalogSnapshot =
        SignalCatalogSnapshot(
            entries =
                listOf(
                    entry("BatteryLevel", module = "battery", unit = "%"),
                    entry("VehicleSpeed", module = "drive", unit = null),
                ),
            observationCounts = mapOf("BatteryLevel" to 5),
        )

    private fun entry(
        name: String,
        module: String,
        unit: String?,
    ): SignalCatalogEntry =
        SignalCatalogEntry(
            name = name,
            valueType = "numeric",
            sourceModule = module,
            unit = unit,
            description = null,
            firstSeenAt = "",
            lastSeenAt = "",
        )

    @Composable
    private fun Host(content: @Composable () -> Unit) {
        Box(modifier = Modifier.size(width = HOST_WIDTH, height = HOST_HEIGHT)) { content() }
    }

    private companion object {
        const val NOW = 1_780_000_000_000L
        val HOST_WIDTH = 360.dp
        val HOST_HEIGHT = 560.dp
    }
}
