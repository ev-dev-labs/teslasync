// Off-device unit coverage for the LiveControls feature view's pure model (P3 acceptance: adapter + per-state +
// a11y label tests). Exercises the window-option ladder that mirrors the web `WINDOW_OPTIONS`, the count fold
// adapter (web `windowCount ?? bufferCount ?? 0` / `totalCount ?? bufferCount ?? 0` + the `dual` flag and the
// @deprecated `bufferCount` fallback), the "outside the window" derivation (web `Math.max(0, total - inWindow)`),
// the dual-vs-single counter classifier (web `dual && outside > 0`), the empty-buffer test, the controlled
// window value mapping, the surface-state classifier the composable switches on (per-state coverage over the
// shared UiState lifecycle), the interactive accessible-name fold (a11y label coverage), the i18n
// resource-name constants, and the PII-safe `view.opened` surface slug. No Compose / Android / HTTP — runs in
// :android:testReleaseUnitTest. Reference values are the strings + behaviour the web component produces.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.featureviews.livecontrols

import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class LiveControlsModelTest {
    // ── registry + diagnostics slug (P1/S11) ─────────────────────────────────────

    @Test
    fun registrationCarriesStableIdAndPiiSafeSlug() {
        assertEquals("live-controls", LiveControlsRegistration.ID)
        // The slug emitted with `view.opened` is the surface name only — no VIN / fleet data.
        assertEquals("LiveControls", LiveControlsRegistration.SLUG)
    }

    // ── i18n keys map to catalog resource names (asserted by name; bytes not read off-device) ──

    @Test
    fun i18nKeysMatchCatalogResourceNames() {
        assertEquals("translation_debugger_controls_live", KEY_LIVE)
        assertEquals("translation_debugger_controls_freeze", KEY_FREEZE)
        assertEquals("translation_debugger_controls_stepPrev", KEY_STEP_PREV)
        assertEquals("translation_debugger_controls_stepNext", KEY_STEP_NEXT)
        assertEquals("translation_debugger_controls_window", KEY_WINDOW)
        assertEquals("translation_debugger_controls_clear", KEY_CLEAR)
        assertEquals("translation_debugger_controls_buffered", KEY_BUFFERED)
        assertEquals("translation_debugger_controls_bufferedDual", KEY_BUFFERED_DUAL)
        assertEquals("translation_debugger_controls_bufferedTooltip", KEY_BUFFERED_TOOLTIP)
        assertEquals("translation_debugger_window_minutes", KEY_WINDOW_MINUTES)
        assertEquals("translation_debugger_window_hours", KEY_WINDOW_HOURS)
        assertEquals("translation_debugger_timeline_empty", KEY_EMPTY)
    }

    // ── window ladder mirrors web WINDOW_OPTIONS ─────────────────────────────────

    @Test
    fun windowLadderMatchesWebOptionsInOrder() {
        assertEquals(
            listOf(LiveWindow.W5M, LiveWindow.W10M, LiveWindow.W30M, LiveWindow.W2H),
            WINDOW_OPTIONS,
        )
        assertEquals(listOf(5, 10, 30, 120), WINDOW_OPTIONS.map { it.minutes })
        assertEquals(listOf("5", "10", "30", "120"), WINDOW_OPTIONS.map { it.wire })
    }

    @Test
    fun windowHoursFoldMatchesWebLabels() {
        // Minutes-scale windows label as minutes (web "5 min"); the 2-hour slice labels in hours (web "2 h").
        assertFalse(LiveWindow.W30M.isHours)
        assertTrue(LiveWindow.W2H.isHours)
        assertEquals(2, LiveWindow.W2H.hours)
    }

    @Test
    fun windowLookupsRoundTripAndRejectOffLadder() {
        assertEquals(LiveWindow.W2H, LiveWindow.fromMinutes(120))
        assertNull(LiveWindow.fromMinutes(7))
        assertEquals(LiveWindow.W10M, LiveWindow.fromWire("10"))
        assertNull(LiveWindow.fromWire("nope"))
    }

    // ── count fold adapter mirrors the web ?? chain + dual flag ───────────────────

    @Test
    fun resolveCountsUsesScopedPropsAndSetsDual() {
        val counts = LiveControlsProjection.resolveCounts(windowCount = 12, totalCount = 47, bufferCount = null)
        assertEquals(12, counts.inWindow)
        assertEquals(47, counts.total)
        assertTrue(counts.dual)
    }

    @Test
    fun resolveCountsFallsBackToDeprecatedBufferCountWithoutDual() {
        // Only the @deprecated single-scope prop → both counts come from it, single-scope copy (dual = false).
        val counts = LiveControlsProjection.resolveCounts(windowCount = null, totalCount = null, bufferCount = 8)
        assertEquals(8, counts.inWindow)
        assertEquals(8, counts.total)
        assertFalse(counts.dual)
    }

    @Test
    fun resolveCountsMixesScopedWindowWithBufferTotalAndStaysDual() {
        // windowCount present (dual), total falls back to bufferCount — web `windowCount ?? bufferCount`.
        val counts = LiveControlsProjection.resolveCounts(windowCount = 5, totalCount = null, bufferCount = 20)
        assertEquals(5, counts.inWindow)
        assertEquals(20, counts.total)
        assertTrue(counts.dual)
    }

    @Test
    fun resolveCountsDefaultsToZeroWhenAllAbsent() {
        val counts = LiveControlsProjection.resolveCounts(windowCount = null, totalCount = null, bufferCount = null)
        assertEquals(0, counts.inWindow)
        assertEquals(0, counts.total)
        assertFalse(counts.dual)
    }

    @Test
    fun outsideCountClampsAtZero() {
        assertEquals(35, LiveControlsProjection.outsideCount(BufferCounts(inWindow = 12, total = 47, dual = true)))
        assertEquals(0, LiveControlsProjection.outsideCount(BufferCounts(inWindow = 8, total = 8, dual = false)))
        // total < inWindow can never go negative — web Math.max(0, …).
        assertEquals(0, LiveControlsProjection.outsideCount(BufferCounts(inWindow = 50, total = 30, dual = true)))
    }

    // ── counter style mirrors web `dual && outside > 0 ? bufferedDual : buffered` ─

    @Test
    fun counterStyleIsDualOnlyWhenScopedAndSomethingIsOutside() {
        assertEquals(
            CounterStyle.Dual,
            LiveControlsProjection.counterStyle(BufferCounts(inWindow = 12, total = 47, dual = true)),
        )
    }

    @Test
    fun counterStyleIsSingleWhenNothingOutsideEvenIfDual() {
        assertEquals(
            CounterStyle.Single,
            LiveControlsProjection.counterStyle(BufferCounts(inWindow = 9, total = 9, dual = true)),
        )
    }

    @Test
    fun counterStyleIsSingleForDeprecatedScalarBuffer() {
        assertEquals(
            CounterStyle.Single,
            LiveControlsProjection.counterStyle(BufferCounts(inWindow = 8, total = 8, dual = false)),
        )
    }

    // ── empty-buffer test (the always-visible empty hint trigger) ─────────────────

    @Test
    fun bufferIsEmptyOnlyWhenBothCountsZero() {
        assertTrue(LiveControlsProjection.isBufferEmpty(BufferCounts(inWindow = 0, total = 0, dual = false)))
        assertFalse(LiveControlsProjection.isBufferEmpty(BufferCounts(inWindow = 0, total = 5, dual = true)))
        assertFalse(LiveControlsProjection.isBufferEmpty(BufferCounts(inWindow = 3, total = 3, dual = false)))
    }

    // ── window select projection + controlled value mapping ───────────────────────

    @Test
    fun windowOptionsProjectEveryEntryThroughLabelResolver() {
        val options = LiveControlsProjection.windowOptions { "${it.minutes}!" }
        assertEquals(listOf("5", "10", "30", "120"), options.map { it.value })
        assertEquals(listOf("5!", "10!", "30!", "120!"), options.map { it.label })
    }

    @Test
    fun windowSelectedValueIsTheStringMinutes() {
        assertEquals("30", LiveControlsProjection.windowSelectedValue(30))
        // An off-ladder controlled value still round-trips as its string, mirroring web String(windowMinutes).
        assertEquals("7", LiveControlsProjection.windowSelectedValue(7))
    }

    @Test
    fun parseWindowSelectionReturnsMinutesOrNull() {
        assertEquals(30, LiveControlsProjection.parseWindowSelection("30"))
        assertNull(LiveControlsProjection.parseWindowSelection(""))
        assertNull(LiveControlsProjection.parseWindowSelection("abc"))
    }

    @Test
    fun streamModeMirrorsAriaPressedTarget() {
        assertEquals(StreamMode.Live, LiveControlsProjection.streamMode(isLive = true))
        assertEquals(StreamMode.Frozen, LiveControlsProjection.streamMode(isLive = false))
    }

    // ── per-state coverage over the shared UiState lifecycle (P1/S8) ──────────────

    @Test
    fun surfaceClassifierMapsRawFlags() {
        assertEquals(LiveControlsSurfaceState.Loading, liveControlsSurfaceFor(isLoading = true, isError = false))
        assertEquals(LiveControlsSurfaceState.Error, liveControlsSurfaceFor(isLoading = false, isError = true))
        assertEquals(LiveControlsSurfaceState.Ready, liveControlsSurfaceFor(isLoading = false, isError = false))
        // Loading wins over a concurrent error flag — web renders the skeleton first.
        assertEquals(LiveControlsSurfaceState.Loading, liveControlsSurfaceFor(isLoading = true, isError = true))
    }

    @Test
    fun surfaceClassifierMapsEveryUiStatePhase() {
        assertEquals(LiveControlsSurfaceState.Loading, surfaceFor(UiState.loading()))
        assertEquals(
            LiveControlsSurfaceState.Error,
            surfaceFor(UiState(phase = UiPhase.Error, errorKind = ErrorKind.Network)),
        )
        assertEquals(
            LiveControlsSurfaceState.Ready,
            surfaceFor(UiState(phase = UiPhase.Content, data = SAMPLE_COUNTS)),
        )
        // Empty is a Ready sub-state (controls always render, with the empty hint), not a hidden surface.
        assertEquals(
            LiveControlsSurfaceState.Ready,
            surfaceFor(UiState(phase = UiPhase.Empty, data = ZERO_COUNTS)),
        )
        // Offline = cached counts shown while stale + errored: still Ready (with a freshness chip), never blank.
        assertEquals(
            LiveControlsSurfaceState.Ready,
            surfaceFor(
                UiState(phase = UiPhase.Content, data = SAMPLE_COUNTS, stale = true, errorKind = ErrorKind.Network),
            ),
        )
    }

    // ── a11y: every interactive control has a non-blank accessible name ───────────

    @Test
    fun interactiveAccessibleNamesAreCompleteAndBlankFree() {
        val strings =
            LiveControlsStrings(
                live = "Live",
                freeze = "Freeze",
                stepPrev = "Step to previous transition",
                stepNext = "Step to next transition",
                window = "Window",
                clear = "Clear buffer",
                emptyHint = "No transitions in window",
            )
        val names = interactiveAccessibleNames(strings)
        // One name per interactive control, in render order (Live, Freeze, prev, next, Window, Clear).
        assertEquals(
            listOf(
                "Live",
                "Freeze",
                "Step to previous transition",
                "Step to next transition",
                "Window",
                "Clear buffer",
            ),
            names,
        )
        assertTrue(names.none { it.isBlank() })
    }

    private fun surfaceFor(state: UiState<BufferCounts>): LiveControlsSurfaceState =
        liveControlsSurfaceFor(isLoading = state.isLoading, isError = state.isError)

    private companion object {
        val SAMPLE_COUNTS = BufferCounts(inWindow = 12, total = 47, dual = true)
        val ZERO_COUNTS = BufferCounts(inWindow = 0, total = 0, dual = false)
    }
}
