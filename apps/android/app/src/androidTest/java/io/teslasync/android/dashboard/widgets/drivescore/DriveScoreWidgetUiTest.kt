package io.teslasync.android.dashboard.widgets.drivescore

import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.shared.core.units.DistanceUnitPref
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import java.util.Locale

/**
 * On-device Compose UI + accessibility verification of [DriveScoreWidgetContent] across every state the
 * web component renders (loading skeleton, hard error + retry, standard gauge + efficiency stat, compact
 * gauge-only, no-data empty, stale/offline cached). Asserts the rendered i18n strings and the TalkBack
 * content descriptions are present. Runs under `connectedAndroidTest` (a device/emulator) — the offline
 * gate's `testReleaseUnitTest` covers the logic; this covers render + a11y.
 */
class DriveScoreWidgetUiTest {
    @get:Rule
    val compose = createComposeRule()

    private val prefs = DriveScoreDisplayPrefs(DistanceUnitPref.KM)
    private val standardSize = DriveScoreRegistration.defaultSize
    private val compactSize = DriveScoreSize(cols = 1, rows = 1)

    // 500 Wh/km → score 50 ("Score: 50"); efficiency "500" Wh/km.
    private fun analyticsJson(efficiency: Double): JsonElement =
        buildJsonObject {
            put("period_days", 7)
            put("total_vehicles", 1)
            put("avg_efficiency_wh_km", efficiency)
        }

    private fun setContent(
        state: UiState<JsonElement>,
        size: DriveScoreSize = standardSize,
        onRefresh: () -> Unit = {},
    ) {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                DriveScoreWidgetContent(
                    state = state,
                    prefs = prefs,
                    size = size,
                    onRefresh = onRefresh,
                    locale = Locale.US,
                )
            }
        }
    }

    @Test
    fun loadingShowsAccessibleSkeletonChrome() {
        setContent(UiState(UiPhase.Loading))
        compose.onNodeWithContentDescription("Loading", substring = true).assertIsDisplayed()
    }

    @Test
    fun errorShowsRetryAffordanceAndInvokesRefresh() {
        var retried = false
        setContent(
            state = UiState(UiPhase.Error, errorKind = ErrorKind.Network),
            onRefresh = { retried = true },
        )
        compose.onNodeWithText("Server error").assertIsDisplayed()
        compose.onNodeWithText("Retry").performClick()
        assertTrue(retried)
    }

    @Test
    fun standardContentShowsGaugeAndEfficiencyStat() {
        setContent(UiState(UiPhase.Content, data = analyticsJson(500.0), fetchedAt = NOW))
        // The radial gauge folds label + value into one TalkBack phrase.
        compose.onNodeWithContentDescription("Score: 50").assertIsDisplayed()
        compose.onNodeWithText("Efficiency").assertIsDisplayed()
        compose.onNodeWithText("Wh/km").assertIsDisplayed()
        compose.onNodeWithText("500").assertIsDisplayed()
    }

    @Test
    fun standardContentExposesRefreshAction() {
        setContent(UiState(UiPhase.Content, data = analyticsJson(500.0), fetchedAt = NOW))
        compose.onNodeWithContentDescription("Refresh").assertIsDisplayed()
    }

    @Test
    fun compactContentShowsGaugeWithoutEfficiencyStat() {
        setContent(
            state = UiState(UiPhase.Content, data = analyticsJson(500.0), fetchedAt = NOW),
            size = compactSize,
        )
        compose.onNodeWithContentDescription("Score: 50").assertIsDisplayed()
        // Compact (1×1) drops the efficiency stat row (web `WidgetGaugeHero` compact branch).
        compose.onNodeWithText("Efficiency").assertDoesNotExist()
    }

    @Test
    fun emptyShowsNoDataMessage() {
        setContent(UiState(UiPhase.Empty, data = JsonObject(emptyMap()), fetchedAt = NOW))
        compose.onNodeWithText("No data yet").assertIsDisplayed()
    }

    @Test
    fun offlineKeepsCachedGaugeVisible() {
        setContent(
            UiState(
                UiPhase.Content,
                data = analyticsJson(500.0),
                fetchedAt = NOW,
                stale = true,
                errorKind = ErrorKind.Timeout,
            ),
        )
        // Cached values stay visible (never blanked) when offline/stale.
        compose.onNodeWithContentDescription("Score: 50").assertIsDisplayed()
    }

    private companion object {
        const val NOW = 1_780_000_000_000L
    }
}
