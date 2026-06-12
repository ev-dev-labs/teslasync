package io.teslasync.android.featureviews.statheroslide

import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import io.teslasync.android.components.motion.LocalReducedMotion
import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.shared.core.units.DistanceUnitPref
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import java.util.Locale

/**
 * On-device Compose UI + accessibility verification of [StatHeroSlideContent] across every state the surface
 * renders: the distance content branch (value + unit + around-the-Earth comparison), the energy branch
 * (value + "kWh charged" + home-days comparison), the unrecognised-field fallback, the loading skeleton,
 * the hard error + retry, the friendly empty state, and the stale/offline cached hero. Reduced motion is
 * forced so the staggered reveal + count-up resolve immediately (also exercising the a11y/reduced-motion
 * path). Runs under `connectedAndroidTest`; the offline gate's `testReleaseUnitTest` covers the pure
 * projection. Mirrors the web spec (web/src/features/analytics/components/review/StatHeroSlide.tsx).
 */
class StatHeroSlideUiTest {
    @get:Rule
    val compose = createComposeRule()

    private val data = StatHeroData(totalDistanceKm = 12_345.0, totalEnergyKwh = 2_890.0)

    private fun setContent(
        state: UiState<StatHeroData>,
        field: String,
        onRetry: () -> Unit = {},
    ) {
        compose.setContent {
            CompositionLocalProvider(LocalReducedMotion provides true) {
                TeslaSyncTheme(dynamicColor = false) {
                    StatHeroSlideContent(
                        state = state,
                        field = field,
                        onRetry = onRetry,
                        distanceUnit = DistanceUnitPref.KM,
                        locale = Locale.US,
                    )
                }
            }
        }
    }

    @Test
    fun distanceContentRendersValueUnitAndComparison() {
        setContent(UiState(UiPhase.Content, data = data), field = "distance")
        // 12,345 km in the user's metric preference.
        compose.onNodeWithText("12,345").assertIsDisplayed()
        compose.onNodeWithText("km").assertIsDisplayed()
        compose.onNodeWithText("around the Earth", substring = true).assertIsDisplayed()
    }

    @Test
    fun energyContentRendersValueUnitAndComparison() {
        setContent(UiState(UiPhase.Content, data = data), field = "energy")
        compose.onNodeWithText("2,890").assertIsDisplayed()
        compose.onNodeWithText("kWh charged").assertIsDisplayed()
        compose.onNodeWithText("power a home", substring = true).assertIsDisplayed()
    }

    @Test
    fun unknownFieldRendersTheFallbackValue() {
        // Web `default` branch: 📊 + 0, with no unit / comparison line.
        setContent(UiState(UiPhase.Content, data = data), field = "co2")
        compose.onNodeWithText("0").assertIsDisplayed()
    }

    @Test
    fun loadingStateExposesAccessibleSkeletonChrome() {
        setContent(UiState.loading(), field = "distance")
        compose.onNodeWithContentDescription("Loading", substring = true).assertIsDisplayed()
    }

    @Test
    fun errorStateRendersRetryAffordanceAndInvokesRetry() {
        var retried = false
        setContent(
            state = UiState(UiPhase.Error, errorKind = ErrorKind.Network),
            field = "distance",
            onRetry = { retried = true },
        )
        compose.onNodeWithText("Server error").assertIsDisplayed()
        compose.onNodeWithText("Retry").performClick()
        assertTrue(retried)
    }

    @Test
    fun emptyStateRendersAndExposesNoDataLabel() {
        setContent(UiState(UiPhase.Empty), field = "distance")
        compose.onNodeWithText("No data available").assertIsDisplayed()
        // EmptyState exposes the message as its TalkBack content description.
        compose.onNodeWithContentDescription("No data available").assertIsDisplayed()
    }

    @Test
    fun offlineKeepsCachedHeroVisibleWithFreshnessChip() {
        setContent(
            state =
                UiState(
                    UiPhase.Content,
                    data = data,
                    fetchedAt = NOW,
                    stale = true,
                    errorKind = ErrorKind.Timeout,
                ),
            field = "energy",
        )
        // Cached value stays visible (never blanked) when offline/stale, with the offline freshness chip.
        compose.onNodeWithText("2,890").assertIsDisplayed()
        compose.onNodeWithContentDescription("Offline").assertIsDisplayed()
    }

    private companion object {
        const val NOW = 1_780_000_000_000L
    }
}
