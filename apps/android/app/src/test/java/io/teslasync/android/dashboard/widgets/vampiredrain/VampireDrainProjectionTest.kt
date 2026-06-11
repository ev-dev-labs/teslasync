package io.teslasync.android.dashboard.widgets.vampiredrain

import io.teslasync.android.components.datadisplay.formatFreshnessAge
import kotlinx.serialization.json.Json
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.OffsetDateTime
import java.util.Locale

/**
 * Off-device verification of the VampireDrainWidget's pure logic — the JSON parse adapters, the
 * `avgDrainPctPerDay = avg_drain_rate * 24` derivation, the `drainColor` band heuristic, `formatDuration`,
 * the `eventItems` (title / subtitle) + `sparklineData` projections, the newest-first 5-row feed cap, the
 * registry metadata, and the size flags. Mirrors the web spec
 * (web/src/features/dashboard/widgets/VampireDrainWidget.tsx). [Locale.US] is pinned for deterministic
 * grouping.
 */
class VampireDrainProjectionTest {
    private fun labels(): VampireDrainLabels =
        VampireDrainLabels(
            perDay = "/day",
            sentry = "Sentry",
            hour = "h",
            minute = "m",
            eventCountTemplate = "%1\$s events \u00b7 %2\$sh total",
            formatRelative = ::formatFreshnessAge,
        )

    private fun event(
        id: Long = 1,
        startDate: String = "2026-06-06T12:00:00Z",
        durationHours: Double = 2.5,
        batteryLost: Double = 5.0,
        drainRatePctPerHour: Double = 2.5,
    ): VampireDrainEvent =
        VampireDrainEvent(
            id = id,
            startDate = startDate,
            durationHours = durationHours,
            batteryLost = batteryLost,
            drainRatePctPerHour = drainRatePctPerHour,
            sentryMode = false,
        )

    private fun project(
        snapshot: VampireDrainSnapshot,
        size: VampireDrainSize = STANDARD,
    ): VampireDrainDisplay = VampireDrainProjection.project(snapshot, size, labels(), NOW, Locale.US)

    // ---- Parse adapters (web VampireDrainStats / VampireDrainEvent shapes) -----------

    @Test
    fun stats_fromJson_readsSnakeCaseFields() {
        val json =
            Json.parseToJsonElement(
                """{"avg_drain_rate":0.085,"total_hours":36,"event_count":4,"total_range_lost":9.1}""",
            )
        val s = requireNotNull(VampireDrainStats.fromJson(json))
        assertEquals(0.085, s.avgDrainRate, EPS)
        assertEquals(36.0, s.totalHours, EPS)
        assertEquals(4L, s.eventCount)
    }

    @Test
    fun stats_fromJson_defaultsCollapseToZeroAndNonObjectIsNull() {
        val empty = requireNotNull(VampireDrainStats.fromJson(Json.parseToJsonElement("{}")))
        assertEquals(0.0, empty.avgDrainRate, EPS)
        assertEquals(0L, empty.eventCount)
        // web `stats ?` is falsy for a non-object body ⇒ does not satisfy hasData.
        assertNull(VampireDrainStats.fromJson(Json.parseToJsonElement("null")))
        assertNull(VampireDrainStats.fromJson(Json.parseToJsonElement("[]")))
    }

    @Test
    fun events_parseList_decodesRowsAndToleratesNonArray() {
        val json =
            Json.parseToJsonElement(
                """
                [
                  {"id":1,"start_date":"2026-06-06T10:00:00Z","duration_hours":2.5,
                   "battery_lost":5,"drain_rate_pct_per_hour":2.5,"sentry_mode":true},
                  {"id":2,"start_date":"2026-06-06T08:00:00Z","duration_hours":0.5,
                   "battery_lost":1,"drain_rate_pct_per_hour":0.5,"sentry_mode":false}
                ]
                """.trimIndent(),
            )
        val rows = VampireDrainEvent.parseList(json)
        assertEquals(2, rows.size)
        assertEquals(1L, rows[0].id)
        assertTrue(rows[0].sentryMode)
        assertEquals(0.5, rows[1].drainRatePctPerHour, EPS)
        assertEquals(emptyList<VampireDrainEvent>(), VampireDrainEvent.parseList(Json.parseToJsonElement("null")))
    }

    @Test
    fun snapshot_hasDataMirrorsWebGate() {
        assertFalse(VampireDrainSnapshot.EMPTY.hasData)
        assertTrue(VampireDrainSnapshot(stats = VampireDrainStats(0.0, 0.0, 0L), events = emptyList()).hasData)
        assertTrue(VampireDrainSnapshot(stats = null, events = listOf(event())).hasData)
    }

    @Test
    fun snapshot_fromJsonCombinesStatsAndEvents() {
        val stats = Json.parseToJsonElement("""{"avg_drain_rate":0.1,"total_hours":10,"event_count":2}""")
        val events = Json.parseToJsonElement("""[{"id":1,"start_date":"2026-06-06T10:00:00Z"}]""")
        val snapshot = VampireDrainSnapshot.fromJson(stats, events)
        assertEquals(0.1, requireNotNull(snapshot.stats).avgDrainRate, EPS)
        assertEquals(1, snapshot.events.size)
    }

    // ---- avgDrainPctPerDay + drainColor band heuristic -------------------------------

    @Test
    fun avgDrainPctPerDay_multipliesByTwentyFour() {
        assertEquals(2.04, VampireDrainProjection.avgDrainPctPerDay(VampireDrainStats(0.085, 0.0, 0L)), EPS)
        assertEquals(0.0, VampireDrainProjection.avgDrainPctPerDay(null), EPS)
    }

    @Test
    fun drainBand_matchesWebDrainColorThresholds() {
        // web drainColor: pctPerDay < 1 ⇒ green(Low); < 3 ⇒ amber(Medium); else red(High).
        assertEquals(DrainBand.Low, VampireDrainProjection.drainBand(0.0))
        assertEquals(DrainBand.Low, VampireDrainProjection.drainBand(0.99))
        assertEquals(DrainBand.Medium, VampireDrainProjection.drainBand(1.0))
        assertEquals(DrainBand.Medium, VampireDrainProjection.drainBand(2.99))
        assertEquals(DrainBand.High, VampireDrainProjection.drainBand(3.0))
        assertEquals(DrainBand.High, VampireDrainProjection.drainBand(12.5))
    }

    @Test
    fun formatDuration_matchesWebMinuteHourSplit() {
        // web: hours < 1 ⇒ `${fmtNumber(hours*60,0)}m`; else `${fmtNumber(hours,1)}h`.
        assertEquals("30m", VampireDrainProjection.formatDuration(0.5, labels(), Locale.US))
        assertEquals("15m", VampireDrainProjection.formatDuration(0.25, labels(), Locale.US))
        assertEquals("0m", VampireDrainProjection.formatDuration(0.0, labels(), Locale.US))
        assertEquals("1.0h", VampireDrainProjection.formatDuration(1.0, labels(), Locale.US))
        assertEquals("2.5h", VampireDrainProjection.formatDuration(2.5, labels(), Locale.US))
    }

    // ---- project: avg stat + sublabel ------------------------------------------------

    @Test
    fun project_buildsAvgStatValueBandAndSublabel() {
        val view = project(VampireDrainSnapshot(VampireDrainStats(0.085, 36.0, 4L), listOf(event())))
        assertEquals("2.0%", view.avgPercentText)
        assertEquals("2.0%/day", view.avgValueText)
        assertEquals(DrainBand.Medium, view.avgBand)
        assertEquals("4 events \u00b7 36h total", view.sublabel)
    }

    @Test
    fun project_nullStatsCollapsesAvgToZeroAndOmitsSublabel() {
        // hasData true only via events; web StatCard shows 0%/day with no sublabel (stats undefined).
        val view = project(VampireDrainSnapshot(stats = null, events = listOf(event())))
        assertEquals("0.0%/day", view.avgValueText)
        assertNull(view.sublabel)
        assertEquals(DrainBand.Low, view.avgBand)
    }

    // ---- project: event feed rows (title / subtitle / band / cap / order) ------------

    @Test
    fun project_buildsEventRowTitleSubtitleAndBand() {
        val view =
            project(
                VampireDrainSnapshot(
                    stats = null,
                    events =
                        listOf(
                            event(batteryLost = 5.0, durationHours = 2.5, drainRatePctPerHour = 2.5)
                                .copy(sentryMode = true),
                        ),
                ),
            )
        val row = view.events.single()
        assertEquals("5.0% \u00b7 2.5h \u00b7 Sentry", row.title)
        assertEquals("60.0%/day", row.subtitle)
        assertEquals(DrainBand.High, row.band)
        assertTrue(row.contentDescription.contains("5.0%"))
        assertTrue(row.contentDescription.contains("60.0%/day"))
    }

    @Test
    fun project_eventRowOmitsSentryWhenOff() {
        val view = project(VampireDrainSnapshot(null, listOf(event())))
        assertEquals("5.0% \u00b7 2.5h", view.events.single().title)
    }

    @Test
    fun project_feedSortsNewestFirstAndCapsAtFive() {
        val events =
            (1..7).map { i ->
                event(id = i.toLong(), startDate = "2026-06-06T0$i:00:00Z", drainRatePctPerHour = 0.0)
            }
        val view = project(VampireDrainSnapshot(null, events))
        assertEquals(VampireDrainProjection.FEED_MAX_ITEMS, view.events.size)
        // Newest (07:00, id 7) first; the two oldest (id 1, 2) are dropped by the 5-row cap.
        assertEquals(7L, view.events.first().id)
        assertEquals(3L, view.events.last().id)
    }

    // ---- project: sparkline (reversed * 24, wide-only) -------------------------------

    @Test
    fun project_sparklineReversesAndScalesByTwentyFour() {
        val events =
            listOf(
                event(id = 1, drainRatePctPerHour = 0.1),
                event(id = 2, drainRatePctPerHour = 0.2),
                event(id = 3, drainRatePctPerHour = 0.3),
            )
        val view = project(VampireDrainSnapshot(null, events), size = WIDE)
        assertEquals(listOf(7.2, 4.8, 2.4), view.sparkline.map { (it * 10).toLong() / 10.0 })
        assertTrue(view.showSparkline)
    }

    @Test
    fun project_sparklineHiddenWhenNotWideOrTooFewPoints() {
        val twoEvents = listOf(event(id = 1, drainRatePctPerHour = 0.1), event(id = 2, drainRatePctPerHour = 0.2))
        // Standard (2-col) footprint: not wide ⇒ no sparkline even with > 1 point.
        assertFalse(project(VampireDrainSnapshot(null, twoEvents), size = STANDARD).showSparkline)
        // Wide but a single point ⇒ no sparkline (web `sparklineData.length > 1`).
        assertFalse(project(VampireDrainSnapshot(null, listOf(event())), size = WIDE).showSparkline)
    }

    // ---- registry metadata (web registry/energy.ts) ----------------------------------

    @Test
    fun registry_metadataMatchesWebRegistry() {
        assertEquals("vampire-drain", VampireDrainRegistration.ID)
        assertEquals("energy", VampireDrainRegistration.CATEGORY)
        assertEquals("Vampire Drain", VampireDrainRegistration.NAME)
        assertEquals("VampireDrainWidget", VampireDrainRegistration.SLUG)
        assertEquals(VampireDrainSize(cols = 2, rows = 4), VampireDrainRegistration.defaultSize)
        assertEquals(VampireDrainSize(cols = 1, rows = 2), VampireDrainRegistration.minSize)
        assertEquals(VampireDrainSize(cols = 4, rows = 40), VampireDrainRegistration.maxSize)
    }

    @Test
    fun registry_boundsAndClampHonourMinMax() {
        assertTrue(VampireDrainRegistration.withinBounds(VampireDrainSize(1, 2)))
        assertTrue(VampireDrainRegistration.withinBounds(VampireDrainSize(4, 40)))
        assertFalse(VampireDrainRegistration.withinBounds(VampireDrainSize(0, 1)))
        assertFalse(VampireDrainRegistration.withinBounds(VampireDrainSize(5, 50)))
        assertEquals(VampireDrainSize(1, 2), VampireDrainRegistration.clamp(VampireDrainSize(0, 0)))
        assertEquals(VampireDrainSize(4, 40), VampireDrainRegistration.clamp(VampireDrainSize(9, 99)))
    }

    @Test
    fun size_compactAndWideFlagsMatchWeb() {
        assertTrue(VampireDrainSize(cols = 1, rows = 2).isCompact)
        assertFalse(VampireDrainSize(cols = 2, rows = 4).isCompact)
        assertFalse(VampireDrainSize(cols = 2, rows = 4).isWide)
        assertTrue(VampireDrainSize(cols = 3, rows = 4).isWide)
        assertTrue(VampireDrainSize(cols = 4, rows = 6).isWide)
    }

    private companion object {
        const val EPS = 1e-9
        val NOW = OffsetDateTime.parse("2026-06-06T12:30:00Z").toInstant().toEpochMilli()
        val STANDARD = VampireDrainSize(cols = 2, rows = 4)
        val WIDE = VampireDrainSize(cols = 4, rows = 6)
    }
}
