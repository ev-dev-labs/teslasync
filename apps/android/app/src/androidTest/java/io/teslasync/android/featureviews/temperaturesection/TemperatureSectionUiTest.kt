package io.teslasync.android.featureviews.temperaturesection

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
import java.util.Locale

/**
 * On-device Compose UI + accessibility verification of [TemperatureSectionContent] across every state the
 * surface renders: the loading chrome, the hard-error retry surface, the no-data empty state, the
 * `length > 1` single-sample boundary, the populated tiles + lines + legend, and the stale/offline cached
 * view. Asserts the rendered i18n strings, the chart's accessible description (web `ariaLabel`), each
 * stat tile's grouped TalkBack label ("{label}: {value}"), the legend row's TalkBack label, and the
 * freshness chip's TalkBack label. The offline gate's `testReleaseUnitTest` covers the pure projection;
 * this covers render + a11y. Mirrors the web spec
 * (web/src/features/driving/components/drive-detail/TemperatureSection.tsx).
 */
class TemperatureSectionUiTest {
    @get:Rule
    val compose = createComposeRule()

    private val strings =
        TemperatureSectionStrings(
            title = "Temperatures",
            outsideTemp = "Outside Temperature",
            insideTemp = "Inside Temperature",
            driverTemp = "Driver Temperature",
            passengerTemp = "Passenger Temperature",
            climate = "Climate",
            fanStatus = "Fan Status",
            avg = "Avg",
            max = "Max",
            outside = "Outside",
            inside = "Inside",
            driver = "Driver",
            passenger = "Passenger",
            climateOn = "On",
            climateOff = "Off",
            climateMostlyOff = "Mostly Off",
            ariaLabel = "Inside, outside, driver and passenger temperature lines over the drive timeline",
        )

    private fun setContent(
        state: UiState<List<TemperatureSample>>,
        onRetry: () -> Unit = {},
    ) {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                TemperatureSectionContent(
                    state = state,
                    onRetry = onRetry,
                    syncId = null,
                    unitLabel = "\u00B0C",
                    locale = Locale.US,
                    precision = 1,
                    strings = strings,
                )
            }
        }
    }

    private fun trace(): List<TemperatureSample> =
        listOf(
            TemperatureSample(
                "09:00",
                outsideTemp = 9.0,
                insideTemp = 18.0,
                driverTemp = 21.0,
                passengerTemp = 20.0,
                climateOn = true,
                fanStatus = 2.0,
            ),
            TemperatureSample(
                "09:05",
                outsideTemp = 11.0,
                insideTemp = 20.0,
                driverTemp = 23.0,
                passengerTemp = 22.0,
                climateOn = true,
                fanStatus = 6.0,
            ),
        )

    @Test
    fun loadingShowsTitleChromeNotABlankPanel() {
        setContent(UiState(UiPhase.Loading))
        compose.onNodeWithText("Temperatures").assertIsDisplayed()
    }

    @Test
    fun errorShowsRetryAffordanceAndInvokesRetry() {
        var retried = false
        setContent(state = UiState(UiPhase.Error, errorKind = ErrorKind.Network), onRetry = { retried = true })
        compose.onNodeWithText("Something went wrong on our end. Please try again.").assertIsDisplayed()
        compose.onNodeWithText("Retry").performClick()
        assertTrue(retried)
    }

    @Test
    fun emptyShowsTitleAndNoTemperatureMessage() {
        setContent(UiState(UiPhase.Empty, data = emptyList()))
        compose.onNodeWithText("Temperatures").assertIsDisplayed()
        compose.onNodeWithText("No temperature telemetry is available for this drive.").assertIsDisplayed()
        // No tile label leaks in the empty state.
        compose.onNodeWithContentDescription("Outside Temperature: 10.0\u00B0C").assertDoesNotExist()
    }

    @Test
    fun singleSampleRendersEmptyStateMirroringLengthGreaterThanOne() {
        // The web `chartData.length > 1` boundary: one sample is the empty surface, never a one-point chart.
        setContent(UiState(UiPhase.Content, data = listOf(trace().first())))
        compose.onNodeWithText("No temperature telemetry is available for this drive.").assertIsDisplayed()
    }

    @Test
    fun contentRendersTitleAccessibleChartDescriptionTilesAndLegend() {
        setContent(UiState(UiPhase.Content, data = trace()))
        compose.onNodeWithText("Temperatures").assertIsDisplayed()
        compose.onNodeWithContentDescription(strings.ariaLabel).assertExists()
        // Each stat tile is a grouped node whose TalkBack label carries its caption + formatted value.
        compose.onNodeWithContentDescription("Outside Temperature: 10.0\u00B0C").assertExists()
        compose.onNodeWithContentDescription("Inside Temperature: 19.0\u00B0C").assertExists()
        compose.onNodeWithContentDescription("Driver Temperature: 22.0\u00B0C").assertExists()
        compose.onNodeWithContentDescription("Passenger Temperature: 21.0\u00B0C").assertExists()
        compose.onNodeWithContentDescription("Climate: On").assertExists()
        compose.onNodeWithContentDescription("Fan Status: Avg 4 \u00B7 Max 6").assertExists()
        // The legend row is a grouped node labelled "{series} {unit}".
        compose.onNodeWithContentDescription("Outside \u00B0C").assertExists()
    }

    @Test
    fun contentWithoutSomeSeriesOmitsThoseTiles() {
        val ambientOnly =
            listOf(
                TemperatureSample("09:00", outsideTemp = 9.0),
                TemperatureSample("09:05", outsideTemp = 11.0),
            )
        setContent(UiState(UiPhase.Content, data = ambientOnly))
        compose.onNodeWithContentDescription("Outside Temperature: 10.0\u00B0C").assertExists()
        // No inside/driver/passenger/climate/fan tile renders when those series are absent.
        compose.onNodeWithContentDescription("Inside Temperature: 19.0\u00B0C").assertDoesNotExist()
        compose.onNodeWithContentDescription("Climate: On").assertDoesNotExist()
    }

    @Test
    fun offlineShowsCachedTilesWithOfflineChip() {
        setContent(
            UiState(
                phase = UiPhase.Content,
                data = trace(),
                stale = true,
                fetchedAt = 1_700_000_000_000L,
                errorKind = ErrorKind.Network,
            ),
        )
        compose.onNodeWithText("Temperatures").assertIsDisplayed()
        compose.onNodeWithContentDescription("Outside Temperature: 10.0\u00B0C").assertExists()
        compose.onNodeWithContentDescription("Offline").assertExists()
    }

    @Test
    fun staleContentAutoRefreshesAndKeepsCachedContent() {
        var refreshed = false
        setContent(
            state =
                UiState(
                    phase = UiPhase.Content,
                    data = trace(),
                    stale = true,
                    fetchedAt = 1_700_000_000_000L,
                ),
            onRetry = { refreshed = true },
        )
        compose.waitForIdle()
        compose.onNodeWithText("Temperatures").assertIsDisplayed()
        assertTrue(refreshed)
    }
}
