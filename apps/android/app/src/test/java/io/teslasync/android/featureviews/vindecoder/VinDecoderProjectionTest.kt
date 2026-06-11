package io.teslasync.android.featureviews.vindecoder

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/**
 * Off-device verification of the VIN Decoder's pure logic — the native analogue of the web tool's
 * `useMemo` block + the lookup tables it imports
 * (web/src/features/admin/components/devtools/tools/VinDecoder.tsx + ../constants.ts): the 11-character
 * decode threshold, the uppercasing, the five fixed-position lookups (with their unmatched → `null`
 * fallback), and the serial slice. Runs in the :android:testReleaseUnitTest gate. The reference values
 * are the manufacturer/model/drive/year/plant the web renders for the same VIN positions.
 */
class VinDecoderProjectionTest {
    // ── decode (web useMemo body) ───────────────────────────────────────────────

    @Test
    fun decodesFullKnownVin() {
        // 5YJ(USA) 3(Model 3) ..A(Dual Motor AWD) .N(2022) F(Fremont) | 000001
        val decoded = VinDecoderProjection.decode("5YJ3E1EA1NF000001")
        assertEquals(
            DecodedVin(
                mfr = "Tesla (USA)",
                model = "Model 3",
                drive = "Dual Motor AWD",
                year = "2022",
                plant = "Fremont, CA",
                serial = "000001",
            ),
            decoded,
        )
    }

    @Test
    fun uppercasesBeforeDecoding() {
        assertEquals(
            VinDecoderProjection.decode("5YJ3E1EA1NF000001"),
            VinDecoderProjection.decode("5yj3e1ea1nf000001"),
        )
    }

    @Test
    fun decodesChinaBuiltModelY() {
        // LRW(China) Y(Model Y) ..2(Dual Motor AWD) .P(2023) B(Berlin) | 654321
        val decoded = VinDecoderProjection.decode("LRWYAAA2APB654321")
        assertEquals(
            DecodedVin(
                mfr = "Tesla (China)",
                model = "Model Y",
                drive = "Dual Motor AWD",
                year = "2023",
                plant = "Berlin, Germany",
                serial = "654321",
            ),
            decoded,
        )
    }

    @Test
    fun foldsUnrecognizedPositionsToNull() {
        // 11 characters, none of which are known Tesla codes → every looked-up field is null.
        val decoded = VinDecoderProjection.decode("QQQ0Q0Q0Q0Q")
        assertEquals(DecodedVin(null, null, null, null, null, ""), decoded)
    }

    @Test
    fun returnsNullBelowMinLength() {
        assertNull(VinDecoderProjection.decode(""))
        assertNull(VinDecoderProjection.decode("5YJ3E1EA1N")) // 10 chars
        assertNull(VinDecoderProjection.decode("5YJ")) // 3 chars
    }

    @Test
    fun decodesAtExactlyMinLengthWithEmptySerial() {
        // Exactly 11 characters: every position resolves, the serial slice is empty (web upper.slice(11)).
        val decoded = VinDecoderProjection.decode("5YJ3E1EA1NF")
        assertEquals(
            DecodedVin(
                mfr = "Tesla (USA)",
                model = "Model 3",
                drive = "Dual Motor AWD",
                year = "2022",
                plant = "Fremont, CA",
                serial = "",
            ),
            decoded,
        )
    }

    @Test
    fun serialCapturesEverythingPastPositionEleven() {
        assertEquals("ABCDEF", VinDecoderProjection.decode("5YJ3E1EA1NFABCDEF")?.serial)
    }

    @Test
    fun mixesKnownAndUnknownPositions() {
        // Known manufacturer + model, unknown drive/year/plant code → those three fold to null.
        val decoded = VinDecoderProjection.decode("5YJS00000009")
        assertEquals("Tesla (USA)", decoded?.mfr)
        assertEquals("Model S", decoded?.model)
        assertNull(decoded?.drive)
        assertNull(decoded?.year)
        assertNull(decoded?.plant)
        assertEquals("9", decoded?.serial)
    }
}
