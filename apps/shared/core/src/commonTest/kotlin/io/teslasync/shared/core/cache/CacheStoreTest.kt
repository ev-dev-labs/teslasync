package io.teslasync.shared.core.cache

import io.teslasync.shared.core.net.runTestBlocking
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull

class CacheStoreTest {
    @Test
    fun writeThenReadReturnsPayloadAndStamp() =
        runTestBlocking {
            val store = newTestCache().store
            store.write(CacheDomain.Vehicles, "all", "[1,2,3]", fetchedAt = 4_200L)

            val record = store.read(CacheDomain.Vehicles, "all")

            assertEquals("[1,2,3]", record?.payload)
            assertEquals(4_200L, record?.fetchedAt)
        }

    @Test
    fun upsertReplacesExistingRow() =
        runTestBlocking {
            val store = newTestCache().store
            store.write(CacheDomain.Vehicles, "all", "old", fetchedAt = 1L)
            store.write(CacheDomain.Vehicles, "all", "new", fetchedAt = 2L)

            val record = store.read(CacheDomain.Vehicles, "all")

            assertEquals("new", record?.payload)
            assertEquals(2L, record?.fetchedAt)
        }

    @Test
    fun keysAreScopedPerDomain() =
        runTestBlocking {
            val store = newTestCache().store
            store.write(CacheDomain.Vehicles, "7", "v", fetchedAt = 1L)
            store.write(CacheDomain.Drives, "7", "d", fetchedAt = 1L)

            assertEquals("v", store.read(CacheDomain.Vehicles, "7")?.payload)
            assertEquals("d", store.read(CacheDomain.Drives, "7")?.payload)
        }

    @Test
    fun deleteRemovesOnlyThatKey() =
        runTestBlocking {
            val store = newTestCache().store
            store.write(CacheDomain.Drives, "7", "a", fetchedAt = 1L)
            store.write(CacheDomain.Drives, "8", "b", fetchedAt = 1L)

            store.delete(CacheDomain.Drives, "7")

            assertNull(store.read(CacheDomain.Drives, "7"))
            assertEquals("b", store.read(CacheDomain.Drives, "8")?.payload)
        }

    @Test
    fun clearWipesOneDomainOnly() =
        runTestBlocking {
            val store = newTestCache().store
            store.write(CacheDomain.Vehicles, "all", "v", fetchedAt = 1L)
            store.write(CacheDomain.Drives, "7", "d", fetchedAt = 1L)

            store.clear(CacheDomain.Vehicles)

            assertNull(store.read(CacheDomain.Vehicles, "all"))
            assertEquals("d", store.read(CacheDomain.Drives, "7")?.payload)
        }

    @Test
    fun logoutClearsEveryDomain() =
        runTestBlocking {
            val cache = newTestCache()
            cache.store.write(CacheDomain.Vehicles, "all", "v", fetchedAt = 1L)
            cache.store.write(CacheDomain.Drives, "7", "d", fetchedAt = 1L)
            cache.store.write(CacheDomain.Notifications, "all", "n", fetchedAt = 1L)

            cache.logout()

            assertNull(cache.store.read(CacheDomain.Vehicles, "all"))
            assertNull(cache.store.read(CacheDomain.Drives, "7"))
            assertNull(cache.store.read(CacheDomain.Notifications, "all"))
        }
}
