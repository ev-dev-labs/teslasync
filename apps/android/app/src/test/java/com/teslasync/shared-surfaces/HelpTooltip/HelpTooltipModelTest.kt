// Off-device unit coverage for the HelpTooltip surface's pure model (P3 acceptance: adapter + per-state +
// a11y-label/diagnostics tests). Exercises the registration slug + test tags, the web i18n keys and i18next
// default fallbacks the prompt mandates, the size + placement projections, the content-resolution precedence
// that mirrors the web `i18nKey ? t(i18nKey, {defaultValue}) : text` (including the empty → `return null`
// branch), the "Learn more" label fallback, the four-placement popup geometry (with RTL mirroring and window
// clamping), the link-open outcome, and the PII-safe diagnostics. No Compose / Android framework / HTTP — runs
// in :android:testReleaseUnitTest. Reference values are the strings + behaviour the web source
// (web/src/components/ui/HelpTooltip.tsx) produces.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.helptooltip

import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.LogRecord
import io.teslasync.shared.core.diagnostics.Logger
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class HelpTooltipModelTest {
    private class RecordingLogger : Logger {
        val records = mutableListOf<LogRecord>()

        override fun log(
            level: LogLevel,
            event: String,
            fields: Map<String, String>,
        ) {
            records += LogRecord(level, event, fields)
        }
    }

    // ── registration metadata mirrors the prompt-mandated surface slug ──────────────────────────────────

    @Test
    fun registrationSlugIsThePromptSurfaceSlug() {
        assertEquals("help-tooltip", HelpTooltipRegistration.ID)
        assertEquals("HelpTooltip", HelpTooltipRegistration.SLUG)
        assertEquals("help-tooltip-trigger", HelpTooltipRegistration.TRIGGER_TEST_TAG)
        assertEquals("help-tooltip-learn-more", HelpTooltipRegistration.LEARN_MORE_TEST_TAG)
    }

    // ── the web i18n keys + i18next default fallbacks the surface resolves at the render boundary ─────────

    @Test
    fun i18nKeysAndFallbacksMirrorTheWebSource() {
        assertEquals("help.tooltip.iconLabel", ICON_LABEL_KEY)
        assertEquals("More info", ICON_LABEL_FALLBACK)
        assertEquals("common.learnMore", LEARN_MORE_KEY)
        assertEquals("Learn more", LEARN_MORE_FALLBACK)
    }

    // ── size: xs / sm / md with the web SIZE_CLASS pixel dimensions, default sm ───────────────────────────

    @Test
    fun sizeCarriesTheWebPixelDimensionsInOrder() {
        assertEquals(listOf(HelpTooltipSize.Xs, HelpTooltipSize.Sm, HelpTooltipSize.Md), HelpTooltipSize.entries.toList())
        assertEquals(12, HelpTooltipSize.Xs.iconDp)
        assertEquals(14, HelpTooltipSize.Sm.iconDp)
        assertEquals(16, HelpTooltipSize.Md.iconDp)
    }

    // ── placement: four sides, RTL mirrors left/right and leaves top/bottom alone ─────────────────────────

    @Test
    fun placementCoversAllFourSides() {
        assertEquals(
            listOf(
                HelpTooltipPlacement.Top,
                HelpTooltipPlacement.Bottom,
                HelpTooltipPlacement.Left,
                HelpTooltipPlacement.Right,
            ),
            HelpTooltipPlacement.entries.toList(),
        )
    }

    @Test
    fun physicalPlacementPassesThroughUnderLtr() {
        HelpTooltipPlacement.entries.forEach { side ->
            assertEquals(side, resolvePhysicalPlacement(side, isRtl = false))
        }
    }

    @Test
    fun physicalPlacementMirrorsLeftRightUnderRtl() {
        assertEquals(HelpTooltipPlacement.Right, resolvePhysicalPlacement(HelpTooltipPlacement.Left, isRtl = true))
        assertEquals(HelpTooltipPlacement.Left, resolvePhysicalPlacement(HelpTooltipPlacement.Right, isRtl = true))
        // Top / bottom are unaffected by reading direction.
        assertEquals(HelpTooltipPlacement.Top, resolvePhysicalPlacement(HelpTooltipPlacement.Top, isRtl = true))
        assertEquals(HelpTooltipPlacement.Bottom, resolvePhysicalPlacement(HelpTooltipPlacement.Bottom, isRtl = true))
    }

    // ── content resolution: web `i18nKey ? t(i18nKey, {defaultValue}) : text` ─────────────────────────────

    @Test
    fun resolveBodyUsesTextWhenNoKeyIsSupplied() {
        assertEquals("Vampire drain", resolveHelpBody("Vampire drain", null, null, null))
    }

    @Test
    fun resolveBodyPrefersTheCatalogValueWhenTheKeyResolves() {
        assertEquals(
            "Energy lost while parked",
            resolveHelpBody(null, "help.vampireDrain", "fallback", "Energy lost while parked"),
        )
    }

    @Test
    fun resolveBodyFallsBackToDefaultWhenTheKeyIsCatalogAbsent() {
        assertEquals("fallback copy", resolveHelpBody(null, "help.missing", "fallback copy", null))
    }

    @Test
    fun resolveBodyIsEmptyWhenKeyIsAbsentAndNoDefault() {
        assertEquals("", resolveHelpBody(null, "help.missing", null, null))
    }

    @Test
    fun resolveBodyIsEmptyWhenNothingIsSupplied() {
        assertEquals("", resolveHelpBody(null, null, null, null))
    }

    @Test
    fun hasContentMatchesJavaScriptTruthiness() {
        // Web `if (!resolved)` — empty string is falsy, a non-empty (even whitespace) string is truthy.
        assertFalse(hasHelpContent(""))
        assertTrue(hasHelpContent(" "))
        assertTrue(hasHelpContent("Some help"))
    }

    // ── learn-more label: web `learnMore.label ?? t('common.learnMore')` ──────────────────────────────────

    @Test
    fun learnMoreLabelPrefersTheCustomLabel() {
        assertEquals("Read the docs", resolveLearnMoreLabel("Read the docs", "Learn more"))
    }

    @Test
    fun learnMoreLabelFallsBackWhenNoCustomLabel() {
        assertEquals("Learn more", resolveLearnMoreLabel(null, "Learn more"))
    }

    @Test
    fun learnMoreHolderDefaultsToNoCustomLabel() {
        val link = HelpTooltipLearnMore("https://docs.example/vampire-drain")
        assertEquals("https://docs.example/vampire-drain", link.url)
        assertNull(link.label)
    }

    // ── placement geometry: top / bottom / left / right, gap, RTL mirror, window clamp ────────────────────

    private fun offset(
        placement: HelpTooltipPlacement,
        isRtl: Boolean = false,
    ): HelpTooltipOffset =
        helpTooltipPopupOffset(
            placement = placement,
            anchorLeft = 100,
            anchorTop = 200,
            anchorWidth = 40,
            anchorHeight = 40,
            popupWidth = 120,
            popupHeight = 60,
            windowWidth = 1000,
            windowHeight = 2000,
            gap = 8,
            isRtl = isRtl,
        )

    @Test
    fun topPlacementCentresAboveTheAnchorWithGap() {
        // centerX 120 − popupW/2 60 = 60 ; anchorTop 200 − popupH 60 − gap 8 = 132.
        assertEquals(HelpTooltipOffset(60, 132), offset(HelpTooltipPlacement.Top))
    }

    @Test
    fun bottomPlacementCentresBelowTheAnchorWithGap() {
        // centerX 60 ; anchorBottom 240 + gap 8 = 248.
        assertEquals(HelpTooltipOffset(60, 248), offset(HelpTooltipPlacement.Bottom))
    }

    @Test
    fun rightPlacementSitsToTheRightCentredVertically() {
        // anchorRight 140 + gap 8 = 148 ; centerY 220 − popupH/2 30 = 190.
        assertEquals(HelpTooltipOffset(148, 190), offset(HelpTooltipPlacement.Right))
    }

    @Test
    fun leftPlacementClampsIntoTheWindowWhenItWouldSpillOffScreen() {
        // anchorLeft 100 − popupW 120 − gap 8 = −28 → clamped to 0 ; centerY 190.
        assertEquals(HelpTooltipOffset(0, 190), offset(HelpTooltipPlacement.Left))
    }

    @Test
    fun rtlMirrorsLeftAndRightPlacement() {
        // Under RTL a "left" request resolves to the physical right, and vice versa.
        assertEquals(offset(HelpTooltipPlacement.Right), offset(HelpTooltipPlacement.Left, isRtl = true))
        assertEquals(offset(HelpTooltipPlacement.Left), offset(HelpTooltipPlacement.Right, isRtl = true))
    }

    @Test
    fun horizontalOverflowIsClampedToTheWindowRightEdge() {
        // Anchor near the right edge: centerX 1000 − popupW/2 60 = 940, clamped to windowW 1000 − popupW 120 = 880.
        val result =
            helpTooltipPopupOffset(
                placement = HelpTooltipPlacement.Top,
                anchorLeft = 980,
                anchorTop = 500,
                anchorWidth = 40,
                anchorHeight = 40,
                popupWidth = 120,
                popupHeight = 60,
                windowWidth = 1000,
                windowHeight = 2000,
                gap = 8,
                isRtl = false,
            )
        assertEquals(880, result.x)
    }

    @Test
    fun verticalOverflowIsClampedToTheTopEdge() {
        // Top placement against a near-top anchor would go negative; it is clamped to 0.
        val result =
            helpTooltipPopupOffset(
                placement = HelpTooltipPlacement.Top,
                anchorLeft = 100,
                anchorTop = 10,
                anchorWidth = 40,
                anchorHeight = 40,
                popupWidth = 120,
                popupHeight = 60,
                windowWidth = 1000,
                windowHeight = 2000,
                gap = 8,
                isRtl = false,
            )
        assertEquals(0, result.y)
    }

    // ── link outcome ──────────────────────────────────────────────────────────────────────────────────────

    @Test
    fun linkOutcomeReflectsWhetherTheOpenSucceeded() {
        assertEquals(LinkOutcome.Opened, linkOutcomeFor(succeeded = true))
        assertEquals(LinkOutcome.Failed, linkOutcomeFor(succeeded = false))
    }

    @Test
    fun linkOutcomeWireNamesAreStableAndPiiFree() {
        assertEquals("opened", LinkOutcome.Opened.wireName)
        assertEquals("failed", LinkOutcome.Failed.wireName)
    }

    // ── diagnostics: one PII-safe view.opened (slug only) ─────────────────────────────────────────────────

    @Test
    fun recordViewOpenedEmitsPiiSafeSurfaceSlug() {
        val logger = RecordingLogger()
        HelpTooltipDiagnostics.recordViewOpened(logger)
        assertEquals(1, logger.records.size)
        assertEquals(LogLevel.Info, logger.records[0].level)
        assertEquals("view.opened", logger.records[0].event)
        // Only the surface slug — no body copy, label, or URL can leak through the diagnostic.
        assertEquals(mapOf("surface" to "HelpTooltip"), logger.records[0].fields)
    }

    // ── diagnostics: link open carries the slug + coarse outcome only, never the URL ──────────────────────

    @Test
    fun recordLearnMoreEmitsSlugAndOutcomeWithoutTheUrl() {
        val logger = RecordingLogger()
        HelpTooltipDiagnostics.recordLearnMore(logger, LinkOutcome.Opened)
        val record = logger.records.single { it.event == "helpTooltip.learnMore" }
        assertEquals(LogLevel.Info, record.level)
        assertEquals(mapOf("surface" to "HelpTooltip", "outcome" to "opened"), record.fields)
    }

    @Test
    fun recordLearnMoreDistinguishesTheFailedOutcome() {
        val logger = RecordingLogger()
        HelpTooltipDiagnostics.recordLearnMore(logger, LinkOutcome.Failed)
        val record = logger.records.single { it.event == "helpTooltip.learnMore" }
        assertEquals("failed", record.fields["outcome"])
        // The link diagnostic only ever carries the two fixed structured keys — never the opened URL.
        assertEquals(setOf("surface", "outcome"), record.fields.keys)
    }
}
