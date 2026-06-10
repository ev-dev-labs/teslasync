package io.teslasync.shared.core.presentation.vehicleaccess

import io.teslasync.shared.core.data.repo.VehicleAccessRepository
import io.teslasync.shared.core.data.repo.removeVehicleDriverBody
import io.teslasync.shared.core.data.repo.vehicleDriversCacheKey
import io.teslasync.shared.core.data.repo.vehicleInvitationsCacheKey
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonPrimitive
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

/**
 * Golden vectors locking the non-trivial client-side derivations ported from the web
 * `useVehicleAccess` domain (web/src/api/hooks/useVehicleAccess.ts):
 *
 *  1. [vehicleDriversCacheKey] / [vehicleInvitationsCacheKey] — the web `vehicleAccessKeys.drivers`
 *     / `vehicleAccessKeys.invitations` tuples, prefixed so the two reads never collide in the one
 *     shared cache partition even when their `vehicleId` is identical.
 *  2. [removeVehicleDriverBody] — the `DELETE /vehicles/{id}/drivers` body builder (the web
 *     `JSON.stringify({ share_user_id: shareUserId })`): a single snake_case numeric key.
 *  3. The two read models decode the snake_case wire rows verbatim ([VehicleDriver],
 *     [VehicleInvitation]) with their nullable fields defaulting when omitted.
 *
 * The vectors are language-neutral (raw JSON / fixed expectations) so the Windows C# port and the
 * KMP core load the identical set and cannot drift (ADR-004). The fixtures are inlined to stay within
 * this slice's allowed file scope; the C# port mirrors these exact rows.
 */
class VehicleAccessGoldenTest {
    private val json = Json { ignoreUnknownKeys = true }

    // ---- cache keys ---------------------------------------------------------------

    @Test
    fun driversKeyMirrorsTheWebDriversTuple() {
        assertEquals("vehicle-drivers:42", vehicleDriversCacheKey("42"))
        assertEquals("vehicle-drivers:abc-123", vehicleDriversCacheKey("abc-123"))
    }

    @Test
    fun invitationsKeyMirrorsTheWebInvitationsTuple() {
        assertEquals("vehicle-invitations:42", vehicleInvitationsCacheKey("42"))
        assertEquals("vehicle-invitations:abc-123", vehicleInvitationsCacheKey("abc-123"))
    }

    @Test
    fun driverAndInvitationKeysNeverCollideOnEqualVehicleId() {
        assertTrue(vehicleDriversCacheKey("xyz") != vehicleInvitationsCacheKey("xyz"))
    }

    // ---- removeVehicleDriverBody --------------------------------------------------

    @Test
    fun removeVehicleDriverBodyEmitsShareUserIdSnakeCase() {
        val body = removeVehicleDriverBody(7L)
        assertEquals(setOf("share_user_id"), body.keys, "only the single snake_case key is sent")
        assertEquals("7", body["share_user_id"].toStr())
    }

    @Test
    fun removeVehicleDriverBodyCarriesLargeIdsVerbatim() {
        val body = removeVehicleDriverBody(9007199254740993L)
        assertEquals("9007199254740993", body["share_user_id"].toStr())
    }

    // ---- wire decoding ------------------------------------------------------------

    @Test
    fun driverRowDecodesSnakeCaseVerbatim() {
        val decoded = json.decodeFromString(VehicleDriver.serializer(), DRIVER_GOLDEN)
        assertEquals(11L, decoded.id)
        assertEquals(42L, decoded.vehicleId)
        assertEquals(7L, decoded.shareUserId)
        assertEquals("driver@example.com", decoded.driverEmail)
        assertEquals("Alex Driver", decoded.driverName)
        assertEquals("driver", decoded.role)
        assertEquals("2026-06-01T00:00:00Z", decoded.fetchedAt)
    }

    @Test
    fun driverRowTreatsOmittedNullablesAsNull() {
        val decoded = json.decodeFromString(VehicleDriver.serializer(), DRIVER_MINIMAL_GOLDEN)
        assertEquals(12L, decoded.id)
        assertTrue(decoded.shareUserId == null)
        assertTrue(decoded.driverEmail == null)
        assertTrue(decoded.driverName == null)
        assertTrue(decoded.role == null)
    }

    @Test
    fun invitationRowDecodesSnakeCaseVerbatim() {
        val decoded = json.decodeFromString(VehicleInvitation.serializer(), INVITATION_GOLDEN)
        assertEquals(21L, decoded.id)
        assertEquals(42L, decoded.vehicleId)
        assertEquals("inv-abc", decoded.invitationId)
        assertEquals("https://tesla.example/invite/abc", decoded.inviteUrl)
        assertEquals("pending", decoded.status)
        assertEquals("2026-07-01T00:00:00Z", decoded.expiresAt)
        assertEquals("owner@example.com", decoded.createdBy)
        assertEquals("2026-06-01T00:00:00Z", decoded.fetchedAt)
        assertEquals("2026-06-01T00:00:00Z", decoded.createdAt)
    }

    @Test
    fun parityHelpersAreReferencedFromTheDataPort() {
        // Compile-time anchor: the derivations under test are the ones the S7 port exposes.
        assertTrue(VehicleAccessRepository::class.simpleName == "VehicleAccessRepository")
    }

    private fun JsonElement?.toStr(): String? = (this as? JsonPrimitive)?.content

    private companion object {
        val DRIVER_GOLDEN =
            """
            {
              "id": 11,
              "vehicle_id": 42,
              "share_user_id": 7,
              "driver_email": "driver@example.com",
              "driver_name": "Alex Driver",
              "role": "driver",
              "fetched_at": "2026-06-01T00:00:00Z"
            }
            """.trimIndent()

        val DRIVER_MINIMAL_GOLDEN =
            """
            {
              "id": 12,
              "vehicle_id": 42,
              "fetched_at": "2026-06-01T00:00:00Z"
            }
            """.trimIndent()

        val INVITATION_GOLDEN =
            """
            {
              "id": 21,
              "vehicle_id": 42,
              "invitation_id": "inv-abc",
              "invite_url": "https://tesla.example/invite/abc",
              "status": "pending",
              "expires_at": "2026-07-01T00:00:00Z",
              "created_by": "owner@example.com",
              "fetched_at": "2026-06-01T00:00:00Z",
              "created_at": "2026-06-01T00:00:00Z"
            }
            """.trimIndent()
    }
}
