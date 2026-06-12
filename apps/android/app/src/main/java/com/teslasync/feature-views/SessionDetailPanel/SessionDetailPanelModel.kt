// Pure, framework-free model + projection for the SessionDetailPanel feature view — the native analogue of
// everything the web component derives before it returns JSX
// (web/src/features/charging/components/charging-curve/SessionDetailPanel.tsx and its `helpers.ts`,
// `dateFormat.ts`, `numberFormat.ts`, and `useFormatting`). No Compose, no Android, no HTTP: every
// declaration here is exercised off-device by the :android:testReleaseUnitTest gate, so the composable stays
// a thin render layer over these pure functions.
//
// The web component is purely presentational — its parent (the Charging Curve page) holds the
// `useChargingSessions` query and passes one decoded `session` down. From that prop it renders one glass
// panel: a "Session Details" header over a definition list of label/value rows (Date, Charger Type, SOC
// Range, Energy Added, Peak Power, optionally Avg Power, Duration, optionally Cost, optionally Location).
// This file owns the parts the web expresses inline: the `getChargerLabel` classifier, the `durationMinutes`
// derivation, the `formatDateTime`/`fmtWithUnit`/`formatCurrency` value formatting, the SOC-range string, the
// `useFormatting` currency + precision contract, the ordered row projection with its three conditional rows,
// and the lifecycle projection onto the shared cache-then-network [UiState] (so the surface renders every
// state the P1/S8 layer can carry). `fmtNumber` mirrors the web `Intl.NumberFormat` half-away-from-zero
// rounding rather than Java's default banker's rounding.
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/feature-views/SessionDetailPanel — the P3 prompt's allowed-files path) cannot form a valid
// Kotlin package (a hyphen and a PascalCase segment are illegal in a package identifier), so the package
// intentionally diverges from the path — exactly as the sibling feature-view surfaces do.
// `MatchingDeclarationName` is suppressed for the co-located supporting declarations.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.sessiondetailpanel

import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import io.teslasync.shared.core.api.generated.ChargingSession
import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.doubleOrNull
import java.math.RoundingMode
import java.text.DecimalFormat
import java.text.DecimalFormatSymbols
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.time.format.FormatStyle
import java.util.Locale
import kotlin.math.floor
import kotlin.math.roundToLong

/** The universal "unknown" marker for a missing value — the web SOC `?? '?'` fallback. */
internal const val UNKNOWN: String = "?"

/** Default currency symbol when the settings document has none — the web `useFormatting` `'$'`. */
internal const val DEFAULT_CURRENCY: String = "$"

/** Default decimal precision before settings load — the web `useFormatting`/`fmtNumber` `2` default. */
internal const val DEFAULT_PRECISION: Int = 2

/**
 * The already-localized strings the panel renders. The web component is anonymous — it resolves every label
 * through `useTranslation` — so these arrive through the P1/S10 i18n facade at the Compose boundary and are
 * passed down, keeping the surface free of any English literal. The three charger labels reuse existing
 * catalog keys so the web's hardcoded `getChargerLabel` results are localized here rather than hardcoded.
 *
 * @property title web `charging.curve.sessionDetails` ("Session Details").
 * @property date web `charging.curve.date` ("Date").
 * @property chargerType web `charging.curve.chargerType` ("Charger Type").
 * @property socRange web `charging.curve.socRange` ("SOC Range").
 * @property energyAdded web `charging.curve.energyAdded` ("Energy Added").
 * @property peakPower web `charging.curve.peakPower` ("Peak Power").
 * @property avgPower web `charging.curve.avgPower` ("Avg Power").
 * @property duration web `charging.curve.duration` ("Duration").
 * @property cost web `charging.curve.cost` ("Cost"). The web source reads the key `charging.curve.cost_decimal`,
 *   which has no entry in the shared P1/S10 catalog; `charging.curve.cost` is the catalog's canonical key for
 *   the identical "Cost" label, so it is used here (same rendered label, real catalog key).
 * @property location web `charging.curve.location` ("Location").
 * @property noData the empty-state message (web always has a session; the native empty phase shows this).
 * @property chargerHomeAc web `getChargerLabel` "Home / AC" result, via `charging.curve.acHome`.
 * @property chargerSupercharger web `getChargerLabel` "Supercharger" result, via the `Supercharger` key.
 * @property chargerDcFast web `getChargerLabel` "DC Fast" result, via `charging.curve.dcFast`.
 */
data class SessionDetailPanelStrings(
    val title: String,
    val date: String,
    val chargerType: String,
    val socRange: String,
    val energyAdded: String,
    val peakPower: String,
    val avgPower: String,
    val duration: String,
    val cost: String,
    val location: String,
    val noData: String,
    val chargerHomeAc: String,
    val chargerSupercharger: String,
    val chargerDcFast: String,
)

/**
 * The user's number/currency display preference this surface needs — the native port of the web
 * `useFormatting` read of the `/settings` document. [currencySymbol] formats the optional Cost row (web
 * `formatCurrency`); [decimalPrecision] is the fraction-digit count applied to every `fmtWithUnit` value
 * (energy, peak, avg, duration) and to the cost, mirroring the web global precision set from
 * `settings.decimal_precision`.
 */
data class SessionDetailFormat(
    val currencySymbol: String,
    val decimalPrecision: Int,
) {
    companion object {
        /** The `$` / precision-2 default used before settings load (matches the web defaults). */
        val DEFAULT: SessionDetailFormat = SessionDetailFormat(DEFAULT_CURRENCY, DEFAULT_PRECISION)

        private const val KEY_CURRENCY_SYMBOL = "currency_symbol"
        private const val KEY_DECIMAL_PRECISION = "decimal_precision"
        private const val MAX_PRECISION = 20

        /**
         * Resolves the currency symbol and decimal precision from the raw `/settings` document (web
         * `useFormatting`). A blank/missing symbol falls back to `$`; a missing, non-finite, or negative
         * precision falls back to `2`, and any fractional value is floored and clamped to `0..20` so the
         * downstream `DecimalFormat` pattern is always valid.
         */
        fun fromSettings(settings: JsonElement?): SessionDetailFormat {
            val obj = settings as? JsonObject ?: return DEFAULT
            val rawSymbol = (obj[KEY_CURRENCY_SYMBOL] as? JsonPrimitive)?.contentOrNull?.trim()
            val symbol = if (!rawSymbol.isNullOrEmpty()) rawSymbol else DEFAULT_CURRENCY
            val rawPrecision = (obj[KEY_DECIMAL_PRECISION] as? JsonPrimitive)?.doubleOrNull
            val precision =
                if (rawPrecision != null && rawPrecision.isFinite() && rawPrecision >= 0) {
                    floor(rawPrecision).toInt().coerceIn(0, MAX_PRECISION)
                } else {
                    DEFAULT_PRECISION
                }
            return SessionDetailFormat(symbol, precision)
        }
    }
}

/**
 * The charger bucket a session is classified into — the native union of the web `getChargerLabel` result.
 * Each maps to a localized label at the render boundary via [SessionDetailPanelProjection.chargerLabel].
 */
enum class ChargerLabelKind { HomeAc, Supercharger, DcFast }

/**
 * One projected, render-ready label/value row — the native analogue of a web `SessionDetailRow`. Both fields
 * are pre-formatted Strings (no Compose types), so the projection is unit-tested without a UI host; the
 * composable maps each row onto the shared `KVList`.
 */
data class SessionDetailRow(
    val label: String,
    val value: String,
)

/**
 * Pure projection from a [ChargingSession] to its render-ready rows — a 1:1 port of the web component's
 * inline derivations and value formatting plus its `helpers.ts` (`getChargerLabel`, `durationMinutes`).
 * Stateless and side-effect-free so it is fully covered by the off-device unit gate; the composable only
 * resolves localized strings and draws what these return.
 */
object SessionDetailPanelProjection {
    /** Watt-hours per kilowatt-hour — the web `total_energy_added_wh / 1000`. */
    const val WH_PER_KWH: Double = 1000.0

    /** Watts per kilowatt — the web `power_w / 1000`. */
    const val W_PER_KW: Double = 1000.0

    /** Peak-power threshold above which an untyped session is treated as DC fast (web `> 20_000`). */
    const val DC_FAST_PEAK_W: Double = 20_000.0

    /** Energy unit suffix — the web literal `'kWh'`. */
    const val UNIT_KWH: String = "kWh"

    /** Power unit suffix — the web literal `'kW'`. */
    const val UNIT_KW: String = "kW"

    /** Duration unit suffix — the web literal `'min'`. */
    const val UNIT_MIN: String = "min"

    private const val PERCENT = "%"
    private const val ARROW = " \u2192 "
    private const val MILLIS_PER_MINUTE = 60_000.0
    private const val MAX_FRACTION_DIGITS = 20
    private const val TESLA_TYPE = "Tesla"
    private const val TESLA_NEEDLE = "tesla"

    /**
     * Maps the panel's `(session, isLoading)` props onto the shared cache-then-network [UiState] (P1/S8).
     * The web component itself has no loading/error surface (its parent owns those); this adapter adds the
     * lifecycle states the host's feed can carry while preserving web precedence: loading → [UiPhase.Loading];
     * a present session → [UiPhase.Content] (the panel renders its rows); a null session → [UiPhase.Empty]
     * (the panel still renders, with a friendly "no data" body — never a blank box).
     */
    fun projectUiState(
        session: ChargingSession?,
        isLoading: Boolean,
    ): UiState<ChargingSession> =
        when {
            isLoading -> UiState.loading()
            session != null -> UiState(phase = UiPhase.Content, data = session)
            else -> UiState(phase = UiPhase.Empty)
        }

    /**
     * Classify a session's charger — a verbatim port of the web `getChargerLabel` precedence: a `Tesla`
     * (or any `tesla`-containing) charger type is a Supercharger; any other non-empty charger type is DC
     * fast; an untyped session whose peak power exceeds [DC_FAST_PEAK_W] is also DC fast; everything else is
     * home/AC.
     */
    fun classifyCharger(session: ChargingSession): ChargerLabelKind {
        val chargerType = session.chargerType
        val normalized = (chargerType ?: "").lowercase(Locale.US)
        return when {
            chargerType == TESLA_TYPE || normalized.contains(TESLA_NEEDLE) -> ChargerLabelKind.Supercharger
            !chargerType.isNullOrEmpty() -> ChargerLabelKind.DcFast
            (session.peakPowerW ?: 0.0) > DC_FAST_PEAK_W -> ChargerLabelKind.DcFast
            else -> ChargerLabelKind.HomeAc
        }
    }

    /** The localized label for a [ChargerLabelKind] (web `getChargerLabel` string, lifted to catalog keys). */
    fun chargerLabel(
        kind: ChargerLabelKind,
        strings: SessionDetailPanelStrings,
    ): String =
        when (kind) {
            ChargerLabelKind.HomeAc -> strings.chargerHomeAc
            ChargerLabelKind.Supercharger -> strings.chargerSupercharger
            ChargerLabelKind.DcFast -> strings.chargerDcFast
        }

    /**
     * The session duration in whole minutes — a port of the web `durationMinutes(startedAt, endedAt)`: no end
     * yet (or an end at/ before the start) reads as `0`; otherwise `round((end − start) / 60000)`. The
     * half-away-from-zero [roundToLong] matches JavaScript's `Math.round` for the positive durations here.
     */
    fun durationMinutes(session: ChargingSession): Long {
        val end = session.endedAt ?: return 0L
        val deltaMillis = end.toEpochMilliseconds() - session.startedAt.toEpochMilliseconds()
        return if (deltaMillis <= 0L) 0L else (deltaMillis / MILLIS_PER_MINUTE).roundToLong()
    }

    /**
     * The SOC-range string — the web `` `${start_soc_pct}% → ${end_soc_pct ?? '?'}%` ``. Each bound is
     * rendered with [jsNumber] (the raw, non-locale-grouped JavaScript number string the web template uses);
     * a missing bound reads as `?`, matching the web end-of-range fallback.
     */
    fun socRange(session: ChargingSession): String =
        socComponent(session.startSocPct) + PERCENT + ARROW + socComponent(session.endSocPct) + PERCENT

    /** One SOC bound: its [jsNumber] string when present and finite, else the `?` fallback (web `?? '?'`). */
    fun socComponent(value: Double?): String = if (value == null) UNKNOWN else jsNumber(value)

    /**
     * Render a [Double] the way a JavaScript template literal does (`${value}`): a whole number drops its
     * `.0`, a fractional number keeps its natural decimals, and a non-finite value reads as `?`. Used for the
     * SOC bounds, which the web interpolates raw (no locale grouping, no fixed precision).
     */
    fun jsNumber(value: Double): String =
        when {
            !value.isFinite() -> UNKNOWN
            value == floor(value) -> value.toLong().toString()
            else -> value.toString()
        }

    /**
     * Locale-aware "medium date, short time" formatting of an epoch-millisecond instant — the native analogue
     * of the web `formatDateTime` (`toLocaleString` with `{year, month:'short', day, hour, minute}`),
     * rendered in [zone] for [locale]. Pure (java.time only) so it is unit-tested deterministically.
     */
    fun formatDateTime(
        epochMillis: Long,
        zone: ZoneId,
        locale: Locale,
    ): String =
        DateTimeFormatter
            .ofLocalizedDateTime(FormatStyle.MEDIUM, FormatStyle.SHORT)
            .withLocale(locale)
            .withZone(zone)
            .format(Instant.ofEpochMilli(epochMillis))

    /**
     * Locale-aware fixed-precision formatting — the native mirror of the web `fmtNumber(value, decimals)`
     * (`Intl.NumberFormat` with equal min/max fraction digits). Groups thousands and rounds half away from
     * zero so the output matches ECMAScript's `halfExpand` rather than Java's default banker's rounding; a
     * non-finite value is coerced to 0 (web `safeNumber`). [decimals] is clamped to `0..20` like the web
     * global-precision setter.
     */
    fun fmtNumber(
        value: Double,
        decimals: Int,
        locale: Locale,
    ): String {
        val safeDecimals = decimals.coerceIn(0, MAX_FRACTION_DIGITS)
        val pattern = if (safeDecimals > 0) "#,##0." + "0".repeat(safeDecimals) else "#,##0"
        return DecimalFormat(pattern, DecimalFormatSymbols(locale))
            .apply { roundingMode = RoundingMode.HALF_UP }
            .format(safe(value))
    }

    /** Value with a unit suffix — the web `fmtWithUnit(value, unit)` (`` `${fmtNumber(value)} ${unit}` ``). */
    fun fmtWithUnit(
        value: Double,
        unit: String,
        decimals: Int,
        locale: Locale,
    ): String = "${fmtNumber(value, decimals, locale)} $unit"

    /**
     * Currency formatting — the web `useFormatting` `currencySymbol + fmtNumber(amount, decimals)` contract.
     * A blank symbol falls back to `$`; a non-finite amount is normalized to 0 (web `safeNumber`).
     */
    fun formatCurrency(
        amount: Double,
        symbol: String,
        decimals: Int,
        locale: Locale,
    ): String = "${symbol.ifBlank { DEFAULT_CURRENCY }}${fmtNumber(amount, decimals, locale)}"

    /**
     * The ordered, render-ready rows for [session] — a 1:1 port of the web component's JSX, including its
     * three conditional rows: Avg Power only when `avg_power_w` is present, Cost only when `cost_decimal` is
     * present, and Location only when `start_place` is a non-empty string. Energy is converted from SI
     * watt-hours and peak/avg from SI watts exactly as the web does; [format] supplies the currency symbol +
     * precision, [locale] the grouping/decimal separators, and [zone] the date's wall-clock zone.
     */
    fun rows(
        session: ChargingSession,
        format: SessionDetailFormat,
        locale: Locale,
        zone: ZoneId,
        strings: SessionDetailPanelStrings,
    ): List<SessionDetailRow> {
        val precision = format.decimalPrecision
        val energyKwh = safe(session.totalEnergyAddedWh) / WH_PER_KWH
        val peakKw = (session.peakPowerW ?: 0.0) / W_PER_KW
        val rows = mutableListOf<SessionDetailRow>()
        rows += SessionDetailRow(strings.date, formatDateTime(session.startedAt.toEpochMilliseconds(), zone, locale))
        rows += SessionDetailRow(strings.chargerType, chargerLabel(classifyCharger(session), strings))
        rows += SessionDetailRow(strings.socRange, socRange(session))
        rows += SessionDetailRow(strings.energyAdded, fmtWithUnit(energyKwh, UNIT_KWH, precision, locale))
        rows += SessionDetailRow(strings.peakPower, fmtWithUnit(peakKw, UNIT_KW, precision, locale))
        session.avgPowerW?.let { avg ->
            rows += SessionDetailRow(strings.avgPower, fmtWithUnit(avg / W_PER_KW, UNIT_KW, precision, locale))
        }
        rows += SessionDetailRow(strings.duration, fmtWithUnit(durationMinutes(session) + 0.0, UNIT_MIN, precision, locale))
        session.costDecimal?.let { cost ->
            rows += SessionDetailRow(strings.cost, formatCurrency(cost, format.currencySymbol, precision, locale))
        }
        session.startPlace?.takeIf { it.isNotEmpty() }?.let { place ->
            rows += SessionDetailRow(strings.location, place)
        }
        return rows
    }

    /** Web `safeNumber(v)`: the value when it is a finite number, otherwise 0 — so a row never reads `NaN`. */
    private fun safe(value: Double?): Double = if (value != null && value.isFinite()) value else 0.0
}

/**
 * The one PII-safe diagnostic this surface emits (P1/S11). Carries only the surface [SLUG] — never any
 * session field — so a diagnostics line can never leak a user's charging posture or location.
 */
object SessionDetailPanelDiagnostics {
    /** Diagnostics surface slug emitted with the `view.opened` event. */
    const val SLUG: String = "SessionDetailPanel"

    private const val VIEW_OPENED = "view.opened"
    private const val SURFACE_KEY = "surface"

    /** Emits the `view.opened` diagnostic for this surface. Call from the composable's first-composition effect. */
    fun recordViewOpened(logger: Logger) {
        logger.info(VIEW_OPENED, mapOf(SURFACE_KEY to SLUG))
    }
}
