package io.teslasync.android.dashboard.widgets.vampiredrain

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.size
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.unit.dp
import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import io.teslasync.android.ui.theme.TeslaSyncTheme
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import java.time.OffsetDateTime
import java.util.Locale

/**
 * On-device Compose UI + accessibility verification of [VampireDrainWidgetContent] across every state the
 * web component renders (loading skeleton, standard content with the avg stat + event feed, the compact
 * single-stat footprint, the wide sparkline, the stats-only "No recent drain events" feed empty, the
 * "No vampire drain data" empty, the hard-error surface, and stale/offline cached). Asserts the rendered
 * i18n strings + the TalkBack content descriptions. Runs under `connectedAndroidTest`; the offline gate's
 * `testReleaseUnitTest` covers the pure logic, this covers the render + a11y. [Locale.US] + a fixed
 * `nowMillis` keep the rendered numbers + relative time deterministic.
 */
class VampireDrainWidgetUiTest {
    @get:Rule
    val compose = createComposeRule()

    private val now = OffsetDateTime.parse("2026-06-06T12:05:00Z").toInstant().toEpochMilli()

    private fun event(
        id: Long = 1,
        drainRatePctPerHour: Double = 2.5,
    ): VampireDrainEvent =
        VampireDrainEvent(
            id = id,
            startDate = "2026-06-06T12:00:00Z",
            durationHours = 2.5,
            batteryLost = 5.0,
            drainRatePctPerHour = drainRatePctPerHour,
            sentryMode = true,
        )

    private fun snapshot(
        avgDrainRate: Double = 0.1,
        eventCount: Int = 1,
    ): VampireDrainSnapshot =
        VampireDrainSnapshot(
            stats = VampireDrainStats(avgDrainRate = avgDrainRate, totalHours = 36.0, eventCount = eventCount.toLong()),
            events = (1..eventCount).map { event(id = it.toLong()) },
        )

    private fun setContent(
        state: UiState<VampireDrainSnapshot>,
        size: VampireDrainSize = VampireDrainRegistration.defaultSize,
        onRefresh: () -> Unit = {},
    ) {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                Host {
                    VampireDrainWidgetContent(
                        state = state,
                        size = size,
                        onRefresh = onRefresh,
                        nowMillis = now,
                        locale = Locale.US,
                    )
                }
            }
        }
    }

    @Test
    fun loadingShowsAccessibleSkeletonChrome() {
        setContent(UiState(UiPhase.Loading))
        compose.onNodeWithContentDescription("Vampire Drain").assertIsDisplayed()
    }

    @Test
    fun standardContentShowsTitleAvgStatAndAccessibleEventRow() {
        setContent(UiState(UiPhase.Content, data = snapshot(), fetchedAt = 1L))
        compose.onNodeWithText("Vampire Drain").assertIsDisplayed()
        compose.onNodeWithText("Avg Drain").assertIsDisplayed()
        compose.onNodeWithText("2.4%/day").assertIsDisplayed()
        // The feed row folds its title + subtitle + relative time into one TalkBack phrase.
        compose
            .onNodeWithContentDescription("5.0% \u00b7 2.5h \u00b7 Sentry, 60.0%/day, 5m ago")
            .assertIsDisplayed()
    }

    @Test
    fun standardContentShowsEventCountSublabel() {
        setContent(UiState(UiPhase.Content, data = snapshot(eventCount = 1), fetchedAt = 1L))
        compose.onNodeWithText("1 events \u00b7 36h total").assertIsDisplayed()
    }

    @Test
    fun compactFootprintShowsBigStatWithoutStatCard() {
        setContent(
            UiState(UiPhase.Content, data = snapshot(), fetchedAt = 1L),
            size = VampireDrainSize(cols = 1, rows = 2),
        )
        compose.onNodeWithText("2.4%").assertIsDisplayed()
        // Compact (1-column) footprint hides the StatCard + feed (web `isCompact` branch).
        compose.onNodeWithText("Avg Drain").assertDoesNotExist()
    }

    @Test
    fun wideFootprintShowsDailyDrainSparklineSection() {
        setContent(
            UiState(UiPhase.Content, data = snapshot(eventCount = 3), fetchedAt = 1L),
            size = VampireDrainSize(cols = 4, rows = 6),
        )
        compose.onNodeWithText("Daily drain rate (last 30)").assertIsDisplayed()
    }

    @Test
    fun statsOnlyShowsNoRecentDrainEventsFeedEmpty() {
        setContent(
            UiState(
                UiPhase.Content,
                data = VampireDrainSnapshot(stats = VampireDrainStats(0.02, 12.0, 0L), events = emptyList()),
                fetchedAt = 1L,
            ),
        )
        compose.onNodeWithText("Avg Drain").assertIsDisplayed()
        compose.onNodeWithText("No recent drain events").assertIsDisplayed()
    }

    @Test
    fun emptyShowsNoVampireDrainDataMessage() {
        setContent(UiState(UiPhase.Empty, data = VampireDrainSnapshot.EMPTY, fetchedAt = 1L))
        compose.onNodeWithText("No vampire drain data").assertIsDisplayed()
    }

    @Test
    fun hardErrorSurfacesErrorChipAndRetryAffordanceOverEmptyState() {
        var retried = false
        setContent(
            state = UiState(UiPhase.Error, errorKind = ErrorKind.Http, httpStatus = 404),
            onRefresh = { retried = true },
        )
        // Web parity: the deprecated 404 surfaces the friendly empty body + an error freshness chip, not a
        // blanking error screen. The refresh control is the retry affordance.
        compose.onNodeWithText("No vampire drain data").assertIsDisplayed()
        compose.onNodeWithContentDescription("error").assertIsDisplayed()
        compose.onNodeWithContentDescription("Refresh").performClick()
        assertTrue(retried)
    }

    @Test
    fun offlineKeepsCachedContentVisible() {
        setContent(
            UiState(
                phase = UiPhase.Content,
                data = snapshot(),
                fetchedAt = 1L,
                stale = true,
                errorKind = ErrorKind.Timeout,
            ),
        )
        // Cached avg stat stays visible (never blanked) when offline/stale.
        compose.onNodeWithText("2.4%/day").assertIsDisplayed()
    }

    @Test
    fun contentHeaderExposesRefreshAction() {
        setContent(UiState(UiPhase.Content, data = snapshot(), fetchedAt = 1L))
        compose.onNodeWithContentDescription("Refresh").assertIsDisplayed()
    }

    @Composable
    private fun Host(content: @Composable () -> Unit) {
        Box(modifier = Modifier.size(width = HOST_WIDTH, height = HOST_HEIGHT)) { content() }
    }

    private companion object {
        val HOST_WIDTH = 360.dp
        val HOST_HEIGHT = 560.dp
    }
}
