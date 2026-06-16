// Pure, framework-free model + projection for the TeslaChargingSessionsPage charging surface — the native analogue of
// everything the web page derives before composing its panels
// (web/src/features/charging/pages/TeslaChargingSessionsPage.tsx). No Compose, no Android UI, no HTTP: every
// declaration here is plain Kotlin (it references only the shared-core Resource/ApiError envelopes, the shared Vehicle
// DTO, the Android UnitFormatter display boundary, and kotlinx-serialization JSON), so the composable stays a thin
// render layer and the whole derivation can be asserted off-device.
//
// The web page binds three reads — `useTeslaChargingSessions` (`GET /tesla/charging/sessions`),
// `useRefreshTeslaChargingSessions` (`POST /tesla/charging/sessions/refresh`) and `useVehicles` (`GET /vehicles`) —
// scoped by a local VIN selector and a client-side date range, and renders ten panels: an info banner, a controls bar,
// five summary StatCards (Total Sessions / Total Energy / Total Cost / Avg Cost/kWh / Peak Power), a monthly-cost bar
// chart, a session-location map, and a session DataTable. This file owns the JSON decode (the `{ sessions, summary }`
// response), the monthly-cost aggregation, the client-side range filter, the column sort, the CSV export body, and the
// `useFormatting` / `useUnits` display contract (currency symbol + currency-code formatting, SI energy ⇒ kWh, the
// localized date/time, and the "Xh Ym" duration). `fmtNumber` mirrors the web `Intl.NumberFormat` half-away-from-zero
// rounding rather than Java's default banker's rounding.
//
// Energy stays SI watt-hours on the wire and is converted to a display unit only here (web `convertEnergyFromSI` /
// `useUnits`); coordinates stay WGS-84 degrees and are never converted. Every optional field is nullable so a partial
// payload never throws (the web optional-chaining / `safeArray` reads).
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/charging) diverges from the
// `io.teslasync.android.*` package the rest of the app uses, exactly as the sibling A7 charging pages do.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.charging.teslachargingsessions

import io.teslasync.android.data.UnitFormatter
import io.teslasync.android.data.UnitPreferences
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.doubleOrNull
import kotlinx.serialization.json.longOrNull
import java.math.RoundingMode
import java.text.DecimalFormat
import java.text.DecimalFormatSymbols
import java.text.NumberFormat
import java.time.Instant
import java.time.LocalDateTime
import java.time.OffsetDateTime
import java.time.ZoneId
import java.time.ZoneOffset
import java.time.format.DateTimeFormatter
import java.time.format.FormatStyle
import java.util.Currency
import java.util.Locale

/** The em dash the web renders for any null/absent value (`'—'`). */
internal const val EM_DASH: String = "\u2014"

/** Default currency symbol when the settings document has none (web `useFormatting` `'$'`). */
internal const val DEFAULT_CURRENCY: String = "$"

/** Default BCP-47 language tag when the settings document has none (web `useUnits` `'en-US'`). */
private const val DEFAULT_LOCALE_TAG: String = "en-US"

/** Watt-hours per kilowatt-hour — the web `convertEnergyFromSI(wh, 'kWh')` divisor. */
private const val WH_PER_KWH: Double = 1000.0

/** Seconds per hour — the web `Math.floor(seconds / 3600)` divisor. */
private const val SECONDS_PER_HOUR: Long = 3600L

/** Seconds per minute — the web `Math.floor((seconds % 3600) / 60)` divisor. */
private const val SECONDS_PER_MINUTE: Long = 60L

/** Energy fraction digits — the web `fmtNumber(convertEnergyFromSI(wh, 'kWh'), 1)` precision. */
internal const val ENERGY_DECIMALS: Int = 1

/** Cost fraction digits — the web `formatCurrencyValue(total_cost, …, 2)` precision. */
internal const val COST_DECIMALS: Int = 2

/** Per-kWh rate fraction digits — the web `formatCurrencyValue(per_kwh_rate, …, 3)` precision. */
internal const val RATE_DECIMALS: Int = 3

/** Peak-power fraction digits — the web `fmtNumber(peak_power_kw, 0)` precision. */
internal const val POWER_DECIMALS: Int = 0

/** The default page size of the session table (web `pagination={{ defaultPageSize: 25 }}`). */
internal const val SESSIONS_PAGE_SIZE: Int = 25

/** The HTTP status the web treats as "business account required" on a failed sync (web `error.status === 403`). */
internal const val HTTP_FORBIDDEN: Int = 403

private const val KEY_SESSIONS = "sessions"
private const val KEY_SUMMARY = "summary"
private const val KEY_SESSION_ID = "session_id"
private const val KEY_VIN = "vin"
private const val KEY_SITE_LOCATION_NAME = "site_location_name"
private const val KEY_CHARGE_START_DATETIME = "charge_start_datetime"
private const val KEY_TOTAL_ENERGY_ADDED_WH = "total_energy_added_wh"
private const val KEY_PEAK_POWER_KW = "peak_power_kw"
private const val KEY_CHARGE_DURATION_S = "charge_duration_s"
private const val KEY_TOTAL_COST = "total_cost"
private const val KEY_CURRENCY_CODE = "currency_code"
private const val KEY_PER_KWH_RATE = "per_kwh_rate"
private const val KEY_CHARGER_TYPE = "charger_type"
private const val KEY_FETCHED_AT = "fetched_at"
private const val KEY_LATITUDE = "latitude"
private const val KEY_LONGITUDE = "longitude"
private const val KEY_TOTAL_SESSIONS = "total_sessions"
private const val KEY_TOTAL_WH = "total_wh"
private const val KEY_AVG_COST_PER_KWH = "avg_cost_per_kwh"
private const val KEY_CURRENCY_SYMBOL = "currency_symbol"

/**
 * Identity of the surface for the navigation registry + diagnostics (P1/S11) — the native mirror of the web
 * `TeslaChargingSessionsPage` route. [ROUTE_ID] matches the [io.teslasync.android.navigation.Destinations] entry
 * `page("teslaChargingSessions", "/tesla-charging-sessions", …)`, so [io.teslasync.android.navigation.PageHosts] binds
 * this surface to that destination (and its `/tesla-charging-sessions` deep link) without the nav module depending on it.
 */
object TeslaChargingSessionsPageRegistration {
    /** The navigation destination id (Destinations.kt `page("teslaChargingSessions", "/tesla-charging-sessions", …)`). */
    const val ROUTE_ID: String = "teslaChargingSessions"

    /** The web route this surface mirrors (deep-link target). */
    const val WEB_PATH: String = "/tesla-charging-sessions"

    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). Carries no vehicle id. */
    const val SLUG: String = "TeslaChargingSessionsPage"
}

/**
 * The stable sort keys the session table offers — the web `sortKey` switch (`'date'`, `'energy'`, `'peakPower'`,
 * `'cost'`). Each maps to a column header and a comparator in [sortSessions].
 */
object TeslaChargingSessionsSort {
    const val DATE: String = "date"
    const val ENERGY: String = "energy"
    const val PEAK_POWER: String = "peakPower"
    const val COST: String = "cost"
}

/**
 * One Tesla fleet charging session, narrowed to the fields the page renders — the native mirror of the web
 * `TeslaChargingSession` rows (web `api/hooks/useCharging.ts`). Energy is SI watt-hours and is converted to kWh only
 * for display; peak power is the raw kW figure the backend serves; coordinates are WGS-84 degrees. Every optional
 * field is nullable so a partial payload never throws (the web optional-chaining reads).
 *
 * @property sessionId the stable per-session id used as the table key (web `row.session_id`).
 * @property vin the vehicle VIN (web `row.vin`); shown as its last-six suffix.
 * @property siteLocationName the charging site name (web `row.site_location_name`).
 * @property chargeStartDatetime the ISO-8601 start instant (web `row.charge_start_datetime`); the sort + date column.
 * @property totalEnergyAddedWh energy added in SI watt-hours (web `row.total_energy_added_wh`).
 * @property peakPowerKw the peak charging power in kW (web `row.peak_power_kw`).
 * @property chargeDurationS the session duration in seconds (web `row.charge_duration_s`).
 * @property totalCost the total session cost (web `row.total_cost`).
 * @property currencyCode the ISO currency code of [totalCost] / [perKwhRate] (web `row.currency_code`).
 * @property perKwhRate the per-kWh rate (web `row.per_kwh_rate`).
 * @property chargerType the charger kind, shown uppercased (web `row.charger_type`).
 * @property fetchedAt the sync timestamp (web `row.fetched_at`); the "last synced" label reads the first row's value.
 * @property latitude the site latitude in degrees (web `row.latitude`).
 * @property longitude the site longitude in degrees (web `row.longitude`).
 */
data class TeslaChargingSessionRow(
    val sessionId: String,
    val vin: String?,
    val siteLocationName: String?,
    val chargeStartDatetime: String,
    val totalEnergyAddedWh: Double?,
    val peakPowerKw: Double?,
    val chargeDurationS: Long?,
    val totalCost: Double?,
    val currencyCode: String?,
    val perKwhRate: Double?,
    val chargerType: String?,
    val fetchedAt: String?,
    val latitude: Double?,
    val longitude: Double?,
) {
    /** Whether this session carries a renderable coordinate — the web `mapPoints` filter (`lat != null && lng != null`). */
    val hasLocation: Boolean get() = latitude != null && longitude != null
}

/**
 * The aggregate stats the five summary StatCards read — the native mirror of the web `response.summary`. Energy is SI
 * watt-hours; costs are in the user's currency; peak power is the raw kW figure. Each is nullable so the page renders
 * the web `'—'` fallback when absent.
 */
data class TeslaChargingSummary(
    val totalSessions: Int = 0,
    val totalWh: Double? = null,
    val totalCost: Double? = null,
    val avgCostPerKwh: Double? = null,
    val peakPowerKw: Double? = null,
)

/**
 * The fully decoded `/tesla/charging/sessions` response — the `{ sessions, summary }` object the web reads as
 * `response.sessions` / `response.summary`. The empty value (no sessions, zeroed summary) drives the page's empty
 * surfaces; [hasData] is the content/empty boundary.
 */
data class TeslaChargingSessionsResponse(
    val sessions: List<TeslaChargingSessionRow> = emptyList(),
    val summary: TeslaChargingSummary = TeslaChargingSummary(),
) {
    /** Whether any session is present — the page's content/empty boundary (web `sessions.length > 0`). */
    val hasData: Boolean get() = sessions.isNotEmpty()
}

/** One aggregated month for the monthly-cost bar chart — the web `buildMonthlyCost` `{ month, total }` entry. */
data class MonthlyCost(
    val month: String,
    val total: Double,
)

/**
 * The live display preferences the surface needs — the native port of the web `useUnits` + `useFormatting` reads of the
 * `/settings` document. Currency formats from the [currencySymbol] (the symbol-based summary cards) or a row's ISO
 * currency code (the table); [locale] drives grouping + currency rendering; [unitFormatter] is the single SI ⇒ display
 * energy boundary.
 */
data class TeslaChargingDisplayPrefs(
    val currencySymbol: String,
    val locale: Locale,
    val unitFormatter: UnitFormatter,
) {
    companion object {
        /** The metric / `$` defaults used before settings load (matches the web fallbacks). */
        val DEFAULT: TeslaChargingDisplayPrefs =
            TeslaChargingDisplayPrefs(DEFAULT_CURRENCY, Locale.US, UnitFormatter.default())

        /** Resolves the currency symbol, locale, and unit formatter from the raw `/settings` document. */
        fun fromSettings(settings: JsonElement?): TeslaChargingDisplayPrefs {
            val prefs = UnitPreferences.fromSettings(settings)
            val rawSymbol = (settings as? JsonObject)?.stringField(KEY_CURRENCY_SYMBOL)?.trim()
            return TeslaChargingDisplayPrefs(
                currencySymbol = if (!rawSymbol.isNullOrEmpty()) rawSymbol else DEFAULT_CURRENCY,
                locale = Locale.forLanguageTag(prefs.locale ?: DEFAULT_LOCALE_TAG),
                unitFormatter = UnitFormatter(prefs),
            )
        }
    }
}

/**
 * The refresh-mutation state the controls bar reflects — the native mirror of the web
 * `refreshMutation.isPending` (the spinning button) + the `is403` flag (the "Business account required" hint).
 *
 * @property pending whether a sync is in flight (web `refreshMutation.isPending`).
 * @property forbidden whether the last sync failed with HTTP 403 (web `is403`).
 */
data class TeslaChargingRefreshState(
    val pending: Boolean = false,
    val forbidden: Boolean = false,
)

// ── Decode ──────────────────────────────────────────────────────────────────────────────────────────────────────

/**
 * Decode a raw `/tesla/charging/sessions` [JsonElement] (the `{ sessions, summary }` response) into the typed
 * [TeslaChargingSessionsResponse] the page renders. A non-object payload, a missing `sessions` array, or a non-object
 * row degrades to the empty value / a skipped row (web `safeArray` / optional chaining), so a partial payload never
 * throws.
 */
internal fun JsonElement.parseSessionsResponse(): TeslaChargingSessionsResponse {
    val obj = this as? JsonObject ?: return TeslaChargingSessionsResponse()
    val rows = (obj[KEY_SESSIONS] as? JsonArray)?.mapNotNull { parseSessionRow(it) } ?: emptyList()
    return TeslaChargingSessionsResponse(sessions = rows, summary = parseSummary(obj[KEY_SUMMARY]))
}

/**
 * Parse a raw [Resource] of the sessions [JsonElement] into a [Resource] of the decoded response, preserving every
 * freshness flag (cached / refreshing / stale / offline) so the view-model can render the full state matrix. Pure, so
 * the parse-and-preserve contract is unit-tested without a network or cache.
 */
internal fun Resource<JsonElement>.toResponseResource(): Resource<TeslaChargingSessionsResponse> =
    when (this) {
        is Resource.Loading ->
            Resource.Loading(cached = cached?.parseSessionsResponse(), fetchedAt = fetchedAt, stale = stale)

        is Resource.Success ->
            Resource.Success(data = data.parseSessionsResponse(), fetchedAt = fetchedAt, stale = stale)

        is Resource.Error ->
            Resource.Error(cached = cached?.parseSessionsResponse(), fetchedAt = fetchedAt, stale = stale, error = error)
    }

private fun parseSessionRow(element: JsonElement): TeslaChargingSessionRow? {
    val obj = element as? JsonObject ?: return null
    val start = obj.stringField(KEY_CHARGE_START_DATETIME) ?: return null
    return TeslaChargingSessionRow(
        sessionId = obj.idField(KEY_SESSION_ID),
        vin = obj.stringField(KEY_VIN),
        siteLocationName = obj.stringField(KEY_SITE_LOCATION_NAME),
        chargeStartDatetime = start,
        totalEnergyAddedWh = obj.doubleField(KEY_TOTAL_ENERGY_ADDED_WH),
        peakPowerKw = obj.doubleField(KEY_PEAK_POWER_KW),
        chargeDurationS = obj.longField(KEY_CHARGE_DURATION_S),
        totalCost = obj.doubleField(KEY_TOTAL_COST),
        currencyCode = obj.stringField(KEY_CURRENCY_CODE),
        perKwhRate = obj.doubleField(KEY_PER_KWH_RATE),
        chargerType = obj.stringField(KEY_CHARGER_TYPE),
        fetchedAt = obj.stringField(KEY_FETCHED_AT),
        latitude = obj.doubleField(KEY_LATITUDE),
        longitude = obj.doubleField(KEY_LONGITUDE),
    )
}

private fun parseSummary(element: JsonElement?): TeslaChargingSummary {
    val obj = element as? JsonObject ?: return TeslaChargingSummary()
    return TeslaChargingSummary(
        totalSessions = obj.longField(KEY_TOTAL_SESSIONS)?.toInt() ?: 0,
        totalWh = obj.doubleField(KEY_TOTAL_WH),
        totalCost = obj.doubleField(KEY_TOTAL_COST),
        avgCostPerKwh = obj.doubleField(KEY_AVG_COST_PER_KWH),
        peakPowerKw = obj.doubleField(KEY_PEAK_POWER_KW),
    )
}

private fun JsonObject.stringField(key: String): String? = (this[key] as? JsonPrimitive)?.contentOrNull

private fun JsonObject.doubleField(key: String): Double? = (this[key] as? JsonPrimitive)?.doubleOrNull

private fun JsonObject.longField(key: String): Long? {
    val primitive = this[key] as? JsonPrimitive ?: return null
    return primitive.longOrNull ?: primitive.doubleOrNull?.toLong()
}

/** The session id read as a string key — the web `row.session_id` (numeric or string) used verbatim as the row key. */
private fun JsonObject.idField(key: String): String = (this[key] as? JsonPrimitive)?.contentOrNull.orEmpty()

// ── Derivations ─────────────────────────────────────────────────────────────────────────────────────────────────

/**
 * Aggregate sessions by calendar month for the cost chart — a 1:1 port of the web `buildMonthlyCost`: bucket each
 * session by the `yyyy-MM` of its (local-zone) start instant, sum `total_cost` (missing ⇒ 0), and return the buckets
 * sorted ascending by month key. An unparseable start instant is skipped (it cannot be bucketed).
 */
fun buildMonthlyCost(
    sessions: List<TeslaChargingSessionRow>,
    zone: ZoneId = ZoneId.systemDefault(),
): List<MonthlyCost> {
    val totals = LinkedHashMap<String, Double>()
    for (session in sessions) {
        val month = monthKey(session.chargeStartDatetime, zone) ?: continue
        totals[month] = (totals[month] ?: 0.0) + (session.totalCost ?: 0.0)
    }
    return totals.entries
        .sortedBy { it.key }
        .map { MonthlyCost(month = it.key, total = it.value) }
}

/**
 * Sort sessions by [sortKey] in [descending] order — a 1:1 port of the web `sortedSessions` comparator. Text sorts use
 * the natural string comparison the web `localeCompare` applies to ISO dates; numeric sorts treat a missing value as 0.
 * An unknown key falls back to the date comparator (web `default`).
 */
fun sortSessions(
    sessions: List<TeslaChargingSessionRow>,
    sortKey: String,
    descending: Boolean,
): List<TeslaChargingSessionRow> {
    val comparator: Comparator<TeslaChargingSessionRow> =
        when (sortKey) {
            TeslaChargingSessionsSort.ENERGY -> compareBy { it.totalEnergyAddedWh ?: 0.0 }
            TeslaChargingSessionsSort.PEAK_POWER -> compareBy { it.peakPowerKw ?: 0.0 }
            TeslaChargingSessionsSort.COST -> compareBy { it.totalCost ?: 0.0 }
            else -> compareBy { it.chargeStartDatetime }
        }
    val sorted = sessions.sortedWith(comparator)
    return if (descending) sorted.asReversed() else sorted
}

/**
 * The CSV body for the selected sessions — the web `exportSelectedCsv` (the bulk-action "Export CSV"). One header row
 * plus one row per session, every field double-quoted with embedded quotes doubled, so a site name with a comma or
 * quote never corrupts the file. Values stay SI (energy in watt-hours, duration in seconds) exactly as the web export.
 */
fun buildSessionsCsv(rows: List<TeslaChargingSessionRow>): String {
    val header =
        listOf(
            "date", "location", "vin", "energy_wh", "peak_power_kw",
            "duration_seconds", "cost", "currency", "per_kwh_rate", "charger_type",
        )
    val lines = ArrayList<String>(rows.size + 1)
    lines.add(header.joinToString(",") { csvCell(it) })
    for (row in rows) {
        val fields =
            listOf(
                row.chargeStartDatetime,
                (row.siteLocationName ?: "").replace(Regex("[\",\\n]"), " "),
                row.vin ?: "",
                row.totalEnergyAddedWh?.toString() ?: "",
                row.peakPowerKw?.toString() ?: "",
                row.chargeDurationS?.toString() ?: "",
                row.totalCost?.toString() ?: "",
                row.currencyCode ?: "",
                row.perKwhRate?.toString() ?: "",
                row.chargerType ?: "",
            )
        lines.add(fields.joinToString(",") { csvCell(it) })
    }
    return lines.joinToString("\n")
}

private fun csvCell(value: String): String = "\"" + value.replace("\"", "\"\"") + "\""

// ── Formatting ──────────────────────────────────────────────────────────────────────────────────────────────────

/**
 * Pure, locale-aware display formatters mirroring the web helpers the page uses (`fmtNumber`, `fmtInt`,
 * `convertEnergyFromSI`, `formatCurrencyValue`, the `useFormatting` symbol concatenation, `formatDateTime`, and the
 * inline `formatDurationSeconds`). Stateless so the whole contract is covered off-device.
 */
object TeslaChargingSessionsFormat {
    /** Web `fmtNumber(value, decimals)` — grouped, fixed-precision, half-away-from-zero (ECMAScript `halfExpand`). */
    fun number(
        value: Double,
        decimals: Int,
        locale: Locale,
    ): String {
        val safeDecimals = decimals.coerceAtLeast(0)
        val pattern = if (safeDecimals > 0) "#,##0." + "0".repeat(safeDecimals) else "#,##0"
        return DecimalFormat(pattern, DecimalFormatSymbols(locale))
            .apply { roundingMode = RoundingMode.HALF_UP }
            .format(safe(value))
    }

    /** Web `fmtInt(value)` — the grouped whole-number summary count. */
    fun integer(
        value: Int,
        locale: Locale,
    ): String = NumberFormat.getIntegerInstance(locale).format(value)

    /** Watt-hours → kilowatt-hours — the web `convertEnergyFromSI(wh, 'kWh')` (`wh / 1000`). */
    fun energyKwh(wh: Double): Double = wh / WH_PER_KWH

    /**
     * Symbol-based currency — the web `useFormatting` `formatCurrency` (`currencySymbol + fmtNumber(amount, decimals)`),
     * used by the three summary cost cards. A blank symbol falls back to `$`.
     */
    fun currencyBySymbol(
        amount: Double,
        symbol: String,
        decimals: Int,
        locale: Locale,
    ): String = "${symbol.ifBlank { DEFAULT_CURRENCY }}${number(amount, decimals, locale)}"

    /**
     * ISO-currency-code formatting — the web `formatCurrencyValue(amount, currencyCode, locale, decimals)` used by the
     * table cost + rate columns. Formats with the row's currency code when it is a valid ISO code; otherwise falls back
     * to the symbol-based form so a missing / unknown code never blanks the cell.
     */
    fun currencyByCode(
        amount: Double,
        currencyCode: String?,
        fallbackSymbol: String,
        decimals: Int,
        locale: Locale,
    ): String {
        val byCode =
            currencyCode?.takeIf { it.isNotBlank() }?.let { code ->
                runCatching {
                    NumberFormat.getCurrencyInstance(locale).apply {
                        currency = Currency.getInstance(code.uppercase(Locale.ROOT))
                        minimumFractionDigits = decimals
                        maximumFractionDigits = decimals
                    }.format(safe(amount))
                }.getOrNull()
            }
        return byCode ?: currencyBySymbol(amount, fallbackSymbol, decimals, locale)
    }

    /**
     * Localized "MMM d, y, h:mm a"-style date/time — the native mirror of the web `formatDateTime`. Renders [iso] (an
     * ISO-8601 instant from the backend) in [zone]; returns the em dash for a blank or unparseable value (web `'—'`),
     * never throwing.
     */
    fun dateTime(
        iso: String?,
        locale: Locale,
        zone: ZoneId = ZoneId.systemDefault(),
    ): String {
        val instant = iso?.takeIf { it.isNotBlank() }?.let { parseInstant(it, zone) } ?: return EM_DASH
        return DateTimeFormatter
            .ofLocalizedDateTime(FormatStyle.MEDIUM, FormatStyle.SHORT)
            .withLocale(locale)
            .withZone(zone)
            .format(instant)
    }

    /** Web `formatDurationSeconds(seconds)` — "Xh Ym" when there are whole hours, else "Ym"; em dash for null. */
    fun duration(seconds: Long?): String {
        if (seconds == null) return EM_DASH
        val hours = seconds / SECONDS_PER_HOUR
        val minutes = (seconds % SECONDS_PER_HOUR) / SECONDS_PER_MINUTE
        return if (hours > 0) "${hours}h ${minutes}m" else "${minutes}m"
    }

    /** The last-six VIN suffix the table shows (web `…${row.vin.slice(-6)}`); em dash when absent. */
    fun vinSuffix(vin: String?): String =
        vin?.takeIf { it.isNotEmpty() }?.let { "${EM_DASH}${it.takeLast(VIN_SUFFIX_LENGTH)}" } ?: EM_DASH

    /** The label for one vehicle option (web `${display_name} (${vin.slice(-6)})`). */
    fun vehicleOptionLabel(
        displayName: String,
        vin: String,
    ): String = "$displayName (${vin.takeLast(VIN_SUFFIX_LENGTH)})"

    private const val VIN_SUFFIX_LENGTH = 6
}

/** Web `safeNumber(v)`: the value when finite, otherwise 0 — so a format never emits `NaN`. */
private fun safe(value: Double): Double = if (value.isFinite()) value else 0.0

/** The `yyyy-MM` bucket key for an ISO instant in [zone], or null when it cannot be parsed. */
private fun monthKey(
    iso: String,
    zone: ZoneId,
): String? {
    val instant = parseInstant(iso, zone) ?: return null
    return MONTH_KEY_FORMAT.withZone(zone).format(instant)
}

private val MONTH_KEY_FORMAT: DateTimeFormatter = DateTimeFormatter.ofPattern("yyyy-MM", Locale.ROOT)

/** Parses an ISO-8601 instant (UTC `Z`, an offset, or a zone-less local time) to an [Instant], or null. */
private fun parseInstant(
    iso: String,
    zone: ZoneId,
): Instant? =
    runCatching { Instant.parse(iso) }
        .recoverCatching { OffsetDateTime.parse(iso).toInstant() }
        .recoverCatching { LocalDateTime.parse(iso).atZone(zone).toInstant() }
        .recoverCatching { LocalDateTime.parse(iso).toInstant(ZoneOffset.UTC) }
        .getOrNull()

/**
 * Emits the one PII-safe `view.opened` diagnostic with the surface [TeslaChargingSessionsPageRegistration.SLUG]
 * (P1/S11). Kept free of Compose so it is unit-testable with a recording [Logger]; the page calls it from its first
 * composition. Carries no vin, site name, coordinate, or cost.
 */
fun recordTeslaChargingSessionsPageOpened(logger: Logger) {
    logger.info("view.opened", mapOf("surface" to TeslaChargingSessionsPageRegistration.SLUG))
}
