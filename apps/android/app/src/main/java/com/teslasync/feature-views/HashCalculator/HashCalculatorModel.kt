// Domain model + pure projection backing the Compose [HashCalculator] surface — the native port of the web
// tool's compute (web/src/features/admin/components/devtools/tools/HashCalculator.tsx). The web tool feeds
// the typed text through the Web Crypto `crypto.subtle.digest('SHA-256', …)` and renders the lowercase hex
// digest; this file reproduces that computation on-device with `java.security.MessageDigest`, byte-for-byte
// identical output (UTF-8 encoding, zero-padded lowercase hex — the web `b.toString(16).padStart(2,'0')`).
// It is framework-free (no Android, no Compose, no coroutines) so the digest is fully unit-testable off the
// device, and side-effect-free so the same input always yields the same snapshot.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/feature-views/HashCalculator) cannot form a valid Kotlin package.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.feature.views.hashcalculator

import java.security.MessageDigest

/**
 * The computed digest the surface renders — the native analogue of the web `hashResult` string, tagged with
 * the [algorithm] that produced it. [hex] is the lowercase, zero-padded hex encoding of the SHA-256 bytes;
 * an empty [hex] is the "nothing computed yet" sentinel that maps to the surface's empty state (the web
 * `hashResult &&` guard that hides the result block until a digest exists).
 */
data class HashDigest(
    val algorithm: String,
    val hex: String,
) {
    /** No digest has been computed yet (web `!hashResult`) → the surface renders its empty state. */
    val isBlank: Boolean get() = hex.isEmpty()

    companion object {
        /** The "nothing computed yet" sentinel for the empty preview / test branch. */
        val EMPTY = HashDigest(HashCalculatorProjection.ALGORITHM, "")
    }
}

/**
 * Pure, side-effect-free SHA-256 projection — the native port of the web tool's `crypto.subtle.digest`
 * call. [sha256Hex] encodes the input as UTF-8 (the web `TextEncoder` default), hashes it with the platform
 * [MessageDigest], and renders the bytes as a 64-character lowercase hex string with each byte zero-padded
 * to two digits — exactly the web `hashArray.map(b => b.toString(16).padStart(2,'0')).join('')`. Routed
 * through this one object so the digest has a single, test-pinned definition the view-model and engine reuse.
 */
object HashCalculatorProjection {
    /** The only algorithm the web tool offers (`crypto.subtle.digest('SHA-256', …)`). */
    const val ALGORITHM = "SHA-256"

    private const val HEX_DIGITS = "0123456789abcdef"
    private const val BYTE_MASK = 0xFF
    private const val NIBBLE_BITS = 4
    private const val LOW_NIBBLE = 0x0F

    /** The lowercase hex SHA-256 of [input] (UTF-8), byte-for-byte identical to the web digest. */
    fun sha256Hex(input: String): String {
        val bytes = MessageDigest.getInstance(ALGORITHM).digest(input.toByteArray(Charsets.UTF_8))
        return buildString(bytes.size * 2) {
            for (byte in bytes) {
                val value = byte.toInt() and BYTE_MASK
                append(HEX_DIGITS[value ushr NIBBLE_BITS])
                append(HEX_DIGITS[value and LOW_NIBBLE])
            }
        }
    }

    /** Projects [input] onto a [HashDigest] (web: the `hashResult` after `compute()` resolves). */
    fun digest(input: String): HashDigest = HashDigest(ALGORITHM, sha256Hex(input))
}
