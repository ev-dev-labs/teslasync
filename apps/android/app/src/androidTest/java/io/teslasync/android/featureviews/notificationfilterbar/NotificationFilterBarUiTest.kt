package io.teslasync.android.featureviews.notificationfilterbar

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.test.assertCountEquals
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.unit.dp
import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.shared.core.data.repo.NotificationFilters
import io.teslasync.shared.core.presentation.notifications.AlertRule
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test

/**
 * On-device Compose UI + accessibility verification of [NotificationFilterBarContent] across every state the
 * web component renders (loading skeleton; the populated controls with their localized severity / vehicle /
 * rule / search labels; the active-filter chips + remove + clear-all affordances; the stale/offline cached
 * path that keeps the bar usable). Asserts the rendered i18n strings and the TalkBack content descriptions
 * are present, and that the controlled callbacks fire.
 */
class NotificationFilterBarUiTest {
    @get:Rule
    val compose = createComposeRule()

    private val vehicles = listOf(VehicleChoice(1, "Model 3"), VehicleChoice(2, "Model Y"))
    private val rules = listOf(AlertRule(id = 7, name = "Low Battery"), AlertRule(id = 9, name = "Sentry Triggered"))

    private fun content(data: List<AlertRule> = rules): UiState<List<AlertRule>> = UiState(UiPhase.Content, data = data, fetchedAt = NOW)

    private fun setContent(
        state: UiState<List<AlertRule>>,
        filters: NotificationFilters,
        onChange: (NotificationFilters) -> Unit = {},
        onRefresh: () -> Unit = {},
    ) {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                Host {
                    NotificationFilterBarContent(
                        state = state,
                        filters = filters,
                        onChange = onChange,
                        vehicles = vehicles,
                        onRefresh = onRefresh,
                    )
                }
            }
        }
    }

    @Test
    fun loadingShowsAccessibleSkeletonChrome() {
        setContent(UiState(UiPhase.Loading), filters = NotificationFilters())
        compose.onNodeWithContentDescription("Loading", substring = true).assertIsDisplayed()
    }

    @Test
    fun controlsRenderWithLocalizedLabels() {
        setContent(content(), filters = NotificationFilters())
        // Severity chips (multi-select).
        compose.onNodeWithText("Info").assertIsDisplayed()
        compose.onNodeWithText("Warn").assertIsDisplayed()
        compose.onNodeWithText("Critical").assertIsDisplayed()
        // Vehicle + Rule dropdowns show their labels and the "All …" sentinels when nothing is chosen.
        compose.onNodeWithText("Vehicle").assertIsDisplayed()
        compose.onNodeWithText("Rule").assertIsDisplayed()
        compose.onNodeWithText("All vehicles").assertIsDisplayed()
        compose.onNodeWithText("All rules").assertIsDisplayed()
        // Search field + refresh affordance.
        compose.onNodeWithText("Search messages", substring = true).assertIsDisplayed()
        compose.onNodeWithContentDescription("Refresh").assertIsDisplayed()
    }

    @Test
    fun severityToggleInvokesCallback() {
        var next: NotificationFilters? = null
        setContent(content(), filters = NotificationFilters(), onChange = { next = it })
        compose.onNodeWithText("Info").performClick()
        assertEquals(listOf("info"), next?.severity)
    }

    @Test
    fun activeChipsRenderWhenFiltersSet() {
        setContent(content(), filters = NotificationFilters(severity = listOf("info"), q = "bolt"))
        compose.onNodeWithText("Severity: Info").assertIsDisplayed()
        compose.onNodeWithText("Search: bolt").assertIsDisplayed()
        compose.onNodeWithText("Clear all").assertIsDisplayed()
    }

    @Test
    fun noActiveChipsWhenNoFiltersSelected() {
        setContent(content(), filters = NotificationFilters())
        // With nothing selected the active-filter row (and its Clear-all) renders nothing — never a blank box.
        compose.onAllNodesWithText("Clear all").assertCountEquals(0)
    }

    @Test
    fun removeChipInvokesCallback() {
        var next: NotificationFilters? = null
        setContent(content(), filters = NotificationFilters(q = "bolt"), onChange = { next = it })
        compose.onNodeWithContentDescription("Remove Search").performClick()
        assertNull(next?.q)
    }

    @Test
    fun clearAllInvokesCallback() {
        var next: NotificationFilters? = null
        setContent(content(), filters = NotificationFilters(severity = listOf("info")), onChange = { next = it })
        compose.onNodeWithText("Clear all").performClick()
        assertNull(next?.severity)
    }

    @Test
    fun offlineKeepsBarUsable() {
        setContent(
            state =
                UiState(
                    phase = UiPhase.Content,
                    data = rules,
                    fetchedAt = NOW,
                    stale = true,
                    errorKind = ErrorKind.Timeout,
                ),
            filters = NotificationFilters(),
        )
        // The bar stays fully usable (never blanked) when the rule feed is stale/offline.
        compose.onNodeWithText("All vehicles").assertIsDisplayed()
        compose.onNodeWithText("Info").assertIsDisplayed()
        compose.onNodeWithContentDescription("Refresh").assertIsDisplayed()
    }

    @Test
    fun refreshAffordanceInvokesCallback() {
        var refreshed = false
        setContent(content(), filters = NotificationFilters(), onRefresh = { refreshed = true })
        compose.onNodeWithContentDescription("Refresh").performClick()
        assertTrue(refreshed)
    }

    @Composable
    private fun Host(content: @Composable () -> Unit) {
        Box(modifier = Modifier.size(width = HOST_WIDTH, height = HOST_HEIGHT).verticalScroll(rememberScrollState())) { content() }
    }

    private companion object {
        const val NOW = 1_780_000_000_000L
        val HOST_WIDTH = 380.dp
        val HOST_HEIGHT = 1_200.dp
    }
}
