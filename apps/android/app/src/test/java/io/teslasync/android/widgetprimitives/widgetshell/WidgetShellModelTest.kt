package io.teslasync.android.widgetprimitives.widgetshell

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Off-device verification of the WidgetShell adapter — the native mirror of every layout decision the web source
 * makes (web/src/features/dashboard/widgets/WidgetShell.tsx) before Compose paints. Because the composable is a
 * thin render layer over [WidgetShellModel.project] + [WidgetShellModel.shouldPulse], these per-input assertions
 * double as the primitive's per-state snapshot: the loading / error / content precedence, the freshness derived
 * from either input mode (the fresh / fetching / stale / offline chip tiers), the help / pin gates, and the
 * pulse-on-change effect. Runs in the :android:testReleaseUnitTest gate.
 */
class WidgetShellModelTest {
    // ── phase precedence: loading wins over error wins over content (the web early-returns) ───────────────────

    @Test
    fun loadingWinsOverEverything() {
        val content =
            WidgetShellModel.project(
                WidgetShellSpec(title = "Battery", loading = true, error = "boom"),
            )
        assertEquals(WidgetShellPhase.Loading, content.phase)
    }

    @Test
    fun errorWinsOverContent() {
        val content = WidgetShellModel.project(WidgetShellSpec(title = "Battery", error = "boom"))
        assertEquals(WidgetShellPhase.Error, content.phase)
    }

    @Test
    fun contentIsTheDefaultBranch() {
        val content = WidgetShellModel.project(WidgetShellSpec(title = "Battery"))
        assertEquals(WidgetShellPhase.Content, content.phase)
    }

    @Test
    fun emptyErrorStringIsNotAnErrorButWhitespaceIs() {
        // Web `if (error)` — JS string truthiness: "" is falsy, " " is truthy.
        assertEquals(WidgetShellPhase.Content, WidgetShellModel.project(WidgetShellSpec(error = "")).phase)
        assertEquals(WidgetShellPhase.Error, WidgetShellModel.project(WidgetShellSpec(error = " ")).phase)
        assertEquals(WidgetShellPhase.Content, WidgetShellModel.project(WidgetShellSpec(error = null)).phase)
    }

    // ── title normalization: blank collapses to null so a stray empty prop never reserves the header ──────────

    @Test
    fun blankTitleNormalizesToNull() {
        assertNull(WidgetShellModel.project(WidgetShellSpec(title = "   ")).title)
        assertNull(WidgetShellModel.project(WidgetShellSpec(title = "")).title)
    }

    @Test
    fun titleIsTrimmed() {
        assertEquals("Battery Health", WidgetShellModel.project(WidgetShellSpec(title = "  Battery Health  ")).title)
    }

    // ── freshness (granular mode): web updatedAt path, > 0 normalized, compact = !title ───────────────────────

    @Test
    fun granularFreshnessNormalizesTimestampAndCarriesFlags() {
        val content =
            WidgetShellModel.project(
                WidgetShellSpec(
                    title = "Battery",
                    updatedAtMillis = 1_700_000_000_000L,
                    isFetching = true,
                    isStale = false,
                    isError = false,
                ),
            )
        val fresh = requireFreshness(content)
        assertEquals(1_700_000_000_000L, fresh.updatedAtMillis)
        assertTrue(fresh.isFetching)
        // Compact is false when a title is present (the relative-time text shows in the header).
        assertFalse(fresh.compact)
    }

    @Test
    fun granularUpdatedAtZeroBecomesNeverUpdated() {
        val fresh = requireFreshness(WidgetShellModel.project(WidgetShellSpec(title = "Battery", updatedAtMillis = 0L)))
        assertNull(fresh.updatedAtMillis)
    }

    @Test
    fun titlelessFreshnessIsCompact() {
        val fresh = requireFreshness(WidgetShellModel.project(WidgetShellSpec(updatedAtMillis = 5L)))
        assertTrue(fresh.compact)
    }

    @Test
    fun offlineFreshnessIsTheErrorTier() {
        val fresh =
            requireFreshness(
                WidgetShellModel.project(WidgetShellSpec(title = "Battery", updatedAtMillis = 5L, isError = true)),
            )
        assertTrue(fresh.isError)
    }

    // ── freshness (query mode): web DataFreshnessAuto path, used only when granular is absent ──────────────────

    @Test
    fun queryFreshnessIsUsedWhenGranularIsAbsent() {
        val content =
            WidgetShellModel.project(
                WidgetShellSpec(
                    title = "Battery",
                    query = WidgetShellFreshnessQuery(dataUpdatedAtMillis = 9L, isStale = true),
                ),
            )
        val fresh = requireFreshness(content)
        assertEquals(9L, fresh.updatedAtMillis)
        assertTrue(fresh.isStale)
    }

    @Test
    fun granularModeWinsOverQueryWhenBothSupplied() {
        val content =
            WidgetShellModel.project(
                WidgetShellSpec(
                    title = "Battery",
                    updatedAtMillis = 100L,
                    isFetching = true,
                    query = WidgetShellFreshnessQuery(dataUpdatedAtMillis = 999L, isError = true),
                ),
            )
        val fresh = requireFreshness(content)
        assertEquals(100L, fresh.updatedAtMillis)
        assertTrue(fresh.isFetching)
        assertFalse(fresh.isError)
    }

    @Test
    fun noFreshnessWhenNeitherModeSupplied() {
        assertNull(WidgetShellModel.project(WidgetShellSpec(title = "Battery")).freshness)
    }

    // ── help + pin gates mirror the web truthiness checks ─────────────────────────────────────────────────────

    @Test
    fun helpShowsOnlyWithATitle() {
        assertTrue(WidgetShellModel.project(WidgetShellSpec(title = "Battery", hasHelp = true)).showHelp)
        // web `help && title`: no title ⇒ no "?" even when help is supplied.
        assertFalse(WidgetShellModel.project(WidgetShellSpec(hasHelp = true)).showHelp)
        assertFalse(WidgetShellModel.project(WidgetShellSpec(title = "Battery", hasHelp = false)).showHelp)
    }

    @Test
    fun pinShowsOnlyWhenWidgetAndDashboardAreBothPresent() {
        assertTrue(
            WidgetShellModel.project(WidgetShellSpec(widgetId = "w1", dashboardId = "d1")).showPin,
        )
        assertFalse(WidgetShellModel.project(WidgetShellSpec(widgetId = "w1")).showPin)
        assertFalse(WidgetShellModel.project(WidgetShellSpec(dashboardId = "d1")).showPin)
        assertFalse(WidgetShellModel.project(WidgetShellSpec(widgetId = "", dashboardId = "d1")).showPin)
    }

    // ── effective updatedAt (pulse watch value): web `updatedAt ?? query?.dataUpdatedAt`, raw (pre-normalize) ──

    @Test
    fun effectiveUpdatedAtPrefersGranularThenQuery() {
        assertEquals(7L, WidgetShellModel.project(WidgetShellSpec(updatedAtMillis = 7L)).effectiveUpdatedAtMillis)
        val queryMode =
            WidgetShellModel.project(
                WidgetShellSpec(query = WidgetShellFreshnessQuery(dataUpdatedAtMillis = 3L)),
            )
        assertEquals(3L, queryMode.effectiveUpdatedAtMillis)
        // Raw value, before the > 0 normalization — 0 is still observed by the pulse watcher.
        assertEquals(0L, WidgetShellModel.project(WidgetShellSpec(updatedAtMillis = 0L)).effectiveUpdatedAtMillis)
        assertNull(WidgetShellModel.project(WidgetShellSpec(title = "Battery")).effectiveUpdatedAtMillis)
    }

    // ── pulse condition: only a NEW positive value after a prior observation flashes ──────────────────────────

    @Test
    fun shouldPulseOnlyWhenTimestampMovesToANewPositiveValue() {
        assertTrue(WidgetShellModel.shouldPulse(previousMillis = 100L, currentMillis = 200L))
        // first observation (no previous) never flashes — web `prevUpdatedAt.current !== undefined`.
        assertFalse(WidgetShellModel.shouldPulse(previousMillis = null, currentMillis = 200L))
        // unchanged value does not flash.
        assertFalse(WidgetShellModel.shouldPulse(previousMillis = 200L, currentMillis = 200L))
        // a never-fetched (null) or zero current never flashes.
        assertFalse(WidgetShellModel.shouldPulse(previousMillis = 100L, currentMillis = null))
        assertFalse(WidgetShellModel.shouldPulse(previousMillis = 100L, currentMillis = 0L))
    }

    // ── defaults + registry pin the web parity knobs ──────────────────────────────────────────────────────────

    @Test
    fun defaultsAndRegistryMatchTheContract() {
        assertEquals(1_500L, WidgetShellDefaults.PULSE_HOLD_MS)
        assertEquals("WidgetShell", WidgetShellRegistration.SLUG)
        assertEquals("widget-shell", WidgetShellRegistration.ID)
    }

    private fun requireFreshness(content: WidgetShellContent): WidgetShellFreshnessState =
        requireNotNull(content.freshness) { "expected a freshness chip" }
}
