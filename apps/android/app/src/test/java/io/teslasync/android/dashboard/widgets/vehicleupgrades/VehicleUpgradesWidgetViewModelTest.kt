package io.teslasync.android.dashboard.widgets.vehicleupgrades

import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.NoopLogger
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.vehicles.vehicle
import io.teslasync.shared.core.api.generated.Drive
import io.teslasync.shared.core.api.generated.Vehicle
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.net.ApiError
import io.teslasync.shared.core.presentation.sharing.ShareToken
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
import kotlinx.serialization.json.add
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import kotlin.time.Instant

/**
 * Drives [VehicleUpgradesWidgetViewModel] over a controllable fake [VehicleUpgradesSource], covering the full
 * cache-then-network state matrix the web component renders (loading / content / empty / hard error + retry /
 * stale-offline + retry / refresh re-fetch), the upgrades-primary contract (the drives → share-links chain
 * never gates the surface), the active-vehicle resolution (preferred id vs. first enrolled), the asymmetric
 * error semantics (an upgrades failure is a hard error like web `isError`, while a vehicles-list failure
 * degrades to a cached empty), and the PII-safe `view.opened` diagnostic.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class VehicleUpgradesWidgetViewModelTest {
    /** A fake whose feeds are re-read on every (re)collection, so a change before `refresh()` is observed. */
    private class FakeSource : VehicleUpgradesSource {
        var vehiclesEmissions: List<Resource<List<Vehicle>>> = listOf(loadingVehicles())
        val upgradeEmissions = mutableMapOf<String, List<Resource<JsonElement>>>()
        val driveEmissions = mutableMapOf<String, List<Resource<List<Drive>>>>()
        val shareLinkEmissions = mutableMapOf<String, List<Resource<List<ShareToken>>>>()

        override fun vehicles(): Flow<Resource<List<Vehicle>>> = flow { vehiclesEmissions.forEach { emit(it) } }

        override fun vehicleUpgrades(vehicleId: String): Flow<Resource<JsonElement>> =
            flow { (upgradeEmissions[vehicleId] ?: listOf(loadingJson())).forEach { emit(it) } }

        override fun drives(vehicleId: String): Flow<Resource<List<Drive>>> =
            flow { (driveEmissions[vehicleId] ?: listOf(Resource.Success(emptyList(), 0L, false))).forEach { emit(it) } }

        override fun shareLinks(driveId: String): Flow<Resource<List<ShareToken>>> =
            flow { (shareLinkEmissions[driveId] ?: listOf(Resource.Success(emptyList(), 0L, false))).forEach { emit(it) } }
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
    fun contentWithUpgradesAndShareLinksFromFirstVehicle() =
        runTest(UnconfinedTestDispatcher()) {
            val src = FakeSource()
            src.vehiclesEmissions = listOf(Resource.Success(listOf(vehicle(1)), 50L, false))
            src.upgradeEmissions["1"] = listOf(Resource.Success(envelope(upgradeCount = 2), 100L, false))
            src.driveEmissions["1"] = listOf(Resource.Success(listOf(drive(10)), 80L, false))
            src.shareLinkEmissions["10"] = listOf(Resource.Success(listOf(shareToken(1, "2099-01-01")), 90L, false))
            val vm = viewModel(src)
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()

            val state = vm.state.value
            assertEquals(UiPhase.Content, state.phase)
            // Freshness is upgrades-primary (web shellProps.updatedAt = upgrades.dataUpdatedAt).
            assertEquals(100L, state.fetchedAt)
            assertEquals(2, parseUpgrades(state.data?.upgradesData).size)
            assertEquals(1, state.data?.shareLinks?.size)
        }

    @Test
    fun upgradesAreContentEvenWhileDrivesNeverResolve() =
        runTest(UnconfinedTestDispatcher()) {
            val src = FakeSource()
            src.vehiclesEmissions = listOf(Resource.Success(listOf(vehicle(1)), 50L, false))
            src.upgradeEmissions["1"] = listOf(Resource.Success(envelope(upgradeCount = 1), 100L, false))
            // The drives feed only ever loads — the share-links chain must NOT hold the surface loading.
            src.driveEmissions["1"] = listOf(Resource.Loading(cached = null, fetchedAt = null, stale = false))
            val vm = viewModel(src)
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()

            val state = vm.state.value
            assertEquals(UiPhase.Content, state.phase)
            assertEquals(1, parseUpgrades(state.data?.upgradesData).size)
            assertTrue(
                state.data
                    ?.shareLinks
                    .orEmpty()
                    .isEmpty(),
            )
        }

    @Test
    fun emptyWhenNoUpgradesAndNoShareLinks() =
        runTest(UnconfinedTestDispatcher()) {
            val src = FakeSource()
            src.vehiclesEmissions = listOf(Resource.Success(listOf(vehicle(1)), 50L, false))
            src.upgradeEmissions["1"] = listOf(Resource.Success(buildJsonObject { put("data", JsonNull) }, 100L, false))
            src.driveEmissions["1"] = listOf(Resource.Success(emptyList(), 80L, false))
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
    fun hardErrorWithRetryWhenUpgradesFailWithNoCache() =
        runTest(UnconfinedTestDispatcher()) {
            val src = FakeSource()
            src.vehiclesEmissions = listOf(Resource.Success(listOf(vehicle(1)), 50L, false))
            src.upgradeEmissions["1"] = listOf(loadingJson(), Resource.Error(null, null, false, ApiError.Network()))
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
            // A vehicles-list failure must NOT raise the hard error surface (web disables the upgrades query).
            assertEquals(UiPhase.Empty, state.phase)
            assertTrue(state.hasError)
            assertTrue(state.canRetry)
        }

    @Test
    fun staleOfflineKeepsCachedSnapshotWithRetry() =
        runTest(UnconfinedTestDispatcher()) {
            val src = FakeSource()
            src.vehiclesEmissions = listOf(Resource.Success(listOf(vehicle(1)), 50L, false))
            val cached = envelope(upgradeCount = 2)
            src.upgradeEmissions["1"] = listOf(Resource.Success(cached, 100L, false))
            val vm = viewModel(src)
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()
            assertEquals(UiPhase.Content, vm.state.value.phase)

            src.upgradeEmissions["1"] = listOf(Resource.Error(cached, 100L, true, ApiError.Timeout()))
            vm.refresh()
            advanceUntilIdle()

            val state = vm.state.value
            assertEquals(UiPhase.Content, state.phase)
            assertTrue(state.stale)
            assertTrue(state.isOffline)
            assertEquals(ErrorKind.Timeout, state.errorKind)
            assertEquals(2, parseUpgrades(state.data?.upgradesData).size)
        }

    @Test
    fun refreshReFetchesUpdatedEnvelope() =
        runTest(UnconfinedTestDispatcher()) {
            val src = FakeSource()
            src.vehiclesEmissions = listOf(Resource.Success(listOf(vehicle(1)), 50L, false))
            src.upgradeEmissions["1"] = listOf(Resource.Success(envelope(upgradeCount = 1), 100L, false))
            val vm = viewModel(src)
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()
            assertEquals(100L, vm.state.value.fetchedAt)

            src.upgradeEmissions["1"] = listOf(Resource.Success(envelope(upgradeCount = 3), 200L, false))
            vm.refresh()
            advanceUntilIdle()
            assertEquals(200L, vm.state.value.fetchedAt)
            assertEquals(
                3,
                parseUpgrades(
                    vm.state.value.data
                        ?.upgradesData,
                ).size,
            )
        }

    @Test
    fun preferredVehicleIdShortCircuitsTheVehicleList() =
        runTest(UnconfinedTestDispatcher()) {
            val src = FakeSource()
            // The vehicle list errors, but a bound id must bypass it entirely (web `vehicleId ?? …`).
            src.vehiclesEmissions = listOf(Resource.Error(null, null, false, ApiError.Network()))
            src.upgradeEmissions["7"] = listOf(Resource.Success(envelope(upgradeCount = 1), 100L, false))
            val vm = VehicleUpgradesWidgetViewModel(src, NoopLogger, backgroundScope, vehicleId = 7L)
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
            assertEquals(mapOf("surface" to "VehicleUpgradesWidget"), opened.single().second)
        }

    @Test
    fun refreshEmitsDiagnosticWithoutUpgradeOrSharedPayload() =
        runTest(UnconfinedTestDispatcher()) {
            val logger = RecordingLogger()
            val vm = viewModel(FakeSource(), logger = logger)

            vm.refresh()

            assertTrue(logger.events.any { it.first == "vehicleUpgrades.refresh" })
            assertFalse(logger.events.any { it.second.containsKey("price") })
            assertFalse(logger.events.any { it.second.containsKey("token") })
        }

    private fun TestScope.viewModel(
        source: VehicleUpgradesSource,
        logger: Logger = NoopLogger,
    ): VehicleUpgradesWidgetViewModel = VehicleUpgradesWidgetViewModel(source, logger, backgroundScope)

    private companion object {
        fun loadingJson(): Resource<JsonElement> = Resource.Loading(cached = null, fetchedAt = null, stale = false)

        fun loadingVehicles(): Resource<List<Vehicle>> = Resource.Loading(cached = null, fetchedAt = null, stale = false)

        /** An upgrades envelope carrying [upgradeCount] entries in its `data.upgrades` array. */
        fun envelope(upgradeCount: Int): JsonElement =
            buildJsonObject {
                put(
                    "data",
                    buildJsonObject {
                        put(
                            "upgrades",
                            buildJsonArray {
                                repeat(upgradeCount) { index -> add(buildJsonObject { put("name", "Upgrade $index") }) }
                            },
                        )
                    },
                )
            }

        fun drive(id: Long): Drive =
            Drive(
                createdAt = Instant.fromEpochMilliseconds(0),
                distanceM = 1_000.0,
                durationS = 600L,
                id = id,
                startTs = Instant.fromEpochMilliseconds(id * 1_000L),
                updatedAt = Instant.fromEpochMilliseconds(0),
                vehicleId = 1L,
            )

        fun shareToken(
            id: Long,
            expiresAt: String?,
        ): ShareToken =
            ShareToken(
                id = id,
                token = "tok$id",
                driveId = 10L,
                includeMap = true,
                includeTelemetry = false,
                includeSpeed = true,
                views = 0,
                expiresAt = expiresAt,
                createdAt = "2024-01-01T00:00:00Z",
            )
    }
}
