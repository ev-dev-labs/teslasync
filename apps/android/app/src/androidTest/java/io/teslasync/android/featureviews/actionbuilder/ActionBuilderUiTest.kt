package io.teslasync.android.featureviews.actionbuilder

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performTextInput
import io.teslasync.android.ui.theme.TeslaSyncTheme
import org.junit.Rule
import org.junit.Test

/**
 * On-device Compose UI + accessibility verification of [ActionBuilderContent] across every state the surface
 * renders: an empty action list (just the Add button), each of the four action kinds with its own field set,
 * the command-params object-error state (driven by text input), and the "No channels configured" notify
 * fallback. Also verifies the add/remove edits mutate the list and that the icon-only move/remove controls
 * expose accessible names. Runs under `connectedAndroidTest`; the offline gate's `testReleaseUnitTest` covers
 * the pure model, this covers render + a11y. Mirrors the web spec
 * (web/src/features/automations/pages/ActionBuilder.tsx).
 */
class ActionBuilderUiTest {
    @get:Rule
    val compose = createComposeRule()

    private val strings = buildActionBuilderStrings { null }
    private val actionTypeOptions = buildActionTypeOptions { null }
    private val commandOptions = buildCommandOptions { null }

    private fun setStatefulContent(
        initial: List<ActionStepInput>,
        channels: List<ActionChannel> = emptyList(),
    ) {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                var actions by remember { mutableStateOf(initial) }
                ActionBuilderContent(
                    actions = actions,
                    channels = channels,
                    strings = strings,
                    actionTypeOptions = actionTypeOptions,
                    commandOptions = commandOptions,
                    onActionsChange = { actions = it },
                )
            }
        }
    }

    @Test
    fun emptyStateShowsOnlyTheAddButton() {
        setStatefulContent(initial = emptyList())
        compose.onNodeWithText("Add Action").assertIsDisplayed()
        compose.onNodeWithText("Action Type").assertDoesNotExist()
    }

    @Test
    fun commandActionRendersTypeCommandAndParamsFields() {
        setStatefulContent(initial = listOf(ActionStepInput.Command(commandName = "lock")))
        compose.onNodeWithText("Action Type").assertIsDisplayed()
        compose.onNodeWithText("Command").assertIsDisplayed()
        compose.onNodeWithText("Params (JSON, optional)").assertIsDisplayed()
    }

    @Test
    fun notifyActionWithoutChannelsShowsNoChannelsFallback() {
        setStatefulContent(initial = listOf(ActionStepInput.Notify(channelId = 0, template = "")))
        compose.onNodeWithText("Channel").assertIsDisplayed()
        compose.onNodeWithText("Message").assertIsDisplayed()
        compose.onNodeWithText("No channels configured").assertIsDisplayed()
    }

    @Test
    fun setSettingActionRendersKeyTypeAndValueFields() {
        setStatefulContent(initial = listOf(ActionStepInput.SetSetting(settingKey = "charge_limit", valueNum = 80.0)))
        compose.onNodeWithText("Setting Key").assertIsDisplayed()
        compose.onNodeWithText("Value Type").assertIsDisplayed()
        compose.onNodeWithText("Value").assertIsDisplayed()
    }

    @Test
    fun callAutomationActionRendersTargetIdField() {
        setStatefulContent(initial = listOf(ActionStepInput.CallAutomation(targetAutomationId = 12)))
        compose.onNodeWithText("Target Automation ID").assertIsDisplayed()
    }

    @Test
    fun invalidObjectParamsSurfacesTheObjectError() {
        setStatefulContent(initial = listOf(ActionStepInput.Command(commandName = "lock")))
        compose.onNodeWithText("Params (JSON, optional)").performTextInput("[1, 2]")
        compose.waitForIdle()
        compose.onNodeWithText("Params must be a JSON object.").assertIsDisplayed()
    }

    @Test
    fun moveAndRemoveControlsExposeAccessibleNames() {
        setStatefulContent(initial = listOf(ActionStepInput.Command(commandName = "lock")))
        compose.onNodeWithContentDescription("Move up").assertIsDisplayed()
        compose.onNodeWithContentDescription("Move down").assertIsDisplayed()
        compose.onNodeWithContentDescription("Remove action").assertIsDisplayed()
    }

    @Test
    fun addActionAppendsADefaultCommandCard() {
        setStatefulContent(initial = emptyList())
        compose.onNodeWithText("Action Type").assertDoesNotExist()
        compose.onNodeWithText("Add Action").performClick()
        compose.waitForIdle()
        // The default appended action is a command, so its type label and command field appear.
        compose.onNodeWithText("Action Type").assertIsDisplayed()
        compose.onNodeWithText("Command").assertIsDisplayed()
    }

    @Test
    fun removeActionDropsTheCard() {
        setStatefulContent(initial = listOf(ActionStepInput.Command(commandName = "lock")))
        compose.onNodeWithText("Action Type").assertIsDisplayed()
        compose.onNodeWithContentDescription("Remove action").performClick()
        compose.waitForIdle()
        compose.onNodeWithText("Action Type").assertDoesNotExist()
        compose.onNodeWithText("Add Action").assertIsDisplayed()
    }
}
