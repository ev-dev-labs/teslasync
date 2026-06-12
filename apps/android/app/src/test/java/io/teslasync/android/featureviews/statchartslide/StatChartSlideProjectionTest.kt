package io.teslasync.android.featureviews.statchartslide

import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.add
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import kotlinx.serialization.json.putJsonArray
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.util.Locale

/**
 * Off-device verification of the stat-chart slide's pure logic — the native analogue of the web component's
 * data derivations (web/src/features/analytics/components/review/StatChartSlide.tsx): the raw
 * `/analytics/year-review` decode with its truthiness/optional-chaining parity, the `monthly_stats` →
 * (xLabels, drive values) projection with its preserved order + `M{n}` month fallback, the locale-grouped
 * "per week" count formatting (web `fmtNumber(value, 1)`), and the PII-safe `view.opened` diagnostic. Runs in
 * the :android:testReleaseUnitTest gate.
 */
class StatChartSlideProjectionTest {
    // ── Decode (web `data ?` truthiness + optional chaining parity) ───────────────────────────────

    @Test
    fun parseReadsTotalsAvgAndMonthlyStatsPreservingOrder() {
        val json =
            buildJsonObject {
                put("total_drives", 342)
                put("avg_drives_per_week", 6.6)
                putJsonArray("monthly_stats") {
                    add(monthStat(month = 1, drives = 24.0))
                    add(monthStat(month = 2, drives = 28.5))
                    add(monthStat(month = 3, drives = 31.0))
                }
            }

        val data = parseStatChartData(json)

        assertEquals(342.0, data?.totalDrives)
        assertEquals(6.6, data?.avgDrivesPerWeek)
        assertEquals(
            listOf(
                StatChartMonth(month = 1, drives = 24.0),
                StatChartMonth(month = 2, drives = 28.5),
                StatChartMonth(month = 3, drives = 31.0),
            ),
            data?.monthlyStats,
        )
    }

    @Test
    fun parseCollapsesMissingFieldsToZeroAndEmpty() {
        val data = parseStatChartData(buildJsonObject { put("total_drives", 12) })

        assertEquals(12.0, data?.totalDrives)
        assertEquals(0.0, data?.avgDrivesPerWeek)
        assertTrue(data?.monthlyStats?.isEmpty() == true)
    }

    @Test
    fun parseSkipsNonObjectMonthlyRows() {
        val json =
            buildJsonObject {
                putJsonArray("monthly_stats") {
                    add(monthStat(month = 5, drives = 9.0))
                    add(JsonPrimitive("not-an-object"))
                }
            }

        val data = parseStatChartData(json)

        assertEquals(listOf(StatChartMonth(month = 5, drives = 9.0)), data?.monthlyStats)
    }

    @Test
    fun parseReturnsNullForAbsentEmptyOrNonObjectPayload() {
        assertNull(parseStatChartData(null))
        assertNull(parseStatChartData(JsonNull))
        assertNull(parseStatChartData(buildJsonObject { }))
        assertNull(parseStatChartData(JsonPrimitive(0)))
    }

    // ── Projection (web `monthly_stats.map(...)` parity) ───────────────────────────────────────────

    @Test
    fun projectMapsMonthsToLabelsAndValuesPreservingOrder() {
        val data =
            StatChartData(
                totalDrives = 100.0,
                avgDrivesPerWeek = 2.0,
                monthlyStats =
                    listOf(
                        StatChartMonth(month = 1, drives = 24.0),
                        StatChartMonth(month = 2, drives = 28.0),
                        StatChartMonth(month = 12, drives = 5.0),
                    ),
            )

        val result = StatChartSlideProjection.project(data)

        assertTrue(result.hasChartData)
        assertEquals(listOf("Jan", "Feb", "Dec"), result.xLabels)
        assertEquals(listOf(24.0, 28.0, 5.0), result.driveValues)
    }

    @Test
    fun projectReportsNoChartDataForEmptyMonths() {
        val data = StatChartData(totalDrives = 0.0, avgDrivesPerWeek = 0.0, monthlyStats = emptyList())

        val result = StatChartSlideProjection.project(data)

        assertFalse(result.hasChartData)
        assertTrue(result.xLabels.isEmpty())
        assertTrue(result.driveValues.isEmpty())
    }

    @Test
    fun monthLabelMapsCalendarMonthsAndFallsBackForOutOfRange() {
        assertEquals("Jan", StatChartSlideProjection.monthLabel(1))
        assertEquals("Dec", StatChartSlideProjection.monthLabel(12))
        assertEquals("M0", StatChartSlideProjection.monthLabel(0))
        assertEquals("M13", StatChartSlideProjection.monthLabel(13))
    }

    // ── Caption count formatting (web fmtNumber(value, 1) parity) ──────────────────────────────────

    @Test
    fun formatAvgPerWeekGroupsThousandsWithOneFractionDigit() {
        assertEquals("6.6", StatChartSlideProjection.formatAvgPerWeek(6.6, Locale.US))
        assertEquals("0.0", StatChartSlideProjection.formatAvgPerWeek(0.0, Locale.US))
        assertEquals("1,234.5", StatChartSlideProjection.formatAvgPerWeek(1_234.5, Locale.US))
    }

    // ── Diagnostics (P1/S11 view.opened contract) ─────────────────────────────────────────────────

    @Test
    fun recordOpenedEmitsPiiSafeViewOpenedWithSurfaceSlug() {
        val logger = RecordingLogger()

        recordStatChartSlideOpened(logger)

        assertEquals(1, logger.records.size)
        val (event, fields) = logger.records.single()
        assertEquals("view.opened", event)
        assertEquals(mapOf("surface" to "StatChartSlide"), fields)
    }

    private fun monthStat(
        month: Int,
        drives: Double,
    ) = buildJsonObject {
        put("month", month)
        put("drives", drives)
    }

    private class RecordingLogger : Logger {
        val records = mutableListOf<Pair<String, Map<String, String>>>()

        override fun log(
            level: LogLevel,
            event: String,
            fields: Map<String, String>,
        ) {
            records += event to fields
        }
    }
}
