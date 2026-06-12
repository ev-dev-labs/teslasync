package io.teslasync.android.featureviews.conditionbuilder

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
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
import io.teslasync.shared.core.presentation.locations.Geofence
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test

/**
 * On-device Compose UI + accessibility verification of [ConditionBuilderContent] across every state the web
 * component renders (loading skeleton, the "no conditions yet" empty state + Add CTA, each of the four
 * condition editors — signal / time-window / geofence / other-automation — with their localized labels,
 * the add + remove + refresh affordances, and the stale/offline cached path that keeps the builder usable).
 * Asserts the rendered i18n strings and the TalkBack content descriptions are present.
 */
class ConditionBuilderUiTest {
    @get:Rule
    val compose = createComposeRule()

    private fun geofence(
        id: Long,
        name: String,
    ): Geofence =
        Geofence(
            id = id,
            name = name,
            polygonWkt = "",
            createdAt = "2024-01-01T00:00:00Z",
            updatedAt = "2024-01-01T00:00:00Z",
        )

    private val fences = listOf(geofence(1, "Home"), geofence(2, "Work"))

    private fun setContent(
        state: UiState<List<Geofence>>,
        conditions: List<ConditionInput>,
        onChange: (List<ConditionInput>) -> Unit = {},
        onRefresh: () -> Unit = {},
    ) {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                Host {
                    ConditionBuilderContent(
                        state = state,
                        conditions = conditions,
                        onChange = onChange,
                        onRefresh = onRefresh,
                    )
                }
            }
        }
    }

    private fun content(data: List<Geofence> = fences): UiState<List<Geofence>> = UiState(UiPhase.Content, data = data, fetchedAt = NOW)

    @Test
    fun loadingShowsAccessibleSkeletonChrome() {
        setContent(UiState(UiPhase.Loading), conditions = emptyList())
        compose.onNodeWithContentDescription("Loading", substring = true).assertIsDisplayed()
    }

    @Test
    fun emptyShowsNoConditionsMessageAndAddCta() {
        setContent(content(), conditions = emptyList())
        compose.onNodeWithText("No conditions yet", substring = true).assertIsDisplayed()
        compose.onNodeWithText("Add Condition").assertIsDisplayed()
    }

    @Test
    fun signalConditionShowsAllControls() {
        setContent(content(), conditions = listOf(createDefaultCondition(ConditionKind.Signal)))
        compose.onNodeWithText("Condition Type").assertIsDisplayed()
        compose.onNodeWithText("Signal").assertIsDisplayed()
        compose.onNodeWithText("Operator").assertIsDisplayed()
        compose.onNodeWithText("Value").assertIsDisplayed()
        // TalkBack labels on the per-row remove + the header refresh.
        compose.onNodeWithContentDescription("Remove condition").assertIsDisplayed()
        compose.onNodeWithContentDescription("Refresh").assertIsDisplayed()
    }

    @Test
    fun timeWindowConditionShowsTimeFieldsTimezoneAndDays() {
        setContent(content(), conditions = listOf(createDefaultCondition(ConditionKind.TimeWindow)))
        compose.onNodeWithText("Start").assertIsDisplayed()
        compose.onNodeWithText("End").assertIsDisplayed()
        compose.onNodeWithText("Timezone").assertIsDisplayed()
        compose.onNodeWithText("Days").assertIsDisplayed()
        // The 7-day toggle row renders localized day labels.
        compose.onNodeWithText("Mon").assertIsDisplayed()
        compose.onNodeWithText("Sun").assertIsDisplayed()
    }

    @Test
    fun geofenceConditionShowsGeofenceAndStateSelects() {
        setContent(content(), conditions = listOf(createDefaultCondition(ConditionKind.Geofence)))
        compose.onNodeWithText("Geofence").assertIsDisplayed()
        compose.onNodeWithText("State").assertIsDisplayed()
        // No fence is chosen by default, so the dropdown shows the sentinel option.
        compose.onNodeWithText("Select geofence...").assertIsDisplayed()
    }

    @Test
    fun otherAutomationConditionShowsIdAndState() {
        setContent(content(), conditions = listOf(createDefaultCondition(ConditionKind.OtherAutomation)))
        compose.onNodeWithText("Automation ID").assertIsDisplayed()
        compose.onNodeWithText("State").assertIsDisplayed()
    }

    @Test
    fun addConditionFromEmptyInvokesCallback() {
        var next: List<ConditionInput>? = null
        setContent(content(), conditions = emptyList(), onChange = { next = it })
        compose.onNodeWithText("Add Condition").performClick()
        assertEquals(1, next?.size)
        assertTrue(next?.first() is ConditionInput.Signal)
    }

    @Test
    fun removeConditionInvokesCallback() {
        var next: List<ConditionInput>? = null
        setContent(content(), conditions = listOf(createDefaultCondition(ConditionKind.Signal)), onChange = { next = it })
        compose.onNodeWithContentDescription("Remove condition").performClick()
        assertEquals(emptyList<ConditionInput>(), next)
    }

    @Test
    fun refreshAffordanceInvokesCallback() {
        var refreshed = false
        setContent(content(), conditions = listOf(createDefaultCondition(ConditionKind.Signal)), onRefresh = { refreshed = true })
        compose.onNodeWithContentDescription("Refresh").performClick()
        assertTrue(refreshed)
    }

    @Test
    fun offlineKeepsBuilderUsable() {
        setContent(
            state =
                UiState(
                    phase = UiPhase.Content,
                    data = fences,
                    fetchedAt = NOW,
                    stale = true,
                    errorKind = ErrorKind.Timeout,
                ),
            conditions = listOf(createDefaultCondition(ConditionKind.Signal)),
        )
        // The builder stays fully usable (never blanked) when the geofence feed is stale/offline.
        compose.onNodeWithText("Condition Type").assertIsDisplayed()
        compose.onNodeWithContentDescription("Refresh").assertIsDisplayed()
    }

    @Composable
    private fun Host(content: @Composable () -> Unit) {
        Box(modifier = Modifier.size(width = HOST_WIDTH, height = HOST_HEIGHT).verticalScroll(rememberScrollState())) { content() }
    }

    private companion object {
        const val NOW = 1_780_000_000_000L
        val HOST_WIDTH = 380.dp
        val HOST_HEIGHT = 900.dp
    }
}
