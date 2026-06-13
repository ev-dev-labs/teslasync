// Off-device unit tests for the DatePresetChips model + projection (the :android:testReleaseUnitTest gate).
// These cover the framework-free core the composable renders: the faithful registry resolution ported from web
// (verified against web/src/lib/datePresets.test.ts's exact vectors, fixed clock 2026-05-15), the registry
// schema, lookup + match helpers, the every-state chip projection (content / empty / active highlight /
// registry-order / unknown-id filtering), the tap-time selection resolution, the i18n key folding + fallback
// parity that backs every accessible label, the group + chip a11y labels, and the PII-safe `view.opened`
// diagnostic. The composable is a thin render layer over these, so exercising them here is the surface's
// behavioral contract.
//
// `InvalidPackageDeclaration` is suppressed: the test mirrors the surface's mandated package, which (like the
// surface) cannot match its hyphenated directory.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.datepresetchips

import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.Logger
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.LocalDate

class DatePresetChipsModelTest {
    // Fixed reference: Friday 2026-05-15 (May = month 5, Q2 starts April). Mirrors the web test's `NOW`.
    private val now = LocalDate.of(2026, 5, 15)

    private fun preset(id: String): DatePreset = getDatePreset(id) ?: error("unknown preset: $id")

    private fun range(
        start: String,
        end: String,
    ) = DatePresetRange(start, end)

    // ── registry resolution (web `DATE_PRESETS — resolve()` vectors, verbatim) ────────────────────────────────

    @Test
    fun today_resolvesToTodayLocalDate() {
        assertEquals(range("2026-05-15", "2026-05-15"), preset("today").resolve(now))
    }

    @Test
    fun yesterday_resolvesToPriorDay() {
        assertEquals(range("2026-05-14", "2026-05-14"), preset("yesterday").resolve(now))
    }

    @Test
    fun last7_resolvesToInclusiveSevenDayWindow() {
        assertEquals(range("2026-05-09", "2026-05-15"), preset("7d").resolve(now))
    }

    @Test
    fun last30_resolvesToInclusiveThirtyDayWindow() {
        assertEquals(range("2026-04-16", "2026-05-15"), preset("30d").resolve(now))
    }

    @Test
    fun last90_resolvesToInclusiveNinetyDayWindow() {
        assertEquals(range("2026-02-15", "2026-05-15"), preset("90d").resolve(now))
    }

    @Test
    fun mtd_resolvesToFirstOfMonthThroughToday() {
        assertEquals(range("2026-05-01", "2026-05-15"), preset("mtd").resolve(now))
    }

    @Test
    fun qtd_resolvesToFirstOfQuarterThroughToday() {
        assertEquals(range("2026-04-01", "2026-05-15"), preset("qtd").resolve(now))
    }

    @Test
    fun qtd_resolvesQ1InFebruary() {
        assertEquals(range("2026-01-01", "2026-02-10"), preset("qtd").resolve(LocalDate.of(2026, 2, 10)))
    }

    @Test
    fun qtd_resolvesQ3InAugust() {
        assertEquals(range("2026-07-01", "2026-08-20"), preset("qtd").resolve(LocalDate.of(2026, 8, 20)))
    }

    @Test
    fun qtd_resolvesQ4InNovember() {
        assertEquals(range("2026-10-01", "2026-11-05"), preset("qtd").resolve(LocalDate.of(2026, 11, 5)))
    }

    @Test
    fun ytd_resolvesToJanFirstThroughToday() {
        assertEquals(range("2026-01-01", "2026-05-15"), preset("ytd").resolve(now))
    }

    @Test
    fun lastMonth_resolvesToFirstThroughLastDayOfPriorMonth() {
        assertEquals(range("2026-04-01", "2026-04-30"), preset("lastMonth").resolve(now))
    }

    @Test
    fun lastMonth_handlesYearRollover() {
        assertEquals(range("2025-12-01", "2025-12-31"), preset("lastMonth").resolve(LocalDate.of(2026, 1, 10)))
    }

    @Test
    fun lastMonth_handlesLeapFebruary() {
        assertEquals(range("2024-02-01", "2024-02-29"), preset("lastMonth").resolve(LocalDate.of(2024, 3, 5)))
    }

    @Test
    fun last1y_resolvesToOneCalendarYearBack() {
        assertEquals(range("2025-05-15", "2026-05-15"), preset("1y").resolve(now))
    }

    @Test
    fun all_resolvesToFixedBaselineThroughToday() {
        assertEquals(range("2015-01-01", "2026-05-15"), preset("all").resolve(now))
    }

    // ── registry schema (web `DATE_PRESETS — schema`) ─────────────────────────────────────────────────────────

    @Test
    fun everyPreset_hasUniqueId() {
        val ids = DATE_PRESETS.map { it.id }
        assertEquals(ids.size, ids.toSet().size)
    }

    @Test
    fun everyPreset_hasDatePresetI18nKeyAndNonBlankFallback() {
        DATE_PRESETS.forEach { preset ->
            assertTrue("i18nKey must start with date.preset.", preset.i18nKey.startsWith("date.preset."))
            assertTrue("fallback must be non-blank", preset.fallback.isNotBlank())
        }
    }

    @Test
    fun defaultPresetIds_onlyReferenceKnownIds() {
        val known = DATE_PRESETS.map { it.id }.toSet()
        DEFAULT_PRESET_IDS.forEach { id -> assertTrue("unknown default id: $id", id in known) }
    }

    @Test
    fun defaultPresetIds_matchWebDefaultSet() {
        assertEquals(listOf("today", "7d", "30d", "mtd", "ytd", "all"), DEFAULT_PRESET_IDS)
    }

    // ── lookup + match helpers (web `getDatePreset` / `matchPresetId` / `resolveAllTimeStart`) ─────────────────

    @Test
    fun getDatePreset_returnsPresetForKnownId() {
        assertEquals("today", getDatePreset("today")?.id)
        assertEquals("Month to date", getDatePreset("mtd")?.fallback)
    }

    @Test
    fun getDatePreset_returnsNullForUnknownId() {
        assertNull(getDatePreset("not-a-real-preset"))
    }

    @Test
    fun matchPresetId_returnsIdWhenRangeMatchesExactly() {
        assertEquals("today", matchPresetId("2026-05-15", "2026-05-15", now))
        assertEquals("7d", matchPresetId("2026-05-09", "2026-05-15", now))
        assertEquals("mtd", matchPresetId("2026-05-01", "2026-05-15", now))
        assertEquals("lastMonth", matchPresetId("2026-04-01", "2026-04-30", now))
        assertEquals("all", matchPresetId("2015-01-01", "2026-05-15", now))
    }

    @Test
    fun matchPresetId_returnsNullForArbitraryRange() {
        assertNull(matchPresetId("2026-03-07", "2026-04-12", now))
    }

    @Test
    fun resolveAllTimeStart_clampsToBaselineOrFirstDataPoint() {
        assertEquals("2015-01-01", resolveAllTimeStart(null))
        assertEquals("2015-01-01", resolveAllTimeStart("2010-06-01"))
        assertEquals("2024-03-09", resolveAllTimeStart("2024-03-09"))
    }

    // ── chip projection (every rendered state) ────────────────────────────────────────────────────────────────

    @Test
    fun project_defaultSetRendersSixContentChipsInRegistryOrder() {
        val display = projectDatePresetChips(DEFAULT_PRESET_IDS, activeId = null)
        assertEquals(DatePresetChipsPhase.Content, display.phase)
        assertFalse(display.isEmpty)
        assertEquals(listOf("today", "7d", "30d", "mtd", "ytd", "all"), display.chips.map { it.id })
        assertTrue("no chip active without activeId", display.chips.none { it.active })
    }

    @Test
    fun project_highlightsOnlyTheActivePreset() {
        val display = projectDatePresetChips(DEFAULT_PRESET_IDS, activeId = "30d")
        val active = display.chips.filter { it.active }
        assertEquals(listOf("30d"), active.map { it.id })
    }

    @Test
    fun project_emptyWhenNoPresetIds() {
        val display = projectDatePresetChips(emptyList(), activeId = null)
        assertEquals(DatePresetChipsPhase.Empty, display.phase)
        assertTrue(display.isEmpty)
        assertTrue(display.chips.isEmpty())
    }

    @Test
    fun project_emptyWhenAllIdsUnknown() {
        val display = projectDatePresetChips(listOf("bogus", "nope"), activeId = null)
        assertEquals(DatePresetChipsPhase.Empty, display.phase)
        assertTrue(display.chips.isEmpty())
    }

    @Test
    fun project_dropsUnknownIdsAndKeepsRegistryOrder() {
        val display = projectDatePresetChips(listOf("all", "bogus", "today"), activeId = null)
        // Order follows DATE_PRESETS (today before all), not the caller's presetIds order.
        assertEquals(listOf("today", "all"), display.chips.map { it.id })
    }

    @Test
    fun project_chipCarriesRegistryI18nKeyAndFallback() {
        val chip = projectDatePresetChips(listOf("mtd"), activeId = null).chips.single()
        assertEquals("date.preset.mtd", chip.i18nKey)
        assertEquals("Month to date", chip.fallback)
    }

    // ── tap-time selection resolution (web `onSelect({ id, start, end })`) ────────────────────────────────────

    @Test
    fun resolveSelection_returnsResolvedRangeForKnownId() {
        assertEquals(DatePresetSelection("7d", "2026-05-09", "2026-05-15"), resolveSelection("7d", now))
    }

    @Test
    fun resolveSelection_returnsNullForUnknownId() {
        assertNull(resolveSelection("bogus", now))
    }

    // ── i18n folding + fallback parity (backs every accessible label) ─────────────────────────────────────────

    @Test
    fun foldCatalogKey_matchesGeneratedResourceNames() {
        assertEquals("translation_date_preset_today", foldCatalogKey("date.preset.today"))
        assertEquals("translation_date_preset_last7", foldCatalogKey("date.preset.last7"))
        assertEquals("translation_date_preset_last1y", foldCatalogKey("date.preset.last1y"))
        assertEquals("translation_date_preset_lastMonth", foldCatalogKey("date.preset.lastMonth"))
        assertEquals("translation_date_preset_label", foldCatalogKey(DatePresetChipsRegistration.GROUP_LABEL_KEY))
        assertEquals("translation_common_noData", foldCatalogKey(DatePresetChipsRegistration.EMPTY_KEY))
    }

    @Test
    fun foldCatalogKey_coversEveryRegistryKey() {
        DATE_PRESETS.forEach { preset ->
            val folded = foldCatalogKey(preset.i18nKey)
            assertTrue("must be a translation_ resource name", folded.startsWith("translation_date_preset_"))
        }
    }

    @Test
    fun resolver_returnsLocalizedValueWhenPresentElseFallback() {
        val catalog = mapOf("date.preset.today" to "Hoy")
        val resolve: StringResolver = { key, fallback -> catalog[key] ?: fallback }
        assertEquals("Hoy", resolve("date.preset.today", "Today"))
        assertEquals("Last 7 days", resolve("date.preset.last7", "Last 7 days"))
    }

    // ── a11y labels (group aria-label + chip labels) ─────────────────────────────────────────────────────────

    @Test
    fun groupLabel_fallsBackToWebEnglish() {
        assertEquals("Quick date range", datePresetGroupLabel(FallbackResolver))
    }

    @Test
    fun groupLabel_prefersNonBlankOverride() {
        assertEquals("Signal window", datePresetGroupLabel(FallbackResolver, override = "Signal window"))
    }

    @Test
    fun groupLabel_ignoresBlankOverride() {
        assertEquals("Quick date range", datePresetGroupLabel(FallbackResolver, override = "  "))
    }

    @Test
    fun chipLabel_resolvesAndIsNonBlankForEveryDefaultChip() {
        val chips = projectDatePresetChips(DEFAULT_PRESET_IDS).chips
        chips.forEach { chip ->
            assertTrue("chip label must be non-blank", chipLabel(chip, FallbackResolver).isNotBlank())
        }
    }

    @Test
    fun chipLabel_usesLocalizedValueWhenResolverHasKey() {
        val resolve: StringResolver = { key, fallback -> if (key == "date.preset.today") "Hoy" else fallback }
        val today = projectDatePresetChips(listOf("today")).chips.single()
        assertEquals("Hoy", chipLabel(today, resolve))
    }

    // ── view.opened diagnostic (P1/S11) ──────────────────────────────────────────────────────────────────────

    @Test
    fun recordViewOpened_emitsSlugOnly() {
        val logger = RecordingLogger()
        recordDatePresetChipsViewOpened(logger)
        assertEquals(1, logger.events.size)
        val (event, fields) = logger.events.single()
        assertEquals("view.opened", event)
        assertEquals(mapOf("surface" to "DatePresetChips"), fields)
    }

    // ── fixtures ──────────────────────────────────────────────────────────────────────────────────────────────

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
