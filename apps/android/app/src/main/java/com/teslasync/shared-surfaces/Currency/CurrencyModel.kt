// Pure, framework-free model + projection for the Currency shared surface — the native analogue of everything
// the web component derives before returning JSX (web/src/components/data-display/format/Currency.tsx). No
// Compose, no Android, no HTTP: every declaration here is exercised off-device by the
// :android:testReleaseUnitTest gate, so the composable stays a thin render layer over these pure functions.
//
// The web component is a passive inline formatter. It reads exactly ONE value from its data hook —
// `currencySymbol` from `useFormatting()` (which is `settings.currency_symbol || '$'`) — and renders the
// amount as `{symbol}{fmtNumber(value, precision)}` with the canonical, locale-independent
// `{symbol}{value.toFixed(precision)}` exposed via the `title` attribute. A `null` / non-finite value renders
// the `fallback` ("—"). `precision` is the component PROP (default 2), NOT a settings field; the locale used by
// `fmtNumber` is the global locale (`settings.locale || 'en-US'`). This file owns that contract's pure half:
// the settings → format projection (web `useFormatting`), the grouped display + canonical title formatters
// (web `fmtNumber` + `value.toFixed`), the value/feed → render-ready classification, the per-state a11y label
// mapping, and the PII-safe `view.opened` diagnostic.
//
// States (Honesty Covenant #9 — documented, not silent): the web Currency is a passive formatter with no
// loading skeleton, no retry, and no auto-refresh — `useSettings` degrades to the default `$` and the amount
// always renders. The shared Settings feed (P1/S8) it binds to DOES carry the loading / content / stale /
// offline / error lifecycle, so this surface reproduces every one of those states — but faithfully for an
// inline formatter: the amount is ALWAYS rendered (never a blank box), using the resolved symbol when present
// and the default `$` while loading / on a hard error (exactly as the web falls back), and the non-live feed
// states surface as an informational freshness indicator + an accessibility state description rather than a
// retry button (the shared settings document is refreshed by the Settings screen, not per-formatter). The
// surface's own "empty" is the web's `value == null || !Number.isFinite(value)` fallback branch.
//
// SI boundary (unit-conversion instructions): a currency amount is NOT an SI physical quantity — the web
// renders the value verbatim with the user's symbol and performs no conversion, so neither does this port.
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/shared-surfaces/Currency — the P3 prompt's allowed-files path) cannot form a valid Kotlin
// package (a hyphen and a PascalCase segment are illegal in a package identifier), so the package intentionally
// diverges from the path — exactly as the sibling shared surfaces do. `MatchingDeclarationName` is suppressed
// for the co-located supporting declarations.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.currency

import io.teslasync.android.data.UiState
import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull
import java.util.Locale

/** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). Carries no amount or fleet state. */
const val CURRENCY_SLUG: String = "Currency"

/** The default fiat symbol — the web `useFormatting` fallback when `settings.currency_symbol` is blank/absent. */
const val DEFAULT_CURRENCY_SYMBOL: String = "$"

/** The web `Currency` `precision` prop default — the standard for fiat amounts (`precision = 2`). */
const val DEFAULT_CURRENCY_PRECISION: Int = 2

/** The em dash the web `fallback` prop defaults to for a null / non-finite value (`fallback = '—'`). */
const val CURRENCY_FALLBACK: String = "\u2014"

/** The BCP-47 default the web global locale falls back to (`settings.locale || 'en-US'`). */
const val DEFAULT_CURRENCY_LOCALE_TAG: String = "en-US"

/** Upper bound for the rendered fraction digits — mirrors the web `setGlobalPrecision` 0..20 clamp. */
private const val MAX_CURRENCY_PRECISION: Int = 20

private const val CURRENCY_SYMBOL_KEY: String = "currency_symbol"
private const val LOCALE_KEY: String = "locale"

/**
 * The resolved currency formatting preferences — the native slice of the web `useFormatting()` result the
 * `Currency` component actually reads. Only the [symbol] (web `currencySymbol`) and the [localeTag] (the global
 * locale `fmtNumber` groups with) matter; precision is a render prop, not a setting.
 *
 * @property symbol the user's preferred currency symbol (web `settings.currency_symbol || '$'`).
 * @property localeTag the BCP-47 tag used for locale-aware grouping (web global locale, `settings.locale`).
 */
data class CurrencyFormat(
    val symbol: String,
    val localeTag: String,
) {
    companion object {
        /** The pre-settings default — symbol `$`, locale `en-US` — exactly what the web hook returns cold. */
        val Default: CurrencyFormat = CurrencyFormat(DEFAULT_CURRENCY_SYMBOL, DEFAULT_CURRENCY_LOCALE_TAG)
    }
}

/**
 * Projects the raw `/settings` document onto a [CurrencyFormat] — the Kotlin port of the web `useFormatting`
 * derivation the `Currency` component consumes. `currency_symbol` is used verbatim when non-blank (web
 * `settings.currency_symbol && settings.currency_symbol.trim() ? settings.currency_symbol : '$'`), else `$`;
 * `locale` is used when non-blank (web `setGlobalLocale`), else `en-US`. A `null` document (cold start) yields
 * [CurrencyFormat.Default], so the amount renders immediately with the default symbol, mirroring the web hook.
 */
fun resolveCurrencyFormat(settings: JsonElement?): CurrencyFormat {
    val obj = settings as? JsonObject ?: return CurrencyFormat.Default
    val rawSymbol = obj.string(CURRENCY_SYMBOL_KEY)
    val rawLocale = obj.string(LOCALE_KEY)
    return CurrencyFormat(
        symbol = if (!rawSymbol.isNullOrBlank()) rawSymbol else DEFAULT_CURRENCY_SYMBOL,
        localeTag = if (!rawLocale.isNullOrBlank()) rawLocale else DEFAULT_CURRENCY_LOCALE_TAG,
    )
}

private fun JsonObject.string(key: String): String? = (this[key] as? JsonPrimitive)?.contentOrNull

/**
 * The render-ready classification of the surface — a closed set of mutually-exclusive shapes the composable
 * switches on, so every branch is exhaustively covered and unit-tested off-device. [Empty] is the web's
 * null / non-finite fallback branch; [Amount] carries the already-formatted display string, the canonical
 * accessibility value (web `title`), and the [freshness] of the backing settings feed.
 */
sealed interface CurrencyRender {
    /** The web `value == null || !Number.isFinite(value)` branch — renders the [text] fallback ("—"). */
    data class Empty(
        val text: String,
    ) : CurrencyRender

    /**
     * A finite amount. [display] is `{symbol}{grouped number}` (web body); [accessibleValue] is the canonical
     * `{symbol}{value.toFixed(precision)}` (web `title` attribute, locale-independent); [freshness] reflects
     * the backing settings feed so the composable can show an informational freshness indicator.
     */
    data class Amount(
        val display: String,
        val accessibleValue: String,
        val freshness: CurrencyFreshness,
    ) : CurrencyRender
}

/**
 * The freshness of the symbol/locale the amount is rendered with, derived from the shared settings feed's
 * [UiState]. [Live] is the steady state (a bare amount, identical to the web span). The rest are informational:
 * the amount still renders (never a blank box) while a small indicator + an a11y state description disclose
 * that the symbol is being loaded, is stale, or is the last-known one because the settings refresh failed.
 */
enum class CurrencyFreshness {
    /** Fresh settings — render the bare amount with no chrome (the web default). */
    Live,

    /** Settings are loading or refreshing — the amount renders with the default / last-known symbol. */
    Loading,

    /** Settings are older than their TTL but reachable — the amount renders with the last-known symbol. */
    Stale,

    /** A settings refresh failed but a cached symbol is shown — offline / last-known. */
    Offline,

    /** A hard settings failure with nothing cached — the amount falls back to the default `$` (web parity). */
    Failed,
}

/**
 * Selects the render-ready [CurrencyRender] for [value] against the backing settings [format] feed — a 1:1 port
 * of the web component's inline branch. A `null` / non-finite [value] is the [CurrencyRender.Empty] fallback
 * (web `value == null || !Number.isFinite(value)`), regardless of feed state. Otherwise the symbol is
 * [symbolOverride] when supplied (web `symbolOverride ?? currencySymbol`), else the resolved symbol, falling
 * back to [CurrencyFormat.Default] while the feed has no value yet — so the amount always renders, exactly as
 * the web hook degrades to `$`. [precision] is the web prop; the [display] groups by locale (web `fmtNumber`)
 * and the [accessibleValue] is the canonical fixed form (web `value.toFixed`).
 */
fun classifyCurrency(
    value: Double?,
    format: UiState<CurrencyFormat>,
    precision: Int = DEFAULT_CURRENCY_PRECISION,
    symbolOverride: String? = null,
    fallback: String = CURRENCY_FALLBACK,
): CurrencyRender {
    if (value == null || !value.isFinite()) return CurrencyRender.Empty(fallback)
    val resolved = format.data ?: CurrencyFormat.Default
    val symbol = symbolOverride ?: resolved.symbol
    return CurrencyRender.Amount(
        display = symbol + currencyNumber(value, precision, resolved.localeTag),
        accessibleValue = symbol + currencyFixedUs(value, precision),
        freshness = currencyFreshness(format),
    )
}

/**
 * Maps the settings feed's [UiState] onto the surface's [CurrencyFreshness]. The error branches win first so a
 * stale-and-failed refresh reads as offline / failed rather than merely stale; a first load or an in-flight
 * refresh reads as loading; an older-but-reachable value reads as stale; everything else is live.
 */
internal fun currencyFreshness(state: UiState<*>): CurrencyFreshness =
    when {
        state.isError -> CurrencyFreshness.Failed
        state.hasError && state.hasData -> CurrencyFreshness.Offline
        state.isLoading -> CurrencyFreshness.Loading
        state.refreshing -> CurrencyFreshness.Loading
        state.stale -> CurrencyFreshness.Stale
        else -> CurrencyFreshness.Live
    }

/**
 * Formats [value] with [precision] fraction digits and locale grouping — the native analogue of the web
 * `fmtNumber(value, precision)` (`toLocaleString` with `min/maxFractionDigits`). [localeTag] is resolved to a
 * [Locale]; precision is clamped to the web `setGlobalPrecision` 0..20 range so an out-of-range prop never
 * throws. e.g. (1234.5, 2, "en-US") → "1,234.50"; ("de-DE") → "1.234,50".
 */
internal fun currencyNumber(
    value: Double,
    precision: Int,
    localeTag: String,
): String {
    val digits = precision.coerceIn(0, MAX_CURRENCY_PRECISION)
    return String.format(resolveCurrencyLocale(localeTag), "%,.${digits}f", value)
}

/**
 * The canonical, locale-independent fixed form — the native analogue of the web `value.toFixed(precision)` used
 * for the `title` attribute (no grouping, dot decimal, always `en-US`). e.g. (1234.5, 2) → "1234.50".
 */
internal fun currencyFixedUs(
    value: Double,
    precision: Int,
): String {
    val digits = precision.coerceIn(0, MAX_CURRENCY_PRECISION)
    return String.format(Locale.US, "%.${digits}f", value)
}

/** Resolves a BCP-47 [tag] to a [Locale], falling back to US for a blank / absent preference. */
internal fun resolveCurrencyLocale(tag: String?): Locale = if (tag.isNullOrBlank()) Locale.US else Locale.forLanguageTag(tag)

/**
 * The already-localized freshness labels the composable resolves from the i18n catalog (P1/S10) and feeds to
 * [currencyStateLabel]. Kept as a plain carrier so the a11y label mapping is unit-tested without a Compose host.
 *
 * @property loading announced while the symbol is loading / refreshing.
 * @property stale announced when the symbol is older than its TTL but reachable.
 * @property offline announced when the symbol is the last-known one after a failed refresh.
 * @property error announced when the symbol fell back to the default after a hard settings failure.
 */
data class CurrencyLabels(
    val loading: String,
    val stale: String,
    val offline: String,
    val error: String,
)

/**
 * The accessibility state description for [freshness], or `null` for [CurrencyFreshness.Live] (a live amount
 * needs no extra announcement — it reads as the canonical value alone). Pure so the per-state a11y labels are
 * unit-tested off-device.
 */
fun currencyStateLabel(
    freshness: CurrencyFreshness,
    labels: CurrencyLabels,
): String? =
    when (freshness) {
        CurrencyFreshness.Live -> null
        CurrencyFreshness.Loading -> labels.loading
        CurrencyFreshness.Stale -> labels.stale
        CurrencyFreshness.Offline -> labels.offline
        CurrencyFreshness.Failed -> labels.error
    }

/**
 * Emits the one PII-safe `view.opened` diagnostic with the [CURRENCY_SLUG] (P1/S11). Carries only the slug —
 * never the amount or the symbol — so a diagnostics line can never leak the operator's costs. Kept free of
 * Compose so it is unit-tested with a recording [Logger]; the view-model calls it once per holder.
 */
fun recordCurrencyOpened(logger: Logger) {
    logger.info("view.opened", mapOf("surface" to CURRENCY_SLUG))
}
