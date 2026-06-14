// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/shared-surfaces/MaskedValue) cannot form a valid Kotlin package, so the test package mirrors
// the production package it exercises.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.maskedvalue

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Off-device verification of the MaskedValue surface's pure logic — the native mirror of every decision the web
 * component + its `maskValue` helper make (web/src/components/ui/MaskedValue.tsx, web/src/lib/maskValue.ts)
 * before they paint: the five masking strategies, the per-variant default visible-suffix, the raw/masked/empty
 * projection (the surface's adapter: caller input -> render projection), the revealed/masked display selection,
 * the toggle-state selection, and the reveal-audit port. Because the composable is a thin render layer over
 * these, the per-branch assertions here double as the surface's per-state snapshot. Runs in the
 * :android:testReleaseUnitTest gate.
 */
class MaskedValueModelTest {
    private fun b(count: Int): String = "\u2022".repeat(count)

    // ── maskFor: generic (bullets + last `showLast`) ──────────────────────────────────────────────────────

    @Test
    fun genericMasksEveryCharacterByDefault() {
        assertEquals(b(5), maskFor("hello", MaskVariant.Generic))
    }

    @Test
    fun genericHonoursAnExplicitShowLast() {
        assertEquals(b(3) + "lo", maskFor("hello", MaskVariant.Generic, showLast = 2))
    }

    // ── maskFor: token (fixed 12-bullet run hides length, shows last 4) ──────────────────────────────────

    @Test
    fun tokenRendersAFixedBulletRunAndTheLastFour() {
        assertEquals(b(12) + "1234", maskFor("secret1234", MaskVariant.Token))
    }

    @Test
    fun tokenLengthIsHiddenRegardlessOfInputLength() {
        val short = maskFor("ab12", MaskVariant.Token)
        val long = maskFor("a_very_long_secret_value_1234", MaskVariant.Token)
        // Both render the same fixed-length bullet run before their last 4, so length never leaks.
        assertEquals(b(12) + "ab12", short)
        assertEquals(b(12) + "1234", long)
    }

    // ── maskFor: vin (WMI prefix + bullets + last 4 once plausibly a VIN; full bullets otherwise) ─────────

    @Test
    fun vinKeepsTheWmiPrefixAndLastFourForAFullVin() {
        assertEquals("5YJ" + b(10) + "0000", maskFor("5YJ3E1EA7KF000000", MaskVariant.Vin))
    }

    @Test
    fun vinFallsBackToAFullBulletRunForShortInput() {
        assertEquals(b(3), maskFor("ABC", MaskVariant.Vin))
    }

    // ── maskFor: email (masked local-part, visible domain, always at least one bullet) ───────────────────

    @Test
    fun emailMasksTheLocalPartAndKeepsTheDomain() {
        assertEquals("j" + b(3) + "@example.com", maskFor("john@example.com", MaskVariant.Email))
    }

    @Test
    fun emailAlwaysHidesAtLeastOneLocalCharacter() {
        assertEquals("a" + b(1) + "@b.com", maskFor("a@b.com", MaskVariant.Email))
    }

    @Test
    fun emailWithoutAnAtFallsBackToGeneric() {
        assertEquals(b(10) + "g", maskFor("plainstring", MaskVariant.Email))
    }

    // ── maskFor: coords (per-part low-resolution mask; generic for non-numeric) ──────────────────────────

    @Test
    fun coordsMaskBothComponentsOfALatLngPair() {
        assertEquals("\u2022\u2022.\u2022\u2022\u2022, \u2022\u2022.\u2022\u2022\u2022", maskFor("37.7749,-122.4194", MaskVariant.Coords))
    }

    @Test
    fun coordsMaskASingleNumber() {
        assertEquals("\u2022\u2022.\u2022\u2022\u2022", maskFor("37.7749", MaskVariant.Coords))
    }

    @Test
    fun coordsFallBackToGenericForNonNumericInput() {
        assertEquals(b(7), maskFor("abc,def", MaskVariant.Coords))
    }

    // ── maskFor: total + null-safe ───────────────────────────────────────────────────────────────────────

    @Test
    fun maskForIsNullAndEmptySafe() {
        assertEquals("", maskFor(null, MaskVariant.Token))
        assertEquals("", maskFor("", MaskVariant.Generic))
    }

    // ── defaultShowLast: the conservative per-variant suffix table (web DEFAULT_SHOW_LAST) ───────────────

    @Test
    fun defaultShowLastMatchesTheWebTable() {
        assertEquals(4, defaultShowLast(MaskVariant.Token))
        assertEquals(4, defaultShowLast(MaskVariant.Vin))
        assertEquals(0, defaultShowLast(MaskVariant.Coords))
        assertEquals(1, defaultShowLast(MaskVariant.Email))
        assertEquals(0, defaultShowLast(MaskVariant.Generic))
    }

    @Test
    fun everyVariantFromTheWebUnionIsModelled() {
        assertEquals(5, MaskVariant.entries.size)
    }

    // ── projectMaskedValue: the adapter (caller input -> raw / masked / isEmpty render projection) ────────

    @Test
    fun projectionOfANullValueIsEmptyWithNoMask() {
        val projection = projectMaskedValue(null, MaskVariant.Token)
        assertTrue(projection.isEmpty)
        assertEquals("", projection.raw)
        assertEquals("", projection.masked)
    }

    @Test
    fun projectionOfABlankValueIsEmpty() {
        assertTrue(projectMaskedValue("", MaskVariant.Generic).isEmpty)
    }

    @Test
    fun projectionOfARealValueCarriesRawAndMasked() {
        val projection = projectMaskedValue("secret1234", MaskVariant.Token)
        assertFalse(projection.isEmpty)
        assertEquals("secret1234", projection.raw)
        assertEquals(b(12) + "1234", projection.masked)
    }

    // ── display: revealed shows raw, masked otherwise (web `revealed ? raw : masked`) ────────────────────

    @Test
    fun displaySelectsRawWhenRevealedAndMaskedOtherwise() {
        val projection = projectMaskedValue("secret1234", MaskVariant.Token)
        assertEquals(projection.masked, projection.display(revealed = false))
        assertEquals("secret1234", projection.display(revealed = true))
    }

    // ── toggleFor: reveal while masked, hide while revealed ──────────────────────────────────────────────

    @Test
    fun toggleSelectsRevealWhileMaskedAndHideWhileRevealed() {
        assertEquals(RevealToggle.Reveal, toggleFor(revealed = false))
        assertEquals(RevealToggle.Hide, toggleFor(revealed = true))
    }

    // ── RevealAuditSink: the default is a no-op; a real sink receives the variant ─────────────────────────

    @Test
    fun defaultRevealAuditSinkIsANoOp() {
        // The web default `auditOnReveal=false`: invoking the default sink records nothing and never throws.
        RevealAuditSink.None.recordReveal(MaskVariant.Token)
    }

    @Test
    fun aWiredRevealAuditSinkReceivesTheVariant() {
        var captured: MaskVariant? = null
        val sink = RevealAuditSink { captured = it }
        sink.recordReveal(MaskVariant.Vin)
        assertEquals(MaskVariant.Vin, captured)
    }

    // ── registration / slug contract ─────────────────────────────────────────────────────────────────────

    @Test
    fun slugMatchesTheSurfaceContract() {
        assertEquals("MaskedValue", MASKED_VALUE_SLUG)
        assertEquals("MaskedValue", MaskedValueRegistration.SLUG)
        assertEquals("masked-value", MaskedValueRegistration.ID)
    }
}
