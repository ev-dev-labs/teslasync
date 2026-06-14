// Pure, framework-free model + projection for the Wall Connector dashboard widget — the native
// analogue of everything the web component derives via `useMemo` before returning JSX
// (web/src/features/dashboard/widgets/WallConnectorWidget.tsx). No Compose, no Android, no HTTP:
// every type here is unit-tested off-device in the :android:testReleaseUnitTest gate, keeping the
// composable a thin render layer. The Wall Connector charging-history feed arrives as raw SI JSON
// (`/tesla/energy-sites/{id}/charging-history`, per-session `energy_wh` watt-hours), so this file owns
// the decode (web optional-chaining → null-safe reads), the per-day aggregation (web `byDay` Map sum),
// the current-month rollups (web `isSameMonth` filter → total / sessions / avg), and the Wh → kWh
// display scaling the web does inline (`(entry.energy_wh ?? 0) / 1000`). Wall Connector energy is a
// routing readout, not a stored unit-suffixed field carrying a user unit preference, so no Phase-48
// unit-preference conversion applies — the kWh scaling + literal `kWh` unit mirror the web verbatim.
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/dashboard-widgets/WallConnectorWidget — the P3 prompt's allowed-files path) cannot
// form a valid Kotlin package (a hyphen and a PascalCase segment are illegal in a package identifier),
// so the package intentionally diverges from the path. `MatchingDeclarationName` is suppressed for the
// co-located supporting types.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.dashboard.widgets.wallconnector

import io.teslasync.android.components.charts.ChartFormat
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.doubleOrNull
import kotlinx.serialization.json.longOrNull
import java.time.Instant
import java.time.LocalDate
import java.time.YearMonth
import java.time.ZoneId
import java.util.Locale

/** Watt-hours per kilowatt-hour — the web `(entry.energy_wh ?? 0) / 1000` display scaling. */
private const val WH_PER_KWH = 1000.0

/** The number of leading characters of an ISO timestamp that form its `YYYY-MM-DD` date key. */
private const val DATE_KEY_LENGTH = 10

/** This-Month total + Avg/Session fraction digits (web `fmtNumber(.., 1)`). */
private const val ONE_DECIMAL = 1

/** Session-count fraction digits (web `fmtInt` ⇒ 0). */
private const val INT_DECIMALS = 0

/**
 * The widget's grid footprint (columns × rows). Mirrors the web `WidgetProps.size` plus the `isCompact`
 * / `isWide` logic in the web source: compact (This Month + Sessions only, no chart/title) is a single
 * column or fewer (web `size.cols <= 1`); wide (wider axis ticks) is three or more columns (web
 * `size.cols >= 3`).
 */
data class WallConnectorSize(
    val cols: Int,
    val rows: Int,
) {
    /** True at a single column or fewer (web `isCompact = size.cols <= 1`): stats only, no chart or title. */
    val isCompact: Boolean get() = cols <= COMPACT_MAX_COLS

    /** True at three or more columns (web `isWide = size.cols >= 3`): wider axis ticks. */
    val isWide: Boolean get() = cols >= WIDE_MIN_COLS

    private companion object {
        const val COMPACT_MAX_COLS = 1
        const val WIDE_MIN_COLS = 3
    }
}

/**
 * Canonical registry metadata for this surface — the native mirror of the web registry entry in
 * web/src/features/dashboard/widgets/registry/charging.ts (`wall-connector`). A dashboard grid host
 * binds this surface with the same [ID] and honours the same min/max footprint, so the native + web
 * grids stay in lockstep.
 */
object WallConnectorRegistration {
    /** Stable registry id (matches the web registry). */
    const val ID = "wall-connector"

    /** Widget category (matches the web registry). */
    const val CATEGORY = "charging"

    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). */
    const val SLUG = "WallConnectorWidget"

    /** Registry description copy (registry metadata; not rendered in the widget body). */
    const val DESCRIPTION = "Home charging stats from Tesla Wall Connector: daily kWh, session history"

    /** The history window the feed requests, in days (web `since = today − 14 days`). */
    const val WINDOW_DAYS = 14L

    /** Default footprint: 2 columns × 4 rows (web `defaultSize`). */
    val defaultSize = WallConnectorSize(cols = 2, rows = 4)

    /** Minimum footprint: 1 column × 2 rows (web `minSize`). */
    val minSize = WallConnectorSize(cols = 1, rows = 2)

    /** Maximum footprint: 4 columns × 40 rows (web `maxSize`). */
    val maxSize = WallConnectorSize(cols = 4, rows = 40)

    /** True when [size] already lies within the inclusive min/max footprint (clamping is a no-op). */
    fun isWithinBounds(size: WallConnectorSize): Boolean = clamp(size) == size

    /** Clamp [size] into the supported min/max footprint. */
    fun clamp(size: WallConnectorSize): WallConnectorSize =
        WallConnectorSize(
            cols = size.cols.coerceIn(minSize.cols, maxSize.cols),
            rows = size.rows.coerceIn(minSize.rows, maxSize.rows),
        )

    /**
     * The `YYYY-MM-DD` start of the 14-day window — the native analogue of the web
     * `since = new Date(); since.setDate(getDate() - 14); since.toISOString().slice(0, 10)`. Resolved in
     * UTC (the web `toISOString()` reference frame) so the cache key + `since` query are deterministic.
     */
    fun windowStartDate(nowMillis: Long): String = utcDate(nowMillis).minusDays(WINDOW_DAYS).toString()

    /**
     * The current calendar month — the native analogue of the web `isSameMonth` reference frame
     * (`new Date()` local year + month). Resolved in [zone] (defaulting to the device zone, like the web
     * local `new Date()`) so a session is counted in "this month" exactly when the web would count it.
     */
    fun currentYearMonth(
        nowMillis: Long,
        zone: ZoneId = ZoneId.systemDefault(),
    ): YearMonth = YearMonth.from(Instant.ofEpochMilli(nowMillis).atZone(zone).toLocalDate())

    private fun utcDate(millis: Long): LocalDate = Instant.ofEpochMilli(millis).atZone(ZoneId.of("UTC")).toLocalDate()
}

/**
 * One decoded Wall Connector charging entry reduced to the three values the web aggregations read: the
 * raw `YYYY-MM-DD` [dayKey] (web `(entry.timestamp ?? '').slice(0, 10)`, the per-day bucket key — blank
 * when the timestamp is missing, so the entry drops out of the chart like the web `if (!day) continue`),
 * the [yearMonth] of the full timestamp in the display zone (web `new Date(entry.timestamp)` → the
 * `isSameMonth` test; `null` when unparseable so it is never counted in this month), and the session's
 * energy in [energyKwh] (SI `energy_wh` ÷ 1000 — the web chart + rollups all read kWh).
 */
data class WallConnectorEntry(
    val dayKey: String,
    val yearMonth: YearMonth?,
    val energyKwh: Double,
)

/**
 * One aggregated daily chart point — the native analogue of a web `ChartDatum` (`{ date, energy_kwh }`).
 * Carries the raw `YYYY-MM-DD` [dateKey] (the ascending sort key, web `byDay` Map key), the localized
 * `M/d` x-axis [label] (web `shortDate(day)`), and the summed day energy in [energyKwh].
 */
data class WallConnectorDayPoint(
    val dateKey: String,
    val label: String,
    val energyKwh: Double,
)

/**
 * The combined two-feed snapshot the view-model projects — the native analogue of the web component's
 * `useTeslaEnergySites` + `useTeslaWCChargingHistory` composition. [hasSites] mirrors the web
 * `(sites ?? []).length > 0` gate (drives the "No Tesla Energy site linked" surface); [days] is the
 * aggregated 14-day daily history and the [monthTotalKwh] / [monthSessions] / [avgKwhPerSession] are the
 * current-month rollups. Pure data so the projection is unit-tested without a UI host.
 */
data class WallConnectorSnapshot(
    val hasSites: Boolean,
    val days: List<WallConnectorDayPoint>,
    val monthTotalKwh: Double,
    val monthSessions: Int,
    val avgKwhPerSession: Double,
) {
    /**
     * Web `hasData = chartData.length > 0 && chartData.some(d => d.energy_kwh > 0)` — drives the chart vs
     * "No Wall Connector data" empty gate inside a linked-site surface.
     */
    val hasData: Boolean get() = days.isNotEmpty() && days.any { it.energyKwh > 0.0 }

    companion object {
        /** The "nothing resolved" fallback (no site linked, no history). */
        val EMPTY =
            WallConnectorSnapshot(
                hasSites = false,
                days = emptyList(),
                monthTotalKwh = 0.0,
                monthSessions = 0,
                avgKwhPerSession = 0.0,
            )

        /** A resolved snapshot that found no linked Tesla Energy site (web `hasSites === false`). */
        val NO_SITES = EMPTY

        /** A linked-site snapshot carrying its decoded daily history + current-month rollups. */
        fun ofData(
            days: List<WallConnectorDayPoint>,
            monthTotalKwh: Double,
            monthSessions: Int,
            avgKwhPerSession: Double,
        ): WallConnectorSnapshot =
            WallConnectorSnapshot(
                hasSites = true,
                days = days,
                monthTotalKwh = monthTotalKwh,
                monthSessions = monthSessions,
                avgKwhPerSession = avgKwhPerSession,
            )
    }
}

/**
 * The first energy site's id resolved from the `/tesla/energy-sites` list — the native analogue of the
 * web `siteId = (sites ?? [])[0]?.energy_site_id`. [hasSites] mirrors the web length gate independently
 * of whether the first row carried a usable id.
 */
data class WallConnectorSitesSummary(
    val hasSites: Boolean,
    val firstSiteId: Long?,
)

/** One projected summary statistic for the header row — the native analogue of a web `ChartSummaryStat`. */
data class WallConnectorStat(
    val label: String,
    val value: String,
    val unit: String?,
)

/**
 * The localized strings the surface needs, resolved through the i18n facade (P1/S10) at the Compose
 * boundary and passed in so the projection stays framework-free and JVM-testable. They map to the
 * `widget.wallConnector.*` keys; [energy] names the chart series (web `Bar name=…`) + tooltip label.
 */
data class WallConnectorStrings(
    val title: String,
    val noSite: String,
    val noData: String,
    val monthTotal: String,
    val sessions: String,
    val avgPerSession: String,
    val energy: String,
)

/**
 * The fully projected, render-ready view of the Wall Connector history for one footprint — the native
 * analogue of everything the web component computes via `useMemo` (the `chartData` aggregation and the
 * `monthTotalKwh` / `monthSessions` / `avgKwhPerSession` rollups) plus its compact/standard stat
 * selection. Pure data (no Compose types) so the projection is unit-tested without a UI host.
 */
data class WallConnectorDisplay(
    val hasSites: Boolean,
    val hasData: Boolean,
    val isCompact: Boolean,
    val isWide: Boolean,
    val days: List<WallConnectorDayPoint>,
    val stats: List<WallConnectorStat>,
    val title: String,
    val energyLabel: String,
    val noSiteMessage: String,
    val noDataMessage: String,
)

/**
 * Formats an ISO-8601 [iso] timestamp as a non-zero-padded `M/d` label in [zone] — the native port of
 * the web `shortDate` (`${d.getMonth() + 1}/${d.getDate()}` off a local `new Date(iso)`). A full RFC3339
 * instant (the Go `time.Time` wire shape) or a bare `YYYY-MM-DD` date both parse; an unparseable value
 * returns the raw input (web returns `iso` when `new Date(iso)` is `Invalid`).
 */
fun shortDate(
    iso: String,
    zone: ZoneId = ZoneId.systemDefault(),
): String {
    val date = parseLocalDate(iso, zone) ?: return iso
    return "${date.monthValue}/${date.dayOfMonth}"
}

private fun parseLocalDate(
    iso: String,
    zone: ZoneId,
): LocalDate? =
    runCatching { Instant.parse(iso).atZone(zone).toLocalDate() }.getOrNull()
        ?: runCatching { LocalDate.parse(iso.take(DATE_KEY_LENGTH)) }.getOrNull()

/**
 * The first site's `energy_site_id` from the energy-sites array (web `(sites ?? [])[0]?.energy_site_id`)
 * together with whether any site is linked (web `(sites ?? []).length > 0`). A non-array input, an empty
 * list, or a first row lacking the id all collapse to the matching no-site fields.
 */
fun parseWallConnectorSites(json: JsonElement?): WallConnectorSitesSummary {
    val array = json as? JsonArray ?: return WallConnectorSitesSummary(hasSites = false, firstSiteId = null)
    val firstSiteId = (array.firstOrNull() as? JsonObject)?.long("energy_site_id")
    return WallConnectorSitesSummary(hasSites = array.isNotEmpty(), firstSiteId = firstSiteId)
}

/**
 * Decodes the raw `/tesla/energy-sites/{id}/charging-history` [json] array into [WallConnectorEntry]s —
 * the native port of the per-entry reads the web aggregations perform. Each row keeps its raw
 * `YYYY-MM-DD` day key (web `entry.timestamp.slice(0, 10)`), the [zone]-local `YearMonth` of the full
 * timestamp (web `new Date(entry.timestamp)` → `isSameMonth`), and its `energy_wh` read null-tolerantly
 * and scaled to kWh (web `(entry.energy_wh ?? 0) / 1000`). A non-array input yields an empty list;
 * non-object rows are skipped.
 */
fun parseWallConnectorEntries(
    json: JsonElement?,
    zone: ZoneId = ZoneId.systemDefault(),
): List<WallConnectorEntry> {
    val array = json as? JsonArray ?: return emptyList()
    return array.mapNotNull { element ->
        val obj = element as? JsonObject ?: return@mapNotNull null
        val timestamp = obj.string("timestamp") ?: ""
        WallConnectorEntry(
            dayKey = timestamp.take(DATE_KEY_LENGTH),
            yearMonth = parseYearMonth(timestamp, zone),
            energyKwh = obj.double("energy_wh") / WH_PER_KWH,
        )
    }
}

/**
 * Aggregates [entries] into ascending-by-day chart points — the native port of the web `byDay` Map
 * (`byDay.set(day, (byDay.get(day) ?? 0) + energy_wh / 1000)`) followed by the ascending
 * `sort(([a], [b]) => a.localeCompare(b))` and the `map(([day, kwh]) => ({ date: shortDate(day), … }))`.
 * Entries with a blank day key are skipped (web `if (!day) continue`); rows are labelled in [zone].
 */
fun aggregateDailyKwh(
    entries: List<WallConnectorEntry>,
    zone: ZoneId = ZoneId.systemDefault(),
): List<WallConnectorDayPoint> {
    val byDay = LinkedHashMap<String, Double>()
    for (entry in entries) {
        if (entry.dayKey.isEmpty()) continue
        byDay[entry.dayKey] = (byDay[entry.dayKey] ?: 0.0) + entry.energyKwh
    }
    return byDay.entries
        .sortedBy { it.key }
        .map { (day, kwh) -> WallConnectorDayPoint(dateKey = day, label = shortDate(day, zone), energyKwh = kwh) }
}

/**
 * Builds the linked-site [WallConnectorSnapshot] from the decoded history [json] — the native analogue of
 * the web component's two `useMemo`s. Daily chart points come from [aggregateDailyKwh]; the current-month
 * rollups (web `monthEntries = entries.filter(isSameMonth)` → total / count / avg) sum only the entries
 * whose [WallConnectorEntry.yearMonth] equals [nowYearMonth]. Rows are labelled in [zone].
 */
fun wallConnectorSnapshotOf(
    json: JsonElement?,
    nowYearMonth: YearMonth,
    zone: ZoneId = ZoneId.systemDefault(),
): WallConnectorSnapshot {
    val entries = parseWallConnectorEntries(json, zone)
    val days = aggregateDailyKwh(entries, zone)
    val monthEntries = entries.filter { it.yearMonth == nowYearMonth }
    val total = monthEntries.sumOf { it.energyKwh }
    val count = monthEntries.size
    val avg = if (count > 0) total / count else 0.0
    return WallConnectorSnapshot.ofData(days = days, monthTotalKwh = total, monthSessions = count, avgKwhPerSession = avg)
}

private fun parseYearMonth(
    iso: String,
    zone: ZoneId,
): YearMonth? = parseLocalDate(iso, zone)?.let { YearMonth.from(it) }

private fun JsonObject.double(key: String): Double = (this[key] as? JsonPrimitive)?.doubleOrNull?.takeIf { it.isFinite() } ?: 0.0

private fun JsonObject.long(key: String): Long? = (this[key] as? JsonPrimitive)?.longOrNull

private fun JsonObject.string(key: String): String? = (this[key] as? JsonPrimitive)?.contentOrNull

/**
 * Pure projection from a [WallConnectorSnapshot] to the render-ready [WallConnectorDisplay] — the native
 * port of the web component's `chartData` + month-rollup memos and its compact/standard stat selection.
 * Numbers format with [locale] (tests pin [Locale.US]); the kWh tiles carry the literal `kWh` unit the
 * web hard-codes, and the Sessions tile carries no unit (web omits it).
 */
object WallConnectorProjection {
    /** The fixed energy display unit shown on the kWh stat tiles (web hard-codes `unit: 'kWh'`). */
    const val KWH_UNIT: String = "kWh"

    /**
     * Project [snapshot] for [size] using the localized [strings], formatting numbers with [locale]. The
     * compact footprint emits only the This Month + Sessions tiles (web compact branch); the standard
     * footprint adds the Avg / Session tile. Stats are empty unless [WallConnectorSnapshot.hasData].
     */
    fun project(
        snapshot: WallConnectorSnapshot,
        size: WallConnectorSize,
        strings: WallConnectorStrings,
        locale: Locale = Locale.US,
    ): WallConnectorDisplay {
        val hasData = snapshot.hasData
        return WallConnectorDisplay(
            hasSites = snapshot.hasSites,
            hasData = hasData,
            isCompact = size.isCompact,
            isWide = size.isWide,
            days = snapshot.days,
            stats = if (hasData) stats(snapshot, size, strings, locale) else emptyList(),
            title = strings.title,
            energyLabel = strings.energy,
            noSiteMessage = strings.noSite,
            noDataMessage = strings.noData,
        )
    }

    private fun stats(
        snapshot: WallConnectorSnapshot,
        size: WallConnectorSize,
        strings: WallConnectorStrings,
        locale: Locale,
    ): List<WallConnectorStat> {
        val sessionsCount = snapshot.monthSessions.toDouble() // parity:allow Int count widened to Double for ChartFormat
        val items =
            mutableListOf(
                WallConnectorStat(strings.monthTotal, ChartFormat.number(snapshot.monthTotalKwh, ONE_DECIMAL, locale), KWH_UNIT),
                WallConnectorStat(strings.sessions, ChartFormat.number(sessionsCount, INT_DECIMALS, locale), null),
            )
        // Web compact branch shows This Month + Sessions; the standard branch appends Avg / Session.
        if (!size.isCompact) {
            items += WallConnectorStat(strings.avgPerSession, ChartFormat.number(snapshot.avgKwhPerSession, ONE_DECIMAL, locale), KWH_UNIT)
        }
        return items
    }
}
