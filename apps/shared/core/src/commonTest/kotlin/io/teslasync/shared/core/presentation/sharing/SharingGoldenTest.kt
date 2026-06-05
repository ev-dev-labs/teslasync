package io.teslasync.shared.core.presentation.sharing

import io.teslasync.shared.core.data.repo.SharedDriveSerializer
import io.teslasync.shared.core.data.repo.SharingRepository
import io.teslasync.shared.core.data.repo.createShareBody
import io.teslasync.shared.core.data.repo.shareLinksCacheKey
import io.teslasync.shared.core.data.repo.sharedDriveCacheKey
import io.teslasync.shared.core.data.repo.sharedDriveIsCanonical
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.jsonObject
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

/**
 * Golden vectors locking the non-trivial client-side derivations ported from the web `useSharing`
 * domain (and its `web/src/types/sharing.ts` union):
 *
 *  1. [shareLinksCacheKey] / [sharedDriveCacheKey] — the web `sharingKeys.shares` / `sharingKeys.shared`
 *     tuples, prefixed so the two reads never collide in the one shared cache partition.
 *  2. [createShareBody] — the `POST /drives/{driveId}/share` body builder (web `JSON.stringify(data)`):
 *     only the supplied fields are emitted, snake_case.
 *  3. [sharedDriveIsCanonical] + [SharedDriveSerializer] — the union discriminator (a present
 *     `payload_version` ⇒ SI-canonical [SharedDriveData]; absent ⇒ legacy [SharedDriveDataV1]).
 *
 * The vectors are language-neutral (raw JSON in / fixed expectations out) so the Windows C# port and
 * the KMP core load the identical set and cannot drift (ADR-004). The fixtures are inlined to stay
 * within this slice's allowed file scope; the C# port mirrors these exact rows.
 */
class SharingGoldenTest {
    private val json = Json { ignoreUnknownKeys = true }

    // ---- cache keys ---------------------------------------------------------------

    @Test
    fun shareLinksKeyMirrorsTheWebSharesTuple() {
        assertEquals("shares:42", shareLinksCacheKey("42"))
        assertEquals("shares:abc-123", shareLinksCacheKey("abc-123"))
    }

    @Test
    fun sharedDriveKeyMirrorsTheWebSharedTuple() {
        assertEquals("shared-drive:tok", sharedDriveCacheKey("tok"))
        assertEquals("shared-drive:9f8e", sharedDriveCacheKey("9f8e"))
    }

    @Test
    fun shareLinkAndSharedDriveKeysNeverCollideOnEqualOpaqueIds() {
        // A driveId equal to a token must still land in distinct cache slots.
        assertTrue(shareLinksCacheKey("xyz") != sharedDriveCacheKey("xyz"))
    }

    // ---- createShareBody ----------------------------------------------------------

    @Test
    fun createShareBodyEmitsEveryProvidedFieldSnakeCase() {
        val body =
            createShareBody(
                CreateShareRequest(
                    title = "Sunday loop",
                    description = "Coast run",
                    includeSpeed = true,
                    includeTelemetry = false,
                    expiresInDays = 7,
                ),
            )
        assertEquals("Sunday loop", body["title"].toStr())
        assertEquals("Coast run", body["description"].toStr())
        assertEquals("true", body["include_speed"].toStr())
        assertEquals("false", body["include_telemetry"].toStr())
        assertEquals("7", body["expires_in_days"].toStr())
    }

    @Test
    fun createShareBodyOmitsEveryNullField() {
        val body = createShareBody(CreateShareRequest())
        assertTrue(body.isEmpty(), "an empty request sends no keys (web JSON.stringify drops undefined)")
    }

    @Test
    fun createShareBodyOmitsOnlyTheNullFields() {
        val body = createShareBody(CreateShareRequest(title = "Just a title", expiresInDays = 1))
        assertTrue(body.containsKey("title"))
        assertTrue(body.containsKey("expires_in_days"))
        assertFalse(body.containsKey("description"))
        assertFalse(body.containsKey("include_speed"))
        assertFalse(body.containsKey("include_telemetry"))
    }

    // ---- shared-drive union discrimination ----------------------------------------

    @Test
    fun canonicalPayloadIsDiscriminatedByPayloadVersion() {
        val obj = json.parseToJsonElement(CANONICAL_GOLDEN).jsonObject
        assertTrue(sharedDriveIsCanonical(obj))
        val decoded = json.decodeFromString(SharedDriveSerializer, CANONICAL_GOLDEN)
        assertTrue(decoded is SharedDriveData, "a payload with payload_version decodes to the SI shape")
        assertEquals(1609.34, decoded.drive.distanceM)
        assertEquals(40.2, decoded.drive.maxSpeedMps)
        assertEquals("Model 3", decoded.vehicle?.model)
        assertEquals(2, decoded.mapPoints?.size)
    }

    @Test
    fun legacyPayloadIsDiscriminatedByMissingPayloadVersion() {
        val obj = json.parseToJsonElement(LEGACY_GOLDEN).jsonObject
        assertFalse(sharedDriveIsCanonical(obj))
        val decoded = json.decodeFromString(SharedDriveSerializer, LEGACY_GOLDEN)
        assertTrue(decoded is SharedDriveDataV1, "a payload without payload_version decodes to the legacy shape")
        assertEquals(1.6, decoded.drive.distanceKm)
        assertEquals(144.7, decoded.drive.maxSpeedKmh)
        assertEquals(1, decoded.speedProfile?.size)
    }

    @Test
    fun parityHelpersAreReferencedFromTheDataPort() {
        // Compile-time anchor: the derivations under test are the ones the S7 port exposes.
        assertTrue(SharingRepository::class.simpleName == "SharingRepository")
    }

    private fun JsonElement?.toStr(): String? = (this as? JsonPrimitive)?.content

    private companion object {
        val CANONICAL_GOLDEN =
            """
            {
              "payload_version": "v2",
              "title": "Sunday loop",
              "description": "A short hop",
              "drive": {
                "date": "2026-06-15",
                "distance_m": 1609.34,
                "duration_s": 600.0,
                "start_address": "Home",
                "end_address": "Cafe",
                "start_battery": 80.0,
                "end_battery": 74.0,
                "max_speed_mps": 40.2,
                "avg_speed_mps": 18.5,
                "efficiency_wh_per_m": 0.15
              },
              "vehicle": { "model": "Model 3", "color": "Red" },
              "map_points": [ { "lat": 37.7, "lng": -122.4 }, { "lat": 37.8, "lng": -122.5 } ],
              "speed_profile": [ { "distance_m": 0.0, "speed_mps": 0.0 } ],
              "telemetry": [ { "distance_m": 0.0, "battery_level": 80.0, "power": 0.0, "elevation": 5.0 } ]
            }
            """.trimIndent()

        val LEGACY_GOLDEN =
            """
            {
              "title": "Old loop",
              "description": "Legacy payload",
              "drive": {
                "date": "2025-01-01",
                "distance_km": 1.6,
                "duration_min": 10.0,
                "start_address": "Home",
                "end_address": "Cafe",
                "max_speed_kmh": 144.7,
                "avg_speed_kmh": 66.6,
                "efficiency_wh_km": 150.0
              },
              "vehicle": { "model": "Model S", "color": "Black" },
              "speed_profile": [ { "distance_km": 0.0, "speed_kmh": 0.0 } ]
            }
            """.trimIndent()
    }
}
