package io.teslasync.android.featureviews.colorconverter

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/**
 * Off-device verification of the Color Converter's pure logic — the native analogue of the web tool's
 * `useMemo` block + the imported `rgbToHsl` helper
 * (web/src/features/admin/components/devtools/tools/ColorConverter.tsx + ../helpers.ts): the hex parse with
 * its validity guard, the RGB→HSL conversion (achromatic short-circuit, hue-sector selection, rounding), and
 * the `rgb(...)`/`hsl(...)` display formatting the JSX interpolates. Runs in the :android:testReleaseUnitTest
 * gate. The reference values are the well-known Tailwind palette HSLs the web renders for the same inputs.
 */
class ColorConverterProjectionTest {
    // ── parse (web useMemo body: strip '#', require 6 hex digits, else null) ────

    @Test
    fun parsesDefaultBlueIntoRgbAndHsl() {
        val parsed = ColorConverterProjection.parse("#3b82f6")
        assertEquals(ParsedColor(r = 59, g = 130, b = 246, h = 217, s = 91, l = 60), parsed)
    }

    @Test
    fun parsesWithoutLeadingHash() {
        assertEquals(ColorConverterProjection.parse("#3b82f6"), ColorConverterProjection.parse("3b82f6"))
    }

    @Test
    fun parsesUppercaseHex() {
        assertEquals(ParsedColor(r = 255, g = 255, b = 255, h = 0, s = 0, l = 100), ColorConverterProjection.parse("#FFFFFF"))
    }

    @Test
    fun parsesEmeraldGreen() {
        assertEquals(ParsedColor(r = 16, g = 185, b = 129, h = 160, s = 84, l = 39), ColorConverterProjection.parse("#10b981"))
    }

    @Test
    fun returnsNullForInvalidHex() {
        assertNull(ColorConverterProjection.parse(""))
        assertNull(ColorConverterProjection.parse("#fff")) // 3 digits
        assertNull(ColorConverterProjection.parse("#12345")) // 5 digits
        assertNull(ColorConverterProjection.parse("#1234567")) // 7 digits
        assertNull(ColorConverterProjection.parse("#12345g")) // non-hex char
        assertNull(ColorConverterProjection.parse("ghijkl")) // non-hex chars
        assertNull(ColorConverterProjection.parse("   ")) // blank
    }

    // ── rgbToHsl (web rgbToHsl helper parity) ───────────────────────────────────

    @Test
    fun rgbToHslShortCircuitsAchromaticGreys() {
        assertEquals(Triple(0, 0, 100), ColorConverterProjection.rgbToHsl(255, 255, 255))
        assertEquals(Triple(0, 0, 0), ColorConverterProjection.rgbToHsl(0, 0, 0))
        assertEquals(Triple(0, 0, 50), ColorConverterProjection.rgbToHsl(128, 128, 128))
    }

    @Test
    fun rgbToHslComputesPrimaryHues() {
        assertEquals(Triple(0, 100, 50), ColorConverterProjection.rgbToHsl(255, 0, 0)) // red
        assertEquals(Triple(120, 100, 50), ColorConverterProjection.rgbToHsl(0, 255, 0)) // green
        assertEquals(Triple(240, 100, 50), ColorConverterProjection.rgbToHsl(0, 0, 255)) // blue
    }

    @Test
    fun rgbToHslHandlesBlueDominantWrapAround() {
        // max == blue and g < b exercises the `+ 6` hue-wrap branch of the web helper.
        assertEquals(Triple(217, 91, 60), ColorConverterProjection.rgbToHsl(59, 130, 246))
    }

    // ── display formatting (web JSX `rgb(...)` / `hsl(...)` templates) ───────────

    @Test
    fun formatsRgbAndHslStrings() {
        val parsed = ParsedColor(r = 59, g = 130, b = 246, h = 217, s = 91, l = 60)
        assertEquals("rgb(59, 130, 246)", parsed.rgb)
        assertEquals("hsl(217, 91%, 60%)", parsed.hsl)
    }
}
