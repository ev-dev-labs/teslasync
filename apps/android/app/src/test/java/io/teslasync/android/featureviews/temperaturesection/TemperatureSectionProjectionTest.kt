package io.teslasync.android.featureviews.temperaturesection

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.util.Locale

/**
 * Off-device verification of the TemperatureSection pure logic — the native mirror of every derivation the
 * web component performs (web/src/features/driving/components/drive-detail/TemperatureSection.tsx): the
 * `chartData.length > 1 && stats.hasAnyTemp` empty boundary, the six conditional stat tiles (the precomputed
 * Outside/Inside averages, the component's own Driver/Passenger `reduce` averages, the climate status, and
 * the fan avg/max), the four conditional lines, the `fmtNumber(value){tempUnit}` value formatting, and the
 * `fmtInt`/raw fan figures. Because the surface is presentational, each [TemperatureSectionDisplay] is
 * exactly what the thin composable renders, so these assertions double as the per-state adapter "snapshot".
 */
class TemperatureSectionProjectionTest {
    private val celsius = "\u00B0C"
    private val fahrenheit = "\u00B0F"

    @Suppress("LongParameterList")
    private fun sample(
        time: String,
        outside: Double? = null,
        inside: Double? = null,
        driver: Double? = null,
        passenger: Double? = null,
        climateOn: Boolean? = null,
        fan: Double? = null,
    ) = TemperatureSample(time, outside, inside, driver, passenger, climateOn, fan)

    private fun project(
        samples: List<TemperatureSample>,
        unitLabel: String = celsius,
        precision: Int = 1,
    ) = TemperatureSectionProjection.project(samples, unitLabel, precision, Locale.US)

    // ── safe(): web `fmtNumber`'s `Number.isFinite(v) ? v : 0` ───────────────────

    @Test
    fun safeReturnsFiniteValuesUnchanged() {
        assertEquals(21.0, TemperatureSectionProjection.safe(21.0), 0.0)
        assertEquals(-5.5, TemperatureSectionProjection.safe(-5.5), 0.0)
        assertEquals(0.0, TemperatureSectionProjection.safe(0.0), 0.0)
    }

    @Test
    fun safeCoercesNonFiniteToZero() {
        assertEquals(0.0, TemperatureSectionProjection.safe(Double.NaN), 0.0)
        assertEquals(0.0, TemperatureSectionProjection.safe(Double.POSITIVE_INFINITY), 0.0)
        assertEquals(0.0, TemperatureSectionProjection.safe(Double.NEGATIVE_INFINITY), 0.0)
    }

    // ── formatNumber(): web `fmtNumber(value, precision)` ────────────────────────

    @Test
    fun formatNumberHonorsPrecisionAndGrouping() {
        assertEquals("21.0", TemperatureSectionProjection.formatNumber(21.0, 1, Locale.US))
        assertEquals("21.00", TemperatureSectionProjection.formatNumber(21.0, 2, Locale.US))
        assertEquals("21", TemperatureSectionProjection.formatNumber(21.0, 0, Locale.US))
        assertEquals("1,234.5", TemperatureSectionProjection.formatNumber(1234.5, 1, Locale.US))
    }

    @Test
    fun formatNumberRoundsHalfAwayFromZero() {
        assertEquals("18.3", TemperatureSectionProjection.formatNumber(18.25, 1, Locale.US))
        assertEquals("-2.3", TemperatureSectionProjection.formatNumber(-2.25, 1, Locale.US))
    }

    @Test
    fun formatNumberNormalizesNegativeZero() {
        assertEquals("0.0", TemperatureSectionProjection.formatNumber(-0.0, 1, Locale.US))
    }

    @Test
    fun formatNumberCoercesNonFiniteToZero() {
        assertEquals("0.0", TemperatureSectionProjection.formatNumber(Double.NaN, 1, Locale.US))
    }

    // ── mean(): web `arr.length ? arr.reduce(+)/arr.length : null` ───────────────

    @Test
    fun meanAveragesPresentValuesAndDropsNulls() {
        assertEquals(11.5, TemperatureSectionProjection.mean(listOf(9.0, null, 14.0))!!, 0.0)
    }

    @Test
    fun meanOfNoPresentValuesIsNull() {
        assertNull(TemperatureSectionProjection.mean(listOf(null, null)))
        assertNull(TemperatureSectionProjection.mean(emptyList()))
    }

    // ── climateStatus(): web parent classification ───────────────────────────────

    @Test
    fun climateStatusOnWhenOnDominatesOrTies() {
        assertEquals(
            ClimateStatus.On,
            TemperatureSectionProjection.climateStatus(
                listOf(sample("t", climateOn = true), sample("t", climateOn = true), sample("t", climateOn = false)),
            ),
        )
        // Tie (on == off) is still "On" (web `onCount >= offCount`).
        assertEquals(
            ClimateStatus.On,
            TemperatureSectionProjection.climateStatus(
                listOf(sample("t", climateOn = true), sample("t", climateOn = false)),
            ),
        )
    }

    @Test
    fun climateStatusMostlyOffWhenOnIsMinority() {
        assertEquals(
            ClimateStatus.MostlyOff,
            TemperatureSectionProjection.climateStatus(
                listOf(sample("t", climateOn = true), sample("t", climateOn = false), sample("t", climateOn = false)),
            ),
        )
    }

    @Test
    fun climateStatusOffWhenOnlyEverOff() {
        assertEquals(
            ClimateStatus.Off,
            TemperatureSectionProjection.climateStatus(listOf(sample("t", climateOn = false))),
        )
    }

    @Test
    fun climateStatusNullWhenNoClimateSamples() {
        assertNull(TemperatureSectionProjection.climateStatus(listOf(sample("t"), sample("t"))))
    }

    // ── project(): empty boundary ────────────────────────────────────────────────

    @Test
    fun projectSingleSampleIsEmptyEvenWithTemperature() {
        // Web `chartData.length > 1`: one sample is the empty surface, never a one-point chart.
        val display = project(listOf(sample("09:00", outside = 9.0)))
        assertTrue(display.isEmpty)
    }

    @Test
    fun projectNoTemperatureIsEmptyEvenWithManySamples() {
        val display = project(listOf(sample("09:00"), sample("09:05"), sample("09:10")))
        assertTrue(display.isEmpty)
    }

    @Test
    fun projectTwoSamplesWithTemperatureIsNotEmpty() {
        val display = project(listOf(sample("09:00", outside = 9.0), sample("09:05", outside = 11.0)))
        assertFalse(display.isEmpty)
    }

    // ── project(): tiles ─────────────────────────────────────────────────────────

    @Test
    fun projectBuildsEveryPresentTileInWebOrderWithUnit() {
        val display =
            project(
                listOf(
                    sample("09:00", outside = 9.0, inside = 18.0, driver = 21.0, passenger = 20.0, climateOn = true, fan = 3.0),
                    sample("09:05", outside = 11.0, inside = 20.0, driver = 23.0, passenger = 22.0, climateOn = true, fan = 5.0),
                ),
            )

        // Outside, Inside, Driver, Passenger, Climate, Fan — in web render order.
        assertEquals(
            listOf(
                TemperatureTile.Temp(TemperatureSeriesId.Outside, "10.0\u00B0C"),
                TemperatureTile.Temp(TemperatureSeriesId.Inside, "19.0\u00B0C"),
                TemperatureTile.Temp(TemperatureSeriesId.Driver, "22.0\u00B0C"),
                TemperatureTile.Temp(TemperatureSeriesId.Passenger, "21.0\u00B0C"),
                TemperatureTile.Climate(ClimateStatus.On),
                TemperatureTile.Fan(avg = "4", max = "5"),
            ),
            display.tiles,
        )
    }

    @Test
    fun projectOmitsTilesForAbsentSeries() {
        // Only an ambient reading + no climate/fan: just the Outside tile is present.
        val display =
            project(listOf(sample("09:00", outside = 9.0), sample("09:05", outside = 11.0)))
        assertEquals(listOf(TemperatureTile.Temp(TemperatureSeriesId.Outside, "10.0\u00B0C")), display.tiles)
    }

    @Test
    fun projectTempTileHonorsPrecisionAndUnitLabel() {
        val display =
            project(
                listOf(sample("09:00", inside = 20.0), sample("09:05", inside = 21.0)),
                unitLabel = fahrenheit,
                precision = 2,
            )
        // Values arrive pre-converted to display units; the projection only formats + appends the label.
        assertEquals(listOf(TemperatureTile.Temp(TemperatureSeriesId.Inside, "20.50\u00B0F")), display.tiles)
    }

    @Test
    fun projectDriverAndPassengerAveragesAreComputedFromSamples() {
        val display =
            project(
                listOf(
                    sample("09:00", driver = 20.0, passenger = 24.0),
                    sample("09:05", driver = 22.0, passenger = 26.0),
                ),
            )
        assertEquals(
            listOf(
                TemperatureTile.Temp(TemperatureSeriesId.Driver, "21.0\u00B0C"),
                TemperatureTile.Temp(TemperatureSeriesId.Passenger, "25.0\u00B0C"),
            ),
            display.tiles,
        )
    }

    @Test
    fun projectFanTileUsesIntegerAvgAndRawMax() {
        val display =
            project(
                listOf(
                    sample("09:00", outside = 9.0, fan = 2.0),
                    sample("09:05", outside = 9.0, fan = 5.0),
                    sample("09:10", outside = 9.0, fan = 6.0),
                ),
            )
        val fan = display.tiles.filterIsInstance<TemperatureTile.Fan>().single()
        // mean(2,5,6) = 4.33 -> fmtInt -> "4"; max = 6 -> raw "6".
        assertEquals("4", fan.avg)
        assertEquals("6", fan.max)
    }

    // ── project(): lines + x labels ──────────────────────────────────────────────

    @Test
    fun projectBuildsOnlyPresentLinesInWebOrderPreservingSamples() {
        val samples =
            listOf(
                sample("09:00", outside = 9.0, passenger = 20.0),
                sample("09:05", outside = null, passenger = 22.0),
            )
        val display = project(samples)

        assertEquals(listOf(TemperatureSeriesId.Outside, TemperatureSeriesId.Passenger), display.series.map { it.id })
        // Sample order + null gaps are preserved exactly.
        assertEquals(listOf(9.0, null), display.series.first { it.id == TemperatureSeriesId.Outside }.values)
        assertEquals(listOf(20.0, 22.0), display.series.first { it.id == TemperatureSeriesId.Passenger }.values)
        assertEquals(listOf("09:00", "09:05"), display.xLabels)
    }

    @Test
    fun projectPassesUnitLabelThrough() {
        val display = project(listOf(sample("09:00", outside = 9.0), sample("09:05", outside = 11.0)), unitLabel = fahrenheit)
        assertEquals(fahrenheit, display.unitLabel)
    }

    // ── resolveDisplayLocale(): web `fmtNumber` locale default ───────────────────

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
}
