package io.teslasync.android.sharedsurfaces.sortcontrol

import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import io.teslasync.android.components.forms.SortOption
import io.teslasync.android.components.ui.SortDirection
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.Logger
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test

/**
 * On-device Compose UI + accessibility verification of [SortControl] + [SortControlContent] across the states the
 * web component renders: the content control (the selected field + the direction toggle), the empty control (no
 * options — still labelled, never a blank box), the ascending/descending direction announcements, the toggle that
 * flips the direction, the caller-overridden direction label, and the field-selection round-trip. Asserts the
 * rendered i18n strings and the TalkBack content descriptions on the interactive elements, and that the stateful
 * entry emits the one-shot `view.opened` diagnostic. Runs under `connectedAndroidTest`; the `testReleaseUnitTest`
 * gate covers the projection + diagnostics logic, this covers the render.
 */
class SortControlUiTest {
    @get:Rule
    val compose = createComposeRule()

    private val strings =
        SortControlStrings(
            ascending = "Ascending",
            descending = "Descending",
            fieldLabel = "Sort by",
            direction = "Sort direction",
        )

    private val options = listOf(SortOption("date", "Date"), SortOption("distance", "Distance"))

    @Test
    fun contentShowsSelectedOptionAndFieldLabel() {
        setContent(field = "date", direction = SortDirection.Asc)
        compose.onNodeWithText("Date").assertIsDisplayed()
        compose.onNodeWithContentDescription("Sort by").assertIsDisplayed()
    }

    @Test
    fun ascendingDirectionExposesItsAccessibleName() {
        setContent(field = "date", direction = SortDirection.Asc)
        compose.onNodeWithContentDescription("Sort direction: Ascending").assertIsDisplayed()
    }

    @Test
    fun togglingFromAscendingFlipsToDescending() {
        var changed: SortDirection? = null
        setContent(field = "date", direction = SortDirection.Asc, onDirectionChange = { changed = it })
        compose.onNodeWithContentDescription("Sort direction: Ascending").performClick()
        assertEquals(SortDirection.Desc, changed)
    }

    @Test
    fun descendingDirectionFlipsBackToAscending() {
        var changed: SortDirection? = null
        setContent(field = "date", direction = SortDirection.Desc, onDirectionChange = { changed = it })
        compose.onNodeWithContentDescription("Sort direction: Descending").performClick()
        assertEquals(SortDirection.Asc, changed)
    }

    @Test
    fun callerOverrideReplacesTheDirectionAccessibleName() {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                SortControlContent(
                    field = "date",
                    direction = SortDirection.Asc,
                    options = options,
                    strings = strings,
                    onFieldChange = {},
                    onDirectionChange = {},
                    directionAccessibilityLabel = "Flip the sort order",
                )
            }
        }
        compose.onNodeWithContentDescription("Flip the sort order").assertIsDisplayed()
    }

    @Test
    fun emptyOptionsStillRenderTheLabelledControl() {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                SortControlContent(
                    field = "",
                    direction = SortDirection.Asc,
                    options = emptyList(),
                    strings = strings,
                    onFieldChange = {},
                    onDirectionChange = {},
                )
            }
        }
        // The field keeps its accessible name and the direction toggle is still present — never a blank box.
        compose.onNodeWithContentDescription("Sort by").assertIsDisplayed()
        compose.onNodeWithContentDescription("Sort direction: Ascending").assertIsDisplayed()
    }

    @Test
    fun selectingAFieldRoutesBackThroughTheCallback() {
        var picked: String? = null
        setContent(field = "date", direction = SortDirection.Asc, onFieldChange = { picked = it })
        compose.onNodeWithText("Date").performClick()
        compose.onNodeWithText("Distance").performClick()
        assertEquals("distance", picked)
    }

    @Test
    fun statefulEntryEmitsViewOpenedDiagnostic() {
        val logger = RecordingLogger()
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                SortControl(
                    field = "date",
                    direction = SortDirection.Asc,
                    options = options,
                    onFieldChange = {},
                    onDirectionChange = {},
                    logger = logger,
                )
            }
        }
        compose.waitForIdle()
        val opened = logger.events.filter { it.first == "view.opened" }
        assertEquals(1, opened.size)
        assertTrue(opened.single().second == mapOf("surface" to "SortControl"))
    }

    private fun setContent(
        field: String,
        direction: SortDirection,
        onFieldChange: (String) -> Unit = {},
        onDirectionChange: (SortDirection) -> Unit = {},
    ) {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                SortControlContent(
                    field = field,
                    direction = direction,
                    options = options,
                    strings = strings,
                    onFieldChange = onFieldChange,
                    onDirectionChange = onDirectionChange,
                )
            }
        }
    }

    /** A [Logger] that records every emitted record, so the test can assert the diagnostics contract (P1/S11). */
    private class RecordingLogger : Logger {
        val events = mutableListOf<Pair<String, Map<String, String>>>()

        override fun log(
            level: LogLevel,
            event: String,
            fields: Map<String, String>,
        ) {
            events += event to fields
        }
    }
}
