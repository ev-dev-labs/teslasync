package io.teslasync.android.dashboard.widgets.fsmdistribution

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
 * On-device Compose UI + accessibility verification of [FSMDistributionWidgetContent] across every state
 * the web component renders (loading skeleton, hard error + retry, standard donut + legend + transitions
 * feed, compact current-state hero, no-data empty, stale/offline cached). Asserts the rendered i18n strings
 * and the TalkBack content descriptions are present. Runs under `connectedAndroidTest` (a device/emulator)
 * — the offline gate's `testReleaseUnitTest` covers the logic; this covers render + a11y.
 */
class FSMDistributionWidgetUiTest {
    @get:Rule
    val compose = createComposeRule()

    private val standardSize = FSMDistributionRegistration.defaultSize
    private val compactSize = FSMDistributionSize(cols = 1, rows = 4)

    private fun setContent(
        state: UiState<FSMDistributionSnapshot>,
        size: FSMDistributionSize = standardSize,
        onRefresh: () -> Unit = {},
    ) {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                FSMDistributionWidgetContent(
                    state = state,
                    size = size,
                    onRefresh = onRefresh,
                    nowMillis = NOW,
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
    fun standardContentShowsDonutLegendAndTransitions() {
        setContent(UiState(UiPhase.Content, data = populatedSnapshot(), fetchedAt = NOW))
        // Header title (PanelTitle).
        compose.onNodeWithText("State Distribution").assertIsDisplayed()
        // Donut carries the folded a11y phrase (distinct from the title `text` node).
        compose.onNodeWithContentDescription("State Distribution:", substring = true).assertIsDisplayed()
        // Legend item folds label + percent into one phrase.
        compose.onNodeWithContentDescription("Driving 67%").assertIsDisplayed()
        // Transitions feed header + a row (the from-state "Asleep" appears only in the feed).
        compose.onNodeWithText("Recent Transitions").assertIsDisplayed()
        compose.onNodeWithContentDescription("Asleep", substring = true).assertIsDisplayed()
    }

    @Test
    fun standardContentExposesRefreshAction() {
        setContent(UiState(UiPhase.Content, data = populatedSnapshot(), fetchedAt = NOW))
        compose.onNodeWithContentDescription("Refresh").assertIsDisplayed()
    }

    @Test
    fun compactContentShowsCurrentStateHeroPhrase() {
        setContent(
            state = UiState(UiPhase.Content, data = compactSnapshot(), fetchedAt = NOW),
            size = compactSize,
        )
        // The hero folds the current state + time-in-state into one TalkBack phrase.
        compose.onNodeWithContentDescription("Driving", substring = true).assertIsDisplayed()
    }

    @Test
    fun emptyShowsNoStateDataMessage() {
        setContent(UiState(UiPhase.Empty, data = emptySnapshot(), fetchedAt = NOW))
        compose.onNodeWithText("No state data").assertIsDisplayed()
    }

    @Test
    fun offlineKeepsCachedContentVisible() {
        setContent(
            UiState(
                UiPhase.Content,
                data = populatedSnapshot(),
                fetchedAt = NOW,
                stale = true,
                errorKind = ErrorKind.Timeout,
            ),
        )
        // Cached donut stays visible (never blanked) when offline/stale.
        compose.onNodeWithContentDescription("State Distribution:", substring = true).assertIsDisplayed()
    }

    private companion object {
        const val NOW = 1_780_000_000_000L

        fun statsJson(vararg entries: Pair<String, Double>): JsonElement =
            buildJsonObject {
                put("enabled", true)
                put("stats", buildJsonObject { entries.forEach { (state, ms) -> put(state, ms) } })
            }

        fun transitionsJson(rows: List<Triple<Long, String, String>>): JsonElement =
            buildJsonObject {
                put(
                    "data",
                    buildJsonArray {
                        rows.forEach { (id, from, to) ->
                            add(
                                buildJsonObject {
                                    put("id", id)
                                    put("from_state", from)
                                    put("to_state", to)
                                    put("ts", "")
                                },
                            )
                        }
                    },
                )
                put("total", rows.size)
                put("page", 1)
                put("per_page", 5)
            }

        fun populatedSnapshot(): FSMDistributionSnapshot =
            FSMDistributionSnapshot(
                stats = statsJson("driving" to 1_000.0, "charging" to 500.0),
                transitions = transitionsJson(listOf(Triple(7L, "asleep", "driving"))),
            )

        fun compactSnapshot(): FSMDistributionSnapshot =
            FSMDistributionSnapshot(
                stats = statsJson("driving" to 300_000.0),
                transitions = transitionsJson(emptyList()),
            )

        fun emptySnapshot(): FSMDistributionSnapshot =
            FSMDistributionSnapshot(
                stats = statsJson("idle" to 0.0),
                transitions = transitionsJson(emptyList()),
            )
    }
}
