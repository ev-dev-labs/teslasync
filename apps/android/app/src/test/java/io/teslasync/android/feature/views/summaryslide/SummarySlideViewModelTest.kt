package io.teslasync.android.feature.views.summaryslide

import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.NoopLogger
import io.teslasync.android.data.UiPhase
import io.teslasync.shared.core.api.generated.Vehicle
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.net.ApiError
import io.teslasync.shared.core.units.DistanceUnitPref
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.flow
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import kotlin.time.Instant

/**
 * Drives [SummarySlideViewModel] over a controllable fake [SummarySlideSource], covering the full
 * cache-then-network state matrix the surface renders (loading / content / empty / hard error + retry /
 * stale-offline + retry / refresh re-fetch), the default-vehicle resolution from the vehicles list (web
 * `vehicles?.[0]?.id`), the disabled-query empty surface when no vehicle resolves (web
 * `enabled: !!vehicleId`, no fleet-wide fallback), the explicit-vehicle override, the settings-derived
 * distance preference (web `useUnits`), and the PII-safe `view.opened` diagnostic.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class SummarySlideViewModelTest {
    /** A fake whose feeds are re-read on every (re)collection, so a mutation before `refresh()` is observed. */
    private class FakeSource : SummarySlideSource {
        var vehiclesEmissions: List<Resource<List<Vehicle>>> = listOf(loadingVehicles())

        // Keyed by the requested vehicle id; the year is fixed (YEAR) across the suite.
        val yearReviewEmissions = mutableMapOf<String, List<Resource<JsonElement>>>()
        var settingsEmissions: List<Resource<JsonElement>> = listOf(Resource.Success(JsonObject(emptyMap()), 0L, false))

        /** Every vehicle id the recap feed was requested for — asserts it is never called without one. */
        val requestedVehicleIds = mutableListOf<String>()

        override fun vehicles(): Flow<Resource<List<Vehicle>>> = flow { vehiclesEmissions.forEach { emit(it) } }

        override fun yearReview(
            year: Int,
            vehicleId: String,
        ): Flow<Resource<JsonElement>> =
            flow {
                requestedVehicleIds += vehicleId
                (yearReviewEmissions[vehicleId] ?: listOf(loadingReview())).forEach { emit(it) }
            }

        override fun settings(): Flow<Resource<JsonElement>> = flow { settingsEmissions.forEach { emit(it) } }
    }

    private class RecordingLogger : Logger {
        val events = mutableListOf<Pair<String, Map<String, String>>>()

        override fun log(
            level: LogLevel,
            event: String,
            fields: Map<String, String>,
        ) {
            events += event to fields
        }
    }

    @Test
    fun loadingWhileVehiclesListResolves() =
        runTest(UnconfinedTestDispatcher()) {
            val vm = viewModel(FakeSource())
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()
            assertEquals(UiPhase.Loading, vm.state.value.phase)
        }

    @Test
    fun contentWhenFirstVehicleHasRecap() =
        runTest(UnconfinedTestDispatcher()) {
            val src = FakeSource()
            src.vehiclesEmissions = listOf(Resource.Success(listOf(vehicle(5)), 50L, false))
            src.yearReviewEmissions["5"] = listOf(Resource.Success(reviewJson(), 100L, false))
            val vm = viewModel(src)
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()

            val state = vm.state.value
            assertEquals(UiPhase.Content, state.phase)
            assertEquals(100L, state.fetchedAt)
            assertEquals(listOf("5"), src.requestedVehicleIds)
        }

    @Test
    fun emptyWhenNoVehiclesEnrolledAndNeverRequestsRecap() =
        runTest(UnconfinedTestDispatcher()) {
            val src = FakeSource()
            // Empty vehicles list ⇒ web `id = 0` ⇒ disabled query ⇒ empty surface (NOT fleet-wide).
            src.vehiclesEmissions = listOf(Resource.Success(emptyList(), 100L, false))
            val vm = viewModel(src)
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()

            assertEquals(UiPhase.Empty, vm.state.value.phase)
            assertTrue("recap must never be requested without a vehicle", src.requestedVehicleIds.isEmpty())
        }

    @Test
    fun emptyWhenVehiclesListErrorsWithNoCache() =
        runTest(UnconfinedTestDispatcher()) {
            val src = FakeSource()
            // A vehicles error with nothing cached ⇒ no resolvable vehicle ⇒ disabled-query empty surface.
            src.vehiclesEmissions = listOf(loadingVehicles(), Resource.Error(null, null, false, ApiError.Network()))
            val vm = viewModel(src)
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()

            assertEquals(UiPhase.Empty, vm.state.value.phase)
            assertTrue(src.requestedVehicleIds.isEmpty())
        }

    @Test
    fun explicitVehicleIdBypassesVehiclesList() =
        runTest(UnconfinedTestDispatcher()) {
            val src = FakeSource()
            // Vehicles list never resolves; the explicit id must still drive the recap feed.
            src.yearReviewEmissions["9"] = listOf(Resource.Success(reviewJson(), 100L, false))
            val vm = viewModel(src, vehicleId = 9)
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()
            assertEquals(UiPhase.Content, vm.state.value.phase)
            assertEquals(listOf("9"), src.requestedVehicleIds)
        }

    @Test
    fun emptyWhenRecapPayloadIsEmptyObject() =
        runTest(UnconfinedTestDispatcher()) {
            val src = FakeSource()
            src.vehiclesEmissions = listOf(Resource.Success(listOf(vehicle(5)), 50L, false))
            src.yearReviewEmissions["5"] = listOf(Resource.Success(JsonObject(emptyMap()), 100L, false))
            val vm = viewModel(src)
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()
            assertEquals(UiPhase.Empty, vm.state.value.phase)
        }

    @Test
    fun contentWhenRecapPayloadIsPopulatedButAllZero() =
        runTest(UnconfinedTestDispatcher()) {
            val src = FakeSource()
            src.vehiclesEmissions = listOf(Resource.Success(listOf(vehicle(5)), 50L, false))
            // Web `data` is truthy for any populated payload — a vehicle with no drives renders the card.
            src.yearReviewEmissions["5"] = listOf(Resource.Success(buildJsonObject { put("total_drives", 0.0) }, 100L, false))
            val vm = viewModel(src)
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()
            assertEquals(UiPhase.Content, vm.state.value.phase)
        }

    @Test
    fun hardErrorWithRetryWhenRecapFailsWithNoCache() =
        runTest(UnconfinedTestDispatcher()) {
            val src = FakeSource()
            src.vehiclesEmissions = listOf(Resource.Success(listOf(vehicle(5)), 50L, false))
            src.yearReviewEmissions["5"] = listOf(loadingReview(), Resource.Error(null, null, false, ApiError.Network()))
            val vm = viewModel(src)
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()

            val state = vm.state.value
            assertEquals(UiPhase.Error, state.phase)
            assertEquals(ErrorKind.Network, state.errorKind)
            assertTrue(state.canRetry)
        }

    @Test
    fun staleOfflineKeepsCachedRecapWithRetry() =
        runTest(UnconfinedTestDispatcher()) {
            val src = FakeSource()
            src.vehiclesEmissions = listOf(Resource.Success(listOf(vehicle(5)), 50L, false))
            val cached = reviewJson(distanceKm = 2500.0)
            src.yearReviewEmissions["5"] = listOf(Resource.Success(cached, 100L, false))
            val vm = viewModel(src)
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()
            assertEquals(UiPhase.Content, vm.state.value.phase)

            src.yearReviewEmissions["5"] = listOf(Resource.Error(cached, 100L, true, ApiError.Timeout()))
            vm.refresh()
            advanceUntilIdle()

            val state = vm.state.value
            assertEquals(UiPhase.Content, state.phase)
            assertTrue(state.stale)
            assertTrue(state.isOffline)
            assertTrue(state.canRetry)
            assertEquals(ErrorKind.Timeout, state.errorKind)
        }

    @Test
    fun refreshReFetchesUpdatedRecap() =
        runTest(UnconfinedTestDispatcher()) {
            val src = FakeSource()
            src.vehiclesEmissions = listOf(Resource.Success(listOf(vehicle(5)), 50L, false))
            src.yearReviewEmissions["5"] = listOf(Resource.Success(reviewJson(distanceKm = 1000.0), 100L, false))
            val vm = viewModel(src)
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()
            assertEquals(1000.0, parseSummarySlide(vm.state.value.data)!!.totalDistanceKm, 0.0)

            src.yearReviewEmissions["5"] = listOf(Resource.Success(reviewJson(distanceKm = 8800.0), 200L, false))
            vm.refresh()
            advanceUntilIdle()

            assertEquals(8800.0, parseSummarySlide(vm.state.value.data)!!.totalDistanceKm, 0.0)
            assertEquals(200L, vm.state.value.fetchedAt)
        }

    @Test
    fun displayPrefsReflectSettingsDocument() =
        runTest(UnconfinedTestDispatcher()) {
            val src = FakeSource()
            src.settingsEmissions =
                listOf(Resource.Success(buildJsonObject { put("unit_of_length", "mi") }, 10L, false))
            val vm = viewModel(src)
            backgroundScope.launch { vm.displayPrefs.collect {} }
            advanceUntilIdle()

            assertEquals(DistanceUnitPref.MI, vm.displayPrefs.value.distanceUnit)
        }

    @Test
    fun onAppearEmitsSlugExactlyOnce() =
        runTest(UnconfinedTestDispatcher()) {
            val logger = RecordingLogger()
            val vm = viewModel(FakeSource(), logger = logger)

            vm.onAppear()
            vm.onAppear()

            val opened = logger.events.filter { it.first == "view.opened" }
            assertEquals(1, opened.size)
            assertEquals(mapOf("surface" to "SummarySlide"), opened.single().second)
        }

    @Test
    fun refreshEmitsDiagnosticWithoutRecapPayload() =
        runTest(UnconfinedTestDispatcher()) {
            val logger = RecordingLogger()
            val vm = viewModel(FakeSource(), logger = logger)

            vm.refresh()

            assertTrue(logger.events.any { it.first == "summarySlide.refresh" })
            assertFalse(logger.events.any { it.second.containsKey("distance") })
            assertFalse(logger.events.any { it.second.containsKey("savings") })
            assertFalse(logger.events.any { it.second.containsKey("vehicle_id") })
        }

    private fun TestScope.viewModel(
        source: SummarySlideSource,
        logger: Logger = NoopLogger,
        vehicleId: Long? = null,
    ): SummarySlideViewModel = SummarySlideViewModel(source, logger, YEAR, vehicleId, backgroundScope)

    private companion object {
        const val YEAR = 2024

        fun loadingVehicles(): Resource<List<Vehicle>> = Resource.Loading(cached = null, fetchedAt = null, stale = false)

        fun loadingReview(): Resource<JsonElement> = Resource.Loading(cached = null, fetchedAt = null, stale = false)

        fun reviewJson(distanceKm: Double = 10_000.0): JsonElement =
            buildJsonObject {
                put("year", 2024)
                put("total_drives", 320.0)
                put("total_distance_km", distanceKm)
                put("total_energy_kwh", 3456.7)
                put("total_charge_sessions", 88.0)
                put("co2_offset_kg", 1200.0)
                put("gas_savings", 1500.0)
            }

        fun vehicle(id: Long): Vehicle =
            Vehicle(
                createdAt = Instant.fromEpochSeconds(0),
                displayName = "Car $id",
                enrolledAt = Instant.fromEpochSeconds(0),
                id = id,
                teslaId = id,
                timezone = "UTC",
                updatedAt = Instant.fromEpochSeconds(0),
                vin = "VIN$id",
            )
    }
}
