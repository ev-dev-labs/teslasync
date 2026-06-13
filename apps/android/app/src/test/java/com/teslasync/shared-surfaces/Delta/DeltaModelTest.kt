// Off-device unit coverage for the Delta surface's pure model (P3 acceptance: adapter + per-state + a11y
// pieces). Exercises the registration slug the prompt mandates, the settings → [DeltaUnitContext]
// derivation that mirrors the web `useUnits` + `useFormatting` hooks, the `useUnitLabels` switch port,
// the absolute formatter, every [DeltaProjection] branch (loading / empty / resolved with the percent /
// absolute / both forms, the `previous == 0` percent fallback, sign / tone / arrow), and the PII-safe
// `view.opened` diagnostic. No Compose / Android framework / HTTP — runs in :android:testReleaseUnitTest.
// Reference values are the strings + behaviour the web `Delta` produces (en-US locale).
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.delta

import io.teslasync.android.components.datadisplay.DeltaArrow
import io.teslasync.android.components.datadisplay.DeltaDisplay
import io.teslasync.android.components.datadisplay.DeltaTone
import io.teslasync.android.components.datadisplay.Direction
import io.teslasync.android.components.datadisplay.MetricSemantic
import io.teslasync.android.components.datadisplay.MetricUnit
import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.LogRecord
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.units.DistanceUnitPref
import io.teslasync.shared.core.units.SpeedUnitPref
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.util.Locale

class DeltaModelTest {
    private class RecordingLogger : Logger {
        val records = mutableListOf<LogRecord>()

        override fun log(
            level: LogLevel,
            event: String,
            fields: Map<String, String>,
        ) {
            records += LogRecord(level, event, fields)
        }
    }

    private val energy = MetricSemantic("energy_consumed", Direction.LowerBetter, MetricUnit.Energy)
    private val range = MetricSemantic("range", Direction.HigherBetter, MetricUnit.Distance)
    private val percent = MetricSemantic("regen_pct", Direction.HigherBetter, MetricUnit.Percent)

    // ── registration metadata mirrors the prompt-mandated surface slug ────────────────

    @Test
    fun registrationSlugIsThePromptSurfaceSlug() {
        assertEquals("delta", DeltaRegistration.ID)
        assertEquals("Delta", DeltaRegistration.SLUG)
    }

    // ── settings → context (web useUnits + useFormatting) ─────────────────────────────

    @Test
    fun contextDefaultsToMetricWhenSettingsAbsent() {
        val context = DeltaUnitContext.fromSettings(null)
        assertEquals(DistanceUnitPref.KM, context.prefs.distance)
        assertEquals(SpeedUnitPref.KMH, context.prefs.speed)
        assertEquals("$", context.currencySymbol)
        assertNull(context.precision)
    }

    @Test
    fun contextDerivesImperialUnitsFromSettings() {
        val context = DeltaUnitContext.fromSettings(imperialSettings())
        assertEquals(DistanceUnitPref.MI, context.prefs.distance)
        assertEquals(SpeedUnitPref.MPH, context.prefs.speed)
    }

    @Test
    fun contextReadsCurrencySymbolAndPrecision() {
        val context =
            DeltaUnitContext.fromSettings(
                buildJsonObject {
                    put("currency_symbol", "€")
                    put("decimal_precision", 3)
                },
            )
        assertEquals("€", context.currencySymbol)
        assertEquals(3, context.precision)
    }

    @Test
    fun blankCurrencySymbolFallsBackToDollar() {
        val context = DeltaUnitContext.fromSettings(buildJsonObject { put("currency_symbol", "   ") })
        assertEquals("$", context.currencySymbol)
    }

    // ── useUnitLabels switch (web) ────────────────────────────────────────────────────

    @Test
    fun unitLabelsResolveAgainstTheMetricContext() {
        val metric = DeltaUnitContext.fromSettings(null)
        assertEquals(DeltaUnitLabels("$", ""), resolveUnitLabels(MetricUnit.Currency, metric))
        assertEquals(DeltaUnitLabels("", "%"), resolveUnitLabels(MetricUnit.Percent, metric))
        assertEquals(DeltaUnitLabels("", "km"), resolveUnitLabels(MetricUnit.Distance, metric))
        assertEquals(DeltaUnitLabels("", "kWh"), resolveUnitLabels(MetricUnit.Energy, metric))
        assertEquals(DeltaUnitLabels("", "Wh"), resolveUnitLabels(MetricUnit.EnergyWh, metric))
        assertEquals(DeltaUnitLabels("", "Wh/km"), resolveUnitLabels(MetricUnit.Efficiency, metric))
        assertEquals(DeltaUnitLabels("", "h"), resolveUnitLabels(MetricUnit.Hours, metric))
        assertEquals(DeltaUnitLabels("", "min"), resolveUnitLabels(MetricUnit.Minutes, metric))
        assertEquals(DeltaUnitLabels("", "km/h"), resolveUnitLabels(MetricUnit.Speed, metric))
        assertEquals(DeltaUnitLabels("", "\u00B0C"), resolveUnitLabels(MetricUnit.Temperature, metric))
        assertEquals(DeltaUnitLabels("", "bar"), resolveUnitLabels(MetricUnit.Pressure, metric))
        assertEquals(DeltaUnitLabels("", ""), resolveUnitLabels(MetricUnit.Count, metric))
    }

    @Test
    fun unitLabelsFollowImperialPreference() {
        val imperial = DeltaUnitContext.fromSettings(imperialSettings())
        assertEquals(DeltaUnitLabels("", "mi"), resolveUnitLabels(MetricUnit.Distance, imperial))
        assertEquals(DeltaUnitLabels("", "mph"), resolveUnitLabels(MetricUnit.Speed, imperial))
        assertEquals(DeltaUnitLabels("", "Wh/mi"), resolveUnitLabels(MetricUnit.Efficiency, imperial))
    }

    // ── formatAbsolute (web formatAbsolute) ───────────────────────────────────────────

    @Test
    fun formatAbsoluteCoversEveryPrefixSuffixCombination() {
        assertEquals("$5.00 kWh", formatAbsolute(5.0, DeltaUnitLabels("$", "kWh"), 2, Locale.US))
        assertEquals("$5.00", formatAbsolute(5.0, DeltaUnitLabels("$", ""), 2, Locale.US))
        assertEquals("5.00%", formatAbsolute(5.0, DeltaUnitLabels("", "%"), 2, Locale.US))
        assertEquals("5.00 kWh", formatAbsolute(5.0, DeltaUnitLabels("", "kWh"), 2, Locale.US))
        assertEquals("5.00", formatAbsolute(5.0, DeltaUnitLabels("", ""), 2, Locale.US))
    }

    // ── projection: loading / empty branches ──────────────────────────────────────────

    @Test
    fun loadingInputProjectsLoading() {
        val projection = DeltaProjection.project(DeltaInput(10.0, 8.0, energy, loading = true), DeltaUnitContext.DEFAULT)
        assertEquals(DeltaProjection.Loading, projection)
    }

    @Test
    fun missingOrNonFiniteInputsProjectEmptyWithComparedTo() {
        val context = DeltaUnitContext.DEFAULT
        val withLabel = DeltaInput(null, 8.0, energy, comparedTo = "vs last week")
        assertEquals(DeltaProjection.Empty("vs last week"), DeltaProjection.project(withLabel, context))
        assertEquals(DeltaProjection.Empty(null), DeltaProjection.project(DeltaInput(10.0, null, energy), context))
        assertEquals(DeltaProjection.Empty(null), DeltaProjection.project(DeltaInput(Double.NaN, 8.0, energy), context))
        assertEquals(DeltaProjection.Empty(null), DeltaProjection.project(DeltaInput(10.0, Double.POSITIVE_INFINITY, energy), context))
    }

    // ── projection: resolved value branch ─────────────────────────────────────────────

    @Test
    fun percentDisplayRendersSignedArrowToneAndPositiveMagnitude() {
        val projection =
            DeltaProjection.project(DeltaInput(120.0, 100.0, range, comparedTo = "vs last week"), DeltaUnitContext.DEFAULT)
        val value = projection as DeltaProjection.Value
        assertEquals(DeltaArrow.Up, value.arrow)
        assertEquals(DeltaTone.Good, value.tone)
        assertEquals("20.0%", value.valueText)
        assertEquals("vs last week", value.comparedTo)
        assertEquals("120.00", value.currentText)
        assertEquals("100.00", value.previousText)
    }

    @Test
    fun lowerBetterIncreaseIsColouredBad() {
        val projection = DeltaProjection.project(DeltaInput(120.0, 100.0, energy), DeltaUnitContext.DEFAULT)
        assertEquals(DeltaTone.Bad, (projection as DeltaProjection.Value).tone)
        assertEquals(DeltaArrow.Up, projection.arrow)
    }

    @Test
    fun zeroDeltaIsMutedWithFlatArrow() {
        val projection = DeltaProjection.project(DeltaInput(100.0, 100.0, energy), DeltaUnitContext.DEFAULT)
        val value = projection as DeltaProjection.Value
        assertEquals(DeltaTone.Muted, value.tone)
        assertEquals(DeltaArrow.Flat, value.arrow)
        assertEquals("0.0%", value.valueText)
    }

    @Test
    fun absoluteDisplayUsesUnitSuffixAndDefaultPrecision() {
        val projection =
            DeltaProjection.project(DeltaInput(12.0, 10.0, energy, display = DeltaDisplay.Absolute), DeltaUnitContext.DEFAULT)
        assertEquals("2.00 kWh", (projection as DeltaProjection.Value).valueText)
    }

    @Test
    fun bothDisplayAppendsPercentInParentheses() {
        val projection =
            DeltaProjection.project(DeltaInput(12.0, 10.0, energy, display = DeltaDisplay.Both), DeltaUnitContext.DEFAULT)
        assertEquals("2.00 kWh (20.0%)", (projection as DeltaProjection.Value).valueText)
    }

    @Test
    fun previousZeroFallsBackToEmDashForPercentButShowsAbsolute() {
        val context = DeltaUnitContext.DEFAULT
        val asPercent = DeltaProjection.project(DeltaInput(5.0, 0.0, energy, display = DeltaDisplay.Percent), context)
        assertEquals(EM_DASH, (asPercent as DeltaProjection.Value).valueText)
        val asAbsolute = DeltaProjection.project(DeltaInput(5.0, 0.0, energy, display = DeltaDisplay.Absolute), context)
        assertEquals("5.00 kWh", (asAbsolute as DeltaProjection.Value).valueText)
        val asBoth = DeltaProjection.project(DeltaInput(5.0, 0.0, energy, display = DeltaDisplay.Both), context)
        assertEquals("5.00 kWh", (asBoth as DeltaProjection.Value).valueText)
    }

    @Test
    fun callerPrecisionOverridesTheDefault() {
        val projection =
            DeltaProjection.project(DeltaInput(15.0, 10.0, percent, display = DeltaDisplay.Both, precision = 0), DeltaUnitContext.DEFAULT)
        assertEquals("5% (50%)", (projection as DeltaProjection.Value).valueText)
    }

    // ── diagnostics: PII-safe view.opened ─────────────────────────────────────────────

    @Test
    fun recordDeltaOpenedEmitsSlugOnlyDiagnostic() {
        val logger = RecordingLogger()
        recordDeltaOpened(logger)
        val record = logger.records.single { it.event == "view.opened" }
        assertEquals(mapOf("surface" to "Delta"), record.fields)
        assertTrue(record.fields.values.none { it.contains("vs") })
    }

    private fun imperialSettings(): JsonObject = buildJsonObject { put("unit_of_length", "mi") }
}
