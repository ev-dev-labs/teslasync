// Instrumented Compose UI + accessibility verification of [FeedbackModalContent] across the branches the web
// component renders: the idle form (every labelled control present — the a11y label test), the disabled submit while
// the draft is invalid (web `submitDisabled`), the submit hand-off once title + body satisfy the bounds (the assembled
// draft with the web default category), the in-flight state (web `submit.isPending` — the submit button flips to its
// sending label and both actions disable), the inline submit-error alert (web `submit.isError`), and the Cancel
// affordance. Runs under `connectedAndroidTest` (a device/emulator); the offline gate's `testReleaseUnitTest` covers
// the pure model + the ViewModel orchestration.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.modalsdialogs.feedbackmodal

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.size
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.test.assertHasClickAction
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.assertIsEnabled
import androidx.compose.ui.test.assertIsNotEnabled
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performTextInput
import androidx.compose.ui.unit.dp
import io.teslasync.android.ui.theme.TeslaSyncTheme
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test

class FeedbackModalUiTest {
    @get:Rule
    val compose = createComposeRule()

    private val strings =
        FeedbackModalStrings(
            title = "Report a bug / Send feedback",
            close = "Close",
            categoryLabel = "What kind of feedback?",
            categoryBug = "Bug report",
            categoryFeature = "Feature request",
            categoryOther = "Other / question",
            titleLabel = "Title",
            titleHint = "Short summary",
            bodyLabel = "Details",
            bodyHint = "What happened?",
            contextTitle = "Auto-attached context",
            contextPage = "Page",
            contextAppVersion = "App version",
            contextUserAgent = "Browser",
            contextUnknown = "unknown",
            includeErrorsHint = "Includes the most recent uncaught errors from this session.",
            includeConsole = "Attach recent console messages",
            includeConsoleHint = "Privacy: console output may include URLs and data you saw.",
            submitError = "Failed to submit feedback. Please try again.",
            cancel = "Cancel",
            submitting = "Sending…",
            submit = "Send feedback",
            required = "required",
        )

    private val context =
        FeedbackContext(
            pageRoute = "/battery",
            appVersion = "1.4.2",
            userAgent = "TeslaSync-Android/1.4.2 (Pixel 8; Android 14)",
            recentErrors = emptyList(),
            consoleTail = "",
        )

    private fun setContent(
        submitting: Boolean = false,
        submitError: Boolean = false,
        onSubmit: (FeedbackDraft) -> Unit = {},
        onCancel: () -> Unit = {},
    ) {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                Host {
                    FeedbackModalContent(
                        strings = strings,
                        context = context,
                        submitting = submitting,
                        submitError = submitError,
                        onSubmit = onSubmit,
                        onCancel = onCancel,
                    )
                }
            }
        }
    }

    @Test
    fun everyFieldAndActionExposesItsLabel() {
        setContent()
        compose.onNodeWithText(strings.categoryLabel).assertIsDisplayed()
        compose.onNodeWithText(strings.titleLabel, substring = true).assertIsDisplayed()
        compose.onNodeWithText(strings.bodyLabel, substring = true).assertIsDisplayed()
        compose.onNodeWithText(strings.contextTitle).assertIsDisplayed()
        compose.onNodeWithText(context.pageRoute).assertIsDisplayed()
        compose.onNodeWithText(context.appVersion).assertIsDisplayed()
        compose.onNodeWithText(strings.includeConsole).assertIsDisplayed()
        compose.onNodeWithText(strings.cancel).assertIsDisplayed().assertHasClickAction()
        compose.onNodeWithText(strings.submit).assertIsDisplayed().assertHasClickAction()
    }

    @Test
    fun submitIsDisabledWhileTheDraftIsInvalid() {
        setContent()
        compose.onNodeWithText(strings.submit).assertIsNotEnabled()
    }

    @Test
    fun submitEnablesAndHandsBackTypedDraftWithWebDefaultCategory() {
        var submitted: FeedbackDraft? = null
        setContent(onSubmit = { submitted = it })

        compose.onNodeWithText(strings.titleLabel, substring = true).performTextInput("Battery widget shows NaN")
        compose
            .onNodeWithText(strings.bodyLabel, substring = true)
            .performTextInput("The battery widget renders NaN after a charge completes.")

        compose.onNodeWithText(strings.submit).assertIsEnabled().performClick()

        assertEquals("Battery widget shows NaN", submitted?.title)
        assertEquals("The battery widget renders NaN after a charge completes.", submitted?.body)
        assertEquals(FeedbackCategory.Bug, submitted?.category)
    }

    @Test
    fun inFlightShowsSendingLabelAndDisablesActions() {
        setContent(submitting = true)
        compose.onNodeWithText(strings.submitting).assertIsDisplayed().assertIsNotEnabled()
        compose.onNodeWithText(strings.cancel).assertIsNotEnabled()
    }

    @Test
    fun submitErrorRendersTheInlineAlert() {
        setContent(submitError = true)
        compose.onNodeWithText(strings.submitError).assertIsDisplayed()
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
        val HOST_HEIGHT = 1200.dp
    }
}
