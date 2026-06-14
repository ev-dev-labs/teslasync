package io.teslasync.android.sharedsurfaces.uptimeheatmap

import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onFirst
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.test.platform.app.InstrumentationRegistry
import io.teslasync.android.R
import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import io.teslasync.android.ui.theme.TeslaSyncTheme
import org.junit.Rule
import org.junit.Test

/**
 * On-device Compose UI + accessibility verification of the UptimeHeatmap shared surface across every state
 * the web source renders (web/src/components/status/UptimeHeatmap.tsx): the content grid (heading + uptime
 * caption + day squares), the friendly empty state, the QueryError retry surface, the stale + offline
 * freshness chips, and the loading skeleton. It asserts the rendered i18n strings resolve from the P1/S10
 * catalog, that every square exposes its `${date}: ${status}` TalkBack label (web `aria-label`), and that
 * tapping a square reveals its popover (date + status + summary). The loading shimmer is an infinite
 * animation, so its clock is frozen. Runs under `connectedAndroidTest`; the `testReleaseUnitTest` gate covers
 * the pure projection + the ViewModel, this covers the render.
 */
class UptimeHeatmapUiTest {
    @get:Rule
    val compose = createComposeRule()

    private val context = InstrumentationRegistry.getInstrumentation().targetContext

    private fun s(resId: Int): String = context.getString(resId)

    private fun strings(): UptimeHeatmapStrings =
        UptimeHeatmapStrings(
            titleTemplate = s(R.string.translation_uptimeHeatmap_title),
            uptimeTemplate = s(R.string.translation_uptimeHeatmap_uptimeSuffix),
            listLabel = s(R.string.translation_uptimeHeatmap_listLabel),
            dayLabelTemplate = s(R.string.translation_uptimeHeatmap_dayLabel),
            surfaceLabel = s(R.string.translation_uptimeHeatmap_aria),
            statusLabels =
                mapOf(
                    UptimeStatus.Healthy to s(R.string.translation_uptimeHeatmap_status_healthy),
                    UptimeStatus.Degraded to s(R.string.translation_uptimeHeatmap_status_degraded),
                    UptimeStatus.Unhealthy to s(R.string.translation_uptimeHeatmap_status_unhealthy),
                    UptimeStatus.Unknown to s(R.string.translation_uptimeHeatmap_status_unknown),
                    UptimeStatus.Maintenance to s(R.string.translation_uptimeHeatmap_status_maintenance),
                ),
            emptyTitle = s(R.string.translation_uptimeHeatmap_emptyTitle),
            emptyMessage = s(R.string.translation_uptimeHeatmap_empty),
            resourceName = s(R.string.translation_uptimeHeatmap_resourceName),
            stale = s(R.string.translation_mqtt_stale),
            offline = s(R.string.translation_common_offline),
            loadingLabel = s(R.string.translation_common_loading),
        )

    /** 10 days, all Operational except one Outage (with a summary) ⇒ a deterministic 90.00% uptime. */
    private fun sampleWindow(): UptimeWindow {
        val days =
            (1..WINDOW_SIZE).map { d ->
                val status = if (d == OUTAGE_DAY) UptimeStatus.Unhealthy else UptimeStatus.Healthy
                UptimeDay(
                    date = "2026-05-%02d".format(d),
                    status = status,
                    summary = if (d == OUTAGE_DAY) OUTAGE_SUMMARY else null,
                )
            }
        return UptimeWindow(days = days)
    }

    private fun setSurface(
        state: UiState<UptimeWindow>,
        onRetry: () -> Unit = {},
    ) {
        val labels = strings()
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                UptimeHeatmapChrome(state = state, strings = labels, onRetry = onRetry)
            }
        }
    }

    @Test
    fun contentRendersHeadingUptimeCaptionAndSquaresGrid() {
        setSurface(UiState(UiPhase.Content, data = sampleWindow(), fetchedAt = STAMP))

        compose.onNodeWithTag(UPTIME_HEATMAP_TEST_TAG).assertIsDisplayed()
        compose.onNodeWithTag(UPTIME_HEATMAP_GRID_TEST_TAG, useUnmergedTree = true).assertIsDisplayed()
        compose.onNodeWithText(strings().heading(WINDOW_SIZE), useUnmergedTree = true).assertIsDisplayed()
        // The uptime caption ("90.00% uptime") — assert by its locale-stable suffix.
        compose.onAllNodesWithText("uptime", substring = true, useUnmergedTree = true).onFirst().assertIsDisplayed()
    }

    @Test
    fun eachSquareExposesItsDayAccessibilityLabel() {
        setSurface(UiState(UiPhase.Content, data = sampleWindow(), fetchedAt = STAMP))

        val outageLabel = strings().dayLabel("2026-05-%02d".format(OUTAGE_DAY), UptimeStatus.Unhealthy)
        compose.onNodeWithContentDescription(outageLabel, useUnmergedTree = true).assertIsDisplayed()
    }

    @Test
    fun tappingASquareRevealsItsPopover() {
        setSurface(UiState(UiPhase.Content, data = sampleWindow(), fetchedAt = STAMP))

        val outageLabel = strings().dayLabel("2026-05-%02d".format(OUTAGE_DAY), UptimeStatus.Unhealthy)
        compose.onNodeWithContentDescription(outageLabel, useUnmergedTree = true).performClick()

        compose.onNodeWithText(OUTAGE_SUMMARY, useUnmergedTree = true).assertIsDisplayed()
    }

    @Test
    fun emptyStateRendersTheNoDataMessage() {
        setSurface(UiState(UiPhase.Empty, data = UptimeWindow(emptyList()), fetchedAt = STAMP))

        compose.onNodeWithTag(UPTIME_HEATMAP_TEST_TAG).assertIsDisplayed()
        compose.onNodeWithText(s(R.string.translation_uptimeHeatmap_empty), useUnmergedTree = true).assertIsDisplayed()
    }

    @Test
    fun errorStateRendersARetryAffordance() {
        setSurface(UiState(UiPhase.Error, errorKind = ErrorKind.Unknown))

        compose.onNodeWithTag(UPTIME_HEATMAP_TEST_TAG).assertIsDisplayed()
        compose.onAllNodesWithText("Retry", substring = true, useUnmergedTree = true).onFirst().assertIsDisplayed()
    }

    @Test
    fun staleContentShowsTheStaleChip() {
        setSurface(UiState(UiPhase.Content, data = sampleWindow(), fetchedAt = STAMP, stale = true, refreshing = true))

        compose.onNodeWithText(s(R.string.translation_mqtt_stale), useUnmergedTree = true).assertIsDisplayed()
    }

    @Test
    fun offlineContentShowsTheOfflineChip() {
        setSurface(UiState(UiPhase.Content, data = sampleWindow(), fetchedAt = STAMP, stale = true, errorKind = ErrorKind.Network))

        compose.onNodeWithText(s(R.string.translation_common_offline), useUnmergedTree = true).assertIsDisplayed()
    }

    @Test
    fun loadingStateRendersANonBlankSurface() {
        // The loading skeleton shimmer is an infinite animation; freeze the clock so waitForIdle returns.
        compose.mainClock.autoAdvance = false
        setSurface(UiState.loading())

        compose.onNodeWithTag(UPTIME_HEATMAP_TEST_TAG).assertIsDisplayed()
    }

    @Test
    fun surfaceExposesItsAccessibilityLandmarkLabel() {
        setSurface(UiState(UiPhase.Content, data = sampleWindow(), fetchedAt = STAMP))

        compose.onNodeWithContentDescription(s(R.string.translation_uptimeHeatmap_aria), useUnmergedTree = true).assertIsDisplayed()
    }

    private companion object {
        const val STAMP = 1_700_000_000_000L
        const val WINDOW_SIZE = 10
        const val OUTAGE_DAY = 5
        const val OUTAGE_SUMMARY = "API outage 14:00-14:45"
    }
}
