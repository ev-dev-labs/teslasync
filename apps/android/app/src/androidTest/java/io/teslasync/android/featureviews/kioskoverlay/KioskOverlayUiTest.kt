package io.teslasync.android.featureviews.kioskoverlay

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.size
import androidx.compose.ui.Modifier
import androidx.compose.ui.test.assertHasClickAction
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.unit.dp
import androidx.test.platform.app.InstrumentationRegistry
import io.teslasync.android.R
import io.teslasync.android.ui.theme.TeslaSyncTheme
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test

/**
 * Instrumented Compose UI + accessibility verification of [KioskOverlayContent] across the branches the web
 * component renders (web/src/features/dashboard/components/KioskOverlay.tsx): the dim wash, the corner clock,
 * the rotation dots, and the always-reachable exit affordance. Every asserted string is resolved from the
 * app's i18n resources so the test follows the device locale rather than hard-coding English; the clock
 * strings are supplied directly to the stateless content so the assertions are zone/locale independent.
 * Runs under `connectedAndroidTest`; the offline `testReleaseUnitTest` gate covers the pure projection +
 * clock formatting.
 */
class KioskOverlayUiTest {
    @get:Rule
    val compose = createComposeRule()

    private val context get() = InstrumentationRegistry.getInstrumentation().targetContext

    private fun string(id: Int) = context.getString(id)

    private val exitAccessibleName get() = string(R.string.translation_kiosk_exit)
    private val exitLabel get() = string(R.string.translation_kiosk_exitLabel)

    private fun setContent(
        display: KioskOverlayDisplay,
        timeText: String = TIME,
        dateText: String = DATE,
        showExit: Boolean = true,
        onExit: () -> Unit = {},
    ) {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                Box(modifier = Modifier.size(width = HOST_WIDTH, height = HOST_HEIGHT)) {
                    KioskOverlayContent(
                        display = display,
                        timeText = timeText,
                        dateText = dateText,
                        showExit = showExit,
                        onExit = onExit,
                    )
                }
            }
        }
    }

    private fun display(
        dimAlpha: Float? = 0.5f,
        showClock: Boolean = true,
        clockPosition: KioskClockPosition = KioskClockPosition.BottomRight,
        showDots: Boolean = true,
        dotCount: Int = 4,
        activeDotIndex: Int = 1,
    ) = KioskOverlayDisplay(
        dimAlpha = dimAlpha,
        cursorHidden = false,
        showClock = showClock,
        clockPosition = clockPosition,
        showDots = showDots,
        dotCount = dotCount,
        activeDotIndex = activeDotIndex,
    )

    @Test
    fun dimmedClockDotsAndExitAllRender() {
        setContent(display())

        compose.onNodeWithTag(KioskOverlayTestTags.DIM_LAYER).assertIsDisplayed()
        compose.onNodeWithText(TIME).assertIsDisplayed()
        compose.onNodeWithText(DATE).assertIsDisplayed()
        compose.onNodeWithTag(KioskOverlayTestTags.ROTATION_DOTS).assertIsDisplayed()
        // The exit affordance's accessible name is present (a11y label test) and is actionable.
        compose.onNodeWithContentDescription(exitAccessibleName).assertIsDisplayed().assertHasClickAction()
        compose.onNodeWithText(exitLabel, useUnmergedTree = true).assertIsDisplayed()
    }

    @Test
    fun clockHiddenRemovesTheReadoutButKeepsTheExit() {
        setContent(display(showClock = false), timeText = "", dateText = "")

        compose.onNodeWithText(TIME).assertDoesNotExist()
        compose.onNodeWithText(DATE).assertDoesNotExist()
        compose.onNodeWithContentDescription(exitAccessibleName).assertHasClickAction()
    }

    @Test
    fun noDimAndSingleDashboardOmitTheirLayers() {
        setContent(display(dimAlpha = null, showDots = false, dotCount = 1, activeDotIndex = 0))

        compose.onNodeWithTag(KioskOverlayTestTags.DIM_LAYER).assertDoesNotExist()
        compose.onNodeWithTag(KioskOverlayTestTags.ROTATION_DOTS).assertDoesNotExist()
        // The clock still renders in the chosen corner.
        compose.onNodeWithText(TIME).assertIsDisplayed()
    }

    @Test
    fun exitAffordanceIsAlwaysReachableEvenWhenHidden() {
        // Web "always accessible via touch": the exit button stays composed + actionable at opacity 0.
        var exited = false
        setContent(display(), showExit = false, onExit = { exited = true })

        compose.onNodeWithContentDescription(exitAccessibleName).assertHasClickAction().performClick()
        assertTrue("tapping the exit affordance must invoke onExit", exited)
    }

    @Test
    fun exitButtonExposesBothItsAccessibleNameAndVisibleLabel() {
        setContent(display())

        // Accessible name = web aria-label ("Exit kiosk mode"); visible label = "Exit Kiosk".
        compose.onNodeWithContentDescription(exitAccessibleName).assertIsDisplayed()
        compose.onNodeWithText(exitLabel, useUnmergedTree = true).assertIsDisplayed()
    }

    private companion object {
        val HOST_WIDTH = 360.dp
        val HOST_HEIGHT = 640.dp
        const val TIME = "10:47 PM"
        const val DATE = "Thu, Jun 11"
    }
}
