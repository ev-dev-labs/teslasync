package io.teslasync.android.featureviews.teslaapiref

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.test.assertCountEquals
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.hasSetTextAction
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performTextInput
import io.teslasync.android.ui.theme.TeslaSyncTheme
import org.junit.Rule
import org.junit.Test

/**
 * On-device Compose UI + accessibility verification of [TeslaApiRefToolContent] across every state the
 * surface renders: the populated content state (card header, search field, method badges, paths, and
 * descriptions), the empty state (search matches nothing → friendly "no data" message, no rows), and the
 * live search filter narrowing the table. Also asserts the per-row copy button exposes a distinct,
 * descriptive TalkBack label. Runs under `connectedAndroidTest`; the offline gate's `testReleaseUnitTest`
 * covers the pure filter / paging / projection logic, this covers render + a11y. Mirrors the web spec
 * (web/src/features/admin/components/devtools/tools/TeslaApiRefTool.tsx).
 */
class TeslaApiRefToolUiTest {
    @get:Rule
    val compose = createComposeRule()

    private val strings =
        TeslaApiRefStrings(
            title = "Tesla Api Ref",
            description = "Tesla Api Ref Desc",
            searchHint = "Search Endpoints",
            methodHeader = "Method",
            pathHeader = "Path",
            descHeader = "Endpoint Desc",
            copyLabel = "Copy",
            copiedLabel = "Copied",
            emptyMessage = "No data available",
        )

    private fun setContent(initialSearch: String = "") {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                var search by remember { mutableStateOf(initialSearch) }
                TeslaApiRefToolContent(
                    strings = strings,
                    search = search,
                    onSearchChange = { search = it },
                )
            }
        }
    }

    @Test
    fun contentStateRendersHeaderSearchAndEndpointRows() {
        setContent()
        // Card header (web ToolCard title + description) and the search field's floating label.
        compose.onNodeWithText(strings.title).assertIsDisplayed()
        compose.onNodeWithText(strings.description).assertIsDisplayed()
        compose.onNodeWithText(strings.searchHint).assertIsDisplayed()
        // Column headers (web Method / Path / Endpoint Desc).
        compose.onNodeWithText(strings.methodHeader).assertIsDisplayed()
        compose.onNodeWithText(strings.pathHeader).assertIsDisplayed()
        compose.onNodeWithText(strings.descHeader).assertIsDisplayed()
        // A representative row: its path and description (exact-match nodes).
        compose.onNodeWithText("/api/1/vehicles").assertIsDisplayed()
        compose.onNodeWithText("List vehicles").assertIsDisplayed()
        // The three GET endpoints each render a method badge.
        compose.onAllNodesWithText("GET").assertCountEquals(3)
    }

    @Test
    fun emptyStateShowsFriendlyMessageWhenSearchMatchesNothing() {
        setContent(initialSearch = "zzz-no-such-endpoint")
        // The card chrome stays; only the table body collapses to the empty message (never a blank box).
        compose.onNodeWithText(strings.title).assertIsDisplayed()
        compose.onNodeWithText(strings.emptyMessage).assertIsDisplayed()
        compose.onAllNodesWithText("List vehicles").assertCountEquals(0)
    }

    @Test
    fun typingInTheSearchFieldFiltersTheTableLive() {
        setContent()
        compose.onNodeWithText("List vehicles").assertIsDisplayed()
        // The single editable field is the search input; typing a query re-filters the rows.
        compose.onNode(hasSetTextAction()).performTextInput("wake")
        compose.onNodeWithText("Wake up vehicle").assertIsDisplayed()
        compose.onAllNodesWithText("List vehicles").assertCountEquals(0)
    }

    @Test
    fun copyButtonsExposePerRowAccessibleLabels() {
        setContent()
        // Each icon-only copy button names itself with its endpoint path, so TalkBack can tell rows apart.
        compose.onNodeWithContentDescription("Copy /api/1/vehicles").assertIsDisplayed()
    }
}
