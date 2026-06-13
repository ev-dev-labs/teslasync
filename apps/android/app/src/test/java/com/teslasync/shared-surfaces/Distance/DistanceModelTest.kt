// Off-device unit coverage for the Distance surface's pure model (P3 acceptance: adapter + per-state +
// a11y-label tests). Exercises the prompt-mandated registration slug, the web-source constants, the
// input -> SI-metres normalisation, the shared `convertDistanceFromSI` round-trip in both the metric and
// imperial directions, the `fmtNumber`-parity grouped formatter (locale grouping, fixed decimals,
// non-finite -> 0), the precision resolution (`prop ?? settings ?? 2`, negatives ignored, clamped), the
// `toFixed`-parity raw-value title, the em-dash no-value branch, the accessibility label the composable
// exposes, the locale resolver, and the PII-safe `view.opened` diagnostic. No Compose / Android framework
// / HTTP — runs in :android:testReleaseUnitTest. A fixed Locale.US pins the grouping separators so the
// assertions never depend on the host machine's locale. Reference values are the strings + behaviour the
// web `Distance` produces (web/src/components/data-display/format/__tests__/Format.test.tsx).
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.distance

import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.LogRecord
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.units.DistanceUnitPref
import io.teslasync.shared.core.units.DurationUnitPref
import io.teslasync.shared.core.units.EnergyUnitPref
import io.teslasync.shared.core.units.PowerUnitPref
import io.teslasync.shared.core.units.PressureUnitPref
import io.teslasync.shared.core.units.SpeedUnitPref
import io.teslasync.shared.core.units.TemperatureUnitPref
import io.teslasync.shared.core.units.UnitPref
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.util.Locale

class DistanceModelTest {
    private val locale = Locale.US

    private fun prefs(
        distance: DistanceUnitPref,
        precision: Int? = null,
        localeTag: String? = "en-US",
    ): UnitPref =
        UnitPref(
            distance = distance,
            speed = SpeedUnitPref.KMH,
            temperature = TemperatureUnitPref.CELSIUS,
            pressure = PressureUnitPref.BAR,
            energy = EnergyUnitPref.KWH,
            duration = DurationUnitPref.HOURS,
            power = PowerUnitPref.KW,
            locale = localeTag,
            precision = precision,
        )

    private fun project(
        input: DistanceInput,
        prefs: UnitPref,
    ): DistanceDisplay = DistanceProjection.project(input, prefs, locale)

    // ── registration metadata mirrors the prompt-mandated surface slug ────────────────

    @Test
    fun registrationSlugIsThePromptSurfaceSlug() {
        assertEquals("distance", DistanceRegistration.ID)
        assertEquals("Distance", DistanceRegistration.SLUG)
    }

    @Test
    fun defaultsMatchTheWebSource() {
        // web `miles * 1609.344`, `km * 1000`, `fmtNumber` global default `decimal_precision ?? 2`.
        assertEquals(1609.344, DistanceDefaults.METERS_PER_MILE, 1e-9)
        assertEquals(1000.0, DistanceDefaults.METERS_PER_KM, 1e-9)
        assertEquals(2, DistanceDefaults.DEFAULT_PRECISION)
        assertEquals(2, DistanceDefaults.TITLE_PRECISION)
        assertEquals("\u2014", DistanceDefaults.EMPTY)
    }

    // ── web parity vectors (Format.test.tsx) ──────────────────────────────────────────

    @Test
    fun rendersMetricDistanceFromKmInput() {
        // web: <Distance km={100} precision={1} /> with metric prefs -> "100.0 km", title "100.00 km".
        val display = project(DistanceInput(km = 100.0, precision = 1), prefs(DistanceUnitPref.KM))
        display as DistanceDisplay.Value
        assertEquals("100.0 km", display.text)
        assertEquals("100.00 km", display.title)
    }

    @Test
    fun rendersImperialDistanceFromMilesInput() {
        // web: <Distance miles={62.1371} precision={1} /> imperial -> "62.1 mi", title "62.14 mi".
        val display = project(DistanceInput(miles = 62.1371, precision = 1), prefs(DistanceUnitPref.MI))
        display as DistanceDisplay.Value
        assertEquals("62.1 mi", display.text)
        assertEquals("62.14 mi", display.title)
    }

    @Test
    fun convertsKmInputToMilesWhenUserPrefersImperial() {
        // web: <Distance km={100} precision={1} /> with imperial prefs -> 100 km ≈ "62.1 mi".
        val display = project(DistanceInput(km = 100.0, precision = 1), prefs(DistanceUnitPref.MI))
        display as DistanceDisplay.Value
        assertEquals("62.1 mi", display.text)
        // The title still reports the RAW caller value in its original unit (km), `toFixed(2)`.
        assertEquals("100.00 km", display.title)
    }

    @Test
    fun prefersMilesWhenBothMilesAndKmAreSupplied() {
        // web: <Distance miles={50} km={9999} precision={0} /> imperial -> "50 mi" (km ignored).
        val display = project(DistanceInput(miles = 50.0, km = 9999.0, precision = 0), prefs(DistanceUnitPref.MI))
        display as DistanceDisplay.Value
        assertEquals("50 mi", display.text)
        assertEquals("50.00 mi", display.title)
    }

    // ── empty (no-value) branch: null / absent / NaN / Infinity -> em dash ─────────────

    @Test
    fun rendersEmDashForNullMiles() {
        // web: <Distance miles={null} /> -> "—".
        assertEquals(DistanceDisplay.Empty, project(DistanceInput(miles = null), prefs(DistanceUnitPref.KM)))
    }

    @Test
    fun rendersEmDashWhenBothInputsAreAbsent() {
        // web: <Distance /> -> "—".
        assertEquals(DistanceDisplay.Empty, project(DistanceInput(), prefs(DistanceUnitPref.KM)))
    }

    @Test
    fun rendersEmDashForNonFiniteInputs() {
        // web: <Distance miles={NaN} /> -> "—"; Infinity is likewise non-finite.
        assertEquals(DistanceDisplay.Empty, project(DistanceInput(miles = Double.NaN), prefs(DistanceUnitPref.KM)))
        assertEquals(
            DistanceDisplay.Empty,
            project(DistanceInput(km = Double.POSITIVE_INFINITY), prefs(DistanceUnitPref.KM)),
        )
    }

    @Test
    fun emptyDisplayHasEmDashTextAndNoTitle() {
        val display = DistanceDisplay.Empty
        assertEquals("\u2014", display.text)
        assertNull(display.title)
    }

    // ── precision resolution: prop ?? settings ?? 2, negatives ignored, clamped ────────

    @Test
    fun defaultPrecisionIsTwoWhenNeitherPropNorSettingSupplied() {
        // web `fmtNumber(value, undefined)` falls back to `_globalPrecision` = `decimal_precision ?? 2`.
        val display = project(DistanceInput(km = 1.5), prefs(DistanceUnitPref.KM, precision = null))
        display as DistanceDisplay.Value
        assertEquals("1.50 km", display.text)
    }

    @Test
    fun settingsPrecisionIsUsedWhenNoPropOverride() {
        val display = project(DistanceInput(km = 1.5), prefs(DistanceUnitPref.KM, precision = 3))
        display as DistanceDisplay.Value
        assertEquals("1.500 km", display.text)
    }

    @Test
    fun propPrecisionOverridesSettingsPrecision() {
        val display = project(DistanceInput(km = 12.0, precision = 0), prefs(DistanceUnitPref.KM, precision = 3))
        display as DistanceDisplay.Value
        assertEquals("12 km", display.text)
    }

    @Test
    fun resolvePrecisionFollowsTheWebPrecedence() {
        assertEquals(1, DistanceProjection.resolvePrecision(override = 1, prefPrecision = 3))
        assertEquals(3, DistanceProjection.resolvePrecision(override = null, prefPrecision = 3))
        assertEquals(2, DistanceProjection.resolvePrecision(override = null, prefPrecision = null))
        // Negative overrides are ignored (Intl would throw); fall through to the next source.
        assertEquals(3, DistanceProjection.resolvePrecision(override = -1, prefPrecision = 3))
        assertEquals(2, DistanceProjection.resolvePrecision(override = -1, prefPrecision = -5))
        // Bounded to the web setGlobalPrecision ceiling.
        assertEquals(20, DistanceProjection.resolvePrecision(override = 99, prefPrecision = null))
    }

    // ── fmtNumber parity: locale grouping with fixed decimals ─────────────────────────

    @Test
    fun displayValueIsGroupedWithFixedDecimals() {
        val display = project(DistanceInput(km = 12345.6, precision = 1), prefs(DistanceUnitPref.KM))
        display as DistanceDisplay.Value
        assertEquals("12,345.6 km", display.text)
    }

    // ── a11y label: the rendered text IS the node's content description ────────────────

    @Test
    fun renderedTextIsTheAccessibleLabel() {
        // The composable sets the node's contentDescription to DistanceDisplay.text, so asserting that
        // string off-device is the a11y-label coverage for both the value and the no-value branch.
        val value = project(DistanceInput(km = 100.0, precision = 1), prefs(DistanceUnitPref.KM))
        assertEquals("100.0 km", value.text)
        assertEquals("\u2014", DistanceDisplay.Empty.text)
    }

    // ── locale resolution: blank/null -> en-US, otherwise the tagged locale ────────────

    @Test
    fun resolveLocaleFallsBackToEnUsForBlankTags() {
        assertEquals(Locale.US, DistanceProjection.resolveLocale(null))
        assertEquals(Locale.US, DistanceProjection.resolveLocale(""))
        assertEquals(Locale.US, DistanceProjection.resolveLocale("   "))
    }

    @Test
    fun resolveLocaleHonoursAnExplicitTag() {
        assertEquals(Locale.forLanguageTag("de-DE"), DistanceProjection.resolveLocale("de-DE"))
    }

    // ── diagnostics: one PII-safe view.opened ─────────────────────────────────────────

    @Test
    fun recordViewOpenedEmitsPiiSafeSurfaceSlug() {
        val records = mutableListOf<LogRecord>()
        val logger =
            object : Logger {
                override fun log(
                    level: LogLevel,
                    event: String,
                    fields: Map<String, String>,
                ) {
                    records += LogRecord(level, event, fields)
                }
            }
        DistanceDiagnostics.recordViewOpened(logger)
        assertEquals(1, records.size)
        assertEquals(LogLevel.Info, records[0].level)
        assertEquals("view.opened", records[0].event)
        // Only the surface slug — no rendered distance / raw value / unit can leak through the diagnostic.
        assertEquals(mapOf("surface" to "Distance"), records[0].fields)
        assertTrue(records[0].fields.values.none { it.contains("km") || it.contains("mi") })
    }
}
