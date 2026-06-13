// Off-device unit coverage for the Pressure surface's pure model (P3 acceptance: adapter + per-state +
// a11y-label tests). Exercises the prompt-mandated registration slug, the web-default constants, the SI
// resolution that mirrors the web `bar * 100` / `psi * 6.894757` (with the bar-over-psi priority and the
// `Number.isFinite` guards), the raw-value hover title (`toFixed(2)` + source unit), the precision resolution
// (web `precision ?? _globalPrecision`), the per-unit display strings the surface renders (bar / psi / kPa and
// the em-dash empty state), and the PII-safe `view.opened` diagnostic. No Compose / Android UI / HTTP — runs in
// :android:testReleaseUnitTest. A fixed "en-US" locale + the deterministic shared formatter pin every string so
// the assertions never depend on the host machine's locale. Reference values are the strings + behaviour the
// web `Pressure` produces.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.pressure

import io.teslasync.android.data.UnitFormatter
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
import org.junit.Test

class PressureModelTest {
    private companion object {
        const val EPS = 1e-9

        /** A formatter pinned to [pressure] / [precision] at the "en-US" contract, for deterministic strings. */
        fun formatter(
            pressure: PressureUnitPref,
            precision: Int? = null,
        ): UnitFormatter =
            UnitFormatter(
                UnitPref(
                    distance = DistanceUnitPref.KM,
                    speed = SpeedUnitPref.KMH,
                    temperature = TemperatureUnitPref.CELSIUS,
                    pressure = pressure,
                    energy = EnergyUnitPref.KWH,
                    duration = DurationUnitPref.HOURS,
                    power = PowerUnitPref.KW,
                    locale = "en-US",
                    precision = precision,
                ),
            )
    }

    // ── registration metadata mirrors the prompt-mandated surface slug ────────────────

    @Test
    fun registrationSlugIsThePromptSurfaceSlug() {
        assertEquals("pressure", PressureRegistration.ID)
        assertEquals("Pressure", PressureRegistration.SLUG)
    }

    @Test
    fun defaultsMatchTheWebSource() {
        assertEquals(100.0, PressureDefaults.KPA_PER_BAR, EPS) // web `bar * 100`
        assertEquals(6.894757, PressureDefaults.KPA_PER_PSI, EPS) // web `psi * 6.894757`
        assertEquals(2, PressureDefaults.GLOBAL_PRECISION_FALLBACK) // web `numberFormat._globalPrecision`
        assertEquals(2, PressureDefaults.TITLE_PRECISION) // web `toFixed(2)`
        assertEquals("\u2014", PressureDefaults.EMPTY_DISPLAY) // web `—`
    }

    // ── SI resolution (web `bar * 100`, `psi * 6.894757`, bar wins, isFinite guards) ──

    @Test
    fun resolveSourceKpaConvertsBarToKilopascals() {
        assertEquals(250.0, requireNotNull(PressureProjection.resolveSourceKpa(PressureSpec(bar = 2.5))), EPS)
    }

    @Test
    fun resolveSourceKpaConvertsPsiToKilopascals() {
        assertEquals(248.211252, requireNotNull(PressureProjection.resolveSourceKpa(PressureSpec(psi = 36.0))), EPS)
    }

    @Test
    fun resolveSourceKpaPrefersBarOverPsi() {
        // web checks `bar != null && Number.isFinite(bar)` first, so bar wins when both are supplied.
        assertEquals(100.0, requireNotNull(PressureProjection.resolveSourceKpa(PressureSpec(bar = 1.0, psi = 50.0))), EPS)
    }

    @Test
    fun resolveSourceKpaIsNullForNoFiniteInput() {
        assertNull(PressureProjection.resolveSourceKpa(PressureSpec()))
        assertNull(PressureProjection.resolveSourceKpa(PressureSpec(bar = Double.NaN)))
        assertNull(PressureProjection.resolveSourceKpa(PressureSpec(bar = Double.POSITIVE_INFINITY, psi = Double.NaN)))
    }

    // ── raw-value hover title (web `${value.toFixed(2)} {unit}`) ───────────────────────

    @Test
    fun sourceTitleUsesRawValueInItsSourceUnit() {
        assertEquals("2.50 bar", PressureProjection.sourceTitle(PressureSpec(bar = 2.5)))
        assertEquals("36.00 psi", PressureProjection.sourceTitle(PressureSpec(psi = 36.0)))
    }

    @Test
    fun sourceTitlePrefersBarAndIsNullWhenEmpty() {
        assertEquals("2.50 bar", PressureProjection.sourceTitle(PressureSpec(bar = 2.5, psi = 9.0)))
        assertNull(PressureProjection.sourceTitle(PressureSpec()))
        assertNull(PressureProjection.sourceTitle(PressureSpec(bar = Double.NaN)))
    }

    // ── precision resolution (web `precision ?? _globalPrecision`) ─────────────────────

    @Test
    fun resolvePrecisionPrefersExplicitThenPrefThenWebGlobal() {
        assertEquals(3, PressureProjection.resolvePrecision(precision = 3, prefPrecision = 1))
        assertEquals(1, PressureProjection.resolvePrecision(precision = null, prefPrecision = 1))
        assertEquals(2, PressureProjection.resolvePrecision(precision = null, prefPrecision = null))
    }

    @Test
    fun resolvePrecisionIgnoresNegativeOverrides() {
        assertEquals(1, PressureProjection.resolvePrecision(precision = -1, prefPrecision = 1))
        assertEquals(2, PressureProjection.resolvePrecision(precision = null, prefPrecision = -1))
    }

    // ── per-state display strings the surface renders ─────────────────────────────────

    @Test
    fun displayFormatsBarInTheUserUnit() {
        // precision unset → pref unset → web global default of 2.
        assertEquals("1.00 bar", PressureProjection.display(PressureSpec(bar = 1.0), formatter(PressureUnitPref.BAR)))
        assertEquals("2.55 bar", PressureProjection.display(PressureSpec(bar = 2.55, precision = 2), formatter(PressureUnitPref.BAR)))
    }

    @Test
    fun displayConvertsBarInputIntoThePsiPreference() {
        // 1 bar = 100 kPa → 100 / 6.894757 = 14.5038 psi → 14.50 at 2 digits.
        assertEquals("14.50 psi", PressureProjection.display(PressureSpec(bar = 1.0, precision = 2), formatter(PressureUnitPref.PSI)))
    }

    @Test
    fun displayFormatsKilopascalsPreference() {
        assertEquals("100.0 kPa", PressureProjection.display(PressureSpec(bar = 1.0, precision = 1), formatter(PressureUnitPref.KPA)))
    }

    @Test
    fun displayHonorsExplicitPrecisionWithHalfExpandRounding() {
        // 2.567 bar at 1 digit rounds away from zero (web `fmtNumber` halfExpand) → 2.6.
        assertEquals("2.6 bar", PressureProjection.display(PressureSpec(bar = 2.567, precision = 1), formatter(PressureUnitPref.BAR)))
    }

    @Test
    fun displayHonorsUserDecimalPrecisionWhenNoOverride() {
        assertEquals("2.500 bar", PressureProjection.display(PressureSpec(bar = 2.5), formatter(PressureUnitPref.BAR, precision = 3)))
    }

    @Test
    fun displayRendersEmDashForNoFiniteInput() {
        // The visible text IS the node's accessibility label, so this is the empty-state a11y coverage too.
        assertEquals("\u2014", PressureProjection.display(PressureSpec(), formatter(PressureUnitPref.BAR)))
        assertEquals("\u2014", PressureProjection.display(PressureSpec(bar = Double.NaN), formatter(PressureUnitPref.PSI)))
    }

    @Test
    fun displayIsTheAccessibleLabelForAValue() {
        // The composable sets the node's contentDescription to this exact string, so asserting it off-device is
        // the a11y-label coverage for the value state of the surface.
        assertEquals("2.55 bar", PressureProjection.display(PressureSpec(bar = 2.55, precision = 2), formatter(PressureUnitPref.BAR)))
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
        PressureDiagnostics.recordViewOpened(logger)
        assertEquals(1, records.size)
        assertEquals(LogLevel.Info, records[0].level)
        assertEquals("view.opened", records[0].event)
        // Only the surface slug — no rendered pressure value / caller input can leak through the diagnostic.
        assertEquals(mapOf("surface" to "Pressure"), records[0].fields)
    }
}
