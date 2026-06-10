package io.teslasync.shared.core.presentation.user

import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.data.repo.USER_ME_KEY
import io.teslasync.shared.core.data.repo.USER_TESLA_FEATURE_CONFIG_KEY
import io.teslasync.shared.core.data.repo.USER_TESLA_ORDERS_KEY
import io.teslasync.shared.core.data.repo.USER_TESLA_PROFILE_KEY
import io.teslasync.shared.core.data.repo.USER_TESLA_REGION_KEY
import io.teslasync.shared.core.data.repo.UserRepository
import io.teslasync.shared.core.data.repo.userActivityCacheKey
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
import kotlin.test.assertSame
import kotlin.test.assertTrue

/**
 * Verifies the S8 [UserStore] folds each S7 [UserRepository] read into a shared, refreshable
 * cache-then-network feed and routes each mutation to the right repository call with the web-faithful
 * invalidation behaviour (each mutation refreshes EXACTLY the feed its `useUser.ts` hook
 * invalidates) — using a fake repository, so no network or cache is involved.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class UserStoreTest {
    /**
     * Fake S7 port: every read re-counts its collection per refresh (so a refresh is observable) and
     * emits Loading→Success with a deterministic value; every mutation records its argument / call and
     * returns a programmable result.
     */
    private class FakeUserRepository : UserRepository {
        val collections: MutableMap<String, Int> = mutableMapOf()
        val updatedNames: MutableList<String> = mutableListOf()
        var refreshFeatureConfigCalls: Int = 0
        var refreshRegionCalls: Int = 0
        var refreshOrdersCalls: Int = 0
        var refreshProfileCalls: Int = 0

        private fun <T> read(
            key: String,
            value: T,
        ): Flow<Resource<T>> =
            flow {
                collections[key] = (collections[key] ?: 0) + 1
                emit(Resource.Loading(cached = null, fetchedAt = null, stale = false))
                emit(Resource.Success(data = value, fetchedAt = 1L, stale = false))
            }

        override fun currentUser(): Flow<Resource<User>> = read(USER_ME_KEY, User(id = "1", email = "a@b.c", displayName = "Atul"))

        override fun myRecentActivity(params: MyActivityParams): Flow<Resource<List<UserActivityEntry>>> =
            read(userActivityCacheKey(params), listOf(UserActivityEntry(id = 7, action = "login")))

        override fun teslaFeatureConfig(): Flow<Resource<TeslaConfigEnvelope<JsonElement>>> =
            read(USER_TESLA_FEATURE_CONFIG_KEY, TeslaConfigEnvelope(data = JsonPrimitive("cfg"), fetchedAt = "t"))

        override fun teslaUserRegion(): Flow<Resource<TeslaConfigEnvelope<TeslaRegionData>>> =
            read(USER_TESLA_REGION_KEY, TeslaConfigEnvelope(data = TeslaRegionData(region = "na"), fetchedAt = "t"))

        override fun teslaUserOrders(): Flow<Resource<TeslaOrdersEnvelope>> =
            read(USER_TESLA_ORDERS_KEY, TeslaOrdersEnvelope(orders = listOf(TeslaOrder(id = 1, model = "3"))))

        override fun teslaUserProfile(): Flow<Resource<TeslaProfileEnvelope>> =
            read(USER_TESLA_PROFILE_KEY, TeslaProfileEnvelope(profile = TeslaUserProfile(id = 1, email = "a@b.c")))

        override suspend fun updateUser(displayName: String): Result<User> {
            updatedNames += displayName
            return Result.success(User(id = "1", email = "a@b.c", displayName = displayName))
        }

        override suspend fun refreshTeslaFeatureConfig(): Result<TeslaConfigEnvelope<JsonElement>> {
            refreshFeatureConfigCalls += 1
            return Result.success(TeslaConfigEnvelope(data = JsonPrimitive("cfg"), fetchedAt = "t2"))
        }

        override suspend fun refreshTeslaRegion(): Result<TeslaConfigEnvelope<TeslaRegionData>> {
            refreshRegionCalls += 1
            return Result.success(TeslaConfigEnvelope(data = TeslaRegionData(region = "eu"), fetchedAt = "t2"))
        }

        override suspend fun refreshTeslaOrders(): Result<TeslaOrdersEnvelope> {
            refreshOrdersCalls += 1
            return Result.success(TeslaOrdersEnvelope(orders = emptyList(), fetchedAt = "t2"))
        }

        override suspend fun refreshTeslaProfile(): Result<TeslaProfileEnvelope> {
            refreshProfileCalls += 1
            return Result.success(TeslaProfileEnvelope(profile = null, fetchedAt = "t2"))
        }
    }

    @Test
    fun everyReadEmitsCacheThenNetwork() =
        runTest {
            val store = UserStore(FakeUserRepository(), backgroundScope)
            val feeds =
                listOf<() -> Any>(
                    { store.currentUser() },
                    { store.myRecentActivity() },
                    { store.teslaFeatureConfig() },
                    { store.teslaUserRegion() },
                    { store.teslaUserOrders() },
                    { store.teslaUserProfile() },
                )
            assertEquals(6, feeds.size, "all six reads exercised")

            // Current-user feed: Loading (cold cache slot) then network Success.
            val seen = mutableListOf<Resource<User>>()
            backgroundScope.launch { store.currentUser().collect { seen += it } }
            runCurrent()
            assertTrue(seen.first() is Resource.Loading, "first emission is Loading (cache slot)")
            val last = seen.last()
            assertTrue(last is Resource.Success, "terminal emission is the network Success")
            assertEquals("Atul", last.data.displayName)
        }

    @Test
    fun activityReadDecodesNetworkSuccess() =
        runTest {
            val store = UserStore(FakeUserRepository(), backgroundScope)
            val seen = mutableListOf<Resource<List<UserActivityEntry>>>()
            backgroundScope.launch { store.myRecentActivity().collect { seen += it } }
            runCurrent()
            val last = seen.last()
            assertTrue(last is Resource.Success)
            assertEquals(1, last.data.size)
            assertEquals("login", last.data.first().action)
        }

    @Test
    fun feedsAreSharedAcrossObservers() =
        runTest {
            val store = UserStore(FakeUserRepository(), backgroundScope)
            assertSame(store.currentUser(), store.currentUser())
            assertSame(store.teslaUserOrders(), store.teslaUserOrders())
            // Distinct activity params get distinct shared feeds; identical params share one.
            assertSame(store.myRecentActivity(MyActivityParams(limit = 50)), store.myRecentActivity(MyActivityParams(limit = 50)))
            assertTrue(
                store.myRecentActivity(MyActivityParams(limit = 50)) !==
                    store.myRecentActivity(MyActivityParams(limit = 25)),
            )
        }

    @Test
    fun updateUserDelegatesAndRefreshesMeFeed() =
        runTest {
            val repo = FakeUserRepository()
            val store = UserStore(repo, backgroundScope)
            backgroundScope.launch { store.currentUser().collect {} }
            runCurrent()
            assertEquals(1, repo.collections[USER_ME_KEY])

            val result = store.updateUser("New Name")
            runCurrent()

            assertTrue(result.isSuccess)
            assertEquals(listOf("New Name"), repo.updatedNames)
            assertEquals("New Name", result.getOrThrow().displayName)
            // web useUpdateUser onSuccess writes userKeys.me → me feed re-collects.
            assertEquals(2, repo.collections[USER_ME_KEY])
        }

    @Test
    fun refreshFeatureConfigRefreshesOnlyItsFeed() =
        runTest {
            val repo = FakeUserRepository()
            val store = UserStore(repo, backgroundScope)
            backgroundScope.launch { store.teslaFeatureConfig().collect {} }
            backgroundScope.launch { store.teslaUserRegion().collect {} }
            runCurrent()
            assertEquals(1, repo.collections[USER_TESLA_FEATURE_CONFIG_KEY])
            assertEquals(1, repo.collections[USER_TESLA_REGION_KEY])

            store.refreshTeslaFeatureConfig()
            runCurrent()

            assertEquals(1, repo.refreshFeatureConfigCalls)
            // web invalidateQueries(userKeys.teslaFeatureConfig) → only feature-config re-collects.
            assertEquals(2, repo.collections[USER_TESLA_FEATURE_CONFIG_KEY])
            assertEquals(1, repo.collections[USER_TESLA_REGION_KEY])
        }

    @Test
    fun refreshRegionRefreshesRegionFeed() =
        runTest {
            val repo = FakeUserRepository()
            val store = UserStore(repo, backgroundScope)
            backgroundScope.launch { store.teslaUserRegion().collect {} }
            runCurrent()
            assertEquals(1, repo.collections[USER_TESLA_REGION_KEY])

            val result = store.refreshTeslaRegion()
            runCurrent()

            assertEquals("eu", result.getOrThrow().data.region)
            assertEquals(1, repo.refreshRegionCalls)
            assertEquals(2, repo.collections[USER_TESLA_REGION_KEY])
        }

    @Test
    fun refreshOrdersRefreshesOrdersFeed() =
        runTest {
            val repo = FakeUserRepository()
            val store = UserStore(repo, backgroundScope)
            backgroundScope.launch { store.teslaUserOrders().collect {} }
            runCurrent()
            assertEquals(1, repo.collections[USER_TESLA_ORDERS_KEY])

            store.refreshTeslaOrders()
            runCurrent()

            assertEquals(1, repo.refreshOrdersCalls)
            assertEquals(2, repo.collections[USER_TESLA_ORDERS_KEY])
        }

    @Test
    fun refreshProfileRefreshesProfileFeed() =
        runTest {
            val repo = FakeUserRepository()
            val store = UserStore(repo, backgroundScope)
            backgroundScope.launch { store.teslaUserProfile().collect {} }
            runCurrent()
            assertEquals(1, repo.collections[USER_TESLA_PROFILE_KEY])

            store.refreshTeslaProfile()
            runCurrent()

            assertEquals(1, repo.refreshProfileCalls)
            assertEquals(2, repo.collections[USER_TESLA_PROFILE_KEY])
        }

    @Test
    fun refreshIsNoOpWhenFeedUnobserved() =
        runTest {
            val repo = FakeUserRepository()
            val store = UserStore(repo, backgroundScope)

            // Nothing observed → the mutation's refresh must not start an upstream collection.
            store.updateUser("x")
            runCurrent()

            assertEquals(null, repo.collections[USER_ME_KEY])
        }
}
