package io.teslasync.android.sharedsurfaces.vehiclemultiselect

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.test.platform.app.InstrumentationRegistry
import io.teslasync.android.R
import io.teslasync.android.data.ErrorKind
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.shared.core.api.generated.Vehicle
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.coroutines.flow.MutableStateFlow
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import kotlin.time.Instant

/**
 * On-device Compose UI + accessibility verification of the VehicleMultiSelect shared surface across every state
 * the web component renders (web/src/components/forms/VehicleMultiSelect.tsx): the loading skeleton trigger, the
 * trigger summary + popover options, the empty-fleet help, the stale/offline freshness chips, and the
 * classified error with a working Retry. The trigger + each option expose an accessibility label (a11y label
 * test); the stateful path is exercised end to end against the real ViewModel + source seam. Runs under
 * `connectedAndroidTest`; the `testReleaseUnitTest` gate covers the pure projection, this covers the render.
 */
class VehicleMultiSelectUiTest {
    @get:Rule
    val compose = createComposeRule()

    private object NoopLogger : Logger {
        override fun log(
            level: LogLevel,
            event: String,
            fields: Map<String, String>,
        ) = Unit
    }

    private fun strings(): VehicleMultiSelectStrings {
        val ctx = InstrumentationRegistry.getInstrumentation().targetContext
        return VehicleMultiSelectStrings(
            summaryAll = ctx.getString(R.string.translation_notifications_alertStudio_editor_vehiclesSummaryAll),
            summaryNone = ctx.getString(R.string.translation_notifications_alertStudio_editor_vehiclesSummaryNone),
            summaryOneTemplate = ctx.getString(R.string.translation_notifications_alertStudio_editor_vehiclesSummaryOne),
            summaryPartialTemplate = ctx.getString(R.string.translation_notifications_alertStudio_editor_vehiclesSummaryPartial),
            summaryCountTemplate = ctx.getString(R.string.translation_notifications_alertStudio_editor_vehiclesSummaryCount),
            allOption = ctx.getString(R.string.translation_notifications_alertStudio_editor_vehiclesAllOption),
            emptyFleetHelp = ctx.getString(R.string.translation_notifications_alertStudio_editor_vehiclesEmptyFleetHelp),
            unknownLabelTemplate = ctx.getString(R.string.translation_notifications_alertStudio_editor_vehiclesUnknownLabel),
            unknownBadge = ctx.getString(R.string.translation_notifications_alertStudio_editor_vehiclesUnknownBadge),
            triggerLabel = ctx.getString(R.string.translation_notifications_alertStudio_editor_vehiclesLabel),
            loadingLabel = ctx.getString(R.string.translation_a11y_loading),
            staleLabel = ctx.getString(R.string.translation_mqtt_stale),
            offlineLabel = ctx.getString(R.string.translation_common_offline),
            updatingLabel = ctx.getString(R.string.translation_freshness_updating),
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
            vin = "5YJ3E1EA7KF00000$id",
            model = "Model 3",
        )

    private fun display(
        phase: VehicleMultiSelectPhase,
        summary: String,
        selectionIsAll: Boolean = false,
        options: List<VehicleOption> = emptyList(),
        stale: Boolean = false,
        offline: Boolean = false,
        errorKind: ErrorKind? = null,
    ): VehicleMultiSelectDisplay =
        VehicleMultiSelectDisplay(
            phase = phase,
            summary = summary,
            selectionIsAll = selectionIsAll,
            options = options,
            stale = stale,
            offline = offline,
            errorKind = errorKind,
        )

    private fun fleetOptions(): List<VehicleOption> =
        listOf(
            VehicleOption(id = 1, label = "Red Rocket", subtitle = "Model 3", checked = true, known = true),
            VehicleOption(id = 2, label = "Spacehauler", subtitle = "Model Y", checked = false, known = true),
        )

    @Test
    fun loadingStateAnnouncesTheLoadingLabel() {
        val labels = strings()
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                VehicleMultiSelectContent(display = display(VehicleMultiSelectPhase.Loading, labels.summaryNone), strings = labels)
            }
        }
        compose.onNodeWithTag(VEHICLE_MULTI_SELECT_TEST_TAG).assertIsDisplayed()
        compose.onNodeWithContentDescription(labels.loadingLabel).assertIsDisplayed()
    }

    @Test
    fun contentStateExposesTheTriggerSummaryAsAnAccessibilityLabel() {
        val labels = strings()
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                VehicleMultiSelectContent(
                    display = display(VehicleMultiSelectPhase.Content, "2 of 3 vehicles", options = fleetOptions()),
                    strings = labels,
                )
            }
        }
        compose.onNodeWithContentDescription("${labels.triggerLabel}: 2 of 3 vehicles").assertIsDisplayed()
    }

    @Test
    fun emptyFleetShowsTheAddAVehicleHelp() {
        val labels = strings()
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                VehicleMultiSelectContent(display = display(VehicleMultiSelectPhase.Empty, labels.summaryNone), strings = labels)
            }
        }
        compose.onNodeWithTag(VEHICLE_MULTI_SELECT_TEST_TAG).assertIsDisplayed()
        compose.onNodeWithText(labels.emptyFleetHelp).assertIsDisplayed()
    }

    @Test
    fun staleStateShowsTheStaleFreshnessChip() {
        val labels = strings()
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                VehicleMultiSelectContent(
                    display =
                        display(
                            VehicleMultiSelectPhase.Content,
                            "All vehicles",
                            selectionIsAll = true,
                            options = fleetOptions(),
                            stale = true,
                        ),
                    strings = labels,
                )
            }
        }
        compose.onNodeWithText(labels.staleLabel).assertIsDisplayed()
    }

    @Test
    fun offlineStateShowsTheOfflineFreshnessChip() {
        val labels = strings()
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                VehicleMultiSelectContent(
                    display =
                        display(
                            VehicleMultiSelectPhase.Content,
                            "2 of 3 vehicles",
                            options = fleetOptions(),
                            offline = true,
                            errorKind = ErrorKind.Network,
                        ),
                    strings = labels,
                )
            }
        }
        compose.onNodeWithText(labels.offlineLabel).assertIsDisplayed()
    }

    @Test
    fun errorStateOffersAWorkingRetry() {
        var retried = false
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                VehicleMultiSelectContent(
                    display = display(VehicleMultiSelectPhase.Error, "", errorKind = ErrorKind.Http),
                    strings = strings(),
                    onRetry = { retried = true },
                )
            }
        }
        compose.onNodeWithText("Retry").assertIsDisplayed()
        compose.onNodeWithText("Retry").performClick()
        assertTrue(retried)
    }

    @Test
    fun openingTheTriggerRevealsTheOptionsAndTogglesAll() {
        val labels = strings()
        var toggledAll = false
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                VehicleMultiSelectContent(
                    display = display(VehicleMultiSelectPhase.Content, "2 of 3 vehicles", options = fleetOptions()),
                    strings = labels,
                    onToggleAll = { toggledAll = true },
                )
            }
        }
        compose.onNodeWithContentDescription("${labels.triggerLabel}: 2 of 3 vehicles").performClick()
        compose.onNodeWithContentDescription(labels.allOption).assertIsDisplayed()
        compose.onNodeWithContentDescription("Red Rocket").assertIsDisplayed()
        compose.onNodeWithContentDescription(labels.allOption).performClick()
        assertTrue(toggledAll)
    }

    @Test
    fun statefulVehicleMultiSelectBindsTheFleetAndRendersTheTrigger() {
        val labels = strings()
        val source =
            VehicleMultiSelectSource {
                MutableStateFlow(
                    Resource.Success(listOf(vehicle(1, "Red Rocket"), vehicle(2, "Spacehauler")), fetchedAt = STAMP, stale = false),
                )
            }
        val vm = VehicleMultiSelectViewModel(source, NoopLogger)
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                var selection by remember { mutableStateOf<VehicleSelection>(VehicleSelection.AllSticky) }
                VehicleMultiSelect(viewModel = vm, value = selection, onChange = { selection = it })
            }
        }
        compose.waitForIdle()
        compose.onNodeWithContentDescription("${labels.triggerLabel}: ${labels.summaryAll}").assertIsDisplayed()
    }

    private companion object {
        const val STAMP = 1_700_000_000_000L
    }
}
