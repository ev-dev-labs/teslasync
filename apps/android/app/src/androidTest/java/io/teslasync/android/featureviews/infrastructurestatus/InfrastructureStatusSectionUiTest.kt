package io.teslasync.android.featureviews.infrastructurestatus

import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import io.teslasync.android.featureviews.accordionsection.AccordionSectionStrings
import io.teslasync.android.ui.theme.TeslaSyncTheme
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test

/**
 * On-device Compose UI + accessibility verification of [InfrastructureStatusSectionContent] across every
 * state the web component renders (loading skeletons, the two-card content, empty → web default cards, hard
 * error with retry, stale/offline cached). Asserts the rendered i18n strings, the per-card merged TalkBack
 * content descriptions, and that the error-retry control fires. Runs under `connectedAndroidTest` (a
 * device/emulator) — the offline gate's `testReleaseUnitTest` covers the projection/state logic; this covers
 * the render + a11y.
 */
class InfrastructureStatusSectionUiTest {
    @get:Rule
    val compose = createComposeRule()

    private fun strings(): InfrastructureStatusStrings =
        InfrastructureStatusStrings(
            title = "Infrastructure",
            description = "SSE connections and polling engine diagnostics",
            connected = "Connected",
            disconnected = "Disconnected",
            sseConnection = "SSE Connection",
            connectionState = "Connection State",
            endpoint = "Endpoint",
            protocol = "Protocol",
            fallbackMode = "Fallback Mode",
            yesPolling = "Yes \u2014 Polling",
            no = "No",
            pollingEngine = "Polling Engine",
            active = "Active",
            standby = "Standby",
            mode = "Mode",
            speedComparison = "Speed Comparison",
            fleetTelemetryLatency = "Fleet Telemetry Latency",
            fleetApiPolling = "Fleet API Polling",
            totalConns = "Total Conns",
            acquired = "Acquired",
            idle = "Idle",
        )

    private fun accordionStrings(): AccordionSectionStrings =
        AccordionSectionStrings(
            expandAction = "Expand",
            collapseAction = "Collapse",
            expandedState = "Expanded",
            collapsedState = "Collapsed",
            emptyHint = "Nothing to show",
        )

    private fun liveData(): InfrastructureStatusData {
        val telemetry: JsonElement =
            buildJsonObject {
                put("enabled", true)
                put("mode", "fleet_telemetry")
                put("endpoint", "telemetry.tesla.com")
                put("protocol", "mqtt")
                put(
                    "speed_comparison",
                    buildJsonObject {
                        put("speedup", "12x faster")
                        put("fleet_telemetry_latency", "180 ms")
                        put("fleet_api_polling", "2.2 s")
                    },
                )
            }
        val health: JsonElement =
            buildJsonObject {
                put(
                    "database_pool",
                    buildJsonObject {
                        put("total_conns", 25)
                        put("acquired_conns", 4)
                        put("idle_conns", 21)
                    },
                )
            }
        return InfrastructureStatusData(telemetry, health)
    }

    private fun setContent(
        state: UiState<InfrastructureStatusData>,
        onRefresh: () -> Unit = {},
    ) {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                InfrastructureStatusSectionContent(
                    state = state,
                    strings = strings(),
                    accordionStrings = accordionStrings(),
                    onRefresh = onRefresh,
                )
            }
        }
    }

    private fun contentState(): UiState<InfrastructureStatusData> = UiState(phase = UiPhase.Content, data = liveData(), fetchedAt = 1L)

    @Test
    fun loadingShowsSkeletonNotCards() {
        setContent(UiState.loading())
        compose.onNodeWithText("Infrastructure").assertIsDisplayed()
        compose.onNodeWithText("SSE Connection").assertDoesNotExist()
        compose.onNodeWithText("Polling Engine").assertDoesNotExist()
    }

    @Test
    fun contentShowsCardsAndValues() {
        setContent(contentState())
        compose.onNodeWithText("SSE Connection").assertIsDisplayed()
        compose.onNodeWithText("Polling Engine").assertIsDisplayed()
        compose.onNodeWithText("Endpoint").assertIsDisplayed()
        compose.onNodeWithText("telemetry.tesla.com").assertIsDisplayed()
        compose.onNodeWithText("Total Conns").assertIsDisplayed()
        compose.onNodeWithText("25").assertIsDisplayed()
    }

    @Test
    fun cardsExposeMergedTalkBackLabels() {
        setContent(contentState())
        compose.onNodeWithContentDescription("SSE Connection, Connected").assertIsDisplayed()
        compose.onNodeWithContentDescription("Polling Engine, Standby").assertIsDisplayed()
    }

    @Test
    fun emptyRendersDefaultCardsNotBlank() {
        setContent(UiState(phase = UiPhase.Empty, data = InfrastructureStatusData(JsonNull, JsonNull), fetchedAt = 1L))
        compose.onNodeWithContentDescription("SSE Connection, Disconnected").assertIsDisplayed()
        compose.onNodeWithContentDescription("Polling Engine, Standby").assertIsDisplayed()
        // No health payload → the optional database-pool row is hidden, not drawn as zeros.
        compose.onNodeWithText("Total Conns").assertDoesNotExist()
    }

    @Test
    fun errorShowsQueryErrorWithRetry() {
        var refreshed = false
        setContent(UiState(phase = UiPhase.Error, errorKind = ErrorKind.Network), onRefresh = { refreshed = true })
        compose.onNodeWithText("SSE Connection").assertDoesNotExist()
        compose.onNodeWithText("Retry").performClick()
        assertTrue(refreshed)
    }

    @Test
    fun offlineKeepsCachedCardsVisible() {
        setContent(
            UiState(
                phase = UiPhase.Content,
                data = liveData(),
                fetchedAt = 1L,
                stale = true,
                errorKind = ErrorKind.Network,
            ),
        )
        compose.onNodeWithText("SSE Connection").assertIsDisplayed()
        compose.onNodeWithText("telemetry.tesla.com").assertIsDisplayed()
    }
}
