package io.teslasync.android.featureviews.teslachargingsessionsmap

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
import io.teslasync.android.components.maps.MapAccessibleSummary
import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import io.teslasync.android.ui.theme.TeslaSyncTheme
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import java.time.ZoneOffset
import java.util.Locale

/**
 * On-device Compose UI + accessibility verification of the TeslaChargingSessionsMap across the states the
 * web component renders WITHOUT a live base map: the loading skeleton, the "No location data available
 * yet." empty surface (with its header title + refresh control), the hard error + retry surface, and the
 * content header + the accessible-summary list (the screen-reader marker labels). The live `TeslaMap`
 * needs Google Play Services on the device, so — following the maps-layer testing contract — the opaque
 * clustered map body is covered by the no-device [TeslaChargingSessionsMapProjectionTest] (center / markers
 * / snippet / summary), while these assert the SDK-free chrome + the screen-reader-visible labels.
 */
class TeslaChargingSessionsMapUiTest {
    @get:Rule
    val compose = createComposeRule()

    private fun strings(): ChargingSessionsMapStrings =
        ChargingSessionsMapStrings(
            mapLabel = "Charging sessions map",
            unknown = "Unknown",
            markerLabel = { name -> "$name charging session" },
            noData = "No location data available yet.",
        )

    private fun setContent(
        state: UiState<List<TeslaChargingSession>>,
        onRefresh: () -> Unit = {},
    ) {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                Host {
                    TeslaChargingSessionsMapContent(
                        state = state,
                        currency = ChargingSessionsCurrencyPrefs.DEFAULT,
                        locale = Locale.US,
                        onRefresh = onRefresh,
                    )
                }
            }
        }
    }

    @Test
    fun loadingShowsAccessibleSkeletonChrome() {
        setContent(UiState(UiPhase.Loading))
        compose.onNodeWithContentDescription("Loading", substring = true).assertIsDisplayed()
    }

    @Test
    fun emptyShowsHeaderTitleNoDataAndRefresh() {
        setContent(UiState(UiPhase.Empty, data = emptyList(), fetchedAt = 0L))
        compose.onNodeWithText("Charging sessions map").assertIsDisplayed()
        compose.onNodeWithText("No location data available yet.").assertIsDisplayed()
        // The header refresh control exposes an accessible name (TalkBack).
        compose.onNodeWithContentDescription("Refresh").assertIsDisplayed()
    }

    @Test
    fun errorShowsRetryAffordanceAndInvokesRefresh() {
        var retried = false
        setContent(
            state = UiState(UiPhase.Error, errorKind = ErrorKind.Network),
            onRefresh = { retried = true },
        )
        compose.onNodeWithText("Can't reach server").assertIsDisplayed()
        compose.onNodeWithText("Retry").performClick()
        assertTrue(retried)
    }

    @Test
    fun headerShowsTitleAndRefreshLabel() {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                Host {
                    ChargingSessionsMapHeader(
                        title = "Charging sessions map",
                        fetchedAtMillis = 1_000L,
                        isFetching = false,
                        isStale = false,
                        isError = false,
                        onRefresh = {},
                    )
                }
            }
        }
        compose.onNodeWithText("Charging sessions map").assertIsDisplayed()
        compose.onNodeWithContentDescription("Refresh").assertIsDisplayed()
    }

    @Test
    fun accessibleSummaryListsMarkerLabelsForContent() {
        val display =
            TeslaChargingSessionsMapProjection.project(
                sessions =
                    listOf(
                        TeslaChargingSession(
                            sessionId = 1L,
                            siteLocationName = "Fremont SC",
                            chargeStartDatetime = "2026-04-04T15:45:00Z",
                            totalEnergyAddedWh = 45_200.0,
                            totalCost = 12.5,
                            chargerType = "supercharger",
                            latitude = 37.5,
                            longitude = -122.2,
                        ),
                    ),
                strings = strings(),
                currency = ChargingSessionsCurrencyPrefs.DEFAULT,
                locale = Locale.US,
                zone = ZoneOffset.UTC,
            )
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                Host {
                    MapAccessibleSummary(label = display.mapLabel, lines = display.summaryLines)
                }
            }
        }
        compose.onNodeWithText("Fremont SC charging session", substring = true).assertIsDisplayed()
    }

    @Composable
    private fun Host(content: @Composable () -> Unit) {
        Box(modifier = Modifier.size(width = HOST_WIDTH, height = HOST_HEIGHT)) { content() }
    }

    private companion object {
        val HOST_WIDTH = 360.dp
        val HOST_HEIGHT = 640.dp
    }
}
