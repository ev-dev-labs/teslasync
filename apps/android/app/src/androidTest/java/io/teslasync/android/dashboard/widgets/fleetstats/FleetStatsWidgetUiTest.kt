package io.teslasync.android.dashboard.widgets.fleetstats

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
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import java.util.Locale

/**
 * On-device Compose UI + accessibility verification of [FleetStatsWidgetContent] across every state the
 * web component surfaces (loading skeleton, hard error + retry, the five-stat bar, stale/offline cached).
 * Asserts the rendered i18n strings + the per-card TalkBack content descriptions and the refresh action's
 * label. Runs under `connectedAndroidTest` (a device/emulator) — the offline gate's `testReleaseUnitTest`
 * covers the projection + view-model logic; this covers render + a11y.
 */
class FleetStatsWidgetUiTest {
    @get:Rule
    val compose = createComposeRule()

    private val prefs = FleetStatsDisplayPrefs(DistanceUnitPref.KM)

    private fun bar(
        vehicleCount: Int,
        distanceTrend: List<Double> = emptyList(),
        energyTrend: List<Double> = emptyList(),
    ): FleetStatsBarData =
        FleetStatsBarData(
            vehicleCount = vehicleCount,
            onlineCount = 0,
            unreadAlerts = 0,
            distanceTrend = distanceTrend,
            energyTrend = energyTrend,
        )

    private fun analyticsJson(
        distanceKm: Double,
        energyKwh: Double,
        efficiency: Double,
    ): JsonElement =
        buildJsonObject {
            put("period_days", 30)
            put("total_distance_km", distanceKm)
            put("total_energy_kwh", energyKwh)
            put("avg_efficiency_wh_km", efficiency)
        }

    private fun setContent(
        state: UiState<JsonElement>,
        bar: FleetStatsBarData = FleetStatsBarData.EMPTY,
        onRefresh: () -> Unit = {},
    ) {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                FleetStatsWidgetContent(
                    state = state,
                    bar = bar,
                    prefs = prefs,
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
    fun contentShowsFiveAccessibleStatCards() {
        setContent(
            state = UiState(UiPhase.Content, data = analyticsJson(5000.0, 56.7, 160.0), fetchedAt = NOW),
            bar = bar(vehicleCount = 3, distanceTrend = listOf(1.0, 2.0, 3.0), energyTrend = listOf(4.0, 5.0)),
        )
        // Each card folds its label + value (+ sub) into one TalkBack phrase (the web FleetStatsBar order).
        compose.onNodeWithContentDescription("Fleet Size: 3, 0 online").assertIsDisplayed()
        compose.onNodeWithContentDescription("Distance (30d): 5 km").assertIsDisplayed()
        compose.onNodeWithContentDescription("Energy (30d): 56.7 kWh").assertIsDisplayed()
        compose.onNodeWithContentDescription("Efficiency: 160 Wh/km, fleet average").assertIsDisplayed()
        compose.onNodeWithContentDescription("Alerts: 0 unread").assertIsDisplayed()
    }

    @Test
    fun contentExposesRefreshAction() {
        setContent(
            state = UiState(UiPhase.Content, data = analyticsJson(5000.0, 56.7, 160.0), fetchedAt = NOW),
            bar = bar(vehicleCount = 3),
        )
        compose.onNodeWithContentDescription("Refresh").assertIsDisplayed()
    }

    @Test
    fun offlineKeepsCachedBarVisible() {
        setContent(
            state =
                UiState(
                    UiPhase.Content,
                    data = analyticsJson(5000.0, 56.7, 160.0),
                    fetchedAt = NOW,
                    stale = true,
                    errorKind = ErrorKind.Timeout,
                ),
            bar = bar(vehicleCount = 3),
        )
        // Cached values stay visible (never blanked) when offline/stale.
        compose.onNodeWithContentDescription("Fleet Size: 3, 0 online").assertIsDisplayed()
        compose.onNodeWithContentDescription("Distance (30d): 5 km").assertIsDisplayed()
    }

    private companion object {
        const val NOW = 1_780_000_000_000L
    }
}
