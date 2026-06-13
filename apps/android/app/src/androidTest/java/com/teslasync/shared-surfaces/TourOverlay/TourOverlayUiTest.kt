// Instrumented Compose UI + accessibility verification of the stateless TourOverlayContent across the states
// the web component renders: the hidden surface (web `targetRect === null` → nothing), the first step (title,
// description, counter, "Skip tour", "Next", and the close ✕ — but no "Back" and no "Get Started!"), a middle
// step (adds "Back"), and the last step ("Get Started!" instead of "Next"). Also asserts the dialog pane label
// + the merged title/description announcement (the web `role="dialog"` + `<h4>`/`<p>`) and that the close /
// skip / back / next affordances invoke their callbacks. Runs under `connectedAndroidTest` (a device/
// emulator); the offline `testReleaseUnitTest` gate covers the pure model. Reduced motion is forced on so the
// entry animation settles instantly and the card is immediately displayed.
//
// `InvalidPackageDeclaration` is suppressed: the test mirrors the surface's mandated package.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.touroverlay

import androidx.compose.runtime.Composable
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import io.teslasync.android.ui.theme.TeslaSyncTheme
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test

class TourOverlayUiTest {
    @get:Rule
    val compose = createComposeRule()

    @Test
    fun hiddenSurfaceRendersNothing() {
        setOverlay(surface = TourSurface.Hidden)
        compose.onNodeWithTag(TOUR_OVERLAY_TEST_TAG).assertDoesNotExist()
        compose.onNodeWithTag(TOUR_TOOLTIP_TEST_TAG).assertDoesNotExist()
        compose.onNodeWithText(SKIP).assertDoesNotExist()
        compose.onNodeWithContentDescription(CLOSE).assertDoesNotExist()
    }

    @Test
    fun firstStepShowsContentSkipNextAndCloseButNoBackOrFinish() {
        setOverlay(surface = visibleSurface(currentStep = 0, totalSteps = 4))
        compose.onNodeWithTag(TOUR_TOOLTIP_TEST_TAG).assertIsDisplayed()
        compose.onNodeWithText(TITLE, substring = true).assertIsDisplayed()
        compose.onNodeWithText(COUNTER_FIRST, substring = true).assertIsDisplayed()
        compose.onNodeWithText(SKIP).assertIsDisplayed()
        compose.onNodeWithText(NEXT).assertIsDisplayed()
        compose.onNodeWithContentDescription(CLOSE).assertIsDisplayed()
        compose.onNodeWithText(BACK).assertDoesNotExist()
        compose.onNodeWithText(FINISH).assertDoesNotExist()
    }

    @Test
    fun middleStepShowsBackAndNext() {
        setOverlay(surface = visibleSurface(currentStep = 1, totalSteps = 4))
        compose.onNodeWithText(BACK).assertIsDisplayed()
        compose.onNodeWithText(NEXT).assertIsDisplayed()
        compose.onNodeWithText(FINISH).assertDoesNotExist()
    }

    @Test
    fun lastStepShowsFinishInsteadOfNext() {
        setOverlay(surface = visibleSurface(currentStep = 3, totalSteps = 4))
        compose.onNodeWithText(FINISH).assertIsDisplayed()
        compose.onNodeWithText(NEXT).assertDoesNotExist()
        compose.onNodeWithText(BACK).assertIsDisplayed()
    }

    @Test
    fun tooltipExposesDialogPaneAndMergedAnnouncement() {
        setOverlay(surface = visibleSurface(currentStep = 0, totalSteps = 4))
        // Web role="dialog" pane label + the merged <h4>/<p> announcement + the labelled close affordance.
        compose.onNodeWithContentDescription(DIALOG_LABEL).assertExists()
        compose.onNodeWithContentDescription(MERGED_LABEL).assertExists()
        compose.onNodeWithContentDescription(CLOSE).assertExists()
    }

    @Test
    fun skipInvokesCallback() {
        var skipped = false
        setOverlay(surface = visibleSurface(0, 4), onSkip = { skipped = true })
        compose.onNodeWithText(SKIP).performClick()
        assertTrue(skipped)
    }

    @Test
    fun closeInvokesSkipCallback() {
        var skipped = false
        setOverlay(surface = visibleSurface(0, 4), onSkip = { skipped = true })
        compose.onNodeWithContentDescription(CLOSE).performClick()
        assertTrue(skipped)
    }

    @Test
    fun nextInvokesCallback() {
        var advanced = false
        setOverlay(surface = visibleSurface(0, 4), onNext = { advanced = true })
        compose.onNodeWithText(NEXT).performClick()
        assertTrue(advanced)
    }

    @Test
    fun backInvokesPrevCallback() {
        var wentBack = false
        setOverlay(surface = visibleSurface(1, 4), onPrev = { wentBack = true })
        compose.onNodeWithText(BACK).performClick()
        assertTrue(wentBack)
    }

    @Test
    fun finishInvokesNextCallback() {
        var finished = false
        setOverlay(surface = visibleSurface(3, 4), onNext = { finished = true })
        compose.onNodeWithText(FINISH).performClick()
        assertTrue(finished)
    }

    private fun setOverlay(
        surface: TourSurface,
        onNext: () -> Unit = {},
        onPrev: () -> Unit = {},
        onSkip: () -> Unit = {},
    ) {
        compose.setContent {
            ThemedOverlay(surface = surface, onNext = onNext, onPrev = onPrev, onSkip = onSkip)
        }
    }

    @Composable
    private fun ThemedOverlay(
        surface: TourSurface,
        onNext: () -> Unit,
        onPrev: () -> Unit,
        onSkip: () -> Unit,
    ) {
        TeslaSyncTheme(dynamicColor = false) {
            TourOverlayContent(
                surface = surface,
                reducedMotion = true,
                onNext = onNext,
                onPrev = onPrev,
                onSkip = onSkip,
            )
        }
    }

    private fun visibleSurface(
        currentStep: Int,
        totalSteps: Int,
    ): TourSurface =
        classifyTour(
            target = TourTarget(leftDp = 48f, topDp = 220f, widthDp = 240f, heightDp = 56f),
            step = TourStepContent(title = TITLE, description = DESCRIPTION, placement = TourPlacement.Bottom),
            currentStep = currentStep,
            totalSteps = totalSteps,
        )

    private companion object {
        // Test fixture step copy (caller-supplied data, asserted on-device).
        const val TITLE = "Battery Health"
        const val DESCRIPTION = "Track your pack over time."
        const val MERGED_LABEL = "Battery Health. Track your pack over time."

        // English catalog values resolved on-device (translation_tour_* + translation_lightbox_counter).
        const val SKIP = "Skip tour"
        const val NEXT = "Next"
        const val BACK = "Back"
        const val FINISH = "Get Started!"
        const val CLOSE = "Close tour"
        const val DIALOG_LABEL = "Onboarding tour"
        const val COUNTER_FIRST = "1 / 4"
    }
}
