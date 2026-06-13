package io.teslasync.android.sharedsurfaces.pageheadersticky

import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.test.assertCountEquals
import androidx.compose.ui.test.assertHasClickAction
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.hasClickAction
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import io.teslasync.android.components.motion.LocalReducedMotion
import io.teslasync.android.components.ui.BodyText
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.Logger
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test

/**
 * On-device Compose UI + accessibility verification of [PageHeaderStickyContent] across every branch the web
 * component renders (web/src/components/layout/PageHeaderSticky.tsx): the hidden state that contributes zero
 * layout (web `if (!visible) return null`), the visible bar with its summary, the scroll-to-top button affordance
 * (and its absence when `scrollToTop=false`), and the empty-body fallback that keeps the bar from ever painting a
 * blank box. Asserts the rendered text, the merged TalkBack announcement on the bar, and the labelled, clickable
 * scroll-to-top affordance. Also covers the one-shot PII-safe `view.opened` diagnostic on the stateful
 * [PageHeaderSticky]. Runs under `connectedAndroidTest`; the :android:testReleaseUnitTest gate covers the pure
 * [classify] + [stickyHeaderVisible] + diagnostics logic.
 */
class PageHeaderStickyUiTest {
    @get:Rule
    val compose = createComposeRule()

    // ── Hidden → renders nothing (web `if (!visible) return null`) ────────────────────────────────────

    @Test
    fun hiddenBarContributesNoLayout() {
        setContent(visible = false, summary = "Model Y · 4 drives")
        compose.onNodeWithTag(PAGE_HEADER_STICKY_TEST_TAG).assertDoesNotExist()
    }

    // ── Visible + scroll-to-top (default): summary shown, whole bar is a clickable button ─────────────

    @Test
    fun visibleBarShowsSummaryAndIsAScrollToTopButton() {
        var scrolled = false
        setContent(visible = true, summary = "Model Y · 4 drives", scrollToTop = true) { scrolled = true }

        compose.onNodeWithText("Model Y · 4 drives", useUnmergedTree = true).assertIsDisplayed()

        val bar = compose.onNodeWithTag(PAGE_HEADER_STICKY_TEST_TAG)
        bar.assertIsDisplayed().assertHasClickAction()
        bar.performClick()
        assertTrue(scrolled)
    }

    // ── Visible + scrollToTop=false: no button (web `does NOT render a button when scrollToTop is false`) ─

    @Test
    fun nonScrollToTopBarExposesNoClickAction() {
        setContent(visible = true, summary = "Read-only summary", scrollToTop = false)
        compose.onNodeWithTag(PAGE_HEADER_STICKY_TEST_TAG).assertIsDisplayed()
        compose.onAllNodes(hasClickAction()).assertCountEquals(0)
    }

    // ── Empty body → the localized fallback, never a blank bar ────────────────────────────────────────

    @Test
    fun emptyBodyShowsTheLocalizedFallbackCaption() {
        setContent(visible = true, summary = null)
        compose.onNodeWithText("No data available", useUnmergedTree = true).assertIsDisplayed()
    }

    // ── Accessibility: the bar is a single labelled node (region name + spoken body) ──────────────────

    @Test
    fun barExposesAMergedSpokenLabel() {
        setContent(visible = true, summary = "Model Y · 4 drives")
        compose
            .onNodeWithContentDescription("Drive history summary. Model Y · 4 drives")
            .assertIsDisplayed()
    }

    // ── Arbitrary slot content renders (the faithful port of the web `children`) ──────────────────────

    @Test
    fun arbitrarySlotContentRenders() {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                CompositionLocalProvider(LocalReducedMotion provides true) {
                    PageHeaderStickyContent(visible = true, ariaLabel = "Drive history summary") {
                        BodyText("Custom slot node")
                    }
                }
            }
        }
        compose.onNodeWithText("Custom slot node", useUnmergedTree = true).assertIsDisplayed()
    }

    // ── Diagnostics: the one-shot PII-safe view.opened (P1/S11) fires on mount even while hidden ───────

    @Test
    fun mountingTheStatefulSurfaceEmitsViewOpenedOnce() {
        val logger = RecordingLogger()
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                CompositionLocalProvider(LocalReducedMotion provides true) {
                    val listState = rememberLazyListState()
                    PageHeaderSticky(listState = listState, ariaLabel = "Drive history summary", logger = logger)
                }
            }
        }
        compose.waitForIdle()

        assertEquals(1, logger.records.size)
        val (level, event, fields) = logger.records.single()
        assertEquals(LogLevel.Info, level)
        assertEquals("view.opened", event)
        assertEquals(mapOf("surface" to "PageHeaderSticky"), fields)
    }

    private fun setContent(
        visible: Boolean,
        summary: String?,
        scrollToTop: Boolean = true,
        onScrollToTop: () -> Unit = {},
    ) {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                CompositionLocalProvider(LocalReducedMotion provides true) {
                    PageHeaderStickyContent(
                        visible = visible,
                        ariaLabel = "Drive history summary",
                        scrollToTop = scrollToTop,
                        summary = summary,
                        onScrollToTop = onScrollToTop,
                    )
                }
            }
        }
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
}
