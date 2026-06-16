// Pure, framework-free model + projections for the TeslaChargingHistoryPage charging surface — the native
// analogue of everything the web page derives before it returns JSX
// (web/src/features/charging/pages/TeslaChargingHistoryPage.tsx, the Supercharger/DC billing-records inspector).
// No Compose, no Android framework, no HTTP lives here: every type is exercised off-device, so the composable
// stays a thin render layer.
//
// The history feed arrives as the raw verbatim server JSON the shared S8 ChargingStore already exposes
// (`GET /tesla/charging/history[?vin]` ▸ teslaChargingHistory(vin)). This file owns the parse (the `entries` rows
// + the server `summary` rollup) plus the client-side derivations the web component does inline: the monthly
// spend aggregation that feeds the bar chart (web `buildMonthlySpending`), the per-session duration
// (web `durationMinutes` / `formatDurationMinutes`), the location search predicate (web `useFilteredList`), the
// date/energy/cost sort (web `sortedEntries`), the CSV export body (web `exportSelectedCsv`), and the
// settings-symbol → ISO-4217 bridge (web `currencyCodeFromSymbol`).
//
// SI boundary (unit-conversion instructions): NO unit conversion happens here. Energy stays in Wh and money in
// its raw decimal exactly as the API serves them; the display boundary (the composable's UnitFormatter / the
// currency formatter) converts. `usage_wh` / `total_wh` are carried verbatim and handed to `UnitFormatter.energy`
// at render, never divided here.
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory (com/teslasync/charging —
// the P3 prompt's allowed-files path) cannot form the package the rest of the app's `io.teslasync.android.*`
// namespace uses, so the package intentionally diverges from the path — exactly as the sibling A7 charging /
// admin surfaces do. `MatchingDeclarationName` is suppressed for the co-located types.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.charging.teslacharginghistory

import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.doubleOrNull
import kotlinx.serialization.json.longOrNull
import java.time.Instant
import java.time.OffsetDateTime
import java.time.ZoneId

/** Em dash used as the universal "no value" marker, matching the web `'—'` fallback. */
internal const val EM_DASH: String = "\u2014"

/**
 * Canonical metadata for this surface. The web page is a top-level charging route, not a draggable dashboard
 * widget, so there is no web registry row to mirror — this object carries the cross-cutting concerns the surface
 * owes: the navigation [ROUTE_ID] / [WEB_PATH] the host wires (already present in Destinations.kt as
 * `page("teslaChargingHistory", "/tesla-charging-history", …)`), the diagnostics [SLUG] emitted with the one-shot
 * `view.opened` event (P1/S11), and the default sort the web applies (`date` desc).
 */
object TeslaChargingHistoryPageRegistration {
    /** The navigation destination id (Destinations.kt `page("teslaChargingHistory", "/tesla-charging-history", …)`). */
    const val ROUTE_ID: String = "teslaChargingHistory"

    /** The web route this surface mirrors (deep-link target). */
    const val WEB_PATH: String = "/tesla-charging-history"

    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). Carries no vin / cost figure. */
    const val SLUG: String = "TeslaChargingHistoryPage"

    /** The web default sort column (`useUrlEnum('sort', …, 'date')`). */
    const val DEFAULT_SORT_KEY: String = "date"
}

/** The three sortable columns (web `useUrlEnum<'date'|'energy'|'cost'>`). */
enum class HistorySortColumn(val key: String) {
    Date("date"),
    Energy("energy"),
    Cost("cost"),
    ;

    internal companion object {
        /** Resolve a column key to its enum, defaulting to [Date] (the web fallback). */
        fun fromKey(key: String?): HistorySortColumn = entries.firstOrNull { it.key == key } ?: Date
    }
}

/**
 * One Tesla charging-history row — the native mirror of the web `TeslaChargingHistoryEntry`. Nullable wire fields
 * stay nullable so the render boundary applies the web `?? '—'` fallbacks honestly rather than fabricating zero.
 * Energy is SI watt-hours ([usageWh]); money fields are raw decimals in [currencyCode].
 *
 * @property sessionId the stable row key (web `keyExtractor={row.session_id}`).
 */
data class TeslaChargingHistoryEntry(
    val sessionId: Long,
    val vin: String,
    val siteLocationName: String,
    val chargeStartDatetime: String,
    val chargeStopDatetime: String?,
    val currencyCode: String?,
    val pricingType: String?,
    val rateBase: Double?,
    val usageWh: Double?,
    val totalDue: Double?,
    val hasInvoice: Boolean,
    val invoiceContentId: String?,
    val fetchedAt: String,
) {
    internal companion object {
        fun from(obj: JsonObject?): TeslaChargingHistoryEntry? {
            if (obj == null) return null
            return TeslaChargingHistoryEntry(
                sessionId = obj.long("session_id") ?: obj.long("id") ?: 0L,
                vin = obj.string("vin") ?: "",
                siteLocationName = obj.string("site_location_name") ?: "",
                chargeStartDatetime = obj.string("charge_start_datetime") ?: "",
                chargeStopDatetime = obj.string("charge_stop_datetime"),
                currencyCode = obj.string("currency_code"),
                pricingType = obj.string("pricing_type"),
                rateBase = obj.double("rate_base"),
                usageWh = obj.double("usage_wh"),
                totalDue = obj.double("total_due"),
                hasInvoice = obj.boolean("has_invoice") ?: false,
                invoiceContentId = obj.string("invoice_content_id"),
                fetchedAt = obj.string("fetched_at") ?: "",
            )
        }
    }
}

/**
 * The `summary` rollup the backend computes over ALL entries (web `response.summary`) — the native mirror of
 * `TeslaChargingHistorySummary`. Every scalar is nullable so the StatCards show the web em-dash before stats
 * resolve, never a misleading zero. [totalWh] is SI watt-hours; [totalSpend]/[avgCostPerKwh] are raw money.
 */
data class TeslaChargingHistorySummary(
    val totalSessions: Int,
    val totalWh: Double?,
    val totalSpend: Double?,
    val avgCostPerKwh: Double?,
) {
    internal companion object {
        /** The web zero-state default (`response?.summary ?? { total_sessions: 0, … }`). */
        val EMPTY: TeslaChargingHistorySummary = TeslaChargingHistorySummary(0, null, null, null)

        fun from(obj: JsonObject?): TeslaChargingHistorySummary {
            if (obj == null) return EMPTY
            return TeslaChargingHistorySummary(
                totalSessions = obj.int("total_sessions") ?: 0,
                totalWh = obj.double("total_wh"),
                totalSpend = obj.double("total_spend"),
                avgCostPerKwh = obj.double("avg_cost_per_kwh"),
            )
        }
    }
}

/**
 * The combined render-ready payload the surface binds to: the parsed [entries] (web `response.entries ?? []`)
 * and the server [summary] (web `response.summary`). [isEmpty] gates the native Empty phase — the page has no
 * Tesla charging history yet.
 */
data class TeslaChargingHistoryData(
    val entries: List<TeslaChargingHistoryEntry>,
    val summary: TeslaChargingHistorySummary,
) {
    val isEmpty: Boolean get() = entries.isEmpty()

    internal companion object {
        val EMPTY: TeslaChargingHistoryData = TeslaChargingHistoryData(emptyList(), TeslaChargingHistorySummary.EMPTY)

        /** Parse the raw `/tesla/charging/history` envelope into the combined payload. */
        fun from(json: JsonElement?): TeslaChargingHistoryData {
            val envelope = json as? JsonObject ?: return EMPTY
            val rows = (envelope["entries"] as? JsonArray).orEmpty()
            val entries = rows.mapNotNull { TeslaChargingHistoryEntry.from(it as? JsonObject) }
            return TeslaChargingHistoryData(
                entries = entries,
                summary = TeslaChargingHistorySummary.from(envelope["summary"] as? JsonObject),
            )
        }
    }
}

/**
 * The display currency context resolved from the `/settings` document — the native port of the web
 * `useFormatting`/`useSettings` derivation. [symbol] is the raw settings symbol (web `currency_symbol`, default
 * `$`) used as the summary prefix; [locale] (default `en-US`) and [precision] (default `2`) drive locale-aware
 * number + per-row ISO currency formatting at the display boundary. No money math happens here.
 */
data class CurrencyContext(
    val symbol: String,
    val locale: String,
    val precision: Int,
) {
    companion object {
        /** The pre-settings default (web `'$'` / `'en-US'` / `2`). */
        val DEFAULT: CurrencyContext = CurrencyContext("$", "en-US", DEFAULT_PRECISION)

        /** Resolve the context from the `/settings` document, falling back to [DEFAULT] for missing fields. */
        fun from(settings: JsonElement?): CurrencyContext {
            val obj = settings as? JsonObject ?: return DEFAULT
            val symbol = obj.string("currency_symbol")?.takeIf { it.isNotBlank() } ?: "$"
            val locale = obj.string("locale")?.takeIf { it.isNotBlank() } ?: "en-US"
            val precision =
                obj.double("decimal_precision")?.takeIf { it.isFinite() && it >= 0 }?.toInt() ?: DEFAULT_PRECISION
            return CurrencyContext(symbol, locale, precision)
        }
    }
}

/** One bar in the monthly-spending chart — a `yyyy-MM` [month] bucket and its summed [total] (web shape). */
data class MonthlySpend(
    val month: String,
    val total: Double,
)

/**
 * Aggregate [entries] by calendar month for the spending bar chart — the native port of the web
 * `buildMonthlySpending`: bucket each row by the `yyyy-MM` of its `charge_start_datetime` (in [zone], the web's
 * local-time `new Date(...).getFullYear()/getMonth()`), sum `total_due` (?? 0), then sort by month ascending.
 * Rows whose start timestamp does not parse are skipped, so a malformed row never poisons the chart.
 */
fun buildMonthlySpending(
    entries: List<TeslaChargingHistoryEntry>,
    zone: ZoneId = ZoneId.systemDefault(),
): List<MonthlySpend> {
    val totals = LinkedHashMap<String, Double>()
    for (entry in entries) {
        val key = monthKey(entry.chargeStartDatetime, zone) ?: continue
        totals[key] = (totals[key] ?: 0.0) + (entry.totalDue ?: 0.0)
    }
    return totals.entries
        .sortedBy { it.key }
        .map { MonthlySpend(it.key, it.value) }
}

/** The `yyyy-MM` bucket key for an ISO-8601 [iso] timestamp in [zone], or `null` when it cannot be parsed. */
private fun monthKey(
    iso: String,
    zone: ZoneId,
): String? {
    val instant = parseInstant(iso) ?: return null
    val local = instant.atZone(zone)
    return "${local.year}-${local.monthValue.toString().padStart(2, '0')}"
}

/**
 * Tolerant ISO-8601 → [Instant] parse. Accepts an offset/`Z` timestamp (`OffsetDateTime`) first, then a bare
 * instant, returning `null` on anything unparseable so a single bad row never throws across the derivation.
 */
internal fun parseInstant(iso: String): Instant? {
    if (iso.isBlank()) return null
    return runCatching { OffsetDateTime.parse(iso).toInstant() }
        .recoverCatching { Instant.parse(iso) }
        .getOrNull()
}

/**
 * Whole-minute duration between [start] and [stop] — the native mirror of the web
 * `durationMinutes(charge_start_datetime, charge_stop_datetime)`. Returns `null` for a still-open session (no
 * stop) or a non-positive / unparseable range (web `ms > 0 ? round : null`), so the row renders the em-dash.
 */
fun durationMinutes(
    start: String,
    stop: String?,
): Long? {
    if (stop.isNullOrBlank()) return null
    val startInstant = parseInstant(start) ?: return null
    val stopInstant = parseInstant(stop) ?: return null
    val deltaMs = stopInstant.toEpochMilli() - startInstant.toEpochMilli()
    return if (deltaMs > 0L) Math.round(deltaMs / MILLIS_PER_MINUTE) else null
}

/**
 * Format whole minutes as `"Xh Ym"` / `"Ym"` (web `formatDurationMinutes`), or the em-dash for `null`. Kept here
 * (pure) so the duration column and the test share one implementation.
 */
fun formatDurationMinutes(minutes: Long?): String {
    if (minutes == null) return EM_DASH
    val hours = minutes / MINUTES_PER_HOUR
    val mins = minutes % MINUTES_PER_HOUR
    return if (hours > 0) "${hours}h ${mins}m" else "${mins}m"
}

/**
 * The location search predicate — the native port of the web `useFilteredList(entries, search,
 * ['site_location_name'])`: a blank query returns every row, otherwise a case-insensitive substring match on the
 * site location name. Applied AFTER the (server-summarized) entries, exactly like the web search box.
 */
fun filterEntries(
    entries: List<TeslaChargingHistoryEntry>,
    search: String,
): List<TeslaChargingHistoryEntry> {
    val needle = search.trim().lowercase()
    if (needle.isEmpty()) return entries
    return entries.filter { it.siteLocationName.lowercase().contains(needle) }
}

/**
 * Sort [entries] by [column] in [descending] order — the native port of the web `sortedEntries` `useMemo`: date
 * compares the ISO strings lexically (web `localeCompare`, valid for ISO-8601), energy compares `usage_wh ?? 0`,
 * cost compares `total_due ?? 0`. A stable sort preserves input order within ties.
 */
fun sortEntries(
    entries: List<TeslaChargingHistoryEntry>,
    column: HistorySortColumn,
    descending: Boolean,
): List<TeslaChargingHistoryEntry> {
    val base: Comparator<TeslaChargingHistoryEntry> =
        when (column) {
            HistorySortColumn.Date -> compareBy { it.chargeStartDatetime }
            HistorySortColumn.Energy -> compareBy { it.usageWh ?: 0.0 }
            HistorySortColumn.Cost -> compareBy { it.totalDue ?: 0.0 }
        }
    val comparator = if (descending) base.reversed() else base
    return entries.sortedWith(comparator)
}

/**
 * Serialize [rows] to the same self-explanatory CSV the web `exportSelectedCsv` writes — the header line plus one
 * row per session (date, location, duration minutes, energy Wh, cost, currency, rate, pricing type, invoice id).
 * Every field is double-quoted with embedded quotes doubled, matching the web's quoting. Surfaced on Android by
 * copying it to the clipboard (no `Blob`/download in Compose).
 */
fun encodeEntriesCsv(rows: List<TeslaChargingHistoryEntry>): String {
    val header = listOf(
        "date", "location", "duration_minutes", "energy_wh",
        "cost", "currency", "rate_base", "pricing_type", "invoice_id",
    )
    val lines = ArrayList<String>(rows.size + 1)
    lines.add(header.joinToString(","))
    for (row in rows) {
        val duration = durationMinutes(row.chargeStartDatetime, row.chargeStopDatetime)
        val fields = listOf(
            row.chargeStartDatetime,
            row.siteLocationName,
            duration?.toString() ?: "",
            row.usageWh?.let { csvNumber(it) } ?: "",
            row.totalDue?.let { csvNumber(it) } ?: "",
            row.currencyCode ?: "",
            row.rateBase?.let { csvNumber(it) } ?: "",
            row.pricingType ?: "",
            row.invoiceContentId ?: "",
        )
        lines.add(fields.joinToString(",") { "\"${it.replace("\"", "\"\"")}\"" })
    }
    return lines.joinToString("\n")
}

/** Render a CSV numeric cell without scientific notation or a trailing `.0` for whole values. */
private fun csvNumber(value: Double): String =
    if (value == Math.floor(value) && !value.isInfinite()) value.toLong().toString() else value.toString()

/**
 * Best-effort reverse lookup from a settings currency symbol to its most-common ISO-4217 code — the verbatim port
 * of the web `currencyCodeFromSymbol` (web/src/lib/currencyFormat.ts). The settings panel stores only the symbol
 * (`currency_symbol`), so this bridges to a code the per-row currency formatter can hand to `NumberFormat`.
 * Falls back to `USD` for an unknown / blank symbol.
 */
@Suppress("CyclomaticComplexMethod")
fun currencyCodeFromSymbol(symbol: String?): String =
    when ((symbol ?: "").trim()) {
        "$" -> "USD"
        "\u20AC" -> "EUR"
        "\u00A3" -> "GBP"
        "\u00A5" -> "JPY"
        "\u20B9" -> "INR"
        "\u20BD" -> "RUB"
        "\u20A9" -> "KRW"
        "A$" -> "AUD"
        "C$" -> "CAD"
        "CHF" -> "CHF"
        "kr" -> "SEK"
        "R$" -> "BRL"
        "R" -> "ZAR"
        "NZ$" -> "NZD"
        "HK$" -> "HKD"
        "NT$" -> "TWD"
        "S$" -> "SGD"
        "\u20BA" -> "TRY"
        "\u0E3F" -> "THB"
        "Mex$" -> "MXN"
        "z\u0142" -> "PLN"
        else -> "USD"
    }

/**
 * Emits the one PII-safe `view.opened` diagnostic with the surface [TeslaChargingHistoryPageRegistration.SLUG]
 * (P1/S11). Kept free of Compose so it is unit-testable with a recording [Logger]; the page calls it from its
 * first composition. Carries no vin, location, energy, or cost figure.
 */
internal fun recordTeslaChargingHistoryPageOpened(logger: Logger) {
    logger.info("view.opened", mapOf("surface" to TeslaChargingHistoryPageRegistration.SLUG))
}

// ── JSON helpers (tolerant readers over the raw ChargingStore element) ──────────────────────────────────────

private fun JsonObject.prim(key: String): JsonPrimitive? = this[key] as? JsonPrimitive

private fun JsonObject.string(key: String): String? = prim(key)?.contentOrNull

private fun JsonObject.int(key: String): Int? = prim(key)?.longOrNull?.toInt()

private fun JsonObject.long(key: String): Long? = prim(key)?.longOrNull

private fun JsonObject.double(key: String): Double? = prim(key)?.doubleOrNull

private fun JsonObject.boolean(key: String): Boolean? = prim(key)?.booleanOrNull

private fun JsonArray?.orEmpty(): List<JsonElement> = this ?: emptyList()

/** The web default decimal precision when settings omit / reject `decimal_precision`. */
private const val DEFAULT_PRECISION = 2

/** Milliseconds per minute — the web `(end - start) / 60000` divisor. */
private const val MILLIS_PER_MINUTE = 60_000.0

/** Minutes per hour — the web `Math.floor(minutes / 60)` divisor. */
private const val MINUTES_PER_HOUR = 60L
