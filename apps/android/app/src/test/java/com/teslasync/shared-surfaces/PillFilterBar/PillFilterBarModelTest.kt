// Off-device unit coverage for the PillFilterBar surface's pure model + id seam (P3 acceptance: the adapter
// unit test). Exercises the registration slug the prompt mandates, the empty / populated projection
// branches that mirror the web `items.length === 0` vs `items.map(...)` outcomes, every per-pill field
// (selected / accent default / disabled / formatted count), the locale-aware count formatter (web
// `fmtInt`), the per-tab id composition (web `${tablistId}-tab-${key}`), the `useId` seam (deterministic vs
// distinct ids), and the PII-safe `view.opened` diagnostic. No Compose / Android framework / HTTP — runs in
// :android:testReleaseUnitTest. Reference values are the strings + behaviour the web `PillFilterBar`
// produces.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.pillfilterbar

import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.LogRecord
import io.teslasync.shared.core.diagnostics.Logger
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.util.Locale

class PillFilterBarModelTest {
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

    // ── registration metadata mirrors the prompt-mandated surface slug ────────────────

    @Test
    fun registrationSlugIsThePromptSurfaceSlug() {
        assertEquals("pillFilterBar", PillFilterBarRegistration.ID)
        assertEquals("PillFilterBar", PillFilterBarRegistration.SLUG)
    }

    // ── projection: empty / populated branches ────────────────────────────────────────

    @Test
    fun emptyItemsProjectTheEmptyBranch() {
        val projection = PillFilterBarProjection.project(PillFilterBarInput(emptyList(), activeKey = "x"), Locale.US)
        assertEquals(PillFilterBarProjection.Empty, projection)
    }

    @Test
    fun populatedItemsProjectResolvedPreservingOrderAndState() {
        val input =
            PillFilterBarInput(
                items =
                    listOf(
                        PillItemInput(key = "all", label = "All", count = 128),
                        PillItemInput(key = "anomalies", label = "Anomalies", count = 4, accent = PillAccent.Red),
                        PillItemInput(key = "archived", label = "Archived", disabled = true),
                    ),
                activeKey = "all",
            )
        val resolved = PillFilterBarProjection.project(input, Locale.US) as PillFilterBarProjection.Resolved
        assertEquals(listOf("all", "anomalies", "archived"), resolved.pills.map { it.key })

        val all = resolved.pills[0]
        assertEquals("All", all.label)
        assertTrue(all.selected)
        assertFalse(all.disabled)
        assertEquals("(128)", all.countText)

        val anomalies = resolved.pills[1]
        assertFalse(anomalies.selected)
        assertEquals(PillAccent.Red, anomalies.accent)
        assertEquals("(4)", anomalies.countText)

        val archived = resolved.pills[2]
        assertTrue(archived.disabled)
        assertNull(archived.countText)
    }

    @Test
    fun accentDefaultsToCyanWhenItemOmitsIt() {
        val input = PillFilterBarInput(listOf(PillItemInput(key = "k", label = "K")), activeKey = "k")
        val pill = (PillFilterBarProjection.project(input, Locale.US) as PillFilterBarProjection.Resolved).pills.single()
        assertEquals(PillAccent.Cyan, pill.accent)
        assertEquals(PillAccent.DEFAULT, pill.accent)
    }

    @Test
    fun noPillIsSelectedWhenActiveKeyMatchesNothing() {
        val input = PillFilterBarInput(listOf(PillItemInput("a", "A"), PillItemInput("b", "B")), activeKey = "missing")
        val resolved = PillFilterBarProjection.project(input, Locale.US) as PillFilterBarProjection.Resolved
        assertTrue(resolved.pills.none { it.selected })
    }

    // ── count formatter (web fmtInt) ──────────────────────────────────────────────────

    @Test
    fun countFormatsWithLocaleGrouping() {
        assertEquals("(12)", formatPillCount(12, Locale.US))
        assertEquals("(1,234)", formatPillCount(1234, Locale.US))
        assertEquals("(1.234)", formatPillCount(1234, Locale.GERMANY))
    }

    // ── per-tab id composition (web `${tablistId}-tab-${key}`) ─────────────────────────

    @Test
    fun pillTabIdMatchesTheWebComposition() {
        assertEquals("pillfilterbar-7-tab-all", pillTabId("pillfilterbar-7", "all"))
    }

    // ── id seam (web useId) ───────────────────────────────────────────────────────────

    @Test
    fun staticIdSourceIsDeterministic() {
        val source = StaticPillFilterBarIdSource("fixed-id")
        assertEquals("fixed-id", source.nextId())
        assertEquals("fixed-id", source.nextId())
    }

    @Test
    fun processIdSourceMintsDistinctPrefixedIds() {
        val source = ProcessPillFilterBarIdSource()
        val first = source.nextId()
        val second = source.nextId()
        assertNotEquals(first, second)
        assertTrue(first.startsWith("pillfilterbar-"))
        assertTrue(second.startsWith("pillfilterbar-"))
    }

    // ── diagnostics: PII-safe view.opened ─────────────────────────────────────────────

    @Test
    fun recordOpenedEmitsSlugOnlyDiagnostic() {
        val logger = RecordingLogger()
        recordPillFilterBarOpened(logger)
        val record = logger.records.single { it.event == "view.opened" }
        assertEquals(mapOf("surface" to "PillFilterBar"), record.fields)
        assertTrue(record.fields.values.none { it.contains("anomal", ignoreCase = true) })
    }
}
