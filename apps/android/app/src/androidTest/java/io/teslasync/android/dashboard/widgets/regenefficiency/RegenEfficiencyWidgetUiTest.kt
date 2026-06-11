package io.teslasync.android.dashboard.widgets.regenefficiency

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.size
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
 * On-device Compose UI + accessibility verification of [RegenEfficiencyWidgetContent] across every
 * state the web component renders (loading skeleton, hard error + retry, the gauge hero with the
 * recovery label + stat tiles, the "No regen data" empty state, the compact gauge-only footprint, and
 * the stale/offline cached path). Asserts the rendered i18n strings and the TalkBack content
 * descriptions are present. Runs under `connectedAndroidTest`; the offline gate's `testReleaseUnitTest`
 * covers the pure logic, this covers the render + a11y.
 */
class RegenEfficiencyWidgetUiTest {
    @get:Rule
    val compose = createComposeRule()

    private fun prefs(): UnitPref =
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

    private fun card(
        regenRatio: Double = 0.25,
        totalRegenWh: Double? = 12_300.0,
        monthlyAvgRegen: Double? = 5_200.0,
        freeCharges: Double = 3.0,
    ): RegenEfficiencySnapshot =
        RegenEfficiencySnapshot(
            totalRegenWh = totalRegenWh,
            monthlyAvgRegen = monthlyAvgRegen,
            freeCharges = freeCharges,
            regenRatio = regenRatio,
        )

    private fun setContent(
        state: UiState<RegenEfficiencySnapshot?>,
        size: RegenEfficiencySize = STANDARD,
        onRefresh: () -> Unit = {},
    ) {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                Host {
                    RegenEfficiencyWidgetContent(
                        state = state,
                        prefs = prefs(),
                        size = size,
                        onRefresh = onRefresh,
                        locale = Locale.US,
                    )
                }
            }
        }
    }

    @Test
    fun loadingShowsAccessibleSkeletonChrome() {
        setContent(UiState(UiPhase.Loading))
        compose.onNodeWithContentDescription("Regen Braking").assertIsDisplayed()
    }

    @Test
    fun errorShowsRetryAffordanceAndInvokesRetry() {
        var retried = false
        setContent(
            state = UiState(UiPhase.Error, errorKind = ErrorKind.Network),
            onRefresh = { retried = true },
        )
        compose.onNodeWithText("Retry").performClick()
        assertTrue(retried)
    }

    @Test
    fun emptyShowsNoRegenDataMessage() {
        setContent(UiState(UiPhase.Empty, data = null, fetchedAt = NOW))
        compose.onNodeWithText("No regen data").assertIsDisplayed()
    }

    @Test
    fun standardContentShowsTitleGaugeAndRefresh() {
        setContent(UiState(UiPhase.Content, data = card(), fetchedAt = NOW))
        compose.onNodeWithText("Regen Braking").assertIsDisplayed()
        // The radial gauge folds its `${pct}%` label + value + unit into one accessible name.
        compose.onNodeWithContentDescription("25%: 25 recovery").assertIsDisplayed()
        // The header refresh control exposes an accessible name (TalkBack).
        compose.onNodeWithContentDescription("Refresh").assertIsDisplayed()
    }

    @Test
    fun standardContentShowsStatTileLabels() {
        setContent(UiState(UiPhase.Content, data = card(), fetchedAt = NOW))
        compose.onNodeWithText("Total Recovered").assertIsDisplayed()
        compose.onNodeWithText("Monthly Avg").assertIsDisplayed()
        compose.onNodeWithText("Free Charges").assertIsDisplayed()
    }

    @Test
    fun compactFootprintShowsGaugeWithoutStatTiles() {
        setContent(UiState(UiPhase.Content, data = card(), fetchedAt = NOW), size = COMPACT)
        compose.onNodeWithContentDescription("25%: 25 recovery").assertIsDisplayed()
        // Compact (1-column) footprint hides the title + stat tiles (web `isCompact` branch).
        compose.onNodeWithText("Free Charges").assertDoesNotExist()
    }

    @Test
    fun offlineKeepsCachedGaugeVisible() {
        setContent(
            UiState(
                phase = UiPhase.Content,
                data = card(),
                fetchedAt = NOW,
                stale = true,
                errorKind = ErrorKind.Timeout,
            ),
        )
        // Cached gauge stays visible (never blanked) when offline/stale.
        compose.onNodeWithContentDescription("25%: 25 recovery").assertIsDisplayed()
    }

    @Composable
    private fun Host(content: @Composable () -> Unit) {
        Box(modifier = Modifier.size(width = HOST_WIDTH, height = HOST_HEIGHT)) { content() }
    }

    private companion object {
        const val NOW = 1_780_000_000_000L
        val HOST_WIDTH = 360.dp
        val HOST_HEIGHT = 560.dp
        val STANDARD = RegenEfficiencySize(cols = 2, rows = 2)
        val COMPACT = RegenEfficiencySize(cols = 1, rows = 2)
    }
}
