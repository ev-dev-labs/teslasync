package io.teslasync.android.featureviews.recentactivity

import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.ZoneId
import java.util.Locale

/**
 * Off-device verification of the RecentActivity surface's pure logic — the native analogue of the web
 * component's derivations (web/src/features/dashboard/components/RecentActivity.tsx): the merged + time-sorted
 * + capped activity feed with its drive/charge title + subtitle templates and `?? '?'` SoC sentinel, the
 * reversed battery trend with its `?? 50` default, the CO2 estimate, the relative-time bucketing (web
 * `formatTimeAgo`), the currency-preference resolution, and the PII-safe `view.opened` diagnostic. Runs in
 * the :android:testReleaseUnitTest gate. Deterministic formatters/strings are injected so the assertions are
 * locale/unit-independent.
 */
class RecentActivityProjectionTest {
    private val formatters =
        RecentActivityFormatters(
            formatDistance = { meters -> "${meters.toLong()}m" },
            formatEnergy = { wattHours -> "${wattHours.toLong()}wh" },
            formatCurrency = { amount -> "$" + amount.toString() },
            formatInteger = { value -> value.toLong().toString() },
            formatEfficiency = { whPerKm -> "${whPerKm.toLong()}whkm" },
        )

    private val strings = RecentActivityStrings(driveWord = "drive", chargedWord = "charged")

    private fun drive(
        distanceM: Double = 1_000.0,
        durationS: Long = 3_900L,
        startSocPct: Double? = 80.0,
        endSocPct: Double? = 60.0,
        startedAtMillis: Long = 0L,
    ): RecentActivityDrive =
        RecentActivityDrive(
            distanceM = distanceM,
            durationS = durationS,
            startSocPct = startSocPct,
            endSocPct = endSocPct,
            startedAtMillis = startedAtMillis,
        )

    private fun charge(
        totalEnergyAddedWh: Double = 5_000.0,
        startSocPct: Double? = 60.0,
        endSocPct: Double? = 90.0,
        cost: Double? = 7.5,
        startedAtMillis: Long = 0L,
    ): RecentActivityCharge =
        RecentActivityCharge(
            totalEnergyAddedWh = totalEnergyAddedWh,
            startSocPct = startSocPct,
            endSocPct = endSocPct,
            cost = cost,
            startedAtMillis = startedAtMillis,
        )

    // ── activityRows (web activityItems build + sort + slice) ─────────────────────

    @Test
    fun activityRowsMergesDrivesAndChargesNewestFirst() {
        val rows =
            RecentActivityProjection.activityRows(
                drives = listOf(drive(startedAtMillis = 200L)),
                charges = listOf(charge(startedAtMillis = 300L)),
                formatters = formatters,
                strings = strings,
            )

        assertEquals(2, rows.size)
        assertEquals(ActivityKind.Charge, rows[0].kind)
        assertEquals(ActivityKind.Drive, rows[1].kind)
    }

    @Test
    fun activityRowsBuildsTheDriveTitleAndSubtitle() {
        val rows =
            RecentActivityProjection.activityRows(
                drives = listOf(drive(distanceM = 42_000.0, durationS = 3_900L, startSocPct = 82.0, endSocPct = 68.0)),
                charges = emptyList(),
                formatters = formatters,
                strings = strings,
            )

        val expectedSubtitle = "1${HOUR_UNIT} 5${MINUTE_UNIT}" + DOT_SEPARATOR + "82$PERCENT_SIGN$SOC_ARROW" + "68$PERCENT_SIGN"
        assertEquals("42000m drive", rows.single().title)
        assertEquals(expectedSubtitle, rows.single().subtitle)
    }

    @Test
    fun activityRowsBuildsTheChargeTitleAndSubtitleWithCost() {
        val rows =
            RecentActivityProjection.activityRows(
                drives = emptyList(),
                charges = listOf(charge(totalEnergyAddedWh = 23_400.0, startSocPct = 61.0, endSocPct = 90.0, cost = 7.42)),
                formatters = formatters,
                strings = strings,
            )

        val expectedSubtitle = "61$PERCENT_SIGN$SOC_ARROW" + "90$PERCENT_SIGN" + DOT_SEPARATOR + "$7.42"
        assertEquals("23400wh charged", rows.single().title)
        assertEquals(expectedSubtitle, rows.single().subtitle)
    }

    @Test
    fun activityRowsOmitsCostWhenAbsentAndShowsSentinelForMissingSoc() {
        val rows =
            RecentActivityProjection.activityRows(
                drives = emptyList(),
                charges = listOf(charge(startSocPct = null, endSocPct = 90.0, cost = null)),
                formatters = formatters,
                strings = strings,
            )

        val expectedSubtitle = "$SOC_UNKNOWN$PERCENT_SIGN$SOC_ARROW" + "90$PERCENT_SIGN"
        assertEquals(expectedSubtitle, rows.single().subtitle)
    }

    @Test
    fun activityRowsCapsTheFeedAtTheLimitKeepingTheNewest() {
        val drives = (1..12).map { drive(startedAtMillis = it.toLong()) }

        val rows = RecentActivityProjection.activityRows(drives, emptyList(), formatters, strings)

        assertEquals(ACTIVITY_FEED_LIMIT, rows.size)
        assertEquals(12L, rows.first().timeMillis)
        assertEquals(5L, rows.last().timeMillis)
    }

    // ── batteryTrend (web map(end_soc_pct ?? 50).reverse()) ───────────────────────

    @Test
    fun batteryTrendReversesValuesAndDefaultsMissingEndSoc() {
        val drives =
            listOf(
                drive(endSocPct = 30.0, startedAtMillis = 1L),
                drive(endSocPct = null, startedAtMillis = 2L),
                drive(endSocPct = 70.0, startedAtMillis = 3L),
            )

        val trend = RecentActivityProjection.batteryTrend(drives)

        assertEquals(listOf(70.0, BATTERY_TREND_DEFAULT_SOC, 30.0), trend.values)
        assertEquals(listOf("2", "1", "0"), trend.labels)
    }

    @Test
    fun batteryTrendNeedsMoreThanOnePointToRender() {
        val single = RecentActivityProjection.project(RecentActivityData(drives = listOf(drive())), formatters, strings)
        val pair = RecentActivityProjection.project(RecentActivityData(drives = listOf(drive(), drive())), formatters, strings)

        assertFalse(single.hasBatteryTrend)
        assertTrue(pair.hasBatteryTrend)
    }

    // ── co2SavedKg (web (total_energy_kwh ?? 0) * 0.42) ───────────────────────────

    @Test
    fun co2SavedKgAppliesTheWebFactor() {
        assertEquals(42.0, RecentActivityProjection.co2SavedKg(100.0), 1e-9)
        assertEquals(0.0, RecentActivityProjection.co2SavedKg(0.0), 1e-9)
    }

    // ── project (full render-ready result) ────────────────────────────────────────

    @Test
    fun projectFormatsTheFleetStatsAndMostEfficientCallout() {
        val data =
            RecentActivityData(
                drives = listOf(drive(), drive()),
                charges = listOf(charge()),
                analytics =
                    RecentActivityAnalytics(
                        totalDrives = 128,
                        totalChargingSessions = 36,
                        totalCost = 214.5,
                        totalEnergyKwh = 940.0,
                        mostEfficient = MostEfficientVehicle(name = "Model 3 LR", efficiencyWhPerKm = 148.0),
                    ),
            )

        val result = RecentActivityProjection.project(data, formatters, strings)

        assertEquals("128", result.totalDrivesText)
        assertEquals("36", result.totalChargesText)
        assertEquals("$214.5", result.totalCostText)
        // 940 * 0.42 = 394.8 -> formatInteger truncation 394, plus the " kg" suffix.
        assertEquals("394${CO2_UNIT_SUFFIX}", result.co2SavedText)
        assertEquals("Model 3 LR", result.mostEfficientName)
        assertEquals("148whkm", result.mostEfficientEfficiencyText)
        assertTrue(result.hasActivity)
        assertFalse(result.isEmpty)
    }

    @Test
    fun projectWithNoPayloadIsEmptyWithZeroedStats() {
        val result = RecentActivityProjection.project(null, formatters, strings)

        assertTrue(result.isEmpty)
        assertFalse(result.hasActivity)
        assertTrue(result.activityRows.isEmpty())
        assertFalse(result.hasBatteryTrend)
        assertEquals("0", result.totalDrivesText)
        assertEquals("0", result.totalChargesText)
        assertEquals("$0.0", result.totalCostText)
        assertEquals("0${CO2_UNIT_SUFFIX}", result.co2SavedText)
        assertNull(result.mostEfficientName)
        assertNull(result.mostEfficientEfficiencyText)
    }

    // ── RecentActivityTimeFormatting.relative (web formatTimeAgo buckets) ─────────

    @Test
    fun relativeBucketsTheGapLikeFormatTimeAgo() {
        val now = 1_000_000_000_000L

        assertEquals(RelativeActivityTime.JustNow, RecentActivityTimeFormatting.relative(now - 30_000L, now))
        assertEquals(RelativeActivityTime.JustNow, RecentActivityTimeFormatting.relative(now + 5_000L, now))
        assertEquals(RelativeActivityTime.MinutesAgo(59), RecentActivityTimeFormatting.relative(now - 59L * 60_000L, now))
        assertEquals(RelativeActivityTime.HoursAgo(1), RecentActivityTimeFormatting.relative(now - 60L * 60_000L, now))
        assertEquals(RelativeActivityTime.HoursAgo(23), RecentActivityTimeFormatting.relative(now - 23L * 3_600_000L, now))
        assertEquals(RelativeActivityTime.DaysAgo(2), RecentActivityTimeFormatting.relative(now - 2L * 86_400_000L, now))
        assertTrue(RecentActivityTimeFormatting.relative(now - 10L * 86_400_000L, now) is RelativeActivityTime.On)
    }

    @Test
    fun formatAbsoluteRendersALocalizedDate() {
        val text = RecentActivityTimeFormatting.formatAbsolute(0L, ZoneId.of("UTC"), Locale.US)

        assertTrue("expected the epoch year in '$text'", text.contains("1970"))
    }

    // ── RecentActivityDisplay (web useFormatting/useSettings currency) ────────────

    @Test
    fun displayDefaultsMatchTheWebColdStart() {
        val display = RecentActivityDisplay.from(null)

        assertEquals("$", display.currencySymbol)
        assertEquals(2, display.precision)
        assertEquals(Locale.forLanguageTag("en-US"), display.locale)
    }

    @Test
    fun displayReadsCurrencyPrecisionAndLocaleFromSettings() {
        val settings =
            buildJsonObject {
                put("currency_symbol", "\u20ac")
                put("decimal_precision", 0)
                put("locale", "de-DE")
                put("unit_of_length", "mi")
            }

        val display = RecentActivityDisplay.from(settings)

        assertEquals("\u20ac", display.currencySymbol)
        assertEquals(0, display.precision)
        assertEquals(Locale.forLanguageTag("de-DE"), display.locale)
    }

    @Test
    fun displayFallsBackToTheDefaultSymbolForABlankSetting() {
        val settings = buildJsonObject { put("currency_symbol", "  ") }

        assertEquals("$", RecentActivityDisplay.from(settings).currencySymbol)
    }

    // ── Diagnostics (P1/S11 view.opened contract) ─────────────────────────────────

    @Test
    fun recordOpenedEmitsPiiSafeViewOpenedWithSurfaceSlug() {
        val logger = RecordingLogger()

        recordRecentActivityOpened(logger)

        assertEquals(1, logger.records.size)
        val (event, fields) = logger.records.single()
        assertEquals("view.opened", event)
        assertEquals(mapOf("surface" to "RecentActivity"), fields)
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
