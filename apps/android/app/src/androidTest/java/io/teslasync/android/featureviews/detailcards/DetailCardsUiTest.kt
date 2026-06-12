package io.teslasync.android.featureviews.detailcards

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
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
import io.teslasync.shared.core.units.DistanceUnitPref
import io.teslasync.shared.core.units.DurationUnitPref
import io.teslasync.shared.core.units.EnergyUnitPref
import io.teslasync.shared.core.units.PowerUnitPref
import io.teslasync.shared.core.units.PressureUnitPref
import io.teslasync.shared.core.units.SpeedUnitPref
import io.teslasync.shared.core.units.TemperatureUnitPref
import io.teslasync.shared.core.units.UnitPref
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import java.util.Locale

/**
 * Instrumented Compose UI + accessibility verification of [DetailCardsContent] across every branch the web
 * component renders (the "Temperature Details" + "Power Summary" cards with their definition-list rows) plus
 * the lifecycle chrome the host's feed implies (loading skeletons that keep the card headers, a hard-error
 * retry surface, a friendly empty body, and the stale/offline freshness chip). Asserts the rendered
 * labels/values are exposed to TalkBack, that the loading state is announced, that the empty state never
 * blanks, and that the retry affordance carries an accessible click action. Runs under `connectedAndroidTest`;
 * the offline gate's `testReleaseUnitTest` covers the pure projection. Mirrors the web spec
 * (web/src/features/driving/components/drivetrain-health/DetailCards.tsx).
 */
class DetailCardsUiTest {
    @get:Rule
    val compose = createComposeRule()

    private val strings =
        DetailCardsStrings(
            temperatureTitle = "Temperature Details",
            powerTitle = "Power Summary",
            frontMotorTemp = "Front Motor Temp",
            rearMotorTemp = "Rear Motor Temp",
            inverterTemp = "Inverter Temp",
            batteryTemp = "Battery Temp",
            peakPower = "Peak Power",
            avgPeakPower = "Avg Peak Power",
            maxRegen = "Max Regen",
            totalRegen = "Total Regen",
            co2Saved = "CO\u2082 Saved",
            noData = "No data available",
            loadingLabel = "Loading",
        )

    private val data =
        DetailCardsData(
            health =
                DrivetrainHealthInput(
                    frontMotorTempC = 48.0,
                    rearMotorTempC = 52.5,
                    inverterTempC = 41.0,
                    batteryTempC = 27.5,
                ),
            peakPowerKw = 212.0,
            avgPowerMaxKw = 94.6,
            minRegenPowerKw = -63.4,
            stats = DrivingStatsInput(regenEnergyWh = 18_400.0, co2SavedKg = 132.7),
        )

    private val prefs =
        UnitPref(
            distance = DistanceUnitPref.KM,
            speed = SpeedUnitPref.KMH,
            temperature = TemperatureUnitPref.CELSIUS,
            pressure = PressureUnitPref.BAR,
            energy = EnergyUnitPref.KWH,
            duration = DurationUnitPref.HOURS,
            power = PowerUnitPref.KW,
            locale = "en-US",
            precision = null,
        )

    private fun setContent(
        state: UiState<DetailCardsData>,
        onRetry: () -> Unit = {},
    ) {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                Host {
                    DetailCardsContent(
                        state = state,
                        onRetry = onRetry,
                        prefs = prefs,
                        locale = Locale.US,
                        strings = strings,
                    )
                }
            }
        }
    }

    @Test
    fun contentShowsBothCardTitlesEveryRowLabelAndRepresentativeValues() {
        setContent(UiState(phase = UiPhase.Content, data = data))
        compose.onNodeWithText(strings.temperatureTitle).assertIsDisplayed()
        compose.onNodeWithText(strings.powerTitle).assertIsDisplayed()
        // Every row label is exposed to TalkBack.
        listOf(
            strings.frontMotorTemp,
            strings.rearMotorTemp,
            strings.inverterTemp,
            strings.batteryTemp,
            strings.peakPower,
            strings.avgPeakPower,
            strings.maxRegen,
            strings.totalRegen,
            strings.co2Saved,
        ).forEach { compose.onNodeWithText(it).assertExists() }
        // A representative formatted value from each card.
        compose.onNodeWithText("48.0\u00B0C").assertExists()
        compose.onNodeWithText("52.5\u00B0C").assertExists()
        compose.onNodeWithText("212 kW").assertExists()
        compose.onNodeWithText("94.6 kW").assertExists()
        compose.onNodeWithText("63.4 kW").assertExists()
        compose.onNodeWithText("18.4 kWh").assertExists()
        compose.onNodeWithText("132.7 kg").assertExists()
    }

    @Test
    fun loadingKeepsCardTitlesAnnouncesItselfAndShowsNoValues() {
        setContent(UiState.loading())
        // The card headers are static chrome and stay visible; the value rows are replaced by skeletons.
        compose.onNodeWithText(strings.temperatureTitle).assertExists()
        compose.onNodeWithText(strings.powerTitle).assertExists()
        compose.onNodeWithContentDescription(strings.loadingLabel).assertExists()
        compose.onNodeWithText("212 kW").assertDoesNotExist()
        compose.onNodeWithText("48.0\u00B0C").assertDoesNotExist()
    }

    @Test
    fun emptyStillRendersAFriendlyMessageNeverABlankBox() {
        setContent(UiState(phase = UiPhase.Empty))
        compose.onNodeWithText(strings.noData).assertExists()
    }

    @Test
    fun errorShowsAccessibleRetryAndInvokesIt() {
        var retried = false
        setContent(UiState(phase = UiPhase.Error, errorKind = ErrorKind.Network), onRetry = { retried = true })
        val retry = compose.onNodeWithText("Retry")
        retry.assertIsDisplayed().assertHasClickAction()
        retry.performClick()
        assertTrue(retried)
    }

    @Test
    fun offlineStaleStillShowsCachedCards() {
        setContent(
            UiState(
                phase = UiPhase.Content,
                data = data,
                stale = true,
                fetchedAt = 1_700_000_000_000L,
                errorKind = ErrorKind.Network,
            ),
        )
        // Stale/offline keeps the cached cards visible (never blanks) — the "last known" contract.
        compose.onNodeWithText(strings.temperatureTitle).assertIsDisplayed()
        compose.onNodeWithText("212 kW").assertExists()
    }

    @Test
    fun staleContentAutoRefreshes() {
        var refreshed = false
        setContent(
            UiState(phase = UiPhase.Content, data = data, stale = true, fetchedAt = 1_700_000_000_000L),
            onRetry = { refreshed = true },
        )
        compose.waitForIdle()
        assertTrue(refreshed)
    }

    @Composable
    private fun Host(content: @Composable () -> Unit) {
        Box(modifier = Modifier.width(HOST_WIDTH).verticalScroll(rememberScrollState())) { content() }
    }

    private companion object {
        val HOST_WIDTH = 420.dp
    }
}
