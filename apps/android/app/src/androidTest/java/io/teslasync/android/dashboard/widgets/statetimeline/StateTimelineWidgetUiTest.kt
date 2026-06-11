package io.teslasync.android.dashboard.widgets.statetimeline

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
 * On-device Compose UI + accessibility verification of [StateTimelineWidgetContent] across every state the
 * web component renders (loading skeleton, hard error + retry, standard stacked bar + state rows, wide 24h
 * stripe, compact legend, no-data empty, stale/offline cached). Asserts the rendered i18n strings and the
 * TalkBack content descriptions are present. Runs under `connectedAndroidTest` (a device/emulator) — the
 * offline gate's `testReleaseUnitTest` covers the logic; this covers render + a11y.
 */
class StateTimelineWidgetUiTest {
    @get:Rule
    val compose = createComposeRule()

    private val standardSize = StateTimelineRegistration.defaultSize
    private val compactSize = StateTimelineSize(cols = 1, rows = 4)
    private val wideSize = StateTimelineSize(cols = 3, rows = 4)

    private fun setContent(
        state: UiState<StateTimelineSnapshot>,
        size: StateTimelineSize = standardSize,
        onRefresh: () -> Unit = {},
    ) {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                StateTimelineWidgetContent(
                    state = state,
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
    fun standardContentShowsBarTitleAndStateRow() {
        setContent(UiState(UiPhase.Content, data = populatedSnapshot(), fetchedAt = NOW))
        // Header title (PanelTitle) — a text node, distinct from the bar's a11y phrase.
        compose.onNodeWithText("State Timeline").assertIsDisplayed()
        // Stacked bar carries the folded a11y phrase.
        compose.onNodeWithContentDescription("State Timeline:", substring = true).assertIsDisplayed()
        // A state row folds label + duration + percent into one phrase (comma after the label is row-only).
        compose.onNodeWithContentDescription("Driving, ", substring = true).assertIsDisplayed()
    }

    @Test
    fun standardContentExposesRefreshAction() {
        setContent(UiState(UiPhase.Content, data = populatedSnapshot(), fetchedAt = NOW))
        compose.onNodeWithContentDescription("Refresh").assertIsDisplayed()
    }

    @Test
    fun wideContentShowsTimelineStripe() {
        setContent(
            state = UiState(UiPhase.Content, data = populatedSnapshot(), fetchedAt = NOW),
            size = wideSize,
        )
        // The wide-only stripe carries its folded a11y phrase; the caption renders the localized label.
        compose.onNodeWithText("24h Timeline").assertIsDisplayed()
        compose.onNodeWithContentDescription("24h Timeline:", substring = true).assertIsDisplayed()
    }

    @Test
    fun compactContentShowsLegendItem() {
        setContent(
            state = UiState(UiPhase.Content, data = populatedSnapshot(), fetchedAt = NOW),
            size = compactSize,
        )
        // Compact legend uses integer percent ("70%"), distinct from the bar's one-decimal a11y ("70.0%").
        compose.onNodeWithContentDescription("Driving 70%").assertIsDisplayed()
    }

    @Test
    fun emptyShowsNoStateDataMessage() {
        setContent(UiState(UiPhase.Empty, data = emptySnapshot(), fetchedAt = NOW))
        compose.onNodeWithText("No state data available").assertIsDisplayed()
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
        // Cached bar stays visible (never blanked) when offline/stale.
        compose.onNodeWithContentDescription("State Timeline:", substring = true).assertIsDisplayed()
    }

    private companion object {
        const val NOW = 1_780_000_000_000L

        fun summaryJson(vararg entries: Pair<String, Double>): JsonElement =
            buildJsonArray {
                entries.forEach { (state, totalMin) ->
                    add(
                        buildJsonObject {
                            put("state", state)
                            put("totalMin", totalMin)
                            put("count", 1L)
                        },
                    )
                }
            }

        fun timelineJson(rows: List<Pair<String, Double>>): JsonElement =
            buildJsonArray {
                rows.forEach { (state, durationMin) ->
                    add(
                        buildJsonObject {
                            put("state", state)
                            put("startDate", "")
                            put("durationMin", durationMin)
                        },
                    )
                }
            }

        fun populatedSnapshot(): StateTimelineSnapshot =
            StateTimelineSnapshot(
                summary = summaryJson("driving" to 70.0, "charging" to 30.0),
                timeline = timelineJson(listOf("driving" to 120.0, "charging" to 60.0)),
            )

        fun emptySnapshot(): StateTimelineSnapshot =
            StateTimelineSnapshot(
                summary = summaryJson("idle" to 0.0),
                timeline = timelineJson(emptyList()),
            )
    }
}
