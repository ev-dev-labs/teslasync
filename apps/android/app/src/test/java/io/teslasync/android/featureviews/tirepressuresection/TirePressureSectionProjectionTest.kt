package io.teslasync.android.featureviews.tirepressuresection

import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.Logger
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.util.Locale

/**
 * Off-device verification of the Tire Pressure section's pure logic — the native analogue of the web
 * component's data derivations (web/src/features/driving/components/drive-detail/TirePressureSection.tsx):
 * the per-wheel `tpVals` min/max (the `v != null && v > 0` filter), the four-tile build with its
 * `${fmtNumber(min)}–${fmtNumber(max)} ${unit}` / `'—'` formatting, the per-line `some(d => d[key] !== null)`
 * presence guards (note `!== null`, so a non-positive sample still keeps a line), the `stats.hasTirePressure`
 * content/empty boundary, the `numberFormat` helper, the `t(key, default)` resolve-or-fallback, and the
 * PII-safe `view.opened` diagnostic. Runs in the :android:testReleaseUnitTest gate.
 */
class TirePressureSectionProjectionTest {
    // Stub formatter tags each value so the test pins which formatter + unit each tile cell uses.
    private fun stubFormatters(pressureUnit: String = "psi"): TirePressureFormatters =
        TirePressureFormatters(
            number = { "N($it)" },
            pressureUnit = pressureUnit,
        )

    // FL all positive; FR has a null sample; RL has a 0 sample (kept by the line guard, dropped by the tile
    // filter); RR is entirely null (line absent, tile '—').
    private val fullTrace =
        listOf(
            TirePressurePoint(time = "09:00", frontLeft = 42.0, frontRight = 42.5, rearLeft = 41.0, rearRight = null),
            TirePressurePoint(time = "09:05", frontLeft = 42.5, frontRight = 43.0, rearLeft = 0.0, rearRight = null),
            TirePressurePoint(time = "09:10", frontLeft = 43.0, frontRight = null, rearLeft = 41.5, rearRight = null),
        )

    // ── TireWheelRange (web tpVals parity) ────────────────────────────────────────

    @Test
    fun wheelRangeComputesMinMaxOverPositiveValues() {
        val range = TireWheelRange.of(listOf(41.0, 43.0, 42.0))
        assertEquals(TireWheelRange(min = 41.0, max = 43.0), range)
    }

    @Test
    fun wheelRangeDropsNullNonFiniteAndNonPositiveSamples() {
        // web `v != null && v > 0` (here also drop NaN/Infinity): only 41.0 and 41.5 survive.
        val range = TireWheelRange.of(listOf(null, 41.0, 0.0, -3.0, Double.NaN, 41.5, Double.POSITIVE_INFINITY))
        assertEquals(TireWheelRange(min = 41.0, max = 41.5), range)
    }

    @Test
    fun wheelRangeReturnsNullWhenNoPositiveFiniteSample() {
        assertNull(TireWheelRange.of(emptyList()))
        assertNull(TireWheelRange.of(listOf(null, 0.0, -1.0, Double.NaN)))
    }

    // ── Projection: tiles (web tpStats) ───────────────────────────────────────────

    @Test
    fun projectBuildsAllFourTilesInWheelOrderWithFormattedRangeOrEmDash() {
        val tiles = TirePressureSectionProjection.project(fullTrace, stubFormatters()).tiles

        assertEquals(
            listOf(TireWheelId.FrontLeft, TireWheelId.FrontRight, TireWheelId.RearLeft, TireWheelId.RearRight),
            tiles.map { it.id },
        )
        // FL: min 42.0, max 43.0 → "N(42.0)–N(43.0) psi" (en dash separator).
        assertEquals("N(42.0)\u2013N(43.0) psi", tiles[0].value)
        // FR: the null sample is dropped → min 42.5, max 43.0.
        assertEquals("N(42.5)\u2013N(43.0) psi", tiles[1].value)
        // RL: the 0.0 sample is dropped by the > 0 tile filter → min 41.0, max 41.5.
        assertEquals("N(41.0)\u2013N(41.5) psi", tiles[2].value)
        // RR: no positive finite sample → the web `'—'` fallback (em dash).
        assertEquals("\u2014", tiles[3].value)
    }

    @Test
    fun projectFormatsSingleSampleWheelAsEqualMinMax() {
        val trace = listOf(TirePressurePoint(time = "10:00", frontLeft = 44.0))
        val tile = TirePressureSectionProjection.project(trace, stubFormatters("kPa")).tiles.first()
        assertEquals("N(44.0)\u2013N(44.0) kPa", tile.value)
    }

    // ── Projection: per-line presence guards (web some(d => d[key] !== null)) ──────

    @Test
    fun projectKeepsPresentLineColumnsAndDropsAllNullColumns() {
        val result = TirePressureSectionProjection.project(fullTrace, stubFormatters())

        assertEquals(listOf("09:00", "09:05", "09:10"), result.xLabels)
        // FL present, full column preserved (order intact).
        assertEquals(listOf(42.0, 42.5, 43.0), result.frontLeftValues)
        // FR present (some non-null), the null gap is kept for the chart to bridge.
        assertEquals(listOf(42.5, 43.0, null), result.frontRightValues)
        // RL present — the 0.0 sample keeps the line even though the tile filter dropped it from min/max.
        assertEquals(listOf(41.0, 0.0, 41.5), result.rearLeftValues)
        // RR entirely null ⇒ the line is omitted (web rendered no `<Line>`).
        assertNull(result.rearRightValues)
        assertFalse(result.isEmpty)
    }

    // ── Projection: content/empty boundary (web stats.hasTirePressure) ─────────────

    @Test
    fun projectIsEmptyOnlyWhenNoWheelHasAnyNonNullSample() {
        // Every wheel absent in every sample ⇒ the web `!hasTirePressure` empty surface.
        val allNull =
            listOf(
                TirePressurePoint(time = "09:00"),
                TirePressurePoint(time = "09:05"),
            )
        val emptyResult = TirePressureSectionProjection.project(allNull, stubFormatters())
        assertTrue(emptyResult.isEmpty)
        assertNull(emptyResult.frontLeftValues)
        assertNull(emptyResult.frontRightValues)
        assertNull(emptyResult.rearLeftValues)
        assertNull(emptyResult.rearRightValues)
        // All four tiles still exist (always rendered) and read the em-dash fallback.
        assertEquals(4, emptyResult.tiles.size)
        assertTrue(emptyResult.tiles.all { it.value == "\u2014" })

        // A single non-null sample anywhere flips it to content.
        val oneSample = listOf(TirePressurePoint(time = "09:00", rearRight = 40.0))
        assertFalse(TirePressureSectionProjection.project(oneSample, stubFormatters()).isEmpty)
    }

    @Test
    fun projectIsEmptyForNoPoints() {
        assertTrue(TirePressureSectionProjection.project(emptyList(), stubFormatters()).isEmpty)
    }

    // ── numberFormat helper (web fmtNumber parity) ─────────────────────────────────

    @Test
    fun numberGroupsThousandsAtRequestedPrecision() {
        assertEquals("42.50", TirePressureFormat.number(42.5, 2, Locale.US))
        assertEquals("1,234.50", TirePressureFormat.number(1234.5, 2, Locale.US))
        assertEquals("42", TirePressureFormat.number(42.0, 0, Locale.US))
    }

    @Test
    fun numberCoercesNonFiniteToZeroLikeSafeNumber() {
        assertEquals("0.00", TirePressureFormat.number(Double.NaN, 2, Locale.US))
        assertEquals("0.00", TirePressureFormat.number(Double.POSITIVE_INFINITY, 2, Locale.US))
    }

    // ── i18n resolve-or-fallback (web t(key, default) parity) ──────────────────────

    @Test
    fun resolveOptionalReturnsCatalogValueWhenPresent() {
        val resolved =
            resolveOptional({ mapOf(KEY_ARIA to "Catalog aria")[it] }, KEY_ARIA, TirePressureSectionDefaults.ARIA_LABEL)
        assertEquals("Catalog aria", resolved)
    }

    @Test
    fun resolveOptionalFallsBackWhenKeyAbsentOrBlank() {
        assertEquals(
            TirePressureSectionDefaults.ARIA_LABEL,
            resolveOptional({ null }, KEY_ARIA, TirePressureSectionDefaults.ARIA_LABEL),
        )
        assertEquals(
            TirePressureSectionDefaults.ARIA_LABEL,
            resolveOptional({ "   " }, KEY_ARIA, TirePressureSectionDefaults.ARIA_LABEL),
        )
    }

    // ── Diagnostics (P1/S11 view.opened contract) ─────────────────────────────────

    @Test
    fun recordOpenedEmitsPiiSafeViewOpenedWithSurfaceSlug() {
        val logger = RecordingLogger()

        recordTirePressureSectionOpened(logger)

        assertEquals(1, logger.records.size)
        val (event, fields) = logger.records.single()
        assertEquals("view.opened", event)
        assertEquals(mapOf("surface" to "TirePressureSection"), fields)
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
