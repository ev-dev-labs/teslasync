package io.teslasync.android.sharedsurfaces.currency

import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Off-device verification of the Currency surface's pure logic — the native analogue of the web component's
 * inline derivations (web/src/components/data-display/format/Currency.tsx): the settings → format projection
 * (web `useFormatting`), the grouped display + canonical title formatters (web `fmtNumber` + `value.toFixed`),
 * the value/feed → render classification (the null / non-finite fallback + the per-state freshness), the
 * settings-document adapter (cached → projection), the per-state a11y label mapping, and the PII-safe
 * `view.opened` diagnostic. Runs in the :android:testReleaseUnitTest gate.
 */
class CurrencyModelTest {
    private fun settings(
        symbol: String? = null,
        locale: String? = null,
    ): JsonElement =
        buildJsonObject {
            if (symbol != null) put("currency_symbol", symbol)
            if (locale != null) put("locale", locale)
        }

    private fun contentFormat(format: CurrencyFormat = CurrencyFormat.Default): UiState<CurrencyFormat> =
        UiState(UiPhase.Content, data = format)

    // ── resolveCurrencyFormat (web useFormatting projection) ──────────────────────

    @Test
    fun resolveFallsBackToDollarAndUsLocaleForNullDocument() {
        assertEquals(CurrencyFormat("$", "en-US"), resolveCurrencyFormat(null))
    }

    @Test
    fun resolveReadsCurrencySymbolAndLocaleFromTheDocument() {
        assertEquals(CurrencyFormat("\u20ac", "de-DE"), resolveCurrencyFormat(settings(symbol = "\u20ac", locale = "de-DE")))
    }

    @Test
    fun resolveFallsBackWhenSymbolOrLocaleIsBlankOrMissing() {
        // Web: `settings.currency_symbol && settings.currency_symbol.trim() ? ... : '$'`, locale `|| 'en-US'`.
        assertEquals(CurrencyFormat("$", "en-US"), resolveCurrencyFormat(settings(symbol = "   ", locale = "")))
        assertEquals(CurrencyFormat("$", "en-US"), resolveCurrencyFormat(settings()))
        assertEquals(CurrencyFormat("\u00a3", "en-US"), resolveCurrencyFormat(settings(symbol = "\u00a3")))
    }

    // ── number formatters (web fmtNumber + value.toFixed) ─────────────────────────

    @Test
    fun currencyNumberGroupsByLocaleAtTheGivenPrecision() {
        assertEquals("1,234.50", currencyNumber(1234.5, 2, "en-US"))
        assertEquals("1.234,50", currencyNumber(1234.5, 2, "de-DE"))
        assertEquals("1,235", currencyNumber(1234.5, 0, "en-US"))
        assertEquals("-1,234.50", currencyNumber(-1234.5, 2, "en-US"))
    }

    @Test
    fun currencyNumberCoercesPrecisionToTheWebClampAndFallsBackToUsLocale() {
        // Negative precision would throw in String.format — coerced to 0 (web setGlobalPrecision 0..20 clamp).
        assertEquals("1,235", currencyNumber(1234.5, -3, "en-US"))
        // A blank locale tag resolves to en-US grouping.
        assertEquals("1,234.50", currencyNumber(1234.5, 2, "   "))
    }

    @Test
    fun currencyFixedUsIsTheCanonicalGroupingFreeDotForm() {
        assertEquals("1234.50", currencyFixedUs(1234.5, 2))
        assertEquals("1234.5", currencyFixedUs(1234.5, 1))
        assertEquals("-1234.50", currencyFixedUs(-1234.5, 2))
    }

    // ── classifyCurrency: empty (web null / non-finite fallback) ──────────────────

    @Test
    fun classifyIsEmptyForNullNanOrInfiniteValue() {
        assertEquals(CurrencyRender.Empty("\u2014"), classifyCurrency(null, contentFormat()))
        assertEquals(CurrencyRender.Empty("\u2014"), classifyCurrency(Double.NaN, contentFormat()))
        assertEquals(CurrencyRender.Empty("\u2014"), classifyCurrency(Double.POSITIVE_INFINITY, contentFormat()))
        assertEquals(CurrencyRender.Empty("n/a"), classifyCurrency(null, contentFormat(), fallback = "n/a"))
    }

    // ── classifyCurrency: amount (web body + title) ───────────────────────────────

    @Test
    fun classifyBuildsDisplayAndCanonicalAccessibleValueWithTheResolvedSymbol() {
        val render = classifyCurrency(1234.5, contentFormat(CurrencyFormat("$", "en-US"))) as CurrencyRender.Amount

        assertEquals("$1,234.50", render.display)
        assertEquals("$1234.50", render.accessibleValue)
        assertEquals(CurrencyFreshness.Live, render.freshness)
    }

    @Test
    fun classifyHonorsTheSymbolOverride() {
        val render =
            classifyCurrency(
                1234.5,
                contentFormat(CurrencyFormat("$", "en-US")),
                symbolOverride = "\u20ac",
            ) as CurrencyRender.Amount

        assertEquals("\u20ac1,234.50", render.display)
        assertEquals("\u20ac1234.50", render.accessibleValue)
    }

    @Test
    fun classifyFallsBackToTheDefaultSymbolWhenTheFeedHasNoValueYet() {
        // Web parity: useFormatting degrades to `$` before settings load — the amount still renders.
        val loading = classifyCurrency(1234.5, UiState.loading()) as CurrencyRender.Amount
        assertEquals("$1,234.50", loading.display)
        assertEquals(CurrencyFreshness.Loading, loading.freshness)

        // A hard settings failure with no cache also falls back to `$` rather than blanking.
        val failed = classifyCurrency(1234.5, UiState(UiPhase.Error, errorKind = ErrorKind.Network)) as CurrencyRender.Amount
        assertEquals("$1,234.50", failed.display)
        assertEquals(CurrencyFreshness.Failed, failed.freshness)
    }

    @Test
    fun classifyUsesTheLocaleGroupingFromTheResolvedFormat() {
        val render = classifyCurrency(1234.5, contentFormat(CurrencyFormat("\u20ac", "de-DE"))) as CurrencyRender.Amount

        // Body groups by locale; the canonical accessibility value stays grouping-free + dot-decimal.
        assertEquals("\u20ac1.234,50", render.display)
        assertEquals("\u20ac1234.50", render.accessibleValue)
    }

    // ── currencyFreshness (settings-feed lifecycle → surface freshness) ───────────

    @Test
    fun freshnessMapsEveryFeedStateTheSurfaceRenders() {
        val fmt = CurrencyFormat.Default
        assertEquals(CurrencyFreshness.Live, currencyFreshness(UiState(UiPhase.Content, data = fmt)))
        assertEquals(CurrencyFreshness.Loading, currencyFreshness(UiState.loading<CurrencyFormat>()))
        assertEquals(CurrencyFreshness.Loading, currencyFreshness(UiState(UiPhase.Content, data = fmt, refreshing = true)))
        assertEquals(CurrencyFreshness.Stale, currencyFreshness(UiState(UiPhase.Content, data = fmt, stale = true)))
        assertEquals(
            CurrencyFreshness.Offline,
            currencyFreshness(UiState(UiPhase.Content, data = fmt, stale = true, errorKind = ErrorKind.Network)),
        )
        assertEquals(CurrencyFreshness.Failed, currencyFreshness(UiState<CurrencyFormat>(UiPhase.Error, errorKind = ErrorKind.Timeout)))
    }

    // ── currencyStateLabel (per-state a11y label) ─────────────────────────────────

    @Test
    fun stateLabelIsNullForLiveAndTheMatchingLabelOtherwise() {
        val labels = CurrencyLabels(loading = "Loading", stale = "Stale", offline = "Offline", error = "Error")

        assertNull(currencyStateLabel(CurrencyFreshness.Live, labels))
        assertEquals("Loading", currencyStateLabel(CurrencyFreshness.Loading, labels))
        assertEquals("Stale", currencyStateLabel(CurrencyFreshness.Stale, labels))
        assertEquals("Offline", currencyStateLabel(CurrencyFreshness.Offline, labels))
        assertEquals("Error", currencyStateLabel(CurrencyFreshness.Failed, labels))
    }

    // ── toCurrencyFormat (adapter: cached settings document → projection) ─────────

    @Test
    fun adapterProjectsSuccessAndPreservesFreshness() {
        val resource: Resource<JsonElement> =
            Resource.Success(settings(symbol = "\u20ac", locale = "de-DE"), fetchedAt = 99L, stale = false)

        val mapped = resource.toCurrencyFormat()

        assertTrue(mapped is Resource.Success)
        val success = mapped as Resource.Success
        assertEquals(CurrencyFormat("\u20ac", "de-DE"), success.data)
        assertEquals(99L, success.fetchedAt)
    }

    @Test
    fun adapterKeepsAFirstLoadWithoutCacheAsNull() {
        val resource: Resource<JsonElement> = Resource.Loading(cached = null, fetchedAt = null, stale = false)

        val mapped = resource.toCurrencyFormat()

        assertTrue(mapped is Resource.Loading)
        assertNull(mapped.cached)
    }

    @Test
    fun adapterProjectsCachedValueOnErrorAndKeepsTheCauseAndStaleFlag() {
        val cause = IllegalStateException("settings refresh failed")
        val resource: Resource<JsonElement> =
            Resource.Error(cached = settings(symbol = "\u00a3"), fetchedAt = 7L, stale = true, error = cause)

        val mapped = resource.toCurrencyFormat()

        assertTrue(mapped is Resource.Error)
        val error = mapped as Resource.Error
        assertEquals(CurrencyFormat("\u00a3", "en-US"), error.cached)
        assertTrue(error.stale)
        assertEquals(cause, error.error)
    }

    // ── resolveCurrencyLocale ─────────────────────────────────────────────────────

    @Test
    fun resolveLocaleFallsBackToUsForBlankOrNull() {
        assertEquals(java.util.Locale.US, resolveCurrencyLocale(null))
        assertEquals(java.util.Locale.US, resolveCurrencyLocale("  "))
        assertEquals("de", resolveCurrencyLocale("de-DE").language)
    }

    // ── Diagnostics (P1/S11 view.opened contract) ─────────────────────────────────

    @Test
    fun recordOpenedEmitsPiiSafeViewOpenedWithSurfaceSlug() {
        val logger = RecordingLogger()

        recordCurrencyOpened(logger)

        assertEquals(1, logger.records.size)
        val (event, fields) = logger.records.single()
        assertEquals("view.opened", event)
        assertEquals(mapOf("surface" to "Currency"), fields)
    }

    @Test
    fun slugMatchesTheDiagnosticSurface() {
        assertEquals("Currency", CURRENCY_SLUG)
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
