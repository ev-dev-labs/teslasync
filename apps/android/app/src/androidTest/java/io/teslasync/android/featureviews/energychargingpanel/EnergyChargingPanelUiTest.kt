package io.teslasync.android.featureviews.energychargingpanel

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.size
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.test.assertHasClickAction
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
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test

/**
 * Instrumented Compose UI + accessibility verification of [EnergyChargingPanelContent] across every branch the web
 * component renders (the metric grid + rows / the panel-level empty state), plus the lifecycle chrome the host's
 * feed implies (loading skeletons, a hard error with an accessible retry, and the stale/offline freshness chip).
 * Asserts the rendered title, the MetricCard labels + values, the merged per-row TalkBack descriptions (including
 * the verbatim no-`/1000` "11,000.00 kW" power reading), the Charging-State chip reading, and the retry click
 * action. Runs under `connectedAndroidTest`; the offline gate's `testReleaseUnitTest` covers the pure projection.
 * Mirrors the web spec (web/src/features/vehicles/components/telemetry-panels/EnergyChargingPanel.tsx).
 */
class EnergyChargingPanelUiTest {
    @get:Rule
    val compose = createComposeRule()

    // en-US / 2-decimal metric preferences so every rendered value is deterministic on any test device.
    private val prefs =
        EnergyChargingDisplayPrefs.from(
            buildJsonObject {
                put("decimal_precision", 2)
                put("locale", "en-US")
            },
        )

    private val strings =
        EnergyChargingStrings(
            title = "Energy & Charging",
            chargerVoltage = "Charger Voltage",
            chargerCurrent = "Charger Current",
            chargerPower = "Charger Power",
            energyAdded = "Energy Added",
            chargingState = "Charging State",
            batteryLevel = "Battery Level",
            chargeRate = "Charge Rate",
            unknown = "Unknown",
            noData = "No charging telemetry available",
            kw = "kW",
            kwh = "kWh",
        )

    private val snapshot =
        ChargingTelemetrySnapshot(
            chargerVoltage = 238.0,
            chargerActualCurrent = 16.0,
            chargerPowerW = 11_000.0,
            chargeEnergyAddedWh = 8_450.0,
            chargingState = "Charging",
            batteryLevel = 72.0,
            rangeAddedMetersPerHour = 36_000.0,
        )

    private fun setContent(
        state: UiState<ChargingTelemetrySnapshot>,
        onRetry: () -> Unit = {},
    ) {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                Host {
                    EnergyChargingPanelContent(state = state, onRetry = onRetry, prefs = prefs, strings = strings)
                }
            }
        }
    }

    @Test
    fun contentShowsTitleMetricsRowsAndChip() {
        setContent(UiState(phase = UiPhase.Content, data = snapshot))
        compose.onNodeWithText(strings.title).assertIsDisplayed()
        // The two MetricCards render their label + value as ordinary nodes (web `<MetricCard label value />`).
        compose.onNodeWithText(strings.chargerVoltage).assertIsDisplayed()
        compose.onNodeWithText("238.00").assertIsDisplayed()
        compose.onNodeWithText(strings.chargerCurrent).assertIsDisplayed()
        compose.onNodeWithText("16.00").assertIsDisplayed()
        // The label/value rows + the chip are each announced as one merged TalkBack fact.
        compose.onNodeWithContentDescription("Charging State: Charging").assertExists()
        compose.onNodeWithContentDescription("Battery Level: 72.00%").assertExists()
        compose.onNodeWithContentDescription("Charge Rate: 36.00 km/h").assertExists()
    }

    @Test
    fun powerAndEnergyRowsRenderRawSiValuesWithoutDividing() {
        setContent(UiState(phase = UiPhase.Content, data = snapshot))
        // Verbatim web parity: raw watts labeled kW, raw watt-hours labeled kWh — no /1000 (web source L52-L67).
        compose.onNodeWithContentDescription("Charger Power: 11,000.00 kW").assertExists()
        compose.onNodeWithContentDescription("Energy Added: 8,450.00 kWh").assertExists()
    }

    @Test
    fun everyDetailRowExposesAMergedAccessibilityLabel() {
        setContent(UiState(phase = UiPhase.Content, data = snapshot))
        // Accessibility: each of the five label/value + chip rows reads as "<label>: <value>" to TalkBack.
        listOf(
            "Charger Power: 11,000.00 kW",
            "Energy Added: 8,450.00 kWh",
            "Charging State: Charging",
            "Battery Level: 72.00%",
            "Charge Rate: 36.00 km/h",
        ).forEach { description ->
            compose.onNodeWithContentDescription(description).assertExists()
        }
    }

    @Test
    fun loadingShowsTitleButNoMetricLabels() {
        setContent(UiState.loading())
        compose.onNodeWithText(strings.title).assertIsDisplayed()
        // The skeleton carries no metric labels.
        compose.onNodeWithText(strings.chargerVoltage).assertDoesNotExist()
    }

    @Test
    fun emptyShowsAccessibleNoDataMessage() {
        setContent(UiState(phase = UiPhase.Empty, data = null))
        compose.onNodeWithText(strings.title).assertIsDisplayed()
        compose.onNodeWithText(strings.noData).assertIsDisplayed()
    }

    @Test
    fun errorShowsAccessibleRetryAndInvokesIt() {
        var retried = false
        setContent(UiState(phase = UiPhase.Error, data = null, errorKind = ErrorKind.Network), onRetry = { retried = true })
        compose.onNodeWithText(strings.title).assertIsDisplayed()
        val retry = compose.onNodeWithText("Retry")
        retry.assertIsDisplayed().assertHasClickAction()
        retry.performClick()
        assertTrue(retried)
    }

    @Test
    fun offlineStaleStillShowsCachedContentWithOfflineChip() {
        setContent(
            UiState(
                phase = UiPhase.Content,
                data = snapshot,
                stale = true,
                fetchedAt = 1_700_000_000_000L,
                errorKind = ErrorKind.Network,
            ),
        )
        // Stale/offline keeps the cached values visible (never blanks) — the "last known" contract.
        compose.onNodeWithText("238.00").assertExists()
        compose.onNodeWithContentDescription("Offline", substring = true).assertExists()
    }

    @Composable
    private fun Host(content: @Composable () -> Unit) {
        Box(modifier = Modifier.size(width = HOST_WIDTH, height = HOST_HEIGHT)) { content() }
    }

    private companion object {
        val HOST_WIDTH = 420.dp
        val HOST_HEIGHT = 900.dp
    }
}
