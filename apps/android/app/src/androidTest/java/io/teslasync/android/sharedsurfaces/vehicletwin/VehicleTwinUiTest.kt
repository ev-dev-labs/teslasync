package io.teslasync.android.sharedsurfaces.vehicletwin

import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.test.platform.app.InstrumentationRegistry
import io.teslasync.android.R
import io.teslasync.android.components.motion.LocalReducedMotion
import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.shared.core.api.generated.Vehicle
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.flowOf
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import kotlin.time.Instant

/**
 * On-device Compose UI + accessibility verification of the VehicleTwin shared surface across every state the web
 * component drives (web/src/components/vehicles/VehicleTwin.tsx): the loading silhouette skeleton, the painted twin
 * content with its full `role=Image` physical-state summary (a11y label test), the friendly empty state, the
 * stale/offline freshness chips, the classified error with a working Retry, and the stateful path bound end to end
 * against the real ViewModel + source seam. Runs under `connectedAndroidTest`; the `testReleaseUnitTest` gate
 * covers the pure projection, this covers the render.
 */
class VehicleTwinUiTest {
    @get:Rule
    val compose = createComposeRule()

    private object NoopLogger : Logger {
        override fun log(
            level: LogLevel,
            event: String,
            fields: Map<String, String>,
        ) = Unit
    }

    private class FakeSource(
        private val fleet: List<Vehicle>,
        initialSelectedId: Long?,
    ) : VehicleTwinSource {
        private val mutableSelectedId = MutableStateFlow(initialSelectedId)
        private val override = MutableStateFlow<PaintPaletteId?>(null)

        override val selectedId: StateFlow<Long?> = mutableSelectedId

        override fun vehicles(): Flow<Resource<List<Vehicle>>> = flowOf(Resource.Success(fleet, fetchedAt = STAMP, stale = false))

        override fun paintOverride(vehicleId: Long?): StateFlow<PaintPaletteId?> = override

        override fun setPaint(
            vehicleId: Long,
            id: PaintPaletteId?,
        ) {
            override.value = id
        }

        override fun reconcile(availableIds: List<Long>) {
            if (mutableSelectedId.value == null && availableIds.isNotEmpty()) mutableSelectedId.value = availableIds.first()
        }
    }

    private fun labels(): VehicleTwinLabels {
        val ctx = InstrumentationRegistry.getInstrumentation().targetContext
        return VehicleTwinLabels(
            twinTitle = ctx.getString(R.string.translation_digitalTwin_subtitle),
            open = ctx.getString(R.string.translation_common_open),
            closed = ctx.getString(R.string.translation_common_closed),
            partial = ctx.getString(R.string.translation_widget_doorWindow_partial),
            unknown = ctx.getString(R.string.translation_common_unknown),
            locked = ctx.getString(R.string.translation_digitalTwin_locked),
            unlocked = ctx.getString(R.string.translation_common_unlocked),
            charging = ctx.getString(R.string.translation_digitalTwin_charging),
            driving = ctx.getString(R.string.translation_digitalTwin_driving),
            sentry = ctx.getString(R.string.translation_digitalTwin_sentryMode),
            headlights = ctx.getString(R.string.translation_digitalTwin_headlights),
            doors = ctx.getString(R.string.translation_digitalTwin_doorsTitle),
            windows = ctx.getString(R.string.translation_digitalTwin_windowsTitle),
        )
    }

    private fun strings(): VehicleTwinStrings {
        val ctx = InstrumentationRegistry.getInstrumentation().targetContext
        return VehicleTwinStrings(
            loadingLabel = ctx.getString(R.string.translation_common_loading),
            emptyTitle = ctx.getString(R.string.translation_digitalTwin_title),
            emptyDesc = ctx.getString(R.string.translation_digitalTwin_noVehicles),
            staleLabel = ctx.getString(R.string.translation_mqtt_stale),
            offlineLabel = ctx.getString(R.string.translation_common_offline),
            updatingLabel = ctx.getString(R.string.translation_freshness_updating),
            errorResource = ctx.getString(R.string.translation_common_vehicle),
            labels = labels(),
        )
    }

    private fun vehicle(
        id: Long,
        color: String?,
    ): Vehicle =
        Vehicle(
            createdAt = Instant.parse("2026-01-01T00:00:00Z"),
            displayName = "Car $id",
            enrolledAt = Instant.parse("2026-01-01T00:00:00Z"),
            id = id,
            teslaId = 1000 + id,
            timezone = "UTC",
            updatedAt = Instant.parse("2026-01-01T00:10:00Z"),
            vin = "VIN$id",
            color = color,
        )

    private fun data(id: PaintPaletteId): VehicleTwinData =
        VehicleTwinData(PAINT_PALETTES.getValue(id), vehicleLabel = "Car 1", hasVehicle = true, overridden = false)

    private val activeState =
        VehicleTwinState(
            doors = DoorStates(driverFront = true),
            windowFD = WindowState.Open,
            locked = true,
            isCharging = true,
            sentryMode = true,
            headlights = true,
        )

    @Test
    fun loadingStateAnnouncesTheLoadingLabel() {
        val s = strings()
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                CompositionLocalProvider(LocalReducedMotion provides true) {
                    VehicleTwinContent(state = UiState.loading(), twinState = EMPTY_TWIN_STATE, strings = s)
                }
            }
        }
        compose.onNodeWithTag(VEHICLE_TWIN_TEST_TAG).assertIsDisplayed()
        compose.onNodeWithContentDescription(s.loadingLabel).assertIsDisplayed()
    }

    @Test
    fun contentStateRendersTheTwinWithItsPhysicalStateSummary() {
        val s = strings()
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                CompositionLocalProvider(LocalReducedMotion provides true) {
                    VehicleTwinContent(
                        state = UiState(UiPhase.Content, data = data(PaintPaletteId.RedMulticoat)),
                        twinState = activeState,
                        strings = s,
                    )
                }
            }
        }
        compose.onNodeWithTag(VEHICLE_TWIN_CANVAS_TEST_TAG).assertIsDisplayed()
        val expected = vehicleTwinAccessibilitySummary(activeState, s.labels)
        compose.onNodeWithContentDescription(expected).assertIsDisplayed()
    }

    @Test
    fun emptyStateShowsTheFriendlyEmptyState() {
        val s = strings()
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                CompositionLocalProvider(LocalReducedMotion provides true) {
                    VehicleTwinContent(
                        state = UiState(UiPhase.Empty, data = VehicleTwinData.EMPTY),
                        twinState = EMPTY_TWIN_STATE,
                        strings = s,
                    )
                }
            }
        }
        compose.onNodeWithTag(VEHICLE_TWIN_TEST_TAG).assertIsDisplayed()
        compose.onNodeWithContentDescription(s.emptyTitle).assertIsDisplayed()
    }

    @Test
    fun staleStateShowsTheStaleFreshnessChip() {
        val s = strings()
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                CompositionLocalProvider(LocalReducedMotion provides true) {
                    VehicleTwinContent(
                        state = UiState(UiPhase.Content, data = data(PaintPaletteId.DeepBlue), fetchedAt = STAMP, stale = true),
                        twinState = EMPTY_TWIN_STATE,
                        strings = s,
                    )
                }
            }
        }
        compose.onNodeWithText(s.staleLabel).assertIsDisplayed()
    }

    @Test
    fun offlineStateShowsTheOfflineFreshnessChip() {
        val s = strings()
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                CompositionLocalProvider(LocalReducedMotion provides true) {
                    VehicleTwinContent(
                        state =
                            UiState(
                                UiPhase.Content,
                                data = data(PaintPaletteId.DeepBlue),
                                fetchedAt = STAMP,
                                stale = true,
                                errorKind = ErrorKind.Network,
                            ),
                        twinState = EMPTY_TWIN_STATE,
                        strings = s,
                    )
                }
            }
        }
        compose.onNodeWithText(s.offlineLabel).assertIsDisplayed()
    }

    @Test
    fun errorStateOffersAWorkingRetry() {
        var retried = false
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                CompositionLocalProvider(LocalReducedMotion provides true) {
                    VehicleTwinContent(
                        state = UiState(UiPhase.Error, errorKind = ErrorKind.Http, httpStatus = HTTP_SERVER_ERROR),
                        twinState = EMPTY_TWIN_STATE,
                        strings = strings(),
                        onRetry = { retried = true },
                    )
                }
            }
        }
        compose.onNodeWithText("Retry").assertIsDisplayed()
        compose.onNodeWithText("Retry").performClick()
        assertTrue(retried)
    }

    @Test
    fun statefulVehicleTwinBindsTheFleetAndRendersTheCanvas() {
        val source = FakeSource(listOf(vehicle(1, color = "DeepBlue")), initialSelectedId = 1L)
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                CompositionLocalProvider(LocalReducedMotion provides true) {
                    VehicleTwin(source = source, logger = NoopLogger)
                }
            }
        }
        compose.waitForIdle()
        compose.onNodeWithTag(VEHICLE_TWIN_CANVAS_TEST_TAG).assertIsDisplayed()
    }

    private companion object {
        const val STAMP = 1_700_000_000_000L
        const val HTTP_SERVER_ERROR = 503
    }
}
