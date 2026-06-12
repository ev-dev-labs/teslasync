package io.teslasync.android.featureviews.chargingsessioncard

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
import io.teslasync.shared.core.api.generated.ChargingSession
import io.teslasync.shared.core.units.DistanceUnitPref
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import java.time.ZoneId
import java.util.Locale
import kotlin.time.Instant

/**
 * Instrumented Compose UI + accessibility verification of [ChargingSessionCardContent] across every branch the
 * web component renders (the leading score badge, the timestamp/duration + charger/energy/free/anomaly badges,
 * the route, and the metrics chips) plus the lifecycle chrome the host's feed implies (a loading skeleton, a
 * hard-error retry surface, a friendly empty body, and the stale/offline freshness chip). Asserts the rendered
 * values are exposed to TalkBack, that the selection checkbox and score badge carry accessible labels, that the
 * empty state never blanks, and that the retry affordance carries an accessible click action. Runs under
 * `connectedAndroidTest`; the offline gate's `testReleaseUnitTest` covers the pure projection. Mirrors the web
 * spec (web/src/features/charging/components/ChargingSessionCard.tsx).
 */
class ChargingSessionCardUiTest {
    @get:Rule
    val compose = createComposeRule()

    private val strings =
        ChargingSessionCardStrings(
            chargerSupercharger = "Supercharger",
            chargerDcFast = "DC Fast",
            chargerHomeAc = "Home / AC",
            chargerUnknown = "Charger",
            free = "Free",
            peakPower = "Peak Power",
            avgPower = "Avg Power",
        )

    private val session =
        ChargingSession(
            id = 1L,
            startedAt = Instant.parse("2026-04-04T09:30:00Z"),
            vehicleId = 7L,
            chargerType = "Supercharger V3",
            endedAt = Instant.parse("2026-04-04T10:15:00Z"),
            totalEnergyAddedWh = 42_350.0,
            peakPowerW = 121_000.0,
            avgPowerW = 56_500.0,
            startSocPct = 18.0,
            endSocPct = 82.0,
            costDecimal = 12.4,
            startPlace = "Supercharger — Fremont",
            startOdometerM = 1_000_000.0,
            endOdometerM = 1_200_000.0,
        )

    private fun setContent(
        state: UiState<ChargingSession>,
        onRetry: () -> Unit = {},
        onToggleSelect: ((Long, Boolean) -> Unit)? = null,
        selected: Boolean = false,
    ) {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                Host {
                    ChargingSessionCardContent(
                        state = state,
                        onRetry = onRetry,
                        format = ChargingSessionCardFormat("$", 2, DistanceUnitPref.KM),
                        locale = Locale.US,
                        zone = ZoneId.of("UTC"),
                        selected = selected,
                        onToggleSelect = onToggleSelect,
                        onOpen = {},
                        strings = strings,
                    )
                }
            }
        }
    }

    @Test
    fun contentShowsTimestampBadgesAndMetricChips() {
        setContent(UiState(phase = UiPhase.Content, data = session))
        compose.onNodeWithText("Supercharger").assertIsDisplayed()
        compose.onNodeWithText("42.35 kWh").assertExists()
        compose.onNodeWithText("121.00 kW Peak Power").assertExists()
        compose.onNodeWithText("~56.47 kW Avg Power").assertExists()
        compose.onNodeWithText("$12.40").assertExists()
        compose.onNodeWithText("($0.29/kWh)").assertExists()
        compose.onNodeWithText("+200 km").assertExists()
        compose.onNodeWithText("Supercharger — Fremont").assertExists()
    }

    @Test
    fun contentExposesScoreBadgeLabelToTalkBack() {
        setContent(UiState(phase = UiPhase.Content, data = session))
        // The leading battery-friendly score badge carries the localized "Battery-Friendly Score: 80" label.
        compose.onNodeWithContentDescription("Battery-Friendly Score: 80").assertExists()
    }

    @Test
    fun selectionCheckboxIsLabeledAndToggles() {
        var toggledId: Long? = null
        var toggledOn: Boolean? = null
        setContent(
            UiState(phase = UiPhase.Content, data = session),
            onToggleSelect = { id, on ->
                toggledId = id
                toggledOn = on
            },
            selected = false,
        )
        val checkbox = compose.onNodeWithContentDescription("Select charging session")
        checkbox.assertHasClickAction()
        checkbox.performClick()
        assertEquals(1L, toggledId)
        assertEquals(true, toggledOn)
    }

    @Test
    fun loadingShowsSkeletonNotContent() {
        setContent(UiState.loading())
        compose.onNodeWithText("42.35 kWh").assertDoesNotExist()
        compose.onNodeWithText("Supercharger").assertDoesNotExist()
    }

    @Test
    fun emptyRendersAFriendlyMessageNeverBlank() {
        setContent(UiState(phase = UiPhase.Empty))
        compose.onNodeWithText("No data available").assertExists()
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
    fun offlineStaleStillShowsCachedRow() {
        setContent(
            UiState(
                phase = UiPhase.Content,
                data = session,
                stale = true,
                fetchedAt = 1_700_000_000_000L,
                errorKind = ErrorKind.Network,
            ),
        )
        // Stale/offline keeps the cached row visible (never blanks) — the "last known" contract.
        compose.onNodeWithText("42.35 kWh").assertExists()
        compose.onNodeWithText("Supercharger").assertExists()
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
