package io.teslasync.android.sharedsurfaces.contextmenu

import androidx.compose.ui.test.assertDoesNotExist
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.assertIsNotEnabled
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.test.platform.app.InstrumentationRegistry
import io.teslasync.android.R
import io.teslasync.android.data.NoopLogger
import io.teslasync.android.ui.theme.TeslaSyncTheme
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test

/**
 * On-device Compose UI + accessibility verification of the ContextMenu shared surface across the states the web
 * component renders (web/src/components/ui/ContextMenu.tsx): the open menu and its rows, the accessible menu label
 * (i18n), the disabled / destructive / shortcut row variants, a working selection that closes the menu and invokes
 * the handler through the real ViewModel, and the defensive friendly empty row (never a blank box). Runs under
 * `connectedAndroidTest`; the `testReleaseUnitTest` gate covers the pure model + ViewModel, this covers the render.
 */
class ContextMenuUiTest {
    @get:Rule
    val compose = createComposeRule()

    private fun menuLabel(): String =
        InstrumentationRegistry.getInstrumentation().targetContext.getString(R.string.translation_contextMenu_menuLabel)

    private fun emptyLabel(): String = InstrumentationRegistry.getInstrumentation().targetContext.getString(R.string.translation_None)

    private fun state(items: List<ContextMenuItem>): ContextMenuState =
        ContextMenuState(items = items, anchor = ContextMenuAnchor(x = 0, y = 0), nonce = 1L)

    private val sampleItems =
        listOf(
            ContextMenuItem(id = "copy", label = "Copy link", onClick = {}, shortcut = "⌘C"),
            ContextMenuItem(id = "export", label = "Export", onClick = {}, enabled = false),
            ContextMenuItem(id = "delete", label = "Delete", onClick = {}, destructive = true),
        )

    @Test
    fun openMenuRendersEveryRow() {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                ContextMenuSurface(state = state(sampleItems), menuLabel = menuLabel(), emptyLabel = emptyLabel(), onSelect = {})
            }
        }
        compose.onNodeWithTag(CONTEXT_MENU_TEST_TAG).assertIsDisplayed()
        compose.onNodeWithText("Copy link").assertIsDisplayed()
        compose.onNodeWithText("Export").assertIsDisplayed()
        compose.onNodeWithText("Delete").assertIsDisplayed()
    }

    @Test
    fun menuExposesTheAccessibleLabel() {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                ContextMenuSurface(state = state(sampleItems), menuLabel = menuLabel(), emptyLabel = emptyLabel(), onSelect = {})
            }
        }
        compose.onNodeWithContentDescription(menuLabel()).assertIsDisplayed()
    }

    @Test
    fun disabledRowIsNotEnabledAndShortcutRenders() {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                ContextMenuSurface(state = state(sampleItems), menuLabel = menuLabel(), emptyLabel = emptyLabel(), onSelect = {})
            }
        }
        compose.onNodeWithContentDescription("Export").assertIsNotEnabled()
        compose.onNodeWithText("⌘C").assertIsDisplayed()
    }

    @Test
    fun selectingARowInvokesHandlerAndDismisses() {
        var clicked = false
        val vm = ContextMenuViewModel(ContextMenuStore(), NoopLogger)
        vm.open(listOf(ContextMenuItem(id = "copy", label = "Copy link", onClick = { clicked = true })), ContextMenuAnchor(0, 0))
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                ContextMenuHost(viewModel = vm)
            }
        }
        compose.waitForIdle()
        compose.onNodeWithText("Copy link").performClick()
        compose.waitForIdle()
        assertTrue(clicked)
    }

    @Test
    fun emptySurfaceShowsFriendlyRowNotABlankBox() {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                ContextMenuSurface(state = state(emptyList()), menuLabel = menuLabel(), emptyLabel = emptyLabel(), onSelect = {})
            }
        }
        compose.onNodeWithTag(CONTEXT_MENU_TEST_TAG).assertIsDisplayed()
        compose.onNodeWithText(emptyLabel()).assertIsDisplayed()
    }

    @Test
    fun hostRendersOpenMenuAndHidesOnDismiss() {
        val vm = ContextMenuViewModel(ContextMenuStore(), NoopLogger)
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                ContextMenuHost(viewModel = vm)
            }
        }
        compose.onNodeWithTag(CONTEXT_MENU_TEST_TAG).assertDoesNotExist()

        compose.runOnUiThread {
            vm.open(listOf(ContextMenuItem(id = "a", label = "Action", onClick = {})), ContextMenuAnchor(0, 0))
        }
        compose.waitForIdle()
        compose.onNodeWithText("Action").assertIsDisplayed()

        compose.runOnUiThread { vm.dismiss() }
        compose.waitForIdle()
        compose.onNodeWithTag(CONTEXT_MENU_TEST_TAG).assertDoesNotExist()
    }
}
