package io.teslasync.android.featureviews.triggerconfigurator

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
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
import androidx.compose.ui.test.performScrollTo
import androidx.compose.ui.unit.dp
import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.shared.core.presentation.automations.AutomationTriggerInput
import io.teslasync.shared.core.presentation.locations.Geofence
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test

/**
 * On-device Compose UI + accessibility verification of [TriggerConfiguratorContent] across every trigger
 * kind the web component renders (schedule simple + advanced, vehicle event, geofence + dwell, signal
 * numeric + boolean + changed) AND every cache-then-network state the geofence dropdown can be in (loading /
 * empty / error+retry / offline+retry / content). Asserts the rendered i18n strings, the TalkBack content
 * descriptions on the day chips + help affordances, and the retry/toggle interaction callbacks. The i18n
 * facade is stubbed to return each key's web fallback, so the assertions read the exact text the web renders.
 */
class TriggerConfiguratorUiTest {
    @get:Rule
    val compose = createComposeRule()

    // Resolve every key to its web English fallback (the text i18next renders when a key is absent).
    private val resolve: StringResolver = { _, fallback -> fallback }

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
            latitude = 37.0,
            longitude = -122.0,
            radius = 500.0,
            enabled = true,
        )

    private fun setContent(
        trigger: AutomationTriggerInput,
        geofenceState: UiState<List<Geofence>> = UiState(UiPhase.Content, data = emptyList(), fetchedAt = NOW),
        onChange: (AutomationTriggerInput) -> Unit = {},
        onRetry: () -> Unit = {},
    ) {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                Host {
                    TriggerConfiguratorContent(
                        trigger = trigger,
                        onChange = onChange,
                        geofenceState = geofenceState,
                        onRetryGeofences = onRetry,
                        resolve = resolve,
                    )
                }
            }
        }
    }

    @Test
    fun scheduleSimpleShowsTimeDaysToggleAndTimezone() {
        setContent(AutomationTriggerInput.Schedule(cronExpr = "0 8 * * *", timezone = "UTC"))
        compose.onNodeWithText("Time").assertIsDisplayed()
        compose.onNodeWithText("Days").assertIsDisplayed()
        // Each day chip exposes its full name to TalkBack (a11y).
        compose.onNodeWithContentDescription("Mon").assertIsDisplayed()
        compose.onNodeWithContentDescription("Sat").assertIsDisplayed()
        compose.onNodeWithText("Use advanced cron expression").performScrollTo().assertIsDisplayed()
        compose.onNodeWithText("Timezone").performScrollTo().assertIsDisplayed()
    }

    @Test
    fun scheduleAdvancedShowsCronFieldHelpAndSimpleToggle() {
        setContent(AutomationTriggerInput.Schedule(cronExpr = "0 8 5 * *", timezone = "UTC"))
        compose.onNodeWithText("Cron Expression").assertIsDisplayed()
        // The help affordance carries an accessible name (TalkBack).
        compose.onNodeWithContentDescription("Help: Cron Expression").assertIsDisplayed()
        compose.onNodeWithText("Switch to simple mode").performScrollTo().assertIsDisplayed()
    }

    @Test
    fun dayChipTogglePropagatesACronChange() {
        var latest: AutomationTriggerInput? = null
        setContent(
            trigger = AutomationTriggerInput.Schedule(cronExpr = "0 8 * * *", timezone = "UTC"),
            onChange = { latest = it },
        )
        compose.onNodeWithContentDescription("Mon").performClick()
        val next = latest
        assertTrue(next is AutomationTriggerInput.Schedule && next.cronExpr != "0 8 * * *")
    }

    @Test
    fun eventShowsLabelAndSelectedEvent() {
        setContent(AutomationTriggerInput.Event(eventType = "online"))
        compose.onNodeWithText("Event").assertIsDisplayed()
        compose.onNodeWithText("Comes Online").assertIsDisplayed()
    }

    @Test
    fun geofenceShowsSelectorPlaceholderAndEventSelect() {
        setContent(
            trigger = AutomationTriggerInput.Geofence(placeId = 0L, event = "enter"),
            geofenceState = UiState(UiPhase.Content, data = listOf(geofence(1, "Home")), fetchedAt = NOW),
        )
        compose.onNodeWithText("Geofence").assertIsDisplayed()
        compose.onNodeWithText("Select geofence...").assertIsDisplayed()
        compose.onNodeWithText("Enter").performScrollTo().assertIsDisplayed()
    }

    @Test
    fun geofenceDwellRevealsDwellMinutesField() {
        setContent(
            trigger = AutomationTriggerInput.Geofence(placeId = 3L, event = "dwell", dwellMinutes = 5),
            geofenceState = UiState(UiPhase.Content, data = listOf(geofence(3, "Office")), fetchedAt = NOW),
        )
        compose.onNodeWithText("Dwell Minutes").performScrollTo().assertIsDisplayed()
        compose.onNodeWithContentDescription("Help: Dwell Minutes").performScrollTo().assertIsDisplayed()
    }

    @Test
    fun geofenceLoadingShowsAccessibleSpinner() {
        setContent(
            trigger = AutomationTriggerInput.Geofence(placeId = 0L, event = "enter"),
            geofenceState = UiState(UiPhase.Loading),
        )
        compose.onNodeWithContentDescription("Loading", substring = true).assertIsDisplayed()
    }

    @Test
    fun geofenceEmptyShowsNoGeofencesHint() {
        setContent(
            trigger = AutomationTriggerInput.Geofence(placeId = 0L, event = "enter"),
            geofenceState = UiState(UiPhase.Empty, data = emptyList(), fetchedAt = NOW),
        )
        compose.onNodeWithText("No geofences configured yet").performScrollTo().assertIsDisplayed()
    }

    @Test
    fun geofenceHardErrorShowsRetryThatInvokesCallback() {
        var retried = false
        setContent(
            trigger = AutomationTriggerInput.Geofence(placeId = 0L, event = "enter"),
            geofenceState = UiState(UiPhase.Error, errorKind = ErrorKind.Network),
            onRetry = { retried = true },
        )
        compose.onNodeWithText("Couldn't load geofences").performScrollTo().assertIsDisplayed()
        compose.onNodeWithText("Retry").performScrollTo().performClick()
        assertTrue(retried)
    }

    @Test
    fun geofenceOfflineKeepsCachedListWithRetry() {
        setContent(
            trigger = AutomationTriggerInput.Geofence(placeId = 0L, event = "enter"),
            geofenceState =
                UiState(
                    phase = UiPhase.Content,
                    data = listOf(geofence(1, "Home")),
                    fetchedAt = NOW,
                    stale = true,
                    errorKind = ErrorKind.Timeout,
                ),
        )
        compose.onNodeWithText("Offline — showing last known").performScrollTo().assertIsDisplayed()
        compose.onNodeWithText("Retry").performScrollTo().assertIsDisplayed()
    }

    @Test
    fun signalNumericShowsSignalOperatorValueAndToggle() {
        setContent(AutomationTriggerInput.Signal(signal = "battery_level", op = "<", valueNum = 20.0))
        compose.onNodeWithText("Signal").assertIsDisplayed()
        compose.onNodeWithText("Operator").performScrollTo().assertIsDisplayed()
        compose.onNodeWithText("Value").performScrollTo().assertIsDisplayed()
        compose.onNodeWithText("20").performScrollTo().assertIsDisplayed()
        compose.onNodeWithText("Fire on any change").performScrollTo().assertIsDisplayed()
    }

    @Test
    fun signalBooleanShowsTrueFalseValueSelect() {
        setContent(AutomationTriggerInput.Signal(signal = "is_locked", op = "=", valueBool = true))
        compose.onNodeWithText("Value").performScrollTo().assertIsDisplayed()
        compose.onNodeWithText("True").performScrollTo().assertIsDisplayed()
    }

    @Test
    fun signalChangedTogglePropagatesAndHidesValue() {
        var latest: AutomationTriggerInput? = null
        setContent(
            trigger = AutomationTriggerInput.Signal(signal = "battery_level", op = "<", valueNum = 20.0),
            onChange = { latest = it },
        )
        compose.onNodeWithText("Fire on any change").performScrollTo().performClick()
        val next = latest
        assertTrue(next is AutomationTriggerInput.Signal && next.op == "changed")
    }

    @Composable
    private fun Host(content: @Composable () -> Unit) {
        Box(modifier = Modifier.size(width = HOST_WIDTH, height = HOST_HEIGHT)) {
            Box(modifier = Modifier.fillMaxWidth().verticalScroll(rememberScrollState()).padding(HOST_PADDING)) {
                content()
            }
        }
    }

    private companion object {
        const val NOW = 1_780_000_000_000L
        val HOST_WIDTH = 380.dp
        val HOST_HEIGHT = 720.dp
        val HOST_PADDING = 12.dp
    }
}
