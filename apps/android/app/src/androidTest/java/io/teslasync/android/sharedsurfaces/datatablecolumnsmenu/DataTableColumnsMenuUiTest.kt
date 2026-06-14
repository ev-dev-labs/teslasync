package io.teslasync.android.sharedsurfaces.datatablecolumnsmenu

import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.assertIsEnabled
import androidx.compose.ui.test.assertIsNotEnabled
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.Logger
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test

/**
 * On-device Compose UI + accessibility verification of [DataTableColumnsMenu] + [DataTableColumnsMenuContent]
 * across the states the web component renders: the content menu (a checkbox per column, the selected ones
 * checked), the disabled rows (a required column and the checked last-visible column), the toggle + show-all
 * round-trips, and the empty menu (no columns — the header + a friendly line, never a blank box). Asserts the
 * rendered i18n strings and the TalkBack labels on the interactive elements, and that the stateful entry opens the
 * menu and emits the one-shot `view.opened` diagnostic. Runs under `connectedAndroidTest`; the
 * `testReleaseUnitTest` gate covers the projection + diagnostics logic, this covers the render.
 */
class DataTableColumnsMenuUiTest {
    @get:Rule
    val compose = createComposeRule()

    private val columns =
        listOf(
            ColumnDescriptor(key = "select", header = "Select", required = true),
            ColumnDescriptor(key = "date", header = "Date"),
            ColumnDescriptor(key = "distance", header = "Distance"),
            ColumnDescriptor(key = "energy", header = "Energy"),
        )

    private val strings =
        DataTableColumnsMenuStrings(
            menu = "Show or hide columns",
            button = "Columns",
            heading = "Visible columns",
            showAll = "Show all",
            empty = "No data available",
        )

    @Test
    fun openMenuShowsHeadingAndEveryColumnRow() {
        openContent(visibleKeys = listOf("date", "distance"))

        compose.onNodeWithText("Visible columns").assertIsDisplayed()
        compose.onNodeWithText("Select").assertIsDisplayed()
        compose.onNodeWithText("Date").assertIsDisplayed()
        compose.onNodeWithText("Distance").assertIsDisplayed()
        compose.onNodeWithText("Energy").assertIsDisplayed()
    }

    @Test
    fun requiredColumnRowIsDisabled() {
        openContent(visibleKeys = listOf("select", "date"))
        compose.onNodeWithText("Select").assertIsNotEnabled()
    }

    @Test
    fun checkedLastVisibleColumnIsDisabledWhileOthersStayEnabled() {
        openContent(visibleKeys = listOf("date"))
        compose.onNodeWithText("Date").assertIsNotEnabled()
        compose.onNodeWithText("Distance").assertIsEnabled()
    }

    @Test
    fun togglingAVisibleRowRoutesTheNextVisibleListThroughTheCallback() {
        var next: List<String>? = null
        openContent(visibleKeys = listOf("date", "distance"), onChange = { next = it })
        compose.onNodeWithText("Distance").performClick()
        assertEquals(listOf("date"), next)
    }

    @Test
    fun togglingAHiddenRowReAddsItInColumnOrder() {
        var next: List<String>? = null
        openContent(visibleKeys = listOf("distance"), onChange = { next = it })
        compose.onNodeWithText("Date").performClick()
        assertEquals(listOf("date", "distance"), next)
    }

    @Test
    fun showAllRoutesEveryColumnKeyThroughTheCallback() {
        var next: List<String>? = null
        openContent(visibleKeys = listOf("date"), onChange = { next = it })
        compose.onNodeWithText("Show all").performClick()
        assertEquals(listOf("select", "date", "distance", "energy"), next)
    }

    @Test
    fun emptyMenuStillRendersTheHeaderAndAFriendlyLine() {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                DataTableColumnsMenuContent(
                    columns = emptyList(),
                    visibleKeys = emptyList(),
                    onChange = {},
                    strings = strings,
                    expanded = true,
                    onExpandedChange = {},
                )
            }
        }
        // Never a blank box: the heading and a friendly no-data line are shown, and "Show all" is disabled.
        compose.onNodeWithText("Visible columns").assertIsDisplayed()
        compose.onNodeWithText("No data available").assertIsDisplayed()
        compose.onNodeWithText("Show all").assertIsNotEnabled()
    }

    @Test
    fun triggerExposesItsAccessibleNameAndOpensTheMenu() {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                DataTableColumnsMenu(
                    columns = columns,
                    visibleKeys = listOf("date"),
                    onChange = {},
                    logger = RecordingLogger(),
                )
            }
        }
        // The menu starts closed — no rows yet — and the trigger carries the menu's accessible name.
        compose.onNodeWithContentDescription("Show or hide columns").assertIsDisplayed()
        compose.onNodeWithTag(DATA_TABLE_COLUMNS_MENU_TRIGGER_TAG).performClick()
        compose.waitForIdle()
        compose.onNodeWithText("Date").assertIsDisplayed()
    }

    @Test
    fun statefulEntryEmitsViewOpenedDiagnostic() {
        val logger = RecordingLogger()
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                DataTableColumnsMenu(
                    columns = columns,
                    visibleKeys = listOf("date"),
                    onChange = {},
                    logger = logger,
                )
            }
        }
        compose.waitForIdle()
        val opened = logger.events.filter { it.first == "view.opened" }
        assertEquals(1, opened.size)
        assertEquals(mapOf("surface" to "DataTableColumnsMenu"), opened.single().second)
    }

    private fun openContent(
        visibleKeys: List<String>,
        onChange: (List<String>) -> Unit = {},
    ) {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                DataTableColumnsMenuContent(
                    columns = columns,
                    visibleKeys = visibleKeys,
                    onChange = onChange,
                    strings = strings,
                    expanded = true,
                    onExpandedChange = {},
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
