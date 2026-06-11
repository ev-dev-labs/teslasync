package io.teslasync.android.feature.views.hashcalculator

import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.toUiState
import io.teslasync.shared.core.data.repo.Resource
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.math.BigInteger
import java.security.MessageDigest

/**
 * Pure (off-device) tests for the SHA-256 projection ([HashCalculatorProjection] — the web
 * `crypto.subtle.digest` port) and the cache-then-network data adapter ([hashResource] + [toUiState] —
 * compute outcome → snapshot/envelope projection). Covers the canonical NIST vectors, UTF-8 correctness, the
 * lowercase-hex contract, determinism, and the success / hard-error / offline-last-known folding.
 */
class HashCalculatorProjectionTest {
    // ── projection (web `crypto.subtle.digest('SHA-256', …)`) ────────────────────────

    @Test
    fun sha256OfEmptyStringMatchesTheCanonicalVector() {
        assertEquals(
            "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
            HashCalculatorProjection.sha256Hex(""),
        )
    }

    @Test
    fun sha256OfAbcMatchesTheCanonicalVector() {
        assertEquals(
            "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
            HashCalculatorProjection.sha256Hex("abc"),
        )
    }

    @Test
    fun sha256OfASentenceMatchesTheCanonicalVector() {
        assertEquals(
            "d7a8fbb307d7809469ca9abcb0082e4f8d5651e46d3cdb762d02d0bf37c9e592",
            HashCalculatorProjection.sha256Hex("The quick brown fox jumps over the lazy dog"),
        )
    }

    @Test
    fun multiByteInputIsEncodedAsUtf8BeforeHashing() {
        // A multi-byte character must hash over its UTF-8 bytes (the web `TextEncoder` default), not the
        // platform charset. Verified against an independent UTF-8 reference digest.
        val input = "\u00e9\u6f22\u5b57" // é漢字
        val digestBytes = MessageDigest.getInstance("SHA-256").digest(input.toByteArray(Charsets.UTF_8))
        val expected = BigInteger(1, digestBytes).toString(16).padStart(64, '0')
        assertEquals(expected, HashCalculatorProjection.sha256Hex(input))
    }

    @Test
    fun digestIsAlwaysLowercaseHexOf64Characters() {
        val hex = HashCalculatorProjection.sha256Hex("TeslaSync")
        assertEquals(64, hex.length)
        assertTrue(hex.all { it in "0123456789abcdef" })
    }

    @Test
    fun projectionIsDeterministicAndInputSensitive() {
        assertEquals(HashCalculatorProjection.sha256Hex("abc"), HashCalculatorProjection.sha256Hex("abc"))
        assertFalse(HashCalculatorProjection.sha256Hex("abc") == HashCalculatorProjection.sha256Hex("abcd"))
    }

    @Test
    fun digestWrapsTheAlgorithmAndHex() {
        val digest = HashCalculatorProjection.digest("abc")
        assertEquals("SHA-256", digest.algorithm)
        assertEquals(HashCalculatorProjection.sha256Hex("abc"), digest.hex)
        assertFalse(digest.isBlank)
    }

    @Test
    fun emptySentinelIsBlank() {
        assertTrue(HashDigest.EMPTY.isBlank)
        assertEquals("SHA-256", HashDigest.EMPTY.algorithm)
    }

    // ── data adapter (compute outcome → Resource → UiState) ───────────────────────────

    @Test
    fun successFoldsIntoFreshSuccessResource() {
        val digest = HashCalculatorProjection.digest("abc")
        val resource = hashResource(Result.success(digest), cached = null, cachedFetchedAt = null, nowMs = 100L)
        assertTrue(resource is Resource.Success)
        assertEquals(digest, (resource as Resource.Success).data)
        assertEquals(100L, resource.fetchedAt)
        assertFalse(resource.stale)
    }

    @Test
    fun successMapsToContentUiState() {
        val digest = HashCalculatorProjection.digest("abc")
        val ui = hashResource(Result.success(digest), cached = null, cachedFetchedAt = null, nowMs = 100L).toUiState { it.isBlank }
        assertEquals(UiPhase.Content, ui.phase)
        assertEquals(digest, ui.data)
        assertFalse(ui.stale)
    }

    @Test
    fun failureWithNoCacheFoldsIntoHardError() {
        val resource =
            hashResource(Result.failure(IllegalStateException("digest unavailable")), cached = null, cachedFetchedAt = null, nowMs = 100L)
        assertTrue(resource is Resource.Error)
        assertNull((resource as Resource.Error).cached)
        assertFalse(resource.stale)

        val ui = resource.toUiState { it.isBlank }
        assertEquals(UiPhase.Error, ui.phase)
        assertEquals(ErrorKind.Unknown, ui.errorKind)
        assertTrue(ui.canRetry)
        assertFalse(ui.hasData)
    }

    @Test
    fun failureWithCacheKeepsLastKnownDigestStaleWithRetry() {
        val prior = HashCalculatorProjection.digest("abc")
        val resource =
            hashResource(Result.failure(IllegalStateException("digest unavailable")), cached = prior, cachedFetchedAt = 50L, nowMs = 100L)
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
        assertEquals(ErrorKind.Unknown, ui.errorKind)
    }
}
