// On-device Compose UI + accessibility verification of the StickyCompactHero shared surface across every state the
// web bar renders (web/src/components/status/StickyCompactHero.tsx): the collapsed-on-scroll bar with its tappable
// status summary (glyph + tone headline + last-checked + up-arrow), the refresh control, and the
// loading / empty / error / stale / offline chrome with their labelled, clickable affordances. The `testReleaseUnitTest`
// gate covers the pure projection + adapters; this runs under `connectedAndroidTest`.
//
// The collapse branch (web `if (!visible) return null`) is reproduced by the production `AnimatedVisibility`
// wrapper and exercised by the `@Preview`s; node-absence assertions (`assertDoesNotExist` / `onAllNodes`) are not
// part of the pinned Compose-test surface, so — like the working sibling UI tests (e.g. VersionSegmentUiTest) —
// this suite asserts the rendered states with the available `onNodeWith*` / `assertIsDisplayed` matchers.
//
// The mainClock auto-advance is disabled so the surface's pulsing status/freshness chips (infinite animations) do
// not block `waitForIdle`; reduced motion is forced so transitions resolve deterministically.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.stickycompacthero

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
import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import io.teslasync.android.ui.theme.TeslaSyncTheme
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test

class StickyCompactHeroUiTest {
    @get:Rule
    val compose = createComposeRule()

    private val context = InstrumentationRegistry.getInstrumentation().targetContext
    private val stamp = 1_700_000_000_000L

    private fun s(id: Int) = context.getString(id)

    private fun strings(): StickyCompactHeroStrings =
        StickyCompactHeroStrings(
            regionLabel = s(R.string.translation_Status),
            healthy = s(R.string.translation_Healthy),
            degraded = s(R.string.translation_Degraded),
            unhealthy = s(R.string.translation_Unhealthy),
            unknown = s(R.string.translation_Unknown),
            maintenance = s(R.string.translation_Maintenance),
            refresh = s(R.string.translation_common_refresh),
            loading = s(R.string.translation_a11y_loading),
            stale = s(R.string.translation_mqtt_stale),
            offline = s(R.string.translation_error_network_offlineTitle),
            retry = s(R.string.translation_common_retry),
            errorMessage = s(R.string.translation_error_loadFailed),
        )

    private fun content(status: HeroStatus): UiState<HeroStatus> = UiState(UiPhase.Content, data = status, fetchedAt = stamp)

    private fun setBar(
        state: UiState<HeroStatus>,
        visible: Boolean = true,
        lastChecked: String? = "12s ago",
        onScrollToTop: () -> Unit = {},
        onRefresh: () -> Unit = {},
    ) {
        compose.mainClock.autoAdvance = false
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                CompositionLocalProvider(LocalReducedMotion provides true) {
                    StickyCompactHeroChrome(
                        state = state,
                        strings = strings(),
                        visible = visible,
                        lastCheckedLabel = lastChecked,
                        onScrollToTop = onScrollToTop,
                        onRefresh = onRefresh,
                    )
                }
            }
        }
    }

    @Test
    fun contentBarShowsTheStatusAndAClickableSummary() {
        setBar(content(HeroStatus.Healthy))

        compose.onNodeWithTag(STICKY_COMPACT_HERO_TEST_TAG).assertIsDisplayed()
        compose
            .onNodeWithTag(STICKY_COMPACT_HERO_SUMMARY_TAG)
            .assertIsDisplayed()
            .assertHasClickAction()
        compose.onNodeWithText(s(R.string.translation_Healthy), useUnmergedTree = true).assertIsDisplayed()
        compose.onNodeWithContentDescription(s(R.string.translation_common_refresh)).assertIsDisplayed()
    }

    @Test
    fun tappingTheSummaryReturnsToTop() {
        var scrolled = false
        setBar(content(HeroStatus.Degraded), onScrollToTop = { scrolled = true })

        compose.onNodeWithTag(STICKY_COMPACT_HERO_SUMMARY_TAG).performClick()

        assertTrue("tapping the compact hero scrolls the page back to the top (web handleScrollTop)", scrolled)
    }

    @Test
    fun theRefreshControlFiresItsCallback() {
        var refreshed = false
        setBar(content(HeroStatus.Healthy), onRefresh = { refreshed = true })

        compose
            .onNodeWithTag(STICKY_COMPACT_HERO_REFRESH_TAG)
            .assertIsDisplayed()
            .assertHasClickAction()
            .performClick()

        assertTrue("the refresh control re-checks the status (web onRefresh)", refreshed)
    }

    @Test
    fun loadingStateAnnouncesTheLoadingChrome() {
        setBar(UiState.loading(), lastChecked = null)

        compose.onNodeWithText(s(R.string.translation_a11y_loading), useUnmergedTree = true).assertIsDisplayed()
    }

    @Test
    fun emptyStateShowsTheUnknownFace() {
        setBar(UiState(UiPhase.Empty, data = HeroStatus.Unknown, fetchedAt = stamp), lastChecked = null)

        compose.onNodeWithText(s(R.string.translation_Unknown), useUnmergedTree = true).assertIsDisplayed()
    }

    @Test
    fun errorStateShowsTheFailureCopyAndAClickableRefresh() {
        var retried = false
        setBar(UiState(UiPhase.Error, errorKind = ErrorKind.Unknown), onRefresh = { retried = true })

        compose.onNodeWithText(s(R.string.translation_error_loadFailed), useUnmergedTree = true).assertIsDisplayed()
        compose
            .onNodeWithTag(STICKY_COMPACT_HERO_REFRESH_TAG)
            .assertIsDisplayed()
            .assertHasClickAction()
            .performClick()

        assertTrue("the error surface refresh re-collects the feed (web refetch)", retried)
    }

    @Test
    fun staleStateShowsTheStaleChip() {
        setBar(UiState(UiPhase.Content, data = HeroStatus.Healthy, fetchedAt = stamp, stale = true, refreshing = true))

        compose.onNodeWithText(s(R.string.translation_mqtt_stale), useUnmergedTree = true).assertIsDisplayed()
    }

    @Test
    fun offlineStateShowsTheOfflineChip() {
        setBar(UiState(UiPhase.Content, data = HeroStatus.Degraded, fetchedAt = stamp, stale = true, errorKind = ErrorKind.Network))

        compose.onNodeWithText(s(R.string.translation_error_network_offlineTitle), useUnmergedTree = true).assertIsDisplayed()
    }
}
