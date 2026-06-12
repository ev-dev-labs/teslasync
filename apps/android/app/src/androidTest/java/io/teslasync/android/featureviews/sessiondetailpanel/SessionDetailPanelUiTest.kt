package io.teslasync.android.featureviews.sessiondetailpanel

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.test.assertHasClickAction
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.unit.dp
import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.shared.core.api.generated.ChargingSession
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import java.time.ZoneId
import java.util.Locale
import kotlin.time.Instant

/**
 * Instrumented Compose UI + accessibility verification of [SessionDetailPanelContent] across every branch the
 * web component renders (the "Session Details" header over the label/value rows, including the three optional
 * rows) plus the lifecycle chrome the host's feed implies (loading skeletons, a hard-error retry surface, a
 * friendly empty body, and the stale/offline freshness chip). Asserts the rendered labels/values are exposed
 * to TalkBack, that the empty state never blanks, and that the retry affordance carries an accessible click
 * action. Runs under `connectedAndroidTest`; the offline gate's `testReleaseUnitTest` covers the pure
 * projection. Mirrors the web spec
 * (web/src/features/charging/components/charging-curve/SessionDetailPanel.tsx).
 */
class SessionDetailPanelUiTest {
    @get:Rule
    val compose = createComposeRule()

    private val strings =
        SessionDetailPanelStrings(
            title = "Session Details",
            date = "Date",
            chargerType = "Charger Type",
            socRange = "SOC Range",
            energyAdded = "Energy Added",
            peakPower = "Peak Power",
            avgPower = "Avg Power",
            duration = "Duration",
            cost = "Cost",
            location = "Location",
            noData = "No data available",
            chargerHomeAc = "AC / Home",
            chargerSupercharger = "Supercharger",
            chargerDcFast = "DC Fast",
        )

    private val session =
        ChargingSession(
            id = 1L,
            startedAt = Instant.parse("2026-04-04T09:30:00Z"),
            vehicleId = 7L,
            chargerType = "Tesla",
            endedAt = Instant.parse("2026-04-04T10:15:00Z"),
            totalEnergyAddedWh = 42_350.0,
            peakPowerW = 121_000.0,
            avgPowerW = 56_500.0,
            startSocPct = 18.0,
            endSocPct = 82.0,
            costDecimal = 12.4,
            startPlace = "Supercharger — Fremont",
        )

    private fun setContent(
        state: UiState<ChargingSession>,
        onRetry: () -> Unit = {},
    ) {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                Host {
                    SessionDetailPanelContent(
                        state = state,
                        onRetry = onRetry,
                        format = SessionDetailFormat("$", 2),
                        locale = Locale.US,
                        zoneId = ZoneId.of("UTC"),
                        strings = strings,
                    )
                }
            }
        }
    }

    @Test
    fun contentShowsHeaderEveryLabelAndRepresentativeValues() {
        setContent(UiState(phase = UiPhase.Content, data = session))
        compose.onNodeWithText(strings.title).assertIsDisplayed()
        // Every row label is exposed to TalkBack.
        compose.onNodeWithText(strings.date).assertExists()
        compose.onNodeWithText(strings.chargerType).assertExists()
        compose.onNodeWithText(strings.socRange).assertExists()
        compose.onNodeWithText(strings.energyAdded).assertExists()
        compose.onNodeWithText(strings.peakPower).assertExists()
        compose.onNodeWithText(strings.avgPower).assertExists()
        compose.onNodeWithText(strings.duration).assertExists()
        compose.onNodeWithText(strings.cost).assertExists()
        compose.onNodeWithText(strings.location).assertExists()
        // A representative formatted value from each region.
        compose.onNodeWithText("Supercharger").assertExists()
        compose.onNodeWithText("18% \u2192 82%").assertExists()
        compose.onNodeWithText("42.35 kWh").assertExists()
        compose.onNodeWithText("121.00 kW").assertExists()
        compose.onNodeWithText("56.50 kW").assertExists()
        compose.onNodeWithText("45.00 min").assertExists()
        compose.onNodeWithText("$12.40").assertExists()
        compose.onNodeWithText("Supercharger — Fremont").assertExists()
    }

    @Test
    fun loadingShowsTitleChromeButNoRows() {
        setContent(UiState.loading())
        // The header is static chrome and stays visible; the value rows are replaced by skeletons.
        compose.onNodeWithText(strings.title).assertExists()
        compose.onNodeWithText(strings.energyAdded).assertDoesNotExist()
        compose.onNodeWithText("42.35 kWh").assertDoesNotExist()
    }

    @Test
    fun emptyStillRendersTitleAndAFriendlyMessage() {
        setContent(UiState(phase = UiPhase.Empty))
        // The empty phase keeps the header and shows the no-data message, never a blank box.
        compose.onNodeWithText(strings.title).assertExists()
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
    fun offlineStaleStillShowsCachedRows() {
        setContent(
            UiState(
                phase = UiPhase.Content,
                data = session,
                stale = true,
                fetchedAt = 1_700_000_000_000L,
                errorKind = ErrorKind.Network,
            ),
        )
        // Stale/offline keeps the cached panel visible (never blanks) — the "last known" contract.
        compose.onNodeWithText(strings.title).assertIsDisplayed()
        compose.onNodeWithText("42.35 kWh").assertExists()
    }

    @Test
    fun staleContentAutoRefreshes() {
        var refreshed = false
        setContent(
            UiState(phase = UiPhase.Content, data = session, stale = true, fetchedAt = 1_700_000_000_000L),
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
