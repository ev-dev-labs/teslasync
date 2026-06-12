package io.teslasync.android.featureviews.recentactivity

import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.units.DistanceUnitPref
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.ZoneId
import java.util.Locale

/**
 * Off-device verification of the RecentActivity surface's pure logic — the native analogue of the web
 * component's derivations (web/src/features/vehicles/components/RecentActivity.tsx): the first-five drive +
 * charge row projections with their SI distance/energy conversion, `Xh Ym` duration templates, and
 * `start% → end%` SoC range with its null guards, plus the locale resolution and the PII-safe `view.opened`
 * diagnostic. Runs in the :android:testReleaseUnitTest gate and is locale/unit-deterministic.
 */
class RecentActivityProjectionTest {
    private fun drive(
        id: Long = 1L,
        distanceM: Double = 1_000.0,
        durationS: Long = 3_900L,
        startSocPct: Double? = 80.0,
        endSocPct: Double? = 60.0,
    ): RecentActivityDrive =
        RecentActivityDrive(
            id = id,
            distanceM = distanceM,
            durationS = durationS,
            startSocPct = startSocPct,
            endSocPct = endSocPct,
            startTsMillis = 0L,
        )

    private fun charge(
        id: Long = 1L,
        totalEnergyAddedWh: Double = 5_000.0,
        durationMin: Long = 72L,
        startSocPct: Double? = 60.0,
        endSocPct: Double? = 90.0,
    ): RecentActivityCharge =
        RecentActivityCharge(
            id = id,
            totalEnergyAddedWh = totalEnergyAddedWh,
            durationMin = durationMin,
            startSocPct = startSocPct,
            endSocPct = endSocPct,
            startTsMillis = 0L,
        )

    // ── driveRows (web drives.slice(0, 5).map) ────────────────────────────────────

    @Test
    fun driveRowsConvertsDistanceToKilometresWithSuffix() {
        val rows =
            RecentActivityProjection.driveRows(
                drives = listOf(drive(distanceM = 42_000.0)),
                distanceUnit = DistanceUnitPref.KM,
            )

        val row = rows.single()
        assertEquals(42.0, row.distanceValue, 1e-9)
        assertEquals(" km", row.distanceSuffix)
    }

    @Test
    fun driveRowsConvertsDistanceToMilesWhenPreferred() {
        val rows =
            RecentActivityProjection.driveRows(
                drives = listOf(drive(distanceM = 1_609.344)),
                distanceUnit = DistanceUnitPref.MI,
            )

        val row = rows.single()
        assertEquals(1.0, row.distanceValue, 1e-9)
        assertEquals(" mi", row.distanceSuffix)
    }

    @Test
    fun driveRowsBuildsTheDurationAndSocRange() {
        val rows =
            RecentActivityProjection.driveRows(
                drives = listOf(drive(durationS = 3_900L, startSocPct = 82.0, endSocPct = 68.0)),
                distanceUnit = DistanceUnitPref.KM,
            )

        val row = rows.single()
        assertEquals("1${HOUR_UNIT} 5${MINUTE_UNIT}", row.durationLabel)
        assertEquals("82$PERCENT_SIGN$SOC_ARROW" + "68$PERCENT_SIGN", row.socRange)
    }

    @Test
    fun driveRowsOmitsSocRangeWhenAnEndpointIsMissing() {
        val rows =
            RecentActivityProjection.driveRows(
                drives = listOf(drive(startSocPct = 80.0, endSocPct = null)),
                distanceUnit = DistanceUnitPref.KM,
            )

        assertNull(rows.single().socRange)
    }

    @Test
    fun driveRowsCapsAtTheLimitKeepingInputOrder() {
        val drives = (1..7).map { drive(id = it.toLong()) }

        val rows = RecentActivityProjection.driveRows(drives, DistanceUnitPref.KM)

        assertEquals(RECENT_ROW_LIMIT, rows.size)
        assertEquals(1L, rows.first().id)
        assertEquals(5L, rows.last().id)
    }

    // ── chargeRows (web sessions.slice(0, 5).map) ─────────────────────────────────

    @Test
    fun chargeRowsConvertsEnergyToKilowattHours() {
        val rows = RecentActivityProjection.chargeRows(listOf(charge(totalEnergyAddedWh = 23_400.0)))

        val row = rows.single()
        assertEquals(23.4, row.energyValue, 1e-9)
        assertEquals(KWH_SUFFIX, row.energySuffix)
    }

    @Test
    fun chargeRowsBuildsTheDurationFromMinutesAndSocRange() {
        val rows = RecentActivityProjection.chargeRows(listOf(charge(durationMin = 72L, startSocPct = 61.0, endSocPct = 90.0)))

        val row = rows.single()
        assertEquals("1${HOUR_UNIT} 12${MINUTE_UNIT}", row.durationLabel)
        assertEquals("61$PERCENT_SIGN$SOC_ARROW" + "90$PERCENT_SIGN", row.socRange)
    }

    @Test
    fun chargeRowsOmitsSocRangeWhenEndIsMissing() {
        val rows = RecentActivityProjection.chargeRows(listOf(charge(startSocPct = 61.0, endSocPct = null)))

        assertNull(rows.single().socRange)
    }

    @Test
    fun chargeRowsCapsAtTheLimit() {
        val charges = (1..8).map { charge(id = it.toLong()) }

        assertEquals(RECENT_ROW_LIMIT, RecentActivityProjection.chargeRows(charges).size)
    }

    // ── duration + soc helpers ────────────────────────────────────────────────────

    @Test
    fun durationFromSecondsMatchesTheWebTemplate() {
        assertEquals("0${HOUR_UNIT} 0${MINUTE_UNIT}", RecentActivityProjection.durationFromSeconds(0L))
        assertEquals("2${HOUR_UNIT} 5${MINUTE_UNIT}", RecentActivityProjection.durationFromSeconds(7_500L))
    }

    @Test
    fun durationFromMinutesMatchesTheWebTemplate() {
        assertEquals("0${HOUR_UNIT} 45${MINUTE_UNIT}", RecentActivityProjection.durationFromMinutes(45L))
        assertEquals("3${HOUR_UNIT} 0${MINUTE_UNIT}", RecentActivityProjection.durationFromMinutes(180L))
    }

    @Test
    fun socRangePrintsWholeValuesWithoutAFractionAndKeepsDecimals() {
        assertEquals("80$PERCENT_SIGN$SOC_ARROW" + "60$PERCENT_SIGN", RecentActivityProjection.socRange(80.0, 60.0))
        assertEquals("80.5$PERCENT_SIGN$SOC_ARROW" + "60$PERCENT_SIGN", RecentActivityProjection.socRange(80.5, 60.0))
        assertNull(RecentActivityProjection.socRange(null, 60.0))
        assertNull(RecentActivityProjection.socRange(80.0, null))
    }

    // ── payload + locale helpers ──────────────────────────────────────────────────

    @Test
    fun isEmptyPayloadIsTrueOnlyWhenBothListsAreEmpty() {
        assertTrue(isEmptyPayload(RecentActivityData()))
        assertFalse(isEmptyPayload(RecentActivityData(drives = listOf(drive()))))
        assertFalse(isEmptyPayload(RecentActivityData(sessions = listOf(charge()))))
    }

    @Test
    fun resolveLocaleFallsBackToEnUsForBlankOrNull() {
        assertEquals(Locale.forLanguageTag("en-US"), resolveRecentActivityLocale(null))
        assertEquals(Locale.forLanguageTag("en-US"), resolveRecentActivityLocale("  "))
        assertEquals(Locale.forLanguageTag("de-DE"), resolveRecentActivityLocale("de-DE"))
    }

    @Test
    fun formatTimestampRendersALocalizedDateTime() {
        val text = RecentActivityTimeFormatting.formatTimestamp(0L, ZoneId.of("UTC"), Locale.US)

        assertTrue("expected the epoch year in '$text'", text.contains("1970"))
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
