package io.teslasync.android.featureviews.elevationchart

import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.Logger
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.util.Locale

/**
 * Off-device verification of the Elevation Profile chart's pure logic — the native analogue of the web
 * surface's inline derivations (web/src/features/driving/components/drive-detail/ElevationChart.tsx): the
 * samples + stats → render-ready projection (x labels, the elevation/speed series value lists kept
 * index-aligned, the metre-suffixed gain/loss/net header figures with the web `elevGain - elevLoss` net),
 * the `chartData.length > 1` empty guard, the `fmtNumber`-faithful locale number formatter with its
 * `safeNumber` non-finite guard, the prop-driven lifecycle-state builder, the locale resolver, and the
 * PII-safe `view.opened` diagnostic. Runs in the :android:testReleaseUnitTest gate.
 */
class ElevationChartProjectionTest {
    private fun samples(): List<ElevationSample> =
        listOf(
            ElevationSample(time = "09:00", elevationMeters = 120.0, speed = 0.0),
            ElevationSample(time = "09:05", elevationMeters = 168.5, speed = 42.0),
            ElevationSample(time = "09:10", elevationMeters = 210.0, speed = null),
        )

    private fun data(): ElevationChartData =
        ElevationChartData(samples = samples(), stats = ElevationStats(elevGainMeters = 132.0, elevLossMeters = 68.0))

    // ── project (x labels, series value lists, header figures, order) ─────────────

    @Test
    fun projectMapsLabelsAndIndexAlignedSeriesPreservingGaps() {
        val result = ElevationChartProjection.project(data()) { "%.0f".format(Locale.US, it) }

        assertFalse(result.isEmpty)
        assertEquals(listOf("09:00", "09:05", "09:10"), result.xLabels)
        assertEquals(listOf(120.0, 168.5, 210.0), result.elevationValues)
        // The null speed sample is preserved as a gap (Android connectNulls), index-aligned with the labels.
        assertEquals(listOf(0.0, 42.0, null), result.speedValues)
    }

    @Test
    fun projectFormatsGainLossAndNetWithMetreSuffix() {
        // Inject a deterministic formatter so the assertion is locale-stable; `net = gain - loss`.
        val result = ElevationChartProjection.project(data()) { "%.0f".format(Locale.US, it) }

        assertEquals("132 m", result.gainText)
        assertEquals("68 m", result.lossText)
        assertEquals("64 m", result.netText) // 132 - 68
    }

    @Test
    fun projectNetGoesNegativeWhenDescentExceedsClimb() {
        val descending =
            ElevationChartData(
                samples = samples(),
                stats = ElevationStats(elevGainMeters = 40.0, elevLossMeters = 100.0),
            )

        val result = ElevationChartProjection.project(descending) { "%.0f".format(Locale.US, it) }

        assertEquals("-60 m", result.netText) // 40 - 100
    }

    // ── empty guard (web chartData.length > 1) ────────────────────────────────────

    @Test
    fun projectIsEmptyForFewerThanTwoSamples() {
        val zero = ElevationChartData(emptyList(), ElevationStats(0.0, 0.0))
        val one =
            ElevationChartData(
                listOf(ElevationSample("09:00", 120.0, 0.0)),
                ElevationStats(0.0, 0.0),
            )

        assertTrue(ElevationChartProjection.project(zero) { "$it" }.isEmpty)
        assertTrue(ElevationChartProjection.project(one) { "$it" }.isEmpty)
    }

    @Test
    fun projectIsNotEmptyForTwoOrMoreSamples() {
        assertFalse(ElevationChartProjection.project(data()) { "$it" }.isEmpty)
    }

    // ── formatNumber (web fmtNumber: grouping, fixed digits, safeNumber) ──────────

    @Test
    fun formatNumberGroupsAndAppliesFixedFractionDigits() {
        assertEquals("1,234.50", ElevationChartProjection.formatNumber(1_234.5, decimals = 2, locale = Locale.US))
        assertEquals("123", ElevationChartProjection.formatNumber(123.0, decimals = 0, locale = Locale.US))
        assertEquals("0.0", ElevationChartProjection.formatNumber(0.0, decimals = 1, locale = Locale.US))
    }

    @Test
    fun formatNumberRendersNonFiniteValuesAsZero() {
        // The web `safeNumber(v)` collapses NaN / Infinity to 0 so a sparse stat never shows `NaN`.
        assertEquals("0.00", ElevationChartProjection.formatNumber(Double.NaN, decimals = 2, locale = Locale.US))
        assertEquals(
            "0.00",
            ElevationChartProjection.formatNumber(Double.POSITIVE_INFINITY, decimals = 2, locale = Locale.US),
        )
    }

    @Test
    fun formatNumberClampsExcessiveDigitsToTheWebMaximum() {
        // Web `Math.min(20, decimals)` — a 25-digit request clamps to 20 fraction digits without throwing.
        val rendered = ElevationChartProjection.formatNumber(1.5, decimals = 25, locale = Locale.US)
        assertTrue(rendered.startsWith("1.5"))
    }

    // ── elevationChartState (prop-driven lifecycle builder) ───────────────────────

    @Test
    fun elevationChartStateIsEmptyForNullOrShortSamples() {
        assertEquals(UiPhase.Empty, elevationChartState(null, null).phase)
        assertEquals(UiPhase.Empty, elevationChartState(emptyList(), null).phase)
        assertEquals(
            UiPhase.Empty,
            elevationChartState(listOf(ElevationSample("09:00", 1.0, 0.0)), null).phase,
        )
    }

    @Test
    fun elevationChartStateIsContentForTwoOrMoreSamplesAndDefaultsStats() {
        val state = elevationChartState(samples(), null)

        assertEquals(UiPhase.Content, state.phase)
        assertEquals(3, state.data?.samples?.size)
        // Missing stats default to zero totals so the header still renders.
        assertEquals(0.0, state.data?.stats?.elevGainMeters)
        assertEquals(0.0, state.data?.stats?.elevLossMeters)
    }

    @Test
    fun elevationChartStateKeepsSuppliedStats() {
        val state = elevationChartState(samples(), ElevationStats(132.0, 68.0))

        assertEquals(132.0, state.data?.stats?.elevGainMeters)
        assertEquals(68.0, state.data?.stats?.elevLossMeters)
    }

    // ── resolveDisplayLocale ──────────────────────────────────────────────────────

    @Test
    fun resolveDisplayLocaleFallsBackToUsForBlankOrNull() {
        assertEquals(Locale.US, resolveDisplayLocale(null))
        assertEquals(Locale.US, resolveDisplayLocale(""))
        assertEquals(Locale.US, resolveDisplayLocale("   "))
    }

    @Test
    fun resolveDisplayLocaleParsesBcp47Tag() {
        assertEquals(Locale.US, resolveDisplayLocale("en-US"))
        assertEquals("de", resolveDisplayLocale("de-DE").language)
    }

    // ── Diagnostics (P1/S11 view.opened contract) ─────────────────────────────────

    @Test
    fun recordOpenedEmitsPiiSafeViewOpenedWithSurfaceSlug() {
        val logger = RecordingLogger()

        recordElevationChartOpened(logger)

        assertEquals(1, logger.records.size)
        val (event, fields) = logger.records.single()
        assertEquals("view.opened", event)
        assertEquals(mapOf("surface" to "ElevationChart"), fields)
    }

    @Test
    fun registrationSlugMatchesTheDiagnosticSurface() {
        assertEquals("ElevationChart", ElevationChartRegistration.SLUG)
        assertEquals("elevation-chart", ElevationChartRegistration.ID)
    }

    // ── lifecycle field plumbing (sanity that UiState carries the freshness contract) ──

    @Test
    fun uiStateExposesTheFreshnessContractTheSurfaceReads() {
        val offline =
            UiState(
                phase = UiPhase.Content,
                data = data(),
                fetchedAt = 1_700_000_000_000L,
                stale = true,
                errorKind = ErrorKind.Network,
            )

        assertTrue(offline.stale)
        assertTrue(offline.hasError)
        assertTrue(offline.isOffline)
        assertFalse(offline.isLoading)
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
