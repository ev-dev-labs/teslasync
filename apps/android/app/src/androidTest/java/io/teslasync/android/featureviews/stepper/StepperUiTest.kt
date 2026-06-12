package io.teslasync.android.featureviews.stepper

import androidx.compose.ui.test.assertHasClickAction
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import io.teslasync.android.ui.theme.TeslaSyncTheme
import org.junit.Rule
import org.junit.Test

/**
 * On-device Compose UI + accessibility verification of [StepperContent] across the states the surface
 * renders: the content list (every step title shown, and only the current step's CTA), the all-done list
 * (no CTA), the friendly empty state, the hard-error retry surface, and the loading skeleton. Also asserts
 * the current CTA is a labeled, clickable node (the one interactive element) and that the decorative
 * indicators are kept out of the accessibility tree (web `aria-hidden`). Mirrors the web spec
 * (web/src/features/onboarding/components/Stepper.tsx).
 */
class StepperUiTest {
    @get:Rule
    val compose = createComposeRule()

    private val steps =
        listOf(
            OnboardingStepData(
                key = "tesla",
                title = "Connect your Tesla account",
                description = "Authorize the Fleet API connection.",
                done = true,
                cta = OnboardingStepCta(label = "Connect"),
            ),
            OnboardingStepData(
                key = "vehicle",
                title = "Wait for vehicles to appear",
                description = "Vehicles sync automatically.",
                done = false,
                cta = OnboardingStepCta(label = "Refresh"),
            ),
            OnboardingStepData(
                key = "telemetry",
                title = "Wait for telemetry data",
                description = "Live data appears after the first signal batch.",
                done = false,
                cta = OnboardingStepCta(label = "Setup guide"),
            ),
        )

    private fun setContent(state: UiState<List<OnboardingStepData>>) {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                StepperContent(state = state, onRetry = {})
            }
        }
    }

    @Test
    fun contentRendersEveryTitleAndOnlyTheCurrentStepCta() {
        setContent(StepperProjection.projectUiState(steps, isLoading = false))

        compose.onNodeWithText("Connect your Tesla account").assertIsDisplayed()
        compose.onNodeWithText("Wait for vehicles to appear").assertIsDisplayed()
        compose.onNodeWithText("Wait for telemetry data").assertIsDisplayed()
        // Web `state === 'current' && step.cta`: only the current (vehicle) step shows its CTA.
        compose.onNodeWithText("Refresh").assertIsDisplayed()
        compose.onNodeWithText("Connect").assertDoesNotExist()
        compose.onNodeWithText("Setup guide").assertDoesNotExist()
    }

    @Test
    fun theCurrentCtaIsALabeledClickableNode() {
        setContent(StepperProjection.projectUiState(steps, isLoading = false))
        // The one interactive element carries its label and a click action (accessibility contract).
        compose.onNodeWithText("Refresh").assertHasClickAction()
    }

    @Test
    fun decorativeIndicatorsStayOutOfTheAccessibilityTree() {
        // Web indicators are `aria-hidden`: the pending step number must not surface to TalkBack.
        setContent(StepperProjection.projectUiState(steps, isLoading = false))
        compose.onNodeWithText("3").assertDoesNotExist()
    }

    @Test
    fun everyStepDoneHidesEveryCta() {
        val allDone = steps.map { it.copy(done = true) }
        setContent(StepperProjection.projectUiState(allDone, isLoading = false))

        compose.onNodeWithText("Connect your Tesla account").assertIsDisplayed()
        compose.onNodeWithText("Refresh").assertDoesNotExist()
    }

    @Test
    fun emptyStateRendersItsMessage() {
        setContent(UiState(phase = UiPhase.Empty, data = emptyList()))
        compose.onNodeWithText("No setup steps available right now.").assertIsDisplayed()
    }

    @Test
    fun errorStateRendersARetryAffordance() {
        setContent(UiState(phase = UiPhase.Error, errorKind = ErrorKind.Network))
        compose.onNodeWithText("Retry").assertIsDisplayed()
    }

    @Test
    fun loadingStateIsAnnouncedToTalkBack() {
        setContent(UiState.loading())
        compose.onNodeWithContentDescription("Loading...").assertExists()
    }
}
