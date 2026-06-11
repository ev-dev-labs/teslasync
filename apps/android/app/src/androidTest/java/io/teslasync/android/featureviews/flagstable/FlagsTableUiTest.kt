package io.teslasync.android.featureviews.flagstable

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.size
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.test.assertHasClickAction
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.unit.dp
import io.teslasync.android.components.ui.SortDirection
import io.teslasync.android.components.ui.SortState
import io.teslasync.android.ui.theme.TeslaSyncTheme
import kotlinx.serialization.json.JsonPrimitive
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test

/**
 * Instrumented Compose UI + accessibility verification of [FlagsTableContent] across every body state
 * the web component renders (data + pagination / loading / empty), plus the per-row Edit + Delete
 * accessibility (labelled, click-actioned, callback-wired) and the sortable key-header interaction.
 * Mirrors the web spec (web/src/features/admin/components/feature-flags/FlagsTable.tsx). Runs under
 * `connectedAndroidTest`; the offline gate's `testReleaseUnitTest` covers the pure model.
 */
class FlagsTableUiTest {
    @get:Rule
    val compose = createComposeRule()

    private val labels =
        FlagsTableLabels(
            keyHeader = "Flag key",
            valueHeader = "Value",
            actionsHeader = "Actions",
            editLabel = "Edit",
            deleteLabel = "Delete",
            loadingMessage = "Loading flags\u2026",
            emptyMessage = "No feature flags are set on this server.",
        )

    private val oneRow = listOf(FeatureFlagEntry("feature.dlq.replay_enabled", JsonPrimitive(true)))

    private fun setContent(
        rows: List<FeatureFlagEntry>,
        loading: Boolean = false,
        sortState: SortState = SortState(SORT_KEY_KEY, SortDirection.Asc),
        onSortChange: (String) -> Unit = {},
        onEdit: (FeatureFlagEntry) -> Unit = {},
        onAskDelete: (FeatureFlagEntry) -> Unit = {},
    ) {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                Host {
                    FlagsTableContent(
                        rows = rows,
                        loading = loading,
                        labels = labels,
                        sortState = sortState,
                        onSortChange = onSortChange,
                        onEdit = onEdit,
                        onAskDelete = onAskDelete,
                    )
                }
            }
        }
    }

    @Test
    fun headerShowsAllColumnLabels() {
        setContent(oneRow)
        compose.onNodeWithText("Flag key").assertIsDisplayed()
        compose.onNodeWithText("Value").assertIsDisplayed()
        compose.onNodeWithText("Actions").assertIsDisplayed()
    }

    @Test
    fun dataShowsKeyValueAndAccessibleActions() {
        var edited: FeatureFlagEntry? = null
        var askedDelete: FeatureFlagEntry? = null
        setContent(oneRow, onEdit = { edited = it }, onAskDelete = { askedDelete = it })

        compose.onNodeWithText("feature.dlq.replay_enabled").assertIsDisplayed()
        compose.onNodeWithText("true").assertIsDisplayed()

        // Both actions expose their localized label (TalkBack name) and a click action.
        compose.onNodeWithText("Edit").assertIsDisplayed().assertHasClickAction()
        compose.onNodeWithText("Delete").assertIsDisplayed().assertHasClickAction()

        compose.onNodeWithText("Edit").performClick()
        compose.onNodeWithText("Delete").performClick()
        assertEquals("feature.dlq.replay_enabled", edited?.key)
        assertEquals("feature.dlq.replay_enabled", askedDelete?.key)
    }

    @Test
    fun loadingShowsLoadingMessage() {
        setContent(emptyList(), loading = true)
        compose.onNodeWithText("Loading flags\u2026").assertIsDisplayed()
    }

    @Test
    fun emptyShowsEmptyMessage() {
        setContent(emptyList(), loading = false)
        compose.onNodeWithText("No feature flags are set on this server.").assertIsDisplayed()
    }

    @Test
    fun sortHeaderTriggersSortCallback() {
        var sortedKey: String? = null
        setContent(oneRow, onSortChange = { sortedKey = it })
        compose.onNodeWithText("Flag key").performClick()
        assertEquals("key", sortedKey)
    }

    @Composable
    private fun Host(content: @Composable () -> Unit) {
        Box(modifier = Modifier.size(width = HOST_WIDTH, height = HOST_HEIGHT)) { content() }
    }

    private companion object {
        val HOST_WIDTH = 420.dp
        val HOST_HEIGHT = 640.dp
    }
}
