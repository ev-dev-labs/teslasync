package io.teslasync.android.sharedsurfaces.vehiclemultiselect

import io.teslasync.android.components.feedback.QueryErrorKind
import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import io.teslasync.shared.core.api.generated.Vehicle
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import kotlin.time.Instant

/**
 * Off-device verification of the pure [VehicleMultiSelectProjection] + selection algebra — the cached →
 * projection adapter test the prompt mandates. Mirrors the web component
 * (web/src/components/forms/VehicleMultiSelect.tsx): the `dedupSort` D14 ordering, the toggle-all D13 restore +
 * per-vehicle toggle, the unknown-id preservation, the `triggerSummary` per-count derivation, the `vehicleLabel`
 * option label, the cache-then-network freshness fold (loading/content/empty/error/stale/offline), the
 * hydrate/build wire helpers (D11/D12), and the shared QueryError recovery-bucket mapping. No Android, no
 * coroutines.
 */
class VehicleMultiSelectModelTest {
    private val strings =
        VehicleMultiSelectStrings(
            summaryAll = "All vehicles",
            summaryNone = "No vehicles selected",
            summaryOneTemplate = "%1\$s",
            summaryPartialTemplate = "%1\$s of %2\$s vehicles",
            summaryCountTemplate = "%1\$s vehicles",
            allOption = "All vehicles (current + future)",
            emptyFleetHelp = "Add a vehicle in Settings → Vehicles to use this rule.",
            unknownLabelTemplate = "Vehicle #%1\$s",
            unknownBadge = "Unknown",
            triggerLabel = "Vehicles",
            loadingLabel = "Loading",
            staleLabel = "Stale",
            offlineLabel = "Offline",
            updatingLabel = "updating…",
        )

    private fun vehicle(
        id: Long,
        name: String = "Car $id",
        model: String? = null,
        vin: String = "5YJ3E1EA7KF00000$id",
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

    private fun content(vehicles: List<Vehicle>): UiState<List<Vehicle>> = UiState(UiPhase.Content, data = vehicles, fetchedAt = STAMP)

    private fun specific(vararg ids: Long): VehicleSelection = VehicleSelection.Specific(ids.toList())

    // ── registration ────────────────────────────────────────────────────────────────────────────────────

    @Test
    fun registrationSlugIsThePromptSurfaceSlug() {
        assertEquals("VehicleMultiSelect", VehicleMultiSelectRegistration.SLUG)
        assertEquals("view.opened", VehicleMultiSelectRegistration.EVENT_VIEW_OPENED)
    }

    // ── dedupSort (web D14) ───────────────────────────────────────────────────────────────────────────────

    @Test
    fun dedupSortDropsNonPositiveDeduplicatesAndSorts() {
        assertEquals(listOf(1L, 2L, 3L), dedupSort(listOf(3, 1, 2, 1, 3)))
        assertEquals(listOf(4L, 7L), dedupSort(listOf(0, -1, 7, 4, 7)))
        assertEquals(emptyList<Long>(), dedupSort(listOf(0, -5)))
    }

    @Test
    fun specificIdsReadsTheSubsetOrEmptyForTheSentinel() {
        assertEquals(listOf(2L, 5L), specific(2, 5).specificIds)
        assertEquals(emptyList<Long>(), VehicleSelection.AllSticky.specificIds)
    }

    // ── toggle algebra (web handleToggleVehicle / handleToggleAll) ─────────────────────────────────────────

    @Test
    fun toggleVehicleAddsDedupedAndSorted() {
        val next = toggleVehicle(specific(3, 1), 2)
        assertEquals(VehicleSelection.Specific(listOf(1L, 2L, 3L)), next)
    }

    @Test
    fun toggleVehicleRemovesAndCanEmptyWithoutFlippingToAll() {
        val next = toggleVehicle(specific(7), 7)
        assertEquals(VehicleSelection.Specific(emptyList()), next)
    }

    @Test
    fun toggleVehicleFromSentinelStartsAFreshSubset() {
        val next = toggleVehicle(VehicleSelection.AllSticky, 5)
        assertEquals(VehicleSelection.Specific(listOf(5L)), next)
    }

    @Test
    fun toggleAllTurnsOnFromSubsetAndRestoresPreviousWhenTurnedOff() {
        assertEquals(VehicleSelection.AllSticky, toggleAll(specific(1, 2), previousSpecific = listOf(1, 2)))
        assertEquals(VehicleSelection.Specific(listOf(1L, 2L)), toggleAll(VehicleSelection.AllSticky, listOf(1, 2)))
        assertEquals(VehicleSelection.Specific(emptyList()), toggleAll(VehicleSelection.AllSticky, emptyList()))
    }

    // ── unknown id preservation ────────────────────────────────────────────────────────────────────────────

    @Test
    fun unknownSelectedIdsAreThoseAbsentFromTheLiveFleet() {
        val unknown = unknownSelectedIds(specific(1, 2, 99), knownIds = setOf(1L, 2L, 3L))
        assertEquals(listOf(99L), unknown)
        assertEquals(emptyList<Long>(), unknownSelectedIds(VehicleSelection.AllSticky, setOf(1L)))
    }

    // ── option labelling (web vehicleLabel) ──────────────────────────────────────────────────────────────────

    @Test
    fun optionLabelPrefersDisplayNameThenModelThenUnknownNumber() {
        assertEquals("Red Rocket", VehicleMultiSelectProjection.optionLabel(vehicle(1, name = "Red Rocket"), strings))
        assertEquals("Model 3", VehicleMultiSelectProjection.optionLabel(vehicle(2, name = "  ", model = "Model 3"), strings))
        assertEquals("Vehicle #4", VehicleMultiSelectProjection.optionLabel(vehicle(4, name = "", model = null), strings))
    }

    @Test
    fun optionSubtitleCombinesDistinctModelAndVinTail() {
        assertEquals("Model 3  ·  …0001", VehicleMultiSelectProjection.optionSubtitle(vehicle(1, name = "Red Rocket", model = "Model 3")))
        // Model equal to the display name is not repeated; only the VIN tail remains.
        assertEquals("…0002", VehicleMultiSelectProjection.optionSubtitle(vehicle(2, name = "Model Y", model = "Model Y")))
        assertNull(VehicleMultiSelectProjection.optionSubtitle(vehicle(3, name = "Solo", model = null, vin = "ABC")))
    }

    @Test
    fun vinSuffixTakesTheLastFourOrNullWhenShort() {
        assertEquals("…6789", VehicleMultiSelectProjection.vinSuffix("5YJ3000006789"))
        assertNull(VehicleMultiSelectProjection.vinSuffix("123"))
    }

    // ── trigger summary (web triggerSummary) ───────────────────────────────────────────────────────────────

    @Test
    fun summaryRendersEveryCountBranch() {
        val fleet = listOf(vehicle(1, name = "Red Rocket"), vehicle(2, name = "Spacehauler"), vehicle(3, name = "Garage Queen"))
        assertEquals("All vehicles", VehicleMultiSelectProjection.summary(VehicleSelection.AllSticky, fleet, strings))
        assertEquals("No vehicles selected", VehicleMultiSelectProjection.summary(specific(), fleet, strings))
        assertEquals("Red Rocket", VehicleMultiSelectProjection.summary(specific(1), fleet, strings))
        assertEquals("2 of 3 vehicles", VehicleMultiSelectProjection.summary(specific(1, 2), fleet, strings))
        assertEquals("3 vehicles", VehicleMultiSelectProjection.summary(specific(1, 2, 3), fleet, strings))
    }

    @Test
    fun summaryForASingleUnknownVehicleUsesTheUnknownNumberLabel() {
        val fleet = listOf(vehicle(1, name = "Red Rocket"))
        assertEquals("Vehicle #42", VehicleMultiSelectProjection.summary(specific(42), fleet, strings))
    }

    // ── options + unknown projection ───────────────────────────────────────────────────────────────────────

    @Test
    fun optionsTagTheCheckedStateAgainstTheSelection() {
        val fleet = listOf(vehicle(1, name = "Red Rocket"), vehicle(2, name = "Spacehauler"))
        val options = VehicleMultiSelectProjection.options(fleet, specific(2), strings)
        assertEquals(listOf(false, true), options.map { it.checked })
        assertTrue(options.all { it.known })
    }

    @Test
    fun unknownOptionsProjectTheStoredButUnenrolledSelections() {
        val fleet = listOf(vehicle(1, name = "Red Rocket"))
        val unknown = VehicleMultiSelectProjection.unknownOptions(fleet, specific(1, 77), strings)
        assertEquals(1, unknown.size)
        assertEquals(77L, unknown.single().id)
        assertEquals("Vehicle #77", unknown.single().label)
        assertTrue(unknown.single().checked)
        assertFalse(unknown.single().known)
    }

    // ── project: phases + freshness (per-state coverage) ─────────────────────────────────────────────────────

    @Test
    fun projectLoadingRendersSkeletonPhase() {
        val display = VehicleMultiSelectProjection.project(UiState.loading(), specific(), strings)
        assertEquals(VehicleMultiSelectPhase.Loading, display.phase)
        assertTrue(display.options.isEmpty())
        assertFalse(display.canRetry)
    }

    @Test
    fun projectEmptyFleetRendersTheDisabledTriggerBranch() {
        val empty = UiState(UiPhase.Empty, data = emptyList<Vehicle>(), fetchedAt = STAMP)
        val display = VehicleMultiSelectProjection.project(empty, specific(), strings)
        assertEquals(VehicleMultiSelectPhase.Empty, display.phase)
        assertTrue(display.isFleetEmpty)
    }

    @Test
    fun projectContentBuildsOptionsAndSummary() {
        val fleet = listOf(vehicle(1, name = "Red Rocket"), vehicle(2, name = "Spacehauler"))
        val display = VehicleMultiSelectProjection.project(content(fleet), specific(1), strings)
        assertEquals(VehicleMultiSelectPhase.Content, display.phase)
        assertEquals("Red Rocket", display.summary)
        assertEquals(2, display.options.size)
        assertFalse(display.selectionIsAll)
    }

    @Test
    fun projectHardErrorWithNoCacheRendersErrorPhaseWithRetry() {
        val display =
            VehicleMultiSelectProjection.project(
                UiState(UiPhase.Error, errorKind = ErrorKind.Http, httpStatus = HTTP_SERVER_ERROR),
                specific(),
                strings,
            )
        assertEquals(VehicleMultiSelectPhase.Error, display.phase)
        assertTrue(display.canRetry)
        assertEquals(QueryErrorKind.ServerError, VehicleMultiSelectProjection.queryErrorKind(display))
    }

    @Test
    fun projectStaleRefreshingFlagsStaleNotOffline() {
        val fleet = listOf(vehicle(1, name = "Red Rocket"))
        val display =
            VehicleMultiSelectProjection.project(
                UiState(UiPhase.Content, data = fleet, stale = true, refreshing = true, fetchedAt = STAMP),
                specific(1),
                strings,
            )
        assertTrue(display.stale)
        assertFalse(display.offline)
        assertTrue(display.showFreshnessChip)
    }

    @Test
    fun projectCachedAfterFailedRefreshFlagsOfflineNotStale() {
        val fleet = listOf(vehicle(1, name = "Red Rocket"))
        val display =
            VehicleMultiSelectProjection.project(
                UiState(UiPhase.Content, data = fleet, stale = true, errorKind = ErrorKind.Network, fetchedAt = STAMP),
                specific(1),
                strings,
            )
        assertFalse(display.stale)
        assertTrue(display.offline)
        assertTrue(display.showFreshnessChip)
    }

    // ── hydrate / build wire helpers (web D11 / D12) ─────────────────────────────────────────────────────────

    @Test
    fun hydrateHonoursTheAllVehiclesFlagAndDedupsTheSubset() {
        assertEquals(VehicleSelection.AllSticky, hydrateVehicleSelection(allVehicles = true, vehicleIds = listOf(1), vehicleId = null))
        assertEquals(
            VehicleSelection.Specific(listOf(1L, 2L)),
            hydrateVehicleSelection(allVehicles = false, vehicleIds = listOf(2, 1, 2), vehicleId = null),
        )
    }

    @Test
    fun hydrateFallsBackToTheLegacySingleVehicleId() {
        assertEquals(VehicleSelection.AllSticky, hydrateVehicleSelection(allVehicles = null, vehicleIds = null, vehicleId = null))
        assertEquals(VehicleSelection.Specific(listOf(9L)), hydrateVehicleSelection(allVehicles = null, vehicleIds = null, vehicleId = 9))
    }

    @Test
    fun buildPayloadEmitsBothFlagsNeverTheLegacyId() {
        assertEquals(VehiclePayload(allVehicles = true, vehicleIds = emptyList()), buildVehiclePayload(VehicleSelection.AllSticky))
        assertEquals(VehiclePayload(allVehicles = false, vehicleIds = listOf(1L, 2L)), buildVehiclePayload(specific(2, 1, 2)))
    }

    // ── queryErrorKind mapping ───────────────────────────────────────────────────────────────────────────────

    @Test
    fun queryErrorKindMapsEveryFailureClass() {
        fun kindFor(
            errorKind: ErrorKind?,
            status: Int? = null,
        ): QueryErrorKind =
            VehicleMultiSelectProjection.queryErrorKind(
                VehicleMultiSelectDisplay(
                    phase = VehicleMultiSelectPhase.Error,
                    summary = "",
                    selectionIsAll = false,
                    errorKind = errorKind,
                    httpStatus = status,
                ),
            )

        assertEquals(QueryErrorKind.Waiting, kindFor(ErrorKind.CircuitOpen))
        assertEquals(QueryErrorKind.Network, kindFor(ErrorKind.Network))
        assertEquals(QueryErrorKind.Network, kindFor(ErrorKind.Timeout))
        assertEquals(QueryErrorKind.Unauthorized, kindFor(ErrorKind.Http, HTTP_UNAUTHORIZED))
        assertEquals(QueryErrorKind.Unauthorized, kindFor(ErrorKind.Http, HTTP_FORBIDDEN))
        assertEquals(QueryErrorKind.NotFound, kindFor(ErrorKind.Http, HTTP_NOT_FOUND))
        assertEquals(QueryErrorKind.ServerError, kindFor(ErrorKind.Http, HTTP_SERVER_ERROR))
        assertEquals(QueryErrorKind.ServerError, kindFor(ErrorKind.Decode))
        assertEquals(QueryErrorKind.ServerError, kindFor(ErrorKind.Unknown))
        assertEquals(QueryErrorKind.ServerError, kindFor(null))
    }

    private companion object {
        const val STAMP = 1_700_000_000_000L
        const val HTTP_UNAUTHORIZED = 401
        const val HTTP_FORBIDDEN = 403
        const val HTTP_NOT_FOUND = 404
        const val HTTP_SERVER_ERROR = 503
    }
}
