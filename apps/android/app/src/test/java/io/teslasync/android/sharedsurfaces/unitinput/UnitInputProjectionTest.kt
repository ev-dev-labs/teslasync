package io.teslasync.android.sharedsurfaces.unitinput

import io.teslasync.android.components.feedback.QueryErrorKind
import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.toUiState
import io.teslasync.shared.core.data.repo.Resource
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Off-device unit coverage of the pure UnitInput model — the verbatim port of web/src/lib/unitInput.ts
 * (`parseForUnit` / `formatForUnit` / `unitSymbol`) plus [UnitInputProjection] + [UnitInputSettings]. It
 * exercises the canonical↔display round-trip for every unit family (distance/speed conversion, °C↔°F,
 * pass-through energy/percent/currency), locale-aware + strict parsing, the suffix/currency/percent
 * stripping, and the cache-then-network → projection envelope (loading / content / empty / stale /
 * offline / hard error) with the classified error-kind mapping. Runs in the `:android:testReleaseUnitTest`
 * gate.
 */
class UnitInputProjectionTest {
    private val metric = UnitInputSettings(unitOfLength = "mi", unitOfTemp = "C", locale = "en-US", decimalPrecision = 2)
    private val imperialKm = UnitInputSettings(unitOfLength = "km", unitOfTemp = "F", locale = "en-US", decimalPrecision = 2)

    // ── unitSymbol ────────────────────────────────────────────────────────────────────────────────────

    @Test
    fun unitSymbolReflectsPreferences() {
        assertEquals("mi", unitSymbol(UnitKind.Distance, metric))
        assertEquals("km", unitSymbol(UnitKind.Distance, imperialKm))
        assertEquals("mph", unitSymbol(UnitKind.Speed, metric))
        assertEquals("km/h", unitSymbol(UnitKind.Speed, imperialKm))
        assertEquals("\u00B0C", unitSymbol(UnitKind.Temperature, metric))
        assertEquals("\u00B0F", unitSymbol(UnitKind.Temperature, imperialKm))
        assertEquals("kWh", unitSymbol(UnitKind.Energy, metric))
        assertEquals("%", unitSymbol(UnitKind.Percent, metric))
        assertEquals("$", unitSymbol(UnitKind.Currency, metric))
        assertEquals("\u00A3", unitSymbol(UnitKind.Currency, metric.copy(currencySymbol = "\u00A3")))
    }

    // ── formatForUnit (canonical → display) ─────────────────────────────────────────────────────────────

    @Test
    fun formatPassesThroughEnergyPercentCurrency() {
        assertEquals("75", formatForUnit(75.0, UnitKind.Energy, metric))
        assertEquals("80", formatForUnit(80.0, UnitKind.Percent, metric))
        assertEquals("1.23", formatForUnit(1.23, UnitKind.Currency, metric))
    }

    @Test
    fun formatTrimsTrailingZerosAndReturnsBlankForNull() {
        assertEquals("60", formatForUnit(60.0, UnitKind.Energy, metric))
        assertEquals("", formatForUnit(null, UnitKind.Energy, metric))
        assertEquals("", formatForUnit(Double.NaN, UnitKind.Energy, metric))
    }

    @Test
    fun formatConvertsDistanceAndSpeedToKm() {
        // 60 canonical miles → 96.56064 km → 2 dp.
        assertEquals("96.56", formatForUnit(60.0, UnitKind.Distance, imperialKm))
        assertEquals("96.56", formatForUnit(60.0, UnitKind.Speed, imperialKm))
        // Metric preference is the canonical itself (miles/mph) — no conversion.
        assertEquals("60", formatForUnit(60.0, UnitKind.Distance, metric))
    }

    @Test
    fun formatConvertsTemperatureToFahrenheit() {
        assertEquals("68", formatForUnit(20.0, UnitKind.Temperature, imperialKm))
        assertEquals("20", formatForUnit(20.0, UnitKind.Temperature, metric))
    }

    @Test
    fun formatHonoursLocaleDecimalSeparator() {
        val de = metric.copy(locale = "de-DE")
        assertEquals("96,56", formatForUnit(60.0, UnitKind.Distance, de.copy(unitOfLength = "km")))
    }

    // ── parseForUnit (display → canonical) ──────────────────────────────────────────────────────────────

    @Test
    fun parsePassesThroughEnergyAndStripsSuffix() {
        assertEquals(75.0, parseForUnit("75 kWh", UnitKind.Energy, metric)!!, 0.0)
        assertEquals(75.0, parseForUnit("75", UnitKind.Energy, metric)!!, 0.0)
    }

    @Test
    fun parseSpeedAndDistanceConvertFromKm() {
        assertEquals(60.0, parseForUnit("60 mph", UnitKind.Speed, metric)!!, 1e-9)
        // 96.56 km → ~60 canonical miles.
        assertEquals(60.0, parseForUnit("96.56064 km", UnitKind.Distance, imperialKm)!!, 1e-6)
    }

    @Test
    fun parseTemperatureConvertsFahrenheit() {
        assertEquals(20.0, parseForUnit("68\u00B0F", UnitKind.Temperature, imperialKm)!!, 1e-9)
        assertEquals(20.0, parseForUnit("20\u00B0C", UnitKind.Temperature, metric)!!, 1e-9)
    }

    @Test
    fun parsePercentStripsTrailingSign() {
        assertEquals(75.0, parseForUnit("75 %", UnitKind.Percent, metric)!!, 0.0)
        assertEquals(75.0, parseForUnit("75%", UnitKind.Percent, metric)!!, 0.0)
    }

    @Test
    fun parseCurrencyStripsSymbolAndAccountingParens() {
        assertEquals(1234.56, parseForUnit("$1,234.56", UnitKind.Currency, metric)!!, 1e-9)
        assertEquals(-10.0, parseForUnit("($10)", UnitKind.Currency, metric)!!, 0.0)
        assertEquals(5.0, parseForUnit("\u00A35", UnitKind.Currency, metric.copy(currencySymbol = "\u00A3"))!!, 0.0)
    }

    @Test
    fun parseReturnsNullForBlankOrGarbage() {
        assertNull(parseForUnit("", UnitKind.Energy, metric))
        assertNull(parseForUnit("   ", UnitKind.Energy, metric))
        assertNull(parseForUnit("abc", UnitKind.Energy, metric))
        assertNull(parseForUnit(null, UnitKind.Energy, metric))
    }

    @Test
    fun parseHonoursLocaleSeparatorsAndStrictBypass() {
        val de = metric.copy(locale = "de-DE", unitOfLength = "km")
        assertEquals(60.0, parseForUnit("96,56064 km", UnitKind.Distance, de)!!, 1e-6)
        // Strict mode uses plain numeric parsing — grouped en-US input no longer parses.
        assertNull(parseForUnit("1,234.56", UnitKind.Energy, metric, UnitInputParseOptions(strict = true)))
        assertEquals(12.5, parseForUnit("12.5", UnitKind.Energy, metric, UnitInputParseOptions(strict = true))!!, 0.0)
    }

    @Test
    fun parseFormatRoundTripsThroughKm() {
        val canonical = parseForUnit(formatForUnit(60.0, UnitKind.Distance, imperialKm), UnitKind.Distance, imperialKm)
        assertEquals(60.0, canonical!!, 1e-3)
    }

    // ── UnitInputSettings.fromSettings ──────────────────────────────────────────────────────────────────

    @Test
    fun fromSettingsReadsKeysAndDefaults() {
        val resolved =
            UnitInputSettings.fromSettings(
                buildJsonObject {
                    put("unit_of_length", "km")
                    put("unit_of_temp", "F")
                    put("locale", "fr-FR")
                    put("decimal_precision", 3)
                    put("currency_symbol", "\u20AC")
                },
            )
        assertTrue(resolved.lengthIsKm)
        assertTrue(resolved.tempIsFahrenheit)
        assertEquals("fr-FR", resolved.locale)
        assertEquals(3, resolved.resolvedPrecision)
        assertEquals("\u20AC", resolved.resolvedCurrencySymbol)

        val defaults = UnitInputSettings.fromSettings(null)
        assertFalse(defaults.lengthIsKm)
        assertEquals(2, defaults.resolvedPrecision)
        assertEquals("$", defaults.resolvedCurrencySymbol)
        assertEquals(UnitInputSettings(), UnitInputSettings.fromSettings(JsonPrimitive("nope")))
    }

    // ── Projection: phase + freshness envelope ──────────────────────────────────────────────────────────

    @Test
    fun contentProjectsFormattedValueAndSymbol() {
        val display = UnitInputProjection.project(success(metricDoc()), 75.0, UnitKind.Energy)
        assertEquals(UnitInputPhase.Content, display.phase)
        assertTrue(display.hasValue)
        assertEquals("75", display.formattedValue)
        assertEquals("75", display.bufferSeed)
        assertEquals("kWh", display.symbol)
    }

    @Test
    fun nullValueProjectsEmptyButInteractive() {
        val display = UnitInputProjection.project(success(metricDoc()), null, UnitKind.Energy)
        assertEquals(UnitInputPhase.Empty, display.phase)
        assertFalse(display.hasValue)
        assertEquals("", display.formattedValue)
        assertEquals("kWh", display.symbol)
    }

    @Test
    fun firstLoadWithNoCacheIsLoading() {
        val settings = Resource.Loading<JsonElement>(cached = null, fetchedAt = null, stale = false).toUiState { false }
        val display = UnitInputProjection.project(settings, 75.0, UnitKind.Energy)
        assertEquals(UnitInputPhase.Loading, display.phase)
    }

    @Test
    fun hardErrorWithNoCacheIsError() {
        val settings =
            Resource
                .Error<JsonElement>(cached = null, fetchedAt = null, stale = false, error = RuntimeException("down"))
                .toUiState { false }
        val display = UnitInputProjection.project(settings, 75.0, UnitKind.Energy)
        assertEquals(UnitInputPhase.Error, display.phase)
        assertTrue(display.canRetry)
    }

    @Test
    fun cachedValueAfterFailedRefreshIsOffline() {
        val settings =
            Resource
                .Error<JsonElement>(cached = kmDoc(), fetchedAt = 5L, stale = true, error = RuntimeException("net"))
                .toUiState { false }
        val display = UnitInputProjection.project(settings, 60.0, UnitKind.Distance)
        assertEquals(UnitInputPhase.Content, display.phase)
        assertEquals("96.56", display.formattedValue)
        assertEquals("km", display.symbol)
        assertTrue(display.offline)
        assertFalse(display.stale)
        assertTrue(display.showFreshnessChip)
        assertEquals(5L, display.freshnessStamp)
    }

    @Test
    fun cachedValuePastTtlIsStaleAndRefreshing() {
        val settings =
            Resource.Loading<JsonElement>(cached = metricDoc(), fetchedAt = 9L, stale = true).toUiState { false }
        val display = UnitInputProjection.project(settings, 75.0, UnitKind.Energy)
        assertEquals(UnitInputPhase.Content, display.phase)
        assertTrue(display.stale)
        assertFalse(display.offline)
        assertTrue(display.refreshing)
        assertTrue(display.showFreshnessChip)
    }

    @Test
    fun queryErrorKindMapsTheTaxonomy() {
        assertEquals(QueryErrorKind.Waiting, kindFor(ErrorKind.CircuitOpen, null))
        assertEquals(QueryErrorKind.Network, kindFor(ErrorKind.Network, null))
        assertEquals(QueryErrorKind.Network, kindFor(ErrorKind.Timeout, null))
        assertEquals(QueryErrorKind.Unauthorized, kindFor(ErrorKind.Http, 401))
        assertEquals(QueryErrorKind.Unauthorized, kindFor(ErrorKind.Http, 403))
        assertEquals(QueryErrorKind.NotFound, kindFor(ErrorKind.Http, 404))
        assertEquals(QueryErrorKind.ServerError, kindFor(ErrorKind.Http, 503))
        assertEquals(QueryErrorKind.ServerError, kindFor(ErrorKind.Unknown, null))
    }

    private fun kindFor(
        errorKind: ErrorKind,
        httpStatus: Int?,
    ): QueryErrorKind =
        UnitInputProjection.queryErrorKind(
            UnitInputDisplay(
                phase = UnitInputPhase.Error,
                unit = UnitKind.Energy,
                settings = metric,
                symbol = "kWh",
                formattedValue = "",
                hasValue = false,
                errorKind = errorKind,
                httpStatus = httpStatus,
            ),
        )

    private companion object {
        fun metricDoc(): JsonElement = buildJsonObject { put("unit_of_length", "mi") }

        fun kmDoc(): JsonElement = buildJsonObject { put("unit_of_length", "km") }

        fun success(document: JsonElement) = Resource.Success<JsonElement>(document, fetchedAt = 1L, stale = false).toUiState { false }
    }
}
