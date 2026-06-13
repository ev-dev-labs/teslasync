// Off-device unit coverage for the ActiveVehicleSegment surface's pure model (P3 acceptance: adapter + per-state
// + a11y label tests). Exercises the effective-selection precedence (mirrors `SelectedVehicleStore.reconcile` +
// the web `useSelectedVehicle` default-to-first), the row/data projection (the adapter: cached fleet + live state
// + unit pref → projection), the cache-then-network resource projection mapped through the shared `toUiState`
// (per-state coverage: loading / content / empty / error / stale / offline), the web
// `display_name || vin || 'Vehicle {id}'` label resolver, the active-vehicle / sub-label / metrics folds (the
// `${battery}% · ${range} ${unit}` SI→display conversion), the tooltip + accessibility content-description folds
// (a11y label coverage), the recovery error-kind mapper, and the PII-safe `view.opened` diagnostic. No Compose /
// Android framework / HTTP — runs in :android:testReleaseUnitTest. Reference values are the strings + behaviour
// the web component + hooks produce.

package io.teslasync.android.sharedsurfaces.activevehiclesegment

import io.teslasync.android.components.feedback.QueryErrorKind
import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.toUiState
import io.teslasync.shared.core.api.generated.Vehicle
import io.teslasync.shared.core.api.generated.VehicleState
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.LogRecord
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.net.ApiError
import io.teslasync.shared.core.units.DistanceUnitPref
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import kotlin.time.Instant

class ActiveVehicleSegmentModelTest {
    private fun vehicle(
        id: Long,
        name: String = "Car $id",
        model: String? = null,
        vin: String = "VIN$id",
    ): Vehicle =
        Vehicle(
            createdAt = Instant.parse("2026-01-01T00:00:00Z"),
            displayName = name,
            enrolledAt = Instant.parse("2026-01-01T00:00:00Z"),
            id = id,
            teslaId = 1000 + id,
            timezone = "UTC",
            updatedAt = Instant.parse("2026-01-01T00:10:00Z"),
            vin = vin,
            model = model,
        )

    private fun state(
        battery: Long,
        rangeMeters: Double,
    ): VehicleState =
        VehicleState(
            batteryLevel = battery,
            chargeRate = 0.0,
            chargerPower = 0.0,
            idealRange = rangeMeters,
            insideTemp = 0.0,
            isCharging = false,
            isClimateOn = false,
            isLocked = true,
            latitude = 0.0,
            longitude = 0.0,
            odometer = 0.0,
            outsideTemp = 0.0,
            power = 0.0,
            ratedRange = rangeMeters,
            sentryMode = false,
            softwareVersion = "2026.0",
            speed = 0.0,
            state = "online",
            timeToFullCharge = 0.0,
            vehicleId = 1L,
        )

    // 300 miles expressed in SI metres (1 mi = 1609.344 m exactly).
    private val threeHundredMiles = 300.0 * 1609.344

    // ── registration + i18n key/default contract mirrors the web source ──────────────

    @Test
    fun registrationSlugIsThePromptSurfaceSlug() {
        assertEquals("active-vehicle-segment", ActiveVehicleSegmentRegistration.ID)
        assertEquals("ActiveVehicleSegment", ActiveVehicleSegmentRegistration.SLUG)
    }

    @Test
    fun i18nKeysMapToCatalogResourceNames() {
        assertEquals("translation_statusBar_vehicle_fallback", ActiveVehicleSegmentKeys.FALLBACK)
        assertEquals("translation_statusBar_vehicle_none", ActiveVehicleSegmentKeys.NONE)
        assertEquals("translation_statusBar_vehicle_tooltip", ActiveVehicleSegmentKeys.TOOLTIP)
        assertEquals("translation_statusBar_vehicle_aria", ActiveVehicleSegmentKeys.ARIA)
        assertEquals("translation_statusBar_vehicle_switch", ActiveVehicleSegmentKeys.SWITCH)
        assertEquals("translation_common_loading", ActiveVehicleSegmentKeys.LOADING)
        assertEquals("translation_common_vehicle", ActiveVehicleSegmentKeys.TITLE)
        assertEquals("translation_common_noVehicleSelected_title", ActiveVehicleSegmentKeys.EMPTY_TITLE)
        assertEquals("translation_common_noVehicleSelected_desc", ActiveVehicleSegmentKeys.EMPTY_DESC)
        assertEquals("translation_common_offline", ActiveVehicleSegmentKeys.OFFLINE)
        assertEquals("translation_mqtt_stale", ActiveVehicleSegmentKeys.STALE)
        assertEquals("translation_freshness_updating", ActiveVehicleSegmentKeys.UPDATING)
    }

    @Test
    fun defaultsMirrorWebSourceStrings() {
        assertEquals("Vehicle", ActiveVehicleSegmentDefaults.FALLBACK)
        assertEquals("No vehicle", ActiveVehicleSegmentDefaults.NONE)
        assertEquals("Active vehicle", ActiveVehicleSegmentDefaults.TOOLTIP)
        assertEquals("Active vehicle", ActiveVehicleSegmentDefaults.ARIA)
        assertEquals("Switch vehicle", ActiveVehicleSegmentDefaults.SWITCH)
    }

    // ── effective-selection precedence (web parseId + store.reconcile + default-to-first) ──

    @Test
    fun isValidVehicleIdMirrorsWebParseIdGuard() {
        assertTrue(isValidVehicleId(1L))
        assertFalse(isValidVehicleId(null))
        assertFalse(isValidVehicleId(0L))
        assertFalse(isValidVehicleId(-3L))
    }

    @Test
    fun effectiveSelectedIdKeepsValidStoredChoice() {
        assertEquals(2L, effectiveSelectedId(stored = 2L, availableIds = listOf(1L, 2L, 3L)))
    }

    @Test
    fun effectiveSelectedIdFallsToFirstWhenStoredAbsentOrNullOrInvalid() {
        assertEquals(1L, effectiveSelectedId(stored = 99L, availableIds = listOf(1L, 2L)))
        assertEquals(1L, effectiveSelectedId(stored = null, availableIds = listOf(1L, 2L)))
        assertEquals(1L, effectiveSelectedId(stored = 0L, availableIds = listOf(1L, 2L)))
    }

    @Test
    fun effectiveSelectedIdClearsOnEmptyFleet() {
        assertNull(effectiveSelectedId(stored = 5L, availableIds = emptyList()))
    }

    // ── projection adapter: cached fleet + live state + unit pref → projection ───────

    @Test
    fun projectionTagsActiveRowAndFoldsMetrics() {
        val data =
            projectActiveVehicleSegment(
                vehicles = listOf(vehicle(1), vehicle(2), vehicle(3)),
                storedSelectedId = 2L,
                state = state(82, threeHundredMiles),
                distancePref = DistanceUnitPref.MI,
            )
        assertEquals(3, data.count)
        assertEquals(2L, data.effectiveSelectedId)
        assertEquals(2L, data.selectedRow?.id)
        assertEquals(listOf(false, true, false), data.vehicles.map { it.selected })
        assertEquals("82% \u00B7 300 mi", data.metricsLabel)
        assertTrue(data.isSwitchable)
        assertFalse(data.isSingle)
    }

    @Test
    fun projectionSingleVehicleIsAutoSelectedAndNotSwitchable() {
        val data =
            projectActiveVehicleSegment(
                vehicles = listOf(vehicle(7, name = "Solo", model = "Model 3")),
                storedSelectedId = null,
                state = null,
                distancePref = DistanceUnitPref.KM,
            )
        assertEquals(1, data.count)
        assertEquals(7L, data.effectiveSelectedId)
        assertEquals("Solo", data.selectedRow?.displayName)
        assertTrue(data.isSingle)
        assertFalse(data.isSwitchable)
        assertNull(data.metricsLabel)
    }

    @Test
    fun projectionEmptyFleetIsEmptyWithNoSelection() {
        val data =
            projectActiveVehicleSegment(emptyList(), storedSelectedId = 4L, state = null, distancePref = DistanceUnitPref.MI)
        assertTrue(data.isEmpty)
        assertNull(data.effectiveSelectedId)
        assertNull(data.selectedRow)
    }

    // ── metrics fold (web `${battery}% · round(convertDistanceFromSI(range)) ${unit}`) ──

    @Test
    fun metricsLabelConvertsSiRangeToTheUserUnit() {
        assertEquals("82% \u00B7 300 mi", formatMetricsLabel(state(82, threeHundredMiles), DistanceUnitPref.MI))
        assertEquals("82% \u00B7 483 km", formatMetricsLabel(state(82, threeHundredMiles), DistanceUnitPref.KM))
    }

    @Test
    fun metricsLabelIsNullWithoutLiveState() {
        assertNull(formatMetricsLabel(null, DistanceUnitPref.MI))
    }

    // ── label + sub-label + tooltip + a11y folds ─────────────────────────────────────

    @Test
    fun rowLabelPrefersNameThenVinThenFallback() {
        val named = ActiveVehicleRow(1, "Red Rocket", "VIN1", "Model 3", selected = true)
        val vinOnly = ActiveVehicleRow(2, "", "VIN2", null, selected = false)
        val neither = ActiveVehicleRow(3, "  ", "   ", null, selected = false)
        assertEquals("Red Rocket", vehicleRowLabel(named, "Vehicle"))
        assertEquals("VIN2", vehicleRowLabel(vinOnly, "Vehicle"))
        assertEquals("Vehicle 3", vehicleRowLabel(neither, "Vehicle"))
    }

    @Test
    fun activeVehicleLabelResolvesRowThenSelectionThenNone() {
        val row = ActiveVehicleRow(1, "Red Rocket", "VIN1", "Model 3", selected = true)
        assertEquals("Red Rocket", activeVehicleLabel(row, 1L, "Vehicle", "No vehicle"))
        assertEquals("Vehicle 5", activeVehicleLabel(null, 5L, "Vehicle", "No vehicle"))
        assertEquals("No vehicle", activeVehicleLabel(null, null, "Vehicle", "No vehicle"))
    }

    @Test
    fun subLabelMirrorsWebModelOrEmpty() {
        assertEquals("Model Y", activeVehicleSubLabel(ActiveVehicleRow(1, "A", "V", "Model Y", selected = true)))
        assertEquals("", activeVehicleSubLabel(ActiveVehicleRow(1, "A", "V", null, selected = true)))
        assertEquals("", activeVehicleSubLabel(null))
    }

    @Test
    fun tooltipFoldsTooltipWordLabelSubLabelAndMetrics() {
        assertEquals(
            "Active vehicle \u00B7 Red Rocket \u00B7 Model 3 \u00B7 82% \u00B7 300 mi",
            activeVehicleTooltip("Active vehicle", "Red Rocket", "Model 3", "82% \u00B7 300 mi"),
        )
        assertEquals("Active vehicle \u00B7 Red Rocket", activeVehicleTooltip("Active vehicle", "Red Rocket", "", null))
    }

    @Test
    fun accessibilityLabelsMirrorTheWebAriaStrings() {
        assertEquals("Active vehicle: Red Rocket", activeVehicleAccessibilityLabel("Active vehicle", "Red Rocket"))
        assertEquals("Switch vehicle (Red Rocket)", switchVehicleAccessibilityLabel("Switch vehicle", "Red Rocket"))
    }

    // ── per-state coverage over the shared cache-then-network UiState lifecycle ───────

    @Test
    fun loadingWithNoCacheIsLoadingPhase() {
        val state =
            projectActiveVehicleSegmentResource(Resource.Loading(null, null, stale = false), null, null, DistanceUnitPref.MI)
                .toUiState { it.isEmpty }
        assertEquals(UiPhase.Loading, state.phase)
        assertNull(state.data)
    }

    @Test
    fun successWithVehiclesIsContentPhase() {
        val resource = Resource.Success(listOf(vehicle(1), vehicle(2)), fetchedAt = 10L, stale = false)
        val ui =
            projectActiveVehicleSegmentResource(resource, 1L, state(50, threeHundredMiles), DistanceUnitPref.MI)
                .toUiState { it.isEmpty }
        assertEquals(UiPhase.Content, ui.phase)
        assertEquals(2, ui.data?.count)
        assertEquals(1L, ui.data?.effectiveSelectedId)
        assertEquals("50% \u00B7 300 mi", ui.data?.metricsLabel)
    }

    @Test
    fun successWithEmptyFleetIsEmptyPhase() {
        val resource = Resource.Success(emptyList<Vehicle>(), fetchedAt = 10L, stale = false)
        val ui =
            projectActiveVehicleSegmentResource(resource, null, null, DistanceUnitPref.MI).toUiState { it.isEmpty }
        assertEquals(UiPhase.Empty, ui.phase)
        assertTrue(ui.data?.isEmpty ?: false)
    }

    @Test
    fun hardErrorWithNoCacheIsErrorPhase() {
        val resource = Resource.Error<List<Vehicle>>(cached = null, fetchedAt = null, stale = false, error = ApiError.Network())
        val ui = projectActiveVehicleSegmentResource(resource, null, null, DistanceUnitPref.MI).toUiState { it.isEmpty }
        assertEquals(UiPhase.Error, ui.phase)
        assertTrue(ui.hasError)
        assertFalse(ui.hasData)
        assertEquals(ErrorKind.Network, ui.errorKind)
    }

    @Test
    fun offlineKeepsCachedFleetWithStaleAndRetry() {
        val resource =
            Resource.Error(
                cached = listOf(vehicle(1), vehicle(2)),
                fetchedAt = 100L,
                stale = true,
                error = ApiError.Network(),
            )
        val ui =
            projectActiveVehicleSegmentResource(resource, 2L, null, DistanceUnitPref.MI).toUiState { it.isEmpty }
        assertEquals(UiPhase.Content, ui.phase)
        assertEquals(2L, ui.data?.effectiveSelectedId)
        assertTrue(ui.stale)
        assertTrue(ui.isOffline)
        assertTrue(ui.canRetry)
    }

    @Test
    fun staleLoadingKeepsCachedFleetWhileRefreshing() {
        val resource = Resource.Loading(cached = listOf(vehicle(1)), fetchedAt = 100L, stale = true)
        val ui =
            projectActiveVehicleSegmentResource(resource, 1L, null, DistanceUnitPref.MI).toUiState { it.isEmpty }
        assertEquals(UiPhase.Content, ui.phase)
        assertTrue(ui.refreshing)
        assertTrue(ui.stale)
        assertEquals(1, ui.data?.count)
    }

    // ── recovery error-kind mapper ─────────────────────────────────────────────────────

    @Test
    fun errorKindMapsFailuresToRecoveryCopy() {
        assertEquals(QueryErrorKind.Offline, activeVehicleSegmentErrorKind(ErrorKind.Network, null))
        assertEquals(QueryErrorKind.Offline, activeVehicleSegmentErrorKind(ErrorKind.Timeout, null))
        assertEquals(QueryErrorKind.NotFound, activeVehicleSegmentErrorKind(ErrorKind.Http, 404))
        assertEquals(QueryErrorKind.ServerError, activeVehicleSegmentErrorKind(ErrorKind.Http, 500))
        assertEquals(QueryErrorKind.Waiting, activeVehicleSegmentErrorKind(ErrorKind.CircuitOpen, null))
        assertEquals(QueryErrorKind.Network, activeVehicleSegmentErrorKind(ErrorKind.Unknown, null))
    }

    // ── diagnostics: one PII-safe view.opened ──────────────────────────────────────────

    @Test
    fun recordViewOpenedEmitsPiiSafeSurfaceSlug() {
        val records = mutableListOf<LogRecord>()
        val logger =
            object : Logger {
                override fun log(
                    level: LogLevel,
                    event: String,
                    fields: Map<String, String>,
                ) {
                    records += LogRecord(level, event, fields)
                }
            }
        recordActiveVehicleSegmentOpened(logger)
        assertEquals(1, records.size)
        assertEquals(LogLevel.Info, records[0].level)
        assertEquals("view.opened", records[0].event)
        assertEquals(mapOf("surface" to "ActiveVehicleSegment"), records[0].fields)
    }
}
