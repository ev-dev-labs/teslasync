// Instrumented Compose UI + accessibility verification of [FrontendErrorsCardContent] across every branch the
// web component renders (offenders list / clean-hour "no errors" line) plus the lifecycle chrome the host's
// feed implies (loading skeleton / hard error with retry). Verifies the always-present heading, the total +
// offender labels, the metric's spoken accessibility label, the offenders region label, the loading region's
// TalkBack label, and the retry affordance. Runs under `connectedAndroidTest` (a device/emulator); the
// offline gate's `testReleaseUnitTest` covers the pure projection + Resource → UiState mapping.
// `mainClock.autoAdvance` is disabled because the surface hosts an indefinite animation (the loading skeleton
// shimmer) that never idles.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.featureviews.frontenderrorscard

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
import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import io.teslasync.android.ui.theme.TeslaSyncTheme
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test

class FrontendErrorsCardUiTest {
    @get:Rule
    val compose = createComposeRule()

    private val strings =
        FrontendErrorsCardStrings(
            title = "Frontend Errors (Last Hour)",
            subtitle = "Reported by browser sessions",
            totalLabel = "Errors in last hour",
            topOffendersLabel = "Top error sources",
            noErrors = "No frontend errors reported in the last hour.",
            unableToLoad = "Unable to load error summary.",
            retryLabel = "Retry",
        )

    private fun summary(): WebErrorsSummary =
        WebErrorsSummary(
            total = 42.0,
            top =
                listOf(
                    WebErrorEntry(name = "ChargingChart", route = "/charging", count = 18.0),
                    WebErrorEntry(name = "DriveMap", route = "/drives/123", count = 12.0),
                ),
        )

    private fun setContent(
        state: UiState<WebErrorsSummary>,
        onRetry: () -> Unit = {},
    ) {
        compose.mainClock.autoAdvance = false
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                Host {
                    FrontendErrorsCardContent(state = state, onRetry = onRetry, strings = strings)
                }
            }
        }
    }

    @Test
    fun headingIsAlwaysVisible() {
        setContent(UiState(UiPhase.Content, data = summary()))
        compose.onNodeWithText(strings.title).assertIsDisplayed()
    }

    @Test
    fun contentShowsTheTotalAndEveryOffender() {
        setContent(UiState(UiPhase.Content, data = summary()))
        compose.onNodeWithText("42").assertIsDisplayed()
        compose.onNodeWithText("ChargingChart").assertIsDisplayed()
        compose.onNodeWithText("/charging").assertIsDisplayed()
        compose.onNodeWithText("18").assertIsDisplayed()
        compose.onNodeWithText("DriveMap").assertIsDisplayed()
    }

    @Test
    fun metricExposesItsSpokenAccessibilityLabel() {
        setContent(UiState(UiPhase.Content, data = summary()))
        compose.onNodeWithContentDescription("42, ${strings.totalLabel}").assertIsDisplayed()
    }

    @Test
    fun offendersRegionExposesAccessibleLabel() {
        setContent(UiState(UiPhase.Content, data = summary()))
        compose.onNodeWithContentDescription(strings.topOffendersLabel).assertIsDisplayed()
    }

    @Test
    fun cleanHourShowsTheNoErrorsMessage() {
        setContent(UiState(UiPhase.Empty, data = WebErrorsSummary.EMPTY))
        compose.onNodeWithText(strings.noErrors).assertIsDisplayed()
    }

    @Test
    fun loadingShowsAnAccessibleSkeleton() {
        setContent(UiState.loading())
        compose.onNodeWithContentDescription("Loading").assertIsDisplayed()
    }

    @Test
    fun errorWithNoCacheShowsUnableToLoadAndRetryAffordance() {
        var retried = false
        setContent(UiState(UiPhase.Error, errorKind = ErrorKind.Network), onRetry = { retried = true })
        compose.onNodeWithText(strings.unableToLoad).assertIsDisplayed()
        compose.onNodeWithText(strings.retryLabel).assertIsDisplayed().assertHasClickAction()
        compose.onNodeWithText(strings.retryLabel).performClick()
        assertTrue(retried)
    }

    @Composable
    private fun Host(content: @Composable () -> Unit) {
        Box(modifier = Modifier.size(width = HOST_WIDTH, height = HOST_HEIGHT)) { content() }
    }

    private companion object {
        val HOST_WIDTH = 420.dp
        val HOST_HEIGHT = 720.dp
    }
}
