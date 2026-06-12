package io.teslasync.android.featureviews.highlightcard

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/**
 * Off-device verification of the HighlightCard's pure logic — the native mirror of every derivation the web
 * component performs (web/src/features/analytics/components/weekly-digest/HighlightCard.tsx): the
 * `color = 'cyan'` default + typed union ([HighlightColor.fromRaw]), the `glowMap[color] ?? 'none'` accent
 * collapse ([HighlightCardProjection.glowFor]), and the optional change / subtitle render branches
 * ([HighlightCardProjection.project], where an empty subtitle is falsy). Because the surface is purely
 * presentational, each [HighlightCardDisplay] is exactly what the thin composable renders, so these
 * assertions double as the per-state "snapshot". Runs in the :android:testReleaseUnitTest gate.
 */
class HighlightCardProjectionTest {
    // ── Accent classification (web `color` typed union, default 'cyan') ─────────────

    @Test
    fun fromRawMapsEveryKnownColorKey() {
        assertEquals(HighlightColor.Cyan, HighlightColor.fromRaw("cyan"))
        assertEquals(HighlightColor.Green, HighlightColor.fromRaw("green"))
        assertEquals(HighlightColor.Purple, HighlightColor.fromRaw("purple"))
        assertEquals(HighlightColor.Amber, HighlightColor.fromRaw("amber"))
        assertEquals(HighlightColor.Red, HighlightColor.fromRaw("red"))
    }

    @Test
    fun fromRawFoldsAbsentOrUnknownColorToCyan() {
        // Web parity: the `color = 'cyan'` default applies for a missing prop, and the typed union never
        // produces an out-of-set value, so anything unrecognised folds to the cyan default.
        assertEquals(HighlightColor.Cyan, HighlightColor.fromRaw(null))
        assertEquals(HighlightColor.Cyan, HighlightColor.fromRaw(""))
        assertEquals(HighlightColor.Cyan, HighlightColor.fromRaw("teal"))
    }

    @Test
    fun fromRawIsCaseSensitiveLikeTheWebUnion() {
        // The web keys are exact lowercase; a differently-cased value misses and folds to the default.
        assertEquals(HighlightColor.Cyan, HighlightColor.fromRaw("CYAN"))
        assertEquals(HighlightColor.Cyan, HighlightColor.fromRaw("Green"))
    }

    // ── Glow lookup (web `glowMap`) ─────────────────────────────────────────────────

    @Test
    fun glowForReproducesTheWebGlowMap() {
        assertEquals(HighlightGlow.Cyan, HighlightCardProjection.glowFor(HighlightColor.Cyan))
        assertEquals(HighlightGlow.Green, HighlightCardProjection.glowFor(HighlightColor.Green))
        assertEquals(HighlightGlow.Purple, HighlightCardProjection.glowFor(HighlightColor.Purple))
        // Web `glowMap` collapses amber + red to 'none': those cards never glow.
        assertEquals(HighlightGlow.None, HighlightCardProjection.glowFor(HighlightColor.Amber))
        assertEquals(HighlightGlow.None, HighlightCardProjection.glowFor(HighlightColor.Red))
    }

    // ── Projection branches ─────────────────────────────────────────────────────────

    @Test
    fun projectResolvesTheGlowFromTheAccent() {
        HighlightColor.entries.forEach { color ->
            val display = HighlightCardProjection.project("L", "V", color, change = null, subtitle = null)
            assertEquals(HighlightCardProjection.glowFor(color), display.glow)
        }
    }

    @Test
    fun projectPassesTheLabelValueAndChangeThrough() {
        val change = HighlightChange(value = "+12%", positive = true)
        val display =
            HighlightCardProjection.project(
                label = "Avg Efficiency",
                value = "248 Wh/mi",
                color = HighlightColor.Cyan,
                change = change,
                subtitle = "Across 12 drives",
            )

        assertEquals("Avg Efficiency", display.label)
        assertEquals("248 Wh/mi", display.value)
        assertEquals(change, display.change)
        assertEquals("Across 12 drives", display.subtitle)
    }

    @Test
    fun projectKeepsANullChangeNull() {
        // Web `{change && …}`: an absent change skips the trend row.
        val display = HighlightCardProjection.project("L", "V", HighlightColor.Green, change = null, subtitle = "s")
        assertNull(display.change)
    }

    @Test
    fun projectNormalizesAnEmptySubtitleToNull() {
        // Web `{subtitle && …}`: an empty string is falsy, so the caption row is skipped.
        val display = HighlightCardProjection.project("L", "V", HighlightColor.Cyan, change = null, subtitle = "")
        assertNull(display.subtitle)
    }

    @Test
    fun projectKeepsANonEmptySubtitleIncludingWhitespace() {
        // A non-empty string — even whitespace-only — is truthy in JS, so it is preserved verbatim.
        assertEquals("Reno", HighlightCardProjection.project("L", "V", HighlightColor.Cyan, null, "Reno").subtitle)
        assertEquals(" ", HighlightCardProjection.project("L", "V", HighlightColor.Cyan, null, " ").subtitle)
    }

    @Test
    fun projectKeepsANullSubtitleNull() {
        val display = HighlightCardProjection.project("L", "V", HighlightColor.Cyan, change = null, subtitle = null)
        assertNull(display.subtitle)
    }
}
