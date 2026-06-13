// Instrumented Compose UI + accessibility verification of [KioskSettingsModalContent] across the branches the web
// component renders: the three FormSection groups and every labelled control (the expanded form), the four conditional
// sub-controls appearing/disappearing with their toggles (dashboard checklist when rotation is on + >1 dashboard,
// cursor-timeout when auto-hide is on, brightness when dim is on, clock-position when the clock is shown), the
// "Default" chip on a default dashboard, and the Cancel + Enter hand-offs (Enter commits the selection then fires
// onEnterKiosk + onClose). Runs under `connectedAndroidTest` (a device/emulator); the offline gate's
// `testReleaseUnitTest` covers the pure model.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.modalsdialogs.kiosksettingsmodal

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.test.assertDoesNotExist
import androidx.compose.ui.test.assertHasClickAction
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import io.teslasync.android.ui.theme.TeslaSyncTheme
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test

class KioskSettingsModalUiTest {
    @get:Rule
    val compose = createComposeRule()

    private val strings =
        KioskSettingsModalStrings(
            title = "Kiosk Settings",
            closeDialog = "Close",
            rotation = "Dashboard Rotation",
            rotationInterval = "Rotation Interval",
            dashboardsToRotate = "Dashboards to Rotate",
            default = "Default",
            display = "Display",
            hideCursor = "Auto-hide Cursor",
            cursorTimeout = "Hide After",
            dimAfter = "Dim Screen After",
            brightness = "Dimmed Brightness",
            showClock = "Show Clock",
            clockPosition = "Clock Position",
            clockTopLeft = "Top Left",
            clockTopRight = "Top Right",
            clockBottomLeft = "Bottom Left",
            clockBottomRight = "Bottom Right",
            transparency = "Transparency",
            transparencyDesc = "Adjust widget and background opacity.",
            widgetOpacity = "Widget Opacity",
            backgroundOpacity = "Background Opacity",
            transparent = "Transparent",
            solid = "Solid",
            preview = "Preview — this is how widgets will look",
            hint = "Kiosk mode enters fullscreen and hides all navigation.",
            off = "Off",
            never = "Never",
            cancel = "Cancel",
            enter = "Enter Kiosk Mode",
        )

    private val dashboards =
        listOf(
            SavedDashboard(id = "main", name = "Main", isDefault = true),
            SavedDashboard(id = "energy", name = "Energy"),
            SavedDashboard(id = "trips", name = "Trips"),
        )

    private fun setContent(
        initial: KioskConfig = KioskConfig(dimAfter = 10),
        onEnterKiosk: () -> Unit = {},
        onClose: () -> Unit = {},
    ) {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                Host {
                    var config by remember { mutableStateOf(initial) }
                    KioskSettingsModalContent(
                        config = config,
                        dashboards = dashboards,
                        strings = strings,
                        onUpdateConfig = { config = it },
                        onEnterKiosk = onEnterKiosk,
                        onClose = onClose,
                    )
                }
            }
        }
    }

    @Test
    fun everySectionAndControlExposesItsLabel() {
        setContent()
        // Section headings.
        compose.onNodeWithText(strings.rotation).performScrollTo().assertIsDisplayed()
        compose.onNodeWithText(strings.display).performScrollTo().assertIsDisplayed()
        compose.onNodeWithText(strings.transparency).performScrollTo().assertIsDisplayed()
        // Always-present controls.
        compose.onNodeWithText(strings.rotationInterval).performScrollTo().assertIsDisplayed()
        compose.onNodeWithText(strings.hideCursor).performScrollTo().assertIsDisplayed()
        compose.onNodeWithText(strings.dimAfter).performScrollTo().assertIsDisplayed()
        compose.onNodeWithText(strings.showClock).performScrollTo().assertIsDisplayed()
        compose.onNodeWithText(strings.widgetOpacity).performScrollTo().assertIsDisplayed()
        compose.onNodeWithText(strings.backgroundOpacity).performScrollTo().assertIsDisplayed()
        compose.onNodeWithText(strings.preview).performScrollTo().assertIsDisplayed()
        compose.onNodeWithText(strings.hint).performScrollTo().assertIsDisplayed()
        compose
            .onNodeWithText(strings.cancel)
            .performScrollTo()
            .assertIsDisplayed()
            .assertHasClickAction()
        compose
            .onNodeWithText(strings.enter)
            .performScrollTo()
            .assertIsDisplayed()
            .assertHasClickAction()
    }

    @Test
    fun expandedConfigShowsEveryConditionalBranch() {
        setContent(initial = KioskConfig(rotateInterval = 30, hideCursor = true, dimAfter = 10, showClock = true))
        compose.onNodeWithText(strings.dashboardsToRotate).performScrollTo().assertIsDisplayed()
        compose.onNodeWithText(strings.cursorTimeout).performScrollTo().assertIsDisplayed()
        compose.onNodeWithText(strings.brightness).performScrollTo().assertIsDisplayed()
        compose.onNodeWithText(strings.clockPosition).performScrollTo().assertIsDisplayed()
        // The checklist renders each dashboard name + the Default chip on the default one.
        compose.onNodeWithText("Main").performScrollTo().assertIsDisplayed()
        compose.onNodeWithText("Energy").performScrollTo().assertIsDisplayed()
        compose.onNodeWithText(strings.default).performScrollTo().assertIsDisplayed()
    }

    @Test
    fun collapsedConfigHidesEveryConditionalBranch() {
        setContent(
            initial = KioskConfig(rotateInterval = 0, hideCursor = false, dimAfter = 0, showClock = false),
        )
        compose.onNodeWithText(strings.dashboardsToRotate).assertDoesNotExist()
        compose.onNodeWithText(strings.cursorTimeout).assertDoesNotExist()
        compose.onNodeWithText(strings.brightness).assertDoesNotExist()
        compose.onNodeWithText(strings.clockPosition).assertDoesNotExist()
    }

    @Test
    fun togglingShowClockHidesTheClockPositionSelect() {
        setContent(initial = KioskConfig(showClock = true))
        compose.onNodeWithText(strings.clockPosition).performScrollTo().assertIsDisplayed()
        compose.onNodeWithText(strings.showClock).performScrollTo().performClick()
        compose.onNodeWithText(strings.clockPosition).assertDoesNotExist()
    }

    @Test
    fun cancelInvokesOnClose() {
        var closed = false
        setContent(onClose = { closed = true })
        compose.onNodeWithText(strings.cancel).performScrollTo().performClick()
        assertTrue(closed)
    }

    @Test
    fun enterCommitsThenEntersKioskAndCloses() {
        var entered = false
        var closed = false
        setContent(onEnterKiosk = { entered = true }, onClose = { closed = true })
        compose.onNodeWithText(strings.enter).performScrollTo().performClick()
        assertTrue(entered)
        assertTrue(closed)
    }

    @Composable
    private fun Host(content: @Composable () -> Unit) {
        Column(
            modifier = Modifier.fillMaxSize().verticalScroll(rememberScrollState()),
        ) {
            content()
        }
    }
}
