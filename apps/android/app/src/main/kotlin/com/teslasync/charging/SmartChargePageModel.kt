// Pure, framework-free model + projections for the SmartChargePage charging surface — the native analogue of
// everything the web page derives before composing its panels (web/src/features/charging/pages/SmartChargePage.tsx,
// route /charging/schedule). No Compose, no Android UI, no HTTP: every declaration here is plain Kotlin so the
// composable stays a thin render layer and the whole derivation is asserted off-device by the unit-test gate.
//
// The web page owns several concerns this file ports: (1) the local form + result interaction state (the
// `targetSoc`/`departBy`/`ratePlanId`/`maxAmps`/`batteryCapacity` useState group plus the optimize `result` and the
// `applied` flag); (2) the two raw-JSON read feeds the cache layer serves verbatim (`useRatePlans`,
// `useChargePlans`) decoded into typed rows at the display boundary; (3) the optimize mutation response decoded into
// the typed schedule the cost cards / rate timeline / schedule panel render; and (4) the display-boundary
// formatters (the web `useFormatting.formatCurrency`, `numberFormat.fmtNumber`/`fmtPercent`, and
// `useDateFormat.formatTime`/`formatDateTime`) resolved from the `/settings` document.
//
// SI boundary (unit-conversion instructions): the page performs NO unit math here. Energy/power figures are not
// rendered on this surface; the only conversions are monetary (currency symbol + precision from settings) and the
// localized date/time of the schedule windows — both pure display formatting that never mutates the SI source.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/charging) diverges from
// the `io.teslasync.android.*` package the rest of the app uses, exactly as the sibling A7 charging pages do.
// `MatchingDeclarationName` is suppressed for the co-located supporting declarations.
@file:Suppress("InvalidPackageDeclaration", "MatchingDeclarationName")

package io.teslasync.android.charging.smartcharge

import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.net.defaultApiJson
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.doubleOrNull
import java.text.NumberFormat
import java.time.Instant
import java.time.LocalDateTime
import java.time.OffsetDateTime
import java.time.ZoneId
import java.time.ZonedDateTime
import java.time.format.DateTimeFormatter
import java.time.format.FormatStyle
import java.util.Locale
import kotlin.math.floor

/**
 * Identity of the surface for the navigation registry + diagnostics (P1/S11) — the native mirror of the web
 * `SmartChargePage` route. [ROUTE_ID] matches the [io.teslasync.android.navigation.Destinations] entry
 * `page("smartCharge", "/smart-charge", …)`, so [io.teslasync.android.navigation.PageHosts] binds this surface to
 * that destination (and its `/charging/schedule` web alias) without the nav module depending on it.
 */
object SmartChargePageRegistration {
    /** The navigation destination id (Destinations.kt `page("smartCharge", "/smart-charge", …)`). */
    const val ROUTE_ID: String = "smartCharge"

    /** The canonical web route this surface mirrors (deep-link target; the `/charging/schedule` alias resolves here). */
    const val WEB_PATH: String = "/smart-charge"

    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). Carries no vehicle/plan id. */
    const val SLUG: String = "SmartChargePage"

    /** The web `useState(80)` default target state-of-charge. */
    const val DEFAULT_TARGET_SOC: Int = 80

    /** The web `useState(32)` default charge amperage. */
    const val DEFAULT_MAX_AMPS: Int = 32

    /** The web `useState(75)` default battery capacity in kWh (request contract field `battery_capacity_kwh`). */
    const val DEFAULT_BATTERY_CAPACITY_KWH: Double = 75.0

    /** The web `useState('pge-ev2a')` default rate-plan id. */
    const val DEFAULT_RATE_PLAN_ID: String = "pge-ev2a"

    /** Slider minimum (web `min={20}`). */
    const val MIN_TARGET_SOC: Int = 20

    /** Slider maximum (web `max={100}`). */
    const val MAX_TARGET_SOC: Int = 100

    /** Slider step (web `step={5}`). */
    const val TARGET_SOC_STEP: Int = 5

    /** Default departure hour (web `d.setHours(7, 30, …)`). */
    const val DEFAULT_DEPART_HOUR: Int = 7

    /** Default departure minute (web `d.setHours(7, 30, …)`). */
    const val DEFAULT_DEPART_MINUTE: Int = 30
}

/** The local "datetime-local" pattern the web stores in its `departBy` useState (`yyyy-MM-ddTHH:mm`). */
private val DEPART_LOCAL_FORMAT: DateTimeFormatter = DateTimeFormatter.ofPattern("yyyy-MM-dd'T'HH:mm")

/** The shared SI-verbatim JSON the feeds + mutation responses decode through (the same instance the client uses). */
private val SMART_CHARGE_JSON = defaultApiJson

/** Em dash for an absent value (web `'—'`). */
const val SMART_CHARGE_EM_DASH: String = "\u2014"

// ── Wire response models (web src/types/charging.ts — snake_case, SI-verbatim) ─────────────────────────────────

/** A selectable TOU rate plan (web `RatePlanInfo`). */
@Serializable
data class RatePlanInfo(
    val id: String = "",
    val name: String = "",
    val utility: String = "",
)

/** A persisted charge plan history row (web `ChargePlan`). */
@Serializable
data class ChargePlan(
    val id: Long = 0L,
    @SerialName("vehicle_id") val vehicleId: Long = 0L,
    @SerialName("target_soc") val targetSoc: Double = 0.0,
    @SerialName("depart_by") val departBy: String? = null,
    @SerialName("scheduled_start") val scheduledStart: String? = null,
    @SerialName("scheduled_end") val scheduledEnd: String? = null,
    @SerialName("rate_plan") val ratePlan: String = "",
    @SerialName("estimated_kwh") val estimatedKwh: Double? = null,
    @SerialName("estimated_cost") val estimatedCost: Double? = null,
    @SerialName("charge_now_cost") val chargeNowCost: Double? = null,
    val savings: Double? = null,
    val status: String = "",
    @SerialName("created_at") val createdAt: String? = null,
)

/** One hour of the 24-hour TOU rate curve (web `HourlyRate`). */
@Serializable
data class HourlyRate(
    val hour: Int = 0,
    @SerialName("rate_cents") val rateCents: Double = 0.0,
    val tier: String = "",
)

/** A candidate charge window (web `ChargeWindow`). */
@Serializable
data class ChargeWindow(
    @SerialName("start_time") val startTime: String = "",
    @SerialName("end_time") val endTime: String = "",
    @SerialName("rate_cents_kwh") val rateCentsKwh: Double = 0.0,
    @SerialName("estimated_cost") val estimatedCost: Double = 0.0,
    @SerialName("rate_tier") val rateTier: String = "",
)

/** The charge-now vs optimized cost comparison (web `CostComparison`). */
@Serializable
data class CostComparison(
    @SerialName("charge_now_cost") val chargeNowCost: Double = 0.0,
    @SerialName("optimized_cost") val optimizedCost: Double = 0.0,
    val savings: Double = 0.0,
    @SerialName("savings_percent") val savingsPercent: Double = 0.0,
)

/** The decoded `POST /charge-planner/optimize` response (web `OptimizeChargeResponse`). */
@Serializable
data class OptimizeChargeResult(
    @SerialName("plan_id") val planId: Long = 0L,
    @SerialName("current_soc") val currentSoc: Double = 0.0,
    @SerialName("target_soc") val targetSoc: Double = 0.0,
    @SerialName("kwh_needed") val kwhNeeded: Double = 0.0,
    @SerialName("estimated_duration_hours") val estimatedDurationHours: Double = 0.0,
    val schedule: ChargeWindow = ChargeWindow(),
    val comparison: CostComparison = CostComparison(),
    @SerialName("alternative_windows") val alternativeWindows: List<ChargeWindow> = emptyList(),
    @SerialName("hourly_rates") val hourlyRates: List<HourlyRate> = emptyList(),
)

// ── Local interaction state (the web component's useState group + the optimize result) ─────────────────────────

/**
 * The page's local interaction snapshot — the union of the web component's form `useState` cells (`targetSoc`,
 * `departBy`, `ratePlanId`, `maxAmps`, `batteryCapacity`), the optimize [result] (web `result` useState, `null`
 * until an optimization succeeds), and the [applied] flag (web `applied` useState).
 *
 * @property targetSoc the desired state-of-charge percentage (web `targetSoc`).
 * @property departBy the local "yyyy-MM-ddTHH:mm" departure string (web `departBy`, a datetime-local value).
 * @property ratePlanId the selected TOU rate-plan id (web `ratePlanId`).
 * @property maxAmps the charge amperage cap (web `maxAmps`).
 * @property batteryCapacity the battery capacity in kWh (web `batteryCapacity`).
 * @property result the last successful optimization, or `null` when none has run (web `result`).
 * @property applied whether the last result has been applied to the vehicle (web `applied`).
 */
data class SmartChargeInteractionState(
    val targetSoc: Int = SmartChargePageRegistration.DEFAULT_TARGET_SOC,
    val departBy: String = "",
    val ratePlanId: String = SmartChargePageRegistration.DEFAULT_RATE_PLAN_ID,
    val maxAmps: Int = SmartChargePageRegistration.DEFAULT_MAX_AMPS,
    val batteryCapacity: Double = SmartChargePageRegistration.DEFAULT_BATTERY_CAPACITY_KWH,
    val result: OptimizeChargeResult? = null,
    val applied: Boolean = false,
)

/** The default departure: tomorrow at 07:30 local, formatted as the web datetime-local string (web `defaultDepartBy`). */
fun defaultDepartBy(
    now: Instant,
    zone: ZoneId,
): String {
    val target =
        now.atZone(zone)
            .plusDays(1)
            .withHour(SmartChargePageRegistration.DEFAULT_DEPART_HOUR)
            .withMinute(SmartChargePageRegistration.DEFAULT_DEPART_MINUTE)
            .withSecond(0)
            .withNano(0)
    return target.format(DEPART_LOCAL_FORMAT)
}

/**
 * Converts the local datetime-local [local] string to a UTC ISO-8601 instant for the request body — the native port
 * of the web `new Date(departBy).toISOString()`. A malformed value falls back to [now] (the web `new Date('')`
 * NaN guard collapses to the current instant once serialized), so the mutation always carries a valid timestamp.
 */
fun departByToIso(
    local: String,
    zone: ZoneId,
    now: Instant,
): String {
    val parsed =
        runCatching {
            LocalDateTime.parse(local, DEPART_LOCAL_FORMAT).atZone(zone).toInstant()
        }.getOrDefault(now)
    return DateTimeFormatter.ISO_INSTANT.format(parsed)
}

/**
 * The optimal-window hour span the rate timeline highlights — the native port of the web `chargeWindow` `useMemo`
 * (`{ startHour: start.getHours(), endHour: end.getHours() || 24 }`). `null` when no schedule is available, or when
 * either bound cannot be parsed (so a malformed window simply highlights nothing).
 */
fun chargeWindowHours(
    result: OptimizeChargeResult?,
    zone: ZoneId,
): IntRange? {
    val schedule = result?.schedule ?: return null
    val start = parseInstant(schedule.startTime)?.atZone(zone)?.hour
    val endRaw = parseInstant(schedule.endTime)?.atZone(zone)?.hour
    return if (start == null || endRaw == null) {
        null
    } else {
        start..(if (endRaw == 0) HOURS_PER_DAY else endRaw)
    }
}

/** Whether [hour] falls inside the highlighted charge [window], handling a cross-midnight span (web `isInWindow`). */
fun isHourInWindow(
    hour: Int,
    window: IntRange?,
): Boolean {
    if (window == null) return false
    val start = window.first
    val end = window.last
    return if (start <= end) hour in start until end else hour >= start || hour < end
}

/** The peak rate across the curve, or a unit floor so an all-zero curve still renders bars (web `maxRate`). */
fun maxRateCents(rates: List<HourlyRate>): Double = rates.maxOfOrNull { it.rateCents }?.takeIf { it > 0.0 } ?: 1.0

/** A compact hour-of-day label (web `formatHour`: `12a`, `6a`, `12p`, `6p`, `12a`). */
fun formatHourLabel(hour: Int): String =
    when {
        hour == 0 || hour == HOURS_PER_DAY -> "12a"
        hour == NOON_HOUR -> "12p"
        hour < NOON_HOUR -> "${hour}a"
        else -> "${hour - NOON_HOUR}p"
    }

// ── Wire decoding (the cache-then-network JsonElement feeds + the mutation response) ───────────────────────────

/** Decodes the `GET /charge-planner/rate-plans` JSON array into typed rows; a malformed payload yields an empty list. */
fun decodeRatePlans(element: JsonElement?): List<RatePlanInfo> = decodeList(element, RatePlanInfo.serializer())

/** Decodes the `GET /charge-planner/history` JSON array into typed rows; a malformed payload yields an empty list. */
fun decodeChargePlans(element: JsonElement?): List<ChargePlan> = decodeList(element, ChargePlan.serializer())

/** Decodes the `POST /charge-planner/optimize` JSON object into the typed result, or `null` on a malformed payload. */
fun decodeOptimizeResult(element: JsonElement?): OptimizeChargeResult? {
    if (element == null) return null
    return runCatching { SMART_CHARGE_JSON.decodeFromJsonElement(OptimizeChargeResult.serializer(), element) }.getOrNull()
}

private fun <T> decodeList(
    element: JsonElement?,
    elementSerializer: kotlinx.serialization.KSerializer<T>,
): List<T> {
    if (element == null) return emptyList()
    return runCatching {
        SMART_CHARGE_JSON.decodeFromJsonElement(ListSerializer(elementSerializer), element)
    }.getOrDefault(emptyList())
}

private fun parseInstant(iso: String?): Instant? {
    if (iso.isNullOrBlank()) return null
    return runCatching { Instant.parse(iso) }
        .recoverCatching { OffsetDateTime.parse(iso).toInstant() }
        .recoverCatching { ZonedDateTime.parse(iso).toInstant() }
        .getOrNull()
}

// ── Display preferences + formatters (web useFormatting / numberFormat / useDateFormat) ────────────────────────

/**
 * The monetary + locale display preferences this surface needs, resolved from the raw `/settings` document — the
 * native port of the web `useFormatting`/`useUnits` reads (`currency_symbol`, `decimal_precision`, `locale`).
 */
data class SmartChargePrefs(
    val currencySymbol: String,
    val precision: Int,
    val localeTag: String,
) {
    companion object {
        /** The web `$` fallback used before settings load. */
        const val DEFAULT_CURRENCY: String = "$"

        /** The web `fmtNumber` default precision. */
        const val DEFAULT_PRECISION: Int = 2

        /** Empty tag → the formatter resolves the device default locale. */
        const val DEFAULT_LOCALE_TAG: String = ""

        /** Pre-settings defaults (dollar / two decimals / device locale). */
        val DEFAULT: SmartChargePrefs = SmartChargePrefs(DEFAULT_CURRENCY, DEFAULT_PRECISION, DEFAULT_LOCALE_TAG)

        /** Resolves the display preferences from the raw `/settings` document (web `useFormatting`/`useUnits`). */
        fun from(settings: JsonElement?): SmartChargePrefs {
            val obj = settings as? JsonObject
            val symbol = (obj?.get("currency_symbol") as? JsonPrimitive)?.contentOrNull?.trim()
            val precision = (obj?.get("decimal_precision") as? JsonPrimitive)?.doubleOrNull
            val locale = (obj?.get("locale") as? JsonPrimitive)?.contentOrNull?.trim()
            return SmartChargePrefs(
                currencySymbol = if (!symbol.isNullOrEmpty()) symbol else DEFAULT_CURRENCY,
                precision =
                    if (precision != null && precision.isFinite() && precision >= 0) {
                        floor(precision).toInt()
                    } else {
                        DEFAULT_PRECISION
                    },
                localeTag = if (!locale.isNullOrEmpty()) locale else DEFAULT_LOCALE_TAG,
            )
        }
    }
}

/**
 * The display-boundary formatters the page renders SI/wire values through — the native ports of the web
 * `useFormatting.formatCurrency`, `numberFormat.fmtNumber`/`fmtPercent`, and `useDateFormat.formatTime`/
 * `formatDateTime`. It is framework-free (java.text + java.time) and bound to one resolved [prefs] + [zone], so the
 * whole projection is deterministic in tests; it performs no unit math and never mutates the SI source.
 */
class SmartChargeFormatters(
    private val prefs: SmartChargePrefs,
    private val zone: ZoneId = ZoneId.systemDefault(),
) {
    private val locale: Locale =
        prefs.localeTag.takeIf { it.isNotBlank() }?.let { Locale.forLanguageTag(it) } ?: Locale.getDefault()
    private val timeFormat: DateTimeFormatter =
        DateTimeFormatter.ofLocalizedTime(FormatStyle.SHORT).withLocale(locale).withZone(zone)
    private val dateTimeFormat: DateTimeFormatter =
        DateTimeFormatter.ofLocalizedDateTime(FormatStyle.MEDIUM, FormatStyle.SHORT).withLocale(locale).withZone(zone)

    /** Locale-aware fixed-decimal number — the web `fmtNumber(value, decimals)` (null / non-finite ⇒ 0). */
    fun number(
        value: Double?,
        decimals: Int = prefs.precision,
    ): String {
        val format = NumberFormat.getNumberInstance(locale)
        val digits = decimals.coerceAtLeast(0)
        format.minimumFractionDigits = digits
        format.maximumFractionDigits = digits
        format.isGroupingUsed = true
        return format.format(safeNumber(value))
    }

    /** Percent with a trailing sign — the web `fmtPercent(value, decimals)`. */
    fun percent(
        value: Double?,
        decimals: Int = prefs.precision,
    ): String = number(value, decimals) + "%"

    /** Currency with the user symbol + precision — the web `formatCurrency(amount, decimals?)`. */
    fun currency(
        amount: Double?,
        decimals: Int? = null,
    ): String = prefs.currencySymbol + number(amount, decimals ?: prefs.precision)

    /** Localized clock time of an ISO instant — the web `formatTime(iso)`; an unparseable value yields an em dash. */
    fun time(iso: String?): String = parseInstant(iso)?.let { timeFormat.format(it) } ?: SMART_CHARGE_EM_DASH

    /** Localized date + time of an ISO instant — the web `formatDateTime(iso)`; unparseable yields an em dash. */
    fun dateTime(iso: String?): String = parseInstant(iso)?.let { dateTimeFormat.format(it) } ?: SMART_CHARGE_EM_DASH
}

/** Coerces a nullable / non-finite figure to zero before formatting — the web `safeNumber` guard. */
fun safeNumber(value: Double?): Double = if (value != null && value.isFinite()) value else 0.0

// ── Diagnostics (P1/S11) ───────────────────────────────────────────────────────────────────────────────────────

/**
 * Emits the one PII-safe `view.opened` diagnostic with the surface [SmartChargePageRegistration.SLUG] (P1/S11).
 * Kept free of Compose so it is unit-testable with a recording [Logger]; the page calls it from its first
 * composition. Carries no vehicle id, plan id, cost, or schedule figure.
 */
fun recordSmartChargePageOpened(logger: Logger) {
    logger.info("view.opened", mapOf("surface" to SmartChargePageRegistration.SLUG))
}

/** Hours in a day — the web `getHours() || 24` wrap + the timeline's 24-bar span. */
private const val HOURS_PER_DAY: Int = 24

/** Noon hour — the web `formatHour` AM/PM pivot. */
private const val NOON_HOUR: Int = 12
