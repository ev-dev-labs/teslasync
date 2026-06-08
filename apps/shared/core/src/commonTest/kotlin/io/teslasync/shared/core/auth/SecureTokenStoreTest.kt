package io.teslasync.shared.core.auth

import io.teslasync.shared.core.net.runTestBlocking
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull

class SecureTokenStoreTest {
    @Test
    fun savingThenLoadingReturnsAnEqualTokenSet() =
        runTestBlocking {
            val store = InMemorySecureTokenStore()
            val tokens = tokenSet(access = "a", refresh = "r", expiresAt = 12_345, id = "i")

            store.save(tokens)

            assertEquals(tokens, store.load())
        }

    @Test
    fun loadReturnsNullWhenNothingIsStored() =
        runTestBlocking {
            assertNull(InMemorySecureTokenStore().load())
        }

    @Test
    fun clearRemovesAnyPersistedTokenSet() =
        runTestBlocking {
            val store = InMemorySecureTokenStore(tokenSet("a", "r", 1))

            store.clear()

            assertNull(store.load())
        }

    @Test
    fun savingOverwritesThePreviousTokenSet() =
        runTestBlocking {
            val store = InMemorySecureTokenStore(tokenSet("old", "r0", 1))

            val next = tokenSet("new", "r1", 2)
            store.save(next)

            assertEquals(next, store.load())
        }
}
