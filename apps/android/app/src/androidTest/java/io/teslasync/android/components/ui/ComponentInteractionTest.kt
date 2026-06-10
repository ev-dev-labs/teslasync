package io.teslasync.android.components.ui

import androidx.compose.foundation.layout.Column
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.hasSetTextAction
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performTextInput
import io.teslasync.android.ui.theme.TeslaSyncTheme
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test

/**
 * Instrumented Compose tests covering the shared primitives' core interactions and accessibility
 * semantics. Like the predecessor `LaunchTest`, these run on a device/emulator
 * (connectedDebugAndroidTest) rather than in the no-device gate; gate-run behavior coverage lives
 * in [UiLogicTest]/[DensityTest]. State is mirrored to on-screen text for robust assertions.
 */
class ComponentInteractionTest {
    @get:Rule
    val rule = createComposeRule()

    @Test
    fun buttonInvokesOnClick() {
        var clicks = 0
        rule.setContent { TeslaSyncTheme { Button("Save", onClick = { clicks++ }) } }
        rule.onNodeWithText("Save").performClick()
        assertEquals(1, clicks)
    }

    @Test
    fun loadingButtonSwallowsClicks() {
        var clicks = 0
        rule.setContent { TeslaSyncTheme { Button("Save", onClick = { clicks++ }, loading = true) } }
        rule.onNodeWithText("Save").performClick()
        assertEquals(0, clicks)
    }

    @Test
    fun toggleFlipsOnLabelTap() {
        rule.setContent {
            TeslaSyncTheme {
                var on by remember { mutableStateOf(false) }
                Column {
                    Toggle(checked = on, onCheckedChange = { on = it }, label = "Live updates")
                    BodyText("state=$on")
                }
            }
        }
        rule.onNodeWithText("Live updates").performClick()
        rule.onNodeWithText("state=true").assertIsDisplayed()
    }

    @Test
    fun checkboxTogglesOnLabelTap() {
        rule.setContent {
            TeslaSyncTheme {
                var checked by remember { mutableStateOf(false) }
                Column {
                    Checkbox(checked = checked, onCheckedChange = { checked = it }, label = "Enabled")
                    BodyText("checked=$checked")
                }
            }
        }
        rule.onNodeWithText("Enabled").performClick()
        rule.onNodeWithText("checked=true").assertIsDisplayed()
    }

    @Test
    fun tabsSelectChangesActiveKey() {
        rule.setContent {
            TeslaSyncTheme {
                var key by remember { mutableStateOf("a") }
                Column {
                    Tabs(listOf(TabItem("a", "Alpha"), TabItem("b", "Beta")), key, { key = it })
                    BodyText("selected=$key")
                }
            }
        }
        rule.onNodeWithText("Beta").performClick()
        rule.onNodeWithText("selected=b").assertIsDisplayed()
    }

    @Test
    fun inputReportsTypedText() {
        rule.setContent {
            TeslaSyncTheme {
                var text by remember { mutableStateOf("") }
                Column {
                    Input(value = text, onValueChange = { text = it }, label = "Name")
                    BodyText("value=$text")
                }
            }
        }
        rule.onNode(hasSetTextAction()).performTextInput("Model Y")
        rule.onNodeWithText("value=Model Y").assertIsDisplayed()
    }

    @Test
    fun badgeRendersLabel() {
        rule.setContent { TeslaSyncTheme { Badge("Online", variant = BadgeVariant.Success) } }
        rule.onNodeWithText("Online").assertIsDisplayed()
    }

    @Test
    fun confirmDialogConfirmFires() {
        var confirmed = false
        rule.setContent {
            TeslaSyncTheme {
                ConfirmDialog(
                    title = "Delete vehicle",
                    message = "This cannot be undone.",
                    confirmLabel = "Delete",
                    cancelLabel = "Cancel",
                    onConfirm = { confirmed = true },
                    onCancel = {},
                )
            }
        }
        rule.onNodeWithText("Delete").performClick()
        assertEquals(true, confirmed)
    }
}
