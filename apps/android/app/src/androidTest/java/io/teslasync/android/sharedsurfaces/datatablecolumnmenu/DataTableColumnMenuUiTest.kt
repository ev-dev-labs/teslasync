// On-device Compose UI + accessibility verification of the DataTableColumnMenu shared surface across the states the
// web source renders (web/src/components/ui/DataTableColumnMenu.tsx): the always-present trigger (with its merged
// TalkBack label), the open popover with its heading + Reset + one row per column, the visibility checkbox (and its
// "Show or hide {col}" label) invoking onToggle, the ↑/↓ reorder controls (and their "Move {col} up/down" labels)
// invoking onMove + disabled at the ends of the list, the Reset affordance, and the empty (zero-columns) state with
// its friendly message. The `testReleaseUnitTest` gate covers the pure model + the ViewModel; this runs under
// `connectedAndroidTest`.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.datatablecolumnmenu

import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.assertIsEnabled
import androidx.compose.ui.test.assertIsNotEnabled
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.test.platform.app.InstrumentationRegistry
import io.teslasync.android.R
import io.teslasync.android.ui.theme.TeslaSyncTheme
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test

class DataTableColumnMenuUiTest {
    @get:Rule
    val compose = createComposeRule()

    private val context = InstrumentationRegistry.getInstrumentation().targetContext

    private fun s(id: Int) = context.getString(id)

    private fun s(
        id: Int,
        arg: String,
    ) = context.getString(id, arg)

    private val columns =
        listOf(
            ColumnDescriptor(key = "name", header = "Name"),
            ColumnDescriptor(key = "vin", header = "VIN"),
            ColumnDescriptor(key = "battery", header = "Battery"),
        )

    @Suppress("LongParameterList")
    private fun setSurface(
        columns: List<ColumnDescriptor>,
        layout: ColumnLayout?,
        open: Boolean = true,
        onToggleOpen: () -> Unit = {},
        onToggleColumn: (String) -> Unit = {},
        onMoveColumn: (String, MoveDirection) -> Unit = { _, _ -> },
        onReset: () -> Unit = {},
    ) {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                DataTableColumnMenuContent(
                    columns = columns,
                    layout = layout,
                    open = open,
                    reorderable = true,
                    toggleable = true,
                    onToggleOpen = onToggleOpen,
                    onDismiss = {},
                    onToggleColumn = onToggleColumn,
                    onMoveColumn = onMoveColumn,
                    onReset = onReset,
                )
            }
        }
    }

    @Test
    fun triggerCarriesTheReorderTalkBackLabel() {
        setSurface(columns, defaultColumnLayout(columns), open = false)

        compose.onNodeWithTag(MENU_TRIGGER_TEST_TAG).assertIsDisplayed()
        compose.onNodeWithContentDescription(s(R.string.translation_table_columns_menuReorder)).assertIsDisplayed()
    }

    @Test
    fun triggerClickInvokesOnToggleOpen() {
        val toggles = mutableListOf<Unit>()
        setSurface(columns, defaultColumnLayout(columns), open = false, onToggleOpen = { toggles += Unit })

        compose.onNodeWithTag(MENU_TRIGGER_TEST_TAG).performClick()
        assertEquals(1, toggles.size)
    }

    @Test
    fun openPopoverRendersHeadingResetAndEveryColumn() {
        setSurface(columns, defaultColumnLayout(columns))

        compose.onNodeWithTag(MENU_POPOVER_TEST_TAG).assertIsDisplayed()
        compose.onNodeWithTag(MENU_RESET_TEST_TAG).assertIsDisplayed()
        compose.onNodeWithText("Name").assertIsDisplayed()
        compose.onNodeWithText("VIN").assertIsDisplayed()
        compose.onNodeWithText("Battery").assertIsDisplayed()
    }

    @Test
    fun checkboxIsLabelledAndInvokesOnToggleWithTheColumnKey() {
        val toggled = mutableListOf<String>()
        setSurface(columns, defaultColumnLayout(columns), onToggleColumn = { toggled += it })

        val label = s(R.string.translation_table_columns_toggleColumn, "VIN")
        compose.onNodeWithContentDescription(label).assertIsDisplayed()
        compose.onNodeWithContentDescription(label).performClick()
        assertEquals(listOf("vin"), toggled)
    }

    @Test
    fun reorderArrowsAreLabelledAndInvokeOnMove() {
        val moves = mutableListOf<Pair<String, MoveDirection>>()
        setSurface(columns, defaultColumnLayout(columns), onMoveColumn = { key, dir -> moves += key to dir })

        compose.onNodeWithContentDescription(s(R.string.translation_table_columns_moveUp, "VIN")).performClick()
        compose.onNodeWithContentDescription(s(R.string.translation_table_columns_moveDown, "VIN")).performClick()
        assertEquals(listOf("vin" to MoveDirection.Up, "vin" to MoveDirection.Down), moves)
    }

    @Test
    fun arrowsAreDisabledAtTheEndsOfTheList() {
        setSurface(columns, defaultColumnLayout(columns))

        compose.onNodeWithContentDescription(s(R.string.translation_table_columns_moveUp, "Name")).assertIsNotEnabled()
        compose.onNodeWithContentDescription(s(R.string.translation_table_columns_moveDown, "Battery")).assertIsNotEnabled()
        compose.onNodeWithContentDescription(s(R.string.translation_table_columns_moveDown, "Name")).assertIsEnabled()
    }

    @Test
    fun resetInvokesOnReset() {
        val resets = mutableListOf<Unit>()
        setSurface(columns, defaultColumnLayout(columns), onReset = { resets += Unit })

        compose.onNodeWithTag(MENU_RESET_TEST_TAG).performClick()
        assertEquals(1, resets.size)
    }

    @Test
    fun emptyColumnsRenderTheFriendlyEmptyState() {
        setSurface(columns = emptyList(), layout = null)

        compose.onNodeWithText(s(R.string.translation_common_noData)).assertIsDisplayed()
    }
}
