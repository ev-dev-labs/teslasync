package io.teslasync.android.dashboard.widgets.signallog

import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.shared.core.presentation.telemetry.SignalObservation
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test

/**
 * On-device Compose UI + accessibility verification of [SignalLogWidgetContent] across every state the web
 * component renders (loading skeleton, empty, hard error + retry, wide observation feed, compact signals/sec
 * hero, stale/offline cached, the Pause/Resume freeze toggle). Asserts the rendered i18n strings and the
 * TalkBack content descriptions are present. Runs under `connectedAndroidTest` (a device/emulator) — the
 * offline gate's `testReleaseUnitTest` covers the logic; this covers the render.
 */
class SignalLogWidgetUiTest {
    @get:Rule
    val compose = createComposeRule()

    private val fixedNow = 1_780_000_000_000L

    private fun observation(
        signalName: String = "VehicleSpeed",
        valueNumeric: Double? = 42.0,
        source: String = "fleet_telemetry",
    ): SignalObservation =
        SignalObservation(
            vehicleId = 1L,
            ts = "2026-06-06T12:00:00Z",
            signalName = signalName,
            valueNumeric = valueNumeric,
            valueText = null,
            valueBool = null,
            source = source,
        )

    private fun setContent(
        state: UiState<List<SignalObservation>>,
        rate: Double = 0.0,
        size: SignalLogSize = SignalLogRegistration.DEFAULT_SIZE,
        onRefresh: () -> Unit = {},
    ) {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                SignalLogWidgetContent(
                    state = state,
                    rate = rate,
                    size = size,
                    onRefresh = onRefresh,
                    nowMillis = fixedNow,
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
    fun emptyShowsFriendlyMessage() {
        setContent(UiState(UiPhase.Empty, data = emptyList(), fetchedAt = fixedNow))
        compose.onNodeWithText("No signal updates yet").assertIsDisplayed()
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
    fun wideContentShowsObservationRowWithFoldedDescription() {
        setContent(UiState(UiPhase.Content, data = listOf(observation()), fetchedAt = fixedNow))
        // The row exposes a single TalkBack phrase folding signal + value + source + relative time.
        compose.onNodeWithContentDescription("VehicleSpeed", substring = true).assertIsDisplayed()
        compose.onNodeWithContentDescription("MQTT", substring = true).assertIsDisplayed()
    }

    @Test
    fun compactHeroExposesRateAndAccessibleName() {
        setContent(
            state = UiState(UiPhase.Content, data = listOf(observation()), fetchedAt = fixedNow),
            rate = 12.4,
            size = SignalLogSize(cols = 1, rows = 4),
        )
        // The compact hero folds the rounded rate + label into one accessible description.
        compose.onNodeWithContentDescription("12 signals/sec", substring = true).assertIsDisplayed()
    }

    @Test
    fun offlineKeepsCachedContentVisible() {
        setContent(
            UiState(
                UiPhase.Content,
                data = listOf(observation()),
                fetchedAt = fixedNow,
                stale = true,
                errorKind = ErrorKind.Timeout,
            ),
        )
        // Cached rows stay visible (never blanked) when offline/stale.
        compose.onNodeWithContentDescription("VehicleSpeed", substring = true).assertIsDisplayed()
    }

    @Test
    fun contentHeaderExposesRefreshAction() {
        setContent(UiState(UiPhase.Content, data = listOf(observation()), fetchedAt = fixedNow))
        compose.onNodeWithContentDescription("Refresh").assertIsDisplayed()
    }

    @Test
    fun pauseActionTogglesToResume() {
        setContent(UiState(UiPhase.Content, data = listOf(observation()), fetchedAt = fixedNow))
        compose.onNodeWithContentDescription("Pause").assertIsDisplayed()
        compose.onNodeWithContentDescription("Pause").performClick()
        compose.onNodeWithContentDescription("Resume").assertIsDisplayed()
    }
}
