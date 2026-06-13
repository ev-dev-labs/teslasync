package io.teslasync.android.sharedsurfaces.savedviewmenu

import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.UiPhase
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.shared.core.presentation.savedviews.SavedView
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test

/**
 * On-device Compose UI + accessibility verification of [SavedViewMenuPanel] + [SavedViewMenuContent] across
 * every state the web component renders plus the feed's lifecycle: the rows, the friendly empty state, the
 * loading skeleton, the classified error + retry, the stale freshness chip, and the trigger + applied badge.
 * Asserts the rendered i18n strings and the TalkBack content descriptions on the interactive elements. Runs
 * under `connectedAndroidTest`; the `testReleaseUnitTest` gate covers the projection + view-model logic, this
 * covers the render.
 */
class SavedViewMenuUiTest {
    @get:Rule
    val compose = createComposeRule()

    private val strings =
        SavedViewMenuStrings(
            title = "Saved views",
            manage = "Manage views",
            empty = "No saved views yet",
            saveCurrent = "Save current view",
            defaultBadge = "Default",
            setDefault = "Set as default",
            unsetDefault = "Clear default",
            pin = "Pin",
            unpin = "Unpin",
            rename = "Rename view",
            delete = "Delete",
            cancel = "Cancel",
            save = "Save",
            saving = "Saving",
            close = "Close",
            name = "Name",
            nameHint = "View name",
            makeDefault = "Apply automatically when I open this page",
            appliedBadge = "View",
            clearApplied = "Clear applied view",
            emptyQuery = "No filters",
            deleteTitle = "Delete saved view",
            deleteConfirmTemplate = "Delete saved view \"%1\$s\"?",
            staleLabel = "Stale",
            offlineLabel = "Offline",
            loadingLabel = "Loading",
            announceAppliedTemplate = "View %1\$s applied",
            announceCleared = "Saved view cleared",
        )

    private val noActions =
        SavedViewRowActions(
            onApply = {},
            onToggleDefault = {},
            onTogglePin = {},
            onRename = {},
            onDelete = {},
        )

    private fun setPanel(
        display: SavedViewMenuDisplay,
        actions: SavedViewRowActions = noActions,
        onRetry: () -> Unit = {},
    ) {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                SavedViewMenuPanel(
                    display = display,
                    strings = strings,
                    actions = actions,
                    onManage = {},
                    onSaveCurrent = {},
                    onRetry = onRetry,
                )
            }
        }
    }

    @Test
    fun contentShowsRowsManageAndSaveFooter() {
        setPanel(
            SavedViewMenuDisplay(
                phase = UiPhase.Content,
                views = listOf(view(1, "Long road trips")),
            ),
        )
        compose.onNodeWithText("Long road trips").assertIsDisplayed()
        compose.onNodeWithText("Manage views").assertIsDisplayed()
        compose.onNodeWithText("Save current view").assertIsDisplayed()
    }

    @Test
    fun contentRowExposesActionA11yLabels() {
        setPanel(
            SavedViewMenuDisplay(
                phase = UiPhase.Content,
                views = listOf(view(1, "Trips", isDefault = false, isPinned = false)),
            ),
        )
        compose.onNodeWithContentDescription("Set as default").assertIsDisplayed()
        compose.onNodeWithContentDescription("Pin").assertIsDisplayed()
        compose.onNodeWithContentDescription("Rename view").assertIsDisplayed()
        compose.onNodeWithContentDescription("Delete").assertIsDisplayed()
    }

    @Test
    fun defaultRowExposesClearDefaultLabel() {
        setPanel(
            SavedViewMenuDisplay(
                phase = UiPhase.Content,
                views = listOf(view(1, "Week", isDefault = true, isPinned = true)),
            ),
        )
        compose.onNodeWithContentDescription("Clear default").assertIsDisplayed()
        compose.onNodeWithContentDescription("Unpin").assertIsDisplayed()
    }

    @Test
    fun emptyShowsMessageAndSaveAction() {
        setPanel(SavedViewMenuDisplay(phase = UiPhase.Empty))
        compose.onNodeWithText("No saved views yet").assertIsDisplayed()
        compose.onNodeWithText("Save current view").assertIsDisplayed()
    }

    @Test
    fun loadingShowsAccessibleSkeletonChrome() {
        setPanel(SavedViewMenuDisplay(phase = UiPhase.Loading))
        compose.onNodeWithContentDescription("Loading", substring = true).assertIsDisplayed()
    }

    @Test
    fun errorShowsRetryAndInvokesIt() {
        var retried = false
        setPanel(
            display =
                SavedViewMenuDisplay(
                    phase = UiPhase.Error,
                    errorKind = ErrorKind.Http,
                    httpStatus = 503,
                ),
            onRetry = { retried = true },
        )
        compose.onNodeWithText("Server error").assertIsDisplayed()
        compose.onNodeWithText("Retry").performClick()
        assertTrue(retried)
    }

    @Test
    fun staleShowsStaleChip() {
        setPanel(
            SavedViewMenuDisplay(
                phase = UiPhase.Content,
                views = listOf(view(1, "Trips")),
                stale = true,
                refreshing = true,
            ),
        )
        compose.onNodeWithText("Stale").assertIsDisplayed()
    }

    @Test
    fun triggerShowsTitleWhenNoViewApplied() {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                SavedViewMenuContent(
                    display = SavedViewMenuDisplay(phase = UiPhase.Content, views = listOf(view(1, "Trips"))),
                    strings = strings,
                    expanded = false,
                    actions = noActions,
                    onExpandedChange = {},
                    onClear = {},
                    onManage = {},
                    onSaveCurrent = {},
                    onRetry = {},
                )
            }
        }
        compose.onNodeWithText("Saved views").assertIsDisplayed()
    }

    @Test
    fun appliedBadgeShowsNameAndClearInvokesIt() {
        var cleared = false
        val active = view(2, "This week", query = "range=7d")
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                SavedViewMenuContent(
                    display =
                        SavedViewMenuDisplay(
                            phase = UiPhase.Content,
                            views = listOf(active),
                            activeView = active,
                        ),
                    strings = strings,
                    expanded = false,
                    actions = noActions,
                    onExpandedChange = {},
                    onClear = { cleared = true },
                    onManage = {},
                    onSaveCurrent = {},
                    onRetry = {},
                )
            }
        }
        compose.onNodeWithText("View: This week", substring = true).assertIsDisplayed()
        compose.onNodeWithContentDescription("Clear applied view").performClick()
        assertTrue(cleared)
    }

    private fun view(
        id: Long,
        name: String,
        query: String = "status=active",
        isDefault: Boolean = false,
        isPinned: Boolean = false,
    ): SavedView =
        SavedView(
            id = id,
            name = name,
            route = "/drives",
            query = query,
            isDefault = isDefault,
            isPinned = isPinned,
            createdAt = "2024-01-01T00:00:00Z",
            updatedAt = "2024-01-01T00:00:00Z",
        )
}
