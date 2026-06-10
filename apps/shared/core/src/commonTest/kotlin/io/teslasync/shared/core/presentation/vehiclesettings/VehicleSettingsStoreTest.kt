package io.teslasync.shared.core.presentation.vehiclesettings

import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.data.repo.VehicleSettingsRepository
import io.teslasync.shared.core.data.repo.vehicleSettingsCacheKey
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.flow
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonPrimitive
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotSame
import kotlin.test.assertSame
import kotlin.test.assertTrue

/**
 * Verifies the S8 [VehicleSettingsStore] folds the S7 [VehicleSettingsRepository] into a shared,
 * refreshable feed and routes each mutation to the right repository call + the right per-vehicle
 * refresh + the cross-domain [VehicleSettingsStore]`.onVehicleChanged` hook — using a fake
 * repository, so no network or cache is involved. The verbatim forwarding of the typed value and the
 * per-vehicle invalidation granularity are the behaviours under test.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class VehicleSettingsStoreTest {
    /**
     * Fake S7 port: the read re-counts its collections per key (so a refresh is observable) and emits
     * Loading→Success with a deterministic payload; each mutation records its arguments and succeeds
     * (or fails, when the matching `*Fails` flag is set).
     */
    private class FakeVehicleSettingsRepository(
        val upsertFails: Boolean = false,
        val resetFails: Boolean = false,
    ) : VehicleSettingsRepository {
        val settingsCollections: MutableMap<String, Int> = mutableMapOf()
        val upserted: MutableList<Triple<String, String, JsonElement>> = mutableListOf()
        val reset: MutableList<Pair<String, String>> = mutableListOf()

        override fun vehicleSettings(vehicleId: String): Flow<Resource<VehicleSettingsResponse>> =
            flow {
                val key = vehicleSettingsCacheKey(vehicleId)
                val n = (settingsCollections[key] ?: 0) + 1
                settingsCollections[key] = n
                emit(Resource.Loading(cached = null, fetchedAt = null, stale = false))
                emit(
                    Resource.Success(
                        data =
                            VehicleSettingsResponse(
                                settings =
                                    listOf(
                                        EffectiveSetting("nickname", JsonPrimitive("Bolt-$n"), EffectiveSettingSource.OVERRIDE),
                                    ),
                            ),
                        fetchedAt = 1L,
                        stale = false,
                    ),
                )
            }

        override suspend fun upsertVehicleSetting(
            vehicleId: String,
            key: String,
            value: JsonElement,
        ): Result<Unit> {
            upserted += Triple(vehicleId, key, value)
            return if (upsertFails) Result.failure(IllegalStateException("boom")) else Result.success(Unit)
        }

        override suspend fun resetVehicleSetting(
            vehicleId: String,
            key: String,
        ): Result<Unit> {
            reset += vehicleId to key
            return if (resetFails) Result.failure(IllegalStateException("boom")) else Result.success(Unit)
        }
    }

    @Test
    fun vehicleSettingsReadEmitsCacheThenNetwork() =
        runTest {
            val store = VehicleSettingsStore(FakeVehicleSettingsRepository(), backgroundScope)
            val seen = mutableListOf<Resource<VehicleSettingsResponse>>()
            backgroundScope.launch { store.vehicleSettings("42").collect { seen += it } }
            runCurrent()

            assertTrue(seen.first() is Resource.Loading, "first emission is Loading (cache slot)")
            val last = seen.last()
            assertTrue(last is Resource.Success, "terminal emission is the network Success")
            val firstRow = last.data.settings.first()
            assertEquals("nickname", firstRow.key)
        }

    @Test
    fun sameVehicleSharesUpstreamAndDistinctVehiclesAreDistinctFeeds() =
        runTest {
            val store = VehicleSettingsStore(FakeVehicleSettingsRepository(), backgroundScope)
            assertSame(store.vehicleSettings("42"), store.vehicleSettings("42"))
            assertNotSame(store.vehicleSettings("42"), store.vehicleSettings("43"))
        }

    @Test
    fun upsertForwardsValueRefreshesOnlyThatFeedAndFiresVehicleChanged() =
        runTest {
            val repo = FakeVehicleSettingsRepository()
            val changed = mutableListOf<String>()
            val store = VehicleSettingsStore(repo, backgroundScope, onVehicleChanged = { changed += it })
            backgroundScope.launch { store.vehicleSettings("42").collect {} }
            backgroundScope.launch { store.vehicleSettings("99").collect {} }
            runCurrent()
            assertEquals(1, repo.settingsCollections[vehicleSettingsCacheKey("42")])
            assertEquals(1, repo.settingsCollections[vehicleSettingsCacheKey("99")])

            val value = JsonPrimitive("Lightning")
            val result = store.upsertVehicleSetting("42", "nickname", value)
            runCurrent()

            assertTrue(result.isSuccess)
            assertEquals(listOf(Triple("42", "nickname", value as JsonElement)), repo.upserted)
            // Only vehicle 42's feed re-fetched; vehicle 99 untouched.
            assertEquals(2, repo.settingsCollections[vehicleSettingsCacheKey("42")])
            assertEquals(1, repo.settingsCollections[vehicleSettingsCacheKey("99")])
            assertEquals(listOf("42"), changed)
        }

    @Test
    fun failedUpsertRefreshesNothingAndDoesNotFireVehicleChanged() =
        runTest {
            val repo = FakeVehicleSettingsRepository(upsertFails = true)
            val changed = mutableListOf<String>()
            val store = VehicleSettingsStore(repo, backgroundScope, onVehicleChanged = { changed += it })
            backgroundScope.launch { store.vehicleSettings("42").collect {} }
            runCurrent()

            val result = store.upsertVehicleSetting("42", "nickname", JsonPrimitive("x"))
            runCurrent()

            assertTrue(result.isFailure)
            assertEquals(1, repo.settingsCollections[vehicleSettingsCacheKey("42")], "a failed upsert never refreshes")
            assertTrue(changed.isEmpty())
        }

    @Test
    fun resetDelegatesRefreshesThatFeedAndFiresVehicleChanged() =
        runTest {
            val repo = FakeVehicleSettingsRepository()
            val changed = mutableListOf<String>()
            val store = VehicleSettingsStore(repo, backgroundScope, onVehicleChanged = { changed += it })
            backgroundScope.launch { store.vehicleSettings("42").collect {} }
            runCurrent()

            val result = store.resetVehicleSetting("42", "nickname")
            runCurrent()

            assertTrue(result.isSuccess)
            assertEquals(listOf("42" to "nickname"), repo.reset)
            assertEquals(2, repo.settingsCollections[vehicleSettingsCacheKey("42")])
            assertEquals(listOf("42"), changed)
        }

    @Test
    fun failedResetRefreshesNothingAndDoesNotFireVehicleChanged() =
        runTest {
            val repo = FakeVehicleSettingsRepository(resetFails = true)
            val changed = mutableListOf<String>()
            val store = VehicleSettingsStore(repo, backgroundScope, onVehicleChanged = { changed += it })
            backgroundScope.launch { store.vehicleSettings("42").collect {} }
            runCurrent()

            val result = store.resetVehicleSetting("42", "nickname")
            runCurrent()

            assertTrue(result.isFailure)
            assertEquals(1, repo.settingsCollections[vehicleSettingsCacheKey("42")], "a failed reset never refreshes")
            assertTrue(changed.isEmpty())
        }

    @Test
    fun refreshIsNoOpWhenNothingIsObserved() =
        runTest {
            val repo = FakeVehicleSettingsRepository()
            val store = VehicleSettingsStore(repo, backgroundScope)

            store.refreshSettingsFeed("42")
            runCurrent()

            assertTrue(repo.settingsCollections.isEmpty(), "no feed observed ⇒ no needless upstream restart")
        }
}
