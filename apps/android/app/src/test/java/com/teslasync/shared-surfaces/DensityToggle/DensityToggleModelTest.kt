// Off-device verification of the DensityToggle surface's pure logic — the native mirror of every decision the web
// component makes (web/src/components/forms/DensityToggle.tsx): the option projection (label + selected flag +
// group name), the ArrowLeft/ArrowRight cyclic commit, the `t(key, default)` resolver, the i18n key inventory,
// the density id round-trip, and the PII-safe diagnostics slug. Because the composable is a thin render layer
// over DensityToggleModel, the per-branch assertions here double as the surface's per-state snapshot. No Compose /
// Android framework / HTTP — runs in the :android:testReleaseUnitTest gate; the on-device render + accessibility
// live in DensityToggleUiTest.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/shared-surfaces/DensityToggle) cannot form a valid Kotlin package.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.densitytoggle

import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.LogRecord
import io.teslasync.shared.core.diagnostics.Logger
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class DensityToggleModelTest {
    private val strings =
        DensityToggleStrings(
            table = "Table",
            compact = "Compact",
            comfortable = "Comfortable",
            groupLabel = "List density",
            noOptions = "No density options",
        )

    // ── registration slug mirrors the prompt-mandated surface slug ──────────────────

    @Test
    fun slugIsThePromptSurfaceSlug() {
        assertEquals("DensityToggle", DENSITY_TOGGLE_SLUG)
        assertEquals(DENSITY_TOGGLE_SLUG, DensityToggleDiagnostics.SLUG)
        assertEquals(DENSITY_TOGGLE_SLUG, DensityToggleRegistration.SLUG)
        assertEquals("density-toggle", DensityToggleRegistration.ID)
    }

    // ── density id round-trip (web string union members 'table' / 'compact' / 'comfortable') ──

    @Test
    fun densityIdsMatchTheWebStringUnion() {
        assertEquals("table", Density.Table.id)
        assertEquals("compact", Density.Compact.id)
        assertEquals("comfortable", Density.Comfortable.id)
    }

    @Test
    fun fromIdRoundTripsEveryDensityAndRejectsUnknown() {
        Density.entries.forEach { density ->
            assertEquals(density, Density.fromId(density.id))
        }
        assertNull(Density.fromId("spacious"))
        assertNull(Density.fromId(""))
    }

    @Test
    fun defaultOptionsAreTheCanonicalWebOrder() {
        assertEquals(listOf(Density.Table, Density.Compact, Density.Comfortable), DEFAULT_DENSITY_OPTIONS)
    }

    // ── projection: content branch (web `options.map`) ──────────────────────────────

    @Test
    fun projectBuildsAnOptionPerDensityInOrderWithTheSelectedFlag() {
        val render = DensityToggleProjection.project(Density.Compact, DEFAULT_DENSITY_OPTIONS, strings)
        assertEquals(listOf(Density.Table, Density.Compact, Density.Comfortable), render.options.map { it.density })
        assertEquals(listOf("Table", "Compact", "Comfortable"), render.options.map { it.label })
        assertEquals(listOf(false, true, false), render.options.map { it.selected })
        assertEquals(Density.Compact, render.selected)
        assertTrue(render.hasOptions)
        assertFalse(render.isEmpty)
    }

    @Test
    fun projectHonoursACallerSubsetOfOptions() {
        val subset = listOf(Density.Compact, Density.Comfortable)
        val render = DensityToggleProjection.project(Density.Comfortable, subset, strings)
        assertEquals(subset, render.options.map { it.density })
        assertEquals(Density.Comfortable, render.selected)
    }

    @Test
    fun projectLeavesSelectedNullWhenTheValueIsNotAmongTheOptions() {
        val render = DensityToggleProjection.project(Density.Table, listOf(Density.Compact, Density.Comfortable), strings)
        assertNull(render.selected)
        // Every option is unselected, but the control still renders (never hidden).
        assertTrue(render.options.none { it.selected })
        assertTrue(render.hasOptions)
    }

    // ── projection: empty branch (web empty `options` array) ────────────────────────

    @Test
    fun projectFlagsEmptyWhenNoOptions() {
        val render = DensityToggleProjection.project(Density.Table, emptyList(), strings)
        assertTrue(render.isEmpty)
        assertFalse(render.hasOptions)
        assertTrue(render.options.isEmpty())
        assertNull(render.selected)
    }

    // ── projection: group accessible name (web `ariaLabel ?? t('density.groupLabel', …)`) ──

    @Test
    fun projectUsesTheLocalizedGroupLabelByDefault() {
        val render = DensityToggleProjection.project(Density.Table, DEFAULT_DENSITY_OPTIONS, strings)
        assertEquals("List density", render.groupLabel)
    }

    @Test
    fun projectPrefersANonBlankAriaLabelOverride() {
        val render = DensityToggleProjection.project(Density.Table, DEFAULT_DENSITY_OPTIONS, strings, ariaLabel = "Row size")
        assertEquals("Row size", render.groupLabel)
    }

    @Test
    fun projectIgnoresABlankAriaLabelOverride() {
        val render = DensityToggleProjection.project(Density.Table, DEFAULT_DENSITY_OPTIONS, strings, ariaLabel = "   ")
        assertEquals("List density", render.groupLabel)
    }

    // ── strings label selector (web `labelMap[opt]`) ────────────────────────────────

    @Test
    fun labelSelectorMapsEveryDensityToItsLocalizedLabel() {
        assertEquals("Table", strings.label(Density.Table))
        assertEquals("Compact", strings.label(Density.Compact))
        assertEquals("Comfortable", strings.label(Density.Comfortable))
    }

    // ── keyboard cycling (web `onKeyDown` ArrowLeft / ArrowRight) ────────────────────

    @Test
    fun arrowRightMovesToTheNextOptionAndWrapsCyclically() {
        val options = DEFAULT_DENSITY_OPTIONS
        assertEquals(Density.Compact, DensityToggleKeyboard.next(options, Density.Table, DensityToggleKey.ArrowRight))
        assertEquals(Density.Comfortable, DensityToggleKeyboard.next(options, Density.Compact, DensityToggleKey.ArrowRight))
        // Wrap from the last option back to the first.
        assertEquals(Density.Table, DensityToggleKeyboard.next(options, Density.Comfortable, DensityToggleKey.ArrowRight))
    }

    @Test
    fun arrowLeftMovesToThePreviousOptionAndWrapsCyclically() {
        val options = DEFAULT_DENSITY_OPTIONS
        assertEquals(Density.Comfortable, DensityToggleKeyboard.next(options, Density.Table, DensityToggleKey.ArrowLeft))
        assertEquals(Density.Table, DensityToggleKeyboard.next(options, Density.Compact, DensityToggleKey.ArrowLeft))
        assertEquals(Density.Compact, DensityToggleKeyboard.next(options, Density.Comfortable, DensityToggleKey.ArrowLeft))
    }

    @Test
    fun keyboardReturnsNullWhenTheCurrentValueIsNotAmongTheOptions() {
        // Web `const idx = options.indexOf(value); if (idx < 0) return;`
        val options = listOf(Density.Compact, Density.Comfortable)
        assertNull(DensityToggleKeyboard.next(options, Density.Table, DensityToggleKey.ArrowRight))
        assertNull(DensityToggleKeyboard.next(options, Density.Table, DensityToggleKey.ArrowLeft))
    }

    @Test
    fun keyboardReturnsNullForAnEmptyOptionSet() {
        assertNull(DensityToggleKeyboard.next(emptyList(), Density.Table, DensityToggleKey.ArrowRight))
    }

    @Test
    fun keyboardWrapsWithinASingleOptionToItself() {
        val single = listOf(Density.Compact)
        assertEquals(Density.Compact, DensityToggleKeyboard.next(single, Density.Compact, DensityToggleKey.ArrowRight))
        assertEquals(Density.Compact, DensityToggleKeyboard.next(single, Density.Compact, DensityToggleKey.ArrowLeft))
    }

    // ── resolveOptional (web `t(key, default)`) ─────────────────────────────────────

    @Test
    fun resolveOptionalReturnsTheCatalogValueWhenPresent() {
        val resolved = resolveOptional({ "Tableau" }, KEY_DENSITY_TABLE, DensityToggleDefaults.TABLE)
        assertEquals("Tableau", resolved)
    }

    @Test
    fun resolveOptionalFallsBackWhenAbsentOrBlank() {
        assertEquals(DensityToggleDefaults.COMPACT, resolveOptional({ null }, KEY_DENSITY_COMPACT, DensityToggleDefaults.COMPACT))
        assertEquals(DensityToggleDefaults.COMPACT, resolveOptional({ "  " }, KEY_DENSITY_COMPACT, DensityToggleDefaults.COMPACT))
    }

    @Test
    fun defaultsAreTheEnglishFallbacks() {
        assertEquals("Table", DensityToggleDefaults.TABLE)
        assertEquals("Compact", DensityToggleDefaults.COMPACT)
        assertEquals("Comfortable", DensityToggleDefaults.COMFORTABLE)
        assertEquals("List density", DensityToggleDefaults.GROUP_LABEL)
    }

    // ── i18n key inventory (every web `t()` key) ────────────────────────────────────

    @Test
    fun keysAreTheDottedWebKeysAndComplete() {
        assertEquals(listOf("density.table", "density.compact", "density.comfortable", "density.groupLabel"), DensityToggleKeys.ALL)
        // No duplicates — each web key appears exactly once.
        assertEquals(DensityToggleKeys.ALL.size, DensityToggleKeys.ALL.toSet().size)
    }

    @Test
    fun resourceNamesFollowTheTranslationNamingScheme() {
        assertEquals("translation_density_table", KEY_DENSITY_TABLE)
        assertEquals("translation_density_compact", KEY_DENSITY_COMPACT)
        assertEquals("translation_density_comfortable", KEY_DENSITY_COMFORTABLE)
        assertEquals("translation_density_groupLabel", KEY_DENSITY_GROUP_LABEL)
        assertEquals("translation_density_noOptions", KEY_DENSITY_NO_OPTIONS)
    }

    // ── diagnostics: one PII-safe view.opened (P1/S11) ──────────────────────────────

    @Test
    fun recordViewOpenedEmitsPiiSafeSurfaceSlug() {
        val records = mutableListOf<LogRecord>()
        val logger =
            object : Logger {
                override fun log(
                    level: LogLevel,
                    event: String,
                    fields: Map<String, String>,
                ) {
                    records += LogRecord(level, event, fields)
                }
            }
        DensityToggleDiagnostics.recordViewOpened(logger)
        assertEquals(1, records.size)
        assertEquals(LogLevel.Info, records[0].level)
        assertEquals("view.opened", records[0].event)
        // Only the surface slug — the selected density can never leak through the diagnostic.
        assertEquals(mapOf("surface" to "DensityToggle"), records[0].fields)
    }
}
