// Instrumented Compose UI + accessibility verification of [DashboardSettingsModalContent] across the branches the web
// component renders: the four populated sections (Identity / Vehicle Filter / Auto-Refresh / Display — the a11y label
// test), the icon palette's per-cell TalkBack label + click action (web `aria-label={emoji}`), the current-value
// surfaces (the seeded name + the "All Vehicles" / default-refresh dropdown anchors), the Save hand-off once the form
// is edited (the assembled rename + settings + unchanged-icon), the icon-change-on-Save path, the empty-vehicle-list
// branch (the "All Vehicles" option still renders), and the Cancel affordance. Runs under `connectedAndroidTest` (a
// device/emulator); the offline gate's `testReleaseUnitTest` covers the pure model.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.modalsdialogs.dashboardsettingsmodal

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
import androidx.compose.ui.test.performTextReplacement
import androidx.compose.ui.unit.dp
import io.teslasync.android.ui.theme.TeslaSyncTheme
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test

class DashboardSettingsModalUiTest {
    @get:Rule
    val compose = createComposeRule()

    private val strings =
        DashboardSettingsModalStrings(
            title = "Dashboard Settings",
            close = "Close",
            identity = "Identity",
            nameLabel = "Name",
            nameHint = "Dashboard name",
            iconLabel = "Icon",
            vehicleFilter = "Vehicle Filter",
            vehicleFilterDesc = "Show data for a specific vehicle in all widgets. Widget-level filters take precedence.",
            allVehicles = "All Vehicles",
            refresh = "Auto-Refresh",
            refresh0 = "Default (per widget)",
            refresh5 = "Every 5 seconds",
            refresh10 = "Every 10 seconds",
            refresh30 = "Every 30 seconds",
            refresh60 = "Every minute",
            refresh300 = "Every 5 minutes",
            display = "Display",
            showBorders = "Show widget borders",
            compactMode = "Compact mode (smaller gaps)",
            cancel = "Cancel",
            save = "Save",
        )

    private val dashboard =
        DashboardSummary(
            id = "d1",
            name = "Overview",
            icon = "📊",
            settings = DashboardSettingsValues(),
        )

    private val vehicles =
        listOf(
            VehicleOption(id = 1, displayName = "Model 3"),
            VehicleOption(id = 2, displayName = "Model Y"),
        )

    private fun setContent(
        dashboard: DashboardSummary = this.dashboard,
        vehicles: List<VehicleOption> = this.vehicles,
        onSave: (DashboardSettingsSaveResult) -> Unit = {},
        onCancel: () -> Unit = {},
    ) {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                Host {
                    DashboardSettingsModalContent(
                        strings = strings,
                        dashboard = dashboard,
                        vehicles = vehicles,
                        onSave = onSave,
                        onCancel = onCancel,
                    )
                }
            }
        }
    }

    @Test
    fun everySectionFieldAndActionExposesItsLabel() {
        setContent()
        compose.onNodeWithText(strings.identity).assertIsDisplayed()
        compose.onNodeWithText(strings.nameLabel, substring = true).assertIsDisplayed()
        compose.onNodeWithText(strings.iconLabel).assertIsDisplayed()
        compose.onNodeWithText(strings.vehicleFilter).assertIsDisplayed()
        compose.onNodeWithText(strings.vehicleFilterDesc).assertIsDisplayed()
        compose.onNodeWithText(strings.refresh).assertIsDisplayed()
        compose.onNodeWithText(strings.display).assertIsDisplayed()
        compose.onNodeWithText(strings.showBorders).assertIsDisplayed()
        compose.onNodeWithText(strings.compactMode).assertIsDisplayed()
        compose.onNodeWithText(strings.cancel).assertIsDisplayed().assertHasClickAction()
        compose.onNodeWithText(strings.save).assertIsDisplayed().assertHasClickAction()
    }

    @Test
    fun iconPaletteCellsAreLabelledForTalkBack() {
        setContent()
        compose.onNodeWithContentDescription("📊").assertIsDisplayed().assertHasClickAction()
        compose.onNodeWithContentDescription("🚗").assertIsDisplayed().assertHasClickAction()
    }

    @Test
    fun seededNameAndDropdownAnchorsRenderCurrentValues() {
        setContent()
        compose.onNodeWithText(dashboard.name).assertIsDisplayed()
        compose.onNodeWithText(strings.allVehicles).assertIsDisplayed()
        compose.onNodeWithText(strings.refresh0).assertIsDisplayed()
    }

    @Test
    fun editingNameAndTogglingBordersHandsBackResolvedSave() {
        var saved: DashboardSettingsSaveResult? = null
        setContent(onSave = { saved = it })

        compose.onNodeWithText(strings.nameLabel, substring = true).performTextReplacement("Fleet")
        compose.onNodeWithText(strings.showBorders).performClick()
        compose.onNodeWithText(strings.save).performClick()

        assertEquals("Fleet", saved?.rename)
        assertEquals(true, saved?.settings?.showWidgetBorders)
        assertNull(saved?.icon)
    }

    @Test
    fun selectingADifferentEmojiChangesIconOnSave() {
        var saved: DashboardSettingsSaveResult? = null
        setContent(onSave = { saved = it })

        compose.onNodeWithContentDescription("🚗").performClick()
        compose.onNodeWithText(strings.save).performClick()

        assertEquals("🚗", saved?.icon)
    }

    @Test
    fun emptyVehicleListStillRendersAllVehiclesOption() {
        setContent(vehicles = emptyList())
        compose.onNodeWithText(strings.vehicleFilter).assertIsDisplayed()
        compose.onNodeWithText(strings.allVehicles).assertIsDisplayed()
    }

    @Test
    fun cancelInvokesOnCancel() {
        var cancelled = false
        setContent(onCancel = { cancelled = true })
        compose.onNodeWithText(strings.cancel).performClick()
        assertTrue(cancelled)
    }

    @Composable
    private fun Host(content: @Composable () -> Unit) {
        Box(modifier = Modifier.size(width = HOST_WIDTH, height = HOST_HEIGHT)) { content() }
    }

    private companion object {
        val HOST_WIDTH = 420.dp
        val HOST_HEIGHT = 1600.dp
    }
}
