// Off-device unit coverage for the VehiclePicker surface's pure model (P3 acceptance: adapter + per-state +
// a11y label tests). Exercises the effective-selection precedence that mirrors `SelectedVehicleStore.reconcile`
// + the web `useSelectedVehicle` default-to-first, the PIN-AWARE row/data projection (the adapter: cached fleet
// + pins → pin-ordered projection, web `usePinned`), the cache-then-network resource projection mapped through
// the shared `toUiState` (per-state coverage: loading / content / single / empty / error / stale / offline),
// the web `(isPinned ? '📌 ' : '') + (display_name || vin || 'Vehicle {id}')` option-label resolver, the
// accessibility content-description fold (a11y label coverage), the recovery error-kind mapper, and the
// PII-safe `view.opened` diagnostic. No Compose / Android framework / HTTP — runs in :android:testReleaseUnitTest.
// Reference values are the strings + behaviour the web component + hooks produce.

package io.teslasync.android.sharedsurfaces.vehiclepicker

import io.teslasync.android.components.feedback.QueryErrorKind
import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.toUiState
import io.teslasync.shared.core.api.generated.Vehicle
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.LogRecord
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.net.ApiError
import io.teslasync.shared.core.presentation.pinned.PinnedItem
import io.teslasync.shared.core.presentation.pinned.PinnedItemType
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import kotlin.time.Instant

class VehiclePickerModelTest {
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

    private fun pin(
        vehicleId: Long,
        position: Int,
    ): PinnedItem =
        PinnedItem(
            id = 100 + vehicleId,
            itemType = PinnedItemType.Vehicle,
            itemId = vehicleId.toString(),
            position = position,
            pinnedAt = "2026-01-01T00:00:00Z",
        )

    // ── registration + i18n key/default contract mirrors the web source ──────────────

    @Test
    fun registrationSlugIsThePromptSurfaceSlug() {
        assertEquals("vehicle-picker", VehiclePickerRegistration.ID)
        assertEquals("VehiclePicker", VehiclePickerRegistration.SLUG)
    }

    @Test
    fun i18nKeysMapToCatalogResourceNames() {
        // Each reused `vehiclePicker.aria` / `statusBar.*` / `common.*` / `mqtt.stale` / `freshness.updating`
        // key maps to a `translation_*` resource present in values/, values-ar/, values-he/ (asserted by name).
        assertEquals("translation_vehiclePicker_aria", VehiclePickerKeys.ARIA)
        assertEquals("translation_statusBar_vehicle_fallback", VehiclePickerKeys.FALLBACK)
        assertEquals("translation_common_loading", VehiclePickerKeys.LOADING)
        assertEquals("translation_common_vehicle", VehiclePickerKeys.TITLE)
        assertEquals("translation_common_noVehicleSelected_title", VehiclePickerKeys.EMPTY_TITLE)
        assertEquals("translation_common_noVehicleSelected_desc", VehiclePickerKeys.EMPTY_DESC)
        assertEquals("translation_common_offline", VehiclePickerKeys.OFFLINE)
        assertEquals("translation_mqtt_stale", VehiclePickerKeys.STALE)
        assertEquals("translation_freshness_updating", VehiclePickerKeys.UPDATING)
    }

    @Test
    fun defaultsMirrorWebSourceStrings() {
        assertEquals("Select vehicle", VehiclePickerDefaults.ARIA)
        assertEquals("Vehicle", VehiclePickerDefaults.FALLBACK)
        assertEquals("No vehicle selected", VehiclePickerDefaults.EMPTY_TITLE)
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

    // ── pin awareness: membership + stable pin-first sort (web usePinned useMemo) ─────

    @Test
    fun isVehiclePinnedMatchesStringifiedVehicleId() {
        val pins = listOf(pin(2, position = 0))
        assertTrue(isVehiclePinned(vehicle(2), pins))
        assertFalse(isVehiclePinned(vehicle(1), pins))
    }

    @Test
    fun sortByPinsReturnsListUnchangedWhenNoPins() {
        val fleet = listOf(vehicle(1), vehicle(2), vehicle(3))
        assertEquals(listOf(1L, 2L, 3L), sortVehiclesByPins(fleet, emptyList()).map { it.id })
    }

    @Test
    fun sortByPinsFloatsPinnedToTopByPositionKeepingRestStable() {
        val fleet = listOf(vehicle(1), vehicle(2), vehicle(3), vehicle(4))
        // Pin 3 (pos 0) then 1 (pos 1) → pinned block [3,1]; non-pinned [2,4] keep original order.
        val pins = listOf(pin(3, position = 0), pin(1, position = 1))
        assertEquals(listOf(3L, 1L, 2L, 4L), sortVehiclesByPins(fleet, pins).map { it.id })
    }

    // ── projection adapter: cached fleet + pins → pin-ordered projection ──────────────

    @Test
    fun projectionTagsActiveRowFromStoredSelectionAndOriginalOrder() {
        // Pins reorder display to [3,1,2], but the default-to-first selection reads the ORIGINAL order (1).
        val data =
            projectVehiclePicker(
                vehicles = listOf(vehicle(1), vehicle(2), vehicle(3)),
                pins = listOf(pin(3, position = 0)),
                storedSelectedId = null,
            )
        assertEquals(3, data.count)
        assertEquals(listOf(3L, 1L, 2L), data.vehicles.map { it.id })
        assertEquals(1L, data.effectiveSelectedId)
        assertEquals(1L, data.selectedRow?.id)
        assertEquals(listOf(true, false, false), data.vehicles.map { it.pinned })
        assertEquals(listOf(false, true, false), data.vehicles.map { it.selected })
        assertTrue(data.isSelectable)
        assertFalse(data.isSingle)
    }

    @Test
    fun projectionWithoutPinsKeepsApiOrderAndMarksNonePinned() {
        val data = projectVehiclePicker(listOf(vehicle(1), vehicle(2)), emptyList(), storedSelectedId = 2L)
        assertEquals(listOf(1L, 2L), data.vehicles.map { it.id })
        assertEquals(2L, data.effectiveSelectedId)
        assertTrue(data.vehicles.none { it.pinned })
    }

    @Test
    fun projectionSingleVehicleIsAutoSelectedAndFlaggedSingle() {
        val data = projectVehiclePicker(listOf(vehicle(7, name = "Solo", model = "Model 3")), emptyList(), storedSelectedId = null)
        assertEquals(1, data.count)
        assertTrue(data.isSingle)
        assertFalse(data.isSelectable)
        assertEquals(7L, data.effectiveSelectedId)
        assertEquals("Solo", data.selectedRow?.displayName)
        assertEquals("Model 3", data.selectedRow?.model)
    }

    @Test
    fun projectionEmptyFleetIsEmptyWithNoSelection() {
        val data = projectVehiclePicker(emptyList(), emptyList(), storedSelectedId = 4L)
        assertTrue(data.isEmpty)
        assertNull(data.effectiveSelectedId)
        assertNull(data.selectedRow)
    }

    // ── per-state coverage over the shared cache-then-network UiState lifecycle ───────

    @Test
    fun loadingWithNoCacheIsLoadingPhase() {
        val state = projectVehiclePickerResource(Resource.Loading(null, null, stale = false), emptyList(), null).toUiState { it.isEmpty }
        assertEquals(UiPhase.Loading, state.phase)
        assertNull(state.data)
    }

    @Test
    fun successWithVehiclesIsContentPhase() {
        val resource = Resource.Success(listOf(vehicle(1), vehicle(2)), fetchedAt = 10L, stale = false)
        val state = projectVehiclePickerResource(resource, emptyList(), storedSelectedId = 1L).toUiState { it.isEmpty }
        assertEquals(UiPhase.Content, state.phase)
        assertEquals(2, state.data?.count)
        assertEquals(1L, state.data?.effectiveSelectedId)
    }

    @Test
    fun successWithSingleVehicleIsContentPhaseFlaggedSingle() {
        val resource = Resource.Success(listOf(vehicle(1)), fetchedAt = 10L, stale = false)
        val state = projectVehiclePickerResource(resource, emptyList(), storedSelectedId = null).toUiState { it.isEmpty }
        assertEquals(UiPhase.Content, state.phase)
        assertTrue(state.data?.isSingle ?: false)
    }

    @Test
    fun successWithEmptyFleetIsEmptyPhase() {
        val resource = Resource.Success(emptyList<Vehicle>(), fetchedAt = 10L, stale = false)
        val state = projectVehiclePickerResource(resource, emptyList(), storedSelectedId = null).toUiState { it.isEmpty }
        assertEquals(UiPhase.Empty, state.phase)
        assertTrue(state.data?.isEmpty ?: false)
    }

    @Test
    fun hardErrorWithNoCacheIsErrorPhase() {
        val resource = Resource.Error<List<Vehicle>>(cached = null, fetchedAt = null, stale = false, error = ApiError.Network())
        val state = projectVehiclePickerResource(resource, emptyList(), null).toUiState { it.isEmpty }
        assertEquals(UiPhase.Error, state.phase)
        assertTrue(state.hasError)
        assertFalse(state.hasData)
        assertEquals(ErrorKind.Network, state.errorKind)
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
        val state = projectVehiclePickerResource(resource, emptyList(), storedSelectedId = 2L).toUiState { it.isEmpty }
        assertEquals(UiPhase.Content, state.phase)
        assertEquals(2L, state.data?.effectiveSelectedId)
        assertTrue(state.stale)
        assertTrue(state.isOffline)
        assertTrue(state.canRetry)
    }

    @Test
    fun staleLoadingKeepsCachedFleetWhileRefreshing() {
        val resource = Resource.Loading(cached = listOf(vehicle(1), vehicle(2)), fetchedAt = 100L, stale = true)
        val state = projectVehiclePickerResource(resource, emptyList(), storedSelectedId = 1L).toUiState { it.isEmpty }
        assertEquals(UiPhase.Content, state.phase)
        assertTrue(state.refreshing)
        assertTrue(state.stale)
        assertEquals(2, state.data?.count)
    }

    @Test
    fun pinsReorderTheCachedFleetWithoutChangingThePhase() {
        // A successful fleet with pins is still Content; the pins only reorder + mark rows.
        val resource = Resource.Success(listOf(vehicle(1), vehicle(2), vehicle(3)), fetchedAt = 10L, stale = false)
        val state = projectVehiclePickerResource(resource, listOf(pin(3, position = 0)), storedSelectedId = 1L).toUiState { it.isEmpty }
        assertEquals(UiPhase.Content, state.phase)
        assertEquals(listOf(3L, 1L, 2L), state.data?.vehicles?.map { it.id })
    }

    // ── option label + a11y folds ──────────────────────────────────────────────────

    @Test
    fun baseLabelPrefersNameThenVinThenFallback() {
        val named = VehiclePickerRow(1, "Red Rocket", "VIN1", "Model 3", pinned = false, selected = true)
        val vinOnly = VehiclePickerRow(2, "", "VIN2", null, pinned = false, selected = false)
        val neither = VehiclePickerRow(3, "  ", "   ", null, pinned = false, selected = false)
        assertEquals("Red Rocket", vehicleBaseLabel(named, "Vehicle"))
        assertEquals("VIN2", vehicleBaseLabel(vinOnly, "Vehicle"))
        assertEquals("Vehicle 3", vehicleBaseLabel(neither, "Vehicle"))
    }

    @Test
    fun optionLabelPrefixesPinMarkerOnlyForPinnedRows() {
        val pinned = VehiclePickerRow(1, "Red Rocket", "VIN1", "Model 3", pinned = true, selected = true)
        val plain = VehiclePickerRow(2, "Spacehauler", "VIN2", "Model Y", pinned = false, selected = false)
        assertEquals("📌 Red Rocket", vehicleOptionLabel(pinned, "Vehicle"))
        assertEquals("Spacehauler", vehicleOptionLabel(plain, "Vehicle"))
    }

    @Test
    fun accessibilityLabelFoldsAriaAndSelectedOption() {
        assertEquals("Select vehicle, Red Rocket", vehiclePickerAccessibilityLabel("Select vehicle", "Red Rocket"))
    }

    @Test
    fun accessibilityLabelDegradesToAriaWhenNothingSelected() {
        assertEquals("Select vehicle", vehiclePickerAccessibilityLabel("Select vehicle", ""))
    }

    // ── recovery error-kind mapper ─────────────────────────────────────────────────────

    @Test
    fun errorKindMapsFailuresToRecoveryCopy() {
        assertEquals(QueryErrorKind.Offline, vehiclePickerErrorKind(ErrorKind.Network, null))
        assertEquals(QueryErrorKind.Offline, vehiclePickerErrorKind(ErrorKind.Timeout, null))
        assertEquals(QueryErrorKind.NotFound, vehiclePickerErrorKind(ErrorKind.Http, 404))
        assertEquals(QueryErrorKind.ServerError, vehiclePickerErrorKind(ErrorKind.Http, 500))
        assertEquals(QueryErrorKind.Waiting, vehiclePickerErrorKind(ErrorKind.CircuitOpen, null))
        assertEquals(QueryErrorKind.Network, vehiclePickerErrorKind(ErrorKind.Unknown, null))
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
        recordVehiclePickerOpened(logger)
        assertEquals(1, records.size)
        assertEquals(LogLevel.Info, records[0].level)
        assertEquals("view.opened", records[0].event)
        // Only the surface slug — no vehicle id / VIN can leak through the diagnostic.
        assertEquals(mapOf("surface" to "VehiclePicker"), records[0].fields)
    }
}
