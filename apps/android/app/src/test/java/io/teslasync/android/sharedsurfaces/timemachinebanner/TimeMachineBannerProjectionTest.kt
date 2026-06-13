// Off-device verification of the TimeMachineBanner pure model — the native mirror of every decision the web
// component makes (web/src/components/feedback/TimeMachineBanner.tsx) before it renders, plus the `useAsOfDate`
// `looksLikeIso` guard and the `localInputToRfc3339` / `formatDateTime` helpers. Because the composable is a thin
// render layer over [TimeMachineBannerProjection] + [TimeMachineTime], the per-branch assertions here double as
// the surface's state "snapshot": the dormant live state, the prompt state, the viewing state, the picker-open
// state, and the submit-disabled-until-drafted branch. Runs in the :android:testReleaseUnitTest gate.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.timemachinebanner

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.OffsetDateTime
import java.time.ZoneOffset
import java.util.Locale

class TimeMachineBannerProjectionTest {
    private fun render(
        asOf: String?,
        pickerOpen: Boolean = false,
        draft: String? = null,
    ): TimeMachineBannerRender = TimeMachineBannerProjection.render(TimeMachineBannerInput(asOf, pickerOpen, draft))

    // ── empty / dormant: live mode with the picker closed renders nothing (web early `return null`) ───────────

    @Test
    fun liveModeWithClosedPickerIsDormant() {
        val r = render(asOf = null, pickerOpen = false)
        assertFalse("live + closed picker contributes no layout", r.visible)
        assertFalse(r.viewing)
        assertFalse(r.showReturnToLive)
        assertFalse(r.showPicker)
    }

    // ── prompt: picker opened with no anchor — visible, no return-to-live yet ─────────────────────────────────

    @Test
    fun promptStateIsVisibleWithoutReturnToLive() {
        val r = render(asOf = null, pickerOpen = true, draft = "2024-11-11T12:00")
        assertTrue("an opened picker is visible even without an anchor", r.visible)
        assertFalse("there is no live anchor to return from yet", r.viewing)
        assertFalse(r.showReturnToLive)
        assertTrue(r.showPicker)
        assertTrue("a non-blank draft enables submit", r.submitEnabled)
    }

    @Test
    fun promptStateWithoutADraftDisablesSubmit() {
        val r = render(asOf = null, pickerOpen = true, draft = null)
        assertTrue(r.visible)
        assertFalse("submit is disabled until a draft is entered (web disabled={!draft})", r.submitEnabled)
    }

    // ── viewing: an anchor is set — visible, return-to-live shown, picker closed ──────────────────────────────

    @Test
    fun viewingStateShowsReturnToLiveWithPickerClosed() {
        val r = render(asOf = "2024-11-12T14:30:00Z", pickerOpen = false)
        assertTrue(r.visible)
        assertTrue("an anchor is set", r.viewing)
        assertTrue("return-to-live is offered while viewing history", r.showReturnToLive)
        assertFalse(r.showPicker)
    }

    @Test
    fun viewingStateWithPickerOpenShowsBoth() {
        val r = render(asOf = "2024-11-12T14:30:00Z", pickerOpen = true, draft = "2024-11-12T14:30")
        assertTrue(r.visible)
        assertTrue(r.viewing)
        assertTrue(r.showReturnToLive)
        assertTrue(r.showPicker)
        assertTrue(r.submitEnabled)
    }

    // ── TimeMachineTime.looksLikeIso: the web `useAsOfDate` RFC 3339 sniff ────────────────────────────────────

    @Test
    fun looksLikeIsoAcceptsWellFormedInstants() {
        assertTrue(TimeMachineTime.looksLikeIso("2024-11-12T14:30:00Z"))
        assertTrue("seconds are optional", TimeMachineTime.looksLikeIso("2024-11-12T14:30Z"))
        assertTrue("fractional seconds allowed", TimeMachineTime.looksLikeIso("2024-11-12T14:30:00.250Z"))
        assertTrue("numeric offset allowed", TimeMachineTime.looksLikeIso("2024-11-12T14:30:00+02:00"))
    }

    @Test
    fun looksLikeIsoRejectsGarbageAndImpossibleDates() {
        assertFalse(TimeMachineTime.looksLikeIso(""))
        assertFalse(TimeMachineTime.looksLikeIso("yesterday"))
        assertFalse("a zoneless local value is not a wire instant", TimeMachineTime.looksLikeIso("2024-11-12T14:30"))
        assertFalse("Feb 31 is rejected by the parse pass", TimeMachineTime.looksLikeIso("2024-02-31T00:00:00Z"))
    }

    // ── TimeMachineTime.localInputToIso: web `localInputToRfc3339` ────────────────────────────────────────────

    @Test
    fun localInputToIsoConvertsADatetimeLocalToAUtcInstant() {
        assertEquals("2024-11-12T14:30:00Z", TimeMachineTime.localInputToIso("2024-11-12T14:30", ZoneOffset.UTC))
    }

    @Test
    fun localInputToIsoReturnsNullForBlankOrMalformed() {
        assertNull(TimeMachineTime.localInputToIso("", ZoneOffset.UTC))
        assertNull(TimeMachineTime.localInputToIso("not-a-date", ZoneOffset.UTC))
    }

    @Test
    fun localInputToIsoOutputAlwaysPassesTheIsoSniff() {
        val iso = TimeMachineTime.localInputToIso("2024-11-12T14:30", ZoneOffset.UTC)
        assertTrue("the wire value the picker emits is always a valid RFC 3339 instant", TimeMachineTime.looksLikeIso(iso!!))
    }

    // ── TimeMachineTime.seedLocalInput: the web command-palette `onOpen` seed ─────────────────────────────────

    @Test
    fun seedUsesTheCurrentAnchorWhenSet() {
        val seed = TimeMachineTime.seedLocalInput("2024-11-12T14:30:00Z", nowMillisAt("2024-06-01T00:00:00Z"), ZoneOffset.UTC)
        assertEquals("2024-11-12T14:30", seed)
    }

    @Test
    fun seedFallsBackToYesterdayNoonWhenLive() {
        val seed = TimeMachineTime.seedLocalInput(null, nowMillisAt("2024-11-12T08:00:00Z"), ZoneOffset.UTC)
        assertEquals("2024-11-11T12:00", seed)
    }

    // ── TimeMachineTime.displayLabel + formatAsOfDisplay: the field text + title interpolation ────────────────

    @Test
    fun displayLabelFormatsADraftAndFallsBackWhenEmpty() {
        assertEquals("2024-11-12 14:30", TimeMachineTime.displayLabel("2024-11-12T14:30", "—"))
        assertEquals("—", TimeMachineTime.displayLabel("", "—"))
    }

    @Test
    fun formatAsOfDisplayRendersTheAnchorAndFallsBackOnGarbage() {
        val shown = TimeMachineTime.formatAsOfDisplay("2024-11-12T14:30:00Z", ZoneOffset.UTC, Locale.US)
        assertTrue("a parseable anchor renders a friendly, populated label", shown.contains("2024"))
        val fallback = TimeMachineTime.formatAsOfDisplay("garbage", ZoneOffset.UTC, Locale.US)
        assertEquals("an unparseable value falls back to the raw string, never blank", "garbage", fallback)
    }

    // ── bannerAccessibilityLabel: the merged TalkBack announcement ────────────────────────────────────────────

    @Test
    fun accessibilityLabelMergesTitleAndBody() {
        assertEquals("Viewing data as of X. Read-only.", bannerAccessibilityLabel("Viewing data as of X", "Read-only."))
        assertEquals("only the non-blank part remains", "Heading", bannerAccessibilityLabel("Heading", ""))
        assertEquals("", bannerAccessibilityLabel("", ""))
    }

    private fun nowMillisAt(iso: String): Long = OffsetDateTime.parse(iso).toInstant().toEpochMilli()
}
