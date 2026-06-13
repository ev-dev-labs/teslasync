package io.teslasync.android.sharedsurfaces.inlinecallout

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Off-device verification of the InlineCallout's pure logic — the native mirror of every decision the web
 * component makes (web/src/components/feedback/InlineCallout.tsx): the `variant` selection, the prop-driven render
 * branches (icon / body / action), the three-way container switch the action selects (link / button / status,
 * the web `<a>` / `<button>` / `<div role="status">`), the empty-body fallback that keeps the surface from ever
 * painting a blank box, and the merged TalkBack announcement. Because the composable is a thin render layer over
 * [classify] / [resolveInteraction], the per-branch assertions here double as the surface's per-state snapshot.
 * Runs in the :app:testReleaseUnitTest gate.
 */
class InlineCalloutModelTest {
    // ── variant taxonomy (web `CalloutVariant` union) ────────────────────────────────────────────────

    @Test
    fun variantFromWireParsesEveryKnownVariant() {
        assertEquals(CalloutVariant.Info, variantFromWire("info"))
        assertEquals(CalloutVariant.Success, variantFromWire("success"))
        assertEquals(CalloutVariant.Warning, variantFromWire("warning"))
        assertEquals(CalloutVariant.Danger, variantFromWire("danger"))
    }

    @Test
    fun variantFromWireFallsBackToInfoForUnknownOrAbsent() {
        // A forward-compatible client renders the lowest-severity informational treatment for anything new.
        assertEquals(CalloutVariant.Info, variantFromWire(null))
        assertEquals(CalloutVariant.Info, variantFromWire(""))
        assertEquals(CalloutVariant.Info, variantFromWire("critical"))
        assertEquals(CalloutVariant.Info, variantFromWire("Success")) // case-sensitive, like the web union
    }

    // ── classify: the per-state snapshot (variant × prop branches) ───────────────────────────────────

    @Test
    fun classifyPassesEverySeverityVariantThrough() {
        CalloutVariant.entries.forEach { variant ->
            val render = classify(InlineCalloutInput(variant = variant, message = "Insight"))
            assertEquals(variant, render.variant)
        }
    }

    @Test
    fun classifyShowsBodyForAMessageOrASlot() {
        assertTrue("a message is a body", classify(InlineCalloutInput(message = "Body")).showBody)
        assertTrue("a slot is a body", classify(InlineCalloutInput(message = null, hasSlotContent = true)).showBody)
    }

    @Test
    fun classifyFlagsAnEmptyBodyForTheFallbackInsteadOfABlankBox() {
        val empty = classify(InlineCalloutInput(message = null, hasSlotContent = false))
        assertFalse(empty.showBody)
        assertTrue("never a blank box — the view shows the localized caption", empty.showEmptyFallback)

        val blankMessage = classify(InlineCalloutInput(message = "   ", hasSlotContent = false))
        assertFalse("a blank message is not a body", blankMessage.showBody)
        assertTrue(blankMessage.showEmptyFallback)
    }

    @Test
    fun classifyMirrorsTheIconAffordance() {
        assertTrue(classify(InlineCalloutInput(hasIcon = true)).showIcon)
        assertFalse(classify(InlineCalloutInput(hasIcon = false)).showIcon)
    }

    @Test
    fun classifyShowsTheActionOnlyForANonBlankLabel() {
        assertTrue(classify(InlineCalloutInput(actionLabel = "Apr 24", hasActivation = true)).showAction)
        assertFalse(classify(InlineCalloutInput(actionLabel = null)).showAction)
        assertFalse(classify(InlineCalloutInput(actionLabel = "   ")).showAction)
    }

    // ── the three-way container switch (web `<a>` / `<button>` / `<div role="status">`) ───────────────

    @Test
    fun classifySelectsTheLinkContainerForAnHrefAction() {
        // web `action.href` truthy ⇒ <a href> (native: an activation flagged as a link).
        val render = classify(InlineCalloutInput(actionLabel = "Open", hasActivation = true, isLink = true))
        assertEquals(CalloutInteraction.Link, render.interaction)
    }

    @Test
    fun classifySelectsTheButtonContainerForAnOnClickAction() {
        // web `action.onClick` truthy (no href) ⇒ <button>.
        val render = classify(InlineCalloutInput(actionLabel = "View", hasActivation = true, isLink = false))
        assertEquals(CalloutInteraction.Button, render.interaction)
    }

    @Test
    fun classifyFallsBackToStatusWithoutAnActionOrHandler() {
        // No action at all ⇒ <div role="status">.
        assertEquals(CalloutInteraction.Status, classify(InlineCalloutInput(message = "Body")).interaction)
        // The degenerate web action that carries a label but neither href nor onClick is non-interactive too.
        assertEquals(
            CalloutInteraction.Status,
            classify(InlineCalloutInput(actionLabel = "Dead", hasActivation = false)).interaction,
        )
    }

    @Test
    fun resolveInteractionHonorsTheHrefBeatsOnClickPrecedence() {
        assertEquals(CalloutInteraction.Status, resolveInteraction(null))
        assertEquals(CalloutInteraction.Status, resolveInteraction(InlineCalloutAction(label = "X", onActivate = null)))
        assertEquals(
            CalloutInteraction.Button,
            resolveInteraction(InlineCalloutAction(label = "X", onActivate = {}, isLink = false)),
        )
        assertEquals(
            CalloutInteraction.Link,
            resolveInteraction(InlineCalloutAction(label = "X", onActivate = {}, isLink = true)),
        )
    }

    // ── accessibility label (merged TalkBack announcement) ───────────────────────────────────────────

    @Test
    fun accessibilityLabelMergesBodyAndAction() {
        assertEquals(
            "1 anomaly in this range. Apr 24",
            calloutAccessibilityLabel("1 anomaly in this range", "Apr 24", EMPTY_FALLBACK),
        )
    }

    @Test
    fun accessibilityLabelSkipsTheMissingPart() {
        assertEquals("Body only", calloutAccessibilityLabel("Body only", null, EMPTY_FALLBACK))
        assertEquals("Body only", calloutAccessibilityLabel("Body only", "   ", EMPTY_FALLBACK))
    }

    @Test
    fun accessibilityLabelAnnouncesTheFallbackWhenTheBodyIsBlank() {
        // The region is never silent — an empty callout still announces the localized fallback.
        assertEquals(EMPTY_FALLBACK, calloutAccessibilityLabel(null, null, EMPTY_FALLBACK))
        assertEquals(EMPTY_FALLBACK, calloutAccessibilityLabel("  ", null, EMPTY_FALLBACK))
        // …and still appends a present affordance so the action is reachable from the announcement.
        assertEquals("$EMPTY_FALLBACK. More", calloutAccessibilityLabel("  ", "More", EMPTY_FALLBACK))
    }

    // ── helpers ──────────────────────────────────────────────────────────────────────────────────────

    private companion object {
        private const val EMPTY_FALLBACK = "No data available"
    }
}
