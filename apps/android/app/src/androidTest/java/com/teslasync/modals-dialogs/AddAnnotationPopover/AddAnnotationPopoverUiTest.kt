// Instrumented Compose UI + accessibility verification of [AddAnnotationPopoverContent] across the branches the web
// component renders: the fixed-date form (the raw timestamp shown, every labelled control present), the editable-date
// form (the capped date trigger seeded from the timestamp), the label-required submit guard (web
// `disabled={!label.trim()}` — the Add action is disabled until a non-blank label is typed), the category selection
// hand-off (the picked category + trimmed label flow back through `onAdd`), and the Cancel affordance. Runs under
// `connectedAndroidTest` (a device/emulator); the offline gate's `testReleaseUnitTest` covers the pure model.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.modalsdialogs.addannotationpopover

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.size
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.test.assertHasClickAction
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.assertIsEnabled
import androidx.compose.ui.test.assertIsNotEnabled
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performTextInput
import androidx.compose.ui.unit.dp
import io.teslasync.android.ui.theme.TeslaSyncTheme
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test

class AddAnnotationPopoverUiTest {
    @get:Rule
    val compose = createComposeRule()

    private val strings =
        AddAnnotationStrings(
            title = "Add Annotation",
            close = "Close",
            date = "Date",
            label = "Label",
            labelHint = "e.g., Battery replaced",
            category = "Category",
            milestone = "Milestone",
            maintenance = "Maintenance",
            trip = "Trip",
            issue = "Issue",
            upgrade = "Upgrade",
            custom = "Custom",
            description = "Description",
            descriptionHint = "Optional description...",
            cancel = "Cancel",
            add = "Add Annotation",
            confirm = "Confirm",
        )

    private fun setContent(
        timestamp: String = FIXED_TIMESTAMP,
        editableDate: Boolean = false,
        onAdd: (AnnotationResult) -> Unit = {},
        onCancel: () -> Unit = {},
    ) {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                Host {
                    AddAnnotationPopoverContent(
                        timestamp = timestamp,
                        editableDate = editableDate,
                        strings = strings,
                        onAdd = onAdd,
                        onCancel = onCancel,
                    )
                }
            }
        }
    }

    @Test
    fun everyControlExposesItsLabel() {
        setContent()
        compose.onNodeWithText(strings.label).assertIsDisplayed()
        compose.onNodeWithText(strings.category).assertIsDisplayed()
        compose.onNodeWithText(strings.description).assertIsDisplayed()
        compose.onNodeWithText(strings.milestone).assertIsDisplayed()
        compose.onNodeWithText(strings.maintenance).assertIsDisplayed()
        compose.onNodeWithText(strings.trip).assertIsDisplayed()
        compose.onNodeWithText(strings.issue).assertIsDisplayed()
        compose.onNodeWithText(strings.upgrade).assertIsDisplayed()
        compose.onNodeWithText(strings.custom).assertIsDisplayed()
        compose.onNodeWithText(strings.cancel).assertIsDisplayed().assertHasClickAction()
        compose.onNodeWithText(strings.add).assertIsDisplayed()
    }

    @Test
    fun fixedDateShowsRawTimestamp() {
        setContent(editableDate = false)
        compose.onNodeWithText(FIXED_TIMESTAMP).assertIsDisplayed()
    }

    @Test
    fun editableDateShowsCappedDateTriggerSeededFromTimestamp() {
        setContent(editableDate = true)
        // The field label and the trigger (its accessible name is the date label) are both present…
        compose.onNodeWithText(strings.date).assertIsDisplayed()
        compose.onNodeWithContentDescription(strings.date).assertIsDisplayed().assertHasClickAction()
        // …seeded from the incoming timestamp (web `toDateInputValue`).
        compose.onNodeWithText(SEEDED_DATE).assertIsDisplayed()
    }

    @Test
    fun addStaysDisabledUntilLabelIsTyped() {
        setContent()
        compose.onNodeWithText(strings.add).assertIsNotEnabled()
        compose.onNodeWithText(strings.label).performTextInput("Battery replaced")
        compose.onNodeWithText(strings.add).assertIsEnabled()
    }

    @Test
    fun selectingCategoryAndAddHandsBackTrimmedResult() {
        var added: AnnotationResult? = null
        setContent(onAdd = { added = it })

        compose.onNodeWithText(strings.label).performTextInput("  Battery replaced  ")
        compose.onNodeWithText(strings.trip).performClick()
        compose.onNodeWithText(strings.add).performClick()

        assertEquals("Battery replaced", added?.label)
        assertEquals(AnnotationCategory.Trip, added?.category)
        assertEquals(FIXED_TIMESTAMP, added?.occurredAt)
    }

    @Test
    fun cancelInvokesOnCancel() {
        var cancelled = false
        setContent(onCancel = { cancelled = true })
        compose.onNodeWithText(strings.cancel).performClick()
        assertTrue(cancelled)
    }

    @Composable
    private fun Host(content: @Composable () -> Unit) {
        Box(modifier = Modifier.size(width = HOST_WIDTH, height = HOST_HEIGHT)) { content() }
    }

    private companion object {
        const val FIXED_TIMESTAMP = "2026-01-15T00:00:00Z"
        const val SEEDED_DATE = "2026-01-15"
        val HOST_WIDTH = 420.dp
        val HOST_HEIGHT = 1000.dp
    }
}
