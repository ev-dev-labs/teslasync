// Instrumented Compose UI + accessibility verification of the ConfirmDialog surface across the branches the web
// component renders (web/src/components/ui/ConfirmDialog.tsx): the severity-tinted message + Cancel / Confirm
// actions (danger and warning), the typed-confirmation gate (web `requireTypedConfirmation` — Confirm stays
// disabled until the exact string is typed), the "Don't ask again" silence checkbox (web `silenceKey`), the
// in-flight state (web `loading` — both actions disable), the Cancel / Confirm hand-offs, and the silenced
// auto-resolve short-circuit on the stateful entry (web `isSilenced` -> fire onConfirm, render nothing). Every
// asserted label is the localized copy the surface exposes to TalkBack. Runs under `connectedAndroidTest`; the
// offline `testReleaseUnitTest` gate covers the pure projection.
package io.teslasync.android.modalsdialogs.confirmdialog

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.size
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
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
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test

class ConfirmDialogUiTest {
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

    /** In-memory silence store for the stateful integration tests (mirrors web `lib/confirmSilence.ts`). */
    private class FakeSilenceStore : ConfirmSilenceStore {
        private val silenced = mutableSetOf<String>()

        override fun isSilenced(key: String): Boolean = key.isNotEmpty() && key in silenced

        override fun silence(key: String) {
            if (key.isNotEmpty()) silenced += key
        }
    }

    private fun setContent(
        severity: ConfirmSeverity = ConfirmSeverity.Critical,
        loading: Boolean = false,
        requireTypedConfirmation: String? = null,
        silenceHonored: Boolean = false,
        onConfirm: () -> Unit = {},
        onCancel: () -> Unit = {},
    ) {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                Host {
                    var typed by remember { mutableStateOf("") }
                    var dontAskAgain by remember { mutableStateOf(false) }
                    ConfirmDialogContent(
                        message = MESSAGE,
                        confirmLabel = CONFIRM,
                        cancelLabel = CANCEL,
                        severity = severity,
                        loading = loading,
                        requireTypedConfirmation = requireTypedConfirmation,
                        typedConfirmationInputLabel = requireTypedConfirmation,
                        typed = typed,
                        onTypedChange = { typed = it },
                        silenceHonored = silenceHonored,
                        silenceCheckboxLabel = SILENCE_LABEL,
                        dontAskAgain = dontAskAgain,
                        onDontAskAgainChange = { dontAskAgain = it },
                        confirmEnabled = ConfirmDialogProjection.confirmEnabled(loading, requireTypedConfirmation, typed),
                        onConfirm = onConfirm,
                        onCancel = onCancel,
                    )
                }
            }
        }
    }

    @Test
    fun messageAndActionsRenderWithAccessibleNames() {
        setContent()
        compose.onNodeWithText(MESSAGE).assertIsDisplayed()
        compose.onNodeWithText(CANCEL).assertIsDisplayed().assertHasClickAction()
        compose.onNodeWithText(CONFIRM).assertIsDisplayed().assertHasClickAction()
    }

    @Test
    fun warningVariantShowsMessageAndSilenceAffordance() {
        setContent(severity = ConfirmSeverity.Warn, silenceHonored = true)
        compose.onNodeWithText(MESSAGE).assertIsDisplayed()
        compose.onNodeWithText(SILENCE_LABEL).assertIsDisplayed().assertHasClickAction()
    }

    @Test
    fun confirmIsEnabledWhenThereIsNoTypedGate() {
        setContent()
        compose.onNodeWithText(CONFIRM).assertIsEnabled()
    }

    @Test
    fun typedConfirmationGateEnablesConfirmOnlyOnExactMatch() {
        setContent(requireTypedConfirmation = TYPED_TOKEN)
        compose.onNodeWithTag(ConfirmDialogTestTags.TYPED_INPUT).assertIsDisplayed()
        compose.onNodeWithText(CONFIRM).assertIsNotEnabled()

        compose.onNodeWithTag(ConfirmDialogTestTags.TYPED_INPUT).performTextInput("DEL")
        compose.onNodeWithText(CONFIRM).assertIsNotEnabled()

        compose.onNodeWithTag(ConfirmDialogTestTags.TYPED_INPUT).performTextInput("ETE")
        compose.onNodeWithText(CONFIRM).assertIsEnabled()
    }

    @Test
    fun inFlightDisablesBothActions() {
        setContent(loading = true)
        compose.onNodeWithText(CANCEL).assertIsNotEnabled()
        compose.onNodeWithText(CONFIRM).assertIsNotEnabled()
    }

    @Test
    fun cancelInvokesOnCancel() {
        var cancelled = false
        setContent(onCancel = { cancelled = true })
        compose.onNodeWithText(CANCEL).performClick()
        assertTrue("tapping Cancel must invoke onCancel", cancelled)
    }

    @Test
    fun confirmInvokesOnConfirm() {
        var confirmed = false
        setContent(onConfirm = { confirmed = true })
        compose.onNodeWithText(CONFIRM).performClick()
        assertTrue("tapping Confirm must invoke onConfirm", confirmed)
    }

    @Test
    fun confirmingWithDontAskAgainPersistsSilenceThroughTheStore() {
        var confirmed = false
        val store = FakeSilenceStore()
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                ConfirmDialog(
                    title = TITLE,
                    message = MESSAGE,
                    confirmLabel = CONFIRM,
                    cancelLabel = CANCEL,
                    onConfirm = { confirmed = true },
                    onCancel = {},
                    variant = ConfirmVariant.Warning,
                    silenceKey = SILENCE_KEY,
                    silenceStore = store,
                    logger = SilentLogger,
                )
            }
        }

        compose.onNodeWithText(SILENCE_LABEL).performClick()
        compose.onNodeWithText(CONFIRM).performClick()

        assertTrue("Confirm must fire onConfirm", confirmed)
        assertTrue("the silence choice must be persisted", store.isSilenced(SILENCE_KEY))
    }

    @Test
    fun previouslySilencedActionAutoResolvesAndRendersNothing() {
        var confirmed = false
        val store = FakeSilenceStore().apply { silence(SILENCE_KEY) }
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                ConfirmDialog(
                    title = TITLE,
                    message = MESSAGE,
                    confirmLabel = CONFIRM,
                    cancelLabel = CANCEL,
                    onConfirm = { confirmed = true },
                    onCancel = {},
                    variant = ConfirmVariant.Warning,
                    silenceKey = SILENCE_KEY,
                    silenceStore = store,
                    logger = SilentLogger,
                )
            }
        }
        compose.waitForIdle()

        assertTrue("a silenced action must auto-resolve via onConfirm", confirmed)
        compose.onNodeWithText(MESSAGE).assertDoesNotExist()
    }

    @Test
    fun dangerVariantIgnoresSilenceAndStillRenders() {
        var confirmed = false
        // The store says this id is silenced, but danger must never auto-resolve (web ignores silenceKey for danger).
        val store = FakeSilenceStore().apply { silence(SILENCE_KEY) }
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                ConfirmDialog(
                    title = TITLE,
                    message = MESSAGE,
                    confirmLabel = CONFIRM,
                    cancelLabel = CANCEL,
                    onConfirm = { confirmed = true },
                    onCancel = {},
                    variant = ConfirmVariant.Danger,
                    silenceKey = SILENCE_KEY,
                    silenceStore = store,
                    logger = SilentLogger,
                )
            }
        }
        compose.waitForIdle()

        assertFalse("danger must not auto-resolve", confirmed)
        compose.onNodeWithText(MESSAGE).assertIsDisplayed()
    }

    @Composable
    private fun Host(content: @Composable () -> Unit) {
        Box(modifier = Modifier.size(width = HOST_WIDTH, height = HOST_HEIGHT)) { content() }
    }

    private companion object {
        const val TITLE = "Delete vehicle?"
        const val MESSAGE = "This permanently deletes the vehicle and all of its history."
        const val CONFIRM = "Confirm"
        const val CANCEL = "Cancel"
        const val SILENCE_LABEL = "Don't ask again for this action"
        const val SILENCE_KEY = "reset-layout"
        const val TYPED_TOKEN = "DELETE"
        val HOST_WIDTH = 420.dp
        val HOST_HEIGHT = 900.dp
    }
}
