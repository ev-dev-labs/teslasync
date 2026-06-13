// Instrumented Compose UI + accessibility verification of [KeyboardShortcutsModalContent] across the branches
// the web component renders (web/src/components/feedback/KeyboardShortcutsModal.tsx): the grouped sections with
// their key-combo chips, the empty state when the filter clears every row, the scope-tab selection hand-off, the
// search field + scope tabs exposing their accessible names, and the merged key-combo content description for
// TalkBack. Runs under `connectedAndroidTest`; the offline `testReleaseUnitTest` gate covers the pure model.
package io.teslasync.android.modalsdialogs.keyboardshortcutsmodal

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.size
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.test.assertHasClickAction
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.unit.dp
import io.teslasync.android.ui.theme.TeslaSyncTheme
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test

class KeyboardShortcutsModalUiTest {
    @get:Rule
    val compose = createComposeRule()

    private val strings =
        KeyboardShortcutsStrings(
            title = "Keyboard Shortcuts",
            close = "Close",
            searchHint = "Search shortcuts",
            empty = "No shortcuts match your search.",
            filterAll = "All",
            filterGlobal = "Global",
            filterPage = "This page",
        )

    private val navGroup = "Navigation (press g then…)"

    private val populated =
        listOf(
            ShortcutGroup(
                title = navGroup,
                shortcuts = listOf(ShortcutDefinition("global.goto.d", listOf("g", "d"), "Go to Dashboard", navGroup)),
            ),
            ShortcutGroup(
                title = "Actions",
                shortcuts =
                    listOf(
                        ShortcutDefinition("global.palette.ctrlk", listOf("Ctrl", "K"), "Open command palette", "Actions"),
                    ),
            ),
        )

    private fun setContent(
        groups: List<ShortcutGroup> = populated,
        search: String = "",
        mode: FilterMode = FilterMode.All,
        onSearchChange: (String) -> Unit = {},
        onModeChange: (FilterMode) -> Unit = {},
    ) {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                Host {
                    KeyboardShortcutsModalContent(
                        groups = groups,
                        search = search,
                        onSearchChange = onSearchChange,
                        mode = mode,
                        onModeChange = onModeChange,
                        strings = strings,
                    )
                }
            }
        }
    }

    @Test
    fun populatedRendersGroupsRowsAndKeyChips() {
        setContent()

        compose.onNodeWithTag(KeyboardShortcutsModalTestTags.LIST).assertIsDisplayed()
        compose.onNodeWithText(navGroup).assertIsDisplayed()
        compose.onNodeWithText("Actions").assertIsDisplayed()
        compose.onNodeWithText("Go to Dashboard").assertIsDisplayed()
        compose.onNodeWithText("Open command palette").assertIsDisplayed()
        // The <kbd> chips render their individual key tokens.
        compose.onNodeWithText("Ctrl", useUnmergedTree = true).assertIsDisplayed()
        compose.onNodeWithText("K", useUnmergedTree = true).assertIsDisplayed()
    }

    @Test
    fun emptyRendersFriendlyEmptyStateAndNoList() {
        setContent(groups = emptyList(), search = "zzz", mode = FilterMode.Page)

        compose.onNodeWithTag(KeyboardShortcutsModalTestTags.EMPTY).assertIsDisplayed()
        compose.onNodeWithText(strings.empty).assertIsDisplayed()
        compose.onNodeWithTag(KeyboardShortcutsModalTestTags.LIST).assertDoesNotExist()
    }

    @Test
    fun selectingAScopeTabInvokesOnModeChange() {
        var selected: FilterMode? = null
        setContent(onModeChange = { selected = it })

        compose.onNodeWithText(strings.filterGlobal).performClick()
        assertEquals(FilterMode.Global, selected)
    }

    @Test
    fun scopeTabsAndSearchExposeAccessibleLabels() {
        setContent()

        compose.onNodeWithTag(KeyboardShortcutsModalTestTags.SEARCH).assertIsDisplayed()
        compose.onNodeWithTag(KeyboardShortcutsModalTestTags.FILTERS).assertIsDisplayed()
        compose.onNodeWithText(strings.filterAll).assertIsDisplayed().assertHasClickAction()
        compose.onNodeWithText(strings.filterGlobal).assertIsDisplayed().assertHasClickAction()
        compose.onNodeWithText(strings.filterPage).assertIsDisplayed().assertHasClickAction()
    }

    @Test
    fun keyComboExposesACombinedAccessibleName() {
        setContent()
        compose.onNodeWithContentDescription("Ctrl + K").assertIsDisplayed()
    }

    @Composable
    private fun Host(content: @Composable () -> Unit) {
        Box(modifier = Modifier.size(width = HOST_WIDTH, height = HOST_HEIGHT)) { content() }
    }

    private companion object {
        val HOST_WIDTH = 420.dp
        val HOST_HEIGHT = 1200.dp
    }
}
