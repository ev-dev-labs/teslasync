package io.teslasync.android.widgetprimitives.widgetrankedlist

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.width
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.unit.dp
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.Logger
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test

/**
 * On-device Compose UI + accessibility verification of the WidgetRankedList surface across every branch the web
 * component renders (web/src/features/dashboard/widgets/shared/WidgetRankedList.tsx): the empty state, the
 * populated ranked rows, the badge, the explicit row budget, and the compact budget. Each row collapses to one
 * merged TalkBack node, so the assertions go through `onNodeWithContentDescription` — which also serves as the
 * accessibility-label test. Verifies the one-shot PII-safe `view.opened` diagnostic fires once with only the
 * surface slug. Runs under `connectedAndroidTest`; the `testReleaseUnitTest` gate covers the pure ranking +
 * diagnostics logic off-device.
 */
class WidgetRankedListUiTest {
    @get:Rule
    val compose = createComposeRule()

    // ── Empty state: the shared EmptyState message renders and is announced (web `visible.length === 0`) ───

    @Test
    fun emptyStateRendersTheMessageAndIsAnnounced() {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                Frame {
                    WidgetRankedListContent(items = emptyList(), emptyMessage = EMPTY_MESSAGE)
                }
            }
        }
        compose.onNodeWithText(EMPTY_MESSAGE).assertIsDisplayed()
        compose.onNodeWithContentDescription(EMPTY_MESSAGE).assertIsDisplayed()
        compose.onNodeWithTag(WIDGET_RANKED_LIST_TEST_TAG).assertIsDisplayed()
    }

    // ── Populated: rows render in rank order, each announced as one merged node (a11y label test) ──────────

    @Test
    fun populatedListRendersRankedRowsWithMergedAccessibilityLabels() {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                Frame {
                    WidgetRankedListContent(items = ITEMS)
                }
            }
        }
        compose.onNodeWithTag(WIDGET_RANKED_LIST_TEST_TAG).assertIsDisplayed()
        // The leader is rank 1 with its badge folded into the single row announcement.
        compose.onNodeWithContentDescription("1. Home, 128, Top").assertIsDisplayed()
        compose.onNodeWithContentDescription("2. Market, 86").assertIsDisplayed()
        compose.onNodeWithContentDescription("3. Office, 54, Low").assertIsDisplayed()
    }

    // ── Explicit budget: web `maxItems` slices the list ───────────────────────────────────────────────────

    @Test
    fun maxItemsLimitsTheRenderedRows() {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                Frame {
                    WidgetRankedListContent(items = ITEMS, maxItems = 2)
                }
            }
        }
        compose.onNodeWithContentDescription("1. Home, 128, Top").assertIsDisplayed()
        compose.onNodeWithContentDescription("2. Market, 86").assertIsDisplayed()
        compose.onNodeWithContentDescription("3. Office, 54, Low").assertDoesNotExist()
    }

    // ── Compact: web `maxItems ?? (compact ? 3 : 5)` tightens the budget to three ─────────────────────────

    @Test
    fun compactModeShowsAtMostThreeRows() {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                Frame {
                    WidgetRankedListContent(items = ITEMS, compact = true)
                }
            }
        }
        compose.onNodeWithContentDescription("3. Office, 54, Low").assertIsDisplayed()
        compose.onNodeWithContentDescription("4. Gym, 31").assertDoesNotExist()
    }

    // ── Diagnostics: one-shot view.opened with only the surface slug ──────────────────────────────────────

    @Test
    fun mountingEmitsViewOpenedOnceWithOnlyTheSlug() {
        val logger = RecordingLogger()
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                Frame {
                    WidgetRankedList(items = ITEMS, logger = logger)
                }
            }
        }
        compose.waitForIdle()

        val opened = logger.records.filter { it.event == "view.opened" }
        assertEquals(1, opened.size)
        assertEquals(LogLevel.Info, opened.single().level)
        assertEquals(mapOf("surface" to "WidgetRankedList"), opened.single().fields)
        assertTrue("no item value may leak", logger.records.none { it.fields.containsValue("128") })
    }

    @Composable
    private fun Frame(content: @Composable () -> Unit) {
        Box(
            modifier =
                Modifier
                    .width(360.dp)
                    .height(320.dp),
            content = { content() },
        )
    }

    private data class Record(
        val level: LogLevel,
        val event: String,
        val fields: Map<String, String>,
    )

    private class RecordingLogger : Logger {
        val records = mutableListOf<Record>()

        override fun log(
            level: LogLevel,
            event: String,
            fields: Map<String, String>,
        ) {
            records += Record(level, event, fields)
        }
    }

    private companion object {
        private const val EMPTY_MESSAGE = "No favorites yet"
        private val ITEMS =
            listOf(
                RankedItem(
                    id = "1",
                    label = "Home",
                    value = 128.0,
                    formattedValue = "128",
                    badge = RankedBadge(text = "Top", variant = RankedBadgeVariant.Success),
                ),
                RankedItem(id = "2", label = "Market", value = 86.0, formattedValue = "86"),
                RankedItem(
                    id = "3",
                    label = "Office",
                    value = 54.0,
                    formattedValue = "54",
                    badge = RankedBadge(text = "Low", variant = RankedBadgeVariant.Warning),
                ),
                RankedItem(id = "4", label = "Gym", value = 31.0, formattedValue = "31"),
                RankedItem(id = "5", label = "Airport", value = 12.0, formattedValue = "12"),
            )
    }
}
