package io.teslasync.android.components.forms

import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.hasSetTextAction
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performTextInput
import io.teslasync.android.components.ui.BodyText
import io.teslasync.android.components.ui.SortDirection
import io.teslasync.android.ui.theme.TeslaSyncTheme
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test

/**
 * Instrumented Compose tests for the forms family (search / sort / labelled field / tag entry).
 * The pure add/remove/visibility logic is covered by the no-device [FormsLogicTest]; these assert
 * the controls render their copy and route interactions back through their callbacks on a device
 * (connectedDebugAndroidTest).
 */
class FormsInteractionTest {
    @get:Rule
    val rule = createComposeRule()

    @Test
    fun searchInputShowsTypedText() {
        rule.setContent {
            TeslaSyncTheme {
                SearchInput(value = "", onValueChange = {})
            }
        }
        rule.onNode(hasSetTextAction()).performTextInput("Model 3")
        rule.onNodeWithText("Model 3").assertIsDisplayed()
    }

    @Test
    fun sortControlToggleFlipsDirection() {
        var direction: SortDirection? = null
        rule.setContent {
            TeslaSyncTheme {
                SortControl(
                    field = "date",
                    direction = SortDirection.Desc,
                    options = listOf(SortOption("date", "Date"), SortOption("distance", "Distance")),
                    onFieldChange = {},
                    onDirectionChange = { direction = it },
                )
            }
        }
        rule.onNodeWithContentDescription("Toggle sort direction").performClick()
        assertEquals(SortDirection.Asc, direction)
    }

    @Test
    fun formFieldShowsLabelAndHelperText() {
        rule.setContent {
            TeslaSyncTheme {
                FormField(label = "Name", helperText = "Shown on shared trips") {
                    BodyText("field body")
                }
            }
        }
        rule.onNodeWithText("Name").assertIsDisplayed()
        rule.onNodeWithText("Shown on shared trips").assertIsDisplayed()
    }

    @Test
    fun tagInputRendersExistingTagsAndAddsNew() {
        var tags: List<String> = listOf("work")
        rule.setContent {
            TeslaSyncTheme {
                TagInput(tags = tags, onTagsChange = { tags = it })
            }
        }
        rule.onNodeWithText("work").assertIsDisplayed()
        rule.onNode(hasSetTextAction()).performTextInput("home")
        rule.onNodeWithContentDescription("Add tag").performClick()
        assertEquals(listOf("work", "home"), tags)
    }
}
