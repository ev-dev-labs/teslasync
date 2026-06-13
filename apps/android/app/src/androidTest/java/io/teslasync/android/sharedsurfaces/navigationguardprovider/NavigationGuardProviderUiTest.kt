// Instrumented Compose UI + accessibility verification of the NavigationGuardProvider surface across the states
// the web source renders (web/src/components/feedback/NavigationGuardProvider.tsx): a clean screen navigates with
// no prompt (web `confirmIfDirty` resolves true with no dialog), a dirty screen raises the reused ConfirmDialog
// with the localized Unsaved-changes title / warning / Discard / Keep-editing labels, Discard resolves true and
// dismisses, Keep-editing resolves false and dismisses, a guard's own localized message overrides the generic
// warning, and the one-shot PII-safe `view.opened` diagnostic (P1/S11) fires on mount. Every asserted label is the
// localized copy the surface exposes to TalkBack. Runs under `connectedAndroidTest`; the offline
// `:android:testReleaseUnitTest` gate covers the pure model + coordinator + diagnostics.

package io.teslasync.android.sharedsurfaces.navigationguardprovider

import androidx.compose.material3.Button
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.test.assertHasClickAction
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.coroutines.launch
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test

class NavigationGuardProviderUiTest {
    @get:Rule
    val compose = createComposeRule()

    // ── State: a clean screen navigates with no prompt (web confirmIfDirty -> true, no dialog) ──────────────

    @Test
    fun aCleanScreenNavigatesWithoutPrompting() {
        var result: Boolean? = null
        mountGuard(dirty = false, onResult = { result = it })

        compose.onNodeWithText(NAVIGATE).performClick()
        compose.waitForIdle()

        assertEquals(true, result)
        compose.onNodeWithText(GENERIC_WARNING).assertDoesNotExist()
    }

    // ── State: a dirty screen raises the localized confirm dialog (web pending != null) ────────────────────

    @Test
    fun aDirtyScreenRaisesTheLocalizedConfirmDialog() {
        mountGuard(dirty = true)

        compose.onNodeWithText(NAVIGATE).performClick()

        compose.onNodeWithText(UNSAVED_TITLE).assertIsDisplayed()
        compose.onNodeWithText(GENERIC_WARNING).assertIsDisplayed()
        compose.onNodeWithText(DISCARD).assertIsDisplayed().assertHasClickAction()
        compose.onNodeWithText(KEEP_EDITING).assertIsDisplayed().assertHasClickAction()
    }

    // ── State: Discard resolves true and dismisses (web handleConfirm) ─────────────────────────────────────

    @Test
    fun discardResolvesTrueAndDismissesTheDialog() {
        var result: Boolean? = null
        mountGuard(dirty = true, onResult = { result = it })

        compose.onNodeWithText(NAVIGATE).performClick()
        compose.onNodeWithText(DISCARD).performClick()
        compose.waitForIdle()

        assertEquals(true, result)
        compose.onNodeWithText(GENERIC_WARNING).assertDoesNotExist()
    }

    // ── State: Keep editing resolves false and dismisses (web handleCancel) ────────────────────────────────

    @Test
    fun keepEditingResolvesFalseAndDismissesTheDialog() {
        var result: Boolean? = null
        mountGuard(dirty = true, onResult = { result = it })

        compose.onNodeWithText(NAVIGATE).performClick()
        compose.onNodeWithText(KEEP_EDITING).performClick()
        compose.waitForIdle()

        assertEquals(false, result)
        compose.onNodeWithText(GENERIC_WARNING).assertDoesNotExist()
    }

    // ── State: a guard's own message overrides the generic warning (web pending.message) ───────────────────

    @Test
    fun aGuardWithACustomMessageShowsItInThePrompt() {
        mountGuard(dirty = true, message = CUSTOM_MESSAGE)

        compose.onNodeWithText(NAVIGATE).performClick()

        compose.onNodeWithText(CUSTOM_MESSAGE).assertIsDisplayed()
        compose.onNodeWithText(GENERIC_WARNING).assertDoesNotExist()
    }

    // ── Diagnostics: the one-shot PII-safe view.opened (P1/S11) fires on mount ─────────────────────────────

    @Test
    fun mountingEmitsThePiiSafeViewOpenedDiagnosticOnce() {
        val logger = RecordingLogger()
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                NavigationGuardProvider(logger = logger) {
                    Text(GUARDED_CONTENT)
                }
            }
        }
        compose.waitForIdle()

        val opened =
            logger.records.filter { it.event == "view.opened" && it.fields["surface"] == "NavigationGuardProvider" }
        assertEquals(1, opened.size)
        assertEquals(LogLevel.Info, opened.single().level)
    }

    private fun mountGuard(
        dirty: Boolean,
        message: String? = null,
        onResult: (Boolean) -> Unit = {},
    ) {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                NavigationGuardProvider(logger = RecordingLogger()) {
                    GuardedContent(dirty = dirty, message = message, onResult = onResult)
                }
            }
        }
    }

    @Composable
    private fun GuardedContent(
        dirty: Boolean,
        message: String?,
        onResult: (Boolean) -> Unit,
    ) {
        val controller = useNavigationGuardContext()
        val scope = rememberCoroutineScope()
        DisposableEffect(controller, dirty, message) {
            val unregister =
                controller.register(
                    NavigationGuardEntry(id = "form", isDirty = { dirty }, getMessage = { message }),
                )
            onDispose(unregister)
        }
        Button(onClick = { scope.launch { onResult(controller.confirmIfDirty()) } }) {
            Text(NAVIGATE)
        }
    }

    private data class Record(
        val level: LogLevel,
        val event: String,
        val fields: Map<String, String>,
    )

    private class RecordingLogger : Logger {
        val records = mutableListOf<Record>()

        override fun log(
            level: LogLevel,
            event: String,
            fields: Map<String, String>,
        ) {
            records += Record(level, event, fields)
        }
    }

    private companion object {
        // The en catalog values (instrumentation default locale) the surface speaks.
        const val UNSAVED_TITLE = "Unsaved changes"
        const val GENERIC_WARNING = "You have unsaved changes. Discard them?"
        const val DISCARD = "Discard changes"
        const val KEEP_EDITING = "Keep editing"
        const val CUSTOM_MESSAGE = "You have an unsaved alert rule."
        const val NAVIGATE = "Navigate"
        const val GUARDED_CONTENT = "Guarded content"
    }
}
