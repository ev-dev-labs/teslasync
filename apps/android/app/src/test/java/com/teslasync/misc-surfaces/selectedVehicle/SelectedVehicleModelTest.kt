// Off-device unit coverage for the selectedVehicle surface's pure model (P3 acceptance: adapter + per-state
// + a11y label tests). Exercises the effective-selection precedence that mirrors `SelectedVehicleStore.reconcile`
// + the web `useSelectedVehicle` default-to-first, the row/data projection (the adapter: cached fleet →
// projection), the cache-then-network resource projection mapped through the shared `toUiState` (per-state
// coverage: loading / content / empty / error / stale / offline), the web `display_name || vin || 'Vehicle {id}'`
// label resolver, the accessibility content-description fold (a11y label coverage), the recovery error-kind
// mapper, and the PII-safe `view.opened` diagnostic. No Compose / Android framework / HTTP — runs in
// :android:testReleaseUnitTest. Reference values are the strings + behaviour the web store + hook produce.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.miscsurfaces.selectedvehicle

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
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import kotlin.time.Instant

class SelectedVehicleModelTest {
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

    // ── registration + i18n key/default contract mirrors the web source ──────────────

    @Test
    fun registrationSlugIsThePromptSurfaceSlug() {
        assertEquals("selected-vehicle", SelectedVehicleRegistration.ID)
        assertEquals("selectedVehicle", SelectedVehicleRegistration.SLUG)
    }

    @Test
    fun i18nKeysMapToCatalogResourceNames() {
        // Each reused web `statusBar.vehicle.*` / `common.*` / `mqtt.stale` / `freshness.updating` key maps to
        // a `translation_*` resource present in values/, values-ar/, values-he/ (asserted by name).
        assertEquals("translation_statusBar_vehicle_tooltip", SelectedVehicleKeys.ACTIVE_TITLE)
        assertEquals("translation_statusBar_vehicle_aria", SelectedVehicleKeys.ARIA)
        assertEquals("translation_statusBar_vehicle_switch", SelectedVehicleKeys.SWITCH)
        assertEquals("translation_statusBar_vehicle_fallback", SelectedVehicleKeys.FALLBACK)
        assertEquals("translation_statusBar_vehicle_none", SelectedVehicleKeys.NONE)
        assertEquals("translation_common_noVehicleSelected_title", SelectedVehicleKeys.EMPTY_TITLE)
        assertEquals("translation_common_noVehicleSelected_desc", SelectedVehicleKeys.EMPTY_DESC)
        assertEquals("translation_common_loading", SelectedVehicleKeys.LOADING)
        assertEquals("translation_common_offline", SelectedVehicleKeys.OFFLINE)
        assertEquals("translation_mqtt_stale", SelectedVehicleKeys.STALE)
        assertEquals("translation_freshness_updating", SelectedVehicleKeys.UPDATING)
    }

    @Test
    fun defaultsMirrorWebSourceStrings() {
        assertEquals("Active vehicle", SelectedVehicleDefaults.ACTIVE_TITLE)
        assertEquals("Switch vehicle", SelectedVehicleDefaults.SWITCH)
        assertEquals("Vehicle", SelectedVehicleDefaults.FALLBACK)
        assertEquals("No vehicle", SelectedVehicleDefaults.NONE)
        assertEquals("No vehicle selected", SelectedVehicleDefaults.EMPTY_TITLE)
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

    // ── projection adapter: cached fleet → projection ────────────────────────────────

    @Test
    fun projectionTagsActiveRowAndSelectableFlag() {
        val data = projectSelectedVehicle(listOf(vehicle(1), vehicle(2), vehicle(3)), storedSelectedId = 2L)
        assertEquals(3, data.count)
        assertTrue(data.selectable)
        assertEquals(2L, data.effectiveSelectedId)
        assertEquals(2L, data.selectedRow?.id)
        assertEquals(listOf(false, true, false), data.vehicles.map { it.selected })
    }

    @Test
    fun projectionSingleVehicleIsNotSelectableAndAutoSelected() {
        val data = projectSelectedVehicle(listOf(vehicle(7, name = "Solo", model = "Model 3")), storedSelectedId = null)
        assertFalse(data.selectable)
        assertEquals(7L, data.effectiveSelectedId)
        assertEquals("Solo", data.selectedRow?.displayName)
        assertEquals("Model 3", data.selectedRow?.model)
    }

    @Test
    fun projectionEmptyFleetIsEmptyWithNoSelection() {
        val data = projectSelectedVehicle(emptyList(), storedSelectedId = 4L)
        assertTrue(data.isEmpty)
        assertNull(data.effectiveSelectedId)
        assertNull(data.selectedRow)
    }

    // ── per-state coverage over the shared cache-then-network UiState lifecycle ───────

    @Test
    fun loadingWithNoCacheIsLoadingPhase() {
        val state = projectSelectedVehicleResource(Resource.Loading(null, null, stale = false), null).toUiState { it.isEmpty }
        assertEquals(UiPhase.Loading, state.phase)
        assertNull(state.data)
    }

    @Test
    fun successWithVehiclesIsContentPhase() {
        val resource = Resource.Success(listOf(vehicle(1), vehicle(2)), fetchedAt = 10L, stale = false)
        val state = projectSelectedVehicleResource(resource, storedSelectedId = 1L).toUiState { it.isEmpty }
        assertEquals(UiPhase.Content, state.phase)
        assertEquals(2, state.data?.count)
        assertEquals(1L, state.data?.effectiveSelectedId)
    }

    @Test
    fun successWithEmptyFleetIsEmptyPhase() {
        val resource = Resource.Success(emptyList<Vehicle>(), fetchedAt = 10L, stale = false)
        val state = projectSelectedVehicleResource(resource, storedSelectedId = null).toUiState { it.isEmpty }
        assertEquals(UiPhase.Empty, state.phase)
        assertTrue(state.data?.isEmpty ?: false)
    }

    @Test
    fun hardErrorWithNoCacheIsErrorPhase() {
        val resource = Resource.Error<List<Vehicle>>(cached = null, fetchedAt = null, stale = false, error = ApiError.Network())
        val state = projectSelectedVehicleResource(resource, null).toUiState { it.isEmpty }
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
        val state = projectSelectedVehicleResource(resource, storedSelectedId = 2L).toUiState { it.isEmpty }
        assertEquals(UiPhase.Content, state.phase)
        assertEquals(2L, state.data?.effectiveSelectedId)
        assertTrue(state.stale)
        assertTrue(state.isOffline)
        assertTrue(state.canRetry)
    }

    @Test
    fun staleLoadingKeepsCachedFleetWhileRefreshing() {
        val resource = Resource.Loading(cached = listOf(vehicle(1)), fetchedAt = 100L, stale = true)
        val state = projectSelectedVehicleResource(resource, storedSelectedId = 1L).toUiState { it.isEmpty }
        assertEquals(UiPhase.Content, state.phase)
        assertTrue(state.refreshing)
        assertTrue(state.stale)
        assertEquals(1, state.data?.count)
    }

    // ── label + a11y folds ───────────────────────────────────────────────────────────

    @Test
    fun rowDisplayLabelPrefersNameThenVinThenFallback() {
        val named = SelectedVehicleRow(1, "Red Rocket", "VIN1", "Model 3", selected = true)
        val vinOnly = SelectedVehicleRow(2, "", "VIN2", null, selected = false)
        val neither = SelectedVehicleRow(3, "  ", "   ", null, selected = false)
        assertEquals("Red Rocket", rowDisplayLabel(named, "Vehicle"))
        assertEquals("VIN2", rowDisplayLabel(vinOnly, "Vehicle"))
        assertEquals("Vehicle 3", rowDisplayLabel(neither, "Vehicle"))
    }

    @Test
    fun activeVehicleContentDescriptionFoldsAriaAndLabel() {
        assertEquals("Active vehicle: Red Rocket", activeVehicleContentDescription("Active vehicle", "Red Rocket"))
    }

    // ── recovery error-kind mapper ─────────────────────────────────────────────────────

    @Test
    fun errorKindMapsFailuresToRecoveryCopy() {
        assertEquals(QueryErrorKind.Offline, selectedVehicleErrorKind(ErrorKind.Network, null))
        assertEquals(QueryErrorKind.Offline, selectedVehicleErrorKind(ErrorKind.Timeout, null))
        assertEquals(QueryErrorKind.NotFound, selectedVehicleErrorKind(ErrorKind.Http, 404))
        assertEquals(QueryErrorKind.ServerError, selectedVehicleErrorKind(ErrorKind.Http, 500))
        assertEquals(QueryErrorKind.Waiting, selectedVehicleErrorKind(ErrorKind.CircuitOpen, null))
        assertEquals(QueryErrorKind.Network, selectedVehicleErrorKind(ErrorKind.Unknown, null))
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
        recordSelectedVehicleOpened(logger)
        assertEquals(1, records.size)
        assertEquals(LogLevel.Info, records[0].level)
        assertEquals("view.opened", records[0].event)
        // Only the surface slug — no vehicle id / VIN can leak through the diagnostic.
        assertEquals(mapOf("surface" to "selectedVehicle"), records[0].fields)
    }
}
