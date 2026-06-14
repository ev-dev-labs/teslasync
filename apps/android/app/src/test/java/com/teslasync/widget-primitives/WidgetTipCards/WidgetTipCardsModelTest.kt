// Off-device unit coverage for the WidgetTipCards primitive's pure model (P3 acceptance: adapter +
// per-state + diagnostics pieces). Exercises the registration slug the prompt mandates, the limit/slice
// math (web `tips.slice(0, maxTips ?? (compact ? 1 : 3))`), both projection branches (empty / cards), the
// impact → badge-variant mapping (web `impactBadgeMap`), the badge-text fallback (web `impactLabel ??
// impact`), and the PII-safe `view.opened` diagnostic. No Compose / Android framework / HTTP — runs in
// :android:testReleaseUnitTest. Reference values are the behaviour the web `WidgetTipCards` produces.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.widgetprimitives.widgettipcards

import io.teslasync.android.components.ui.BadgeVariant
import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.LogRecord
import io.teslasync.shared.core.diagnostics.Logger
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class WidgetTipCardsModelTest {
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

    private fun tip(
        id: String,
        title: String = "title-$id",
        description: String = "description-$id",
        impact: TipImpact? = null,
        impactLabel: String? = null,
    ): TipCardData =
        TipCardData(
            id = id,
            title = title,
            description = description,
            impact = impact,
            impactLabel = impactLabel,
        )

    private fun cardsOf(
        tips: List<TipCardData>,
        maxTips: Int? = null,
        compact: Boolean = false,
    ): List<TipCardData> {
        val projection = WidgetTipCardsProjection.project(tips, maxTips, compact)
        return (projection as WidgetTipCardsProjection.Cards).cards
    }

    // ── registration metadata mirrors the prompt-mandated surface slug ────────────────

    @Test
    fun registrationSlugIsThePromptSurfaceSlug() {
        assertEquals("widget-tip-cards", WidgetTipCardsRegistration.ID)
        assertEquals("WidgetTipCards", WidgetTipCardsRegistration.SLUG)
    }

    // ── resolveLimit (web maxTips ?? (compact ? 1 : 3)) ───────────────────────────────

    @Test
    fun resolveLimitDefaultsToThreeWhenNotCompact() {
        assertEquals(3, WidgetTipCardsLayout.resolveLimit(maxTips = null, compact = false))
    }

    @Test
    fun resolveLimitDefaultsToOneWhenCompact() {
        assertEquals(1, WidgetTipCardsLayout.resolveLimit(maxTips = null, compact = true))
    }

    @Test
    fun resolveLimitHonoursAnExplicitMaxOverCompact() {
        // web `maxTips ?? …` — an explicit cap wins even in compact mode.
        assertEquals(5, WidgetTipCardsLayout.resolveLimit(maxTips = 5, compact = true))
    }

    @Test
    fun resolveLimitClampsNegativeToZero() {
        assertEquals(0, WidgetTipCardsLayout.resolveLimit(maxTips = -3, compact = false))
    }

    // ── visible slice (web tips.slice(0, limit)) ──────────────────────────────────────

    @Test
    fun visibleKeepsFirstThreeByDefault() {
        val tips = listOf("a", "b", "c", "d", "e")
        assertEquals(listOf("a", "b", "c"), WidgetTipCardsLayout.visible(tips, maxTips = null, compact = false))
    }

    @Test
    fun visibleKeepsFirstOneWhenCompact() {
        val tips = listOf("a", "b", "c")
        assertEquals(listOf("a"), WidgetTipCardsLayout.visible(tips, maxTips = null, compact = true))
    }

    @Test
    fun visibleHonoursExplicitMaxTips() {
        val tips = listOf("a", "b", "c", "d")
        assertEquals(listOf("a", "b"), WidgetTipCardsLayout.visible(tips, maxTips = 2, compact = false))
    }

    @Test
    fun visibleKeepsAllWhenFewerThanLimit() {
        val tips = listOf("a")
        assertEquals(listOf("a"), WidgetTipCardsLayout.visible(tips, maxTips = null, compact = false))
    }

    @Test
    fun visibleWithZeroMaxTipsIsEmpty() {
        val tips = listOf("a", "b")
        assertTrue(WidgetTipCardsLayout.visible(tips, maxTips = 0, compact = false).isEmpty())
    }

    // ── projection: empty branch (web visible.length === 0) ───────────────────────────

    @Test
    fun emptyTipsProjectTheEmptyBranch() {
        assertEquals(WidgetTipCardsProjection.Empty, WidgetTipCardsProjection.project(emptyList()))
    }

    @Test
    fun zeroMaxTipsProjectsTheEmptyBranchEvenWithTips() {
        // web `tips.slice(0, 0)` → empty → empty branch.
        val projection = WidgetTipCardsProjection.project(listOf(tip("1")), maxTips = 0)
        assertEquals(WidgetTipCardsProjection.Empty, projection)
    }

    // ── projection: cards branch + compact slice ──────────────────────────────────────

    @Test
    fun nonEmptyTipsProjectAllCardsInOrder() {
        val cards = cardsOf(listOf(tip("1"), tip("2"), tip("3")))
        assertEquals(listOf("1", "2", "3"), cards.map { it.id })
    }

    @Test
    fun compactKeepsOnlyTheFirstCard() {
        val cards = cardsOf(listOf(tip("1"), tip("2"), tip("3")), compact = true)
        assertEquals(listOf("1"), cards.map { it.id })
    }

    @Test
    fun maxTipsCapsTheProjectedCards() {
        val cards = cardsOf(listOf(tip("1"), tip("2"), tip("3"), tip("4")), maxTips = 2)
        assertEquals(listOf("1", "2"), cards.map { it.id })
    }

    // ── TipImpact → badge variant (web impactBadgeMap) ────────────────────────────────

    @Test
    fun highImpactMapsToSuccessBadge() {
        assertEquals(BadgeVariant.Success, TipImpact.High.badgeVariant)
    }

    @Test
    fun mediumImpactMapsToWarningBadge() {
        assertEquals(BadgeVariant.Warning, TipImpact.Medium.badgeVariant)
    }

    @Test
    fun lowImpactMapsToNeutralBadge() {
        assertEquals(BadgeVariant.Neutral, TipImpact.Low.badgeVariant)
    }

    @Test
    fun impactWireTokensRoundTrip() {
        assertEquals(listOf("high", "medium", "low"), TipImpact.entries.map { it.wireValue })
        assertEquals(TipImpact.High, TipImpact.fromWire("high"))
        assertEquals(TipImpact.Medium, TipImpact.fromWire("medium"))
        assertEquals(TipImpact.Low, TipImpact.fromWire("low"))
        assertNull(TipImpact.fromWire("urgent"))
        assertNull(TipImpact.fromWire(null))
    }

    // ── TipCardData badge text/variant (web tip.impact && impactLabel ?? impact) ───────

    @Test
    fun badgeTextPrefersTheLocalizedImpactLabel() {
        val data = tip("1", impact = TipImpact.High, impactLabel = "Recommendation")
        assertEquals("Recommendation", data.badgeText)
        assertEquals(BadgeVariant.Success, data.badgeVariant)
    }

    @Test
    fun badgeTextFallsBackToTheImpactWireToken() {
        // web `tip.impactLabel ?? tip.impact` — no label supplied, fall back to the stable discriminator.
        val data = tip("1", impact = TipImpact.Medium, impactLabel = null)
        assertEquals("medium", data.badgeText)
        assertEquals(BadgeVariant.Warning, data.badgeVariant)
    }

    @Test
    fun noImpactHidesTheBadgeEntirely() {
        // web renders the badge only when `tip.impact` is set.
        val data = tip("1", impact = null, impactLabel = "ignored")
        assertNull(data.badgeText)
        assertNull(data.badgeVariant)
    }

    // ── diagnostics: PII-safe view.opened ─────────────────────────────────────────────

    @Test
    fun recordViewOpenedEmitsSlugOnlyDiagnostic() {
        val logger = RecordingLogger()
        WidgetTipCardsDiagnostics.recordViewOpened(logger)
        val record = logger.records.single { it.event == "view.opened" }
        assertEquals(LogLevel.Info, record.level)
        assertEquals(mapOf("surface" to "WidgetTipCards"), record.fields)
    }

    @Test
    fun viewOpenedDiagnosticNeverLeaksTipContent() {
        val logger = RecordingLogger()
        WidgetTipCardsDiagnostics.recordViewOpened(logger)
        val leaked =
            logger.records
                .flatMap { it.fields.values }
                .any { it.contains("title") || it.contains("description") || it.contains("high") }
        assertFalse(leaked)
        assertTrue(logger.records.isNotEmpty())
    }
}
