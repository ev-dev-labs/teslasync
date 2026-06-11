package io.teslasync.android.featureviews.toolcard

import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * Off-device verification of the ToolCard's pure logic — the native analogue of the only derivation
 * the web component performs (web/src/features/admin/components/devtools/ToolCard.tsx): the icon
 * color lookup `ICON_COLOR_MAP[color] ?? ICON_COLOR_MAP.cyan` (here [ToolCardAccent.fromRaw]) and the
 * surface registration identifiers. Runs in the :android:testReleaseUnitTest gate; the on-device
 * render + accessibility are covered by ToolCardUiTest.
 */
class ToolCardModelTest {
    // ── Accent classification (web ICON_COLOR_MAP keys) ───────────────────────────

    @Test
    fun fromRawMapsEveryKnownColorKey() {
        assertEquals(ToolCardAccent.Cyan, ToolCardAccent.fromRaw("cyan"))
        assertEquals(ToolCardAccent.Green, ToolCardAccent.fromRaw("green"))
        assertEquals(ToolCardAccent.Purple, ToolCardAccent.fromRaw("purple"))
        assertEquals(ToolCardAccent.Amber, ToolCardAccent.fromRaw("amber"))
        assertEquals(ToolCardAccent.Red, ToolCardAccent.fromRaw("red"))
    }

    @Test
    fun fromRawFoldsUnknownColorToCyan() {
        // Web parity: `ICON_COLOR_MAP[color] ?? ICON_COLOR_MAP.cyan`.
        assertEquals(ToolCardAccent.Cyan, ToolCardAccent.fromRaw("chartreuse"))
        assertEquals(ToolCardAccent.Cyan, ToolCardAccent.fromRaw("blue"))
        assertEquals(ToolCardAccent.Cyan, ToolCardAccent.fromRaw(""))
        assertEquals(ToolCardAccent.Cyan, ToolCardAccent.fromRaw("   "))
    }

    @Test
    fun fromRawIsCaseSensitiveLikeTheWebRecordLookup() {
        // The web map's keys are exact lowercase; a differently-cased value misses and folds to cyan.
        assertEquals(ToolCardAccent.Cyan, ToolCardAccent.fromRaw("Cyan"))
        assertEquals(ToolCardAccent.Cyan, ToolCardAccent.fromRaw("GREEN"))
        assertEquals(ToolCardAccent.Cyan, ToolCardAccent.fromRaw("Purple"))
    }

    @Test
    fun everyEnumCaseIsReachableFromItsKey() {
        // Guards against an accent being added without a matching fromRaw key (drift).
        val mapped = ToolCardAccent.entries.map { it to ToolCardAccent.fromRaw(it.name.lowercase()) }
        mapped.forEach { (expected, actual) -> assertEquals(expected, actual) }
    }

    // ── Registration identifiers (P1/S11) ─────────────────────────────────────────

    @Test
    fun registrationExposesStableIdAndSlug() {
        assertEquals("tool-card", ToolCardRegistration.ID)
        assertEquals("ToolCard", ToolCardRegistration.SLUG)
    }
}
