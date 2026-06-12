package io.teslasync.android.featureviews.telemetrygrid

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.size
import androidx.compose.ui.Modifier
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.test.platform.app.InstrumentationRegistry
import io.teslasync.android.R
import io.teslasync.android.data.UnitFormatter
import io.teslasync.android.ui.theme.TeslaSyncTheme
import org.junit.Rule
import org.junit.Test

/**
 * Instrumented Compose UI + accessibility verification of [TelemetryGridContent] across the branches the web
 * component renders (web/src/features/vehicles/components/telemetry-panels/TelemetryGrid.tsx): the populated
 * six-tile grid, the empty state, and the wide responsive (6-column) layout. Every asserted label is resolved
 * from the app's i18n resources so the test follows the device locale rather than hard-coding English; each
 * tile merges its descendants into a single accessibility node, so a label query that matches proves the tile
 * exposes that label to TalkBack. The clock auto-advance is disabled and the staggered FadeIn entrances are
 * settled with an explicit advance. Runs under `connectedAndroidTest`; the offline `testReleaseUnitTest` gate
 * covers the pure projection.
 */
class TelemetryGridUiTest {
    @get:Rule
    val compose = createComposeRule()

    private val context get() = InstrumentationRegistry.getInstrumentation().targetContext

    private fun string(id: Int) = context.getString(id)

    private fun sampleState() =
        VehicleStateTelemetry(
            batteryLevel = 84.0,
            ratedRangeMeters = 350_000.0,
            speedMps = 0.0,
            insideTempCelsius = 21.0,
            outsideTempCelsius = 14.0,
            odometerMeters = 19_874_000.0,
            isCharging = true,
            chargerPowerKw = 11.0,
            timeToFullChargeHours = 1.5,
            sentryMode = true,
        )

    private fun setContent(
        display: TelemetryGridDisplay?,
        width: Dp = PHONE_WIDTH,
    ) {
        compose.mainClock.autoAdvance = false
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                Box(modifier = Modifier.size(width = width, height = HOST_HEIGHT)) {
                    TelemetryGridContent(display = display)
                }
            }
        }
        compose.mainClock.advanceTimeBy(SETTLE_MS)
    }

    @Test
    fun dataShowsEveryTileLabelAndTheDeterministicValues() {
        setContent(TelemetryGridProjection.project(sampleState(), UnitFormatter.default()))

        // Every tile's accessible label is present (a11y label test).
        for (labelId in TILE_LABEL_IDS) {
            compose.onNodeWithText(string(labelId)).assertIsDisplayed()
        }
        // The number-path values render exactly as the web `fmtInt` figures.
        compose.onNodeWithText("84%").assertIsDisplayed()
        compose.onNodeWithText("11 kW").assertIsDisplayed()
        // The charger "Full in …h" sub composes the translated word with the projected hours.
        compose.onNodeWithText("${string(R.string.translation_vehicles_detail_fullIn)} 1.50h").assertIsDisplayed()
    }

    @Test
    fun emptyShowsTheNoDataMessageAndHidesTheTiles() {
        setContent(display = null)

        val noData = string(R.string.translation_common_noData)
        // The empty message renders as text and as the surface's accessible description (a11y).
        compose.onNodeWithText(noData).assertIsDisplayed()
        compose.onNodeWithContentDescription(noData).assertIsDisplayed()
        // No tile labels render in the empty branch.
        compose.onNodeWithText(string(R.string.translation_common_battery)).assertDoesNotExist()
    }

    @Test
    fun wideLayoutRendersEveryTileLabel() {
        setContent(TelemetryGridProjection.project(sampleState(), UnitFormatter.default()), width = WIDE_WIDTH)

        for (labelId in TILE_LABEL_IDS) {
            compose.onNodeWithText(string(labelId)).assertIsDisplayed()
        }
    }

    private companion object {
        val PHONE_WIDTH = 360.dp
        val WIDE_WIDTH = 1320.dp
        val HOST_HEIGHT = 1024.dp
        const val SETTLE_MS = 2_000L

        val TILE_LABEL_IDS =
            listOf(
                R.string.translation_common_battery,
                R.string.translation_common_speed,
                R.string.translation_common_inside,
                R.string.translation_common_odometer,
                R.string.translation_common_charger,
                R.string.translation_common_sentry,
            )
    }
}
