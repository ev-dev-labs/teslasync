package io.teslasync.android.feature.views.summaryslide

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
import io.teslasync.shared.core.units.DistanceUnitPref
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import kotlinx.serialization.json.putJsonObject
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import java.util.Locale

/**
 * Instrumented Compose UI + accessibility verification of [SummarySlideContent] across every state the web
 * component (and the cache-then-network contract) renders: the loading skeleton chrome, the screenshot card
 * (year heading + title + vehicle + the five animated stat rows + the "Screenshot to share" prompt + the
 * brand footer), the positive-savings block, the friendly empty surface, a hard error + retry, the offline
 * cached path, and the network-offline error copy. Asserts the rendered i18n strings and the merged TalkBack
 * label on each stat row. Runs under `connectedAndroidTest` (a device/emulator); the offline gate's
 * `testReleaseUnitTest` covers the pure projection + adapter.
 */
class SummarySlideUiTest {
    @get:Rule
    val compose = createComposeRule()

    private val prefs = SummarySlideDisplayPrefs(DistanceUnitPref.KM)
    private val year = 2024

    private fun populatedJson(
        distanceKm: Double = 12_500.0,
        savings: Double = 1840.0,
    ): JsonElement =
        buildJsonObject {
            put("year", 2024)
            putJsonObject("vehicle") {
                put("display_name", "Bluebird")
                put("model", "Model 3")
            }
            put("total_drives", 412.0)
            put("total_distance_km", distanceKm)
            put("total_energy_kwh", 2980.0)
            put("total_charge_sessions", 96.0)
            put("co2_offset_kg", 1320.0)
            put("gas_savings", savings)
        }

    private fun setContent(
        state: UiState<JsonElement>,
        onRetry: () -> Unit = {},
    ) {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                Host {
                    SummarySlideContent(
                        state = state,
                        prefs = prefs,
                        year = year,
                        onRetry = onRetry,
                        locale = Locale.US,
                    )
                }
            }
        }
    }

    @Test
    fun loadingShowsAccessibleSkeletonChrome() {
        setContent(UiState(UiPhase.Loading))
        compose.onNodeWithText("Building your year in review...").assertIsDisplayed()
    }

    @Test
    fun contentShowsYearTitleAndVehicle() {
        setContent(UiState(UiPhase.Content, data = populatedJson(), fetchedAt = NOW))
        compose.onNodeWithText("2024").assertIsDisplayed()
        compose.onNodeWithText("Year in Review").assertIsDisplayed()
        compose.onNodeWithText("Bluebird").assertIsDisplayed()
        compose.onNodeWithText("Model 3").assertIsDisplayed()
    }

    @Test
    fun contentExposesEachStatAsAnAccessibleRow() {
        setContent(UiState(UiPhase.Content, data = populatedJson(), fetchedAt = NOW))
        // Each row merges into one TalkBack node labelled "{value} {label}" (12,500 km in the metric pref).
        compose.onNodeWithContentDescription("412 Drives").assertIsDisplayed()
        compose.onNodeWithContentDescription("12,500 km").assertIsDisplayed()
        compose.onNodeWithContentDescription("2,980 kWh").assertIsDisplayed()
        compose.onNodeWithContentDescription("96 Charges").assertIsDisplayed()
        compose.onNodeWithContentDescription("1,320 kg CO\u2082 saved").assertIsDisplayed()
    }

    @Test
    fun contentShowsScreenshotPromptAndBrandFooter() {
        setContent(UiState(UiPhase.Content, data = populatedJson(), fetchedAt = NOW))
        compose.onNodeWithText("\uD83D\uDCF8 Screenshot to share your year!").assertIsDisplayed()
        compose.onNodeWithText("TeslaSync \u2022 Year in Review").assertIsDisplayed()
    }

    @Test
    fun contentShowsSavingsWhenPositive() {
        setContent(UiState(UiPhase.Content, data = populatedJson(savings = 1840.0), fetchedAt = NOW))
        compose.onNodeWithText("Saved $1,840 vs. gas", substring = true).assertIsDisplayed()
    }

    @Test
    fun contentHidesSavingsWhenZero() {
        setContent(UiState(UiPhase.Content, data = populatedJson(savings = 0.0), fetchedAt = NOW))
        compose.onNodeWithText("vs. gas", substring = true).assertDoesNotExist()
    }

    @Test
    fun emptyShowsNoDrivingDataMessage() {
        setContent(UiState(UiPhase.Empty, data = JsonNull, fetchedAt = NOW))
        compose.onNodeWithText("No driving data for 2024").assertIsDisplayed()
    }

    @Test
    fun serverErrorShowsRetryAffordanceAndInvokesRetry() {
        var retried = false
        setContent(
            state = UiState(UiPhase.Error, errorKind = ErrorKind.Http, httpStatus = 500),
            onRetry = { retried = true },
        )
        compose.onNodeWithText("Server error").assertIsDisplayed()
        compose.onNodeWithText("Retry").performClick()
        assertTrue(retried)
    }

    @Test
    fun networkErrorShowsOfflineCopy() {
        setContent(UiState(UiPhase.Error, errorKind = ErrorKind.Network))
        compose.onNodeWithText("You're offline").assertIsDisplayed()
    }

    @Test
    fun offlineKeepsCachedContentVisible() {
        setContent(
            UiState(
                phase = UiPhase.Content,
                data = populatedJson(),
                fetchedAt = NOW,
                stale = true,
                errorKind = ErrorKind.Timeout,
            ),
        )
        // Cached values stay visible (never blanked) when offline/stale.
        compose.onNodeWithContentDescription("412 Drives").assertIsDisplayed()
    }

    @Composable
    private fun Host(content: @Composable () -> Unit) {
        Box(modifier = Modifier.size(width = HOST_WIDTH, height = HOST_HEIGHT)) { content() }
    }

    private companion object {
        const val NOW = 1_780_000_000_000L
        val HOST_WIDTH = 400.dp
        val HOST_HEIGHT = 800.dp
    }
}
