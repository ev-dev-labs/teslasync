// Off-device unit tests for the pure SortControl model: the direction label (web `direction === 'asc' ? t(asc) :
// t(desc)`), the merged direction accessibility name (web `directionAriaLabel ?? "${t(direction)}: ${dirLabel}"`,
// covering both the default and the caller-override branches), the full props → display projection across the
// content / empty / unknown-field cases, the i18n key inventory (every web `t(key)` this surface makes), the
// diagnostics slug, and the PII-safe `view.opened` diagnostic. Run by the offline :android:testReleaseUnitTest
// gate — no Compose, no Android.

package io.teslasync.android.sharedsurfaces.sortcontrol

import io.teslasync.android.components.forms.SortOption
import io.teslasync.android.components.ui.SelectOption
import io.teslasync.android.components.ui.SortDirection
import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.Logger
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class SortControlModelTest {
    private val strings =
        SortControlStrings(
            ascending = "Ascending",
            descending = "Descending",
            fieldLabel = "Sort by",
            direction = "Sort direction",
        )

    private val options = listOf(SortOption("date", "Date"), SortOption("distance", "Distance"))

    // ── direction label (web direction === 'asc' ? t(asc) : t(desc)) ────────────────────────────────────────────
    @Test
    fun directionLabelPicksAscendingOrDescending() {
        assertEquals("Ascending", SortControlProjection.directionLabel(SortDirection.Asc, strings))
        assertEquals("Descending", SortControlProjection.directionLabel(SortDirection.Desc, strings))
    }

    // ── direction accessibility name (web directionAriaLabel ?? "${direction}: ${dirLabel}") ────────────────────
    @Test
    fun directionContentDescriptionBuildsTheLocalizedDefault() {
        assertEquals(
            "Sort direction: Ascending",
            SortControlProjection.directionContentDescription(SortDirection.Asc, strings, override = null),
        )
        assertEquals(
            "Sort direction: Descending",
            SortControlProjection.directionContentDescription(SortDirection.Desc, strings, override = null),
        )
    }

    @Test
    fun directionContentDescriptionPrefersTheCallerOverride() {
        assertEquals(
            "Flip the sort order",
            SortControlProjection.directionContentDescription(SortDirection.Asc, strings, override = "Flip the sort order"),
        )
    }

    // ── projection: content (one or more options) ───────────────────────────────────────────────────────────────
    @Test
    fun projectMapsOptionsAndResolvesTheSelectedOption() {
        val display = SortControlProjection.project("date", SortDirection.Asc, options, strings)

        assertTrue(display.isAscending)
        assertEquals("Ascending", display.directionLabel)
        assertEquals("Sort direction: Ascending", display.directionContentDescription)
        assertEquals("Sort by", display.fieldLabel)
        assertEquals(listOf(SelectOption("date", "Date"), SelectOption("distance", "Distance")), display.selectOptions)
        assertEquals(SortOption("date", "Date"), display.selectedOption)
        assertTrue(display.hasOptions)
        assertFalse(display.isEmpty)
    }

    @Test
    fun projectFlagsDescendingDirection() {
        val display = SortControlProjection.project("distance", SortDirection.Desc, options, strings)

        assertFalse(display.isAscending)
        assertEquals("Descending", display.directionLabel)
        assertEquals("Sort direction: Descending", display.directionContentDescription)
        assertEquals(SortOption("distance", "Distance"), display.selectedOption)
    }

    // ── projection: empty (no options) — the control still renders, never a blank box ──────────────────────────
    @Test
    fun projectClassifiesEmptyWhenThereAreNoOptions() {
        val display = SortControlProjection.project("date", SortDirection.Asc, emptyList(), strings)

        assertFalse(display.hasOptions)
        assertTrue(display.isEmpty)
        assertEquals(emptyList<SelectOption>(), display.selectOptions)
        assertNull(display.selectedOption)
        // The direction half is unaffected by an empty option set — the toggle stays usable.
        assertEquals("Sort direction: Ascending", display.directionContentDescription)
    }

    // ── projection: unknown / cleared field ─────────────────────────────────────────────────────────────────────
    @Test
    fun projectLeavesSelectedOptionNullForAnUnknownField() {
        val display = SortControlProjection.project("not-a-field", SortDirection.Asc, options, strings)
        assertNull(display.selectedOption)
        assertTrue(display.hasOptions)
    }

    // ── i18n inventory (every web t(key) this surface makes) ────────────────────────────────────────────────────
    @Test
    fun keyInventoryIsCompleteUniqueAndPrefixed() {
        assertEquals(4, SortControlKeys.ALL.size)
        assertEquals(SortControlKeys.ALL.size, SortControlKeys.ALL.toSet().size)
        assertTrue(SortControlKeys.ALL.all { it.startsWith("sortControl.") })
        assertTrue(
            SortControlKeys.ALL.containsAll(
                listOf(
                    SortControlKeys.ASCENDING,
                    SortControlKeys.DESCENDING,
                    SortControlKeys.FIELD_LABEL,
                    SortControlKeys.DIRECTION,
                ),
            ),
        )
    }

    // ── telemetry (P1/S11) ──────────────────────────────────────────────────────────────────────────────────────
    @Test
    fun slugCarriesNoPii() {
        assertEquals("SortControl", SORT_CONTROL_SLUG)
        assertEquals("SortControl", SortControlDiagnostics.SLUG)
    }

    @Test
    fun recordViewOpenedEmitsSurfaceSlugOnly() {
        val logger = RecordingLogger()
        SortControlDiagnostics.recordViewOpened(logger)

        val opened = logger.events.single { it.first == "view.opened" }
        assertEquals(mapOf("surface" to "SortControl"), opened.second)
    }

    /** A [Logger] that records every emitted record, so tests can assert the diagnostics contract (P1/S11). */
    private class RecordingLogger : Logger {
        val events = mutableListOf<Pair<String, Map<String, String>>>()

        override fun log(
            level: LogLevel,
            event: String,
            fields: Map<String, String>,
        ) {
            events += event to fields
        }
    }
}
