package io.teslasync.shared.core.platform

import kotlin.test.Test
import kotlin.test.assertTrue

class PlatformTest {
    @Test
    fun platformNameIsNotBlank() {
        assertTrue(Platform.name.isNotEmpty(), "platform name must be provided by the actual")
    }

    @Test
    fun platformLogDoesNotThrow() {
        platformLog("scaffold wiring proof")
    }
}
