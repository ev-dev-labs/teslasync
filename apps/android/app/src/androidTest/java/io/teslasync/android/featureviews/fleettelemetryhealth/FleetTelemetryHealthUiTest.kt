package io.teslasync.android.featureviews.fleettelemetryhealth

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.size
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.test.assertHasClickAction
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.filterToOne
import androidx.compose.ui.test.hasClickAction
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.unit.dp
import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.shared.core.presentation.telemetry.FleetTelemetryError
import io.teslasync.shared.core.presentation.telemetry.FleetTelemetryErrorVIN
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test

/**
 * Instrumented Compose UI + accessibility verification of [FleetTelemetryHealthContent] across every
 * state the web component pair renders (loading skeleton, empty, content with both tables + the VIN
 * filter chip, hard error + retry, and the stale/offline cached path). Asserts the rendered i18n strings
 * and that every interactive element (VIN toggle, clear filter, refresh, retry) exposes an accessible
 * click action. Runs under `connectedAndroidTest`; the offline gate's `testReleaseUnitTest` covers the
 * pure projection + view-model, this covers the render + accessibility.
 */
class FleetTelemetryHealthUiTest {
    @get:Rule
    val compose = createComposeRule()

    private val vins =
        listOf(
            FleetTelemetryErrorVIN(
                id = 1,
                vin = VIN_A,
                active = true,
                firstSeenAt = ISO_OLD,
                lastSeenAt = ISO_RECENT,
            ),
            FleetTelemetryErrorVIN(id = 2, vin = VIN_B, active = true, firstSeenAt = ISO_OLD, lastSeenAt = ISO_OLD),
        )

    private val errors =
        listOf(
            FleetTelemetryError(
                id = 1,
                vin = VIN_A,
                errorCode = "STREAM_DISCONNECTED",
                errorMessage = "Stream dropped",
                reportedAt = ISO_RECENT,
            ),
        )

    private fun setContent(
        vinsState: UiState<List<FleetTelemetryErrorVIN>>,
        errorsState: UiState<List<FleetTelemetryError>>,
        selectedVin: String = "",
        actions: FleetTelemetryHealthActions = FleetTelemetryHealthActions(),
    ) {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                Host {
                    FleetTelemetryHealthContent(
                        vinsState = vinsState,
                        errorsState = errorsState,
                        selectedVin = selectedVin,
                        vinsRefreshing = false,
                        errorsRefreshing = false,
                        actions = actions,
                        nowMillis = NOW,
                    )
                }
            }
        }
    }

    private fun content(): UiStatePair =
        UiStatePair(
            vins = UiState(UiPhase.Content, data = vins, fetchedAt = NOW),
            errors = UiState(UiPhase.Content, data = errors, fetchedAt = NOW),
        )

    @Test
    fun loadingShowsBothCardChrome() {
        setContent(UiState(UiPhase.Loading), UiState(UiPhase.Loading))
        compose.onNodeWithText("Error VINs").assertIsDisplayed()
        compose.onNodeWithText("Error Log").assertIsDisplayed()
        compose.onNodeWithText("Vehicles with fleet telemetry configuration errors").assertIsDisplayed()
    }

    @Test
    fun emptyShowsFriendlyMessagesForBothCards() {
        setContent(
            UiState(UiPhase.Empty, data = emptyList(), fetchedAt = NOW),
            UiState(UiPhase.Empty, data = emptyList(), fetchedAt = NOW),
        )
        compose.onNodeWithText("No vehicles with telemetry errors").assertIsDisplayed()
        compose.onNodeWithText("No fleet telemetry errors recorded").assertIsDisplayed()
    }

    @Test
    fun contentShowsBothTablesHeadersAndCounts() {
        val state = content()
        setContent(state.vins, state.errors)
        compose.onNodeWithText("First Seen").assertIsDisplayed()
        compose.onNodeWithText("Last Seen").assertIsDisplayed()
        compose.onNodeWithText("Error Code").assertIsDisplayed()
        compose.onNodeWithText("Reported At").assertIsDisplayed()
        // The error_code Badge renders the code; the count badge renders the affected total.
        compose.onNodeWithText("STREAM_DISCONNECTED").assertIsDisplayed()
        compose.onNodeWithText("2 affected").assertIsDisplayed()
    }

    @Test
    fun vinCellExposesClickActionAndTogglesFilter() {
        var toggled: String? = null
        val state = content()
        setContent(state.vins, state.errors, actions = FleetTelemetryHealthActions(onSelectVin = { toggled = it }))
        // The clickable VIN cell is the one VIN node carrying a click action (the error-row VIN is plain).
        val cell = compose.onAllNodesWithText(VIN_A).filterToOne(hasClickAction())
        cell.assertHasClickAction()
        cell.performClick()
        assertTrue(toggled == VIN_A)
    }

    @Test
    fun filteredChipExposesAccessibleClearButton() {
        var cleared = false
        val state = content()
        setContent(state.vins, state.errors, selectedVin = VIN_A, actions = FleetTelemetryHealthActions(onClearVin = { cleared = true }))
        compose.onNodeWithText("Filtered: $VIN_A").assertIsDisplayed()
        // The clear affordance is announced to TalkBack by its content description.
        compose.onNodeWithContentDescription("Clear VIN filter").assertHasClickAction().performClick()
        assertTrue(cleared)
    }

    @Test
    fun refreshButtonsAreLabeledAndClickable() {
        var refreshedVins = false
        val state = content()
        setContent(state.vins, state.errors, actions = FleetTelemetryHealthActions(onRefreshVins = { refreshedVins = true }))
        // "Refresh from Tesla" appears on both cards; the first (Error VINs card, rendered first) drives onRefreshVins.
        val buttons = compose.onAllNodesWithText("Refresh from Tesla")
        buttons[0].assertHasClickAction().performClick()
        assertTrue(refreshedVins)
    }

    @Test
    fun hardErrorShowsRetryAndInvokesIt() {
        var retried = false
        setContent(
            vinsState = UiState(UiPhase.Error, errorKind = ErrorKind.Network),
            errorsState = content().errors,
            actions = FleetTelemetryHealthActions(onRetryVins = { retried = true }),
        )
        compose.onNodeWithText("Can't reach server").assertIsDisplayed()
        compose.onNodeWithText("Retry").assertHasClickAction().performClick()
        assertTrue(retried)
    }

    @Test
    fun offlineKeepsCachedErrorRowsVisible() {
        setContent(
            vinsState = content().vins,
            errorsState =
                UiState(
                    phase = UiPhase.Content,
                    data = errors,
                    fetchedAt = NOW,
                    stale = true,
                    errorKind = ErrorKind.Timeout,
                ),
        )
        // Cached rows stay visible (never blanked) when offline/stale.
        compose.onNodeWithText("STREAM_DISCONNECTED").assertIsDisplayed()
        compose.onNodeWithText("Detailed fleet telemetry error history").assertIsDisplayed()
    }

    @Composable
    private fun Host(content: @Composable () -> Unit) {
        Box(modifier = Modifier.size(width = HOST_WIDTH, height = HOST_HEIGHT)) { content() }
    }

    private data class UiStatePair(
        val vins: UiState<List<FleetTelemetryErrorVIN>>,
        val errors: UiState<List<FleetTelemetryError>>,
    )

    private companion object {
        const val VIN_A = "5YJ3E1EA1KF000001"
        const val VIN_B = "5YJ3E1EA1KF000002"
        const val ISO_RECENT = "2026-06-11T10:00:00Z"
        const val ISO_OLD = "2026-06-01T00:00:00Z"

        // Two hours after ISO_RECENT, so the last-seen recency math is deterministic.
        val NOW = requireNotNull(FleetTelemetryHealthProjection.parseTimestampMillis(ISO_RECENT)) + 2L * 3_600_000L
        val HOST_WIDTH = 380.dp
        val HOST_HEIGHT = 720.dp
    }
}
