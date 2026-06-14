package io.teslasync.android.sharedsurfaces.pagination

import androidx.compose.ui.test.assertHasClickAction
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.assertIsEnabled
import androidx.compose.ui.test.assertIsNotEnabled
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.Logger
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test

/**
 * On-device Compose UI + accessibility verification of the Pagination surface across every branch the web
 * component renders (web/src/components/ui/Pagination.tsx): the "showing" summary (0 on an empty dataset, else
 * the 1-based window), the first / previous / next / last jumps with their bound-aware disabled states, the
 * `page / totalPages` indicator with its spoken "Page X of Y" name, the "Pagination" landmark name, and the
 * optional page-size selector. Asserts the localized contentDescription on each jump, the disabled state at the
 * bounds, the reported page on tap, and the one-shot PII-safe `view.opened` diagnostic. Runs under
 * `connectedAndroidTest`; the `testReleaseUnitTest` gate covers the pure projection + diagnostics off-device.
 */
class PaginationUiTest {
    @get:Rule
    val compose = createComposeRule()

    // ── Empty dataset: "showing 0", a single page, every jump disabled (web `total > 0 ? start : 0`) ───────

    @Test
    fun emptyDatasetShowsZeroAndDisablesEveryJump() {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                PaginationBar(page = 1, pageSize = 25, total = 0, onPageChange = {})
            }
        }

        compose.onNodeWithText(SHOWING_EMPTY).assertIsDisplayed()
        compose.onNodeWithContentDescription(FIRST).assertIsNotEnabled()
        compose.onNodeWithContentDescription(PREVIOUS).assertIsNotEnabled()
        compose.onNodeWithContentDescription(NEXT).assertIsNotEnabled()
        compose.onNodeWithContentDescription(LAST).assertIsNotEnabled()
    }

    // ── First / middle / last of many: which jump pairs disable (web `disabled` predicates) ────────────────

    @Test
    fun firstPageDisablesTheBackwardJumpsOnly() {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                PaginationBar(page = 1, pageSize = 25, total = 60, onPageChange = {})
            }
        }

        compose.onNodeWithContentDescription(FIRST).assertIsNotEnabled()
        compose.onNodeWithContentDescription(PREVIOUS).assertIsNotEnabled()
        compose.onNodeWithContentDescription(NEXT).assertIsEnabled()
        compose.onNodeWithContentDescription(LAST).assertIsEnabled()
    }

    @Test
    fun middlePageEnablesEveryJump() {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                PaginationBar(page = 2, pageSize = 25, total = 60, onPageChange = {})
            }
        }

        compose.onNodeWithContentDescription(FIRST).assertIsEnabled()
        compose.onNodeWithContentDescription(PREVIOUS).assertIsEnabled()
        compose.onNodeWithContentDescription(NEXT).assertIsEnabled()
        compose.onNodeWithContentDescription(LAST).assertIsEnabled()
    }

    @Test
    fun lastPageDisablesTheForwardJumpsOnly() {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                PaginationBar(page = 3, pageSize = 25, total = 60, onPageChange = {})
            }
        }

        compose.onNodeWithContentDescription(FIRST).assertIsEnabled()
        compose.onNodeWithContentDescription(PREVIOUS).assertIsEnabled()
        compose.onNodeWithContentDescription(NEXT).assertIsNotEnabled()
        compose.onNodeWithContentDescription(LAST).assertIsNotEnabled()
    }

    // ── Interaction: each jump reports the requested page (web `onPageChange(...)`) ────────────────────────

    @Test
    fun tappingPreviousAndNextReportTheAdjacentPages() {
        val reported = mutableListOf<Int>()
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                PaginationBar(page = 2, pageSize = 25, total = 60, onPageChange = { reported += it })
            }
        }

        compose.onNodeWithContentDescription(PREVIOUS).assertHasClickAction().performClick()
        compose.onNodeWithContentDescription(NEXT).performClick()

        assertEquals(listOf(1, 3), reported)
    }

    @Test
    fun tappingFirstAndLastJumpToTheBounds() {
        val reported = mutableListOf<Int>()
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                PaginationBar(page = 2, pageSize = 25, total = 60, onPageChange = { reported += it })
            }
        }

        compose.onNodeWithContentDescription(FIRST).performClick()
        compose.onNodeWithContentDescription(LAST).performClick()

        // 60 rows / 25 per page → 3 pages; last jumps to page 3.
        assertEquals(listOf(1, 3), reported)
    }

    // ── Accessibility: the landmark name and the spoken page indicator (web `<nav aria-label>` + indicator) ─

    @Test
    fun theBarExposesThePaginationLandmarkName() {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                PaginationBar(page = 1, pageSize = 25, total = 60, onPageChange = {})
            }
        }

        compose.onNodeWithContentDescription(PAGINATION_LANDMARK).assertIsDisplayed()
    }

    @Test
    fun thePageIndicatorExposesItsSpokenName() {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                PaginationBar(page = 2, pageSize = 25, total = 60, onPageChange = {})
            }
        }

        compose.onNodeWithContentDescription(PAGE_2_OF_3).assertIsDisplayed()
    }

    // ── Optional page-size selector: present only when an onPageSizeChange handler is supplied ─────────────

    @Test
    fun thePageSizeSelectorIsHiddenWithoutAHandler() {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                PaginationBar(page = 1, pageSize = 50, total = 320, onPageChange = {})
            }
        }

        compose.onNodeWithText(PER_PAGE_50).assertDoesNotExist()
    }

    @Test
    fun thePageSizeSelectorShowsTheSelectedSizeWithAHandler() {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                PaginationBar(
                    page = 1,
                    pageSize = 50,
                    total = 320,
                    onPageChange = {},
                    onPageSizeChange = {},
                )
            }
        }

        compose.onNodeWithText(PER_PAGE_50).assertIsDisplayed()
    }

    // ── Diagnostics: one-shot view.opened with only the surface slug ───────────────────────────────────────

    @Test
    fun mountingEmitsViewOpenedOnceWithOnlyTheSlug() {
        val logger = RecordingLogger()
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                Pagination(page = 7, pageSize = 25, total = 250, onPageChange = {}, logger = logger)
            }
        }
        compose.waitForIdle()

        val opened = logger.records.filter { it.event == "view.opened" }
        assertEquals(1, opened.size)
        assertEquals(LogLevel.Info, opened.single().level)
        assertEquals(mapOf("surface" to "Pagination"), opened.single().fields)
        assertTrue("the page must never leak", logger.records.none { it.fields.containsValue("7") })
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
        // English values from the default res/values/strings.xml catalog (P1/S10).
        private const val PAGINATION_LANDMARK = "Pagination"
        private const val FIRST = "First page"
        private const val PREVIOUS = "Previous page"
        private const val NEXT = "Next page"
        private const val LAST = "Last page"
        private const val SHOWING_EMPTY = "Showing 0\u20130 of 0"
        private const val PAGE_2_OF_3 = "Page 2 of 3"
        private const val PER_PAGE_50 = "50 / page"
    }
}
