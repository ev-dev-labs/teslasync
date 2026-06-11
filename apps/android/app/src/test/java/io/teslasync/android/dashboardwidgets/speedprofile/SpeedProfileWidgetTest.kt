package io.teslasync.android.dashboardwidgets.speedprofile

import io.teslasync.android.components.feedback.QueryErrorKind
import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import io.teslasync.shared.core.units.SpeedUnitPref
import io.teslasync.shared.core.units.convertSpeedFromSI
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
 * JVM unit tests for the framework-free Speed Profile surface logic: the distribution → chart-data
 * projection (the "data adapter"), the web `formatBucketLabel` / `parseFloat` bucket-label conversion,
 * the sweet-spot / peak-frequency / peak-bucket memos (including the documented avg_power_w-not-read
 * efficiency quirk), the tolerant JSON parsing, the unit-preference derivation, the per-state surface
 * decision, the error-kind mapping, and the registry constraints. These run in the
 * `:android:testReleaseUnitTest` gate with no device.
 */
class SpeedProfileWidgetTest {
    private val kmh = SpeedUnitPref.KMH
    private val mph = SpeedUnitPref.MPH
    private val toKmh: (Double) -> Double = { convertSpeedFromSI(it, kmh) }

    private fun bucket(
        label: String,
        readings: Int,
        avgPowerKw: Double = 0.0,
    ) = SpeedProfileBucket(label, readings, avgPowerKw)

    // ── Adapter: distribution → chart data ──────────────────────────────────────

    @Test
    fun buildChartDataComputesFrequencyShareAndConvertsLabels() {
        val snapshot = SpeedProfileSnapshot(listOf(bucket("0-15", 30), bucket("15-30", 70)), 0.0)

        val data = SpeedProfileProjection.buildChartData(snapshot, toKmh, Locale.US)

        assertEquals(2, data.size)
        // 15 m/s → 54 km/h, so "0-15" → "0-54" and "15-30" → "54-108" (web `formatBucketLabel`).
        assertEquals("0-54", data[0].bucket)
        assertEquals("54-108", data[1].bucket)
        // Frequency = readings / totalReadings * 100 (web).
        assertEquals(30.0, data[0].frequency, TOLERANCE)
        assertEquals(70.0, data[1].frequency, TOLERANCE)
    }

    @Test
    fun buildChartDataEfficiencyReadsWebKeyOnlyDefaultingToZero() {
        // The live feed carries avg_power_w (not the web's avg_power_kw), so efficiency is 0 — the
        // documented graceful-degradation path reproduced verbatim.
        val snapshot = SpeedProfileSnapshot(listOf(bucket("0-15", 10, avgPowerKw = 0.0)), 0.0)

        val data = SpeedProfileProjection.buildChartData(snapshot, toKmh, Locale.US)

        assertEquals(0.0, data[0].efficiency, TOLERANCE)
    }

    @Test
    fun buildChartDataZeroTotalReadingsGivesZeroFrequency() {
        val snapshot = SpeedProfileSnapshot(listOf(bucket("0-15", 0), bucket("15-30", 0)), 0.0)

        val data = SpeedProfileProjection.buildChartData(snapshot, toKmh, Locale.US)

        assertEquals(0.0, data[0].frequency, TOLERANCE)
        assertEquals(0.0, data[1].frequency, TOLERANCE)
    }

    // ── formatBucketLabel + jsParseFloat (web parseFloat semantics) ─────────────

    @Test
    fun formatBucketLabelHandlesRangeOpenEndedAndNonNumeric() {
        assertEquals("0-54", SpeedProfileProjection.formatBucketLabel("0-15", toKmh, Locale.US))
        // "80+" → leading number parsed, '+' suffix preserved (web `parseFloat` + `${…}+`).
        assertEquals("288+", SpeedProfileProjection.formatBucketLabel("80+", toKmh, Locale.US))
        // Non-numeric bucket is returned unchanged (web NaN guard).
        assertEquals("n/a", SpeedProfileProjection.formatBucketLabel("n/a", toKmh, Locale.US))
    }

    @Test
    fun jsParseFloatMatchesWebSemantics() {
        assertEquals(80.0, jsParseFloat("80+")!!, TOLERANCE)
        assertEquals(12.5, jsParseFloat("  12.5xyz")!!, TOLERANCE)
        assertEquals(0.5, jsParseFloat(".5")!!, TOLERANCE)
        assertNull(jsParseFloat("abc"))
        assertNull(jsParseFloat(""))
    }

    // ── Sweet spot / peak frequency / peak bucket ───────────────────────────────

    @Test
    fun findSweetSpotPicksLowestPositiveEfficiencyElseEmDash() {
        val data =
            listOf(
                SpeedChartDatum("a", 10.0, 5.0),
                SpeedChartDatum("b", 20.0, 3.0),
                SpeedChartDatum("c", 30.0, 0.0),
            )
        assertEquals("b", SpeedProfileProjection.findSweetSpot(data))

        val noEff = listOf(SpeedChartDatum("a", 10.0, 0.0))
        assertEquals(SPEED_PROFILE_EM_DASH, SpeedProfileProjection.findSweetSpot(noEff))
    }

    @Test
    fun sweetSpotPrefersOptimalSpeedWhenPositive() {
        // 13.4 m/s → 48.24 km/h → "48" (web `fmtInt(toSpeedDisplay(optimal))`).
        assertEquals("48", SpeedProfileProjection.sweetSpot(13.4, emptyList(), toKmh, Locale.US))
    }

    @Test
    fun sweetSpotFallsBackToFindSweetSpotWhenOptimalZero() {
        val data = listOf(SpeedChartDatum("a", 10.0, 0.0))
        assertEquals(SPEED_PROFILE_EM_DASH, SpeedProfileProjection.sweetSpot(0.0, data, toKmh, Locale.US))
    }

    @Test
    fun peakFrequencyAndPeakBucketSelectTheTallestColumn() {
        val data =
            listOf(
                SpeedChartDatum("a", 10.0, 0.0),
                SpeedChartDatum("b", 70.0, 0.0),
                SpeedChartDatum("c", 20.0, 0.0),
            )
        val peak = SpeedProfileProjection.peakFrequency(data)
        assertEquals(70.0, peak, TOLERANCE)
        assertEquals("b", SpeedProfileProjection.peakBucket(data, peak))
        assertEquals(SPEED_PROFILE_EM_DASH, SpeedProfileProjection.peakBucket(emptyList(), 0.0))
    }

    // ── project + stats ─────────────────────────────────────────────────────────

    @Test
    fun projectStandardHasDataAndThreeStats() {
        val snapshot = SpeedProfileSnapshot(listOf(bucket("0-15", 30), bucket("15-30", 70)), 13.4)

        val display =
            SpeedProfileProjection.project(snapshot, SpeedProfileSize(2, 4), SpeedProfilePrefs(kmh), Locale.US)

        assertTrue(display.hasData)
        assertFalse(display.isCompact)
        assertFalse(display.isWide)
        assertEquals("km/h", display.speedUnit)
        assertEquals("48", display.sweetSpot)
        assertEquals(70.0, display.peakFreq, TOLERANCE)
        assertEquals("54-108", display.peakBucket)

        val stats = SpeedProfileProjection.stats(display, labels, Locale.US)
        assertEquals(3, stats.size)
        assertEquals("Most Common", stats[0].label)
        assertEquals("Peak Freq", stats[1].label)
        assertEquals("70.0%", stats[1].value)
        assertEquals("Sweet Spot", stats[2].label)
    }

    @Test
    fun projectCompactHasTwoStatsAndNoPeakFreq() {
        val snapshot = SpeedProfileSnapshot(listOf(bucket("0-15", 30), bucket("15-30", 70)), 13.4)

        val display =
            SpeedProfileProjection.project(snapshot, SpeedProfileSize(1, 4), SpeedProfilePrefs(mph), Locale.US)

        assertTrue(display.isCompact)
        assertEquals("mph", display.speedUnit)

        val stats = SpeedProfileProjection.stats(display, labels, Locale.US)
        assertEquals(2, stats.size)
        assertEquals("Most Common", stats[0].label)
        assertEquals("Sweet Spot", stats[1].label)
    }

    @Test
    fun projectWideSetsTheWideFlag() {
        val snapshot = SpeedProfileSnapshot(listOf(bucket("0-15", 10)), 0.0)
        val display =
            SpeedProfileProjection.project(snapshot, SpeedProfileSize(3, 4), SpeedProfilePrefs(kmh), Locale.US)
        assertTrue(display.isWide)
    }

    @Test
    fun projectEmptyDistributionHasNoDataAndNoStats() {
        val display =
            SpeedProfileProjection.project(SpeedProfileSnapshot.EMPTY, SpeedProfileSize(2, 4), SpeedProfilePrefs(kmh), Locale.US)

        assertFalse(display.hasData)
        assertTrue(SpeedProfileProjection.stats(display, labels, Locale.US).isEmpty())
    }

    @Test
    fun projectAllZeroReadingsHasNoData() {
        val snapshot = SpeedProfileSnapshot(listOf(bucket("0-15", 0), bucket("15-30", 0)), 0.0)
        val display =
            SpeedProfileProjection.project(snapshot, SpeedProfileSize(2, 4), SpeedProfilePrefs(kmh), Locale.US)
        assertFalse(display.hasData)
    }

    // ── Snapshot JSON parsing ────────────────────────────────────────────────────

    @Test
    fun fromJsonReadsDistributionAndSnakeOptimalIgnoringAvgPowerW() {
        val json =
            buildJsonObject {
                putJsonArray("distribution") {
                    add(
                        buildJsonObject {
                            put("speed_bucket", "0-15")
                            put("readings", 30)
                            // Backend SI key — intentionally NOT read by the widget (web parity).
                            put("avg_power_w", 5000.0)
                        },
                    )
                }
                put("optimal_speed_mps", 13.4)
            }

        val snapshot = SpeedProfileSnapshot.fromJson(json)

        assertEquals(1, snapshot.distribution.size)
        assertEquals("0-15", snapshot.distribution[0].speedBucket)
        assertEquals(30, snapshot.distribution[0].readings)
        assertEquals(0.0, snapshot.distribution[0].avgPowerKw, TOLERANCE)
        assertEquals(13.4, snapshot.optimalSpeedMps, TOLERANCE)
        assertFalse(snapshot.isEmpty)
    }

    @Test
    fun fromJsonReadsLegacyAvgPowerKwAndCamelOptimalWhenPresent() {
        val json =
            buildJsonObject {
                putJsonArray("distribution") {
                    add(
                        buildJsonObject {
                            put("speed_bucket", "15-30")
                            put("readings", 5)
                            put("avg_power_kw", 12.5)
                        },
                    )
                }
                put("optimalSpeedMps", 20.0)
            }

        val snapshot = SpeedProfileSnapshot.fromJson(json)

        assertEquals(12.5, snapshot.distribution[0].avgPowerKw, TOLERANCE)
        assertEquals(20.0, snapshot.optimalSpeedMps, TOLERANCE)
    }

    @Test
    fun fromJsonEmptyOrNullBodyIsEmptySnapshot() {
        assertTrue(SpeedProfileSnapshot.fromJson(null).isEmpty)
        assertTrue(SpeedProfileSnapshot.fromJson(buildJsonObject { putJsonArray("distribution") {} }).isEmpty)
        // A distribution with rows but zero readings is still empty (web `hasData` negated).
        val zeroReadings =
            buildJsonObject {
                putJsonArray("distribution") {
                    add(
                        buildJsonObject {
                            put("speed_bucket", "0-15")
                            put("readings", 0)
                        },
                    )
                }
            }
        assertTrue(SpeedProfileSnapshot.fromJson(zeroReadings).isEmpty)
    }

    // ── Unit preference derivation (web useUnits) ───────────────────────────────

    @Test
    fun prefsDefaultIsMetricAndMilesGivesMph() {
        assertEquals(SpeedUnitPref.KMH, SpeedProfilePrefs.from(null).speed)
        assertEquals(SpeedUnitPref.KMH, SpeedProfilePrefs.DEFAULT.speed)
        assertEquals(
            SpeedUnitPref.MPH,
            SpeedProfilePrefs.from(buildJsonObject { put("unit_of_length", "mi") }).speed,
        )
    }

    // ── Per-state surface + error-kind mapping ──────────────────────────────────

    @Test
    fun surfaceMapsEveryPhase() {
        assertEquals(SpeedProfileSurface.Loading, speedProfileSurface(UiState<SpeedProfileSnapshot>(UiPhase.Loading)))
        assertEquals(SpeedProfileSurface.Error, speedProfileSurface(UiState<SpeedProfileSnapshot>(UiPhase.Error)))
        assertEquals(SpeedProfileSurface.Empty, speedProfileSurface(UiState<SpeedProfileSnapshot>(UiPhase.Empty)))
        assertEquals(SpeedProfileSurface.Content, speedProfileSurface(UiState<SpeedProfileSnapshot>(UiPhase.Content)))
    }

    @Test
    fun errorKindMapsConnectivityAndHttpStatus() {
        assertEquals(QueryErrorKind.Offline, speedProfileErrorKind(ErrorKind.Network, null))
        assertEquals(QueryErrorKind.Offline, speedProfileErrorKind(ErrorKind.Timeout, null))
        assertEquals(QueryErrorKind.Waiting, speedProfileErrorKind(ErrorKind.CircuitOpen, null))
        assertEquals(QueryErrorKind.NotFound, speedProfileErrorKind(ErrorKind.Http, HTTP_NOT_FOUND))
        assertEquals(QueryErrorKind.Unauthorized, speedProfileErrorKind(ErrorKind.Http, HTTP_UNAUTHORIZED))
        assertEquals(QueryErrorKind.ServerError, speedProfileErrorKind(ErrorKind.Http, HTTP_SERVER_ERROR))
        assertEquals(QueryErrorKind.Network, speedProfileErrorKind(ErrorKind.Unknown, null))
    }

    // ── Registry constraints + size flags ───────────────────────────────────────

    @Test
    fun registryIdCategorySlugAndSizesMatchWeb() {
        assertEquals("speed-profile", SpeedProfileRegistration.ID)
        assertEquals("driving", SpeedProfileRegistration.CATEGORY)
        assertEquals("SpeedProfileWidget", SpeedProfileRegistration.SLUG)
        assertEquals(SpeedProfileSize(2, 4), SpeedProfileRegistration.DEFAULT_SIZE)
        assertEquals(SpeedProfileSize(2, 4), SpeedProfileRegistration.MIN_SIZE)
        assertEquals(SpeedProfileSize(4, 40), SpeedProfileRegistration.MAX_SIZE)
    }

    @Test
    fun registryClampAndBoundsHonourTheFootprint() {
        assertEquals(SpeedProfileSize(2, 4), SpeedProfileRegistration.clamp(SpeedProfileSize(1, 1)))
        assertEquals(SpeedProfileSize(4, 40), SpeedProfileRegistration.clamp(SpeedProfileSize(9, 99)))
        assertTrue(SpeedProfileRegistration.isWithinBounds(SpeedProfileSize(2, 4)))
        assertFalse(SpeedProfileRegistration.isWithinBounds(SpeedProfileSize(1, 4)))
    }

    @Test
    fun sizeCompactAndWideMatchWeb() {
        assertTrue(SpeedProfileSize(1, 4).isCompact)
        assertFalse(SpeedProfileSize(2, 4).isCompact)
        assertTrue(SpeedProfileSize(3, 4).isWide)
        assertTrue(SpeedProfileSize(4, 40).isWide)
        assertFalse(SpeedProfileSize(2, 4).isWide)
    }

    private companion object {
        const val TOLERANCE = 0.0001
        const val HTTP_NOT_FOUND = 404
        const val HTTP_UNAUTHORIZED = 401
        const val HTTP_SERVER_ERROR = 500
        val labels = SpeedProfileStatLabels(mostCommon = "Most Common", peakFreq = "Peak Freq", sweetSpot = "Sweet Spot")
    }
}
