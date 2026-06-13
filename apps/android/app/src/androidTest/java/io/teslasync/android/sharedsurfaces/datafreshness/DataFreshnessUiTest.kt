package io.teslasync.android.sharedsurfaces.datafreshness

import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.test.assertHasClickAction
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.test.platform.app.InstrumentationRegistry
import io.teslasync.android.R
import io.teslasync.android.components.motion.LocalReducedMotion
import io.teslasync.android.ui.theme.TeslaSyncTheme
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test

/**
 * On-device Compose UI + accessibility verification of the DataFreshness shared surface across every state
 * the web component renders (web/src/components/data-display/DataFreshness.tsx): the fresh chip ("3m ago"),
 * the fetching chip ("updating…"), the stale chip, the hard-error chip ("error"), the offline / last-known
 * chip, and the never-updated / empty surface (dot + icon, no text — never a blank box). It asserts the
 * rendered i18n relative-time string and that the chip exposes its freshness as a single TalkBack content
 * description (web `aria-label` / `aria-live`), plus that a refetchable chip is a labelled, clickable button.
 * Every render is built with reduced motion so the infinite dot-ring / pulse / spin transitions never keep
 * the test clock busy. Runs under `connectedAndroidTest`; the `testReleaseUnitTest` gate covers the pure
 * projection, this covers the render.
 */
class DataFreshnessUiTest {
    @get:Rule
    val compose = createComposeRule()

    private val context = InstrumentationRegistry.getInstrumentation().targetContext
    private val base = 1_700_000_000_000L
    private val now = base + 3 * 60_000L

    private fun render(
        snapshot: FreshnessSnapshot,
        refetchable: Boolean = false,
    ): FreshnessRender = DataFreshnessProjection.render(snapshot, nowMs = now, reduceMotion = true, refetchable = refetchable)

    private fun snapshot(
        updatedAtMs: Long? = base,
        fetching: Boolean = false,
        stale: Boolean = false,
        hardError: Boolean = false,
        offline: Boolean = false,
        hasData: Boolean = true,
    ) = FreshnessSnapshot(updatedAtMs, fetching, stale, hardError, offline, hasData, empty = false)

    private fun setChip(
        render: FreshnessRender,
        compact: Boolean = false,
        onRefresh: (() -> Unit)? = null,
    ) {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                CompositionLocalProvider(LocalReducedMotion provides true) {
                    DataFreshnessChip(render = render, compact = compact, onRefresh = onRefresh)
                }
            }
        }
    }

    private fun a11y(status: String) = context.getString(R.string.translation_a11y_dataFreshness, status)

    @Test
    fun freshChipShowsRelativeTimeAndIsLabelled() {
        setChip(render(snapshot()))

        val threeMinutes = context.getString(R.string.translation_freshness_minutes, 3)
        compose.onNodeWithText(threeMinutes, useUnmergedTree = true).assertIsDisplayed()
        compose.onNodeWithContentDescription(a11y("fresh")).assertIsDisplayed()
    }

    @Test
    fun fetchingChipAnnouncesUpdating() {
        setChip(render(snapshot(updatedAtMs = null, fetching = true, hasData = false), refetchable = true))

        val updating = context.getString(R.string.translation_freshness_updating)
        compose.onNodeWithText(updating, useUnmergedTree = true).assertIsDisplayed()
        // A fetch in flight is never refreshable (web onRefresh && !isFetching), so it stays a status label.
        compose.onNodeWithContentDescription(a11y("fetching")).assertIsDisplayed()
    }

    @Test
    fun errorChipShowsErrorAndIsLabelled() {
        setChip(render(snapshot(updatedAtMs = null, hardError = true, hasData = false)))

        val error = context.getString(R.string.translation_freshness_error)
        compose.onNodeWithText(error, useUnmergedTree = true).assertIsDisplayed()
        compose.onNodeWithContentDescription(a11y("error")).assertIsDisplayed()
    }

    @Test
    fun staleChipIsLabelledStale() {
        setChip(render(snapshot(stale = true)))

        compose.onNodeWithContentDescription(a11y("stale")).assertIsDisplayed()
        val threeMinutes = context.getString(R.string.translation_freshness_minutes, 3)
        compose.onNodeWithText(threeMinutes, useUnmergedTree = true).assertIsDisplayed()
    }

    @Test
    fun offlineChipShowsLastKnownTimeAndIsLabelled() {
        setChip(render(snapshot(stale = true, offline = true)))

        compose.onNodeWithContentDescription(a11y("offline")).assertIsDisplayed()
        val threeMinutes = context.getString(R.string.translation_freshness_minutes, 3)
        compose.onNodeWithText(threeMinutes, useUnmergedTree = true).assertIsDisplayed()
    }

    @Test
    fun neverUpdatedChipRendersANonBlankLabelledSurface() {
        setChip(render(snapshot(updatedAtMs = null, hasData = false)))

        // No relative-time text, but the dot + icon chip still renders and is labelled (never a blank box).
        compose.onNodeWithTag(DATA_FRESHNESS_TEST_TAG).assertIsDisplayed()
        compose.onNodeWithContentDescription(a11y("fresh")).assertIsDisplayed()
    }

    @Test
    fun refetchableChipIsAClickableButtonLabelledRefresh() {
        setChip(render(snapshot(), refetchable = true), onRefresh = {})

        val refresh = context.getString(R.string.translation_freshness_refresh)
        compose.onNodeWithContentDescription(refresh).assertIsDisplayed()
        compose.onNodeWithContentDescription(refresh).assertHasClickAction()
    }

    @Test
    fun tappingTheChipInvokesTheRefreshCallback() {
        var clicks = 0
        setChip(render(snapshot(), refetchable = true), onRefresh = { clicks++ })

        val refresh = context.getString(R.string.translation_freshness_refresh)
        compose.onNodeWithContentDescription(refresh).performClick()
        compose.waitForIdle()

        assertEquals(1, clicks)
    }

    @Test
    fun compactChipHidesTheRelativeTimeText() {
        setChip(render(snapshot()), compact = true)

        val threeMinutes = context.getString(R.string.translation_freshness_minutes, 3)
        compose.onNodeWithText(threeMinutes, useUnmergedTree = true).assertDoesNotExist()
        compose.onNodeWithTag(DATA_FRESHNESS_TEST_TAG).assertIsDisplayed()
    }
}
