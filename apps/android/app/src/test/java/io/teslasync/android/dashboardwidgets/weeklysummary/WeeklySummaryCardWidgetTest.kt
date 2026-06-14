package io.teslasync.android.dashboardwidgets.weeklysummary

import io.teslasync.android.components.datadisplay.DeltaArrow
import io.teslasync.android.components.feedback.QueryErrorKind
import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import io.teslasync.shared.core.units.DistanceUnitPref
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.util.Locale

/**
 * JVM unit tests for the framework-free Weekly Summary surface logic: the weekly-digest → metrics
 * projection (the "data adapter", including the web's double-conversion quirks reproduced verbatim),
 * the `trendOf` week-over-week chip, the `useFormatting` currency helper, the settings/unit
 * derivation, the snake_case/camelCase digest parsing, the per-state surface decision, the error-kind
 * mapping, the cached → projection bridge, the compact accessibility label, and the registry
 * constraints. These run in the `:android:testReleaseUnitTest` gate with no device.
 */
class WeeklySummaryCardWidgetTest {
    private val km = DistanceUnitPref.KM

    // ── Adapter: weekly digest → display metrics (energy/cost pass-through, drives) ──────────────

    @Test
    fun computeMetricsPassesEnergyCostAndDrivesThrough() {
        val metrics = WeeklySummaryProjection.computeMetrics(digest(energyKwh = 58.2, cost = 8.15, drives = 9.0), metricPrefs())

        assertEquals(58.2, metrics.energy.current, TOLERANCE)
        assertEquals(8.15, metrics.cost.current, TOLERANCE)
        assertEquals(9.0, metrics.drives.current, TOLERANCE)
    }

    @Test
    fun computeMetricsReproducesWebDistanceDoubleConversionQuirk() {
        // Web parity: distMi = distanceKm * KM_TO_MI, then convertDistanceFromSI(distMi, unit) treats
        // that miles magnitude as SI metres. Reproduced verbatim — never silently corrected.
        val distMi = 100.0 * WeeklySummaryProjection.KM_TO_MI

        val kmMetrics = WeeklySummaryProjection.computeMetrics(digest(distanceKm = 100.0), metricPrefs(DistanceUnitPref.KM))
        assertEquals(distMi / METERS_PER_KM, kmMetrics.distance.current, TOLERANCE)

        val miMetrics = WeeklySummaryProjection.computeMetrics(digest(distanceKm = 100.0), metricPrefs(DistanceUnitPref.MI))
        assertEquals(distMi / METERS_PER_MILE, miMetrics.distance.current, TOLERANCE)
    }

    @Test
    fun computeMetricsReproducesWebEfficiencyDoubleConversionQuirk() {
        // Web parity: effWhMi = efficiencyWhKm * MI_TO_KM, then the miles branch multiplies again by
        // 1.609344. Reproduced verbatim.
        val kmMetrics = WeeklySummaryProjection.computeMetrics(digest(efficiencyWhKm = 200.0), metricPrefs(DistanceUnitPref.KM))
        assertEquals(200.0 * WeeklySummaryProjection.MI_TO_KM, kmMetrics.efficiency.current, TOLERANCE)

        val miMetrics = WeeklySummaryProjection.computeMetrics(digest(efficiencyWhKm = 200.0), metricPrefs(DistanceUnitPref.MI))
        val expectedMi = 200.0 * WeeklySummaryProjection.MI_TO_KM * WeeklySummaryProjection.EFFICIENCY_MI_FACTOR
        assertEquals(expectedMi, miMetrics.efficiency.current, TOLERANCE)
    }

    @Test
    fun computeMetricsConvertsPreviousWeekToo() {
        val metrics =
            WeeklySummaryProjection.computeMetrics(
                WeeklyDigest(
                    current = WeekStats(drives = 9.0, distanceKm = 100.0, energyKwh = 58.0, cost = 8.0, efficiencyWhKm = 200.0),
                    previous = WeekStats(drives = 7.0, distanceKm = 80.0, energyKwh = 60.0, cost = 9.0, efficiencyWhKm = 210.0),
                ),
                metricPrefs(DistanceUnitPref.KM),
            )

        assertEquals((80.0 * WeeklySummaryProjection.KM_TO_MI) / METERS_PER_KM, metrics.distance.previous, TOLERANCE)
        assertEquals(60.0, metrics.energy.previous, TOLERANCE)
        assertEquals(9.0, metrics.cost.previous, TOLERANCE)
        assertEquals(210.0 * WeeklySummaryProjection.MI_TO_KM, metrics.efficiency.previous, TOLERANCE)
    }

    // ── trendOf — the week-over-week chip ───────────────────────────────────────────────────────

    @Test
    fun trendOfFlatEmDashWhenPreviousIsZero() {
        val trend = WeeklySummaryProjection.trendOf(WeeklyMetric(current = 100.0, previous = 0.0), locale = Locale.US)

        assertEquals(DeltaArrow.Flat, trend.direction)
        assertEquals(WEEKLY_SUMMARY_EM_DASH, trend.text)
        assertNull(trend.positive)
    }

    @Test
    fun trendOfFlatNearZeroWhenChangeUnderOnePercent() {
        val trend = WeeklySummaryProjection.trendOf(WeeklyMetric(current = 100.5, previous = 100.0), locale = Locale.US)

        assertEquals(DeltaArrow.Flat, trend.direction)
        assertEquals(WEEKLY_SUMMARY_NEAR_ZERO, trend.text)
        assertNull(trend.positive)
    }

    @Test
    fun trendOfUpIsPositiveByDefault() {
        val trend = WeeklySummaryProjection.trendOf(WeeklyMetric(current = 150.0, previous = 100.0), locale = Locale.US)

        assertEquals(DeltaArrow.Up, trend.direction)
        assertEquals("50%", trend.text)
        assertEquals(true, trend.positive)
    }

    @Test
    fun trendOfDownIsNegativeByDefault() {
        val trend = WeeklySummaryProjection.trendOf(WeeklyMetric(current = 100.0, previous = 150.0), locale = Locale.US)

        assertEquals(DeltaArrow.Down, trend.direction)
        assertEquals("33%", trend.text)
        assertEquals(false, trend.positive)
    }

    @Test
    fun trendOfLowerIsPositiveInvertsTheTone() {
        val down =
            WeeklySummaryProjection.trendOf(
                WeeklyMetric(current = 90.0, previous = 100.0),
                lowerIsPositive = true,
                locale = Locale.US,
            )
        assertEquals(DeltaArrow.Down, down.direction)
        assertEquals("10%", down.text)
        assertEquals(true, down.positive)

        val up =
            WeeklySummaryProjection.trendOf(
                WeeklyMetric(current = 110.0, previous = 100.0),
                lowerIsPositive = true,
                locale = Locale.US,
            )
        assertEquals(DeltaArrow.Up, up.direction)
        assertEquals(false, up.positive)
    }

    @Test
    fun formatPercentRoundsToIntegerWithSuffix() {
        assertEquals("33%", WeeklySummaryProjection.formatPercent(33.33, Locale.US))
        assertEquals("50%", WeeklySummaryProjection.formatPercent(50.0, Locale.US))
    }

    // ── useFormatting currency helper ───────────────────────────────────────────────────────────

    @Test
    fun formatCurrencyAppliesSymbolPrecisionAndGrouping() {
        assertEquals("$8.15", WeeklySummaryFormatting.DEFAULT.formatCurrency(8.15, locale = Locale.US))
        assertEquals("$8", WeeklySummaryFormatting.DEFAULT.formatCurrency(8.15, 0, Locale.US))
        assertEquals("$1,234.50", WeeklySummaryFormatting.DEFAULT.formatCurrency(1234.5, 2, Locale.US))
        assertEquals("\u20AC8", WeeklySummaryFormatting(currencySymbol = "\u20AC", precision = 0).formatCurrency(8.15, locale = Locale.US))
    }

    @Test
    fun formattingFromNullIsAllDefault() {
        val formatting = WeeklySummaryFormatting.from(null)
        assertEquals("$", formatting.resolvedSymbol)
        assertEquals(2, formatting.resolvedPrecision)
    }

    @Test
    fun formattingFromDocumentReadsSymbolAndPrecision() {
        val formatting =
            WeeklySummaryFormatting.from(
                buildJsonObject {
                    put("currency_symbol", "\u20AC")
                    put("decimal_precision", 3)
                },
            )
        assertEquals("\u20AC", formatting.resolvedSymbol)
        assertEquals(3, formatting.resolvedPrecision)
    }

    @Test
    fun formattingBlankSymbolAndNegativePrecisionFallBack() {
        val formatting =
            WeeklySummaryFormatting.from(
                buildJsonObject {
                    put("currency_symbol", "   ")
                    put("decimal_precision", -1)
                },
            )
        assertEquals("$", formatting.resolvedSymbol)
        assertEquals(2, formatting.resolvedPrecision)
        assertEquals(0, WeeklySummaryFormatting(currencySymbol = "  ", precision = -5).resolvedPrecision)
    }

    // ── Unit preferences ────────────────────────────────────────────────────────────────────────

    @Test
    fun prefsDefaultIsMetric() {
        val prefs = WeeklySummaryPrefs.DEFAULT
        assertEquals(DistanceUnitPref.KM, prefs.distanceUnit)
        assertFalse(prefs.isMiles)
        assertEquals("km", prefs.distanceUnitLabel)
        assertEquals(WEEKLY_SUMMARY_EFFICIENCY_UNIT_KM, prefs.efficiencyUnit)
    }

    @Test
    fun prefsFromImperialDocumentSwitchesUnits() {
        val prefs = WeeklySummaryPrefs.from(buildJsonObject { put("unit_of_length", "mi") })
        assertEquals(DistanceUnitPref.MI, prefs.distanceUnit)
        assertTrue(prefs.isMiles)
        assertEquals("mi", prefs.distanceUnitLabel)
        assertEquals(WEEKLY_SUMMARY_EFFICIENCY_UNIT_MI, prefs.efficiencyUnit)
    }

    // ── Digest parsing (snake_case wire + camelCase tolerated) ──────────────────────────────────

    @Test
    fun digestFromSnakeCaseReadsEveryField() {
        val digest =
            WeeklyDigest.from(
                buildJsonObject {
                    put("drives", 9)
                    put("distance_km", 100.0)
                    put("energy_kwh", 58.0)
                    put("cost", 8.1)
                    put("efficiency", 200.0)
                    put("prev_drives", 7)
                    put("prev_distance_km", 80.0)
                    put("prev_energy_kwh", 60.0)
                    put("prev_cost", 9.0)
                    put("prev_efficiency", 210.0)
                },
            )

        assertEquals(9.0, digest.current.drives, TOLERANCE)
        assertEquals(100.0, digest.current.distanceKm, TOLERANCE)
        assertEquals(200.0, digest.current.efficiencyWhKm, TOLERANCE)
        assertEquals(80.0, digest.previous.distanceKm, TOLERANCE)
        assertEquals(210.0, digest.previous.efficiencyWhKm, TOLERANCE)
        assertTrue(digest.hasData)
    }

    @Test
    fun digestFromCamelCaseIsTolerated() {
        val digest =
            WeeklyDigest.from(
                buildJsonObject {
                    put("distanceKm", 42.0)
                    put("energyKwh", 12.0)
                },
            )
        assertEquals(42.0, digest.current.distanceKm, TOLERANCE)
        assertEquals(12.0, digest.current.energyKwh, TOLERANCE)
    }

    @Test
    fun digestFromEmptyIsZeroAndNotHasData() {
        val digest = WeeklyDigest.from(JsonObject(emptyMap()))
        assertEquals(WeeklyDigest.EMPTY, digest)
        assertFalse(digest.hasData)
        assertFalse(weeklyDigestHasData(JsonObject(emptyMap())))
        assertFalse(weeklyDigestHasData(null))
    }

    @Test
    fun hasDataTrueWhenAnyActivityRecorded() {
        assertTrue(weeklyDigestHasData(buildJsonObject { put("distance_km", 1.0) }))
        assertTrue(weeklyDigestHasData(buildJsonObject { put("drives", 1) }))
        assertFalse(weeklyDigestHasData(buildJsonObject { put("prev_distance_km", 99.0) }))
    }

    // ── Per-state surface + error-kind mapping ──────────────────────────────────────────────────

    @Test
    fun surfaceMapsEveryPhase() {
        assertEquals(WeeklySummarySurface.Loading, weeklySummarySurface(UiState<WeeklySummaryMetrics>(UiPhase.Loading)))
        assertEquals(WeeklySummarySurface.Error, weeklySummarySurface(UiState<WeeklySummaryMetrics>(UiPhase.Error)))
        assertEquals(WeeklySummarySurface.Empty, weeklySummarySurface(UiState<WeeklySummaryMetrics>(UiPhase.Empty)))
        assertEquals(WeeklySummarySurface.Content, weeklySummarySurface(UiState<WeeklySummaryMetrics>(UiPhase.Content)))
    }

    @Test
    fun errorKindMapsConnectivityAndHttpStatus() {
        assertEquals(QueryErrorKind.Offline, weeklySummaryErrorKind(ErrorKind.Network, null))
        assertEquals(QueryErrorKind.Offline, weeklySummaryErrorKind(ErrorKind.Timeout, null))
        assertEquals(QueryErrorKind.Waiting, weeklySummaryErrorKind(ErrorKind.CircuitOpen, null))
        assertEquals(QueryErrorKind.NotFound, weeklySummaryErrorKind(ErrorKind.Http, HTTP_NOT_FOUND))
        assertEquals(QueryErrorKind.Unauthorized, weeklySummaryErrorKind(ErrorKind.Http, HTTP_UNAUTHORIZED))
        assertEquals(QueryErrorKind.Unauthorized, weeklySummaryErrorKind(ErrorKind.Http, HTTP_FORBIDDEN))
        assertEquals(QueryErrorKind.ServerError, weeklySummaryErrorKind(ErrorKind.Http, HTTP_SERVER_ERROR))
        assertEquals(QueryErrorKind.Network, weeklySummaryErrorKind(ErrorKind.Unknown, null))
    }

    // ── Cached → projection bridge ──────────────────────────────────────────────────────────────

    @Test
    fun toMetricsStatePreservesPhaseAndProjectsDigest() {
        val json: JsonElement =
            buildJsonObject {
                put("distance_km", 100.0)
                put("energy_kwh", 58.0)
                put("cost", 8.0)
                put("efficiency", 200.0)
            }
        val state = UiState(phase = UiPhase.Content, data = json, fetchedAt = 99L, stale = true)

        val projected = state.toMetricsState(WeeklySummaryPrefs.DEFAULT)

        assertEquals(UiPhase.Content, projected.phase)
        assertEquals(99L, projected.fetchedAt)
        assertTrue(projected.stale)
        val metrics = projected.data!!
        assertEquals(58.0, metrics.energy.current, TOLERANCE)
        assertEquals((100.0 * WeeklySummaryProjection.KM_TO_MI) / METERS_PER_KM, metrics.distance.current, TOLERANCE)
    }

    @Test
    fun toMetricsStateLeavesDataNullOnHardError() {
        val state = UiState<JsonElement>(phase = UiPhase.Error, errorKind = ErrorKind.Http, httpStatus = 500)

        val projected = state.toMetricsState(WeeklySummaryPrefs.DEFAULT)

        assertEquals(UiPhase.Error, projected.phase)
        assertNull(projected.data)
        assertEquals(500, projected.httpStatus)
    }

    // ── Accessibility label ─────────────────────────────────────────────────────────────────────

    @Test
    fun compactContentDescriptionJoinsValueUnitAndPeriod() {
        assertEquals("182 mi this week", weeklySummaryCompactContentDescription("182", "mi", "this week"))
    }

    // ── Registry + size constraints ─────────────────────────────────────────────────────────────

    @Test
    fun registryIdCategorySlugAndSizesMatchWeb() {
        assertEquals("weekly-summary-card", WeeklySummaryCardRegistration.ID)
        assertEquals("analytics", WeeklySummaryCardRegistration.CATEGORY)
        assertEquals("WeeklySummaryCardWidget", WeeklySummaryCardRegistration.SLUG)
        assertEquals(WeeklySummaryCardSize(2, 2), WeeklySummaryCardRegistration.DEFAULT_SIZE)
        assertEquals(WeeklySummaryCardSize(1, 2), WeeklySummaryCardRegistration.MIN_SIZE)
        assertEquals(WeeklySummaryCardSize(4, 40), WeeklySummaryCardRegistration.MAX_SIZE)
    }

    @Test
    fun registryClampAndBoundsHonourTheFootprint() {
        assertEquals(WeeklySummaryCardSize(1, 2), WeeklySummaryCardRegistration.clamp(WeeklySummaryCardSize(0, 0)))
        assertEquals(WeeklySummaryCardSize(4, 40), WeeklySummaryCardRegistration.clamp(WeeklySummaryCardSize(9, 99)))
        assertTrue(WeeklySummaryCardRegistration.isWithinBounds(WeeklySummaryCardSize(2, 2)))
        assertFalse(WeeklySummaryCardRegistration.isWithinBounds(WeeklySummaryCardSize(0, 1)))
    }

    @Test
    fun sizeCompactWideAndTallMatchWeb() {
        assertTrue(WeeklySummaryCardSize(1, 1).isCompact)
        assertFalse(WeeklySummaryCardSize(2, 2).isCompact)
        assertFalse(WeeklySummaryCardSize(1, 2).isCompact)
        assertTrue(WeeklySummaryCardSize(3, 1).isWide)
        assertFalse(WeeklySummaryCardSize(2, 2).isWide)
        assertTrue(WeeklySummaryCardSize(2, 2).isTall)
        assertFalse(WeeklySummaryCardSize(2, 1).isTall)
    }

    private fun metricPrefs(unit: DistanceUnitPref = km): WeeklySummaryPrefs =
        if (unit == DistanceUnitPref.MI) {
            WeeklySummaryPrefs.from(buildJsonObject { put("unit_of_length", "mi") })
        } else {
            WeeklySummaryPrefs.DEFAULT
        }

    private fun digest(
        drives: Double = 0.0,
        distanceKm: Double = 0.0,
        energyKwh: Double = 0.0,
        cost: Double = 0.0,
        efficiencyWhKm: Double = 0.0,
    ): WeeklyDigest =
        WeeklyDigest(
            current = WeekStats(drives, distanceKm, energyKwh, cost, efficiencyWhKm),
            previous = WeekStats.ZERO,
        )

    private companion object {
        const val TOLERANCE = 0.000001
        const val METERS_PER_KM = 1000.0
        const val METERS_PER_MILE = 1609.344
        const val HTTP_NOT_FOUND = 404
        const val HTTP_UNAUTHORIZED = 401
        const val HTTP_FORBIDDEN = 403
        const val HTTP_SERVER_ERROR = 500
    }
}
