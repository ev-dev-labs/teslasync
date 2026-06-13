// Instrumented Compose UI + accessibility verification of [ConfirmDialogContent] across the branches the web
// component renders (web/src/components/ai/ConfirmDialog.tsx): the tool name + pretty-printed arguments, the
// mutating-vs-read intro copy, the optional tool description, the empty-arguments `{}` rendering, the
// in-flight state (web `loading` — both actions disable), and the Approve / Cancel hand-offs. Every asserted
// label is the localized copy the surface exposes to TalkBack. Runs under `connectedAndroidTest`; the offline
// `testReleaseUnitTest` gate covers the pure projection + JSON formatting.
package io.teslasync.android.modalsdialogs.confirmdialog

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.size
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.test.assertHasClickAction
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.assertIsNotEnabled
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.unit.dp
import io.teslasync.android.ui.theme.TeslaSyncTheme
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test

class ConfirmDialogUiTest {
    @get:Rule
    val compose = createComposeRule()

    private val strings =
        ConfirmDialogStrings(
            title = "Approve Helix action",
            introMutates = "The assistant wants to make a change to your data. Review what it will do, then approve or cancel.",
            introRead = "The assistant wants to run a tool. Review the inputs, then approve or cancel.",
            toolLabel = "Tool",
            argsLabel = "Arguments",
            approve = "Approve",
            cancel = "Cancel",
            close = "Close",
        )

    private fun display(
        toolName: String = "set_alert_threshold",
        toolDescription: String? = "Update an alert rule threshold.",
        mutates: Boolean = true,
        argsJson: String = ARGS_JSON,
    ) = ConfirmDialogDisplay(
        toolName = toolName,
        toolDescription = toolDescription,
        mutates = mutates,
        argsJson = argsJson,
    )

    private fun setContent(
        display: ConfirmDialogDisplay = display(),
        loading: Boolean = false,
        onConfirm: () -> Unit = {},
        onCancel: () -> Unit = {},
    ) {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                Host {
                    ConfirmDialogContent(
                        display = display,
                        strings = strings,
                        loading = loading,
                        onConfirm = onConfirm,
                        onCancel = onCancel,
                    )
                }
            }
        }
    }

    @Test
    fun toolNameArgumentsAndActionsAllRender() {
        setContent()

        compose.onNodeWithText(strings.toolLabel).assertIsDisplayed()
        compose.onNodeWithTag(ConfirmDialogTestTags.TOOL_NAME).assertIsDisplayed()
        compose.onNodeWithText("set_alert_threshold").assertIsDisplayed()
        compose.onNodeWithText(strings.argsLabel).assertIsDisplayed()
        compose.onNodeWithTag(ConfirmDialogTestTags.ARGS).assertIsDisplayed()
        compose.onNodeWithText("rule_id", substring = true, useUnmergedTree = true).assertIsDisplayed()
        // The Approve / Cancel actions expose their accessible names and are actionable (a11y label test).
        compose.onNodeWithText(strings.cancel).assertIsDisplayed().assertHasClickAction()
        compose.onNodeWithText(strings.approve).assertIsDisplayed().assertHasClickAction()
    }

    @Test
    fun mutatingToolShowsTheMutatingIntro() {
        setContent(display(mutates = true))

        compose.onNodeWithText(strings.introMutates).assertIsDisplayed()
        compose.onNodeWithText(strings.introRead).assertDoesNotExist()
    }

    @Test
    fun readOnlyToolShowsTheReadIntro() {
        setContent(display(mutates = false))

        compose.onNodeWithText(strings.introRead).assertIsDisplayed()
        compose.onNodeWithText(strings.introMutates).assertDoesNotExist()
    }

    @Test
    fun descriptionRendersWhenPresentAndIsOmittedWhenAbsent() {
        setContent(display(toolDescription = "Update an alert rule threshold."))
        compose.onNodeWithText("Update an alert rule threshold.").assertIsDisplayed()

        setContent(display(toolDescription = null))
        compose.onNodeWithText("Update an alert rule threshold.").assertDoesNotExist()
    }

    @Test
    fun emptyArgumentsRenderFriendlyBraces() {
        setContent(display(argsJson = "{}"))

        compose.onNodeWithTag(ConfirmDialogTestTags.ARGS).assertIsDisplayed()
        compose.onNodeWithText("{}", useUnmergedTree = true).assertIsDisplayed()
    }

    @Test
    fun inFlightDisablesBothActions() {
        setContent(loading = true)

        compose.onNodeWithText(strings.cancel).assertIsNotEnabled()
        compose.onNodeWithText(strings.approve).assertIsNotEnabled()
    }

    @Test
    fun approveInvokesOnConfirm() {
        var approved = false
        setContent(onConfirm = { approved = true })

        compose.onNodeWithText(strings.approve).performClick()
        assertTrue("tapping Approve must invoke onConfirm", approved)
    }

    @Test
    fun cancelInvokesOnCancel() {
        var cancelled = false
        setContent(onCancel = { cancelled = true })

        compose.onNodeWithText(strings.cancel).performClick()
        assertTrue("tapping Cancel must invoke onCancel", cancelled)
    }

    @Composable
    private fun Host(content: @Composable () -> Unit) {
        Box(modifier = Modifier.size(width = HOST_WIDTH, height = HOST_HEIGHT)) { content() }
    }

    private companion object {
        val HOST_WIDTH = 420.dp
        val HOST_HEIGHT = 900.dp
        const val ARGS_JSON = "{\n  \"rule_id\": 42,\n  \"threshold\": 80\n}"
    }
}
