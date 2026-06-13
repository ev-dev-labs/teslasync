package io.teslasync.android.featureviews.securitysection

import androidx.compose.runtime.Composable
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import io.teslasync.android.R
import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.shared.core.api.generated.VehicleState
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test

/**
 * On-device Compose UI + accessibility verification of [SecuritySectionContent] across every state the web
 * component renders (loading skeletons, the four-card grid, empty → no-data message, hard error with retry,
 * stale/offline cached). Asserts the rendered i18n strings + values are present, the loading skeleton exposes
 * its "Loading" content description for TalkBack, and the error-retry control fires. Runs under
 * `connectedAndroidTest` (a device/emulator) — the offline gate's `testReleaseUnitTest` covers the
 * projection/state logic; this covers the render + a11y.
 */
class SecuritySectionUiTest {
    @get:Rule
    val compose = createComposeRule()

    @Composable
    private fun strings(): SecuritySectionStrings =
        SecuritySectionStrings(
            title = stringResource(R.string.translation_vehicles_detail_security),
            locked = stringResource(R.string.translation_common_locked),
            yes = stringResource(R.string.translation_common_yes),
            no = stringResource(R.string.translation_common_no),
            sentry = stringResource(R.string.translation_common_sentry),
            active = stringResource(R.string.translation_common_active),
            off = stringResource(R.string.translation_common_off),
            doors = stringResource(R.string.translation_vehicles_detail_doors),
            closed = stringResource(R.string.translation_common_closed),
            windows = stringResource(R.string.translation_vehicles_detail_windows),
            windowsOpenTemplate = stringResource(R.string.translation_vehicles_detail_windowsOpen),
            noData = stringResource(R.string.translation_vehicles_detail_noSecurityData),
        )

    private fun snapshot(): SecuritySnapshot = SecuritySnapshot(security = securityEvent(), state = vehicleState())

    private fun setContent(
        state: UiState<SecuritySnapshot>,
        onRefresh: () -> Unit = {},
    ) {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                SecuritySectionContent(state = state, strings = strings(), onRefresh = onRefresh)
            }
        }
    }

    private fun contentState(): UiState<SecuritySnapshot> = UiState(phase = UiPhase.Content, data = snapshot(), fetchedAt = 1L)

    @Test
    fun loadingShowsSkeletonNotCards() {
        setContent(UiState.loading())
        compose.onNodeWithContentDescription("Loading").assertIsDisplayed()
        compose.onNodeWithText("Locked").assertDoesNotExist()
    }

    @Test
    fun contentShowsTitleLabelsAndValues() {
        setContent(contentState())
        compose.onNodeWithText("Security").assertIsDisplayed()
        compose.onNodeWithText("Locked").assertIsDisplayed()
        compose.onNodeWithText("Sentry").assertIsDisplayed()
        compose.onNodeWithText("Doors").assertIsDisplayed()
        compose.onNodeWithText("Windows").assertIsDisplayed()
        // is_locked → "Yes", sentry_mode → "Active", door_state "df_closed", one open window → "1 open".
        compose.onNodeWithText("Yes").assertIsDisplayed()
        compose.onNodeWithText("Active").assertIsDisplayed()
        compose.onNodeWithText("df_closed").assertIsDisplayed()
        compose.onNodeWithText("1 open").assertIsDisplayed()
    }

    @Test
    fun emptyShowsNoDataMessageNotCards() {
        setContent(UiState(phase = UiPhase.Empty, data = SecuritySnapshot.EMPTY, fetchedAt = 1L))
        compose.onNodeWithText("No security data available").assertIsDisplayed()
        compose.onNodeWithText("Locked").assertDoesNotExist()
    }

    @Test
    fun errorShowsQueryErrorWithRetryAndKeepsTitle() {
        var refreshed = false
        setContent(UiState(phase = UiPhase.Error, errorKind = ErrorKind.Network), onRefresh = { refreshed = true })
        compose.onNodeWithText("Security").assertIsDisplayed()
        compose.onNodeWithText("Locked").assertDoesNotExist()
        compose.onNodeWithText("Retry").performClick()
        assertTrue(refreshed)
    }

    @Test
    fun offlineKeepsCachedCardsVisible() {
        setContent(
            UiState(
                phase = UiPhase.Content,
                data = snapshot(),
                fetchedAt = 1L,
                stale = true,
                errorKind = ErrorKind.Network,
            ),
        )
        compose.onNodeWithText("Yes").assertIsDisplayed()
        compose.onNodeWithText("1 open").assertIsDisplayed()
    }

    private fun securityEvent(): JsonObject =
        buildJsonObject {
            put("door_state", "df_closed")
            put("fd_window", true)
        }

    private fun vehicleState(): VehicleState =
        VehicleState(
            batteryLevel = 80,
            chargeRate = 0.0,
            chargerPower = 0.0,
            idealRange = 0.0,
            insideTemp = 21.0,
            isCharging = false,
            isClimateOn = false,
            isLocked = true,
            latitude = 0.0,
            longitude = 0.0,
            odometer = 0.0,
            outsideTemp = 15.0,
            power = 0.0,
            ratedRange = 0.0,
            sentryMode = true,
            softwareVersion = "2025.0",
            speed = 0.0,
            state = "online",
            timeToFullCharge = 0.0,
            vehicleId = 1L,
        )
}
