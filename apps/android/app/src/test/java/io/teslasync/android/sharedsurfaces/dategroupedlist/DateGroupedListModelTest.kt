package io.teslasync.android.sharedsurfaces.dategroupedlist

import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.Logger
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Off-device verification of the DateGroupedList surface's pure logic — the native analogue of the web
 * `DateGroupedList` component (web/src/components/data-display/DateGroupedList.tsx): the
 * [DateGroupedListGroup] render shape mirrors the web `DateGroupedListGroup<T>` interface, the
 * [dateGroupHeaderReadout] projection builds the merged heading readout the web `aria-labelledby` labels the
 * section with, the [DateGroupedListState] holder mirrors the web parent's `groups` state, and the PII-safe
 * `view.opened` diagnostic carries only the surface slug. Runs in the offline `:android:testReleaseUnitTest`
 * gate; the Compose rendering + accessibility are covered on-device by DateGroupedListUiTest.
 */
class DateGroupedListModelTest {
    // ── Render shape (web `DateGroupedListGroup<T>` interface) ─────────────────────────────────────────

    @Test
    fun groupExposesEveryFieldAndDefaultsTheOptionalLabels() {
        val group =
            DateGroupedListGroup(
                dateKey = "2026-05-09",
                dateLabel = "May 9, 2026",
                items = listOf("a", "b"),
            )

        assertEquals("2026-05-09", group.dateKey)
        assertEquals("May 9, 2026", group.dateLabel)
        // relativeLabel + summary are optional and default to null, the web `?:` optional props.
        assertNull(group.relativeLabel)
        assertNull(group.summary)
        assertEquals(listOf("a", "b"), group.items)
    }

    @Test
    fun groupCarriesTheOptionalRelativeLabelAndSummaryWhenProvided() {
        val group =
            DateGroupedListGroup(
                dateKey = "2026-04-24",
                dateLabel = "Apr 24, 2026",
                relativeLabel = "18 days ago",
                summary = "2 drives · 39.9 mi",
                items = listOf(1, 2),
            )

        assertEquals("18 days ago", group.relativeLabel)
        assertEquals("2 drives · 39.9 mi", group.summary)
    }

    // ── Header readout projection (web `<section aria-labelledby={header}>`) ───────────────────────────

    @Test
    fun headerReadoutJoinsLabelRelativeAndSummaryInReadingOrder() {
        val readout = dateGroupHeaderReadout("May 9, 2026", "3 days ago", "2 drives · 6.2 mi")

        assertEquals("May 9, 2026, 3 days ago, 2 drives · 6.2 mi", readout)
    }

    @Test
    fun headerReadoutDropsAMissingRelativeLabel() {
        val readout = dateGroupHeaderReadout("May 9, 2026", null, "2 drives · 6.2 mi")

        assertEquals("May 9, 2026, 2 drives · 6.2 mi", readout)
    }

    @Test
    fun headerReadoutDropsAMissingSummary() {
        val readout = dateGroupHeaderReadout("May 9, 2026", "3 days ago", null)

        assertEquals("May 9, 2026, 3 days ago", readout)
    }

    @Test
    fun headerReadoutIsJustTheDateLabelWhenNeitherOptionalIsPresent() {
        val readout = dateGroupHeaderReadout("May 9, 2026", null, null)

        assertEquals("May 9, 2026", readout)
    }

    @Test
    fun headerReadoutTreatsBlankOptionalsAsAbsentSoItNeverVoicesEmptyFragments() {
        // A blank relative label / summary must not produce "May 9, 2026, , " — blanks are dropped.
        val readout = dateGroupHeaderReadout("May 9, 2026", "   ", "")

        assertEquals("May 9, 2026", readout)
    }

    // ── State holder (web parent `groups` state) ──────────────────────────────────────────────────────

    @Test
    fun stateStartsWithTheInitialGroups() {
        val state = DateGroupedListState(listOf(group("2026-05-09"), group("2026-04-24")))

        assertEquals(listOf("2026-05-09", "2026-04-24"), state.groups.value.map { it.dateKey })
    }

    @Test
    fun stateDefaultsToAnEmptyList() {
        assertTrue(DateGroupedListState<String>().groups.value.isEmpty())
    }

    @Test
    fun submitReplacesTheGroups() {
        val state = DateGroupedListState(listOf(group("2026-05-09")))

        state.submit(listOf(group("2026-06-01"), group("2026-05-30")))

        assertEquals(listOf("2026-06-01", "2026-05-30"), state.groups.value.map { it.dateKey })
    }

    @Test
    fun resetClearsEveryGroup() {
        val state = DateGroupedListState(listOf(group("2026-05-09"), group("2026-04-24")))

        state.reset()

        assertTrue(state.groups.value.isEmpty())
    }

    // ── Diagnostics: PII-safe view.opened (P1/S11) ────────────────────────────────────────────────────

    @Test
    fun diagnosticsSlugMatchesThePromptMandatedSurfaceSlug() {
        assertEquals("DateGroupedList", DateGroupedListDiagnostics.SLUG)
    }

    @Test
    fun recordViewOpenedEmitsThePiiSafeInfoEventOnce() {
        val logger = RecordingLogger()

        DateGroupedListDiagnostics.recordViewOpened(logger)

        assertEquals(1, logger.records.size)
        val (level, event, fields) = logger.records.single()
        assertEquals(LogLevel.Info, level)
        assertEquals("view.opened", event)
        // Only the slug is logged — never a date label, relative label, or summary, which can carry user data.
        assertEquals(mapOf("surface" to "DateGroupedList"), fields)
    }

    private fun group(dateKey: String): DateGroupedListGroup<String> =
        DateGroupedListGroup(
            dateKey = dateKey,
            dateLabel = dateKey,
            items = listOf("item-$dateKey"),
        )

    private data class Record(
        val level: LogLevel,
        val event: String,
        val fields: Map<String, String>,
    )

    private class RecordingLogger : Logger {
        val records = mutableListOf<Record>()

        override fun log(
            level: LogLevel,
            event: String,
            fields: Map<String, String>,
        ) {
            records += Record(level, event, fields)
        }
    }
}
