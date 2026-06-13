package io.teslasync.android.sharedsurfaces.vehicleselect

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
 * On-device Compose UI + accessibility verification of the VehicleSelect shared surface across every state the
 * web component drives (web/src/components/forms/VehicleSelect.tsx): the loading skeleton, the dropdown
 * content with its merged "Select vehicle, {active}" TalkBack label (a11y label test), the friendly empty
 * state (the web defers this to the host page), the stale/offline freshness chips, and the classified error
 * with a working Retry; the stateful path is exercised end to end against the real ViewModel + source seam.
 * Runs under `connectedAndroidTest`; the `testReleaseUnitTest` gate covers the pure projection, this covers the
 * render.
 */
class VehicleSelectUiTest {
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
    ) : VehicleSelectSource {
        private val mutableSelectedId = MutableStateFlow(initialSelectedId)

        override val selectedId: StateFlow<Long?> = mutableSelectedId

        override fun vehicles(): Flow<Resource<List<Vehicle>>> = flowOf(Resource.Success(fleet, fetchedAt = STAMP, stale = false))

        override fun select(id: Long) {
            mutableSelectedId.value = id
        }

        override fun reconcile(availableIds: List<Long>) {
            mutableSelectedId.value = effectiveSelectedId(mutableSelectedId.value, availableIds)
        }
    }

    private fun strings(): VehicleSelectStrings {
        val ctx = InstrumentationRegistry.getInstrumentation().targetContext
        return VehicleSelectStrings(
            ariaLabel = ctx.getString(R.string.translation_vehiclePicker_aria),
            fallbackWord = ctx.getString(R.string.translation_statusBar_vehicle_fallback),
            loadingLabel = ctx.getString(R.string.translation_common_loading),
            staleLabel = ctx.getString(R.string.translation_mqtt_stale),
            offlineLabel = ctx.getString(R.string.translation_common_offline),
            updatingLabel = ctx.getString(R.string.translation_freshness_updating),
            emptyTitle = ctx.getString(R.string.translation_common_noVehicleSelected_title),
            emptyDesc = ctx.getString(R.string.translation_common_noVehicleSelected_desc),
            errorResource = ctx.getString(R.string.translation_common_vehicle),
        )
    }

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

    private fun fleetData(selectedId: Long): VehicleSelectData =
        VehicleSelectData(
            vehicles =
                listOf(
                    VehicleSelectRow(1, "Red Rocket", "VIN1", "Model 3", selected = selectedId == 1L),
                    VehicleSelectRow(2, "Spacehauler", "VIN2", "Model Y", selected = selectedId == 2L),
                ),
            effectiveSelectedId = selectedId,
        )

    @Test
    fun loadingStateAnnouncesTheLoadingLabel() {
        val labels = strings()
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                CompositionLocalProvider(LocalReducedMotion provides true) {
                    VehicleSelectContent(state = UiState.loading(), strings = labels)
                }
            }
        }
        compose.onNodeWithTag(VEHICLE_SELECT_TEST_TAG).assertIsDisplayed()
        compose.onNodeWithContentDescription(labels.loadingLabel).assertIsDisplayed()
    }

    @Test
    fun contentStateExposesTheSelectTriggerWithAccessibleLabel() {
        val labels = strings()
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                CompositionLocalProvider(LocalReducedMotion provides true) {
                    VehicleSelectContent(state = UiState(UiPhase.Content, data = fleetData(1)), strings = labels)
                }
            }
        }
        compose.onNodeWithTag(VEHICLE_SELECT_TRIGGER_TEST_TAG).assertIsDisplayed()
        val expected = vehicleSelectAccessibilityLabel(labels.ariaLabel, "Red Rocket")
        compose.onNodeWithContentDescription(expected).assertIsDisplayed()
    }

    @Test
    fun emptyStateShowsTheFriendlyEmptyState() {
        val labels = strings()
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                CompositionLocalProvider(LocalReducedMotion provides true) {
                    VehicleSelectContent(state = UiState(UiPhase.Empty, data = VehicleSelectData.EMPTY), strings = labels)
                }
            }
        }
        compose.onNodeWithTag(VEHICLE_SELECT_TEST_TAG).assertIsDisplayed()
        compose.onNodeWithContentDescription(labels.emptyTitle).assertIsDisplayed()
    }

    @Test
    fun staleStateShowsTheStaleFreshnessChip() {
        val labels = strings()
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                CompositionLocalProvider(LocalReducedMotion provides true) {
                    VehicleSelectContent(
                        state = UiState(UiPhase.Content, data = fleetData(1), fetchedAt = STAMP, stale = true),
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
                    VehicleSelectContent(
                        state =
                            UiState(
                                UiPhase.Content,
                                data = fleetData(1),
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
                    VehicleSelectContent(
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
    fun statefulVehicleSelectBindsTheFleetAndRendersTrigger() {
        val source = FakeSource(listOf(vehicle(1, "Grace"), vehicle(2, "Ada")), initialSelectedId = 1L)
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                CompositionLocalProvider(LocalReducedMotion provides true) {
                    VehicleSelect(source = source, logger = NoopLogger)
                }
            }
        }
        compose.waitForIdle()
        compose.onNodeWithTag(VEHICLE_SELECT_TRIGGER_TEST_TAG).assertIsDisplayed()
    }

    private companion object {
        const val STAMP = 1_700_000_000_000L
        const val HTTP_SERVER_ERROR = 503
    }
}
