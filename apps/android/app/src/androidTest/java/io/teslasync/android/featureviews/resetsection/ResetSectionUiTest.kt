package io.teslasync.android.featureviews.resetsection

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.size
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.test.assertHasClickAction
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.unit.dp
import io.teslasync.android.components.feedback.ToastItem
import io.teslasync.android.components.feedback.Tone
import io.teslasync.android.ui.theme.TeslaSyncTheme
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test

/**
 * Instrumented Compose UI + accessibility verification of [ResetSectionContent] across every surface the web
 * panel renders: the always-present three panels (the by-section list + per-row Reset, the read-only
 * deny-list, the Danger zone), the per-section danger ConfirmDialog, the Danger-zone typed-confirmation
 * dialog, and a raised toast. Asserts the rendered i18n strings and the TalkBack labels (each Reset control is
 * named by the section it resets). Runs under `connectedAndroidTest`; the offline gate's
 * `testReleaseUnitTest` covers the projection + view-model.
 */
class ResetSectionUiTest {
    @get:Rule
    val compose = createComposeRule()

    private fun setContent(
        state: ResetSectionUiState = ResetSectionUiState(),
        toasts: List<ToastItem> = emptyList(),
        onRequestSection: (ResetSectionRow) -> Unit = {},
        onRequestAll: () -> Unit = {},
        onConfirm: () -> Unit = {},
        onDismiss: () -> Unit = {},
    ) {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                Host {
                    ResetSectionContent(
                        state = state,
                        toasts = toasts,
                        onRequestSection = onRequestSection,
                        onRequestAll = onRequestAll,
                        onConfirm = onConfirm,
                        onDismiss = onDismiss,
                        onToastDismiss = {},
                    )
                }
            }
        }
    }

    @Test
    fun panelHeadersAlwaysRender() {
        setContent()
        compose.onNodeWithText("Reset to defaults").assertIsDisplayed()
        compose.onNodeWithText("Danger zone").assertIsDisplayed()
    }

    @Test
    fun sectionRowsRenderWithLabelledResetControls() {
        setContent()
        compose.onNodeWithText("General preferences").assertIsDisplayed()
        compose.onNodeWithText("Geofences").assertIsDisplayed()
        // Each Reset control names the section it resets (TalkBack disambiguation of identical buttons).
        compose.onNodeWithContentDescription("Reset, Geofences").assertIsDisplayed()
    }

    @Test
    fun tappingASectionResetIsAnAccessibleClickableControl() {
        var requested: ResetSectionId? = null
        setContent(onRequestSection = { requested = it.id })
        val node = compose.onNodeWithContentDescription("Reset, Geofences")
        node.assertHasClickAction()
        node.performClick()
        assertEquals(ResetSectionId.Geofences, requested)
    }

    @Test
    fun denyListRowsRenderNeverABlankPanel() {
        setContent()
        compose.onNodeWithText("Charge cost tariffs").assertIsDisplayed()
        compose.onNodeWithText("Notification sound preferences").assertIsDisplayed()
    }

    @Test
    fun dangerZoneButtonInvokesResetAll() {
        var resetAll = false
        setContent(onRequestAll = { resetAll = true })
        compose.onNodeWithText("Reset ALL settings").assertHasClickAction()
        compose.onNodeWithText("Reset ALL settings").performClick()
        assertTrue(resetAll)
    }

    @Test
    fun perSectionConfirmDialogRendersForThePendingSection() {
        setContent(state = ResetSectionUiState(dialog = ResetDialog.Section(GEOFENCES_ROW)))
        compose.onNodeWithText("Reset Geofences?").assertIsDisplayed()
    }

    @Test
    fun dangerZoneDialogRequiresTypedConfirmation() {
        setContent(state = ResetSectionUiState(dialog = ResetDialog.All))
        compose.onNodeWithText("Reset every user-discoverable setting?").assertIsDisplayed()
        compose.onNodeWithText("Type RESET to confirm").assertIsDisplayed()
    }

    @Test
    fun raisedToastMessageRenders() {
        setContent(
            toasts = listOf(ToastItem(id = 1L, message = "3 item(s) reset across 1 section(s).", tone = Tone.Success)),
        )
        compose.onNodeWithText("3 item(s) reset across 1 section(s).").assertIsDisplayed()
    }

    @Composable
    private fun Host(content: @Composable () -> Unit) {
        Box(modifier = Modifier.size(width = HOST_WIDTH, height = HOST_HEIGHT)) { content() }
    }

    private companion object {
        val HOST_WIDTH = 380.dp
        val HOST_HEIGHT = 900.dp
        val GEOFENCES_ROW =
            ResetSectionRow(
                id = ResetSectionId.Geofences,
                title = "Geofences",
                description = "Delete every geofence and its electricity-rate overrides.",
            )
    }
}
