// Off-device unit coverage for the Speed surface's pure model (P3 acceptance: adapter + per-state + a11y-label
// tests). Exercises the prompt-mandated registration slug, the two source-unit → SI factors (web `mph * 0.44704`
// and `kmh * 1000 / 3600`), the mph-wins precedence and `Number.isFinite` fall-through, the SINGLE SI → display
// conversion (web `toSpeedDisplay` = `convertSpeedFromSI`), the `fmtNumber`-parity formatter (locale grouping,
// fixed decimals, non-finite → 0, default precision = the user's `decimal_precision`/2), the hover-title assembly
// (web `toFixed(1)` + source unit), the em-dash empty branch, the rendered string the composable exposes as its
// accessibility label, and the PII-safe `view.opened` diagnostic. No Compose / Android framework / HTTP — runs in
// :app:testReleaseUnitTest. A fixed Locale.US pins the grouping separators so the assertions never depend on the
// host machine's locale. Reference values are the strings + behaviour the web `Speed` produces.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.speed

import io.teslasync.android.data.UnitFormatter
import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.LogRecord
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.units.SpeedUnitPref
import io.teslasync.shared.core.units.UnitPref
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.util.Locale

class SpeedModelTest {
    // Metric default (km/h, precision unset) and imperial (mph) preferences, both en-US — the two display
    // preferences the web `useUnits` derives from `unit_of_length`.
    private val metricPrefs: UnitPref = UnitFormatter.default().prefs
    private val imperialPrefs: UnitPref = metricPrefs.copy(speed = SpeedUnitPref.MPH)

    // ── registration metadata mirrors the prompt-mandated surface slug ────────────────

    @Test
    fun registrationSlugIsThePromptSurfaceSlug() {
        assertEquals("speed", SpeedRegistration.ID)
        assertEquals("Speed", SpeedRegistration.SLUG)
    }

    @Test
    fun defaultPrecisionMatchesTheWebGlobal() {
        // web `fmtNumber`'s `_globalPrecision` default is the user's `decimal_precision`, 2 when unset.
        assertEquals(2, DEFAULT_DECIMAL_PRECISION)
        assertNull("default prefs leave precision unset so the surface falls back to the global", metricPrefs.precision)
    }

    // ── source-unit → SI (web `mph * 0.44704`, `kmh * 1000 / 3600`) ───────────────────

    @Test
    fun mphConvertsToMetersPerSecond() {
        // 65 mph * 0.44704 = 29.0576 m/s.
        assertEquals(29.0576, requireNotNull(SpeedProjection.sourceMetersPerSecond(SpeedSpec(mph = 65.0))), 1e-9)
    }

    @Test
    fun kmhConvertsToMetersPerSecond() {
        // 100 km/h * 1000 / 3600 = 27.7778 m/s.
        assertEquals(100.0 * 1000.0 / 3600.0, requireNotNull(SpeedProjection.sourceMetersPerSecond(SpeedSpec(kmh = 100.0))), 1e-9)
    }

    @Test
    fun mphWinsWhenBothSourcesArePresent() {
        // web `if (mph) … else if (kmh)` — mph takes precedence over kmh.
        val mps = requireNotNull(SpeedProjection.sourceMetersPerSecond(SpeedSpec(mph = 65.0, kmh = 200.0)))
        assertEquals(65.0 * 0.44704, mps, 1e-9)
    }

    @Test
    fun nonFiniteMphFallsThroughToKmh() {
        // web `Number.isFinite(mph)` guard — a NaN/Infinity mph is skipped and kmh is used instead.
        val nan = requireNotNull(SpeedProjection.sourceMetersPerSecond(SpeedSpec(mph = Double.NaN, kmh = 100.0)))
        assertEquals(100.0 * 1000.0 / 3600.0, nan, 1e-9)
        val inf = requireNotNull(SpeedProjection.sourceMetersPerSecond(SpeedSpec(mph = Double.POSITIVE_INFINITY, kmh = 100.0)))
        assertEquals(100.0 * 1000.0 / 3600.0, inf, 1e-9)
    }

    @Test
    fun noFiniteSourceYieldsNull() {
        assertNull(SpeedProjection.sourceMetersPerSecond(SpeedSpec()))
        assertNull(SpeedProjection.sourceMetersPerSecond(SpeedSpec(mph = Double.NaN)))
        assertNull(SpeedProjection.sourceMetersPerSecond(SpeedSpec(kmh = Double.NEGATIVE_INFINITY)))
    }

    // ── hover title: raw caller value with its SOURCE unit (web `toFixed(1)`) ──────────

    @Test
    fun titleShowsRawMphSourceValue() {
        assertEquals("65.0 mph", SpeedProjection.title(SpeedSpec(mph = 65.0)))
        assertEquals("65.4 mph", SpeedProjection.title(SpeedSpec(mph = 65.43)))
    }

    @Test
    fun titleShowsRawKmhSourceValue() {
        assertEquals("100.0 km/h", SpeedProjection.title(SpeedSpec(kmh = 100.0)))
    }

    @Test
    fun titleIsNullWhenNoValue() {
        assertNull(SpeedProjection.title(SpeedSpec()))
    }

    // ── cached(prefs) → projection adapter: render-ready display per state ─────────────

    @Test
    fun displayImperialFormatsAtDefaultPrecision() {
        // 65 mph round-trips to 65 in the mph preference; default precision 2 → "65.00 mph".
        val d = SpeedProjection.display(SpeedSpec(mph = 65.0), imperialPrefs, Locale.US)
        assertEquals("65.00", d.number)
        assertEquals("mph", d.unitLabel)
        assertEquals("65.00 mph", d.text)
        assertEquals("65.0 mph", d.title)
        assertTrue(d.hasValue)
    }

    @Test
    fun displayImperialHonorsPrecisionOverride() {
        val d = SpeedProjection.display(SpeedSpec(mph = 65.0, precision = 0), imperialPrefs, Locale.US)
        assertEquals("65 mph", d.text)
    }

    @Test
    fun displayConvertsMphSourceIntoMetricPreference() {
        // 65 mph shown in the km/h preference: 29.0576 m/s → 104.60736 km/h → "104.61 km/h" at precision 2.
        val d = SpeedProjection.display(SpeedSpec(mph = 65.0), metricPrefs, Locale.US)
        assertEquals("104.61 km/h", d.text)
        // The title still reports the RAW source value/unit, not the converted display.
        assertEquals("65.0 mph", d.title)
    }

    @Test
    fun displayMetricRoundTripsKmhSource() {
        val d = SpeedProjection.display(SpeedSpec(kmh = 100.0, precision = 0), metricPrefs, Locale.US)
        assertEquals("100 km/h", d.text)
        assertEquals("100.0 km/h", d.title)
    }

    @Test
    fun displayConvertsKmhSourceIntoImperialPreference() {
        // 100 km/h shown in the mph preference: 27.7778 m/s → 62.13712 mph → "62.14 mph" at precision 2.
        val d = SpeedProjection.display(SpeedSpec(kmh = 100.0), imperialPrefs, Locale.US)
        assertEquals("62.14 mph", d.text)
    }

    @Test
    fun displayEmptyRendersEmDashWithoutUnitOrTitle() {
        // web `sourceMph == null` branch: `<span>—</span>` — em dash only, no unit symbol, no title.
        val d = SpeedProjection.display(SpeedSpec(), imperialPrefs, Locale.US)
        assertEquals(DASH, d.number)
        assertEquals(DASH, d.text)
        assertNull(d.title)
        assertEquals("—", d.text)
        assertTrue(!d.hasValue)
    }

    @Test
    fun displayZeroIsAValueNotEmpty() {
        // 0 passes `Number.isFinite`, so it renders as a real value (not the em dash).
        val d = SpeedProjection.display(SpeedSpec(mph = 0.0), imperialPrefs, Locale.US)
        assertEquals("0.00 mph", d.text)
        assertEquals("0.0 mph", d.title)
        assertTrue(d.hasValue)
    }

    // ── precision resolution (web `precision` prop ?? global ?? default) ───────────────

    @Test
    fun precisionResolutionPrefersSpecThenGlobalThenDefault() {
        val withGlobal = metricPrefs.copy(precision = 3)
        assertEquals(1, SpeedProjection.resolvePrecision(SpeedSpec(precision = 1), withGlobal))
        assertEquals(3, SpeedProjection.resolvePrecision(SpeedSpec(), withGlobal))
        assertEquals(DEFAULT_DECIMAL_PRECISION, SpeedProjection.resolvePrecision(SpeedSpec(), metricPrefs))
    }

    @Test
    fun precisionResolutionCoercesNegativeToZero() {
        assertEquals(0, SpeedProjection.resolvePrecision(SpeedSpec(precision = -4), metricPrefs))
    }

    // ── fmtNumber parity: locale grouping, fixed decimals, non-finite → 0 ─────────────

    @Test
    fun formatNumberGroupsAndFixesDecimals() {
        assertEquals("1,234.50", SpeedProjection.formatNumber(1234.5, 2, Locale.US))
        assertEquals("65", SpeedProjection.formatNumber(65.0, 0, Locale.US))
    }

    @Test
    fun formatNumberIsLocaleAware() {
        // web `fmtNumber` is locale-aware; German groups with '.' and decimals with ','.
        assertEquals("1.234,50", SpeedProjection.formatNumber(1234.5, 2, Locale.GERMANY))
    }

    @Test
    fun formatNumberCoercesNonFiniteToZeroAndNormalizesSignedZero() {
        assertEquals("0.00", SpeedProjection.formatNumber(Double.NaN, 2, Locale.US))
        assertEquals("0.00", SpeedProjection.formatNumber(Double.POSITIVE_INFINITY, 2, Locale.US))
        assertEquals("0", SpeedProjection.formatNumber(-0.0, 0, Locale.US))
    }

    // ── a11y label: the rendered value IS the node's content description ───────────────

    @Test
    fun accessibleLabelEqualsRenderedValue() {
        // The composable sets the node's contentDescription to this exact string, so asserting it off-device is
        // the a11y-label coverage for the surface.
        val value = SpeedProjection.display(SpeedSpec(mph = 65.0), imperialPrefs, Locale.US)
        assertEquals(value.text, value.accessibleLabel)
        assertEquals("65.00 mph", value.accessibleLabel)
        val empty = SpeedProjection.display(SpeedSpec(), imperialPrefs, Locale.US)
        assertEquals(DASH, empty.accessibleLabel)
    }

    // ── locale resolution (web `useUnits` locale, blank → en-US) ──────────────────────

    @Test
    fun resolveDisplayLocaleFallsBackToEnUsForBlankTags() {
        assertEquals(Locale.US, resolveDisplayLocale(null))
        assertEquals(Locale.US, resolveDisplayLocale(""))
        assertEquals(Locale.US, resolveDisplayLocale("   "))
        assertEquals(Locale.forLanguageTag("de-DE"), resolveDisplayLocale("de-DE"))
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
        SpeedDiagnostics.recordViewOpened(logger)
        assertEquals(1, records.size)
        assertEquals(LogLevel.Info, records[0].level)
        assertEquals("view.opened", records[0].event)
        // Only the surface slug — no speed, source unit, or preference can leak through the diagnostic.
        assertEquals(mapOf("surface" to "Speed"), records[0].fields)
    }
}
