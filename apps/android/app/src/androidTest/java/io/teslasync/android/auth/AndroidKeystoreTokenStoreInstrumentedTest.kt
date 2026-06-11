package io.teslasync.android.auth

import android.content.Context
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import io.teslasync.shared.core.auth.AndroidKeystoreTokenStore
import io.teslasync.shared.core.auth.TokenSet
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test
import org.junit.runner.RunWith

/**
 * Instrumented round-trip for the Keystore-backed secure token store (ADR-008): a [TokenSet] saved
 * through [AndroidKeystoreTokenStore] is encrypted with an `AndroidKeyStore` AES/GCM key and read
 * back intact, and [AndroidKeystoreTokenStore.clear] removes it. Keystore crypto requires a device /
 * emulator, so this runs as an instrumented test (it cannot execute in the JVM unit gate). A unique
 * prefs name keeps each run isolated.
 */
@RunWith(AndroidJUnit4::class)
class AndroidKeystoreTokenStoreInstrumentedTest {
    @Test
    fun savedTokenSetRoundTripsThenClears() =
        runBlocking {
            val context = ApplicationProvider.getApplicationContext<Context>()
            val store = AndroidKeystoreTokenStore(context, prefsName = "io.teslasync.auth.test.${System.nanoTime()}")
            assertNull(store.load())

            val tokens = TokenSet("access-itest", "refresh-itest", "id-itest", 9_999_999_999L)
            store.save(tokens)
            assertEquals(tokens, store.load())

            store.clear()
            assertNull(store.load())
        }
}
