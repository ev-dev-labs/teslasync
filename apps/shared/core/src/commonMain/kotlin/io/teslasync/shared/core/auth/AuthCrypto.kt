package io.teslasync.shared.core.auth

/**
 * Self-contained crypto primitives for OIDC PKCE. Implemented in pure common Kotlin
 * (plus one [secureRandomBytes] platform seam) so the auth core has zero extra
 * dependencies and is fully exercised by `commonTest` known-answer vectors.
 *
 * Only what PKCE needs lives here: SHA-256, URL-safe Base64 without padding, and a
 * cryptographically secure byte source.
 */

private const val BASE64_URL_ALPHABET: String =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_"

/**
 * Encodes [data] as URL-safe Base64 (RFC 4648 §5) with the padding `=` omitted —
 * the exact form RFC 7636 requires for the PKCE `code_verifier`/`code_challenge`.
 */
internal fun base64UrlNoPad(data: ByteArray): String {
    val out = StringBuilder((data.size + 2) / 3 * 4)
    var i = 0
    while (i + 3 <= data.size) {
        val chunk =
            ((data[i].toInt() and 0xff) shl 16) or
                ((data[i + 1].toInt() and 0xff) shl 8) or
                (data[i + 2].toInt() and 0xff)
        out.append(BASE64_URL_ALPHABET[(chunk ushr 18) and 0x3f])
        out.append(BASE64_URL_ALPHABET[(chunk ushr 12) and 0x3f])
        out.append(BASE64_URL_ALPHABET[(chunk ushr 6) and 0x3f])
        out.append(BASE64_URL_ALPHABET[chunk and 0x3f])
        i += 3
    }
    when (data.size - i) {
        1 -> {
            val chunk = (data[i].toInt() and 0xff) shl 16
            out.append(BASE64_URL_ALPHABET[(chunk ushr 18) and 0x3f])
            out.append(BASE64_URL_ALPHABET[(chunk ushr 12) and 0x3f])
        }
        2 -> {
            val chunk =
                ((data[i].toInt() and 0xff) shl 16) or
                    ((data[i + 1].toInt() and 0xff) shl 8)
            out.append(BASE64_URL_ALPHABET[(chunk ushr 18) and 0x3f])
            out.append(BASE64_URL_ALPHABET[(chunk ushr 12) and 0x3f])
            out.append(BASE64_URL_ALPHABET[(chunk ushr 6) and 0x3f])
        }
    }
    return out.toString()
}

// FIPS 180-4 round constants (first 32 bits of the fractional parts of the cube
// roots of the first 64 primes). Written as unsigned literals for clarity.
private val SHA256_K: IntArray =
    intArrayOf(
        0x428a2f98u.toInt(),
        0x71374491u.toInt(),
        0xb5c0fbcfu.toInt(),
        0xe9b5dba5u.toInt(),
        0x3956c25bu.toInt(),
        0x59f111f1u.toInt(),
        0x923f82a4u.toInt(),
        0xab1c5ed5u.toInt(),
        0xd807aa98u.toInt(),
        0x12835b01u.toInt(),
        0x243185beu.toInt(),
        0x550c7dc3u.toInt(),
        0x72be5d74u.toInt(),
        0x80deb1feu.toInt(),
        0x9bdc06a7u.toInt(),
        0xc19bf174u.toInt(),
        0xe49b69c1u.toInt(),
        0xefbe4786u.toInt(),
        0x0fc19dc6u.toInt(),
        0x240ca1ccu.toInt(),
        0x2de92c6fu.toInt(),
        0x4a7484aau.toInt(),
        0x5cb0a9dcu.toInt(),
        0x76f988dau.toInt(),
        0x983e5152u.toInt(),
        0xa831c66du.toInt(),
        0xb00327c8u.toInt(),
        0xbf597fc7u.toInt(),
        0xc6e00bf3u.toInt(),
        0xd5a79147u.toInt(),
        0x06ca6351u.toInt(),
        0x14292967u.toInt(),
        0x27b70a85u.toInt(),
        0x2e1b2138u.toInt(),
        0x4d2c6dfcu.toInt(),
        0x53380d13u.toInt(),
        0x650a7354u.toInt(),
        0x766a0abbu.toInt(),
        0x81c2c92eu.toInt(),
        0x92722c85u.toInt(),
        0xa2bfe8a1u.toInt(),
        0xa81a664bu.toInt(),
        0xc24b8b70u.toInt(),
        0xc76c51a3u.toInt(),
        0xd192e819u.toInt(),
        0xd6990624u.toInt(),
        0xf40e3585u.toInt(),
        0x106aa070u.toInt(),
        0x19a4c116u.toInt(),
        0x1e376c08u.toInt(),
        0x2748774cu.toInt(),
        0x34b0bcb5u.toInt(),
        0x391c0cb3u.toInt(),
        0x4ed8aa4au.toInt(),
        0x5b9cca4fu.toInt(),
        0x682e6ff3u.toInt(),
        0x748f82eeu.toInt(),
        0x78a5636fu.toInt(),
        0x84c87814u.toInt(),
        0x8cc70208u.toInt(),
        0x90befffau.toInt(),
        0xa4506cebu.toInt(),
        0xbef9a3f7u.toInt(),
        0xc67178f2u.toInt(),
    )

private fun rotr(
    value: Int,
    bits: Int,
): Int = (value ushr bits) or (value shl (32 - bits))

/**
 * Computes the SHA-256 digest of [message]. A from-scratch FIPS 180-4 implementation
 * (no platform java.security / CommonCrypto dependency) so the same code path runs on
 * every target and is verified against NIST + RFC 7636 known-answer vectors in tests.
 */
internal fun sha256(message: ByteArray): ByteArray {
    val h =
        intArrayOf(
            0x6a09e667u.toInt(),
            0xbb67ae85u.toInt(),
            0x3c6ef372u.toInt(),
            0xa54ff53au.toInt(),
            0x510e527fu.toInt(),
            0x9b05688cu.toInt(),
            0x1f83d9abu.toInt(),
            0x5be0cd19u.toInt(),
        )

    // Pad: append 0x80, then zeros, then the 64-bit big-endian bit length, to a
    // multiple of 64 bytes (the +8 reserves room for the length word).
    val bitLength = message.size.toLong() * 8
    val padded = ByteArray(((message.size + 8) / 64 + 1) * 64)
    message.copyInto(padded)
    padded[message.size] = 0x80.toByte()
    for (b in 0 until 8) {
        padded[padded.size - 1 - b] = (bitLength ushr (8 * b)).toByte()
    }

    val w = IntArray(64)
    var blockStart = 0
    while (blockStart < padded.size) {
        for (t in 0 until 16) {
            val j = blockStart + t * 4
            w[t] =
                ((padded[j].toInt() and 0xff) shl 24) or
                ((padded[j + 1].toInt() and 0xff) shl 16) or
                ((padded[j + 2].toInt() and 0xff) shl 8) or
                (padded[j + 3].toInt() and 0xff)
        }
        for (t in 16 until 64) {
            val s0 = rotr(w[t - 15], 7) xor rotr(w[t - 15], 18) xor (w[t - 15] ushr 3)
            val s1 = rotr(w[t - 2], 17) xor rotr(w[t - 2], 19) xor (w[t - 2] ushr 10)
            w[t] = w[t - 16] + s0 + w[t - 7] + s1
        }

        var a = h[0]
        var b = h[1]
        var c = h[2]
        var d = h[3]
        var e = h[4]
        var f = h[5]
        var g = h[6]
        var hh = h[7]

        for (t in 0 until 64) {
            val bigS1 = rotr(e, 6) xor rotr(e, 11) xor rotr(e, 25)
            val ch = (e and f) xor (e.inv() and g)
            val t1 = hh + bigS1 + ch + SHA256_K[t] + w[t]
            val bigS0 = rotr(a, 2) xor rotr(a, 13) xor rotr(a, 22)
            val maj = (a and b) xor (a and c) xor (b and c)
            val t2 = bigS0 + maj
            hh = g
            g = f
            f = e
            e = d + t1
            d = c
            c = b
            b = a
            a = t1 + t2
        }

        h[0] += a
        h[1] += b
        h[2] += c
        h[3] += d
        h[4] += e
        h[5] += f
        h[6] += g
        h[7] += hh
        blockStart += 64
    }

    val digest = ByteArray(32)
    for (n in 0 until 8) {
        digest[n * 4] = (h[n] ushr 24).toByte()
        digest[n * 4 + 1] = (h[n] ushr 16).toByte()
        digest[n * 4 + 2] = (h[n] ushr 8).toByte()
        digest[n * 4 + 3] = h[n].toByte()
    }
    return digest
}

/**
 * Cryptographically secure random bytes, implemented per platform
 * (`SecureRandom` on Android, `arc4random_buf` on Apple). Used for the PKCE verifier
 * and the `state`/`nonce` values.
 */
internal expect fun secureRandomBytes(size: Int): ByteArray
