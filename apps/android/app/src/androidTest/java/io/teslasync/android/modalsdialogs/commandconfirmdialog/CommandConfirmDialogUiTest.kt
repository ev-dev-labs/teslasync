// Instrumented Compose UI + accessibility verification of the CommandConfirmDialog surface across the branches
// the web component renders (web/src/features/system/components/CommandConfirmDialog.tsx): the danger title
// row + confirmation body, the typed-confirmation gate (web `confirmInput` — Confirm stays disabled until the
// exact token is typed, case-insensitively), the arming count-down (web `countdown` — Confirm disabled + dimmed
// and labelled `Confirm (Ns)` until it drains), the in-flight state (web `loading` — both actions disable), the
// Cancel / Confirm hand-offs, and the stateful open-gate (web `open` — composed only while open, dismissed via
// back / backdrop -> onClose). Every asserted label is the localized copy the surface exposes to TalkBack. Runs
// under `connectedAndroidTest`; the offline `testReleaseUnitTest` gate covers the pure projection.
package io.teslasync.android.modalsdialogs.commandconfirmdialog

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.size
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.test.assertDoesNotExist
import androidx.compose.ui.test.assertHasClickAction
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.assertIsEnabled
import androidx.compose.ui.test.assertIsNotEnabled
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performTextInput
import androidx.compose.ui.unit.dp
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.Logger
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test

class CommandConfirmDialogUiTest {
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

    private fun setContent(
        confirmToken: String? = null,
        typePrompt: String? = null,
        loading: Boolean = false,
        remaining: Int = 0,
        onCancel: () -> Unit = {},
        onConfirm: () -> Unit = {},
    ) {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                Host {
                    var typed by remember { mutableStateOf("") }
                    CommandConfirmDialogContent(
                        title = TITLE,
                        message = MESSAGE,
                        typePrompt = typePrompt,
                        typedFieldLabel = confirmToken,
                        typed = typed,
                        onTypedChange = { typed = it },
                        cancelLabel = CANCEL,
                        confirmLabel = CommandConfirmDialogProjection.countdownConfirmLabel(CONFIRM, remaining),
                        confirmEnabled = CommandConfirmDialogProjection.canConfirm(remaining, confirmToken, typed),
                        loading = loading,
                        onCancel = onCancel,
                        onConfirm = onConfirm,
                    )
                }
            }
        }
    }

    @Test
    fun titleMessageAndActionsRenderWithAccessibleNames() {
        setContent()
        compose.onNodeWithText(TITLE).assertIsDisplayed()
        compose.onNodeWithText(MESSAGE).assertIsDisplayed()
        compose.onNodeWithText(CANCEL).assertIsDisplayed().assertHasClickAction()
        compose.onNodeWithText(CONFIRM).assertIsDisplayed().assertHasClickAction()
    }

    @Test
    fun typedConfirmationGateEnablesConfirmOnlyOnExactMatch() {
        setContent(confirmToken = TYPED_TOKEN, typePrompt = TYPE_PROMPT)
        compose.onNodeWithText(TYPE_PROMPT).assertIsDisplayed()
        compose.onNodeWithTag(CommandConfirmDialogTestTags.TYPED_INPUT).assertIsDisplayed()
        compose.onNodeWithText(CONFIRM).assertIsNotEnabled()

        compose.onNodeWithTag(CommandConfirmDialogTestTags.TYPED_INPUT).performTextInput("eras")
        compose.onNodeWithText(CONFIRM).assertIsNotEnabled()

        // Case-insensitive exact match arms Confirm (web `inputValue.trim().toUpperCase() === confirmInput…`).
        compose.onNodeWithTag(CommandConfirmDialogTestTags.TYPED_INPUT).performTextInput("e")
        compose.onNodeWithText(CONFIRM).assertIsEnabled()
    }

    @Test
    fun countdownHoldsConfirmDisabledAndLabelsRemainingSeconds() {
        setContent(remaining = 5)
        compose.onNodeWithText(COUNTDOWN_CONFIRM).assertIsDisplayed().assertIsNotEnabled()
    }

    @Test
    fun inFlightDisablesBothActions() {
        setContent(loading = true)
        compose.onNodeWithText(CANCEL).assertIsNotEnabled()
        compose.onNodeWithText(CONFIRM).assertIsNotEnabled()
    }

    @Test
    fun cancelInvokesOnClose() {
        var cancelled = false
        setContent(onCancel = { cancelled = true })
        compose.onNodeWithText(CANCEL).performClick()
        assertTrue("tapping Cancel must invoke onClose", cancelled)
    }

    @Test
    fun confirmInvokesOnConfirm() {
        var confirmed = false
        setContent(onConfirm = { confirmed = true })
        compose.onNodeWithText(CONFIRM).performClick()
        assertTrue("tapping Confirm must invoke onConfirm", confirmed)
    }

    @Test
    fun statefulEntryRendersBodyAndConfirms() {
        var confirmed = false
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                CommandConfirmDialog(
                    open = true,
                    def = SIMPLE_DEF,
                    onClose = {},
                    onConfirm = { confirmed = true },
                    logger = SilentLogger,
                )
            }
        }
        compose.waitForIdle()

        // The dynamic title/body keys are absent from the catalog, so the def fallbacks render (web parity).
        compose.onNodeWithText(MESSAGE).assertIsDisplayed()
        compose.onNodeWithText(CONFIRM).performClick()
        assertTrue("the stateful entry must fire onConfirm", confirmed)
    }

    @Test
    fun closedStatefulEntryRendersNothing() {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                CommandConfirmDialog(
                    open = false,
                    def = SIMPLE_DEF,
                    onClose = {},
                    onConfirm = {},
                    logger = SilentLogger,
                )
            }
        }
        compose.waitForIdle()
        compose.onNodeWithText(MESSAGE).assertDoesNotExist()
    }

    @Composable
    private fun Host(content: @Composable () -> Unit) {
        Box(modifier = Modifier.size(width = HOST_WIDTH, height = HOST_HEIGHT)) { content() }
    }

    private companion object {
        const val TITLE = "Erase Data"
        const val MESSAGE = "This will erase all user data from the vehicle touchscreen. Continue?"
        const val CONFIRM = "Confirm"
        const val COUNTDOWN_CONFIRM = "Confirm (5s)"
        const val CANCEL = "Cancel"
        const val TYPED_TOKEN = "ERASE"
        const val TYPE_PROMPT = "Type \"ERASE\" to confirm:"
        val SIMPLE_DEF =
            CommandConfirmDef(
                labelKey = "commands.security.eraseData",
                labelFallback = TITLE,
                confirmKey = "commands.security.confirmErase",
                confirmFallback = MESSAGE,
            )
        val HOST_WIDTH = 420.dp
        val HOST_HEIGHT = 900.dp
    }
}
