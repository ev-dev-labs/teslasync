package io.teslasync.android.featureviews.servicehealth

import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import io.teslasync.android.ui.theme.TeslaSyncTheme
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test

/**
 * Instrumented Compose tests for the Service Health surface: each state from the web source (content / empty
 * / error / stale) renders its copy on a device, the four MetricCards expose their labels, the vehicles table
 * exposes its column headers + a status badge, the Enabled + "{count} streaming" header badges render, the
 * error surface's retry fires its callback, and the loading + disclosure-toggle affordances expose accessible
 * names. The framework-free logic is covered by the no-device [ServiceHealthProjectionTest] /
 * [ServiceHealthSectionViewModelTest]; this is the connectedAndroidTest gate. Uses only resolvable finders
 * (no assertExists/assertDoesNotExist).
 */
class ServiceHealthSectionUiTest {
    @get:Rule
    val rule = createComposeRule()

    private val strings = serviceHealthFallbackStrings()

    private fun data(): ServiceHealthData =
        ServiceHealthData(
            enabled = true,
            mode = "fleet_telemetry",
            totalSignals = 27_762L,
            avgSignalsPerSecond = "6.9",
            vehicles =
                listOf(
                    ServiceVehicleRow(
                        vin = "VIN-ABC",
                        isStreaming = true,
                        signalCount = 18_240L,
                        signalsPerSecond = 4.2,
                        latencyMs = 38.0,
                        lastReceived = "2023-11-14T22:13:20Z",
                    ),
                ),
            resolved = true,
        )

    private fun contentState(stale: Boolean = false): UiState<ServiceHealthData> =
        UiState(
            phase = UiPhase.Content,
            data = data(),
            fetchedAt = 1L,
            stale = stale,
            errorKind = if (stale) ErrorKind.Network else null,
        )

    @Test
    fun contentShowsMetricLabels() {
        rule.setContent {
            TeslaSyncTheme { ServiceHealthSectionContent(state = contentState(), strings = strings) }
        }

        rule.onNodeWithText(strings.mode).assertIsDisplayed()
        rule.onNodeWithText(strings.vehiclesConnected).assertIsDisplayed()
        rule.onNodeWithText(strings.totalSignals).assertIsDisplayed()
        rule.onNodeWithText(strings.avgSignalsPerSecond).assertIsDisplayed()
    }

    @Test
    fun contentShowsVehicleTableHeadersAndStatusBadge() {
        rule.setContent {
            TeslaSyncTheme { ServiceHealthSectionContent(state = contentState(), strings = strings) }
        }

        rule.onNodeWithText(strings.colVin).assertIsDisplayed()
        rule.onNodeWithText(strings.colStatus).assertIsDisplayed()
        rule.onNodeWithText(strings.colSignals).assertIsDisplayed()
        rule.onNodeWithText(strings.colLatency).assertIsDisplayed()
        rule.onNodeWithText(strings.colLastReceived).assertIsDisplayed()
        rule.onNodeWithText("VIN-ABC").assertIsDisplayed()
        rule.onNodeWithText(strings.rowStreaming, useUnmergedTree = true).assertIsDisplayed()
    }

    @Test
    fun contentShowsEnabledAndStreamingHeaderBadges() {
        rule.setContent {
            TeslaSyncTheme { ServiceHealthSectionContent(state = contentState(), strings = strings) }
        }

        rule.onNodeWithText(strings.enabled, useUnmergedTree = true).assertIsDisplayed()
        rule.onNodeWithText("1 ${strings.streamingSuffix}", useUnmergedTree = true).assertIsDisplayed()
    }

    @Test
    fun headerTitleIsDisplayedAndTogglable() {
        rule.setContent {
            TeslaSyncTheme { ServiceHealthSectionContent(state = contentState(), strings = strings) }
        }

        rule.onNodeWithText(strings.title, substring = true).assertIsDisplayed()
        rule.onNodeWithText(strings.title, substring = true).performClick()
        rule.onNodeWithText(strings.title, substring = true).assertIsDisplayed()
    }

    @Test
    fun emptyStateShowsHint() {
        rule.setContent {
            TeslaSyncTheme {
                ServiceHealthSectionContent(
                    state = UiState(phase = UiPhase.Empty, data = ServiceHealthData.EMPTY, fetchedAt = 1L),
                    strings = strings,
                )
            }
        }

        rule.onNodeWithText(strings.emptyHint).assertIsDisplayed()
    }

    @Test
    fun errorStateShowsRetryAndFiresCallback() {
        var retried = false
        rule.setContent {
            TeslaSyncTheme {
                ServiceHealthSectionContent(
                    state = UiState(phase = UiPhase.Error, errorKind = ErrorKind.Http, httpStatus = 500),
                    strings = strings,
                    onRetry = { retried = true },
                )
            }
        }

        rule.onNodeWithText("Retry").performClick()
        assertTrue(retried)
    }

    @Test
    fun loadingExposesAccessibilityLabel() {
        rule.setContent {
            TeslaSyncTheme {
                ServiceHealthSectionContent(state = UiState(phase = UiPhase.Loading), strings = strings)
            }
        }

        rule.onNodeWithContentDescription(strings.loading).assertIsDisplayed()
    }

    @Test
    fun staleContentStillRendersMetrics() {
        rule.setContent {
            TeslaSyncTheme { ServiceHealthSectionContent(state = contentState(stale = true), strings = strings) }
        }

        rule.onNodeWithText(strings.mode).assertIsDisplayed()
    }
}
