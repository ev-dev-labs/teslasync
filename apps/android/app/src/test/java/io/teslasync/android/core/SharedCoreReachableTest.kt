package io.teslasync.android.core

import io.teslasync.shared.core.platform.Platform
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Proves the app consumes the shared KMP `:core` module end to end: the android `actual`
 * of the `Platform` seam is reachable from the app's classpath and reports its identity.
 */
class SharedCoreReachableTest {
    @Test
    fun sharedCorePlatformNameIsReachableAndNonBlank() {
        val name = Platform.name
        assertTrue("shared :core Platform.name must be non-blank", name.isNotBlank())
        assertTrue(
            "android actual must identify the platform, was: $name",
            name.startsWith("Android"),
        )
    }
}
