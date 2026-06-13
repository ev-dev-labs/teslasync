// Pure, framework-free model + projection for the CurrencyInput shared surface — the native analogue of
// everything the web primitive derives before returning JSX (web/src/components/forms/CurrencyInput.tsx and
// its sole dependency web/src/lib/currencyFormat.ts). No Compose, no Android UI, no HTTP: every declaration
// here is exercised off-device by the :android:testReleaseUnitTest gate, so the composable stays a thin
// render layer over these pure functions.
//
// The web `CurrencyInput` is a currency-aware number field that stores its value in integer MICRO-units
// (1 major unit = 1_000_000) to avoid float round-trip loss across 0/2/3/4-fraction-digit currencies,
// renders the value with `Intl.NumberFormat` `style:'currency'`, and parses user-typed text on blur/Enter
// accepting the localized symbol on either side, the literal ISO code, locale group separators, and
// accounting parentheses for negatives. This file owns that contract's pure half: the micro<->value
// conversions (web `valueToMicro`/`microToValue`), the currency formatter (web `formatCurrencyValue`/
// `formatCurrencyMicro`), the localized symbol (web `currencySymbol`), the settings-symbol→ISO bridge (web
// `currencyCodeFromSymbol`), the locale-aware parser (web `parseCurrencyText`/`parseLocaleNumber`), the
// settings→format projection the surface binds to, the value/feed → render-ready projection, and the PII-safe
// `view.opened` diagnostic.
//
// States (Honesty Covenant #9 — documented, not silent): the web primitive takes `currency`/`locale` as
// props and renders immediately. The native surface ALSO binds the shared Settings feed (P1/S8) so a host
// can drop it in with no per-field wiring; that feed's cache-then-network lifecycle is the genuine async
// dependency that drives the prompt's loading / error / stale / offline matrix. When BOTH `currency` and
// `locale` are passed explicitly the field renders immediately regardless of the feed (web parity), and the
// surface's "empty" is the web's `valueMicro == null` blank-field branch.
//
// JVM formatting/parsing uses `java.text` + `java.util.Currency` (available off-device), not `android.icu`,
// so the pure logic runs in the offline unit-test gate. fr-FR's group separator is U+202F (narrow no-break
// space), so the parser strips ALL unicode whitespace, generalizing the web's U+00A0/space handling.
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/shared-surfaces/CurrencyInput — the P3 prompt's allowed-files path) cannot form a valid
// Kotlin package (a hyphen and a PascalCase segment are illegal in a package identifier), so the package
// intentionally diverges from the path — exactly as the sibling shared surfaces do. `MatchingDeclarationName`
// is suppressed for the co-located supporting declarations.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.currencyinput

import io.teslasync.android.components.feedback.QueryErrorKind
import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.UiState
import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull
import java.text.DecimalFormatSymbols
import java.text.NumberFormat
import java.util.Currency
import java.util.Locale

/** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). Carries no amount or symbol. */
const val CURRENCY_INPUT_SLUG: String = "CurrencyInput"

/** The ISO 4217 fallback used when the settings symbol is blank / unrecognised (web `currencyCodeFromSymbol`). */
const val DEFAULT_CURRENCY_CODE: String = "USD"

/** The BCP-47 default the web global locale falls back to (`settings.locale || 'en-US'`). */
const val DEFAULT_LOCALE_TAG: String = "en-US"

/** The web `CurrencyInput` `precision` prop default — fiat amounts use two fraction digits (`precision ?? 2`). */
const val DEFAULT_CURRENCY_PRECISION: Int = 2

/** Canonical micro scale: 1 major unit = 1_000_000 micro-units (web `MICRO_SCALE`). */
private const val MICRO_SCALE: Double = 1_000_000.0

/** Upper/lower bounds for rendered fraction digits — mirrors the web `setGlobalPrecision` 0..20 clamp. */
private const val MIN_PRECISION: Int = 0
private const val MAX_PRECISION: Int = 20

private const val CURRENCY_SYMBOL_KEY: String = "currency_symbol"
private const val LOCALE_KEY: String = "locale"

private const val EVENT_VIEW_OPENED: String = "view.opened"
private const val SURFACE_FIELD_KEY: String = "surface"

// ── Canonical storage = micro-units (web lib/currencyFormat.ts) ─────────────────────────────────────────

/**
 * Convert a major-unit number to integer micro-units — the native port of the web `valueToMicro`. Rounds to
 * the nearest micro to keep `0.1 + 0.2` style float drift out of storage; `null` / non-finite ⇒ `null`.
 * e.g. 1.5 → 1_500_000; 0.00001 → 10.
 */
fun valueToMicro(value: Double?): Long? {
    if (value == null || !value.isFinite()) return null
    return Math.round(value * MICRO_SCALE)
}

/**
 * Convert integer micro-units back to the major unit — the native port of the web `microToValue`. e.g.
 * 1_500_000 → 1.5; `null` ⇒ `null`.
 */
fun microToValue(micro: Long?): Double? = micro?.let { it / MICRO_SCALE }

/**
 * Format a major-unit [value] as currency text using the locale's `style:'currency'` rules — the native port
 * of the web `formatCurrencyValue` (`Intl.NumberFormat` with `style:'currency'`). Returns `""` for a
 * `null` / non-finite value (web pass-through to a blank input). [useGrouping] defaults to `false` for
 * in-field rendering (group separators inside an editable field cause cursor + round-trip pain — the web
 * default). An invalid ISO [currency] falls back to a plain decimal prefixed with the literal code, so the
 * field still renders something (web `catch`). e.g. (1.5,USD,en-US,2) → "$1.50"; (1.5,EUR,de-DE,2) → "1,50 €".
 */
fun formatCurrencyValue(
    value: Double?,
    currency: String,
    locale: String,
    precision: Int,
    useGrouping: Boolean = false,
): String {
    if (value == null || !value.isFinite()) return ""
    val digits = clampPrecision(precision)
    val loc = resolveLocale(normaliseLocale(locale))
    return formatWithCurrency(value, currency, loc, digits, useGrouping)
}

/**
 * Format a micro-unit [micro] value as currency text — convenience wrapper over [microToValue] +
 * [formatCurrencyValue] (web `formatCurrencyMicro`). This is the field's display string (symbol included).
 */
fun formatCurrencyMicro(
    micro: Long?,
    currency: String,
    locale: String,
    precision: Int,
    useGrouping: Boolean = false,
): String = formatCurrencyValue(microToValue(micro), currency, locale, precision, useGrouping)

private fun formatWithCurrency(
    value: Double,
    currency: String,
    loc: Locale,
    digits: Int,
    useGrouping: Boolean,
): String =
    try {
        val nf = NumberFormat.getCurrencyInstance(loc)
        nf.currency = Currency.getInstance(currency)
        nf.minimumFractionDigits = digits
        nf.maximumFractionDigits = digits
        nf.isGroupingUsed = useGrouping
        nf.format(value)
    } catch (_: IllegalArgumentException) {
        val nf = NumberFormat.getNumberInstance(loc)
        nf.minimumFractionDigits = digits
        nf.maximumFractionDigits = digits
        nf.isGroupingUsed = useGrouping
        "$currency ${nf.format(value)}".trim()
    }

/**
 * The localized currency symbol for [currency]/[locale] — the native port of the web `currencySymbol`. e.g.
 * (USD,en-US) → "$"; (EUR,de-DE) → "€"; (GBP,en-GB) → "£". Falls back to the literal code when the code is
 * not ISO 4217 (web `catch`).
 */
fun currencySymbol(
    currency: String,
    locale: String,
): String =
    try {
        Currency.getInstance(currency).getSymbol(resolveLocale(normaliseLocale(locale)))
    } catch (_: IllegalArgumentException) {
        currency
    }

/**
 * Best-effort reverse lookup of a settings currency symbol to its most-common ISO 4217 code — the native
 * port of the web `currencyCodeFromSymbol`. The settings panel stores only the symbol (`currency_symbol`),
 * not the ISO code, so this bridges that gap when the field needs a proper Intl-formatted string. Unknown /
 * blank symbols fall back to [DEFAULT_CURRENCY_CODE].
 */
fun currencyCodeFromSymbol(symbol: String?): String = SYMBOL_TO_CODE[(symbol ?: "").trim()] ?: DEFAULT_CURRENCY_CODE

/** The web `currencyCodeFromSymbol` switch table, as a lookup map so the function stays branch-free. */
private val SYMBOL_TO_CODE: Map<String, String> =
    mapOf(
        "$" to "USD",
        "\u20ac" to "EUR",
        "\u00a3" to "GBP",
        "\u00a5" to "JPY",
        "\u20b9" to "INR",
        "\u20bd" to "RUB",
        "\u20a9" to "KRW",
        "A$" to "AUD",
        "C$" to "CAD",
        "CHF" to "CHF",
        "kr" to "SEK",
        "R$" to "BRL",
        "R" to "ZAR",
        "NZ$" to "NZD",
        "HK$" to "HKD",
        "NT$" to "TWD",
        "S$" to "SGD",
        "\u20ba" to "TRY",
        "\u0e3f" to "THB",
        "Mex$" to "MXN",
        "z\u0142" to "PLN",
    )

/**
 * Parse a user-typed [text] as a major-unit number for [currency]/[locale] — the native port of the web
 * `parseCurrencyText`. Strips leading/trailing whitespace, the localized symbol on either side, the literal
 * ISO code (case-insensitively), locale group separators, and accounting parentheses for negatives
 * ("($1.50)" → -1.5). Returns `null` for empty / unparseable input.
 */
fun parseCurrencyText(
    text: String,
    currency: String,
    locale: String,
): Double? {
    val cleaned = cleanCurrencyText(text, currency, locale) ?: return null
    val n = parseLocaleNumber(cleaned.digits, normaliseLocale(locale))
    return if (n.isFinite()) (if (cleaned.negative) -n else n) else null
}

/**
 * Parse user-typed [text] directly into integer micro-units — convenience wrapper over [parseCurrencyText] +
 * [valueToMicro] (web `parseCurrencyTextToMicro`). This is the field's commit path (blur / Enter).
 */
fun parseCurrencyTextToMicro(
    text: String,
    currency: String,
    locale: String,
): Long? = valueToMicro(parseCurrencyText(text, currency, locale))

/**
 * Parse [text] as a number using [locale]'s decimal & group separators — the native port of the web
 * `parseLocaleNumber`. e.g. ("1,234.56",en-US) → 1234.56; ("1.234,56",de-DE) → 1234.56; ("1 234,56",fr-FR) →
 * 1234.56. fr-FR's group separator is a narrow no-break space (U+202F), so any whitespace group separator —
 * and any residual whitespace — is stripped (generalizing the web U+00A0/space handling).
 */
fun parseLocaleNumber(
    text: String,
    locale: String,
): Double {
    if (text.isEmpty()) return Double.NaN
    val symbols = DecimalFormatSymbols.getInstance(resolveLocale(locale))
    val normalized = normalizeNumber(text, symbols.groupingSeparator, symbols.decimalSeparator)
    return parseDoubleOrNaN(normalized)
}

/**
 * Parse [text] as a [Double], yielding [Double.NaN] for an unparseable string — the native equivalent of the
 * web `Number(normalized)` NaN fallback. Uses `java.lang.Double.parseDouble` (off-device safe) so the digits
 * have already been locale-normalised by the caller.
 */
private fun parseDoubleOrNaN(text: String): Double =
    try {
        java.lang.Double.parseDouble(text)
    } catch (_: NumberFormatException) {
        Double.NaN
    }

private fun normalizeNumber(
    text: String,
    group: Char,
    decimal: Char,
): String {
    val degrouped =
        when {
            group.isWhitespace() -> text.filterNot { it.isWhitespace() }
            group != decimal -> text.replace(group.toString(), "")
            else -> text
        }
    val dotted = if (decimal != '.') degrouped.replace(decimal, '.') else degrouped
    return dotted.filterNot { it.isWhitespace() }
}

/**
 * Strip the symbol, the literal ISO code, and any plain-letter adornment around the numeric portion — the
 * native port of the web `stripCurrencyAdornments`. The symbol is tried as a substring (locales like de-DE
 * suffix it: "1,50 €"); the code is matched case-insensitively anywhere.
 */
private fun stripCurrencyAdornments(
    raw: String,
    currency: String,
    locale: String,
): String {
    val symbol = currencySymbol(currency, locale)
    val code = currency.trim()
    var out = raw
    if (symbol.isNotEmpty() && symbol != code) out = out.replace(symbol, "")
    if (code.isNotEmpty()) out = out.replace(Regex(Regex.escape(code), RegexOption.IGNORE_CASE), "")
    return out.trim()
}

/** The sanitized numeric core of a parse: the bare digits string and the resolved sign. */
private data class CleanCurrency(
    val digits: String,
    val negative: Boolean,
)

/**
 * The guard-clause core of [parseCurrencyText]: trims, unwraps accounting parens, strips currency adornments,
 * and collapses a leading sign into one canonical flag. `ReturnCount` is suppressed — a faithful guard-clause
 * port of the web helper; flattening would obscure the parity mapping.
 */
@Suppress("ReturnCount")
private fun cleanCurrencyText(
    text: String,
    currency: String,
    locale: String,
): CleanCurrency? {
    val trimmed = text.trim()
    if (trimmed.isEmpty()) return null
    var negative = false
    var raw = trimmed
    if (raw.startsWith("(") && raw.endsWith(")")) {
        negative = true
        raw = raw.substring(1, raw.length - 1).trim()
    }
    raw = stripCurrencyAdornments(raw, currency, locale)
    if (raw.isEmpty()) return null
    when {
        raw.startsWith("-") -> {
            negative = !negative
            raw = raw.substring(1).trim()
        }
        raw.startsWith("+") -> raw = raw.substring(1).trim()
    }
    if (raw.isEmpty()) return null
    return CleanCurrency(raw, negative)
}

private fun clampPrecision(precision: Int): Int = precision.coerceIn(MIN_PRECISION, MAX_PRECISION)

private fun normaliseLocale(locale: String?): String = if (!locale.isNullOrBlank()) locale else DEFAULT_LOCALE_TAG

private fun resolveLocale(tag: String): Locale = if (tag.isBlank()) Locale.US else Locale.forLanguageTag(tag)

// ── Surface model (settings → format → render projection) ───────────────────────────────────────────────

/** The change payload the field emits on commit — the native port of the web `CurrencyInputChangePayload`. */
data class CurrencyInputChange(
    val valueMicro: Long?,
)

/**
 * The resolved currency context the field formats/parses with — the native slice of the web component's
 * `currency` + `locale` props. The symbol is derived from these via [currencySymbol]; precision is a render
 * prop, not part of this.
 */
data class CurrencyInputFormat(
    val currency: String,
    val locale: String,
) {
    companion object {
        /** The pre-settings default — USD / en-US — exactly what the web hooks fall back to cold. */
        val Default: CurrencyInputFormat = CurrencyInputFormat(DEFAULT_CURRENCY_CODE, DEFAULT_LOCALE_TAG)
    }
}

/**
 * Projects the raw `/settings` document onto a [CurrencyInputFormat] — `currency_symbol` is bridged to an ISO
 * code (web `currencyCodeFromSymbol`) and `locale` is used when non-blank, else en-US. A `null` document
 * (cold start) yields [CurrencyInputFormat.Default].
 */
fun resolveCurrencyInputFormat(settings: JsonElement?): CurrencyInputFormat {
    val obj = settings as? JsonObject ?: return CurrencyInputFormat.Default
    val symbol = obj.string(CURRENCY_SYMBOL_KEY)
    val locale = obj.string(LOCALE_KEY)
    return CurrencyInputFormat(
        currency = currencyCodeFromSymbol(symbol),
        locale = if (!locale.isNullOrBlank()) locale else DEFAULT_LOCALE_TAG,
    )
}

private fun JsonObject.string(key: String): String? = (this[key] as? JsonPrimitive)?.contentOrNull

/**
 * The mutually-exclusive render surface the field draws. [Editable] reproduces the web's always-editable
 * field (the value present vs absent is a sub-state the field itself renders, never a hidden region);
 * [Loading] and [Error] surface the genuine cold-start and hard-failure states of the settings document the
 * default currency + locale come from.
 */
enum class CurrencyInputPhase {
    /** First settings load with nothing cached — render skeleton chrome (never a blank box). */
    Loading,

    /** Preferences are available (fresh or cached) — render the editable field. */
    Editable,

    /** Settings failed with nothing cached to fall back on — render a classified error with retry. */
    Error,
}

/**
 * The immutable, render-ready projection the composable draws: the resolved [currency]/[locale]/[symbol] the
 * field formats with, plus the cache-then-network freshness envelope ([stale]/[offline]/[refreshing] +
 * [errorKind]) so the surface honestly flags last-known preferences instead of presenting them as live.
 * `LongParameterList` is suppressed — a freshness-carrying display DTO, one field per ADR-013 flag the surface
 * renders.
 */
@Suppress("LongParameterList")
data class CurrencyInputDisplay(
    val phase: CurrencyInputPhase,
    val currency: String,
    val locale: String,
    val symbol: String,
    val stale: Boolean = false,
    val offline: Boolean = false,
    val refreshing: Boolean = false,
    val errorKind: ErrorKind? = null,
    val httpStatus: Int? = null,
    val freshnessStamp: Long? = null,
) {
    /** True when a freshness chip (stale or offline) should be shown over the editable field. */
    val showFreshnessChip: Boolean get() = stale || offline

    /** True when a retry affordance should be offered (the hard-error surface). */
    val canRetry: Boolean get() = phase == CurrencyInputPhase.Error
}

/** Pure projection logic for the CurrencyInput surface — folds the settings feed + caller overrides. */
object CurrencyInputProjection {
    private const val HTTP_UNAUTHORIZED = 401
    private const val HTTP_FORBIDDEN = 403
    private const val HTTP_NOT_FOUND = 404

    /**
     * Folds the settings [UiState] with the caller's optional [currencyOverride]/[localeOverride] (the web
     * `currency`/`locale` props) into the render-ready [CurrencyInputDisplay]. When BOTH overrides are present
     * the field renders immediately ([CurrencyInputPhase.Editable]) regardless of the feed — web parity, since
     * explicit props need no settings — and the freshness envelope is suppressed (no settings dependency).
     * Otherwise the feed's lifecycle decides: a hard failure with no cache → [CurrencyInputPhase.Error]; a
     * first load with nothing cached → [CurrencyInputPhase.Loading]; else the field is editable with the
     * resolved (or cached) preferences.
     */
    fun project(
        settings: UiState<JsonElement>,
        currencyOverride: String?,
        localeOverride: String?,
    ): CurrencyInputDisplay {
        val resolved = resolveCurrencyInputFormat(settings.data)
        val currency = currencyOverride?.takeIf { it.isNotBlank() } ?: resolved.currency
        val locale = localeOverride?.takeIf { it.isNotBlank() } ?: resolved.locale
        val explicitBoth = !currencyOverride.isNullOrBlank() && !localeOverride.isNullOrBlank()
        val freshness = !explicitBoth
        return CurrencyInputDisplay(
            phase = phaseFor(settings, explicitBoth),
            currency = currency,
            locale = locale,
            symbol = currencySymbol(currency, locale),
            stale = freshness && settings.stale && settings.errorKind == null,
            offline = freshness && settings.stale && settings.hasData && settings.errorKind != null,
            refreshing = freshness && settings.refreshing,
            errorKind = if (freshness) settings.errorKind else null,
            httpStatus = if (freshness) settings.httpStatus else null,
            freshnessStamp = settings.fetchedAt,
        )
    }

    private fun phaseFor(
        settings: UiState<JsonElement>,
        explicitBoth: Boolean,
    ): CurrencyInputPhase =
        when {
            explicitBoth -> CurrencyInputPhase.Editable
            settings.isError -> CurrencyInputPhase.Error
            settings.isLoading -> CurrencyInputPhase.Loading
            else -> CurrencyInputPhase.Editable
        }

    /**
     * Maps the hard-error [display] onto the shared [QueryErrorKind] recovery bucket so the error surface
     * shows the right copy: an open breaker → [QueryErrorKind.Waiting]; connectivity → [QueryErrorKind.Network];
     * a 401/403 → [QueryErrorKind.Unauthorized]; a 404 → [QueryErrorKind.NotFound]; everything else →
     * [QueryErrorKind.ServerError] with a retry affordance.
     */
    fun queryErrorKind(display: CurrencyInputDisplay): QueryErrorKind =
        when (display.errorKind) {
            ErrorKind.CircuitOpen -> QueryErrorKind.Waiting
            ErrorKind.Network, ErrorKind.Timeout -> QueryErrorKind.Network
            ErrorKind.Http -> httpQueryErrorKind(display.httpStatus)
            ErrorKind.Decode, ErrorKind.Unknown, null -> QueryErrorKind.ServerError
        }

    private fun httpQueryErrorKind(status: Int?): QueryErrorKind =
        when (status) {
            HTTP_UNAUTHORIZED, HTTP_FORBIDDEN -> QueryErrorKind.Unauthorized
            HTTP_NOT_FOUND -> QueryErrorKind.NotFound
            else -> QueryErrorKind.ServerError
        }
}

/**
 * Emits the one PII-safe `view.opened` diagnostic with the [CURRENCY_INPUT_SLUG] (P1/S11). Carries only the
 * slug — never the amount, symbol, or locale — so a diagnostics line can never leak the operator's tariff.
 * Kept free of Compose so it is unit-tested with a recording [Logger]; the view-model calls it once per holder.
 */
fun recordCurrencyInputOpened(logger: Logger) {
    logger.info(EVENT_VIEW_OPENED, mapOf(SURFACE_FIELD_KEY to CURRENCY_INPUT_SLUG))
}
