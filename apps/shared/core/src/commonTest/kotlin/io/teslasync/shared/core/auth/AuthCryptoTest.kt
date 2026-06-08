package io.teslasync.shared.core.auth

import kotlin.test.Test
import kotlin.test.assertEquals

/** Lowercase hex of [bytes] for comparing against published digest vectors. */
private fun ByteArray.toHex(): String {
    val hexChars = "0123456789abcdef"
    val out = StringBuilder(size * 2)
    for (b in this) {
        val v = b.toInt() and 0xff
        out.append(hexChars[v ushr 4])
        out.append(hexChars[v and 0x0f])
    }
    return out.toString()
}

class AuthCryptoTest {
    @Test
    fun sha256MatchesNistVectorForAbc() {
        assertEquals(
            "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
            sha256("abc".encodeToByteArray()).toHex(),
        )
    }

    @Test
    fun sha256MatchesNistVectorForEmptyInput() {
        assertEquals(
            "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
            sha256(ByteArray(0)).toHex(),
        )
    }

    @Test
    fun sha256MatchesNistVectorForTwoBlockMessage() {
        val input = "abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq"
        assertEquals(
            "248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1",
            sha256(input.encodeToByteArray()).toHex(),
        )
    }

    @Test
    fun sha256HandlesBlockBoundaryLengths() {
        // 55 bytes is the largest single-block message (1 byte short of needing a
        // second padding block); 56 bytes forces a second block. Compared against
        // OpenSSL-computed digests to exercise both padding paths.
        val msg55 = "a".repeat(55)
        val msg56 = "a".repeat(56)
        assertEquals(
            "9f4390f8d30c2dd92ec9f095b65e2b9ae9b0a925a5258e241c9f1e910f734318",
            sha256(msg55.encodeToByteArray()).toHex(),
        )
        assertEquals(
            "b35439a4ac6f0948b6d6f9e3c6af0f5f590ce20f1bde7090ef7970686ec6738a",
            sha256(msg56.encodeToByteArray()).toHex(),
        )
    }

    @Test
    fun base64UrlNoPadEncodesWithoutPaddingAndUrlSafeAlphabet() {
        // RFC 4648 §10 vectors, URL-safe, padding stripped.
        assertEquals("", base64UrlNoPad("".encodeToByteArray()))
        assertEquals("Zg", base64UrlNoPad("f".encodeToByteArray()))
        assertEquals("Zm8", base64UrlNoPad("fo".encodeToByteArray()))
        assertEquals("Zm9v", base64UrlNoPad("foo".encodeToByteArray()))
        assertEquals("Zm9vYg", base64UrlNoPad("foob".encodeToByteArray()))
        assertEquals("Zm9vYmE", base64UrlNoPad("fooba".encodeToByteArray()))
        assertEquals("Zm9vYmFy", base64UrlNoPad("foobar".encodeToByteArray()))
    }

    @Test
    fun base64UrlNoPadUsesDashAndUnderscore() {
        // Bytes 0xfb 0xff 0xfe encode to "-_-+" in standard Base64; URL-safe must
        // use '-' and '_' and never '+' or '/'.
        val encoded = base64UrlNoPad(byteArrayOf(0xfb.toByte(), 0xff.toByte(), 0xbf.toByte()))
        assertEquals("-_-_", encoded)
    }

    @Test
    fun pkceChallengeMatchesRfc7636KnownAnswer() {
        // RFC 7636 Appendix B: the canonical verifier → challenge example.
        val verifier = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"
        assertEquals(
            "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM",
            pkceChallengeFor(verifier),
        )
    }
}
