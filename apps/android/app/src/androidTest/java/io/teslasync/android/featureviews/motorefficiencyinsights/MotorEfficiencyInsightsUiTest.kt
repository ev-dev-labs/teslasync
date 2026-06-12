package io.teslasync.android.featureviews.motorefficiencyinsights

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.test.assertCountEquals
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onAllNodesWithContentDescription
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onNodeWithText
import androidx.test.platform.app.InstrumentationRegistry
import io.teslasync.android.R
import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import io.teslasync.android.data.UnitFormatter
import io.teslasync.android.ui.theme.TeslaSyncTheme
import org.junit.Rule
import org.junit.Test

/**
 * Instrumented Compose UI + accessibility verification of [MotorEfficiencyInsightsContent] across every
 * branch the surface renders: the resolved three-panel content (titles, readout labels, formatted values,
 * style + thermal badges), the per-panel empty state (the web `noData` shown in all three panels), the
 * loading skeleton (announced as "Loading", with no readout labels leaking), the hard-error retry surface,
 * and the stale/offline freshness chip over still-shown cached content. Asserts the rendered text is exposed
 * to TalkBack so the surface is fully navigable. Runs under `connectedAndroidTest`; the offline gate's
 * `testReleaseUnitTest` covers the pure projection.
 */
class MotorEfficiencyInsightsUiTest {
    @get:Rule
    val compose = createComposeRule()

    private val prefs = UnitFormatter.default().prefs

    private val strings =
        MotorEfficiencyInsightsStrings(
            torqueDistribution = "Torque Distribution",
            throttleBehavior = "Throttle Behavior",
            motorThermal = "Motor Thermal",
            noMotorData = "No motor data recorded yet",
            avgTorque = "Avg Torque",
            maxTorque = "Max Torque",
            highTorqueTime = "High Torque Time",
            avgPower = "Avg Power",
            drivingStyle = "Style",
            conservative = "Conservative",
            moderate = "Moderate",
            aggressive = "Aggressive",
            avgMotorTemp = "Avg Motor Temp",
            maxMotorTemp = "Max Motor Temp",
            thermalGood = "Thermal: Good",
            thermalWarm = "Thermal: Warm",
            thermalHot = "Thermal: Hot",
            loadingLabel = "Loading",
        )

    private val sampleStats =
        MotorStats(
            avgTorque = 215.4,
            maxTorque = 342.0,
            highTorquePct = 12.5,
            avgPower = 42.0,
            avgMotorTemp = 48.6,
            maxMotorTemp = 72.3,
        )

    private fun stateFor(
        stats: MotorStats? = sampleStats,
        style: ThrottleStyle? = ThrottleStyle.Moderate,
    ): UiState<MotorEfficiencySnapshot> =
        MotorEfficiencyInsightsProjection.projectUiState(
            MotorEfficiencySnapshot(motorStats = stats, throttleStyle = style),
            isLoading = false,
        )

    private fun setContent(
        state: UiState<MotorEfficiencySnapshot>,
        onRetry: () -> Unit = {},
    ) {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                Host {
                    MotorEfficiencyInsightsContent(state = state, onRetry = onRetry, prefs = prefs, strings = strings)
                }
            }
        }
    }

    @Test
    fun contentShowsTitlesLabelsValuesAndBadges() {
        setContent(stateFor())
        compose.onNodeWithText(strings.torqueDistribution).assertIsDisplayed()
        listOf(strings.throttleBehavior, strings.motorThermal).forEach { compose.onNodeWithText(it).assertExists() }
        // Every readout label is rendered (TalkBack reads each row's label) — accessibility coverage.
        listOf(
            strings.avgTorque,
            strings.maxTorque,
            strings.highTorqueTime,
            strings.avgPower,
            strings.drivingStyle,
            strings.avgMotorTemp,
            strings.maxMotorTemp,
        ).forEach { compose.onNodeWithText(it).assertExists() }
        // Formatted values with their unit suffixes (web one-decimal fmtNumber + " Nm" / "%" / " kW" / °C).
        listOf("215.4 Nm", "342.0 Nm", "12.5%", "42.0 kW", "48.6\u00B0C", "72.3\u00B0C").forEach {
            compose.onNodeWithText(it).assertExists()
        }
        // Style badge (Moderate) + thermal verdict badge (max 72.3 °C < 100 → Good).
        compose.onNodeWithText(strings.moderate).assertExists()
        compose.onNodeWithText(strings.thermalGood).assertExists()
    }

    @Test
    fun emptyShowsNoDataInEveryPanelNeverBlank() {
        setContent(stateFor(stats = null))
        // The three panel titles still render (the panels are never hidden).
        compose.onNodeWithText(strings.torqueDistribution).assertIsDisplayed()
        listOf(strings.throttleBehavior, strings.motorThermal).forEach { compose.onNodeWithText(it).assertExists() }
        // The shared web `noData` empty state appears in every one of the three panels.
        compose.onAllNodesWithText(strings.noMotorData).assertCountEquals(3)
        // No readout leaks when there is no data.
        compose.onNodeWithText(strings.avgTorque).assertDoesNotExist()
    }

    @Test
    fun loadingAnnouncesLoadingAndHidesReadoutLabels() {
        setContent(UiState.loading())
        // Panel titles remain as loading chrome.
        compose.onNodeWithText(strings.torqueDistribution).assertIsDisplayed()
        // Each panel's skeleton body is announced as a "Loading" region, not read as empty boxes.
        compose.onAllNodesWithContentDescription(strings.loadingLabel).assertCountEquals(3)
        // No readout label leaks while loading.
        compose.onNodeWithText(strings.avgTorque).assertDoesNotExist()
    }

    @Test
    fun errorReplacesGridWithRetryAffordance() {
        setContent(UiState(phase = UiPhase.Error, errorKind = ErrorKind.Network))
        // The content grid is replaced by the hard-error surface (the web QueryError equivalent).
        compose.onNodeWithText(strings.torqueDistribution).assertDoesNotExist()
        compose.onNodeWithText(string(R.string.translation_error_serverError_title)).assertIsDisplayed()
        compose.onNodeWithText(string(R.string.translation_common_retry)).assertIsDisplayed()
    }

    @Test
    fun offlineShowsCachedContentWithFreshnessChip() {
        setContent(
            UiState(
                phase = UiPhase.Content,
                data = MotorEfficiencySnapshot(motorStats = sampleStats, throttleStyle = ThrottleStyle.Moderate),
                stale = true,
                errorKind = ErrorKind.Network,
            ),
        )
        // Cached content is still shown (honest "last known"), with the offline freshness chip above it.
        compose.onNodeWithText("215.4 Nm").assertExists()
        compose.onNodeWithText(string(R.string.translation_common_offline)).assertExists()
    }

    private fun string(resId: Int): String = InstrumentationRegistry.getInstrumentation().targetContext.getString(resId)

    @Composable
    private fun Host(content: @Composable () -> Unit) {
        Column(
            modifier = Modifier.fillMaxSize().verticalScroll(rememberScrollState()),
        ) {
            content()
        }
    }
}
