package io.teslasync.android.featureviews.journeydetailspanel

import androidx.compose.ui.test.assertCountEquals
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onNodeWithText
import io.teslasync.android.ui.theme.TeslaSyncTheme
import org.junit.Rule
import org.junit.Test
import java.time.ZoneId
import java.util.Locale

/**
 * On-device Compose UI + accessibility verification of [JourneyDetailsPanelContent] across the branches the surface
 * renders: the completed drive (both addresses, both timestamps, both batteries), the live drive (start
 * coordinates, an "In progress" destination, a "?" battery placeholder), and the fully-degenerate empty drive (the
 * panel still shows its title, both labels, the "No address data"/"In progress" fallbacks, and the "?" battery
 * rows — never a blank box). The accessibility test asserts the localized labels TalkBack announces are present in
 * the semantics tree. The offline gate's `testReleaseUnitTest` covers the pure projection + diagnostics; this
 * covers render + a11y. Mirrors the web spec
 * (web/src/features/driving/components/drive-detail/JourneyDetailsPanel.tsx).
 */
class JourneyDetailsPanelUiTest {
    @get:Rule
    val compose = createComposeRule()

    private val zone: ZoneId = ZoneId.of("America/Los_Angeles")

    private fun model(data: JourneyDetailsData): JourneyDetailsUiModel = JourneyDetailsPanelProjection.project(data, zone, Locale.US)

    private fun completed(): JourneyDetailsUiModel =
        model(
            JourneyDetailsData(
                startAddress = "Cupertino, CA",
                endAddress = "San Francisco, CA",
                startLat = 37.33,
                startLon = -122.03,
                endLat = 37.77,
                endLon = -122.42,
                startBatteryPct = 87.0,
                endBatteryPct = 64.0,
                startTsIso = "2026-01-15T18:30:00Z",
                endTsIso = "2026-01-15T19:42:00Z",
            ),
        )

    private fun live(): JourneyDetailsUiModel =
        model(
            JourneyDetailsData(
                startAddress = null,
                endAddress = null,
                startLat = -33.86,
                startLon = 151.20,
                endLat = null,
                endLon = null,
                startBatteryPct = 92.0,
                endBatteryPct = null,
                startTsIso = "2026-01-15T18:30:00Z",
                endTsIso = null,
            ),
        )

    private fun empty(): JourneyDetailsUiModel =
        model(
            JourneyDetailsData(
                startAddress = null,
                endAddress = null,
                startLat = null,
                startLon = null,
                endLat = null,
                endLon = null,
                startBatteryPct = null,
                endBatteryPct = null,
                startTsIso = null,
                endTsIso = null,
            ),
        )

    private fun setContent(model: JourneyDetailsUiModel) {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                JourneyDetailsPanelContent(model = model)
            }
        }
    }

    @Test
    fun completedDriveRendersTitleLabelsAddressesAndBatteries() {
        setContent(completed())
        compose.onNodeWithText("Journey Details").assertIsDisplayed()
        compose.onNodeWithText("Start").assertIsDisplayed()
        compose.onNodeWithText("Destination").assertIsDisplayed()
        compose.onNodeWithText("Cupertino, CA").assertIsDisplayed()
        compose.onNodeWithText("San Francisco, CA").assertIsDisplayed()
        compose.onNodeWithText("Battery: 87%").assertIsDisplayed()
        compose.onNodeWithText("Battery: 64%").assertIsDisplayed()
    }

    @Test
    fun liveDriveRendersStartCoordinatesAndInProgressDestination() {
        setContent(live())
        compose.onNodeWithText("-33.86°S, 151.20°E").assertIsDisplayed()
        compose.onNodeWithText("Battery: 92%").assertIsDisplayed()
        compose.onNodeWithText("Battery: ?%").assertIsDisplayed()
        // The live destination shows "In progress" for BOTH its location and its time line (web `endTs ? … : …`).
        compose.onAllNodesWithText("In progress").assertCountEquals(2)
    }

    @Test
    fun emptyDriveRendersChromeWithFallbackPlaceholders() {
        setContent(empty())
        compose.onNodeWithText("Journey Details").assertIsDisplayed()
        compose.onNodeWithText("Start").assertIsDisplayed()
        compose.onNodeWithText("Destination").assertIsDisplayed()
        compose.onNodeWithText("No address data").assertIsDisplayed()
        // Both columns still render their battery rows with the "?" placeholder — never a blank box.
        compose.onAllNodesWithText("Battery: ?%").assertCountEquals(2)
    }

    @Test
    fun accessibilityLabelsArePresentForTalkBack() {
        setContent(completed())
        // The panel is purely presentational (no interactive controls); its accessible content is the localized
        // text TalkBack reads. Each label resolves through the i18n catalog and is exposed in the semantics tree.
        compose.onNodeWithText("Journey Details").assertIsDisplayed()
        compose.onNodeWithText("Start").assertIsDisplayed()
        compose.onNodeWithText("Destination").assertIsDisplayed()
    }
}
