package io.teslasync.android.dashboard.widgets.telemetryerrors

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
import io.teslasync.shared.core.presentation.telemetry.FleetTelemetryError
import io.teslasync.shared.core.presentation.telemetry.FleetTelemetryErrorVIN
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test

/**
 * Instrumented Compose UI + accessibility verification of [TelemetryErrorsWidgetContent] across every
 * state the web component renders (loading skeleton, no-data empty, hard error + retry, the standard
 * header-stats + error feed, the "No errors recorded" sub-state, the compact count-and-status hero,
 * the recent-row badge and the stale/offline cached path). Asserts the rendered i18n strings and the
 * TalkBack content descriptions are present. Runs under `connectedAndroidTest`; the offline gate's
 * `testReleaseUnitTest` covers the pure projection + view-model, this covers the render.
 */
class TelemetryErrorsWidgetUiTest {
    @get:Rule
    val compose = createComposeRule()

    private val baseMillis: Long = requireNotNull(TelemetryErrorsProjection.parseTimestampMillis(ERROR_ISO))
    private val recentNow: Long = baseMillis + TEN_MINUTES_MS

    private fun vin(
        vin: String,
        active: Boolean,
    ): FleetTelemetryErrorVIN = FleetTelemetryErrorVIN(vin = vin, active = active)

    private fun dataWithActiveErrors(): TelemetryErrorsData =
        TelemetryErrorsData(
            errorVins = listOf(vin(VIN_A, active = true), vin(VIN_B, active = true)),
            errors =
                listOf(
                    FleetTelemetryError(
                        vin = VIN_A,
                        errorCode = "STREAM_DISCONNECTED",
                        reportedAt = ERROR_ISO,
                        fetchedAt = ERROR_ISO,
                    ),
                ),
        )

    private fun dataVinsNoErrors(): TelemetryErrorsData =
        TelemetryErrorsData(errorVins = listOf(vin(VIN_A, active = true)), errors = emptyList())

    private fun setContent(
        state: UiState<TelemetryErrorsData>,
        size: TelemetryErrorsSize = TelemetryErrorsRegistration.defaultSize,
        nowMillis: Long = recentNow,
        onRefresh: () -> Unit = {},
        onRetry: () -> Unit = {},
    ) {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                Host {
                    TelemetryErrorsWidgetContent(
                        state = state,
                        size = size,
                        onRefresh = onRefresh,
                        onRetry = onRetry,
                        nowMillis = nowMillis,
                    )
                }
            }
        }
    }

    @Test
    fun loadingShowsAccessibleSkeletonChrome() {
        setContent(UiState(UiPhase.Loading))
        compose.onNodeWithContentDescription("Telemetry Errors").assertIsDisplayed()
    }

    @Test
    fun noDataShowsFriendlyEmptyMessage() {
        setContent(UiState(UiPhase.Empty, data = TelemetryErrorsData.EMPTY, fetchedAt = recentNow))
        compose.onNodeWithText("No telemetry error data").assertIsDisplayed()
    }

    @Test
    fun errorShowsRetryAffordanceAndInvokesRetry() {
        var retried = false
        setContent(
            state = UiState(UiPhase.Error, errorKind = ErrorKind.Network),
            onRetry = { retried = true },
        )
        compose.onNodeWithText("Can't reach server").assertIsDisplayed()
        compose.onNodeWithText("Retry").performClick()
        assertTrue(retried)
    }

    @Test
    fun standardShowsTitleStatsRefreshAndRow() {
        setContent(UiState(UiPhase.Content, data = dataWithActiveErrors(), fetchedAt = recentNow))
        compose.onNodeWithText("Telemetry Errors").assertIsDisplayed()
        compose.onNodeWithText("2 VINs with errors").assertIsDisplayed()
        compose.onNodeWithText("Errors").assertIsDisplayed()
        compose.onNodeWithContentDescription("Refresh").assertIsDisplayed()
        // The aggregated row exposes a merged TalkBack label carrying the VIN.
        compose.onNodeWithContentDescription(VIN_A, substring = true).assertIsDisplayed()
    }

    @Test
    fun recentRowExposesRecentBadgeInLabel() {
        setContent(UiState(UiPhase.Content, data = dataWithActiveErrors(), fetchedAt = recentNow))
        compose.onNodeWithContentDescription("recent", substring = true).assertIsDisplayed()
    }

    @Test
    fun vinsWithoutAggregatedErrorsShowNoErrorsRecorded() {
        setContent(UiState(UiPhase.Content, data = dataVinsNoErrors(), fetchedAt = recentNow))
        compose.onNodeWithText("No errors recorded").assertIsDisplayed()
    }

    @Test
    fun compactHeroExposesCountAndStatusLabel() {
        setContent(
            state = UiState(UiPhase.Content, data = dataWithActiveErrors(), fetchedAt = recentNow),
            size = TelemetryErrorsSize(cols = 1, rows = 2),
        )
        compose.onNodeWithContentDescription("error VINs", substring = true).assertIsDisplayed()
    }

    @Test
    fun offlineKeepsCachedContentVisible() {
        setContent(
            UiState(
                phase = UiPhase.Content,
                data = dataWithActiveErrors(),
                fetchedAt = recentNow,
                stale = true,
                errorKind = ErrorKind.Timeout,
            ),
        )
        // Cached header + stats stay visible (never blanked) when offline/stale.
        compose.onNodeWithText("Telemetry Errors").assertIsDisplayed()
        compose.onNodeWithText("2 VINs with errors").assertIsDisplayed()
    }

    @Composable
    private fun Host(content: @Composable () -> Unit) {
        Box(modifier = Modifier.size(width = HOST_WIDTH, height = HOST_HEIGHT)) { content() }
    }

    private companion object {
        const val VIN_A = "5YJ3E1EA1KF000001"
        const val VIN_B = "5YJ3E1EA1KF000002"
        const val ERROR_ISO = "2026-06-11T12:00:00Z"
        const val TEN_MINUTES_MS = 10L * 60L * 1000L
        val HOST_WIDTH = 360.dp
        val HOST_HEIGHT = 520.dp
    }
}
