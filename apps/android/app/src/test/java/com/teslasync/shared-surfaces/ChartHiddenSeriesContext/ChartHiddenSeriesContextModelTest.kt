// Off-device unit coverage for the ChartHiddenSeriesContext surface's pure model (P3 acceptance: adapter +
// per-state + diagnostics). Exercises the registration slug + id the prompt mandates, the `hidden_{chartKey}`
// param-name builder (web `useHiddenSeries` HIDDEN_PARAM_PREFIX), the parse/serialize round-trip that mirrors
// `useUrlArray` (blank-dropping, canonical alphabetical sort), the toggle reducer (web `toggle`), the projected
// [HiddenSeriesState] (`isHidden`, value-based equality ignoring the action callbacks), and the PII-safe
// `view.opened` diagnostic — asserting it never carries a chart id or hidden series key. No Compose / Android
// framework / HTTP — runs in :android:testReleaseUnitTest. Reference values are the strings + behaviour the web
// hook produces.
//
// The surface is an anonymous context bridge with no interactive elements, so there is no a11y label to assert
// (the same rationale the accepted VisuallyHidden sibling documents); the diagnostics PII-safety test stands in
// as the security-equivalent guarantee that the plumbing leaks nothing about the user's chart configuration.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.charthiddenseriescontext

import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.LogRecord
import io.teslasync.shared.core.diagnostics.Logger
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class ChartHiddenSeriesContextModelTest {
    // ── registration metadata mirrors the prompt-mandated surface slug + id ───────────

    @Test
    fun slugIsThePromptSurfaceSlug() {
        assertEquals("ChartHiddenSeriesContext", ChartHiddenSeriesRegistration.SLUG)
        assertEquals("chart-hidden-series", ChartHiddenSeriesRegistration.ID)
    }

    // ── param name (web `useHiddenSeries` `${HIDDEN_PARAM_PREFIX}${chartKey}`) ─────────

    @Test
    fun hiddenParamNameMirrorsWebPrefix() {
        assertEquals("hidden_", HIDDEN_PARAM_PREFIX)
        assertEquals(",", HIDDEN_SERIES_DELIMITER)
        assertEquals("hidden_battery-degradation-trend", hiddenParamName("battery-degradation-trend"))
    }

    // ── parse (web `new Set(arr)` over `useUrlArray` parse) ───────────────────────────

    @Test
    fun parseBuildsSetFromStoredList() {
        assertEquals(setOf("health", "projected"), parseHiddenSeries(listOf("health", "projected")))
    }

    @Test
    fun parseDropsBlankEntriesAndDeduplicates() {
        // A stray delimiter must never yield a phantom "" series (web guards `raw === '' ? []`).
        assertEquals(emptySet<String>(), parseHiddenSeries(listOf("")))
        assertEquals(emptySet<String>(), parseHiddenSeries(emptyList()))
        assertEquals(setOf("health"), parseHiddenSeries(listOf("health", "health")))
        assertEquals(setOf("health"), parseHiddenSeries(listOf("", "health", "")))
    }

    // ── serialize (web toggle's `Array.from(next).sort()` — canonical order) ───────────

    @Test
    fun serializeIsAlphabeticalSoUrlsAreCanonical() {
        assertEquals(listOf("health", "projected"), serializeHiddenSeries(setOf("projected", "health")))
        // Toggling A then B yields the same stored value as B then A — a plain equality check on links.
        assertEquals(serializeHiddenSeries(setOf("a", "b")), serializeHiddenSeries(setOf("b", "a")))
    }

    @Test
    fun serializeEmptySetDropsTheParam() {
        // An empty list is the store's "drop the param" signal (web `omitDefault`).
        assertEquals(emptyList<String>(), serializeHiddenSeries(emptySet()))
    }

    // ── toggle reducer (web `next.has(key) ? delete : add`) ───────────────────────────

    @Test
    fun toggleAddsWhenAbsentAndRemovesWhenPresent() {
        assertEquals(setOf("health"), toggleHiddenSeries(emptySet(), "health"))
        assertEquals(emptySet<String>(), toggleHiddenSeries(setOf("health"), "health"))
        assertEquals(setOf("a", "b"), toggleHiddenSeries(setOf("a"), "b"))
    }

    @Test
    fun toggleRoundTripReturnsToStart() {
        val start = setOf("health")
        assertEquals(start, toggleHiddenSeries(toggleHiddenSeries(start, "projected"), "projected"))
    }

    @Test
    fun toggleOrderProducesIdenticalCanonicalUrl() {
        val ab = serializeHiddenSeries(toggleHiddenSeries(toggleHiddenSeries(emptySet(), "a"), "b"))
        val ba = serializeHiddenSeries(toggleHiddenSeries(toggleHiddenSeries(emptySet(), "b"), "a"))
        assertEquals(ab, ba)
        assertEquals(listOf("a", "b"), ab)
    }

    // ── projected state (web `HiddenSeriesState` value) ───────────────────────────────

    @Test
    fun isHiddenReflectsTheHiddenSet() {
        val state = HiddenSeriesState(chartKey = "trend", hidden = setOf("projected"))
        assertTrue(state.isHidden("projected"))
        assertFalse(state.isHidden("health"))
    }

    @Test
    fun stateEqualityIsValueBasedAndIgnoresActions() {
        // Two states with the same data but different action callbacks are equal, so recomposition is
        // driven purely by the hidden set changing — not by a fresh lambda each projection.
        val a = HiddenSeriesState("trend", setOf("projected"), toggle = {}, reset = {})
        val b = HiddenSeriesState("trend", setOf("projected"), toggle = { error("never") }, reset = {})
        assertEquals(a, b)
        assertEquals(a.hashCode(), b.hashCode())
        assertNotEquals(a, HiddenSeriesState("trend", setOf("health")))
        assertNotEquals(a, HiddenSeriesState("other", setOf("projected")))
    }

    // ── diagnostics: one PII-safe view.opened that leaks no chart id / series key ──────

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
        recordChartHiddenSeriesOpened(logger)
        assertEquals(1, records.size)
        assertEquals(LogLevel.Info, records[0].level)
        assertEquals("view.opened", records[0].event)
        // Only the surface slug — no chart id or hidden series key can leak through the diagnostic.
        assertEquals(mapOf("surface" to "ChartHiddenSeriesContext"), records[0].fields)
    }
}
