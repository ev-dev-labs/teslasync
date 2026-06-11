package io.teslasync.android.dashboard.widgets.subscriptions

import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.NoopLogger
import io.teslasync.android.data.UiPhase
import io.teslasync.shared.core.api.generated.Vehicle
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.net.ApiError
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.flow
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import kotlin.time.Instant

/**
 * Drives [SubscriptionsWidgetViewModel] over a controllable fake [SubscriptionsSource], covering the full
 * cache-then-network state matrix the web component renders (loading / content / empty / hard error + retry /
 * stale-offline + retry / refresh re-fetch), the active-vehicle resolution (preferred id vs. first enrolled),
 * the asymmetric error semantics (a subscriptions failure is a hard error like web `isError`, while a
 * vehicles-list failure degrades to a cached empty rather than the hard error surface), and the PII-safe
 * `view.opened` diagnostic.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class SubscriptionsWidgetViewModelTest {
    /** A fake whose feeds are re-read on every (re)collection, so a change before `refresh()` is observed. */
    private class FakeSource : SubscriptionsSource {
        var vehiclesEmissions: List<Resource<List<Vehicle>>> = listOf(loadingVehicles())
        val subsEmissions = mutableMapOf<String, List<Resource<JsonElement>>>()

        override fun vehicles(): Flow<Resource<List<Vehicle>>> = flow { vehiclesEmissions.forEach { emit(it) } }

        override fun subscriptions(vehicleId: String): Flow<Resource<JsonElement>> =
            flow { (subsEmissions[vehicleId] ?: listOf(loading())).forEach { emit(it) } }
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
    fun loadingWhileVehiclesLoad() =
        runTest(UnconfinedTestDispatcher()) {
            val vm = viewModel(FakeSource())
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()
            assertEquals(UiPhase.Loading, vm.state.value.phase)
        }

    @Test
    fun contentFromFirstEnrolledVehicle() =
        runTest(UnconfinedTestDispatcher()) {
            val src = FakeSource()
            src.vehiclesEmissions = listOf(Resource.Success(listOf(vehicle(1)), 50L, false))
            src.subsEmissions["1"] = listOf(Resource.Success(envelope(premium = true), 100L, false))
            val vm = viewModel(src)
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()

            val state = vm.state.value
            assertEquals(UiPhase.Content, state.phase)
            assertEquals(100L, state.fetchedAt)
            assertTrue(subscriptionsData(state.data) != null)
        }

    @Test
    fun emptyWhenEnvelopeHasNoDataObject() =
        runTest(UnconfinedTestDispatcher()) {
            val src = FakeSource()
            src.vehiclesEmissions = listOf(Resource.Success(listOf(vehicle(1)), 50L, false))
            src.subsEmissions["1"] = listOf(Resource.Success(buildJsonObject { put("data", JsonNull) }, 100L, false))
            val vm = viewModel(src)
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()
            assertEquals(UiPhase.Empty, vm.state.value.phase)
        }

    @Test
    fun emptyWhenNoVehicleResolves() =
        runTest(UnconfinedTestDispatcher()) {
            val src = FakeSource()
            src.vehiclesEmissions = listOf(Resource.Success(emptyList(), 100L, false))
            val vm = viewModel(src)
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()
            assertEquals(UiPhase.Empty, vm.state.value.phase)
        }

    @Test
    fun hardErrorWithRetryWhenSubscriptionsFailWithNoCache() =
        runTest(UnconfinedTestDispatcher()) {
            val src = FakeSource()
            src.vehiclesEmissions = listOf(Resource.Success(listOf(vehicle(1)), 50L, false))
            src.subsEmissions["1"] = listOf(loading(), Resource.Error(null, null, false, ApiError.Network()))
            val vm = viewModel(src)
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()

            val state = vm.state.value
            assertEquals(UiPhase.Error, state.phase)
            assertEquals(ErrorKind.Network, state.errorKind)
            assertTrue(state.canRetry)
        }

    @Test
    fun vehiclesErrorDegradesToEmptyNotHardError() =
        runTest(UnconfinedTestDispatcher()) {
            val src = FakeSource()
            src.vehiclesEmissions = listOf(loadingVehicles(), Resource.Error(null, null, false, ApiError.Network()))
            val vm = viewModel(src)
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()

            val state = vm.state.value
            // A vehicles-list failure must NOT raise the hard error surface (web disables the subscriptions query).
            assertEquals(UiPhase.Empty, state.phase)
            assertTrue(state.hasError)
            assertTrue(state.canRetry)
        }

    @Test
    fun staleOfflineKeepsCachedEnvelopeWithRetry() =
        runTest(UnconfinedTestDispatcher()) {
            val src = FakeSource()
            src.vehiclesEmissions = listOf(Resource.Success(listOf(vehicle(1)), 50L, false))
            val cached = envelope(premium = true)
            src.subsEmissions["1"] = listOf(Resource.Success(cached, 100L, false))
            val vm = viewModel(src)
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()
            assertEquals(UiPhase.Content, vm.state.value.phase)

            src.subsEmissions["1"] = listOf(Resource.Error(cached, 100L, true, ApiError.Timeout()))
            vm.refresh()
            advanceUntilIdle()

            val state = vm.state.value
            assertEquals(UiPhase.Content, state.phase)
            assertTrue(state.stale)
            assertTrue(state.isOffline)
            assertEquals(ErrorKind.Timeout, state.errorKind)
        }

    @Test
    fun refreshReFetchesUpdatedEnvelope() =
        runTest(UnconfinedTestDispatcher()) {
            val src = FakeSource()
            src.vehiclesEmissions = listOf(Resource.Success(listOf(vehicle(1)), 50L, false))
            src.subsEmissions["1"] = listOf(Resource.Success(envelope(premium = true), 100L, false))
            val vm = viewModel(src)
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()
            assertEquals(100L, vm.state.value.fetchedAt)

            src.subsEmissions["1"] = listOf(Resource.Success(envelope(premium = true), 200L, false))
            vm.refresh()
            advanceUntilIdle()
            assertEquals(200L, vm.state.value.fetchedAt)
        }

    @Test
    fun preferredVehicleIdShortCircuitsTheVehicleList() =
        runTest(UnconfinedTestDispatcher()) {
            val src = FakeSource()
            // The vehicle list errors, but a bound id must bypass it entirely (web `vehicleId ?? …`).
            src.vehiclesEmissions = listOf(Resource.Error(null, null, false, ApiError.Network()))
            src.subsEmissions["7"] = listOf(Resource.Success(envelope(premium = true), 100L, false))
            val vm = SubscriptionsWidgetViewModel(src, NoopLogger, backgroundScope, vehicleId = 7L)
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()

            assertEquals(UiPhase.Content, vm.state.value.phase)
            assertEquals(100L, vm.state.value.fetchedAt)
        }

    @Test
    fun recordViewOpenedEmitsSlugExactlyOnce() =
        runTest(UnconfinedTestDispatcher()) {
            val logger = RecordingLogger()
            val vm = viewModel(FakeSource(), logger = logger)

            vm.recordViewOpened()
            vm.recordViewOpened()

            val opened = logger.events.filter { it.first == "view.opened" }
            assertEquals(1, opened.size)
            assertEquals(mapOf("surface" to "SubscriptionsWidget"), opened.single().second)
        }

    @Test
    fun refreshEmitsDiagnosticWithoutSubscriptionPayload() =
        runTest(UnconfinedTestDispatcher()) {
            val logger = RecordingLogger()
            val vm = viewModel(FakeSource(), logger = logger)

            vm.refresh()

            assertTrue(logger.events.any { it.first == "subscriptions.refresh" })
            assertFalse(logger.events.any { it.second.containsKey("premium_connectivity") })
            assertFalse(logger.events.any { it.second.containsKey("expiry_date") })
        }

    private fun TestScope.viewModel(
        source: SubscriptionsSource,
        logger: Logger = NoopLogger,
    ): SubscriptionsWidgetViewModel = SubscriptionsWidgetViewModel(source, logger, backgroundScope)

    private companion object {
        fun loading(): Resource<JsonElement> = Resource.Loading(cached = null, fetchedAt = null, stale = false)

        fun loadingVehicles(): Resource<List<Vehicle>> = Resource.Loading(cached = null, fetchedAt = null, stale = false)

        fun envelope(premium: Boolean): JsonElement =
            buildJsonObject { put("data", buildJsonObject { put("premium_connectivity", premium) }) }

        fun vehicle(id: Long): Vehicle =
            Vehicle(
                createdAt = Instant.parse("2026-01-01T00:00:00Z"),
                displayName = "Car $id",
                enrolledAt = Instant.parse("2026-01-01T00:00:00Z"),
                id = id,
                teslaId = 1000 + id,
                timezone = "UTC",
                updatedAt = Instant.parse("2026-01-01T00:10:00Z"),
                vin = "VIN$id",
            )
    }
}
