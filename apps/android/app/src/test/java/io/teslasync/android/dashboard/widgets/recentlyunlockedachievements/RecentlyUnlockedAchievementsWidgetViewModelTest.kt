package io.teslasync.android.dashboard.widgets.recentlyunlockedachievements

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
import kotlinx.serialization.json.addJsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import kotlinx.serialization.json.putJsonArray
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import kotlin.time.Instant

/**
 * Drives [RecentlyUnlockedAchievementsWidgetViewModel] over a controllable fake source, covering the full
 * cache-then-network state matrix the web component renders (loading / content / empty / hard error + retry
 * / stale-offline + retry / refresh re-fetch), the default-vehicle resolution from the vehicles list (web
 * `vehicles?.[0]?.id`), the fleet-wide fallback when no vehicle resolves (web `?? 0`), the explicit-vehicle
 * override, the live `showOnDashboard` opt-out (web `useAchievementCelebrationPrefs`), and the PII-safe
 * `view.opened` diagnostic.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class RecentlyUnlockedAchievementsWidgetViewModelTest {
    /** A fake whose feeds are re-read on every (re)collection, so a mutation before `refresh()` is observed. */
    private class FakeSource : RecentlyUnlockedAchievementsSource {
        var vehiclesEmissions: List<Resource<List<Vehicle>>> = listOf(loadingVehicles())

        // Keyed by the requested vehicle id; the null key holds the fleet-wide (`vehicle_id`-less) feed.
        val lifetimeEmissions = mutableMapOf<String?, List<Resource<JsonElement>>>()
        var showOnDashboardEmissions: List<Boolean> = listOf(true)

        override fun vehicles(): Flow<Resource<List<Vehicle>>> = flow { vehiclesEmissions.forEach { emit(it) } }

        override fun lifetimeStats(vehicleId: String?): Flow<Resource<JsonElement>> =
            flow { (lifetimeEmissions[vehicleId] ?: listOf(loadingLifetime())).forEach { emit(it) } }

        override fun showOnDashboard(): Flow<Boolean> = flow { showOnDashboardEmissions.forEach { emit(it) } }
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
    fun loadingWhileFleetFeedLoads() =
        runTest(UnconfinedTestDispatcher()) {
            val vm = viewModel(FakeSource())
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()
            assertEquals(UiPhase.Loading, vm.state.value.phase)
        }

    @Test
    fun contentWhenFirstVehicleHasUnlocks() =
        runTest(UnconfinedTestDispatcher()) {
            val src = FakeSource()
            src.vehiclesEmissions = listOf(Resource.Success(listOf(vehicle(5)), 50L, false))
            src.lifetimeEmissions["5"] = listOf(Resource.Success(unlockedJson(), 100L, false))
            val vm = viewModel(src)
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()

            val state = vm.state.value
            assertEquals(UiPhase.Content, state.phase)
            assertEquals(100L, state.fetchedAt)
            assertTrue(hasRecentUnlocks(parseAchievements(state.data)))
        }

    @Test
    fun emptyWhenNoAchievementUnlocked() =
        runTest(UnconfinedTestDispatcher()) {
            val src = FakeSource()
            src.vehiclesEmissions = listOf(Resource.Success(listOf(vehicle(5)), 50L, false))
            src.lifetimeEmissions["5"] = listOf(Resource.Success(lockedJson(), 100L, false))
            val vm = viewModel(src)
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()
            assertEquals(UiPhase.Empty, vm.state.value.phase)
        }

    @Test
    fun fleetWideContentWhenNoVehiclesEnrolled() =
        runTest(UnconfinedTestDispatcher()) {
            val src = FakeSource()
            src.vehiclesEmissions = listOf(Resource.Success(emptyList(), 100L, false))
            src.lifetimeEmissions[null] = listOf(Resource.Success(unlockedJson(), 120L, false))
            val vm = viewModel(src)
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()

            assertEquals(UiPhase.Content, vm.state.value.phase)
            assertEquals(120L, vm.state.value.fetchedAt)
        }

    @Test
    fun explicitVehicleIdBypassesVehiclesList() =
        runTest(UnconfinedTestDispatcher()) {
            val src = FakeSource()
            // Vehicles list never resolves; the explicit id must still drive the lifetime feed.
            src.lifetimeEmissions["9"] = listOf(Resource.Success(unlockedJson(), 100L, false))
            val vm = viewModel(src, vehicleId = 9)
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()
            assertEquals(UiPhase.Content, vm.state.value.phase)
        }

    @Test
    fun hardErrorWithRetryWhenLifetimeFailsWithNoCache() =
        runTest(UnconfinedTestDispatcher()) {
            val src = FakeSource()
            src.vehiclesEmissions = listOf(Resource.Success(listOf(vehicle(5)), 50L, false))
            src.lifetimeEmissions["5"] = listOf(loadingLifetime(), Resource.Error(null, null, false, ApiError.Network()))
            val vm = viewModel(src)
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()

            val state = vm.state.value
            assertEquals(UiPhase.Error, state.phase)
            assertEquals(ErrorKind.Network, state.errorKind)
            assertTrue(state.canRetry)
        }

    @Test
    fun staleOfflineKeepsCachedBadgesWithRetry() =
        runTest(UnconfinedTestDispatcher()) {
            val src = FakeSource()
            src.vehiclesEmissions = listOf(Resource.Success(listOf(vehicle(5)), 50L, false))
            val cached = unlockedJson()
            src.lifetimeEmissions["5"] = listOf(Resource.Success(cached, 100L, false))
            val vm = viewModel(src)
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()
            assertEquals(UiPhase.Content, vm.state.value.phase)

            src.lifetimeEmissions["5"] = listOf(Resource.Error(cached, 100L, true, ApiError.Timeout()))
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
    fun refreshReFetchesUpdatedAchievements() =
        runTest(UnconfinedTestDispatcher()) {
            val src = FakeSource()
            src.vehiclesEmissions = listOf(Resource.Success(listOf(vehicle(5)), 50L, false))
            src.lifetimeEmissions["5"] = listOf(Resource.Success(lockedJson(), 100L, false))
            val vm = viewModel(src)
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()
            assertEquals(UiPhase.Empty, vm.state.value.phase)

            src.lifetimeEmissions["5"] = listOf(Resource.Success(unlockedJson(), 200L, false))
            vm.refresh()
            advanceUntilIdle()

            assertEquals(UiPhase.Content, vm.state.value.phase)
            assertEquals(200L, vm.state.value.fetchedAt)
        }

    @Test
    fun showOnDashboardReflectsSourcePreference() =
        runTest(UnconfinedTestDispatcher()) {
            val on = FakeSource()
            val vmOn = viewModel(on)
            backgroundScope.launch { vmOn.showOnDashboard.collect {} }
            advanceUntilIdle()
            assertTrue(vmOn.showOnDashboard.value)

            val off = FakeSource().apply { showOnDashboardEmissions = listOf(false) }
            val vmOff = viewModel(off)
            backgroundScope.launch { vmOff.showOnDashboard.collect {} }
            advanceUntilIdle()
            assertFalse(vmOff.showOnDashboard.value)
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
            assertEquals(mapOf("surface" to "RecentlyUnlockedAchievements"), opened.single().second)
        }

    @Test
    fun refreshEmitsDiagnosticWithoutAchievementPayload() =
        runTest(UnconfinedTestDispatcher()) {
            val logger = RecordingLogger()
            val vm = viewModel(FakeSource(), logger = logger)

            vm.refresh()

            assertTrue(logger.events.any { it.first == "recentlyUnlocked.refresh" })
            assertFalse(logger.events.any { it.second.containsKey("name") })
            assertFalse(logger.events.any { it.second.containsKey("achievement") })
        }

    private fun TestScope.viewModel(
        source: RecentlyUnlockedAchievementsSource,
        logger: Logger = NoopLogger,
        vehicleId: Long? = null,
    ): RecentlyUnlockedAchievementsWidgetViewModel = RecentlyUnlockedAchievementsWidgetViewModel(source, logger, vehicleId, backgroundScope)

    private companion object {
        fun loadingVehicles(): Resource<List<Vehicle>> = Resource.Loading(cached = null, fetchedAt = null, stale = false)

        fun loadingLifetime(): Resource<JsonElement> = Resource.Loading(cached = null, fetchedAt = null, stale = false)

        fun unlockedJson(): JsonElement =
            buildJsonObject {
                putJsonArray("achievements") {
                    addJsonObject {
                        put("id", "first-drive")
                        put("name", "First Drive")
                        put("icon", "\uD83C\uDFC1")
                        put("unlocked", true)
                        put("unlocked_at", "2024-03-20T10:00:00Z")
                    }
                }
            }

        fun lockedJson(): JsonElement =
            buildJsonObject {
                putJsonArray("achievements") {
                    addJsonObject {
                        put("id", "locked")
                        put("name", "Locked")
                        put("unlocked", false)
                    }
                }
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
