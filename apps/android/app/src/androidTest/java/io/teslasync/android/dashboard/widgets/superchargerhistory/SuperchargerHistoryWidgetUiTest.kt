package io.teslasync.android.dashboard.widgets.superchargerhistory

import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import io.teslasync.android.ui.theme.TeslaSyncTheme
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.add
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import java.util.Locale

/**
 * On-device Compose UI + accessibility verification of [SuperchargerHistoryWidgetContent] across every
 * state the web component renders (loading skeleton, hard error + retry, standard ranked session list +
 * totals row, compact 30-day-spend hero, no-data empty, stale/offline cached). Asserts the rendered i18n
 * strings and the TalkBack content descriptions are present. Runs under `connectedAndroidTest` (a
 * device/emulator) — the offline gate's `testReleaseUnitTest` covers the logic; this covers render + a11y.
 */
class SuperchargerHistoryWidgetUiTest {
    @get:Rule
    val compose = createComposeRule()

    private val prefs = SuperchargerHistoryDisplayPrefs.METRIC_DEFAULT
    private val standardSize = SuperchargerHistoryRegistration.defaultSize
    private val compactSize = SuperchargerHistorySize(cols = 1, rows = 4)

    private fun historyJson(sessions: Int): JsonElement =
        buildJsonObject {
            put(
                "entries",
                buildJsonArray {
                    if (sessions >= 1) {
                        add(session(1, "Kettleman", "2025-03-02T00:00:00Z", 50000.0, 18.0))
                    }
                    if (sessions >= 2) {
                        add(session(2, "Mojave", "2025-03-01T00:00:00Z", 30000.0, 9.0))
                    }
                },
            )
            put(
                "summary",
                buildJsonObject {
                    put("total_sessions", sessions)
                    put("total_wh", 80000.0)
                    put("total_spend", 27.0)
                },
            )
        }

    private fun session(
        id: Long,
        site: String,
        date: String,
        usageWh: Double,
        totalDue: Double,
    ) = buildJsonObject {
        put("id", id)
        put("site_location_name", site)
        put("charge_start_datetime", date)
        put("usage_wh", usageWh)
        put("total_due", totalDue)
    }

    private fun emptyHistoryJson(): JsonElement = historyJson(sessions = 0)

    private fun populatedHistoryJson(): JsonElement = historyJson(sessions = 2)

    private fun setContent(
        state: UiState<JsonElement>,
        size: SuperchargerHistorySize = standardSize,
        onRefresh: () -> Unit = {},
    ) {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                SuperchargerHistoryWidgetContent(
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
        compose.onNodeWithText("Can't reach server").assertIsDisplayed()
        compose.onNodeWithText("Retry").performClick()
        assertTrue(retried)
    }

    @Test
    fun standardContentShowsTitleSessionsAndTotals() {
        setContent(UiState(UiPhase.Content, data = populatedHistoryJson(), fetchedAt = NOW))
        compose.onNodeWithText("Supercharger History").assertIsDisplayed()
        compose.onNodeWithText("Kettleman").assertIsDisplayed()
        compose.onNodeWithText("30-day totals").assertIsDisplayed()
        // The ranked row folds rank + site + energy (+ cost) into one TalkBack phrase (highest energy first).
        compose.onNodeWithContentDescription("1. Kettleman", substring = true).assertIsDisplayed()
    }

    @Test
    fun standardContentExposesRefreshAction() {
        setContent(UiState(UiPhase.Content, data = populatedHistoryJson(), fetchedAt = NOW))
        compose.onNodeWithContentDescription("Refresh").assertIsDisplayed()
    }

    @Test
    fun compactContentShowsSpendHeroPhrase() {
        setContent(
            state = UiState(UiPhase.Content, data = populatedHistoryJson(), fetchedAt = NOW),
            size = compactSize,
        )
        // The hero folds the 30-day spend total + label into one TalkBack phrase.
        compose.onNodeWithContentDescription("30-day Supercharger", substring = true).assertIsDisplayed()
    }

    @Test
    fun emptyShowsNoSessionsMessage() {
        setContent(UiState(UiPhase.Empty, data = emptyHistoryJson(), fetchedAt = NOW))
        compose.onNodeWithText("No Supercharger sessions").assertIsDisplayed()
    }

    @Test
    fun offlineKeepsCachedContentVisible() {
        setContent(
            UiState(
                UiPhase.Content,
                data = populatedHistoryJson(),
                fetchedAt = NOW,
                stale = true,
                errorKind = ErrorKind.Timeout,
            ),
        )
        // Cached values stay visible (never blanked) when offline/stale.
        compose.onNodeWithText("Kettleman").assertIsDisplayed()
    }

    private companion object {
        const val NOW = 1_780_000_000_000L
    }
}
