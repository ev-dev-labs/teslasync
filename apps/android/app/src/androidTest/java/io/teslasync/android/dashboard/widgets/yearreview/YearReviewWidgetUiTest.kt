package io.teslasync.android.dashboard.widgets.yearreview

import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.shared.core.units.DistanceUnitPref
import io.teslasync.shared.core.units.SpeedUnitPref
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import java.util.Locale

/**
 * On-device Compose UI + accessibility verification of [YearReviewWidgetContent] across every state the web
 * component renders (loading skeleton, hard error + retry, standard 2-up stat grid, wide 4-up grid with the
 * extra totals, compact year-distance hero, no-data empty, stale/offline cached). Asserts the rendered i18n
 * strings and the TalkBack content descriptions are present. Runs under `connectedAndroidTest` (a
 * device/emulator) — the offline gate's `testReleaseUnitTest` covers the logic; this covers render + a11y.
 */
class YearReviewWidgetUiTest {
    @get:Rule
    val compose = createComposeRule()

    private val prefs = YearReviewDisplayPrefs(DistanceUnitPref.KM, SpeedUnitPref.KMH)
    private val year = 2024
    private val standardSize = YearReviewRegistration.defaultSize
    private val compactSize = YearReviewSize(cols = 1, rows = 4)
    private val wideSize = YearReviewSize(cols = 4, rows = 4)

    private fun populatedJson(distanceKm: Double = 10000.0): JsonElement =
        buildJsonObject {
            put("total_drives", 320.0)
            put("total_distance_km", distanceKm)
            put("total_energy_kwh", 3456.7)
            put("co2_offset_kg", 1200.0)
            put("total_driving_minutes", 6000.0)
            put("fastest_speed_kmh", 200.0)
        }

    private fun setContent(
        state: UiState<JsonElement>,
        size: YearReviewSize = standardSize,
        onRefresh: () -> Unit = {},
    ) {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                YearReviewWidgetContent(
                    state = state,
                    prefs = prefs,
                    size = size,
                    year = year,
                    onRefresh = onRefresh,
                    locale = Locale.US,
                )
            }
        }
    }

    @Test
    fun loadingShowsAccessibleSkeletonChrome() {
        setContent(UiState(UiPhase.Loading))
        compose.onNodeWithContentDescription("Loading", substring = true).assertIsDisplayed()
    }

    @Test
    fun errorShowsRetryAffordanceAndInvokesRefresh() {
        var retried = false
        setContent(
            state = UiState(UiPhase.Error, errorKind = ErrorKind.Network),
            onRefresh = { retried = true },
        )
        compose.onNodeWithText("Server error").assertIsDisplayed()
        compose.onNodeWithText("Retry").performClick()
        assertTrue(retried)
    }

    @Test
    fun standardContentShowsTitleAndCoreStatTiles() {
        setContent(UiState(UiPhase.Content, data = populatedJson(), fetchedAt = NOW))
        compose.onNodeWithText("Year in Review 2024").assertIsDisplayed()
        compose.onNodeWithText("Total Miles").assertIsDisplayed()
        compose.onNodeWithText("Total Drives").assertIsDisplayed()
        compose.onNodeWithText("Energy Used").assertIsDisplayed()
        // 10,000 km == "10,000" in the user's metric preference.
        compose.onNodeWithText("10,000").assertIsDisplayed()
    }

    @Test
    fun standardContentExposesRefreshAction() {
        setContent(UiState(UiPhase.Content, data = populatedJson(), fetchedAt = NOW))
        compose.onNodeWithContentDescription("Refresh").assertIsDisplayed()
    }

    @Test
    fun wideContentFoldsInTheExtraTotals() {
        setContent(
            state = UiState(UiPhase.Content, data = populatedJson(), fetchedAt = NOW),
            size = wideSize,
        )
        compose.onNodeWithText("Driving Time").assertIsDisplayed()
        compose.onNodeWithText("Top Speed").assertIsDisplayed()
    }

    @Test
    fun compactContentShowsYearHeroPhrase() {
        setContent(
            state = UiState(UiPhase.Content, data = populatedJson(), fetchedAt = NOW),
            size = compactSize,
        )
        // The hero folds the distance + unit + "in {year}" caption into one TalkBack phrase.
        compose.onNodeWithContentDescription("in 2024", substring = true).assertIsDisplayed()
    }

    @Test
    fun emptyShowsNoYearReviewDataMessage() {
        setContent(UiState(UiPhase.Empty, data = JsonNull, fetchedAt = NOW))
        compose.onNodeWithText("No year-in-review data").assertIsDisplayed()
    }

    @Test
    fun offlineKeepsCachedContentVisible() {
        setContent(
            UiState(
                UiPhase.Content,
                data = populatedJson(),
                fetchedAt = NOW,
                stale = true,
                errorKind = ErrorKind.Timeout,
            ),
        )
        // Cached values stay visible (never blanked) when offline/stale.
        compose.onNodeWithText("10,000").assertIsDisplayed()
    }

    private companion object {
        const val NOW = 1_780_000_000_000L
    }
}
