package io.teslasync.android.push

import kotlinx.serialization.json.Json
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * JVM unit tests for the `/api/v1/devices` request wire shape (P3/A6, ADR-009). The body must serialize
 * to the snake_case keys the Go API expects, independent of the serializer naming policy.
 */
class DeviceRegistrationSerializationTest {
    private val json = Json { encodeDefaults = true }

    @Test
    fun requestSerializesToSnakeCaseKeys() {
        val request =
            DeviceRegistrationRequest(
                platform = PushCapabilities.ANDROID_PLATFORM,
                pushProvider = PushCapabilities.FCM_PROVIDER,
                channelUri = "token-a",
                appVersion = "0.1.0",
                locale = "en-US",
                deviceId = "device-xyz",
                capabilities = PushCapabilities.ANDROID_DEFAULT,
            )

        val encoded = json.encodeToString(DeviceRegistrationRequest.serializer(), request)

        assertTrue(encoded.contains("\"platform\":\"android\""))
        assertTrue(encoded.contains("\"push_provider\":\"fcm\""))
        assertTrue(encoded.contains("\"channel_uri\":\"token-a\""))
        assertTrue(encoded.contains("\"app_version\":\"0.1.0\""))
        assertTrue(encoded.contains("\"device_id\":\"device-xyz\""))
        assertTrue(encoded.contains("\"capabilities\":"))
    }

    @Test
    fun responseDecodesTolerantlyFromMinimalBody() {
        val response = json.decodeFromString(DeviceRegistrationResponse.serializer(), "{\"id\":\"reg-1\"}")
        assertEquals("reg-1", response.id)
        assertEquals(null, response.platform)
    }
}
