package io.teslasync.android.dashboard.widgets.lifetimestats

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
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import java.util.Locale

/**
 * On-device Compose UI + accessibility verification of [LifetimeStatsWidgetContent] across every state
 * the web component renders (loading skeleton, hard error + retry, standard 2-up stat grid, wide 4-up
 * grid with the extra totals, compact lifetime-distance hero, no-data empty, stale/offline cached).
 * Asserts the rendered i18n strings and the TalkBack content descriptions are present. Runs under
 * `connectedAndroidTest` (a device/emulator) — the offline gate's `testReleaseUnitTest` covers the
 * logic; this covers render + a11y.
 */
class LifetimeStatsWidgetUiTest {
    @get:Rule
    val compose = createComposeRule()

    private val prefs = LifetimeStatsDisplayPrefs(DistanceUnitPref.KM, "$", 2)
    private val standardSize = LifetimeStatsRegistration.defaultSize
    private val compactSize = LifetimeStatsSize(cols = 1, rows = 2)
    private val wideSize = LifetimeStatsSize(cols = 4, rows = 2)

    private fun lifetimeJson(distanceKm: Double): JsonElement =
        buildJsonObject {
            put("total_distance_km", distanceKm)
            put("total_drives", 1234.0)
            put("total_energy_kwh", 3456.7)
            put("co2_offset_kg", 1200.0)
            put("total_charging_cost", 567.89)
            put("ownership_days", 100.0)
        }

    private fun populatedJson(): JsonElement = lifetimeJson(10000.0)

    private fun emptyJson(): JsonElement =
        buildJsonObject {
            put("total_distance_km", 0.0)
            put("total_drives", 0.0)
            put("total_energy_kwh", 0.0)
            put("ownership_days", 0.0)
        }

    private fun setContent(
        state: UiState<JsonElement>,
        size: LifetimeStatsSize = standardSize,
        onRefresh: () -> Unit = {},
    ) {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                LifetimeStatsWidgetContent(
                    state = state,
                    prefs = prefs,
                    size = size,
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
    fun standardContentShowsCoreStatTiles() {
        setContent(UiState(UiPhase.Content, data = populatedJson(), fetchedAt = NOW))
        compose.onNodeWithText("Lifetime Stats").assertIsDisplayed()
        compose.onNodeWithText("Total Distance").assertIsDisplayed()
        compose.onNodeWithText("Total Drives").assertIsDisplayed()
        compose.onNodeWithText("Total Energy").assertIsDisplayed()
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
        compose.onNodeWithText("Total Cost").assertIsDisplayed()
        compose.onNodeWithText("Ownership Days").assertIsDisplayed()
        compose.onNodeWithText("Avg Daily Distance").assertIsDisplayed()
    }

    @Test
    fun compactContentShowsLifetimeHeroPhrase() {
        setContent(
            state = UiState(UiPhase.Content, data = populatedJson(), fetchedAt = NOW),
            size = compactSize,
        )
        // The hero folds the distance + unit + "lifetime" caption into one TalkBack phrase.
        compose.onNodeWithContentDescription("lifetime", substring = true).assertIsDisplayed()
    }

    @Test
    fun emptyShowsNoLifetimeDataMessage() {
        setContent(UiState(UiPhase.Empty, data = emptyJson(), fetchedAt = NOW))
        compose.onNodeWithText("No lifetime data").assertIsDisplayed()
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
