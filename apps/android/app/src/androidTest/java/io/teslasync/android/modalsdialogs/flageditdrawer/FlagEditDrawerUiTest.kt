// Instrumented Compose UI + accessibility verification of [FlagEditDrawerContent] across the branches
// the web component renders (web/src/features/admin/components/feature-flags/FlagEditDrawer.tsx): create
// vs. edit mode (the locked key + immutable note), the value editor's required / invalid-JSON helper,
// the composite save-enabled rule, the in-flight (`saving`) disable, and the Save / Cancel hand-offs.
// Every asserted label is the localized copy the surface exposes to TalkBack. Runs under
// `connectedAndroidTest`; the offline `testReleaseUnitTest` gate covers the pure projection + parse.
package io.teslasync.android.modalsdialogs.flageditdrawer

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
import androidx.compose.ui.test.performTextInput
import androidx.compose.ui.unit.dp
import io.teslasync.android.ui.theme.TeslaSyncTheme
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test

class FlagEditDrawerUiTest {
    @get:Rule
    val compose = createComposeRule()

    private val strings =
        FlagEditDrawerStrings(
            createTitle = "Create flag",
            close = "Close",
            cancel = "Cancel",
            save = "Save flag",
            keyLabel = "Flag key",
            keyHint = "feature.dlq.replay_enabled",
            keyImmutable = "Flag keys are immutable once created. Delete + re-create to rename.",
            valueLabel = "Value (JSON)",
            valueRequired = "Value is required.",
            reasonLabel = "Reason",
            reasonHint = "Why this change? (logged in audit)",
        )

    private fun setContent(
        initial: FlagEditTarget? = null,
        saving: Boolean = false,
        onSave: (FlagEditSubmission) -> Unit = {},
        onCancel: () -> Unit = {},
    ) {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                Host {
                    FlagEditDrawerContent(
                        initial = initial,
                        saving = saving,
                        strings = strings,
                        onSave = onSave,
                        onCancel = onCancel,
                    )
                }
            }
        }
    }

    @Test
    fun createMode_showsEditableFieldsTheRequiredHelperAndADisabledSave() {
        setContent(initial = null)

        // All three fields render; the key field is editable (create mode) and the immutable note is absent.
        compose.onNodeWithTag(FlagEditDrawerTestTags.KEY_FIELD).assertIsDisplayed().assertIsEnabled()
        compose.onNodeWithTag(FlagEditDrawerTestTags.VALUE_FIELD).assertIsDisplayed()
        compose.onNodeWithTag(FlagEditDrawerTestTags.REASON_FIELD).assertIsDisplayed()
        compose.onNodeWithTag(FlagEditDrawerTestTags.IMMUTABLE_NOTE).assertDoesNotExist()
        // The empty value editor surfaces the "value required" helper immediately (web `valueEmpty`).
        compose.onNodeWithText(strings.valueRequired, substring = true, useUnmergedTree = true).assertIsDisplayed()
        // Nothing is valid yet, so Save is disabled and Cancel is actionable.
        compose.onNodeWithTag(FlagEditDrawerTestTags.SAVE).assertIsNotEnabled()
        compose.onNodeWithTag(FlagEditDrawerTestTags.CANCEL).assertIsDisplayed().assertHasClickAction()
    }

    @Test
    fun editMode_locksTheKeyAndShowsTheImmutableNote() {
        setContent(initial = FlagEditTarget("feature.dlq.replay_enabled", JsonPrimitive(true)))

        // The key is pre-filled, read-only (web `disabled={editing}`), and the immutable note is shown.
        compose.onNodeWithText("feature.dlq.replay_enabled", substring = true).assertIsDisplayed()
        compose.onNodeWithTag(FlagEditDrawerTestTags.KEY_FIELD).assertIsNotEnabled()
        compose.onNodeWithTag(FlagEditDrawerTestTags.IMMUTABLE_NOTE).assertIsDisplayed()
    }

    @Test
    fun typingAValidValueAndReasonEnablesSaveAndSaveSubmitsTheTrimmedWrite() {
        var saved: FlagEditSubmission? = null
        setContent(initial = null, onSave = { saved = it })

        compose.onNodeWithTag(FlagEditDrawerTestTags.KEY_FIELD).performTextInput("feature.new_flag")
        compose.onNodeWithTag(FlagEditDrawerTestTags.VALUE_FIELD).performTextInput("{\"enabled\": true}")
        compose.onNodeWithTag(FlagEditDrawerTestTags.REASON_FIELD).performTextInput("enable for rollout")

        compose.onNodeWithTag(FlagEditDrawerTestTags.SAVE).assertIsEnabled()
        compose.onNodeWithTag(FlagEditDrawerTestTags.SAVE).performClick()

        assertNotNull("tapping Save must hand the write back through onSave", saved)
        assertEquals("feature.new_flag", saved?.key)
        assertEquals("enable for rollout", saved?.reason)
        assertEquals(buildJsonObject { put("enabled", true) }, saved?.value)
    }

    @Test
    fun invalidJsonShowsTheParseErrorAndKeepsSaveDisabled() {
        var saved: FlagEditSubmission? = null
        setContent(initial = null, onSave = { saved = it })

        compose.onNodeWithTag(FlagEditDrawerTestTags.KEY_FIELD).performTextInput("feature.new_flag")
        compose.onNodeWithTag(FlagEditDrawerTestTags.REASON_FIELD).performTextInput("trying it")
        compose.onNodeWithTag(FlagEditDrawerTestTags.VALUE_FIELD).performTextInput("{enabled: true}")

        // The localized "Invalid JSON: …" helper (web `valueInvalid`) renders and Save stays disabled.
        compose.onNodeWithText("Invalid JSON", substring = true, useUnmergedTree = true).assertIsDisplayed()
        compose.onNodeWithTag(FlagEditDrawerTestTags.SAVE).assertIsNotEnabled()
        compose.onNodeWithTag(FlagEditDrawerTestTags.SAVE).performClick()
        assertTrue("an invalid draft must not submit", saved == null)
    }

    @Test
    fun savingDisablesBothActions() {
        setContent(initial = FlagEditTarget("feature.dlq.replay_enabled", JsonPrimitive(true)), saving = true)

        compose.onNodeWithTag(FlagEditDrawerTestTags.SAVE).assertIsNotEnabled()
        compose.onNodeWithTag(FlagEditDrawerTestTags.CANCEL).assertIsNotEnabled()
    }

    @Test
    fun cancelInvokesOnCancel() {
        var cancelled = false
        setContent(initial = null, onCancel = { cancelled = true })

        compose.onNodeWithTag(FlagEditDrawerTestTags.CANCEL).performClick()
        assertTrue("tapping Cancel must invoke onCancel", cancelled)
    }

    @Test
    fun everyInteractiveElementExposesAnAccessibleLabel() {
        setContent(initial = null)

        compose.onNodeWithTag(FlagEditDrawerTestTags.KEY_FIELD).performTextInput("feature.new_flag")
        compose.onNodeWithTag(FlagEditDrawerTestTags.VALUE_FIELD).performTextInput("true")
        compose.onNodeWithTag(FlagEditDrawerTestTags.REASON_FIELD).performTextInput("rollout")

        // Field labels are exposed to TalkBack (the localized `label` of each shared Input/Textarea).
        compose.onNodeWithText(strings.keyLabel, substring = true).assertIsDisplayed()
        compose.onNodeWithText(strings.valueLabel, substring = true).assertIsDisplayed()
        compose.onNodeWithText(strings.reasonLabel, substring = true).assertIsDisplayed()
        // Both actions expose their accessible names and are actionable.
        compose.onNodeWithText(strings.cancel).assertIsDisplayed().assertHasClickAction()
        compose.onNodeWithText(strings.save).assertIsDisplayed().assertHasClickAction()
    }

    @Composable
    private fun Host(content: @Composable () -> Unit) {
        Box(modifier = Modifier.size(width = HOST_WIDTH, height = HOST_HEIGHT)) { content() }
    }

    private companion object {
        val HOST_WIDTH = 420.dp
        val HOST_HEIGHT = 960.dp
    }
}
