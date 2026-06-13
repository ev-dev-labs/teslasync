// Instrumented Compose UI + accessibility verification of the CommandSelectDialog surface across the branches the web
// component renders (web/src/features/system/components/CommandSelectDialog.tsx): the icon + title header, the option
// list (label + optional description) with each option's click action, the per-option disabled state while a command
// dispatches (web `loading` -> `disabled={loading}`) with the still-live Cancel, the option hand-off (web
// `onSelect(opt.value)`), the Cancel hand-off (web `onClose`), the friendly empty state when a malformed config carries
// no options, and the `open` render gate on the stateful entry. Every asserted label is the localized copy the surface
// exposes to TalkBack. Runs under `connectedAndroidTest`; the offline `testReleaseUnitTest` gate covers the pure
// projection.
package io.teslasync.android.modalsdialogs.commandselectdialog

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.size
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.test.assertHasClickAction
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.assertIsEnabled
import androidx.compose.ui.test.assertIsNotEnabled
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.unit.dp
import io.teslasync.android.components.ui.TeslaGlyphs
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.Logger
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test

class CommandSelectDialogUiTest {
    @get:Rule
    val compose = createComposeRule()

    /** Logger that records nothing — keeps the stateful entry's diagnostic effect inert in tests. */
    private object SilentLogger : Logger {
        override fun log(
            level: LogLevel,
            event: String,
            fields: Map<String, String>,
        ) = Unit
    }

    private val strings =
        CommandSelectDialogStrings(
            cancel = CANCEL,
            closeDialog = CLOSE,
            noOptions = NO_OPTIONS,
        )

    private fun def(options: List<CommandSelectOption> = OPTIONS) =
        CommandSelectDef(icon = TeslaGlyphs.Info, title = TITLE, options = options)

    private fun setContent(
        options: List<CommandSelectOption> = OPTIONS,
        loading: Boolean = false,
        onSelect: (String) -> Unit = {},
        onCancel: () -> Unit = {},
    ) {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                Host {
                    CommandSelectDialogContent(
                        def = def(options),
                        loading = loading,
                        strings = strings,
                        onSelect = onSelect,
                        onCancel = onCancel,
                    )
                }
            }
        }
    }

    @Test
    fun headerAndOptionsRenderWithAccessibleNames() {
        setContent()
        compose.onNodeWithText(TITLE).assertIsDisplayed()
        compose.onNodeWithText(OFF_LABEL).assertIsDisplayed()
        compose.onNodeWithText(OFF_DESCRIPTION).assertIsDisplayed()
        compose.onNodeWithText(HIGH_LABEL).assertIsDisplayed()
        compose.onNodeWithTag(CommandSelectDialogTestTags.option("0")).assertHasClickAction()
        compose.onNodeWithText(CANCEL).assertIsDisplayed().assertHasClickAction()
    }

    @Test
    fun loadingDisablesEveryOptionButKeepsCancelLive() {
        setContent(loading = true)
        compose.onNodeWithTag(CommandSelectDialogTestTags.option("0")).assertIsNotEnabled()
        compose.onNodeWithTag(CommandSelectDialogTestTags.option("3")).assertIsNotEnabled()
        // The web Cancel button carries no `disabled` prop, so dismissal is always available.
        compose.onNodeWithText(CANCEL).assertIsEnabled()
    }

    @Test
    fun selectingAnOptionHandsBackItsValue() {
        var selected: String? = null
        setContent(onSelect = { selected = it })
        compose.onNodeWithTag(CommandSelectDialogTestTags.option("3")).performClick()
        assertEquals("choosing an option must hand back its value", "3", selected)
    }

    @Test
    fun cancelInvokesOnCancel() {
        var cancelled = false
        setContent(onCancel = { cancelled = true })
        compose.onNodeWithText(CANCEL).performClick()
        assertTrue("tapping Cancel must invoke onCancel", cancelled)
    }

    @Test
    fun emptyOptionsRenderFriendlyEmptyStateNotABlankBox() {
        setContent(options = emptyList())
        compose.onNodeWithTag(CommandSelectDialogTestTags.EMPTY).assertIsDisplayed()
        compose.onNodeWithText(NO_OPTIONS).assertIsDisplayed()
        // The header + Cancel stay visible — the surface is never hidden.
        compose.onNodeWithText(TITLE).assertIsDisplayed()
        compose.onNodeWithText(CANCEL).assertIsDisplayed()
    }

    @Test
    fun closedDialogRendersNothing() {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                CommandSelectDialog(
                    open = false,
                    def = def(),
                    onClose = {},
                    onSelect = {},
                    logger = SilentLogger,
                )
            }
        }
        compose.onNodeWithText(TITLE).assertDoesNotExist()
    }

    @Test
    fun openDialogRendersHeaderAndOptions() {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                CommandSelectDialog(
                    open = true,
                    def = def(),
                    onClose = {},
                    onSelect = {},
                    logger = SilentLogger,
                )
            }
        }
        compose.onNodeWithText(TITLE).assertIsDisplayed()
        compose.onNodeWithText(OFF_LABEL).assertIsDisplayed()
    }

    @Composable
    private fun Host(content: @Composable () -> Unit) {
        Box(modifier = Modifier.size(width = HOST_WIDTH, height = HOST_HEIGHT)) { content() }
    }

    private companion object {
        const val TITLE = "Seat heater — front left"
        const val OFF_LABEL = "Off"
        const val OFF_DESCRIPTION = "Turn the seat heater off"
        const val HIGH_LABEL = "High"
        const val CANCEL = "Cancel"
        const val CLOSE = "Close dialog"
        const val NO_OPTIONS = "No data available"

        val OPTIONS =
            listOf(
                CommandSelectOption(value = "0", label = OFF_LABEL, description = OFF_DESCRIPTION),
                CommandSelectOption(value = "1", label = "Low"),
                CommandSelectOption(value = "2", label = "Medium"),
                CommandSelectOption(value = "3", label = HIGH_LABEL, description = "Maximum heat"),
            )

        val HOST_WIDTH = 420.dp
        val HOST_HEIGHT = 900.dp
    }
}
