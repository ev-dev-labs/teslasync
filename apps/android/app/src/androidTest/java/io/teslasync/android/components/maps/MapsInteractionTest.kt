package io.teslasync.android.components.maps

import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import io.teslasync.android.ui.theme.TeslaSyncTheme
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test

/**
 * Instrumented Compose tests for the maps layer's previewable chrome — the layer switcher and the
 * accessible summary. The live `GoogleMap` surfaces need Play Services on the device, so their
 * behavior is covered by the no-device [MapsLogicTest]; these assert the controls and the
 * screen-reader list alternative that render without the SDK.
 */
class MapsInteractionTest {
    @get:Rule
    val rule = createComposeRule()

    @Test
    fun layerSwitcherFiresOnChange() {
        var picked: MapStyleId? = null
        rule.setContent {
            TeslaSyncTheme {
                MapLayerSwitcher(current = MapStyleId.Dark, onChange = { picked = it })
            }
        }
        rule.onNodeWithText("Satellite").performClick()
        assertEquals(MapStyleId.Satellite, picked)
    }

    @Test
    fun accessibleSummaryShowsEachLine() {
        rule.setContent {
            TeslaSyncTheme {
                MapAccessibleSummary(label = "Route", lines = listOf("Route of 3 points, 2.4 km over 10:00."))
            }
        }
        rule.onNodeWithText("Route of 3 points, 2.4 km over 10:00.").assertIsDisplayed()
    }

    @Test
    fun emptySummaryShowsFallbackMessage() {
        rule.setContent {
            TeslaSyncTheme {
                MapAccessibleSummary(label = "Geofences", lines = emptyList(), emptyMessage = "No geofences yet.")
            }
        }
        rule.onNodeWithText("No geofences yet.").assertIsDisplayed()
    }
}
