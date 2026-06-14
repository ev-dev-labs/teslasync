package io.teslasync.android.sharedsurfaces.input

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Off-device verification of the Input surface's pure logic — the native mirror of every decision the web
 * component makes before it paints its field (web/src/components/ui/Input.tsx): the error-wins-over-hint
 * message precedence, the invalid flag, the `id || label-slug` id derivation, the help field-name fallback,
 * and the required-aware accessible name. Because the composable is a thin render layer over these functions,
 * the per-branch assertions here double as the surface's per-state snapshot. Runs in the
 * :android:testReleaseUnitTest gate.
 */
class InputModelTest {
    // ── resolveSupporting: the message slot (web `{error && …}{hint && !error && …}`) ───────────────────

    @Test
    fun errorTakesPrecedenceOverHintAndMarksTheSlotAsError() {
        val supporting = resolveSupporting(error = "Required", hint = "Helper")
        assertEquals("Required", supporting.text)
        assertEquals(InputSupportingKind.Error, supporting.kind)
        assertTrue(supporting.isError)
    }

    @Test
    fun hintShowsOnlyWhenThereIsNoError() {
        val supporting = resolveSupporting(error = null, hint = "Helper")
        assertEquals("Helper", supporting.text)
        assertEquals(InputSupportingKind.Hint, supporting.kind)
        assertFalse(supporting.isError)
    }

    @Test
    fun neitherErrorNorHintLeavesAnEmptySlot() {
        val supporting = resolveSupporting(error = null, hint = null)
        assertNull(supporting.text)
        assertEquals(InputSupportingKind.None, supporting.kind)
        assertFalse(supporting.isError)
    }

    @Test
    fun blankErrorIsTreatedAsAbsentSoTheHintCanShow() {
        // web truthiness: `"" && …` is falsy, so an empty error lets the hint render and is not invalid.
        val supporting = resolveSupporting(error = "  ", hint = "Helper")
        assertEquals("Helper", supporting.text)
        assertEquals(InputSupportingKind.Hint, supporting.kind)
    }

    // ── isInvalid: the web `aria-invalid` / red border ──────────────────────────────────────────────────

    @Test
    fun isInvalidTracksOnlyNonBlankErrors() {
        assertTrue(isInvalid("Bad value"))
        assertFalse(isInvalid(null))
        assertFalse(isInvalid(""))
        assertFalse(isInvalid("   "))
    }

    // ── resolveInputId: web `id || label?.toLowerCase().replace(/\s+/g, '-')` ────────────────────────────

    @Test
    fun explicitIdWinsOverTheLabelSlug() {
        assertEquals("custom-id", resolveInputId(id = "custom-id", label = "Battery Capacity"))
    }

    @Test
    fun labelIsSluggedWhenNoIdIsSupplied() {
        assertEquals("battery-capacity", resolveInputId(id = null, label = "Battery Capacity"))
        assertEquals("multi-word-label", resolveInputId(id = "  ", label = "Multi   Word\tLabel"))
    }

    @Test
    fun idIsNullWhenNeitherIdNorLabelIsSupplied() {
        assertNull(resolveInputId(id = null, label = null))
        assertNull(resolveInputId(id = "", label = null))
    }

    // ── helpFieldName: web `help.for ?? inputId`, with the generic fallback when blank ──────────────────

    @Test
    fun helpFieldNameFollowsTheDerivedIdAndIsNullWhenBlank() {
        assertEquals("email", helpFieldName(id = null, label = "Email"))
        assertEquals("explicit", helpFieldName(id = "explicit", label = null))
        assertNull(helpFieldName(id = null, label = null))
    }

    // ── fieldAccessibleName: web `<label for>` name + visually-hidden required word ──────────────────────

    @Test
    fun accessibleNameIsNullWithoutALabel() {
        assertNull(fieldAccessibleName(label = null, required = false, requiredWord = "required"))
        assertNull(fieldAccessibleName(label = null, required = true, requiredWord = "required"))
    }

    @Test
    fun accessibleNameIsTheBareLabelWhenOptional() {
        assertEquals("Email", fieldAccessibleName(label = "Email", required = false, requiredWord = "required"))
    }

    @Test
    fun accessibleNameAppendsTheRequiredWordWhenRequired() {
        assertEquals("Email, required", fieldAccessibleName(label = "Email", required = true, requiredWord = "required"))
    }

    // ── size contract: all four web sizes are modelled (sm / md / lg / auto) ────────────────────────────

    @Test
    fun everySizeFromTheWebPropIsModelled() {
        assertEquals(4, InputSize.entries.size)
        assertTrue(
            InputSize.entries.containsAll(
                listOf(InputSize.Sm, InputSize.Md, InputSize.Lg, InputSize.Auto),
            ),
        )
    }

    // ── registration / slug contract ────────────────────────────────────────────────────────────────────

    @Test
    fun slugMatchesTheSurfaceContract() {
        assertEquals("Input", INPUT_SLUG)
        assertEquals("Input", InputRegistration.SLUG)
        assertEquals("input", InputRegistration.ID)
    }
}
