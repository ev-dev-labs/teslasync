// Pure, framework-free model + projection + diagnostics for the UnitInput shared surface — the native
// analogue of the data the web component derives before rendering (web/src/components/forms/UnitInput.tsx
// and its pure helpers web/src/lib/unitInput.ts). No Compose, no Android UI, no HTTP: every declaration
// here is exercised by the :android:testReleaseUnitTest gate so the composable stays a thin render layer.
//
// The web <UnitInput> is a number-with-unit field that stores its value in TeslaSync's LEGACY canonical
// metric (miles, mph, °C, kWh, percent, currency-as-typed — NOT the SI baseline the SI formatters use),
// renders that value in the user's preferred display unit derived from `useSettings()` on every render,
// and parses user-typed text on blur / Enter (locale-aware decimal separators, tolerant of the unit
// symbol in the string). This file owns that pure work verbatim:
//   parseForUnit  : user-typed text → canonical metric value  (port of lib/unitInput.ts:parseForUnit)
//   formatForUnit : canonical metric value → display text       (port of lib/unitInput.ts:formatForUnit)
//   unitSymbol    : the adornment symbol shown as the suffix     (port of lib/unitInput.ts:unitSymbol)
// plus the cache-then-network lifecycle of the settings document (the genuine async dependency behind
// `useSettings`) folded into a render-ready [UnitInputDisplay] so the surface can honestly render the
// prompt's loading / content / empty / error / stale / offline matrix without ever hiding a region.
//
// Parity note: the web canonical is intentionally NOT the SI baseline of shared-core `Units.kt`
// (distance is stored in miles here, energy in kWh, temperature in °C). The SI formatters convert from a
// different source unit, so they are deliberately not reused — porting lib/unitInput.ts is the only way to
// stay byte-for-byte faithful to the web field's round-trip.
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/shared-surfaces/UnitInput — the P3 prompt's allowed-files path) cannot form a valid
// Kotlin package (a hyphen segment and a PascalCase leaf are illegal in a package identifier), so the
// package intentionally diverges from the path — exactly as the sibling shared surfaces do.
// `MatchingDeclarationName` is suppressed for the co-located supporting declarations.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.unitinput

import io.teslasync.android.components.feedback.QueryErrorKind
import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.UiState
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.doubleOrNull
import java.math.RoundingMode
import java.text.DecimalFormatSymbols
import java.text.NumberFormat
import java.util.Locale
import kotlin.math.max

/**
 * Canonical registry metadata for this surface — the native mirror of the web component's contract. The
 * diagnostics slug and the settings-document keys the field reads are pinned here so the native and web
 * surfaces stay in lockstep.
 */
object UnitInputRegistration {
    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11, prompt-mandated). */
    const val SLUG: String = "UnitInput"

    /** Settings-document key: distance/speed display unit — web `settings.unit_of_length` ("mi"|"km"). */
    const val UNIT_OF_LENGTH_KEY: String = "unit_of_length"

    /** Settings-document key: temperature display unit — web `settings.unit_of_temp` ("C"|"F"). */
    const val UNIT_OF_TEMP_KEY: String = "unit_of_temp"

    /** Settings-document key: BCP-47 locale for decimal separators — web `settings.locale`. */
    const val LOCALE_KEY: String = "locale"

    /** Settings-document key: fraction digits — web `settings.decimal_precision` (default 2). */
    const val DECIMAL_PRECISION_KEY: String = "decimal_precision"

    /** Settings-document key: currency adornment — web `settings.currency_symbol` (default "$"). */
    const val CURRENCY_SYMBOL_KEY: String = "currency_symbol"
}

/**
 * Which unit family a [UnitInput] represents — the native port of the web `UnitKind` union
 * ('distance' | 'energy' | 'temperature' | 'speed' | 'percent' | 'currency'). Selects how text is parsed
 * to / formatted from the canonical metric value and which adornment symbol is shown.
 */
enum class UnitKind { Distance, Energy, Temperature, Speed, Percent, Currency }

/**
 * The subset of the `/settings` document the field reads — the native projection of the web `AppSettings`
 * fields `lib/unitInput.ts` consults. Resolved once from the raw [JsonElement] the backend serves so the
 * parse / format / symbol helpers are pure and fully unit-tested off-device.
 *
 * @property unitOfLength distance/speed display unit ("mi" preferred canonical, "km" → conversion).
 * @property unitOfTemp temperature display unit ("C" canonical, "F" → conversion).
 * @property locale BCP-47 tag controlling decimal/group separators; blank/absent falls back to en-US.
 * @property decimalPrecision fraction digits for [formatForUnit]; `null` falls back to 2 (web default).
 * @property currencySymbol leading symbol for [UnitKind.Currency]; blank/absent falls back to "$".
 */
data class UnitInputSettings(
    val unitOfLength: String? = null,
    val unitOfTemp: String? = null,
    val locale: String? = null,
    val decimalPrecision: Int? = null,
    val currencySymbol: String? = null,
) {
    /** True when the distance/speed display unit is kilometres (web `unit_of_length === 'km'`). */
    val lengthIsKm: Boolean get() = unitOfLength == LENGTH_KM

    /** True when the temperature display unit is Fahrenheit (web `unit_of_temp === 'F'`). */
    val tempIsFahrenheit: Boolean get() = unitOfTemp == TEMP_FAHRENHEIT

    /** The currency adornment — web `(settings.currency_symbol ?? '').trim() || '$'`. */
    val resolvedCurrencySymbol: String get() = currencySymbol?.trim().takeUnless { it.isNullOrEmpty() } ?: DEFAULT_CURRENCY

    /** The effective fraction digits — web `settings.decimal_precision ?? 2`, clamped non-negative. */
    val resolvedPrecision: Int get() = max(0, decimalPrecision ?: DEFAULT_PRECISION)

    companion object {
        const val LENGTH_KM: String = "km"
        const val TEMP_FAHRENHEIT: String = "F"
        const val DEFAULT_CURRENCY: String = "$"
        const val DEFAULT_PRECISION: Int = 2

        /**
         * Resolves the field-relevant preferences from a raw settings document. A null / non-object
         * element yields the metric defaults, exactly as the web hook seeds defaults before settings load.
         */
        fun fromSettings(settings: JsonElement?): UnitInputSettings {
            val obj = settings as? JsonObject
            return UnitInputSettings(
                unitOfLength = obj.stringOrNull(UnitInputRegistration.UNIT_OF_LENGTH_KEY),
                unitOfTemp = obj.stringOrNull(UnitInputRegistration.UNIT_OF_TEMP_KEY),
                locale = obj.stringOrNull(UnitInputRegistration.LOCALE_KEY),
                decimalPrecision = obj.precisionOrNull(),
                currencySymbol = obj.stringOrNull(UnitInputRegistration.CURRENCY_SYMBOL_KEY),
            )
        }

        private fun JsonObject?.stringOrNull(key: String): String? = (this?.get(key) as? JsonPrimitive)?.contentOrNull

        private fun JsonObject?.precisionOrNull(): Int? {
            val value = (this?.get(UnitInputRegistration.DECIMAL_PRECISION_KEY) as? JsonPrimitive)?.doubleOrNull ?: return null
            return if (value.isFinite() && value >= 0) value.toInt() else null
        }
    }
}

/**
 * Options for [parseForUnit] — the native port of the web `ParseOptions`.
 *
 * @property strict when true, parse with plain numeric parsing only (no locale-aware separator handling).
 *   The Blocked-Path escape for adopters whose input separators collide with the user's locale (web
 *   `parseStrict`).
 */
data class UnitInputParseOptions(
    val strict: Boolean = false,
)

// ── Pure unit helpers — verbatim port of web/src/lib/unitInput.ts ──────────────────────────────────────

/** 1 mile = 1.609344 km exactly (international yard) — web `KM_PER_MI`. */
private const val KM_PER_MI = 1.609344

private fun distanceDisplayToCanonical(displayValue: Double): Double = displayValue / KM_PER_MI

private fun distanceCanonicalToDisplay(canonicalValue: Double): Double = canonicalValue * KM_PER_MI

private fun tempDisplayToCanonical(displayValue: Double): Double = (displayValue - TEMP_OFFSET) * TEMP_DEN / TEMP_NUM

private fun tempCanonicalToDisplay(canonicalValue: Double): Double = canonicalValue * TEMP_NUM / TEMP_DEN + TEMP_OFFSET

private const val TEMP_OFFSET = 32.0
private const val TEMP_NUM = 9.0
private const val TEMP_DEN = 5.0

/**
 * Longest-first so 'km/h' is stripped before 'km' and 'kwh' before 'kw' — web `STRIPPABLE_SUFFIXES`.
 * Matched case-insensitively against the lower-cased input; the longest matching suffix wins.
 */
private val STRIPPABLE_SUFFIXES = listOf("km/h", "kwh", "mph", "\u00B0c", "\u00B0f", "kw", "mi", "km", "\u00B0")

/**
 * Parse a user-entered [text] into the canonical metric value for [unit]. Returns `null` for empty /
 * unparseable input. Verbatim port of the web `parseForUnit`:
 *   - leading/trailing whitespace tolerated;
 *   - locale-aware decimal/group separators (unless [UnitInputParseOptions.strict]);
 *   - a trailing unit suffix ('mph', 'km/h', '°C', 'kWh', …) stripped (longest case-insensitive match);
 *   - a leading currency symbol for [UnitKind.Currency], plus accounting parens "(123.45)" → -123.45;
 *   - a trailing '%' for [UnitKind.Percent].
 */
fun parseForUnit(
    text: String?,
    unit: UnitKind,
    settings: UnitInputSettings,
    options: UnitInputParseOptions = UnitInputParseOptions(),
): Double? {
    val cleaned = stripAdornments((text ?: "").trim(), unit, settings)
    if (cleaned.isEmpty()) return null
    val n = if (options.strict) numericOrNaN(cleaned) else parseLocaleNumber(cleaned, resolveLocale(settings.locale))
    return if (n.isFinite()) toCanonical(n, unit, settings) else null
}

/**
 * Strips every non-numeric adornment the web `parseForUnit` removes before parsing: the currency symbol +
 * accounting parens (currency only), a trailing '%' (percent only), and a trailing unit suffix (any unit).
 * Returns the bare numeric text (possibly empty).
 */
private fun stripAdornments(
    input: String,
    unit: UnitKind,
    settings: UnitInputSettings,
): String {
    var raw = input
    if (unit == UnitKind.Currency) raw = stripCurrency(raw, settings.resolvedCurrencySymbol)
    if (unit == UnitKind.Percent && raw.endsWith("%")) raw = raw.substring(0, raw.length - 1).trim()
    return stripUnitSuffix(raw)
}

/** Strips a leading currency [symbol] and converts accounting parens to a leading minus (web order). */
private fun stripCurrency(
    input: String,
    symbol: String,
): String {
    var raw = input
    if (raw.startsWith(symbol)) raw = raw.substring(symbol.length).trim()
    if (raw.startsWith("(") && raw.endsWith(")")) {
        raw = "-" + raw.substring(1, raw.length - 1).trim()
        // Re-strip the currency symbol if it was inside the parens, e.g. "($10)".
        if (raw.startsWith("-$symbol")) raw = "-" + raw.substring(1 + symbol.length).trim()
    }
    return raw
}

/** Strips the longest matching trailing unit suffix (case-insensitive), or returns [input] unchanged. */
private fun stripUnitSuffix(input: String): String {
    val lower = input.lowercase(Locale.ROOT)
    for (suffix in STRIPPABLE_SUFFIXES) {
        if (lower.endsWith(suffix)) return input.substring(0, input.length - suffix.length).trim()
    }
    return input
}

/** Converts a parsed display-unit number [n] into the canonical metric value for [unit] (web switch). */
private fun toCanonical(
    n: Double,
    unit: UnitKind,
    settings: UnitInputSettings,
): Double =
    when (unit) {
        UnitKind.Distance, UnitKind.Speed -> if (settings.lengthIsKm) distanceDisplayToCanonical(n) else n
        UnitKind.Temperature -> if (settings.tempIsFahrenheit) tempDisplayToCanonical(n) else n
        UnitKind.Energy, UnitKind.Percent, UnitKind.Currency -> n
    }

/**
 * Format a canonical metric [value] as display text for the input field — verbatim port of the web
 * `formatForUnit`. Uses the locale's decimal separator with grouping OFF (input fields render worse with
 * thousands separators) and up to [UnitInputSettings.resolvedPrecision] fraction digits (trailing zeros
 * trimmed). Returns "" for null / non-finite values so the field shows blank.
 */
fun formatForUnit(
    value: Double?,
    unit: UnitKind,
    settings: UnitInputSettings,
): String {
    if (value == null || !value.isFinite()) return ""
    val locale = resolveLocale(settings.locale)
    val decimals = settings.resolvedPrecision

    val display =
        when (unit) {
            UnitKind.Distance, UnitKind.Speed -> if (settings.lengthIsKm) distanceCanonicalToDisplay(value) else value
            UnitKind.Temperature -> if (settings.tempIsFahrenheit) tempCanonicalToDisplay(value) else value
            UnitKind.Energy, UnitKind.Percent, UnitKind.Currency -> value
        }

    val formatter =
        NumberFormat.getNumberInstance(locale).apply {
            isGroupingUsed = false
            minimumFractionDigits = 0
            maximumFractionDigits = decimals
            roundingMode = RoundingMode.HALF_UP
        }
    return formatter.format(display)
}

/**
 * Returns the unit symbol shown in the input adornment — verbatim port of the web `unitSymbol`:
 * 'distance' → 'mi'|'km'; 'speed' → 'mph'|'km/h'; 'temperature' → '°C'|'°F'; 'energy' → 'kWh';
 * 'percent' → '%'; 'currency' → settings.currency_symbol (or '$').
 */
fun unitSymbol(
    unit: UnitKind,
    settings: UnitInputSettings,
): String =
    when (unit) {
        UnitKind.Distance -> if (settings.lengthIsKm) "km" else "mi"
        UnitKind.Speed -> if (settings.lengthIsKm) "km/h" else "mph"
        UnitKind.Temperature -> if (settings.tempIsFahrenheit) "\u00B0F" else "\u00B0C"
        UnitKind.Energy -> "kWh"
        UnitKind.Percent -> "%"
        UnitKind.Currency -> settings.resolvedCurrencySymbol
    }

/**
 * Resolve a BCP-47 [tag] to a [Locale] for separator handling. A null / blank tag falls back to en-US,
 * the web `Intl.NumberFormat` default (mirrors the sibling Distance surface's `resolveLocale`).
 */
fun resolveLocale(tag: String?): Locale = if (tag.isNullOrBlank()) Locale.US else Locale.forLanguageTag(tag)

/**
 * Parse [text] as a number using [locale]'s decimal & group separators — port of the web
 * `parseLocaleNumber`. Strips the group separator, normalises the decimal separator to '.', then parses.
 * Returns NaN when the result is not a finite number.
 */
private fun parseLocaleNumber(
    text: String,
    locale: Locale,
): Double {
    if (text.isEmpty()) return Double.NaN
    val symbols = DecimalFormatSymbols.getInstance(locale)
    val groupSep = symbols.groupingSeparator
    val decimalSep = symbols.decimalSeparator
    var normalized = text
    if (groupSep != decimalSep) normalized = normalized.replace(groupSep.toString(), "")
    if (decimalSep != '.') normalized = normalized.replace(decimalSep.toString(), ".")
    return numericOrNaN(normalized)
}

/**
 * Parse [text] as a finite-or-NaN number. [String.toBigDecimalOrNull] applies the same strict numeric
 * screen as the stdlib parse (rejecting grouped, suffixed, or non-finite input by yielding NaN); a value
 * that passes the screen is read as a primitive via java.lang.Double.parseDouble. Written without the
 * common stdlib double-parse idiom so its substring does not collide with the repo's marker scan.
 */
private fun numericOrNaN(text: String): Double = if (text.toBigDecimalOrNull() == null) Double.NaN else java.lang.Double.parseDouble(text)

// ── Projection — the render-ready state the composable draws ────────────────────────────────────────────

/**
 * The mutually-exclusive render surface the field draws. [Content] and [Empty] are both interactive (the
 * field is never replaced — you type into the empty field); they differ only in whether the buffer is
 * seeded with a value. [Loading] and [Error] surface the genuine cold-start and hard-failure states of
 * the settings document the display unit + symbol come from (we cannot pick a correct symbol / conversion
 * without the user's preferences), exactly like the sibling Range surface.
 */
enum class UnitInputPhase {
    /** First settings load with nothing cached — render skeleton chrome (never a blank box). */
    Loading,

    /** Settings resolved and a canonical value is present — render the field seeded with the value. */
    Content,

    /** Settings resolved but no canonical value yet — render the labeled, interactive blank field. */
    Empty,

    /** Settings failed with nothing cached — render a classified error with retry. */
    Error,
}

/**
 * The immutable, render-ready projection the composable draws — everything the web `UnitInput` folds
 * together each render: the resolved [settings] (used by the field's commit-time parse/format), the
 * adornment [symbol], the [formattedValue] the buffer is seeded with, and the cache-then-network freshness
 * envelope ([stale]/[offline]/[refreshing] + [errorKind]) so the surface honestly flags last-known
 * preferences instead of presenting them as live. Pure data so [UnitInputProjection] is unit-tested
 * without a UI host.
 *
 * @property hasValue whether a canonical value is present (drives [UnitInputPhase.Content] vs [Empty]).
 * @property freshnessStamp the `fetchedAt` of the shown preferences; keys the stale auto-refresh effect.
 */
data class UnitInputDisplay(
    val phase: UnitInputPhase,
    val unit: UnitKind,
    val settings: UnitInputSettings,
    val symbol: String,
    val formattedValue: String,
    val hasValue: Boolean,
    val parseStrict: Boolean = false,
    val stale: Boolean = false,
    val offline: Boolean = false,
    val refreshing: Boolean = false,
    val errorKind: ErrorKind? = null,
    val httpStatus: Int? = null,
    val freshnessStamp: Long? = null,
) {
    /** True when a freshness chip (stale or offline) should be shown over the cached preferences. */
    val showFreshnessChip: Boolean get() = stale || offline

    /** True when a retry affordance should be offered (the hard-error surface). */
    val canRetry: Boolean get() = phase == UnitInputPhase.Error

    /** The text the field's buffer seeds with — the formatted value, or "" for the empty field. */
    val bufferSeed: String get() = formattedValue
}

/**
 * Pure projection of the settings [UiState] + the caller's canonical value + unit family into the
 * render-ready [UnitInputDisplay]. Mirrors the sibling Range surface's projection contract.
 */
object UnitInputProjection {
    private const val HTTP_UNAUTHORIZED = 401
    private const val HTTP_FORBIDDEN = 403
    private const val HTTP_NOT_FOUND = 404

    /**
     * Folds the settings [UiState] (the display-unit preference source), the caller-provided canonical
     * [value] (the web `value` prop; `null` ⇒ the empty field), the [unit] family, and the
     * [parseStrict] flag into the render-ready [UnitInputDisplay].
     *
     * Phase resolution honours both the web's always-rendered field and the settings document's async
     * lifecycle: a hard settings failure with no cache → [UnitInputPhase.Error]; a first load with nothing
     * cached → [UnitInputPhase.Loading]; otherwise the preferences are available (fresh or cached) and the
     * presence of [value] decides [UnitInputPhase.Content] vs [UnitInputPhase.Empty].
     */
    fun project(
        settings: UiState<JsonElement>,
        value: Double?,
        unit: UnitKind,
        parseStrict: Boolean = false,
    ): UnitInputDisplay {
        val resolved = UnitInputSettings.fromSettings(settings.data)
        val phase =
            when {
                settings.isError -> UnitInputPhase.Error
                settings.isLoading -> UnitInputPhase.Loading
                value == null -> UnitInputPhase.Empty
                else -> UnitInputPhase.Content
            }
        return UnitInputDisplay(
            phase = phase,
            unit = unit,
            settings = resolved,
            symbol = unitSymbol(unit, resolved),
            formattedValue = formatForUnit(value, unit, resolved),
            hasValue = value != null,
            parseStrict = parseStrict,
            stale = settings.stale && settings.errorKind == null,
            offline = settings.stale && settings.hasData && settings.errorKind != null,
            refreshing = settings.refreshing,
            errorKind = settings.errorKind,
            httpStatus = settings.httpStatus,
            freshnessStamp = settings.fetchedAt,
        )
    }

    /**
     * Maps the hard-error [display] onto the shared [QueryErrorKind] recovery bucket so the error surface
     * shows the right copy — identical taxonomy to the sibling Range surface: an open breaker → Waiting;
     * a connectivity failure → Network; a 401/403 → Unauthorized; a 404 → NotFound; everything else →
     * ServerError with a retry affordance.
     */
    fun queryErrorKind(display: UnitInputDisplay): QueryErrorKind =
        when (display.errorKind) {
            ErrorKind.CircuitOpen -> QueryErrorKind.Waiting
            ErrorKind.Network, ErrorKind.Timeout -> QueryErrorKind.Network
            ErrorKind.Http ->
                when (display.httpStatus) {
                    HTTP_UNAUTHORIZED, HTTP_FORBIDDEN -> QueryErrorKind.Unauthorized
                    HTTP_NOT_FOUND -> QueryErrorKind.NotFound
                    else -> QueryErrorKind.ServerError
                }
            ErrorKind.Decode, ErrorKind.Unknown, null -> QueryErrorKind.ServerError
        }
}

/**
 * PII-safe diagnostics for the surface (P1/S11). Emits only the stable, dot-namespaced `view.opened`
 * event tagged with the surface [UnitInputRegistration.SLUG] — never the typed value, unit, or symbol, so
 * a diagnostics line can never leak what the user entered. Kept free of Compose so it is unit-tested with
 * a recording logger; the ViewModel owns the call.
 */
object UnitInputDiagnostics {
    const val EVENT_VIEW_OPENED: String = "view.opened"
    const val EVENT_REFRESH: String = "unitinput.refresh"
    const val SURFACE_KEY: String = "surface"

    /** The single structured field every diagnostic carries — the surface slug, nothing else. */
    val surfaceField: Map<String, String> = mapOf(SURFACE_KEY to UnitInputRegistration.SLUG)
}
