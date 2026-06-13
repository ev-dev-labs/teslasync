// Instrumented Compose UI + accessibility verification of [GeofenceDrawerContent] across the branches the web
// component renders: the draw-affordance toolbar (every control announces its label to TalkBack), the accessible
// map node (its content description present), the existing-fences list with a per-row delete that hands the fence
// id back through onDelete, and the no-fences branch (chrome + hint still render, never a blank box). Runs under
// `connectedAndroidTest` (a device/emulator); the offline gate's `testReleaseUnitTest` covers the pure model.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.modalsdialogs.geofencedrawer

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.size
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.test.assertHasClickAction
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.unit.dp
import io.teslasync.android.components.maps.DraftGeofence
import io.teslasync.android.components.maps.GeoPoint
import io.teslasync.android.components.maps.MapGeofence
import io.teslasync.android.ui.theme.TeslaSyncTheme
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test

class GeofenceDrawerUiTest {
    @get:Rule
    val compose = createComposeRule()

    private val strings =
        GeofenceDrawerStrings(
            title = "Draw on map",
            close = "Close",
            drawHint = "Click the circle tool, then click and drag on the map to draw a fence.",
            mapLabel = "Geofence drawing map",
            summary = "Geofences",
            circle = "Draw on map",
            polygon = "Draw on map",
            rectangle = "Draw on map",
            clear = "Clear",
            save = "Save",
            radius = "Radius",
            delete = "Delete",
        )

    private val fences =
        listOf(
            MapGeofence(id = "home", name = "Home", center = GeoPoint(37.7749, -122.4194), radiusMeters = 150.0),
        )

    private fun setContent(
        fences: List<MapGeofence> = this.fences,
        onCreate: (DraftGeofence) -> Unit = {},
        onDelete: (String) -> Unit = {},
    ) {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                Host {
                    GeofenceDrawerContent(
                        fences = fences,
                        onCreate = onCreate,
                        onDelete = onDelete,
                        modes = GeofenceDrawerProjection.DEFAULT_MODES,
                        strings = strings,
                    )
                }
            }
        }
    }

    @Test
    fun everyControlExposesItsLabel() {
        setContent()
        // The localized draw hint and the existing-fences list header are shown.
        compose.onNodeWithText(strings.drawHint).assertIsDisplayed()
        compose.onNodeWithText(strings.summary).assertIsDisplayed()
        // The toolbar affordances each announce a clickable accessible label.
        compose.onNodeWithContentDescription(strings.circle).assertIsDisplayed().assertHasClickAction()
        compose.onNodeWithContentDescription(strings.clear).assertIsDisplayed().assertHasClickAction()
        compose.onNodeWithContentDescription(strings.save).assertIsDisplayed()
        // The per-row delete affordance is labelled with the fence name.
        compose.onNodeWithContentDescription("${strings.delete} Home").assertIsDisplayed().assertHasClickAction()
    }

    @Test
    fun mapExposesItsAccessibleLabel() {
        setContent()
        compose.onNodeWithContentDescription(strings.mapLabel).assertIsDisplayed()
    }

    @Test
    fun noFencesStillRendersHintAndHeader() {
        setContent(fences = emptyList())
        // The empty branch keeps the chrome — a friendly editor, never a blank box.
        compose.onNodeWithText(strings.drawHint).assertIsDisplayed()
        compose.onNodeWithText(strings.summary).assertIsDisplayed()
        compose.onNodeWithContentDescription(strings.circle).assertIsDisplayed().assertHasClickAction()
    }

    @Test
    fun deletingAFenceHandsBackItsId() {
        var deletedId: String? = null
        setContent(onDelete = { deletedId = it })
        compose.onNodeWithContentDescription("${strings.delete} Home").performClick()
        assertEquals("home", deletedId)
    }

    @Composable
    private fun Host(content: @Composable () -> Unit) {
        Box(modifier = Modifier.size(width = HOST_WIDTH, height = HOST_HEIGHT)) { content() }
    }

    private companion object {
        val HOST_WIDTH = 420.dp
        val HOST_HEIGHT = 1200.dp
    }
}
