// Off-device unit coverage for the Modal modal/dialog's pure model (P3 acceptance: adapter + per-branch + diagnostics
// tests). Exercises the projection's `open` gate, the `title ? aria-labelledby : aria-label` labelling branch
// (non-blank title -> header + name; blank/absent -> anonymous, named by `ariaLabel`), the `size` -> max-width ceiling
// mapping (including the lg/full clamp to the design-system modal ceiling and the preserved ordering), the registry
// identifiers, and the PII-safe `view.opened` diagnostic. No Compose / Android / HTTP — runs in
// :android:testReleaseUnitTest.
package io.teslasync.android.modalsdialogs.modal

import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.Logger
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class ModalModelTest {
    private class RecordingLogger : Logger {
        val records = mutableListOf<Triple<LogLevel, String, Map<String, String>>>()

        override fun log(
            level: LogLevel,
            event: String,
            fields: Map<String, String>,
        ) {
            records += Triple(level, event, fields)
        }
    }

    // ---- Projection: the `open` gate (web `if (!open) return null`) ------------------------------

    @Test
    fun project_passesOpenThrough() {
        assertTrue(ModalProjection.project(open = true, title = "T", ariaLabel = null, size = ModalSize.Md).open)
        assertFalse(ModalProjection.project(open = false, title = "T", ariaLabel = null, size = ModalSize.Md).open)
    }

    // ---- Projection: the title -> header / accessible-name branch (web aria-labelledby / aria-label) --

    @Test
    fun project_titlePresent_rendersHeaderAndLabelsByTitle() {
        val display = ModalProjection.project(open = true, title = "Battery health", ariaLabel = null, size = ModalSize.Md)
        assertTrue(display.hasHeader)
        assertEquals("Battery health", display.title)
        assertEquals("Battery health", display.accessibleName)
    }

    @Test
    fun project_blankTitle_treatedAsAnonymousAndFallsBackToAriaLabel() {
        val display = ModalProjection.project(open = true, title = "   ", ariaLabel = "Battery details", size = ModalSize.Md)
        assertFalse(display.hasHeader)
        assertNull(display.title)
        assertEquals("Battery details", display.accessibleName)
    }

    @Test
    fun project_noTitle_usesAriaLabelAsAccessibleName() {
        val display = ModalProjection.project(open = true, title = null, ariaLabel = "Battery details", size = ModalSize.Lg)
        assertFalse(display.hasHeader)
        assertNull(display.title)
        assertEquals("Battery details", display.accessibleName)
    }

    @Test
    fun project_noTitleAndNoAriaLabel_accessibleNameIsEmpty() {
        val display = ModalProjection.project(open = true, title = null, ariaLabel = null, size = ModalSize.Md)
        assertFalse(display.hasHeader)
        assertNull(display.title)
        assertEquals("", display.accessibleName)
    }

    @Test
    fun project_titleTakesPrecedenceOverAriaLabelForTheName() {
        val display = ModalProjection.project(open = true, title = "Heading", ariaLabel = "Other label", size = ModalSize.Md)
        assertTrue(display.hasHeader)
        assertEquals("Heading", display.accessibleName)
    }

    @Test
    fun project_passesSizeThrough() {
        ModalSize.entries.forEach { size ->
            assertEquals(size, ModalProjection.project(open = true, title = "T", ariaLabel = null, size = size).size)
        }
    }

    // ---- maxWidthDp: web `sizes` record -> native ceilings (lg/full clamp; ordering preserved) ----

    @Test
    fun maxWidthDp_mapsEachPresetToItsCeiling() {
        assertEquals(360, ModalProjection.maxWidthDp(ModalSize.Sm))
        assertEquals(480, ModalProjection.maxWidthDp(ModalSize.Md))
        assertEquals(560, ModalProjection.maxWidthDp(ModalSize.Lg))
        assertEquals(560, ModalProjection.maxWidthDp(ModalSize.Full))
    }

    @Test
    fun maxWidthDp_isMonotonicNonDecreasingAcrossPresets() {
        val sm = ModalProjection.maxWidthDp(ModalSize.Sm)
        val md = ModalProjection.maxWidthDp(ModalSize.Md)
        val lg = ModalProjection.maxWidthDp(ModalSize.Lg)
        val full = ModalProjection.maxWidthDp(ModalSize.Full)
        assertTrue("sm must not exceed md", sm <= md)
        assertTrue("md must not exceed lg", md <= lg)
        assertTrue("lg must not exceed full", lg <= full)
    }

    @Test
    fun maxWidthDp_neverExceedsTheModalCeiling() {
        ModalSize.entries.forEach { size ->
            assertTrue("$size must clamp to the 560 dp modal ceiling", ModalProjection.maxWidthDp(size) <= 560)
        }
    }

    // ---- Registry + diagnostics -----------------------------------------------------------------

    @Test
    fun registrationIdentifiersAreStable() {
        assertEquals("modal", ModalRegistration.ID)
        assertEquals("Modal", ModalRegistration.SLUG)
    }

    @Test
    fun recordModalOpened_emitsPiiSafeViewOpened() {
        val logger = RecordingLogger()
        recordModalOpened(logger)

        assertEquals(1, logger.records.size)
        val (level, event, fields) = logger.records.single()
        assertEquals(LogLevel.Info, level)
        assertEquals("view.opened", event)
        assertEquals(mapOf("surface" to "Modal"), fields)
        // The diagnostic must carry no title or hosted content — only the surface slug, no digits.
        assertTrue(fields.values.none { value -> value.any(Char::isDigit) })
    }
}
