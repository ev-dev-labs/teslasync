// Pure, framework-free model + projection for the Color Converter feature view — the native analogue of
// everything the web component derives via `useMemo` before returning JSX
// (web/src/features/admin/components/devtools/tools/ColorConverter.tsx) plus the `rgbToHsl` helper it imports
// from `../helpers`. No Compose, no Android, no HTTP: every type here is unit-tested off-device in the
// :android:testReleaseUnitTest gate, keeping the composable a thin render layer.
//
// The web tool is purely client-side — it holds a hex string in `useState` (default `#3b82f6`) and a
// `useMemo` parses it into `{ r, g, b, h, s, l }` or `null`. This file owns exactly that derivation: the hex
// parse (web `useMemo` body) and the RGB→HSL conversion (web `rgbToHsl`), plus the `rgb(...)`/`hsl(...)`
// display formatting the JSX interpolates. The composable adds only the input field, the swatch, the copy
// affordances, and the lifecycle chrome the host's seed implies.
//
// Parity note on parsing: the web uses `parseInt(slice, 16)`, which is lenient (it parses a leading valid
// prefix and only yields `NaN` when no hex digit leads). We instead validate a strict 6-hex-digit string —
// the observable contract is identical for every well-formed `#RRGGBB` input (the only meaningful case),
// while malformed input deterministically yields the invalid/empty surface instead of a half-parsed colour.
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/feature-views/ColorConverter — the P3 prompt's allowed-files path) cannot form a valid
// Kotlin package (a hyphen and a PascalCase segment are illegal in a package identifier), so the package
// intentionally diverges from the path — exactly as the sibling AlertDetailTimeline surface does.
// `MatchingDeclarationName` is suppressed for the co-located supporting types.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.colorconverter

import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToInt

/** The web tool's initial hex (`useState('#3b82f6')`); also the fallback seed when the host supplies none. */
internal const val DEFAULT_HEX: String = "#3b82f6"

/** Number of hex characters in a well-formed `#RRGGBB` colour, sans the `#`. */
private const val HEX_LENGTH = 6

/** Diagnostics + registry identifiers for the surface (P1/S11). */
object ColorConverterRegistration {
    /** Stable surface id. */
    const val ID: String = "color-converter"

    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). */
    const val SLUG: String = "ColorConverter"
}

/**
 * One fully parsed colour — the native analogue of the web `useMemo`'s `{ r, g, b, h, s, l }` result. Pure
 * data (no Compose types) so the projection is unit-tested without a UI host. [rgb] and [hsl] reproduce the
 * exact strings the web JSX interpolates (`rgb(r, g, b)` / `hsl(h, s%, l%)`), so they are also what the copy
 * affordances place on the clipboard.
 *
 * @property r red channel, 0–255.
 * @property g green channel, 0–255.
 * @property b blue channel, 0–255.
 * @property h hue, 0–360 degrees.
 * @property s saturation, 0–100 percent.
 * @property l lightness, 0–100 percent.
 */
data class ParsedColor(
    val r: Int,
    val g: Int,
    val b: Int,
    val h: Int,
    val s: Int,
    val l: Int,
) {
    /** `rgb(r, g, b)` — matches the web `rgb(${r}, ${g}, ${b})` template. */
    val rgb: String get() = "rgb($r, $g, $b)"

    /** `hsl(h, s%, l%)` — matches the web `hsl(${h}, ${s}%, ${l}%)` template. */
    val hsl: String get() = "hsl($h, $s%, $l%)"
}

/**
 * The pure projection the composable renders — the native mirror of the web tool's `useMemo` block + the
 * imported `rgbToHsl` helper. Stateless and side-effect-free so it is fully covered by the off-device unit
 * gate.
 */
object ColorConverterProjection {
    private val HEX_6 = Regex("^[0-9a-fA-F]{6}$")

    /**
     * Parses a `#RRGGBB` (or `RRGGBB`) hex string into a [ParsedColor], or `null` when it is not a valid
     * six-digit hex — the native analogue of the web `useMemo` body (`clean.length !== 6` / `isNaN` guards).
     * A single leading `#` is stripped (web `hex.replace('#', '')`); any other shape yields `null`, which the
     * composable renders as the friendly empty hint (web hides the grid).
     */
    fun parse(hex: String): ParsedColor? {
        val clean = hex.removePrefix("#")
        if (clean.length != HEX_LENGTH || !HEX_6.matches(clean)) return null
        val r = clean.substring(0, 2).toInt(16)
        val g = clean.substring(2, 4).toInt(16)
        val b = clean.substring(4, 6).toInt(16)
        val (h, s, l) = rgbToHsl(r, g, b)
        return ParsedColor(r = r, g = g, b = b, h = h, s = s, l = l)
    }

    /**
     * Converts an RGB triple (each 0–255) to HSL (`h` 0–360, `s`/`l` 0–100), rounding each component — a
     * faithful port of the web `rgbToHsl` helper, including its achromatic short-circuit (`max == min`) and
     * its hue-sector selection. Rounding matches the web `Math.round` for these non-negative values.
     */
    fun rgbToHsl(
        r: Int,
        g: Int,
        b: Int,
    ): Triple<Int, Int, Int> {
        val r1 = r / RGB_MAX
        val g1 = g / RGB_MAX
        val b1 = b / RGB_MAX
        val maxC = max(r1, max(g1, b1))
        val minC = min(r1, min(g1, b1))
        val l = (maxC + minC) / 2.0
        if (maxC == minC) return Triple(0, 0, (l * PCT).roundToInt())
        val d = maxC - minC
        val s = if (l > 0.5) d / (2 - maxC - minC) else d / (maxC + minC)
        val h =
            when (maxC) {
                r1 -> ((g1 - b1) / d + (if (g1 < b1) HUE_WRAP else 0.0)) / HUE_SECTORS
                g1 -> ((b1 - r1) / d + 2) / HUE_SECTORS
                else -> ((r1 - g1) / d + 4) / HUE_SECTORS
            }
        return Triple((h * DEGREES).roundToInt(), (s * PCT).roundToInt(), (l * PCT).roundToInt())
    }

    private const val RGB_MAX = 255.0
    private const val PCT = 100.0
    private const val DEGREES = 360.0
    private const val HUE_SECTORS = 6.0
    private const val HUE_WRAP = 6.0
}
