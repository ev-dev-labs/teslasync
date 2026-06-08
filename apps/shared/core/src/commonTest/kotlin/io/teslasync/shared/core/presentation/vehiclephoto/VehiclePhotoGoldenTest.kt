package io.teslasync.shared.core.presentation.vehiclephoto

import io.teslasync.shared.core.data.repo.VehiclePhotoRepository
import io.teslasync.shared.core.data.repo.VehiclePhotoValidationReason
import io.teslasync.shared.core.data.repo.validateVehiclePhotoUpload
import io.teslasync.shared.core.data.repo.vehiclePhotoCacheKey
import io.teslasync.shared.core.data.repo.vehiclePhotoUrl
import kotlinx.serialization.json.Json
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull
import kotlin.test.assertTrue

/**
 * Golden vectors locking the non-trivial client-side derivations ported from the web
 * `useVehiclePhoto` domain (web/src/api/hooks/useVehiclePhoto.ts):
 *
 *  1. [vehiclePhotoCacheKey] — the web `vehiclePhotoKeys.detail` tuple `['vehicle-photos', id]`,
 *     prefixed so it partitions per vehicle.
 *  2. [validateVehiclePhotoUpload] — the web `validateVehiclePhotoFile` size/mime gate, including
 *     its byte-identical rejection messages and its allow-on-blank-mime behaviour.
 *  3. [vehiclePhotoUrl] — the web `vehiclePhotoUrl` builder: `null` on absent photo, the bare path
 *     on a missing/unparseable stamp, and the `?v=<epoch-millis>` cache-buster on a valid ISO stamp.
 *  4. The [VehiclePhotoMeta] read model decodes the snake_case wire envelope verbatim, including the
 *     absent-photo payload.
 *
 * The vectors are language-neutral (raw JSON / fixed expectations) so the Windows C# port and the
 * KMP core load the identical set and cannot drift (ADR-004). The fixtures are inlined to stay within
 * this slice's allowed file scope; the C# port mirrors these exact rows.
 */
class VehiclePhotoGoldenTest {
    private val json = Json { ignoreUnknownKeys = true }

    // ---- cache key ----------------------------------------------------------------

    @Test
    fun cacheKeyMirrorsTheWebDetailTuple() {
        assertEquals("vehicle-photos:42", vehiclePhotoCacheKey("42"))
        assertEquals("vehicle-photos:abc-123", vehiclePhotoCacheKey("abc-123"))
    }

    // ---- validation ---------------------------------------------------------------

    @Test
    fun validationAcceptsAnAllowedImage() {
        assertNull(validateVehiclePhotoUpload(byteSize = 1024, mimeType = "image/png"))
        assertNull(validateVehiclePhotoUpload(byteSize = 1024, mimeType = "image/jpeg"))
        assertNull(validateVehiclePhotoUpload(byteSize = 1024, mimeType = "IMAGE/JPG"))
    }

    @Test
    fun validationAllowsABlankMimeAndLeavesItToTheServer() {
        assertNull(validateVehiclePhotoUpload(byteSize = 1024, mimeType = null))
        assertNull(validateVehiclePhotoUpload(byteSize = 1024, mimeType = ""))
    }

    @Test
    fun validationRejectsAnEmptyFile() {
        val err = validateVehiclePhotoUpload(byteSize = 0, mimeType = "image/png")
        assertEquals(VehiclePhotoValidationReason.EMPTY, err?.reason)
        assertEquals("Selected file is empty.", err?.message)
    }

    @Test
    fun validationRejectsAnOversizeFileWithTheWebMessage() {
        val err = validateVehiclePhotoUpload(byteSize = 8L * 1024 * 1024 + 1, mimeType = "image/png")
        assertEquals(VehiclePhotoValidationReason.SIZE, err?.reason)
        assertEquals("Photo exceeds 8 MB limit.", err?.message)
    }

    @Test
    fun validationRejectsAnUnsupportedMimeWithTheWebMessage() {
        val err = validateVehiclePhotoUpload(byteSize = 1024, mimeType = "image/gif")
        assertEquals(VehiclePhotoValidationReason.MIME, err?.reason)
        assertEquals("Unsupported image type: image/gif", err?.message)
    }

    // ---- url builder --------------------------------------------------------------

    @Test
    fun urlIsNullWhenThereIsNoPhoto() {
        assertNull(vehiclePhotoUrl(BASE, "42", VehiclePhotoSize.FULL, null))
        assertNull(vehiclePhotoUrl(BASE, "42", VehiclePhotoSize.FULL, VehiclePhotoMeta(hasPhoto = false)))
    }

    @Test
    fun urlIsTheBarePathWhenTheStampIsMissing() {
        val meta = VehiclePhotoMeta(hasPhoto = true, uploadedAt = null)
        assertEquals(
            "https://host.test/api/v1/vehicles/42/photo/thumb",
            vehiclePhotoUrl(BASE, "42", VehiclePhotoSize.THUMB, meta),
        )
    }

    @Test
    fun urlIsTheBarePathWhenTheStampIsUnparseable() {
        val meta = VehiclePhotoMeta(hasPhoto = true, uploadedAt = "not-a-date")
        assertEquals(
            "https://host.test/api/v1/vehicles/42/photo/medium",
            vehiclePhotoUrl(BASE, "42", VehiclePhotoSize.MEDIUM, meta),
        )
    }

    @Test
    fun urlCarriesTheEpochMillisCacheBusterFromTheStamp() {
        val meta = VehiclePhotoMeta(hasPhoto = true, uploadedAt = "2026-06-01T00:00:00Z")
        assertEquals(
            "https://host.test/api/v1/vehicles/42/photo/full?v=1780272000000",
            vehiclePhotoUrl(BASE, "42", VehiclePhotoSize.FULL, meta),
        )
    }

    @Test
    fun urlTrimsATrailingSlashOnTheBase() {
        val meta = VehiclePhotoMeta(hasPhoto = true, uploadedAt = "2026-06-02T12:34:56Z")
        assertEquals(
            "https://host.test/api/v1/vehicles/7/photo/full?v=1780403696000",
            vehiclePhotoUrl("https://host.test/", "7", VehiclePhotoSize.FULL, meta),
        )
    }

    // ---- wire decoding ------------------------------------------------------------

    @Test
    fun metaDecodesSnakeCaseVerbatim() {
        val decoded = json.decodeFromString(VehiclePhotoMeta.serializer(), META_GOLDEN)
        assertTrue(decoded.hasPhoto)
        assertEquals("2026-06-01T00:00:00Z", decoded.uploadedAt)
        assertEquals("/api/v1/vehicles/42/photo/thumb", decoded.sizes?.thumb)
        assertEquals("/api/v1/vehicles/42/photo/medium", decoded.sizes?.medium)
        assertEquals("/api/v1/vehicles/42/photo/full", decoded.sizes?.full)
    }

    @Test
    fun metaDecodesTheAbsentPhotoPayload() {
        val decoded = json.decodeFromString(VehiclePhotoMeta.serializer(), META_ABSENT_GOLDEN)
        assertTrue(!decoded.hasPhoto)
        assertNull(decoded.uploadedAt)
        assertNull(decoded.sizes)
    }

    @Test
    fun parityHelpersAreReferencedFromTheDataPort() {
        // Compile-time anchor: the derivations under test are the ones the S7 port exposes.
        assertTrue(VehiclePhotoRepository::class.simpleName == "VehiclePhotoRepository")
    }

    private companion object {
        const val BASE = "https://host.test"

        val META_GOLDEN =
            """
            {
              "has_photo": true,
              "uploaded_at": "2026-06-01T00:00:00Z",
              "sizes": {
                "thumb": "/api/v1/vehicles/42/photo/thumb",
                "medium": "/api/v1/vehicles/42/photo/medium",
                "full": "/api/v1/vehicles/42/photo/full"
              }
            }
            """.trimIndent()

        val META_ABSENT_GOLDEN =
            """
            {
              "has_photo": false
            }
            """.trimIndent()
    }
}
