package io.teslasync.android.featureviews.fleetstatsbar

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.size
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.unit.dp
import io.teslasync.android.ui.theme.TeslaSyncTheme
import org.junit.Rule
import org.junit.Test
import java.util.Locale

/**
 * Instrumented Compose UI + accessibility verification of [FleetStatsBarContent] across the states the
 * surface renders — the populated five-card grid, the empty (no-data → zeros) grid, and the alerts-active
 * branch. Asserts every label, value, and subtext is exposed to TalkBack (present in the semantics tree),
 * the count cells render their static figures under reduced motion (the deterministic accessibility path),
 * and that no card is ever hidden or blank (the empty grid still shows every labelled zero). The surface has
 * no interactive elements (the web source has none), so accessibility coverage is the presence of every
 * label/value/subtext node. Runs under `connectedAndroidTest`; the offline `testReleaseUnitTest` gate covers
 * the pure projection.
 */
class FleetStatsBarUiTest {
    @get:Rule
    val compose = createComposeRule()

    private val populated =
        FleetStatsBarDisplay(
            fleetSize = 4,
            onlineCount = 3,
            distanceValue = 4_820.0,
            distanceUnit = "km",
            distanceTrend = listOf(15_750.0, 41_000.0, 8_900.0, 32_500.0, 12_000.0),
            energyKwh = 812.4,
            energyTrend = listOf(51_000.0, 9_500.0, 42_000.0, 18_000.0),
            efficiencyValue = 168.0,
            efficiencyUnit = "Wh/km",
            unreadAlerts = 0,
            alertsActive = false,
        )

    private val empty =
        FleetStatsBarDisplay(
            fleetSize = 0,
            onlineCount = 0,
            distanceValue = 0.0,
            distanceUnit = "km",
            distanceTrend = listOf(0.0),
            energyKwh = 0.0,
            energyTrend = listOf(0.0),
            efficiencyValue = 0.0,
            efficiencyUnit = "Wh/km",
            unreadAlerts = 0,
            alertsActive = false,
        )

    private fun setContent(display: FleetStatsBarDisplay) {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                Host {
                    FleetStatsBarContent(display = display, locale = Locale.US, reduceMotion = true)
                }
            }
        }
    }

    @Test
    fun populatedGridShowsEveryLabelValueAndSubtext() {
        setContent(populated)

        // Fleet Size: label + count figure + "{online} online" subtext.
        compose.onNodeWithText("Fleet Size").assertIsDisplayed()
        compose.onNodeWithText("4").assertIsDisplayed()
        compose.onNodeWithText("3 online").assertIsDisplayed()

        // Distance / Energy: label + converted value with unit suffix.
        compose.onNodeWithText("Distance (30d)").assertIsDisplayed()
        compose.onNodeWithText("4,820 km").assertIsDisplayed()
        compose.onNodeWithText("Energy (30d)").assertIsDisplayed()
        compose.onNodeWithText("812.4 kWh").assertIsDisplayed()

        // Efficiency: label + value + "fleet average" subtext.
        compose.onNodeWithText("Efficiency").assertIsDisplayed()
        compose.onNodeWithText("168 Wh/km").assertIsDisplayed()
        compose.onNodeWithText("fleet average").assertIsDisplayed()

        // Alerts: label + count + "unread" subtext.
        compose.onNodeWithText("Alerts").assertIsDisplayed()
        compose.onNodeWithText("unread").assertIsDisplayed()
    }

    @Test
    fun emptyGridStillRendersEveryCardWithZeros() {
        setContent(empty)

        // Every card is present with a labelled zero — the friendly empty surface, never a blank box.
        compose.onNodeWithText("Fleet Size").assertIsDisplayed()
        compose.onNodeWithText("0 online").assertIsDisplayed()
        compose.onNodeWithText("Distance (30d)").assertIsDisplayed()
        compose.onNodeWithText("0 km").assertIsDisplayed()
        compose.onNodeWithText("Energy (30d)").assertIsDisplayed()
        compose.onNodeWithText("0.0 kWh").assertIsDisplayed()
        compose.onNodeWithText("Efficiency").assertIsDisplayed()
        compose.onNodeWithText("0 Wh/km").assertIsDisplayed()
        compose.onNodeWithText("fleet average").assertIsDisplayed()
        compose.onNodeWithText("Alerts").assertIsDisplayed()
        compose.onNodeWithText("unread").assertIsDisplayed()
    }

    @Test
    fun alertsActiveRendersTheUnreadCount() {
        setContent(populated.copy(unreadAlerts = 5, alertsActive = true))

        compose.onNodeWithText("Alerts").assertIsDisplayed()
        compose.onNodeWithText("5").assertIsDisplayed()
        compose.onNodeWithText("unread").assertIsDisplayed()
    }

    @Composable
    private fun Host(content: @Composable () -> Unit) {
        Box(modifier = Modifier.size(width = HOST_WIDTH, height = HOST_HEIGHT)) { content() }
    }

    private companion object {
        val HOST_WIDTH = 800.dp
        val HOST_HEIGHT = 700.dp
    }
}
