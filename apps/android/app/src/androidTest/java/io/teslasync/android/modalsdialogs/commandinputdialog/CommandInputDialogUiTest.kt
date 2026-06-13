// Instrumented Compose UI + accessibility verification of the CommandInputDialog surface across the branches the
// web component renders (web/src/features/system/components/CommandInputDialog.tsx): the header (icon + command
// title + prompt), the per-parameter inputs with their accessible labels, the per-field blur validation (web
// `handleBlur` -> `validateField`), the whole-form Send gate (web `disabled={!isValid()}`), the in-flight state
// (web `loading` — Send disabled), the Cancel / Send hand-offs (web `onClose` / `onSubmit(values)`), and the
// stateful entry's dismiss + title. Every asserted label is the localized copy the surface exposes to TalkBack.
// Runs under `connectedAndroidTest`; the offline `testReleaseUnitTest` gate covers the pure projection.
package io.teslasync.android.modalsdialogs.commandinputdialog

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
import io.teslasync.android.components.ui.TeslaGlyphs
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.Logger
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test

class CommandInputDialogUiTest {
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

    private fun pinSpec() =
        CommandInputSpec(
            title = PIN_TITLE,
            prompt = PIN_PROMPT,
            fields = listOf(CommandInputField("password", PIN_LABEL, null, FieldValidation.Pin)),
        )

    private fun coordSpec(
        latInitial: String = "",
        lonInitial: String = "",
    ) = CommandInputSpec(
        title = COORD_TITLE,
        prompt = COORD_PROMPT,
        fields =
            listOf(
                CommandInputField("lat", LAT_LABEL, "37.7749", FieldValidation.Decimal, initialValue = latInitial),
                CommandInputField("lon", LON_LABEL, "-122.4194", FieldValidation.Decimal, initialValue = lonInitial),
            ),
    )

    private fun setContent(
        spec: CommandInputSpec,
        loading: Boolean = false,
        onSubmit: (Map<String, String>) -> Unit = {},
        onCancel: () -> Unit = {},
    ) {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                Host {
                    CommandInputDialogContent(
                        spec = spec,
                        icon = TeslaGlyphs.Pin,
                        loading = loading,
                        onSubmit = onSubmit,
                        onCancel = onCancel,
                    )
                }
            }
        }
    }

    @Test
    fun headerFieldsAndActionsRenderWithAccessibleNames() {
        setContent(coordSpec())
        // Header: command title + prompt (web `t(def.labelKey)` / `t(inputConfig.promptKey)`).
        compose.onNodeWithText(COORD_TITLE).assertIsDisplayed()
        compose.onNodeWithText(COORD_PROMPT).assertIsDisplayed()
        // Each input exposes its label as its accessible name (TalkBack).
        compose.onNodeWithText(LAT_LABEL).assertIsDisplayed()
        compose.onNodeWithText(LON_LABEL).assertIsDisplayed()
        // Actions are present + clickable.
        compose.onNodeWithText(CANCEL).assertIsDisplayed().assertHasClickAction()
        compose.onNodeWithText(SEND).assertIsDisplayed().assertHasClickAction()
    }

    @Test
    fun sendIsDisabledUntilEveryFieldIsValid() {
        setContent(coordSpec())
        // Multi-field opens empty -> invalid -> Send disabled (web `disabled={!isValid()}`).
        compose.onNodeWithText(SEND).assertIsNotEnabled()

        compose.onNodeWithText(LAT_LABEL).performTextInput("37.77")
        compose.onNodeWithText(SEND).assertIsNotEnabled()

        compose.onNodeWithText(LON_LABEL).performTextInput("-122.41")
        compose.onNodeWithText(SEND).assertIsEnabled()
    }

    @Test
    fun blurringAnInvalidFieldShowsItsLocalizedError() {
        setContent(coordSpec())
        // Type an unparseable decimal into lat, then focus lon -> lat blurs (web `handleBlur`) and validates.
        compose.onNodeWithText(LAT_LABEL).performTextInput("abc")
        compose.onNodeWithText(LON_LABEL).performTextInput("5")
        compose.onNodeWithText(DECIMAL_ERROR).assertIsDisplayed()
        // The form is still invalid, so Send stays disabled.
        compose.onNodeWithText(SEND).assertIsNotEnabled()
    }

    @Test
    fun submitInvokesOnSubmitWithTheEnteredValues() {
        var submitted: Map<String, String>? = null
        setContent(coordSpec(), onSubmit = { submitted = it })

        compose.onNodeWithText(LAT_LABEL).performTextInput("37.77")
        compose.onNodeWithText(LON_LABEL).performTextInput("-122.41")
        compose.onNodeWithText(SEND).assertIsEnabled().performClick()

        assertEquals(mapOf("lat" to "37.77", "lon" to "-122.41"), submitted)
    }

    @Test
    fun loadingDisablesSendButKeepsCancelEnabled() {
        // A spec whose fields are already valid, so only `loading` can disable Send.
        setContent(coordSpec(latInitial = "37.77", lonInitial = "-122.41"), loading = true)
        compose.onNodeWithText(SEND).assertIsNotEnabled()
        compose.onNodeWithText(CANCEL).assertIsEnabled()
    }

    @Test
    fun sendIsEnabledForAValidPrefilledFormWhenNotLoading() {
        setContent(coordSpec(latInitial = "37.77", lonInitial = "-122.41"))
        compose.onNodeWithText(SEND).assertIsEnabled()
    }

    @Test
    fun cancelInvokesOnCancel() {
        var cancelled = false
        setContent(pinSpec(), onCancel = { cancelled = true })
        compose.onNodeWithText(CANCEL).performClick()
        assertTrue("tapping Cancel must invoke onCancel", cancelled)
    }

    @Test
    fun statefulEntryRendersTitleAndDismissesOnCancel() {
        var closed = false
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                CommandInputDialog(
                    spec = pinSpec(),
                    icon = TeslaGlyphs.Pin,
                    onSubmit = {},
                    onClose = { closed = true },
                    logger = SilentLogger,
                )
            }
        }

        compose.onNodeWithText(PIN_TITLE).assertIsDisplayed()
        compose.onNodeWithText(PIN_LABEL).assertIsDisplayed()
        compose.onNodeWithText(CANCEL).performClick()
        assertTrue("Cancel must dismiss the dialog via onClose", closed)
    }

    @Composable
    private fun Host(content: @Composable () -> Unit) {
        Box(modifier = Modifier.size(width = HOST_WIDTH, height = HOST_HEIGHT)) { content() }
    }

    private companion object {
        const val PIN_TITLE = "Set PIN to Drive"
        const val PIN_PROMPT = "Enter 4-digit PIN:"
        const val PIN_LABEL = "Requires PIN"
        const val COORD_TITLE = "Share Destination"
        const val COORD_PROMPT = "Enter GPS coordinates"
        const val LAT_LABEL = "Latitude"
        const val LON_LABEL = "Longitude"
        const val CANCEL = "Cancel"
        const val SEND = "Send"
        const val DECIMAL_ERROR = "Enter a valid number"
        val HOST_WIDTH = 420.dp
        val HOST_HEIGHT = 900.dp
    }
}
