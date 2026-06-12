package io.teslasync.android.featureviews.livestateindicators

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.width
import androidx.compose.ui.Modifier
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.test.platform.app.InstrumentationRegistry
import io.teslasync.android.R
import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import io.teslasync.android.ui.theme.TeslaSyncTheme
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test

/**
 * Instrumented Compose UI + accessibility verification of [LiveStateIndicatorsContent] across every state the
 * surface renders (web/src/features/vehicles/components/vehicle-detail/LiveStateIndicators.tsx): the resolved badge
 * row for a moving+secured vehicle and for a parked+charging one, the loading shimmer (no badge labels), the empty
 * state (which exposes its message as an accessibility label), the hard-error retry surface (web `QueryError`), the
 * stale auto-refresh, and the offline cached-badges branch. Every asserted label is resolved from the app's i18n
 * resources so the test follows the device locale rather than hard-coding English; the Speed figure uses the metric
 * `LiveStateDisplayPrefs.DEFAULT` (en-US prefs locale) so "97 km/h" is deterministic. The clock auto-advance is
 * disabled so the Skeleton/freshness loops cannot stall `waitForIdle`. Runs under `connectedAndroidTest`; the offline
 * `testReleaseUnitTest` gate covers the pure projection.
 */
class LiveStateIndicatorsUiTest {
    @get:Rule
    val compose = createComposeRule()

    private val context get() = InstrumentationRegistry.getInstrumentation().targetContext

    private fun string(id: Int) = context.getString(id)

    private fun setContent(
        state: UiState<VehicleStateLive>,
        onRetry: () -> Unit = {},
    ) {
        compose.mainClock.autoAdvance = false
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                Box(modifier = Modifier.width(HOST_WIDTH)) {
                    LiveStateIndicatorsContent(
                        state = state,
                        onRetry = onRetry,
                        prefs = LiveStateDisplayPrefs.DEFAULT,
                    )
                }
            }
        }
        compose.mainClock.advanceTimeBy(SETTLE_MS)
    }

    @Test
    fun drivingContentShowsEveryBadgeIncludingTheFormattedSpeed() {
        setContent(LiveStateIndicatorsProjection.projectUiState(DRIVING))

        // Speed badge: localized label + the metric-formatted whole-unit figure (27 m/s -> 97 km/h).
        compose.onNodeWithText("${string(R.string.translation_common_speed)}: 97 km/h").assertIsDisplayed()
        compose.onNodeWithText(string(R.string.translation_common_locked)).assertIsDisplayed()
        compose
            .onNodeWithText(
                "${string(R.string.translation_common_sentry)}: ${string(R.string.translation_common_active)}",
            ).assertIsDisplayed()
        compose
            .onNodeWithText(
                "${string(R.string.translation_common_climate)}: ${string(R.string.translation_common_on)}",
            ).assertIsDisplayed()
        compose.onNodeWithText(string(R.string.translation_common_notCharging)).assertIsDisplayed()
    }

    @Test
    fun parkedContentShowsTheComplementaryBadges() {
        setContent(LiveStateIndicatorsProjection.projectUiState(PARKED))

        compose.onNodeWithText("${string(R.string.translation_common_speed)}: 0 km/h").assertIsDisplayed()
        compose.onNodeWithText(string(R.string.translation_common_unlocked)).assertIsDisplayed()
        compose
            .onNodeWithText(
                "${string(R.string.translation_common_sentry)}: ${string(R.string.translation_common_off)}",
            ).assertIsDisplayed()
        compose.onNodeWithText(string(R.string.translation_common_charging)).assertIsDisplayed()
    }

    @Test
    fun emptyShowsTheNoDataMessageAsTextAndAccessibilityLabel() {
        setContent(LiveStateIndicatorsProjection.projectUiState(snapshot = null))

        val noData = string(R.string.translation_common_noData)
        compose.onNodeWithText(noData).assertIsDisplayed()
        compose.onNodeWithContentDescription(noData).assertIsDisplayed()
        // No badge label leaks into the empty state.
        compose.onNodeWithText(string(R.string.translation_common_locked)).assertDoesNotExist()
    }

    @Test
    fun loadingShowsTheShimmerWithoutAnyBadgeLabels() {
        setContent(UiState.loading())

        compose.onNodeWithText(string(R.string.translation_common_locked)).assertDoesNotExist()
        compose.onNodeWithText(string(R.string.translation_common_unlocked)).assertDoesNotExist()
        compose.onNodeWithText(string(R.string.translation_common_charging)).assertDoesNotExist()
    }

    @Test
    fun errorShowsRetryAndInvokesTheCallbackOnTap() {
        var retries = 0
        setContent(UiState(phase = UiPhase.Error, errorKind = ErrorKind.Network), onRetry = { retries++ })

        val retryLabel = string(R.string.translation_common_retry)
        compose.onNodeWithText(string(R.string.translation_error_serverError_title)).assertIsDisplayed()
        compose.onNodeWithText(retryLabel).assertIsDisplayed()

        compose.onNodeWithText(retryLabel).performClick()
        assertTrue(retries >= 1)
    }

    @Test
    fun staleContentKeepsCachedBadgesAndAutoRefreshes() {
        var retries = 0
        setContent(
            UiState(phase = UiPhase.Content, data = DRIVING, stale = true),
            onRetry = { retries++ },
        )

        // Cached badges stay visible (web "last known"); the stale branch auto-refreshes via the host's refetch.
        compose.onNodeWithText(string(R.string.translation_common_locked)).assertIsDisplayed()
        assertTrue(retries >= 1)
    }

    @Test
    fun offlineContentKeepsCachedBadgesWithoutHammeringRetry() {
        var retries = 0
        setContent(
            UiState(phase = UiPhase.Content, data = DRIVING, stale = true, errorKind = ErrorKind.Network),
            onRetry = { retries++ },
        )

        // Offline (failed refresh over cache) shows the cached badges and does NOT auto-retry into the failure.
        compose.onNodeWithText(string(R.string.translation_common_locked)).assertIsDisplayed()
        assertEquals(0, retries)
    }

    private companion object {
        val HOST_WIDTH: Dp = 360.dp
        const val SETTLE_MS = 2_000L

        val DRIVING =
            VehicleStateLive(
                speedMps = 27.0,
                isLocked = true,
                sentryMode = true,
                isClimateOn = true,
                isCharging = false,
            )

        val PARKED =
            VehicleStateLive(
                speedMps = 0.0,
                isLocked = false,
                sentryMode = false,
                isClimateOn = false,
                isCharging = true,
            )
    }
}
