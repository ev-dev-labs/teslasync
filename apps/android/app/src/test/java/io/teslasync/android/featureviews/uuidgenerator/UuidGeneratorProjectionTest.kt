package io.teslasync.android.featureviews.uuidgenerator

import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.toUiState
import io.teslasync.shared.core.data.repo.Resource
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Off-device verification of the UUID Generator's pure logic — the native analogue of the web tool's
 * `safeRandomUUID` construction (web/src/lib/safeUUID.ts) and the `[uuid, ...prev].slice(0, 10)` list update
 * (web .../tools/UuidGenerator.tsx): the RFC 4122 §4.4 v4 byte→string formatting (version/variant nibbles,
 * 8-4-4-4-12 grouping, lowercase, no-mutate, length guard), the canonical-form predicate, the prepend-and-cap
 * rule, and the generate-outcome → Resource → UiState folding. Runs in the :android:testReleaseUnitTest gate.
 */
class UuidGeneratorProjectionTest {
    // ── formatV4 (web safeRandomUUID constructed branch: RFC 4122 §4.4) ──────────────

    @Test
    fun allZeroBytesFormatToTheVersion4Variant8Uuid() {
        val uuid = UuidGeneratorProjection.formatV4(ByteArray(UuidGeneratorProjection.UUID_BYTE_COUNT))
        assertEquals("00000000-0000-4000-8000-000000000000", uuid)
        assertTrue(UuidGeneratorProjection.isCanonicalV4(uuid))
    }

    @Test
    fun allOnesBytesMaskOnlyTheVersionAndVariantNibbles() {
        val uuid = UuidGeneratorProjection.formatV4(ByteArray(UuidGeneratorProjection.UUID_BYTE_COUNT) { 0xFF.toByte() })
        assertEquals("ffffffff-ffff-4fff-bfff-ffffffffffff", uuid)
        assertTrue(UuidGeneratorProjection.isCanonicalV4(uuid))
    }

    @Test
    fun versionNibbleIsAlwaysFourAndVariantIsRfc4122ForAnyInput() {
        for (seed in 0..0xFF) {
            val bytes = ByteArray(UuidGeneratorProjection.UUID_BYTE_COUNT) { ((it * 7 + seed) and 0xFF).toByte() }
            val uuid = UuidGeneratorProjection.formatV4(bytes)
            assertEquals('4', uuid[14])
            assertTrue("variant nibble was ${uuid[19]}", uuid[19] in "89ab")
            assertTrue(UuidGeneratorProjection.isCanonicalV4(uuid))
        }
    }

    @Test
    fun formatV4PassesThroughEveryOtherByteVerbatim() {
        // 01 02 03 04 05 06 07 08 09 0a 0b 0c 0d 0e 0f 10 — only byte 6 (→version) and byte 8 (→variant) change.
        val bytes = ByteArray(UuidGeneratorProjection.UUID_BYTE_COUNT) { (it + 1).toByte() }
        assertEquals("01020304-0506-4708-890a-0b0c0d0e0f10", UuidGeneratorProjection.formatV4(bytes))
    }

    @Test
    fun formatV4DoesNotMutateTheInput() {
        val bytes = ByteArray(UuidGeneratorProjection.UUID_BYTE_COUNT) { 0xFF.toByte() }
        UuidGeneratorProjection.formatV4(bytes)
        assertTrue(bytes.all { it == 0xFF.toByte() })
    }

    @Test
    fun formatV4RejectsAnyLengthOtherThanSixteen() {
        val tooFew = runCatching { UuidGeneratorProjection.formatV4(ByteArray(15)) }
        val tooMany = runCatching { UuidGeneratorProjection.formatV4(ByteArray(17)) }
        assertTrue(tooFew.exceptionOrNull() is IllegalArgumentException)
        assertTrue(tooMany.exceptionOrNull() is IllegalArgumentException)
    }

    @Test
    fun isCanonicalV4RejectsMalformedStrings() {
        assertFalse(UuidGeneratorProjection.isCanonicalV4("not-a-uuid"))
        assertFalse(UuidGeneratorProjection.isCanonicalV4("F47AC10B-58CC-4372-A567-0E02B2C3D479")) // uppercase
        assertFalse(UuidGeneratorProjection.isCanonicalV4("f47ac10b-58cc-1372-a567-0e02b2c3d479")) // version 1
        assertFalse(UuidGeneratorProjection.isCanonicalV4("f47ac10b58cc4372a5670e02b2c3d479")) // no hyphens
    }

    // ── prepend (web `[uuid, ...prev].slice(0, 10)`) ─────────────────────────────────

    @Test
    fun prependAddsNewestFirst() {
        val one = UuidGeneratorProjection.prepend(UuidBatch.EMPTY, "a")
        assertEquals(listOf("a"), one.ids)
        val two = UuidGeneratorProjection.prepend(one, "b")
        assertEquals(listOf("b", "a"), two.ids)
    }

    @Test
    fun prependCapsAtMaxRetainedDroppingTheOldest() {
        var batch = UuidBatch.EMPTY
        for (i in 1..15) batch = UuidGeneratorProjection.prepend(batch, "id-$i")
        assertEquals(UuidGeneratorProjection.MAX_RETAINED, batch.size)
        assertEquals("id-15", batch.ids.first()) // newest kept
        assertEquals("id-6", batch.ids.last()) // ids 1..5 dropped by the cap
        assertFalse(batch.ids.contains("id-5"))
    }

    @Test
    fun emptySentinelIsBlank() {
        assertTrue(UuidBatch.EMPTY.isBlank)
        assertEquals(0, UuidBatch.EMPTY.size)
    }

    // ── data adapter (generate outcome → Resource → UiState) ─────────────────────────

    @Test
    fun successFoldsIntoFreshContentUiState() {
        val batch = UuidGeneratorProjection.prepend(UuidBatch.EMPTY, "id")
        val ui =
            uuidResource(Result.success(batch), cached = null, cachedFetchedAt = null, nowMs = 100L)
                .toUiState { it.isBlank }
        assertEquals(UiPhase.Content, ui.phase)
        assertEquals(batch, ui.data)
        assertFalse(ui.stale)
    }

    @Test
    fun failureWithNoCacheFoldsIntoHardError() {
        val resource =
            uuidResource(
                Result.failure(IllegalStateException("rng unavailable")),
                cached = null,
                cachedFetchedAt = null,
                nowMs = 100L,
            )
        assertTrue(resource is Resource.Error)
        assertNull((resource as Resource.Error).cached)

        val ui = resource.toUiState { it.isBlank }
        assertEquals(UiPhase.Error, ui.phase)
        assertEquals(ErrorKind.Unknown, ui.errorKind)
        assertTrue(ui.canRetry)
        assertFalse(ui.hasData)
    }

    @Test
    fun failureWithCacheKeepsLastKnownListStaleWithRetry() {
        val prior = UuidGeneratorProjection.prepend(UuidBatch.EMPTY, "id")
        val resource =
            uuidResource(
                Result.failure(IllegalStateException("rng unavailable")),
                cached = prior,
                cachedFetchedAt = 50L,
                nowMs = 100L,
            )
        assertTrue(resource is Resource.Error)
        assertEquals(prior, (resource as Resource.Error).cached)
        assertEquals(50L, resource.fetchedAt)
        assertTrue(resource.stale)

        val ui = resource.toUiState { it.isBlank }
        assertEquals(UiPhase.Content, ui.phase)
        assertEquals(prior, ui.data)
        assertTrue(ui.stale)
        assertTrue(ui.isOffline)
        assertTrue(ui.canRetry)
    }
}
