package io.teslasync.android.dashboard.widgets.digitaltwinmini

import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import io.teslasync.android.sharedsurfaces.vehicletwin.VEHICLE_TWIN_CANVAS_TEST_TAG
import io.teslasync.android.sharedsurfaces.vehicletwin.VehicleTwinLabels
import io.teslasync.android.sharedsurfaces.vehicletwin.VehicleTwinStrings
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.shared.core.api.generated.Vehicle
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import kotlin.time.Instant

/**
 * On-device Compose UI + accessibility verification of [DigitalTwinMiniWidgetContent] across every state
 * the web component renders (loading skeleton, the twin illustration + lock/sentry status badges + "Open"
 * link, the unlocked variant, the no-vehicle empty state, the hard error + retry, the stale/offline cached
 * twin). Asserts the rendered i18n strings, the shared twin canvas, and the merged TalkBack descriptions
 * are present. Runs under `connectedAndroidTest` (a device/emulator) — the offline gate's
 * `testReleaseUnitTest` covers the logic; this covers the render + a11y.
 */
class DigitalTwinMiniWidgetUiTest {
    @get:Rule
    val compose = createComposeRule()

    private fun setContent(
        state: UiState<DigitalTwinMiniData>,
        size: DigitalTwinMiniSize = DigitalTwinMiniRegistration.DEFAULT_SIZE,
        onRefresh: () -> Unit = {},
        onOpen: () -> Unit = {},
    ) {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                DigitalTwinMiniWidgetContent(
                    state = state,
                    strings = strings(),
                    twinStrings = twinStrings(),
                    size = size,
                    onRefresh = onRefresh,
                    onOpen = onOpen,
                )
            }
        }
    }

    @Test
    fun loadingShowsAccessibleSkeletonChrome() {
        setContent(UiState(UiPhase.Loading))
        compose.onNodeWithContentDescription("Loading", substring = true).assertIsDisplayed()
    }

    @Test
    fun contentShowsTitleTwinBadgesAndOpenLink() {
        setContent(contentState(security = securedSnapshot(locked = true, sentry = true)))
        compose.onNodeWithText("Digital Twin").assertIsDisplayed()
        compose.onNodeWithTag(VEHICLE_TWIN_CANVAS_TEST_TAG).assertIsDisplayed()
        compose.onNodeWithText("Locked").assertIsDisplayed()
        compose.onNodeWithText("Sentry").assertIsDisplayed()
        compose.onNodeWithText("Open").assertIsDisplayed()
    }

    @Test
    fun unlockedContentShowsUnlockedAndSentryOff() {
        setContent(contentState(security = securedSnapshot(locked = false, sentry = false)))
        compose.onNodeWithText("Unlocked").assertIsDisplayed()
        compose.onNodeWithText("Off").assertIsDisplayed()
    }

    @Test
    fun twinCanvasExposesAccessibleStateSummary() {
        setContent(contentState(security = securedSnapshot(locked = true, sentry = true)))
        // The shared illustration carries the full physical state as one spoken role=Image summary.
        compose.onNodeWithContentDescription("Real-time vehicle physical state", substring = true).assertIsDisplayed()
    }

    @Test
    fun emptyShowsNoVehicleMessage() {
        setContent(UiState(UiPhase.Empty, data = DigitalTwinMiniData(null, null, null, null), fetchedAt = NOW))
        compose.onNodeWithText("No vehicle data").assertIsDisplayed()
    }

    @Test
    fun errorShowsRetryAffordanceAndInvokesRefresh() {
        var retried = false
        setContent(UiState(UiPhase.Error, errorKind = ErrorKind.Network), onRefresh = { retried = true })
        compose.onNodeWithText("Server error").assertIsDisplayed()
        compose.onNodeWithText("Retry").performClick()
        assertTrue(retried)
    }

    @Test
    fun openLinkInvokesCallback() {
        var opened = false
        setContent(contentState(security = securedSnapshot(locked = true, sentry = true)), onOpen = { opened = true })
        compose.onNodeWithText("Open").performClick()
        assertTrue(opened)
    }

    @Test
    fun contentHeaderExposesRefreshAction() {
        setContent(contentState(security = securedSnapshot(locked = true, sentry = true)))
        compose.onNodeWithContentDescription("Refresh").assertIsDisplayed()
    }

    @Test
    fun offlineKeepsCachedTwinVisible() {
        setContent(
            UiState(
                UiPhase.Content,
                data = DigitalTwinMiniData(vehicle(), null, securedSnapshot(locked = true, sentry = true), null),
                fetchedAt = NOW,
                stale = true,
                errorKind = ErrorKind.Timeout,
            ),
        )
        // Cached values stay visible (never blanked) when offline/stale.
        compose.onNodeWithTag(VEHICLE_TWIN_CANVAS_TEST_TAG).assertIsDisplayed()
        compose.onNodeWithText("Locked").assertIsDisplayed()
    }

    private fun contentState(security: JsonObject): UiState<DigitalTwinMiniData> =
        UiState(
            UiPhase.Content,
            data = DigitalTwinMiniData(vehicle(), null, security, null),
            fetchedAt = NOW,
        )

    private fun securedSnapshot(
        locked: Boolean,
        sentry: Boolean,
    ): JsonObject =
        buildJsonObject {
            put("locked", locked)
            put("sentry_mode", sentry)
        }

    private fun vehicle(): Vehicle =
        Vehicle(
            createdAt = Instant.fromEpochSeconds(0),
            displayName = "Garage Car",
            enrolledAt = Instant.fromEpochSeconds(0),
            id = 5,
            teslaId = 5,
            timezone = "UTC",
            updatedAt = Instant.fromEpochSeconds(0),
            vin = "VIN5",
            color = "DeepBlue",
            model = "Model 3",
        )

    private fun strings(): DigitalTwinMiniStrings =
        DigitalTwinMiniStrings(
            digitalTwin = "Digital Twin",
            open = "Open",
            locked = "Locked",
            unlocked = "Unlocked",
            sentry = "Sentry",
            off = "Off",
            noVehicle = "No vehicle data",
        )

    private fun twinStrings(): VehicleTwinStrings =
        VehicleTwinStrings(
            loadingLabel = "Loading",
            emptyTitle = "Digital Twin",
            emptyDesc = "No vehicles found.",
            staleLabel = "Stale",
            offlineLabel = "Offline",
            updatingLabel = "updating",
            errorResource = "Vehicle",
            labels =
                VehicleTwinLabels(
                    twinTitle = "Real-time vehicle physical state",
                    open = "Open",
                    closed = "Closed",
                    partial = "Partial",
                    unknown = "Unknown",
                    locked = "Locked",
                    unlocked = "Unlocked",
                    charging = "Charging",
                    driving = "Driving",
                    sentry = "Sentry Mode",
                    headlights = "Headlights",
                    doors = "Doors",
                    windows = "Windows",
                ),
        )

    private companion object {
        const val NOW = 1_780_000_000_000L
    }
}
