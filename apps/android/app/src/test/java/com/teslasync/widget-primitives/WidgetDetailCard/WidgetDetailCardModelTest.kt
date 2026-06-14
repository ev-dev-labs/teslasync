// Off-device verification of the WidgetDetailCard surface's pure logic — the native mirror of every decision the
// web component makes (web/src/features/dashboard/widgets/shared/WidgetDetailCard.tsx): the empty-vs-populated
// classification, the compact cap, the null-value em-dash fallback, the per-row divider rule, the
// `badgeVariantMap` port, the merged a11y description, the `t(key, default)` resolver, and the PII-safe
// diagnostics slug. Because the composable is a thin render layer over WidgetDetailCardModel, the per-branch
// assertions here double as the surface's per-state snapshot. No Compose / Android framework / HTTP — runs in
// the :app:testReleaseUnitTest gate; the on-device render + accessibility live in WidgetDetailCardUiTest.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/widget-primitives/WidgetDetailCard) cannot form a valid Kotlin package.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.widgetprimitives.widgetdetailcard

import io.teslasync.android.components.ui.BadgeVariant
import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.LogRecord
import io.teslasync.shared.core.diagnostics.Logger
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class WidgetDetailCardModelTest {
    // ── slug mirrors the prompt-mandated surface slug ───────────────────────────────

    @Test
    fun slugIsThePromptSurfaceSlug() {
        assertEquals("WidgetDetailCard", WIDGET_DETAIL_CARD_SLUG)
        assertEquals(WIDGET_DETAIL_CARD_SLUG, WidgetDetailCardDiagnostics.SLUG)
    }

    // ── value resolution (web `entry.value ?? '—'`) ─────────────────────────────────

    @Test
    fun nullValueResolvesToEmDash() {
        assertEquals("\u2014", EM_DASH)
        assertEquals(EM_DASH, resolveDetailValue(null))
    }

    @Test
    fun nonNullValueIsShownVerbatimIncludingZeroAndBlank() {
        // Web coerces `number` (including 0) to a string and only `null` becomes the em dash.
        assertEquals("0", resolveDetailValue("0"))
        assertEquals("", resolveDetailValue(""))
        assertEquals("247 mi", resolveDetailValue("247 mi"))
    }

    // ── compact cap (web `compact ? entries.slice(0, 4) : entries`) ─────────────────

    @Test
    fun compactLimitIsFour() {
        assertEquals(4, COMPACT_ROW_LIMIT)
    }

    @Test
    fun compactShowsAtMostTheFirstFourEntries() {
        val entries = (1..6).map { DetailEntry(label = "L$it", value = "V$it") }
        val visible = visibleDetailEntries(entries, compact = true)
        assertEquals(4, visible.size)
        assertEquals(listOf("L1", "L2", "L3", "L4"), visible.map { it.label })
    }

    @Test
    fun nonCompactShowsEveryEntry() {
        val entries = (1..6).map { DetailEntry(label = "L$it", value = "V$it") }
        assertEquals(6, visibleDetailEntries(entries, compact = false).size)
    }

    @Test
    fun compactIsSafeWhenFewerThanTheCapExist() {
        val entries = listOf(DetailEntry("A", "1"), DetailEntry("B", "2"))
        assertEquals(2, visibleDetailEntries(entries, compact = true).size)
    }

    // ── classifier: empty vs populated, divider rule, carried-through slots ─────────

    @Test
    fun emptyEntriesFlagTheEmptyStateWithNoRows() {
        // The prompt's "empty → friendly empty state, never a blank box" contract.
        val render = projectWidgetDetailCard(emptyList(), compact = false)
        assertTrue(render.isEmpty)
        assertTrue(render.rows.isEmpty())
    }

    @Test
    fun populatedEntriesProduceRowsInOrder() {
        val render = projectWidgetDetailCard(listOf(DetailEntry("A", "1"), DetailEntry("B", "2")), compact = false)
        assertFalse(render.isEmpty)
        assertEquals(listOf("A", "B"), render.rows.map { it.label })
        assertEquals(listOf("1", "2"), render.rows.map { it.value })
    }

    @Test
    fun rowCarriesBadgeAndMonoAndResolvedValue() {
        val badge = DetailBadge("Healthy", DetailBadgeVariant.Success)
        val render =
            projectWidgetDetailCard(
                listOf(
                    DetailEntry(label = "VIN", value = null, badge = badge, mono = true),
                ),
                compact = false,
            )
        val row = render.rows.single()
        assertEquals("VIN", row.label)
        assertEquals(EM_DASH, row.value)
        assertEquals(badge, row.badge)
        assertTrue(row.mono)
    }

    @Test
    fun dividerIsDrawnUnderEveryRowButTheLast() {
        // Web `i < visible.length - 1 && 'border-b …'`.
        val render = projectWidgetDetailCard((1..3).map { DetailEntry("L$it", "V$it") }, compact = false)
        assertEquals(listOf(true, true, false), render.rows.map { it.showDivider })
    }

    @Test
    fun aSingleRowHasNoDivider() {
        val render = projectWidgetDetailCard(listOf(DetailEntry("only", "1")), compact = false)
        assertFalse(render.rows.single().showDivider)
    }

    @Test
    fun compactClassificationCapsRowsAndStillFlagsTheLastDivider() {
        val entries = (1..6).map { DetailEntry("L$it", "V$it") }
        val render = projectWidgetDetailCard(entries, compact = true)
        assertEquals(4, render.rows.size)
        assertEquals(listOf(true, true, true, false), render.rows.map { it.showDivider })
    }

    // ── badge variant map (web `badgeVariantMap`) ───────────────────────────────────

    @Test
    fun badgeVariantMapMatchesTheWebSource() {
        assertEquals(BadgeVariant.Success, badgeVariantFor(DetailBadgeVariant.Success))
        assertEquals(BadgeVariant.Warning, badgeVariantFor(DetailBadgeVariant.Warning))
        // Web maps 'error' → 'danger' (the shared chip's tone name).
        assertEquals(BadgeVariant.Danger, badgeVariantFor(DetailBadgeVariant.Error))
        assertEquals(BadgeVariant.Neutral, badgeVariantFor(DetailBadgeVariant.Neutral))
    }

    // ── a11y description (TalkBack reads the row as one unit, original-case) ─────────

    @Test
    fun contentDescriptionJoinsLabelAndValue() {
        val row = projectWidgetDetailCard(listOf(DetailEntry("Range", "247 mi")), compact = false).rows.single()
        assertEquals("Range: 247 mi", detailRowContentDescription(row))
    }

    @Test
    fun contentDescriptionAppendsTheBadgeTextWhenPresent() {
        val entry = DetailEntry("Battery", "82%", badge = DetailBadge("Healthy", DetailBadgeVariant.Success))
        val row = projectWidgetDetailCard(listOf(entry), compact = false).rows.single()
        assertEquals("Battery: 82%, Healthy", detailRowContentDescription(row))
    }

    @Test
    fun contentDescriptionUsesOriginalCaseLabelNotTheUppercasedDisplay() {
        // The visual label is uppercased; the spoken label must stay original-case so TalkBack doesn't spell it.
        val row = projectWidgetDetailCard(listOf(DetailEntry("Charge limit", "90%")), compact = false).rows.single()
        assertEquals("Charge limit: 90%", detailRowContentDescription(row))
    }

    @Test
    fun contentDescriptionRendersTheEmDashForANullValue() {
        val row = projectWidgetDetailCard(listOf(DetailEntry("Last seen", null)), compact = false).rows.single()
        assertEquals("Last seen: \u2014", detailRowContentDescription(row))
    }

    // ── resolveOptional (web `t(key, default)`) + default copy ──────────────────────

    @Test
    fun emptyMessageDefaultMirrorsTheWebLiteral() {
        assertEquals("No details available", WidgetDetailCardDefaults.EMPTY_MESSAGE)
    }

    @Test
    fun emptyMessageKeyIsNamespacedToTheSurface() {
        assertEquals("translation_widget_detailCard_empty", KEY_WIDGET_DETAIL_CARD_EMPTY)
    }

    @Test
    fun resolveOptionalReturnsTheCatalogValueWhenPresent() {
        val resolved = resolveOptional({ "Aucun détail" }, KEY_WIDGET_DETAIL_CARD_EMPTY, WidgetDetailCardDefaults.EMPTY_MESSAGE)
        assertEquals("Aucun détail", resolved)
    }

    @Test
    fun resolveOptionalFallsBackWhenAbsentOrBlank() {
        val fallback = WidgetDetailCardDefaults.EMPTY_MESSAGE
        assertEquals(fallback, resolveOptional({ null }, KEY_WIDGET_DETAIL_CARD_EMPTY, fallback))
        assertEquals(fallback, resolveOptional({ "   " }, KEY_WIDGET_DETAIL_CARD_EMPTY, fallback))
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
        WidgetDetailCardDiagnostics.recordViewOpened(logger)
        assertEquals(1, records.size)
        assertEquals(LogLevel.Info, records[0].level)
        assertEquals("view.opened", records[0].event)
        // Only the surface slug — no label, value, or badge can leak through the diagnostic.
        assertEquals(mapOf("surface" to "WidgetDetailCard"), records[0].fields)
        assertNull(records[0].fields["label"])
    }
}
