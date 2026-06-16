// Pure, framework-free model + projections for the SleepEfficiencyPage surface — the native analogue of everything the
// web page derives before composing its panels (web/src/features/battery/pages/SleepEfficiencyPage.tsx). No Compose, no
// Android UI, no HTTP: every declaration here is plain Kotlin (it only references the framework-free shared-core
// Resource, the shared units + the framework-free ChartFormat), so the composable stays a thin render layer and all of
// this is exercised off-device by the :android:testDebugUnitTest gate.
//
// The web page owns these concerns this file ports: (1) the decode of the single raw SI JSON envelope the page reads —
// `/analytics/sleep` — into typed, null-safe models (web optional-chaining -> null-safe reads); (2) the display-boundary
// unit derivation from the `/settings` document ([SleepDisplayPrefs], web `useUnits`/`useFormatting`); (3) every
// derivation the panels call — the state-distribution donut slices (web `pieData`), the sentry-on/off comparison series
// (web `comparisonData`), and the recent drain-event rows (web `recentEvents` + the table columns).
//
// SI-canonical (Phase-48 / unit-conversion.instructions): event outside temperatures are SI Celsius rendered at the
// display boundary via [convertTempFromSI]; sentry energy is reported in kWh on the wire and rendered verbatim, exactly
// as the web page does. No °F is ever stored or computed — only produced at the display boundary.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/battery) diverges from the
// `io.teslasync.android.*` package the rest of the app uses, exactly as the sibling BatteryHealthPage does.
@file:Suppress("InvalidPackageDeclaration", "TooManyFunctions")

package io.teslasync.android.battery.sleepefficiency

import io.teslasync.android.components.charts.ChartFormat
import io.teslasync.android.data.UnitPreferences
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.units.TemperatureUnitPref
import io.teslasync.shared.core.units.convertTempFromSI
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.doubleOrNull
import java.util.Locale
import kotlin.math.round

/** The default rolling window the page reads (web `useRangeState` default preset `30d` → `days = 30`). */
const val SLEEP_DEFAULT_DAYS: Int = 30

/** Minutes in an hour — the SI bridge the per-state hours figure floors on (web `total_minutes / 60`). */
private const val MINUTES_PER_HOUR = 60.0

/** Default number/percentage fraction digits (web `_globalPrecision` fallback). */
private const val DEFAULT_PRECISION = 2

/** The currency symbol used before settings load / when the document carries none (web `formatCurrency` `'$'`). */
private const val DEFAULT_CURRENCY_SYMBOL = "$"

/** The currency-symbol field on the `/settings` document (web `useFormatting`). */
private const val KEY_CURRENCY_SYMBOL = "currency_symbol"

/**
 * Identity of the surface for the navigation registry + diagnostics (P1/S11) — the native mirror of the web
 * `SleepEfficiencyPage` route. [ROUTE_ID] matches the [io.teslasync.android.navigation.Destinations] entry
 * `page("sleepEfficiency", "/sleep-efficiency", …)`, so the host binds this surface to that destination (and its
 * `/sleep-efficiency` deep link) without the nav module depending on it.
 */
object SleepEfficiencyPageRegistration {
    /** The navigation destination id (Destinations.kt `page("sleepEfficiency", "/sleep-efficiency", …)`). */
    const val ROUTE_ID: String = "sleepEfficiency"

    /** The web route this surface mirrors (deep-link target). */
    const val WEB_PATH: String = "/sleep-efficiency"

    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). Carries no vehicle id. */
    const val SLUG: String = "SleepEfficiencyPage"
}

// ── Decoded envelopes ───────────────────────────────────────────────────────────────────────────────────────────

/**
 * One decoded `state_distribution` slice ready to draw (web `pieData`): the canonical [state] key, its friendly
 * [label] (web `STATE_LABELS`), the accrued [minutes] in that state (the donut sweeps proportionally to this, web
 * `value`), and a stable palette [colorIndex] so the slice + legend agree. Hours are formatted at the render boundary.
 */
data class SleepStateShare(
    val state: String,
    val label: String,
    val minutes: Double,
    val colorIndex: Int,
)

/**
 * The decoded sentry comparison (web `sentryOn`/`sentryOff` + `comparisonData`). Carries the average drain rate and
 * average battery lost for both sentry-on and sentry-off windows, so the two-group bar chart draws directly. [hasData]
 * mirrors the web `comparisonData.some(d => d.sentry_on > 0 || d.sentry_off > 0)` empty-guard.
 */
data class SleepSentryComparison(
    val drainOn: Double,
    val drainOff: Double,
    val lostOn: Double,
    val lostOff: Double,
) {
    /** Whether any of the four figures is positive — else the comparison chart shows its empty surface. */
    val hasData: Boolean get() = drainOn > 0.0 || drainOff > 0.0 || lostOn > 0.0 || lostOff > 0.0

    companion object {
        /** The all-zero comparison shown before data loads / when no sentry windows exist. */
        val EMPTY: SleepSentryComparison = SleepSentryComparison(0.0, 0.0, 0.0, 0.0)
    }
}

/**
 * One decoded `recent_events` row (web `SleepDrainEvent`) the recent-drain table renders. [startDate] is the raw ISO
 * timestamp (formatted at the render boundary), [durationHours] is hours, [batteryLost]/[drainRate] are percentages,
 * and [outsideTempC] is SI Celsius (or null), converted to the user's unit only at the display boundary.
 */
data class SleepDrainEventRow(
    val id: Long,
    val startDate: String,
    val durationHours: Double,
    val batteryLost: Double,
    val drainRate: Double,
    val sentryMode: Boolean,
    val outsideTempC: Double?,
)

/**
 * The decoded `/analytics/sleep` payload (web `SleepEfficiencyData`). [sleepEfficiencyPct] is a 0–100 percentage,
 * [timeToSleepAvgMin] whole minutes, drain rates are %/hr, energy is kWh on the wire, and costs are in the configured
 * currency. Missing / JSON-null fields collapse to zero / empty, exactly like the web optional reads.
 */
data class SleepEfficiency(
    val sleepEfficiencyPct: Double,
    val timeToSleepAvgMin: Double,
    val sentryOnDrainRate: Double,
    val sentryMonthlyCost: Double,
    val sentryExtraDrainRate: Double,
    val sentryExtraMonthlyKwh: Double,
    val sentryExtraMonthlyCost: Double,
    val stateShares: List<SleepStateShare>,
    val comparison: SleepSentryComparison,
    val recentEvents: List<SleepDrainEventRow>,
    val hasData: Boolean,
) {
    companion object {
        /** The empty payload — a no-selection / JSON-null read routes here so the page shows its `noData` surface. */
        val EMPTY: SleepEfficiency =
            SleepEfficiency(
                sleepEfficiencyPct = 0.0,
                timeToSleepAvgMin = 0.0,
                sentryOnDrainRate = 0.0,
                sentryMonthlyCost = 0.0,
                sentryExtraDrainRate = 0.0,
                sentryExtraMonthlyKwh = 0.0,
                sentryExtraMonthlyCost = 0.0,
                stateShares = emptyList(),
                comparison = SleepSentryComparison.EMPTY,
                recentEvents = emptyList(),
                hasData = false,
            )
    }
}

/**
 * The user's display preferences this surface needs — the native port of the web `useUnits` + `useFormatting` reads
 * from the `/settings` document: the [temperatureUnit] (event outside-temperature rendering), the [currencySymbol]
 * (blank → "$"), the currency/number [precision] (web `decimal_precision`/`_globalPrecision`, floored & non-negative,
 * else 2), and the [locale] used for grouped-number formatting.
 */
data class SleepDisplayPrefs(
    val temperatureUnit: TemperatureUnitPref,
    val currencySymbol: String,
    val precision: Int,
    val locale: Locale,
) {
    /** The temperature unit's display label (e.g. "°C" / "°F"), appended to a converted event temperature. */
    val temperatureLabel: String get() = temperatureUnit.label

    /** SI Celsius → the user's display temperature (web `convertTempFromSI(value, unitPrefs.temperature)`). */
    fun fromCelsius(celsius: Double): Double = convertTempFromSI(celsius, temperatureUnit)

    /** Grouped number in the user's locale (web `fmtNumber(value, decimals)`). */
    fun number(
        value: Double,
        decimals: Int,
    ): String = ChartFormat.number(value, decimals, locale)

    /** Grouped number at the user's default precision (web `fmtNumber(value)` with no decimals override). */
    fun number(value: Double): String = number(value, precision)

    /** Grouped integer in the user's locale (web `fmtInt(value)`). */
    fun integer(value: Double): String = ChartFormat.number(value, 0, locale)

    /** A default-precision number followed by `%` (web `${fmtNumber(value)}%`). */
    fun percent(value: Double): String = number(value) + PERCENT_UNIT

    /**
     * Currency as the web `formatCurrency` renders it — the user's [currencySymbol] (blank → "$") followed by a
     * [decimals]-digit grouped number in the user's locale. Defaults to the configured [precision].
     */
    fun currency(
        amount: Double,
        decimals: Int = precision,
    ): String = currencySymbol.ifBlank { DEFAULT_CURRENCY_SYMBOL } + number(amount, decimals.coerceAtLeast(0))

    companion object {
        /** Percent literal the web reads verbatim (never i18n). */
        const val PERCENT_UNIT: String = "%"

        /** Metric + `$` + 2dp + en-US defaults used before settings load (matches the web defaults). */
        val DEFAULT: SleepDisplayPrefs =
            SleepDisplayPrefs(
                temperatureUnit = TemperatureUnitPref.CELSIUS,
                currencySymbol = DEFAULT_CURRENCY_SYMBOL,
                precision = DEFAULT_PRECISION,
                locale = Locale.US,
            )

        /** Resolves the display preferences from the raw `/settings` document (web `useUnits`/`useFormatting`). */
        fun fromSettings(settings: JsonElement?): SleepDisplayPrefs {
            val unit = UnitPreferences.fromSettings(settings)
            val rawSymbol = (settings as? JsonObject)?.stringField(KEY_CURRENCY_SYMBOL)?.trim()
            return SleepDisplayPrefs(
                temperatureUnit = unit.temperature,
                currencySymbol = if (!rawSymbol.isNullOrEmpty()) rawSymbol else DEFAULT_CURRENCY_SYMBOL,
                precision = unit.precision?.takeIf { it >= 0 } ?: DEFAULT_PRECISION,
                locale = unit.locale?.takeIf { it.isNotBlank() }?.let(Locale::forLanguageTag) ?: Locale.US,
            )
        }
    }
}

/**
 * The friendly per-state display labels — the verbatim native mirror of the web non-i18n `STATE_LABELS` constant
 * (web/src/features/battery/pages/SleepEfficiencyPage.tsx). These are data-value display names (vehicle state enum
 * labels), not page chrome; an unknown state falls back to its raw key, exactly like the web `?? s.state`.
 */
private val STATE_LABELS: Map<String, String> =
    mapOf(
        "asleep" to "Sleeping",
        "online" to "Online/Idle",
        "driving" to "Driving",
        "charging" to "Charging",
        "updating" to "Updating",
        "suspended" to "Suspended",
    )

// ── Decode ──────────────────────────────────────────────────────────────────────────────────────────────────────

/**
 * Decodes the raw `/analytics/sleep` [json] (SI, snake_case on the wire) into a [SleepEfficiency]. A non-object input
 * or an empty object (the synthetic no-selection feed) routes to [SleepEfficiency.EMPTY] with `hasData = false`
 * (web `sleep ? … : <noData>`); a real object — even one with all-zero totals — decodes with `hasData = true` so the
 * body renders with per-section empty states, reproducing the web truthiness guard.
 */
fun parseSleepEfficiency(json: JsonElement?): SleepEfficiency {
    val obj = json as? JsonObject ?: return SleepEfficiency.EMPTY
    if (obj.isEmpty()) return SleepEfficiency.EMPTY
    return SleepEfficiency(
        sleepEfficiencyPct = obj.double("sleep_efficiency_pct"),
        timeToSleepAvgMin = obj.double("time_to_sleep_avg_min"),
        sentryOnDrainRate = obj.double("sentry_on_drain_rate"),
        sentryMonthlyCost = obj.double("sentry_monthly_cost"),
        sentryExtraDrainRate = obj.double("sentry_extra_drain_rate"),
        sentryExtraMonthlyKwh = obj.double("sentry_extra_monthly_kwh"),
        sentryExtraMonthlyCost = obj.double("sentry_extra_monthly_cost"),
        stateShares = parseStateShares(obj["state_distribution"]),
        comparison = parseComparison(obj["sentry_comparison"]),
        recentEvents = parseRecentEvents(obj["recent_events"]),
        hasData = true,
    )
}

/**
 * Projects the raw `state_distribution` array into the donut [SleepStateShare]s (web `pieData`): each slice keeps its
 * accrued minutes (rounded like the web `Math.round`), its friendly label, and a stable position-based palette index.
 */
private fun parseStateShares(element: JsonElement?): List<SleepStateShare> {
    val array = element as? JsonArray ?: return emptyList()
    return array.mapIndexedNotNull { index, raw ->
        val row = raw as? JsonObject ?: return@mapIndexedNotNull null
        val state = row.stringField("state") ?: return@mapIndexedNotNull null
        SleepStateShare(
            state = state,
            label = STATE_LABELS[state] ?: state,
            minutes = round(row.double("total_minutes")),
            colorIndex = index,
        )
    }
}

/**
 * Decodes the raw `sentry_comparison` array into a [SleepSentryComparison] (web `sentryOn`/`sentryOff`): the row whose
 * `sentry_mode` is true supplies the on-figures, the false row the off-figures; a missing row reads as zero.
 */
private fun parseComparison(element: JsonElement?): SleepSentryComparison {
    val array = element as? JsonArray ?: return SleepSentryComparison.EMPTY
    val rows = array.mapNotNull { it as? JsonObject }
    val on = rows.firstOrNull { it.bool("sentry_mode") }
    val off = rows.firstOrNull { !it.bool("sentry_mode") }
    return SleepSentryComparison(
        drainOn = on?.double("avg_drain_rate") ?: 0.0,
        drainOff = off?.double("avg_drain_rate") ?: 0.0,
        lostOn = on?.double("avg_battery_lost") ?: 0.0,
        lostOff = off?.double("avg_battery_lost") ?: 0.0,
    )
}

/** Decodes the raw `recent_events` array into [SleepDrainEventRow]s, null-safe per field (web `recent_events`). */
private fun parseRecentEvents(element: JsonElement?): List<SleepDrainEventRow> {
    val array = element as? JsonArray ?: return emptyList()
    return array.mapNotNull { raw ->
        val row = raw as? JsonObject ?: return@mapNotNull null
        val startDate = row.stringField("start_date") ?: return@mapNotNull null
        SleepDrainEventRow(
            id = row.long("id"),
            startDate = startDate,
            durationHours = row.double("duration_hours"),
            batteryLost = row.double("battery_lost"),
            drainRate = row.double("drain_rate"),
            sentryMode = row.bool("sentry_mode"),
            outsideTempC = row.doubleOrNull("outside_temp"),
        )
    }
}

/** Per-state accrued hours (web `fmtNumber(total_minutes / 60)`), formatted at the user's precision. */
fun SleepStateShare.hoursLabel(prefs: SleepDisplayPrefs): String = prefs.number(minutes / MINUTES_PER_HOUR)

/** A short calendar label for an ISO timestamp (web `formatDateShort`): `yyyy-MM-dd…` → `MM/dd`, else the raw input. */
fun eventDateLabel(iso: String): String {
    val parts = iso.take(10).split("-")
    return if (parts.size >= 3) "${parts[1]}/${parts[2]}" else iso
}

/** The `HH:mm` clock label for an ISO timestamp (web `formatTime`): the five chars after the `T`, else empty. */
fun eventTimeLabel(iso: String): String {
    val timePart = iso.substringAfter('T', "")
    return timePart.take(5)
}

private fun JsonObject.double(key: String): Double = (this[key] as? JsonPrimitive)?.doubleOrNull ?: 0.0

private fun JsonObject.doubleOrNull(key: String): Double? = (this[key] as? JsonPrimitive)?.doubleOrNull

private fun JsonObject.long(key: String): Long = (this[key] as? JsonPrimitive)?.contentOrNull?.toLongOrNull() ?: 0L

private fun JsonObject.bool(key: String): Boolean = (this[key] as? JsonPrimitive)?.booleanOrNull ?: false

private fun JsonObject.stringField(key: String): String? = (this[key] as? JsonPrimitive)?.contentOrNull

/**
 * Emits the one PII-safe `view.opened` diagnostic with the surface [SleepEfficiencyPageRegistration.SLUG] (P1/S11).
 * Kept free of Compose so it is unit-testable with a recording [io.teslasync.shared.core.diagnostics.Logger]; the page
 * calls it from its first composition. Carries no vehicle id, drain, cost or temperature payload.
 */
fun recordSleepEfficiencyOpened(logger: io.teslasync.shared.core.diagnostics.Logger) {
    logger.info("view.opened", mapOf("surface" to SleepEfficiencyPageRegistration.SLUG))
}

/**
 * Maps the value inside a cache-then-network [Resource], preserving its lifecycle case + freshness flags. The cached
 * value (present on `Loading`/`Error` for an instant cold start) and the fresh `Success` value are both transformed;
 * the `Throwable` and the `fetchedAt`/`stale` stamps pass through untouched. Pure, so the view-model's
 * `JsonElement → model` projection stays unit-testable off-device.
 */
fun <T, R> Resource<T>.mapData(transform: (T) -> R): Resource<R> =
    when (this) {
        is Resource.Loading -> Resource.Loading(cached?.let(transform), fetchedAt, stale)
        is Resource.Success -> Resource.Success(transform(data), fetchedAt, stale)
        is Resource.Error -> Resource.Error(cached?.let(transform), fetchedAt, stale, error)
    }
