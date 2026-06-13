package io.teslasync.android.sharedsurfaces.currencyinput

import io.teslasync.android.components.feedback.QueryErrorKind
import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Off-device verification of the CurrencyInput surface's pure logic — the native analogue of the web
 * primitive's derivations (web/src/components/forms/CurrencyInput.tsx + web/src/lib/currencyFormat.ts): the
 * micro<->value conversions, the currency formatter, the localized symbol, the settings-symbol→ISO bridge,
 * the accounting-aware locale parser, the settings→format + value/feed→render projections, the QueryError
 * mapping, and the PII-safe `view.opened` diagnostic. Runs in the :android:testReleaseUnitTest gate.
 */
class CurrencyInputModelTest {
    private fun settings(
        symbol: String? = null,
        locale: String? = null,
    ): JsonElement =
        buildJsonObject {
            if (symbol != null) put("currency_symbol", symbol)
            if (locale != null) put("locale", locale)
        }

    private fun content(doc: JsonElement = settings()): UiState<JsonElement> = UiState(UiPhase.Content, data = doc)

    // ── micro <-> value (web valueToMicro / microToValue) ─────────────────────────

    @Test
    fun valueToMicroRoundsAndGuardsNonFinite() {
        assertEquals(1_500_000L, valueToMicro(1.5))
        assertEquals(10L, valueToMicro(0.00001))
        assertEquals(-2_000_000L, valueToMicro(-2.0))
        assertNull(valueToMicro(null))
        assertNull(valueToMicro(Double.NaN))
        assertNull(valueToMicro(Double.POSITIVE_INFINITY))
    }

    @Test
    fun microToValueReversesAndGuardsNull() {
        assertEquals(1.5, microToValue(1_500_000L)!!, 0.0)
        assertEquals(0.0, microToValue(0L)!!, 0.0)
        assertNull(microToValue(null))
    }

    // ── formatCurrencyValue / formatCurrencyMicro (web style:'currency', useGrouping:false) ───────────

    @Test
    fun formatRendersLocaleCurrencyWithoutGroupingByDefault() {
        assertEquals("$1.50", formatCurrencyValue(1.5, "USD", "en-US", 2))
        assertEquals("$1234.50", formatCurrencyValue(1234.5, "USD", "en-US", 2))
        assertEquals("$1,234.50", formatCurrencyValue(1234.5, "USD", "en-US", 2, useGrouping = true))
    }

    @Test
    fun formatPlacesTheSymbolPerLocale() {
        // de-DE suffixes the symbol with a (no-break) space; assert robustly, not on the exact space char.
        val de = formatCurrencyValue(1.5, "EUR", "de-DE", 2)
        assertTrue(de, de.startsWith("1,50"))
        assertTrue(de, de.trimEnd().endsWith("\u20ac"))
    }

    @Test
    fun formatReturnsBlankForNullOrNonFinite() {
        assertEquals("", formatCurrencyValue(null, "USD", "en-US", 2))
        assertEquals("", formatCurrencyValue(Double.NaN, "USD", "en-US", 2))
        assertEquals("", formatCurrencyMicro(null, "USD", "en-US", 2))
    }

    @Test
    fun formatFallsBackToCodePrefixForAnInvalidCurrency() {
        assertEquals("ZZZ 1.50", formatCurrencyValue(1.5, "ZZZ", "en-US", 2))
    }

    @Test
    fun formatMicroFormatsTheMajorUnit() {
        assertEquals("$1.50", formatCurrencyMicro(1_500_000L, "USD", "en-US", 2))
        assertEquals("$0.00", formatCurrencyMicro(0L, "USD", "en-US", 2))
    }

    // ── currencySymbol (web currencySymbol) ───────────────────────────────────────

    @Test
    fun symbolResolvesPerLocaleAndFallsBackToCode() {
        assertEquals("$", currencySymbol("USD", "en-US"))
        assertEquals("\u20ac", currencySymbol("EUR", "de-DE"))
        assertEquals("\u00a3", currencySymbol("GBP", "en-GB"))
        assertEquals("ZZZ", currencySymbol("ZZZ", "en-US"))
    }

    // ── currencyCodeFromSymbol (web currencyCodeFromSymbol) ───────────────────────

    @Test
    fun codeFromSymbolBridgesTheCommonSymbolsAndDefaultsToUsd() {
        assertEquals("USD", currencyCodeFromSymbol("$"))
        assertEquals("EUR", currencyCodeFromSymbol("\u20ac"))
        assertEquals("GBP", currencyCodeFromSymbol("\u00a3"))
        assertEquals("PLN", currencyCodeFromSymbol("z\u0142"))
        assertEquals("USD", currencyCodeFromSymbol(null))
        assertEquals("USD", currencyCodeFromSymbol("\u00bf"))
    }

    // ── parseCurrencyText (web parseCurrencyText / parseLocaleNumber) ──────────────

    @Test
    fun parseStripsSymbolCodeAndGroupingPerLocale() {
        assertEquals(1.5, parseCurrencyText("$1.50", "USD", "en-US")!!, 0.0)
        assertEquals(1234.56, parseCurrencyText("1,234.56", "USD", "en-US")!!, 0.0)
        assertEquals(1.5, parseCurrencyText("USD 1.50", "USD", "en-US")!!, 0.0)
        assertEquals(1234.56, parseCurrencyText("1.234,56", "EUR", "de-DE")!!, 0.0)
        assertEquals(1.5, parseCurrencyText("1,50 \u20ac", "EUR", "de-DE")!!, 0.0)
        assertEquals(1.5, parseCurrencyText("1,50\u00a0\u20ac", "EUR", "de-DE")!!, 0.0)
    }

    @Test
    fun parseHandlesAccountingParensAndSigns() {
        assertEquals(-1.5, parseCurrencyText("($1.50)", "USD", "en-US")!!, 0.0)
        assertEquals(-2.0, parseCurrencyText("-$2", "USD", "en-US")!!, 0.0)
        assertEquals(-1.5, parseCurrencyText("$-1.50", "USD", "en-US")!!, 0.0)
        assertEquals(1.5, parseCurrencyText("+$1.50", "USD", "en-US")!!, 0.0)
    }

    @Test
    fun parseReturnsNullForEmptyOrUnparseable() {
        assertNull(parseCurrencyText("", "USD", "en-US"))
        assertNull(parseCurrencyText("   ", "USD", "en-US"))
        assertNull(parseCurrencyText("$", "USD", "en-US"))
    }

    @Test
    fun parseToMicroComposesParseAndValueToMicro() {
        assertEquals(1_500_000L, parseCurrencyTextToMicro("$1.50", "USD", "en-US"))
        assertEquals(-1_500_000L, parseCurrencyTextToMicro("($1.50)", "USD", "en-US"))
        assertNull(parseCurrencyTextToMicro("", "USD", "en-US"))
    }

    // ── resolveCurrencyInputFormat (settings → currency/locale) ────────────────────

    @Test
    fun resolveReadsSymbolBridgeAndLocaleWithDefaults() {
        assertEquals(CurrencyInputFormat("EUR", "de-DE"), resolveCurrencyInputFormat(settings("\u20ac", "de-DE")))
        assertEquals(CurrencyInputFormat.Default, resolveCurrencyInputFormat(null))
        assertEquals(CurrencyInputFormat("USD", "en-US"), resolveCurrencyInputFormat(settings(symbol = "  ", locale = "")))
        assertEquals(CurrencyInputFormat("GBP", "en-US"), resolveCurrencyInputFormat(settings(symbol = "\u00a3")))
    }

    // ── projection (settings feed + overrides → render) ───────────────────────────

    @Test
    fun projectEditableResolvesCurrencyLocaleSymbolFromTheFeed() {
        val display = CurrencyInputProjection.project(content(settings("\u20ac", "de-DE")), null, null)
        assertEquals(CurrencyInputPhase.Editable, display.phase)
        assertEquals("EUR", display.currency)
        assertEquals("de-DE", display.locale)
        assertEquals("\u20ac", display.symbol)
    }

    @Test
    fun projectSurfacesLoadingAndErrorFromTheFeed() {
        assertEquals(CurrencyInputPhase.Loading, CurrencyInputProjection.project(UiState.loading(), null, null).phase)

        val error = CurrencyInputProjection.project(UiState(UiPhase.Error, errorKind = ErrorKind.Network), null, null)
        assertEquals(CurrencyInputPhase.Error, error.phase)
        assertEquals(ErrorKind.Network, error.errorKind)
    }

    @Test
    fun projectFlagsStaleAndOfflineDistinctly() {
        val stale = CurrencyInputProjection.project(UiState(UiPhase.Content, data = settings(), stale = true), null, null)
        assertTrue(stale.stale)
        assertFalse(stale.offline)

        val offline =
            CurrencyInputProjection.project(
                UiState(UiPhase.Content, data = settings(), stale = true, errorKind = ErrorKind.Network),
                null,
                null,
            )
        assertTrue(offline.offline)
        assertFalse(offline.stale)
    }

    @Test
    fun projectWithExplicitOverridesRendersImmediatelyAndSuppressesFreshness() {
        // Web parity: explicit currency + locale props need no settings, so even a loading / stale feed is Editable.
        val display =
            CurrencyInputProjection.project(
                UiState(UiPhase.Content, data = settings("$", "en-US"), stale = true),
                currencyOverride = "GBP",
                localeOverride = "en-GB",
            )
        assertEquals(CurrencyInputPhase.Editable, display.phase)
        assertEquals("GBP", display.currency)
        assertEquals("en-GB", display.locale)
        assertEquals("\u00a3", display.symbol)
        assertFalse(display.stale)
        assertFalse(display.offline)
    }

    // ── queryErrorKind (ErrorKind → shared recovery bucket) ───────────────────────

    @Test
    fun queryErrorKindMapsEveryFailure() {
        assertEquals(QueryErrorKind.Waiting, kindFor(ErrorKind.CircuitOpen))
        assertEquals(QueryErrorKind.Network, kindFor(ErrorKind.Network))
        assertEquals(QueryErrorKind.Network, kindFor(ErrorKind.Timeout))
        assertEquals(QueryErrorKind.Unauthorized, kindFor(ErrorKind.Http, 401))
        assertEquals(QueryErrorKind.NotFound, kindFor(ErrorKind.Http, 404))
        assertEquals(QueryErrorKind.ServerError, kindFor(ErrorKind.Http, 503))
        assertEquals(QueryErrorKind.ServerError, kindFor(ErrorKind.Decode))
        assertEquals(QueryErrorKind.ServerError, kindFor(null))
    }

    private fun kindFor(
        errorKind: ErrorKind?,
        status: Int? = null,
    ): QueryErrorKind =
        CurrencyInputProjection.queryErrorKind(
            CurrencyInputDisplay(
                phase = CurrencyInputPhase.Error,
                currency = "USD",
                locale = "en-US",
                symbol = "$",
                errorKind = errorKind,
                httpStatus = status,
            ),
        )

    // ── Diagnostics (P1/S11 view.opened contract) ─────────────────────────────────

    @Test
    fun recordOpenedEmitsPiiSafeViewOpenedWithSurfaceSlug() {
        val logger = RecordingLogger()

        recordCurrencyInputOpened(logger)

        assertEquals(1, logger.records.size)
        val (event, fields) = logger.records.single()
        assertEquals("view.opened", event)
        assertEquals(mapOf("surface" to "CurrencyInput"), fields)
    }

    @Test
    fun slugMatchesTheDiagnosticSurface() {
        assertEquals("CurrencyInput", CURRENCY_INPUT_SLUG)
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
