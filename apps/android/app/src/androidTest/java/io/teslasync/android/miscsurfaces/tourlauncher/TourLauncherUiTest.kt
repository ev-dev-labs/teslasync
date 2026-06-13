package io.teslasync.android.miscsurfaces.tourlauncher

import androidx.compose.runtime.Composable
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import io.teslasync.android.ui.theme.TeslaSyncTheme
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test

/**
 * On-device Compose UI + accessibility verification of the TourLauncher render branches. Mirrors the web spec
 * (web/src/features/onboarding/TourLauncher.tsx): a populated list draws each tour's title, the recommended
 * tour's "Recommended for this page" chip and the completed tour's "Completed" badge; the Start/Replay actions
 * expose the web aria-labels for TalkBack and invoke the start callback with the tour id; the footer's "Reset
 * all tours" and "Close" fire their callbacks; an empty registry renders the friendly empty state rather than a
 * blank box; and the modal shell shows the "Take a tour" title. Runs under `connectedAndroidTest`; the offline
 * gate's `testReleaseUnitTest` covers the registry/projection/ViewModel logic.
 */
class TourLauncherUiTest {
    @get:Rule
    val compose = createComposeRule()

    private val sampleRows =
        listOf(
            TourRow("vehicles", version = 1, completed = false, recommended = true),
            TourRow("drives", version = 1, completed = true, recommended = false),
            TourRow("main", version = 2, completed = false, recommended = false),
        )

    @Test
    fun bodyRendersTourRowsWithRecommendedAndCompletedAffordances() {
        renderBody(sampleRows)

        compose.onNodeWithText("Vehicles & access").assertIsDisplayed()
        compose.onNodeWithText("Drives & replay").assertIsDisplayed()
        compose.onNodeWithText("TeslaSync overview").assertIsDisplayed()
        // Recommended chip (web Sparkles chip) + Completed badge.
        compose.onNodeWithText("Recommended for this page").assertIsDisplayed()
        compose.onNodeWithText("Completed").assertIsDisplayed()
        // Subtitle is always shown (web modal lead paragraph).
        compose.onNodeWithText("Guided walkthroughs for every major feature.").assertIsDisplayed()
    }

    @Test
    fun startAndReplayActionsExposeAccessibleAriaLabels() {
        renderBody(sampleRows)

        // Web aria-label "Start tour: {{title}}" / "Replay tour: {{title}}" — the catalog phrasing for TalkBack.
        compose.onNodeWithContentDescription("Start Vehicles & access tour").assertIsDisplayed()
        compose.onNodeWithContentDescription("Replay Drives & replay tour").assertIsDisplayed()
    }

    @Test
    fun startActionInvokesCallbackWithTheTourId() {
        val started = mutableListOf<String>()
        renderBody(sampleRows, onStart = { started += it })

        compose.onNodeWithContentDescription("Start Vehicles & access tour").performClick()
        compose.waitForIdle()

        assertEquals(listOf("vehicles"), started)
    }

    @Test
    fun footerResetAndCloseInvokeTheirCallbacks() {
        var resetCount = 0
        var closeCount = 0
        renderBody(sampleRows, onResetAll = { resetCount++ }, onClose = { closeCount++ })

        compose.onNodeWithText("Reset all tours").performClick()
        compose.onNodeWithText("Close").performClick()
        compose.waitForIdle()

        assertEquals(1, resetCount)
        assertEquals(1, closeCount)
    }

    @Test
    fun emptyRegistryRendersFriendlyMessageNotABlankBox() {
        renderBody(emptyList())

        compose.onNodeWithText("No data available").assertIsDisplayed()
    }

    @Test
    fun modalShellRendersTheLauncherTitle() {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                TourLauncherContent(
                    rows = sampleRows,
                    strings = rememberTourLauncherStrings(),
                    onStart = {},
                    onResetAll = {},
                    onClose = {},
                )
            }
        }
        compose.waitForIdle()

        compose.onNodeWithText("Take a tour").assertIsDisplayed()
    }

    private fun renderBody(
        rows: List<TourRow>,
        onStart: (String) -> Unit = {},
        onResetAll: () -> Unit = {},
        onClose: () -> Unit = {},
    ) {
        compose.setContent {
            ThemedBody(rows = rows, onStart = onStart, onResetAll = onResetAll, onClose = onClose)
        }
        compose.waitForIdle()
    }

    @Composable
    private fun ThemedBody(
        rows: List<TourRow>,
        onStart: (String) -> Unit,
        onResetAll: () -> Unit,
        onClose: () -> Unit,
    ) {
        TeslaSyncTheme(dynamicColor = false) {
            TourLauncherBody(
                rows = rows,
                strings = rememberTourLauncherStrings(),
                onStart = onStart,
                onResetAll = onResetAll,
                onClose = onClose,
            )
        }
    }
}
