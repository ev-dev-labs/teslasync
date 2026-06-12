// Pure, framework-free model + projection for the ChargingSessionCard feature view — the native analogue of
// everything the web component derives before it returns JSX
// (web/src/features/charging/components/ChargingSessionCard.tsx and its `chargingAggregation.ts`,
// `charging-curve/helpers.ts`, `dateFormat.ts`, `numberFormat.ts`, and `useFormatting`). No Compose, no
// Android, no HTTP: every declaration here is exercised off-device by the :android:testReleaseUnitTest gate,
// so the composable stays a thin render layer over these pure functions.
//
// The web component is purely presentational — its parent (the Charging Sessions list) holds the
// `useChargingSessions` query and passes one decoded `session` down. From that prop it renders one history
// row: a leading battery-friendly `ScoreBadge`, an optional selection `Checkbox`, a primary line (timestamp ·
// duration + charger / energy / free / anomaly `Badge`s), a single-endpoint `RouteDisplay`, and — in the
// comfortable density — a metrics line (`BatteryDelta`, peak/avg power, duration, cost, cost-per-kWh, and
// range added). This file owns every piece the web expresses inline: the `getChargerCategory` classifier, the
// `durationMinutes`/`avgPowerW`/`costPerKwh`/`distanceAddedM` derivations, the per-session battery-friendly
// score, the `fmtNumber`/`fmtWithUnit`/`fmtInt`/`formatCurrency`/`formatDurationMinutes` value formatting, the
// `useFormatting` currency + precision contract, the `useUnits` distance-unit read, the ordered render model
// with all of its conditional chips, and the lifecycle projection onto the shared cache-then-network
// [UiState] (so the surface renders every state the P1/S8 layer can carry). `fmtNumber` mirrors the web
// `Intl.NumberFormat` half-away-from-zero rounding rather than Java's default banker's rounding.
//
// The data is SI on the wire (Phase-48): `total_energy_added_wh` is watt-hours, `peak_power_w`/`avg_power_w`
// are watts, and `start/end_odometer_m` are metres. Energy/power are shown in kWh/kW exactly as the web does,
// and the metres of range added are converted to the user's display distance unit at this boundary via the
// shared `convertDistanceFromSI` — never stored converted.
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/feature-views/ChargingSessionCard — the P3 prompt's allowed-files path) cannot form a valid
// Kotlin package (a hyphen and a PascalCase segment are illegal in a package identifier), so the package
// intentionally diverges from the path — exactly as the sibling feature-view surfaces do.
// `MatchingDeclarationName` is suppressed for the co-located supporting declarations.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.chargingsessioncard

import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import io.teslasync.shared.core.api.generated.ChargingSession
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.units.DistanceUnitPref
import io.teslasync.shared.core.units.convertDistanceFromSI
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

/** Default currency symbol when the settings document has none — the web `useFormatting` `'$'`. */
internal const val DEFAULT_CURRENCY: String = "$"

/** Default decimal precision before settings load — the web `useFormatting`/`fmtNumber` `2` default. */
internal const val DEFAULT_PRECISION: Int = 2

/**
 * The coarse charger category a session is binned into — a verbatim union of the web `getChargerCategory`
 * result (web `lib/chargingAggregation.ts`). Each maps to a localized label and a badge tone at the render
 * boundary via [ChargingSessionCardProjection.chargerLabel] / [ChargingSessionCardProjection.chargerTone].
 */
enum class ChargerCategory { Home, Supercharger, Dc, Unknown }

/**
 * The badge tone the charger chip renders in — the native union of the web
 * `cat === 'supercharger' ? 'danger' : cat === 'dc' ? 'warning' : 'success'` ternary. Kept framework-free
 * (the composable maps it onto the shared `Badge`'s `BadgeVariant`).
 */
enum class ChargerBadgeTone { Success, Warning, Danger }

/**
 * One page-level anomaly callout for a session — the native analogue of the web `ChargingAnomaly` prop. The
 * web card renders only the already-built, user-facing [message] (e.g. "Expensive charge ($0.62/kWh)"); the
 * detection + message composition lives in the page's aggregation layer, so this surface accepts the finished
 * string and never re-derives it.
 */
data class ChargingSessionAnomaly(
    val message: String,
)

/**
 * Display density — the native union of the web `density` prop. [Comfortable] shows the secondary metrics
 * line; [Compact] hides it (web `density === 'compact' ? null : metrics`).
 */
enum class CardDensity { Comfortable, Compact }

/**
 * The already-localized labels the row embeds, resolved through the P1/S10 i18n facade at the Compose
 * boundary and passed down so the projection (and its off-device tests) stay free of any Android dependency
 * and any English literal.
 *
 * @property chargerSupercharger web `chargerTypes.supercharger` ("Supercharger").
 * @property chargerDcFast web `chargerTypes.dc` ("DC Fast").
 * @property chargerHomeAc web `chargerTypes.home` ("Home / AC").
 * @property chargerUnknown web `chargerTypes.unknown` ("Charger"). The shared P1/S10 catalog has no
 *   `chargerTypes.unknown` key; `common.charger` is the catalog's canonical key for the identical "Charger"
 *   label, so it is used here (same rendered label, real catalog key).
 * @property free web `free` ("Free") — the free-session badge text, via the catalog's `common.free`.
 * @property peakPower the peak-power chip qualifier (web hardcodes "peak"); resolved from the catalog's
 *   `charging.curve.peakPower` ("Peak Power") so the qualifier is localized rather than an English literal.
 * @property avgPower the average-power chip qualifier (web hardcodes "avg"); resolved from the catalog's
 *   `charging.curve.avgPower` ("Avg Power").
 */
data class ChargingSessionCardStrings(
    val chargerSupercharger: String,
    val chargerDcFast: String,
    val chargerHomeAc: String,
    val chargerUnknown: String,
    val free: String,
    val peakPower: String,
    val avgPower: String,
)

/**
 * The user's number/currency/distance display preference this surface needs — the native port of the web
 * `useFormatting` read of the `/settings` document plus the `useUnits` distance-unit derivation.
 * [currencySymbol] formats the cost / cost-per-kWh chips (web `formatCurrency`); [decimalPrecision] is the
 * fraction-digit count applied to energy, peak/avg power, and cost (web global precision from
 * `settings.decimal_precision`); [distanceUnit] is the target of the range-added conversion (web
 * `settings.unit_of_length` → `toDistanceDisplay` / `distanceUnit`).
 */
data class ChargingSessionCardFormat(
    val currencySymbol: String,
    val decimalPrecision: Int,
    val distanceUnit: DistanceUnitPref,
) {
    companion object {
        /** The `$` / precision-2 / km default used before settings load (matches the web metric defaults). */
        val DEFAULT: ChargingSessionCardFormat =
            ChargingSessionCardFormat(DEFAULT_CURRENCY, DEFAULT_PRECISION, DistanceUnitPref.KM)

        private const val KEY_CURRENCY_SYMBOL = "currency_symbol"
        private const val KEY_DECIMAL_PRECISION = "decimal_precision"
        private const val KEY_UNIT_OF_LENGTH = "unit_of_length"
        private const val UNIT_MILES = "mi"
        private const val MAX_PRECISION = 20

        /**
         * Resolves the currency symbol, decimal precision, and distance unit from the raw `/settings` document
         * (web `useFormatting` + `useUnits`). A blank/missing symbol falls back to `$`; a missing, non-finite,
         * or negative precision falls back to `2`, and any fractional value is floored and clamped to `0..20`
         * so the downstream `DecimalFormat` pattern is always valid; `unit_of_length == "mi"` selects miles,
         * everything else metric (km) — the same precedence as the web `useUnits` hook.
         */
        fun fromSettings(settings: JsonElement?): ChargingSessionCardFormat {
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
            val length = (obj[KEY_UNIT_OF_LENGTH] as? JsonPrimitive)?.contentOrNull
            val distance = if (length == UNIT_MILES) DistanceUnitPref.MI else DistanceUnitPref.KM
            return ChargingSessionCardFormat(symbol, precision, distance)
        }
    }
}

/**
 * The render-ready projection of a [ChargingSession] — the native analogue of every value the web component
 * computes before composing its row. Every field is a pre-formatted String / framework-free primitive (no
 * Compose types), so the whole projection is unit-tested without a UI host; the composable maps each field
 * onto a shared component. A `null` chip means the web omits that element for this session.
 *
 * @property timestamp the formatted `started_at` (web `<TimeStamp>` body).
 * @property durationLabel `formatDurationMinutes(durationMin)` — shown in the primary line and, when
 *   [showDuration], as the duration metric chip.
 * @property showDuration whether the duration metric chip renders (web `durationMin > 0`).
 * @property chargerLabel the localized charger label (web `chargerLabels[cat]`).
 * @property chargerTone the charger badge tone (web danger/warning/success ternary).
 * @property energyChip the energy badge text, or `null` when `energyKwh <= 0` (web `energyKwh > 0`).
 * @property showFree whether the "Free" badge renders (web `isFree && energyKwh > 0`).
 * @property peakChip the peak-power chip, or `null` when `peak_power_w` is absent.
 * @property avgChip the average-power chip (with the web `~` prefix), or `null` when avg power is 0.
 * @property costChip the cost chip, or `null` (web `typeof cost_decimal === 'number' && cost_decimal > 0`).
 * @property cpkChip the parenthesized cost-per-kWh chip, or `null` (web `cpk != null`).
 * @property distanceChip the range-added chip (with the web `+` prefix + display unit), or `null`.
 * @property startSocPct the start SoC handed to the shared `BatteryDelta` (web `<BatteryDelta startPct>`).
 * @property endSocPct the end SoC handed to the shared `BatteryDelta` (web `<BatteryDelta endPct>`).
 * @property score the per-session battery-friendly score 0..100, or `null` (web leading `ScoreBadge`).
 * @property routeAddress the single charger endpoint address (web `<RouteDisplay start.address>`).
 * @property routeLat the charger endpoint latitude fallback (web `start.lat`).
 * @property routeLng the charger endpoint longitude fallback (web `start.lon`).
 */
data class ChargingSessionCardModel(
    val timestamp: String,
    val durationLabel: String,
    val showDuration: Boolean,
    val chargerLabel: String,
    val chargerTone: ChargerBadgeTone,
    val energyChip: String?,
    val showFree: Boolean,
    val peakChip: String?,
    val avgChip: String?,
    val costChip: String?,
    val cpkChip: String?,
    val distanceChip: String?,
    val startSocPct: Double?,
    val endSocPct: Double?,
    val score: Int?,
    val routeAddress: String?,
    val routeLat: Double?,
    val routeLng: Double?,
)

/**
 * Pure projection from a [ChargingSession] to its render-ready [ChargingSessionCardModel] — a 1:1 port of the
 * web component's inline derivations, its `chargingAggregation.ts` helpers (`getChargerCategory`,
 * `durationMinutes`, `avgPowerW`, `costPerKwh`), its `charging-curve/helpers.ts` (`distanceAddedM`), and its
 * value formatting. Stateless and side-effect-free so it is fully covered by the off-device unit gate; the
 * composable only resolves localized strings and draws what these return.
 */
object ChargingSessionCardProjection {
    /** Watt-hours per kilowatt-hour — the web `total_energy_added_wh / 1000`. */
    const val WH_PER_KWH: Double = 1000.0

    /** Watts per kilowatt — the web `power_w / 1000`. */
    const val W_PER_KW: Double = 1000.0

    /** Energy unit suffix — the web literal `'kWh'`. */
    const val UNIT_KWH: String = "kWh"

    /** Power unit suffix — the web literal `'kW'`. */
    const val UNIT_KW: String = "kW"

    private const val MILLIS_PER_MINUTE = 60_000.0
    private const val MINUTES_PER_HOUR = 60.0
    private const val MAX_FRACTION_DIGITS = 20
    private const val APPROX = "~"
    private const val PLUS = "+"
    private const val PER_KWH = "/kWh"
    private const val FALLBACK = "\u2014"

    // Battery-friendly score band thresholds (web card inline heuristic).
    private const val SCORE_BASE = 50
    private const val START_LOW = 30.0
    private const val START_MID = 50.0
    private const val START_HIGH = 70.0
    private const val START_LOW_BONUS = 30
    private const val START_MID_BONUS = 15
    private const val START_HIGH_PENALTY = 10
    private const val END_SWEET = 80.0
    private const val END_OK = 90.0
    private const val END_FULL = 100.0
    private const val END_SWEET_BONUS = 20
    private const val END_HIGH_PENALTY = 10
    private const val END_FULL_PENALTY = 25
    private const val SCORE_MIN = 0
    private const val SCORE_MAX = 100

    /**
     * Maps the card's `(session, isLoading)` props onto the shared cache-then-network [UiState] (P1/S8). The
     * web component itself has no loading/error surface (its parent owns those); this adapter adds the
     * lifecycle states the host's feed can carry while preserving web precedence: loading → [UiPhase.Loading];
     * a present session → [UiPhase.Content] (the row renders); a null session → [UiPhase.Empty] (the surface
     * still renders, with a friendly "no data" body — never a blank box).
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
     * Classify a session's charger — a verbatim port of the web `getChargerCategory` precedence: a
     * null/empty `charger_type` historically means home AC; `super`/`tpc` is a Supercharger; `dc`/`ccs`/
     * `chademo`/`fast` is DC fast; `home`/`ac`/`wall` is home; everything else is unknown.
     */
    fun chargerCategory(session: ChargingSession): ChargerCategory {
        val type = session.chargerType
        if (type.isNullOrEmpty()) return ChargerCategory.Home
        val t = type.lowercase(Locale.US)
        return when {
            t.contains("super") || t.contains("tpc") -> ChargerCategory.Supercharger
            t.contains("dc") || t.contains("ccs") || t.contains("chademo") || t.contains("fast") -> ChargerCategory.Dc
            t.contains("home") || t.contains("ac") || t.contains("wall") -> ChargerCategory.Home
            else -> ChargerCategory.Unknown
        }
    }

    /** The localized charger label for a [ChargerCategory] (web `chargerLabels[cat]`). */
    fun chargerLabel(
        category: ChargerCategory,
        strings: ChargingSessionCardStrings,
    ): String =
        when (category) {
            ChargerCategory.Supercharger -> strings.chargerSupercharger
            ChargerCategory.Dc -> strings.chargerDcFast
            ChargerCategory.Home -> strings.chargerHomeAc
            ChargerCategory.Unknown -> strings.chargerUnknown
        }

    /** The badge tone for a [ChargerCategory] — web `supercharger?danger : dc?warning : success`. */
    fun chargerTone(category: ChargerCategory): ChargerBadgeTone =
        when (category) {
            ChargerCategory.Supercharger -> ChargerBadgeTone.Danger
            ChargerCategory.Dc -> ChargerBadgeTone.Warning
            ChargerCategory.Home, ChargerCategory.Unknown -> ChargerBadgeTone.Success
        }

    /**
     * Session duration in minutes — a port of the web `durationMinutes` from `chargingAggregation.ts`
     * (NOT the rounded `helpers.ts` variant): no end yet (or an end at/ before the start) reads as `0`;
     * otherwise the raw `(end − start) / 60000` in fractional minutes (the formatter rounds for display).
     */
    fun durationMinutes(session: ChargingSession): Double {
        val end = session.endedAt ?: return 0.0
        val deltaMillis = end.toEpochMilliseconds() - session.startedAt.toEpochMilliseconds()
        return if (deltaMillis <= 0L) 0.0 else deltaMillis / MILLIS_PER_MINUTE
    }

    /**
     * Average power in watts — a port of the web `avgPowerW`: total energy added (Wh) over elapsed hours when
     * both the duration and energy are usable, else the API-provided `avg_power_w`, else `0`.
     */
    fun avgPowerW(session: ChargingSession): Double {
        val minutes = durationMinutes(session)
        val energy = session.totalEnergyAddedWh ?: 0.0
        return if (minutes > 0.0 && energy > 0.0) {
            energy / (minutes / MINUTES_PER_HOUR)
        } else {
            session.avgPowerW ?: 0.0
        }
    }

    /**
     * Cost per kWh for a single session — a port of the web `costPerKwh`: `null` when there is no energy
     * added, or the cost is missing / non-positive (free / unknown); otherwise `cost / (Wh / 1000)`.
     */
    fun costPerKwh(session: ChargingSession): Double? {
        val energy = session.totalEnergyAddedWh ?: 0.0
        val cost = session.costDecimal
        return if (energy > 0.0 && cost != null && cost > 0.0) cost / (energy / WH_PER_KWH) else null
    }

    /**
     * Metres of range added — a port of the web `distanceAddedM`: `null` unless both odometer readings are
     * present and the delta is positive.
     */
    fun distanceAddedM(session: ChargingSession): Double? {
        val start = session.startOdometerM // parity:allow odometer field identifier, substring false positive
        val end = session.endOdometerM
        return if (start != null && end != null) (end - start).takeIf { it > 0.0 } else null
    }

    /**
     * Per-session battery-friendly score 0..100 — a verbatim port of the web card's inline `useMemo`: reward
     * starting low and stopping in the 30→80 % sweet spot, penalize starting high or charging to 100 %.
     * `null` when either SoC bound is missing.
     */
    fun sessionScore(session: ChargingSession): Int? {
        val start = session.startSocPct
        val end = session.endSocPct
        if (start == null || end == null) return null
        var s = SCORE_BASE
        s +=
            when {
                start <= START_LOW -> START_LOW_BONUS
                start <= START_MID -> START_MID_BONUS
                start <= START_HIGH -> 0
                else -> -START_HIGH_PENALTY
            }
        s +=
            when {
                end <= END_SWEET -> END_SWEET_BONUS
                end <= END_OK -> 0
                end < END_FULL -> -END_HIGH_PENALTY
                else -> -END_FULL_PENALTY
            }
        return s.coerceIn(SCORE_MIN, SCORE_MAX)
    }

    /**
     * Locale-aware "medium date, short time" formatting of an epoch-millisecond instant — the native analogue
     * of the web `<TimeStamp>` absolute body, rendered in [zone] for [locale]. Takes a `Long` (not the generated
     * model's `kotlin.time.Instant`) so the body can use `java.time` exclusively; the caller converts via
     * `toEpochMilliseconds()`. Pure (java.time only) so it is unit-tested deterministically.
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
     * non-finite value is coerced to 0 (web `safeNumber`). [decimals] is clamped to `0..20`.
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

    /** Integer formatting — the web `fmtInt(value)` (`fmtNumber(value, 0)`). */
    fun fmtInt(
        value: Double,
        locale: Locale,
    ): String = fmtNumber(value, 0, locale)

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
     * Human-readable duration — a port of the web `formatDurationMinutes`: `—` for a negative/non-finite
     * input, else `${h}h ${m}m` when there is at least an hour, else `${m}m`. The hour part floors and the
     * minute part rounds half away from zero (web `Math.floor` + `formatRoundedInt`), so 45.5 → "46m" and
     * 90.2 → "1h 30m".
     */
    fun formatDurationMinutes(
        minutes: Double,
        locale: Locale,
    ): String {
        if (!minutes.isFinite() || minutes < 0.0) return FALLBACK
        val hours = floor(minutes / MINUTES_PER_HOUR).toLong()
        val remainder = minutes - hours * MINUTES_PER_HOUR
        val minuteLabel = fmtNumber(remainder, 0, locale)
        return if (hours > 0L) "${hours}h ${minuteLabel}m" else "${minuteLabel}m"
    }

    /**
     * Display range-added in the user's distance unit — the web `toDistanceDisplay(addedM / 1000)`. The web
     * `toDistanceDisplay` takes kilometres and converts to the display unit; the shared `convertDistanceFromSI`
     * takes metres, so the metres value is passed straight through (km → display and m → display differ only
     * by the same 1000 factor the web applies first). `null` is preserved.
     */
    fun displayDistance(
        addedM: Double?,
        unit: DistanceUnitPref,
    ): Double? = addedM?.let { convertDistanceFromSI(it, unit) }

    /**
     * The full render model for [session] — a 1:1 port of the web component's JSX, including every conditional
     * chip: the energy badge only when `energyKwh > 0`, the "Free" badge only when free with energy, the peak
     * chip only when `peak_power_w` is present, the avg chip only when avg power is non-zero, the cost chip
     * only when `cost_decimal` is a positive number, the cost-per-kWh chip only when computable, and the
     * range-added chip only when both odometers are present and the converted distance is positive. [format]
     * supplies the currency symbol + precision + distance unit, [locale] the grouping/decimal separators, and
     * [zone] the timestamp's wall-clock zone.
     */
    fun model(
        session: ChargingSession,
        format: ChargingSessionCardFormat,
        locale: Locale,
        zone: ZoneId,
        strings: ChargingSessionCardStrings,
    ): ChargingSessionCardModel {
        val precision = format.decimalPrecision
        val category = chargerCategory(session)
        val durationMin = durationMinutes(session)
        val energyKwh = (session.totalEnergyAddedWh ?: 0.0) / WH_PER_KWH
        val isFree = session.costDecimal == null || session.costDecimal == 0.0

        val avgW = avgPowerW(session)
        val avgChip =
            if (avgW > 0.0) {
                APPROX + fmtWithUnit(avgW / W_PER_KW, UNIT_KW, precision, locale) + " " + strings.avgPower
            } else {
                null
            }

        val peakChip =
            session.peakPowerW?.let { peak ->
                fmtWithUnit(peak / W_PER_KW, UNIT_KW, precision, locale) + " " + strings.peakPower
            }

        val cost = session.costDecimal
        val costChip =
            if (cost != null && cost > 0.0) {
                formatCurrency(cost, format.currencySymbol, precision, locale)
            } else {
                null
            }

        val cpk = costPerKwh(session)
        val cpkChip =
            cpk?.let { "(" + formatCurrency(it, format.currencySymbol, DEFAULT_PRECISION, locale) + PER_KWH + ")" }

        val displayDist = displayDistance(distanceAddedM(session), format.distanceUnit)
        val distanceChip =
            if (displayDist != null && displayDist > 0.0) {
                PLUS + fmtInt(displayDist, locale) + " " + format.distanceUnit.label
            } else {
                null
            }

        return ChargingSessionCardModel(
            timestamp = formatDateTime(session.startedAt.toEpochMilliseconds(), zone, locale),
            durationLabel = formatDurationMinutes(durationMin, locale),
            showDuration = durationMin > 0.0,
            chargerLabel = chargerLabel(category, strings),
            chargerTone = chargerTone(category),
            energyChip = if (energyKwh > 0.0) fmtWithUnit(energyKwh, UNIT_KWH, precision, locale) else null,
            showFree = isFree && energyKwh > 0.0,
            peakChip = peakChip,
            avgChip = avgChip,
            costChip = costChip,
            cpkChip = cpkChip,
            distanceChip = distanceChip,
            startSocPct = session.startSocPct,
            endSocPct = session.endSocPct,
            score = sessionScore(session),
            routeAddress = session.startPlace,
            routeLat = session.startLat,
            routeLng = session.startLng,
        )
    }

    /** Web `safeNumber(v)`: the value when it is a finite number, otherwise 0 — so a chip never reads `NaN`. */
    private fun safe(value: Double?): Double = if (value != null && value.isFinite()) value else 0.0
}

/**
 * The one PII-safe diagnostic this surface emits (P1/S11). Carries only the surface [SLUG] — never any
 * session field — so a diagnostics line can never leak a user's charging posture or location.
 */
object ChargingSessionCardDiagnostics {
    /** Diagnostics surface slug emitted with the `view.opened` event. */
    const val SLUG: String = "ChargingSessionCard"

    private const val VIEW_OPENED = "view.opened"
    private const val SURFACE_KEY = "surface"

    /** Emits the `view.opened` diagnostic for this surface. Call from the composable's first-composition effect. */
    fun recordViewOpened(logger: Logger) {
        logger.info(VIEW_OPENED, mapOf(SURFACE_KEY to SLUG))
    }
}
