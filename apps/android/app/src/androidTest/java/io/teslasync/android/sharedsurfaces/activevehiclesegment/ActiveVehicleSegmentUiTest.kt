// On-device Compose UI + accessibility verification of the ActiveVehicleSegment shared surface across every state
// the web component drives (web/src/components/layout/status-bar/ActiveVehicleSegment.tsx): the loading skeleton,
// the single-vehicle static chip with its "Active vehicle: {label}" TalkBack label (a11y label test), the
// multi-vehicle switcher trigger with its "Switch vehicle ({label})" label that opens the vehicle listbox, the
// friendly empty state (the web returns null), the stale/offline freshness chips, and the classified error with a
// working Retry; the stateful path is exercised end to end against the real ViewModel + source seam. Runs under
// `connectedAndroidTest`; the `testReleaseUnitTest` gate covers the pure projection, this covers the render.

package io.teslasync.android.sharedsurfaces.activevehiclesegment

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
import io.teslasync.android.data.UnitFormatter
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.shared.core.api.generated.Vehicle
import io.teslasync.shared.core.api.generated.VehicleState
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.presentation.vehicles.VehicleStateEnvelope
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.flowOf
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import kotlin.time.Instant

class ActiveVehicleSegmentUiTest {
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
    ) : ActiveVehicleSegmentSource {
        private val mutableSelectedId = MutableStateFlow(initialSelectedId)

        override val selectedId: StateFlow<Long?> = mutableSelectedId
        override val units: StateFlow<UnitFormatter> = MutableStateFlow(UnitFormatter.default())

        override fun vehicles(): Flow<Resource<List<Vehicle>>> = flowOf(Resource.Success(fleet, fetchedAt = STAMP, stale = false))

        override fun vehicleState(vehicleId: Long): Flow<Resource<VehicleStateEnvelope>> =
            flowOf(Resource.Success(VehicleStateEnvelope(state(vehicleId), live = true), fetchedAt = STAMP, stale = false))

        override fun select(id: Long) {
            mutableSelectedId.value = id
        }

        override fun reconcile(availableIds: List<Long>) {
            mutableSelectedId.value = effectiveSelectedId(mutableSelectedId.value, availableIds)
        }
    }

    private fun strings(): ActiveVehicleSegmentStrings {
        val ctx = InstrumentationRegistry.getInstrumentation().targetContext
        return ActiveVehicleSegmentStrings(
            fallbackWord = ctx.getString(R.string.translation_statusBar_vehicle_fallback),
            noneWord = ctx.getString(R.string.translation_statusBar_vehicle_none),
            tooltipWord = ctx.getString(R.string.translation_statusBar_vehicle_tooltip),
            ariaWord = ctx.getString(R.string.translation_statusBar_vehicle_aria),
            switchWord = ctx.getString(R.string.translation_statusBar_vehicle_switch),
            loadingLabel = ctx.getString(R.string.translation_common_loading),
            staleLabel = ctx.getString(R.string.translation_mqtt_stale),
            offlineLabel = ctx.getString(R.string.translation_common_offline),
            updatingLabel = ctx.getString(R.string.translation_freshness_updating),
            emptyTitle = ctx.getString(R.string.translation_common_noVehicleSelected_title),
            emptyDesc = ctx.getString(R.string.translation_common_noVehicleSelected_desc),
            errorResource = ctx.getString(R.string.translation_common_vehicle),
        )
    }

    private fun fleetData(
        selectedId: Long,
        count: Int,
    ): ActiveVehicleSegmentData =
        ActiveVehicleSegmentData(
            vehicles =
                listOf(
                    ActiveVehicleRow(1, "Red Rocket", "VIN1", "Model 3", selected = selectedId == 1L),
                    ActiveVehicleRow(2, "Spacehauler", "VIN2", "Model Y", selected = selectedId == 2L),
                ).take(count),
            effectiveSelectedId = selectedId,
            metricsLabel = "82% \u00B7 240 mi",
        )

    @Test
    fun loadingStateAnnouncesTheLoadingLabel() {
        val labels = strings()
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                CompositionLocalProvider(LocalReducedMotion provides true) {
                    ActiveVehicleSegmentContent(state = UiState.loading(), strings = labels)
                }
            }
        }
        compose.onNodeWithTag(ACTIVE_VEHICLE_SEGMENT_TEST_TAG).assertIsDisplayed()
        compose.onNodeWithContentDescription(labels.loadingLabel).assertIsDisplayed()
    }

    @Test
    fun singleVehicleShowsStaticChipWithAccessibleLabel() {
        val labels = strings()
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                CompositionLocalProvider(LocalReducedMotion provides true) {
                    ActiveVehicleSegmentContent(state = UiState(UiPhase.Content, data = fleetData(1, 1)), strings = labels)
                }
            }
        }
        compose.onNodeWithTag(ACTIVE_VEHICLE_SEGMENT_TEST_TAG).assertIsDisplayed()
        val expected = activeVehicleAccessibilityLabel(labels.ariaWord, "Red Rocket")
        compose.onNodeWithContentDescription(expected).assertIsDisplayed()
    }

    @Test
    fun switcherExposesTheTriggerWithAccessibleLabel() {
        val labels = strings()
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                CompositionLocalProvider(LocalReducedMotion provides true) {
                    ActiveVehicleSegmentContent(state = UiState(UiPhase.Content, data = fleetData(1, 2)), strings = labels)
                }
            }
        }
        compose.onNodeWithTag(ACTIVE_VEHICLE_SEGMENT_TRIGGER_TEST_TAG).assertIsDisplayed()
        val expected = switchVehicleAccessibilityLabel(labels.switchWord, "Red Rocket")
        compose.onNodeWithContentDescription(expected).assertIsDisplayed()
    }

    @Test
    fun switcherOpensTheVehicleListboxOnClick() {
        val labels = strings()
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                CompositionLocalProvider(LocalReducedMotion provides true) {
                    ActiveVehicleSegmentContent(state = UiState(UiPhase.Content, data = fleetData(1, 2)), strings = labels)
                }
            }
        }
        compose.onNodeWithTag(ACTIVE_VEHICLE_SEGMENT_TRIGGER_TEST_TAG).performClick()
        compose.onNodeWithTag(ACTIVE_VEHICLE_SEGMENT_MENU_TEST_TAG).assertIsDisplayed()
        compose.onNodeWithText("Spacehauler").assertIsDisplayed()
    }

    @Test
    fun iconOnlyVariantRendersTheChip() {
        val labels = strings()
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                CompositionLocalProvider(LocalReducedMotion provides true) {
                    ActiveVehicleSegmentContent(
                        state = UiState(UiPhase.Content, data = fleetData(1, 1)),
                        strings = labels,
                        iconOnly = true,
                    )
                }
            }
        }
        // Icon-only mode renders the car-icon chip without the label / metrics chrome (web `iconOnly`).
        compose.onNodeWithTag(ACTIVE_VEHICLE_SEGMENT_TEST_TAG).assertIsDisplayed()
    }

    @Test
    fun emptyStateShowsTheFriendlyEmptyState() {
        val labels = strings()
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                CompositionLocalProvider(LocalReducedMotion provides true) {
                    ActiveVehicleSegmentContent(state = UiState(UiPhase.Empty, data = ActiveVehicleSegmentData.EMPTY), strings = labels)
                }
            }
        }
        compose.onNodeWithTag(ACTIVE_VEHICLE_SEGMENT_TEST_TAG).assertIsDisplayed()
        compose.onNodeWithContentDescription(labels.emptyTitle).assertIsDisplayed()
    }

    @Test
    fun staleStateShowsTheStaleFreshnessChip() {
        val labels = strings()
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                CompositionLocalProvider(LocalReducedMotion provides true) {
                    ActiveVehicleSegmentContent(
                        state = UiState(UiPhase.Content, data = fleetData(1, 1), fetchedAt = STAMP, stale = true),
                        strings = labels,
                    )
                }
            }
        }
        compose.onNodeWithText(labels.staleLabel).assertIsDisplayed()
    }

    @Test
    fun offlineStateShowsTheOfflineFreshnessChip() {
        val labels = strings()
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                CompositionLocalProvider(LocalReducedMotion provides true) {
                    ActiveVehicleSegmentContent(
                        state =
                            UiState(
                                UiPhase.Content,
                                data = fleetData(1, 1),
                                fetchedAt = STAMP,
                                stale = true,
                                errorKind = ErrorKind.Network,
                            ),
                        strings = labels,
                    )
                }
            }
        }
        compose.onNodeWithText(labels.offlineLabel).assertIsDisplayed()
    }

    @Test
    fun errorStateOffersAWorkingRetry() {
        var retried = false
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                CompositionLocalProvider(LocalReducedMotion provides true) {
                    ActiveVehicleSegmentContent(
                        state = UiState(UiPhase.Error, errorKind = ErrorKind.Http, httpStatus = HTTP_SERVER_ERROR),
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
    fun statefulSegmentBindsTheFleetAndRendersTrigger() {
        val source = FakeSource(listOf(vehicle(1, "Grace"), vehicle(2, "Ada")), initialSelectedId = 1L)
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                CompositionLocalProvider(LocalReducedMotion provides true) {
                    ActiveVehicleSegment(source = source, logger = NoopLogger)
                }
            }
        }
        compose.waitForIdle()
        compose.onNodeWithTag(ACTIVE_VEHICLE_SEGMENT_TRIGGER_TEST_TAG).assertIsDisplayed()
    }
}

private const val STAMP = 1_700_000_000_000L
private const val HTTP_SERVER_ERROR = 503

private fun vehicle(
    id: Long,
    name: String,
): Vehicle =
    Vehicle(
        createdAt = Instant.parse("2026-01-01T00:00:00Z"),
        displayName = name,
        enrolledAt = Instant.parse("2026-01-01T00:00:00Z"),
        id = id,
        teslaId = 1000 + id,
        timezone = "UTC",
        updatedAt = Instant.parse("2026-01-01T00:10:00Z"),
        vin = "VIN$id",
        model = "Model 3",
    )

private fun state(vehicleId: Long): VehicleState =
    VehicleState(
        batteryLevel = 82,
        chargeRate = 0.0,
        chargerPower = 0.0,
        idealRange = 482803.2,
        insideTemp = 0.0,
        isCharging = false,
        isClimateOn = false,
        isLocked = true,
        latitude = 0.0,
        longitude = 0.0,
        odometer = 0.0,
        outsideTemp = 0.0,
        power = 0.0,
        ratedRange = 482803.2,
        sentryMode = false,
        softwareVersion = "2026.0",
        speed = 0.0,
        state = "online",
        timeToFullCharge = 0.0,
        vehicleId = vehicleId,
    )
