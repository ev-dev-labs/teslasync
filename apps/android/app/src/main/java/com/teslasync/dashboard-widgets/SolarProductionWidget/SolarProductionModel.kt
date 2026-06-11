// Pure, framework-free model + projection for the Solar Production dashboard widget — the native
// analogue of everything the web component derives via `useMemo` before returning JSX
// (web/src/features/dashboard/widgets/SolarProductionWidget.tsx). No Compose, no Android, no HTTP:
// every type here is unit-tested off-device in the :android:testReleaseUnitTest gate, keeping the
// composable a thin render layer. The history feed arrives as raw SI JSON
// (`/tesla/energy-sites/{id}/energy-history?period=day`, daily solar energy in watt-hours), so this
// file owns the decode (web optional-chaining → null-safe reads) plus the Wh → kWh display scaling the
// web does inline (`solar_energy_wh / 1000`). Daily solar energy is a routing readout, not a stored
// unit-suffixed field carrying a user unit preference, so no Phase-48 unit-preference conversion
// applies — the kWh scaling mirrors the web verbatim.
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/dashboard-widgets/SolarProductionWidget — the P3 prompt's allowed-files path) cannot
// form a valid Kotlin package (a hyphen and a PascalCase segment are illegal in a package identifier),
// so the package intentionally diverges from the path. `MatchingDeclarationName` is suppressed for the
// co-located supporting types.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.dashboard.widgets.solarproduction

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
import java.time.ZoneId
import java.time.ZoneOffset
import java.util.Locale

/** Watt-hours per kilowatt-hour — the web `solar_energy_wh / 1000` display scaling. */
private const val WH_PER_KWH = 1000.0

/** The number of leading characters of an ISO timestamp that form its `YYYY-MM-DD` date key. */
private const val DATE_KEY_LENGTH = 10

/** Today / Daily-Avg fraction digits (web `fmtNumber(.., 1)`). */
private const val ONE_DECIMAL = 1

/** 30-Day Total fraction digits (web `fmtInt` ⇒ 0). */
private const val INT_DECIMALS = 0

/**
 * The widget's grid footprint (columns × rows). Mirrors the web `WidgetProps.size` plus the `isCompact`
 * / `isWide` logic in the web source: compact (Today + Daily Avg only, no chart/title) is a single
 * column or fewer (web `size.cols <= 1`); wide (wider axis ticks) is three or more columns (web
 * `size.cols >= 3`).
 */
data class SolarProductionSize(
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
 * web/src/features/dashboard/widgets/registry/energy.ts (`solar-production`). A dashboard grid host
 * binds this surface with the same [ID] and honours the same min/max footprint, so the native + web
 * grids stay in lockstep.
 */
object SolarProductionRegistration {
    /** Stable registry id (matches the web registry). */
    const val ID = "solar-production"

    /** Widget category (matches the web registry). */
    const val CATEGORY = "energy"

    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). */
    const val SLUG = "SolarProductionWidget"

    /** The history window the feed requests, in days (web `since = today − 30 days`). */
    const val WINDOW_DAYS = 30L

    /** The history bucketing period the feed requests (web `useTeslaEnergyHistory(siteId, 'day', since)`). */
    const val PERIOD_DAY = "day"

    /** Default footprint: 2 columns × 4 rows (web `defaultSize`). */
    val defaultSize = SolarProductionSize(cols = 2, rows = 4)

    /** Minimum footprint: 1 column × 2 rows (web `minSize`). */
    val minSize = SolarProductionSize(cols = 1, rows = 2)

    /** Maximum footprint: 4 columns × 40 rows (web `maxSize`). */
    val maxSize = SolarProductionSize(cols = 4, rows = 40)

    /** True when [size] already lies within the inclusive min/max footprint (clamping is a no-op). */
    fun isWithinBounds(size: SolarProductionSize): Boolean = clamp(size) == size

    /** Clamp [size] into the supported min/max footprint. */
    fun clamp(size: SolarProductionSize): SolarProductionSize =
        SolarProductionSize(
            cols = size.cols.coerceIn(minSize.cols, maxSize.cols),
            rows = size.rows.coerceIn(minSize.rows, maxSize.rows),
        )

    /**
     * The `YYYY-MM-DD` start of the 30-day window — the native analogue of the web
     * `since = new Date(); since.setDate(getDate() - 30); since.toISOString().slice(0, 10)`. Resolved in
     * UTC (the web `toISOString()` reference frame) so the cache key + `since` query are deterministic.
     */
    fun windowStartDate(nowMillis: Long): String = utcDate(nowMillis).minusDays(WINDOW_DAYS).toString()

    /**
     * Today's `YYYY-MM-DD` key — the native analogue of the web
     * `todayKey = new Date().toISOString().slice(0, 10)`, used to pick out today's solar total from the
     * history rows by string-prefix match (web `(e.timestamp ?? '').slice(0, 10) === key`).
     */
    fun todayKey(nowMillis: Long): String = utcDate(nowMillis).toString()

    private fun utcDate(millis: Long): LocalDate = Instant.ofEpochMilli(millis).atZone(ZoneOffset.UTC).toLocalDate()
}

/**
 * One decoded history row reduced to the three fields the web chart + rollups read from each entry: the
 * raw `YYYY-MM-DD` [dateKey] (web `entry.timestamp.slice(0, 10)`, used for the today-match), the
 * localized x-axis [label] (web `shortDate(entry.timestamp)`), and the day's solar energy in [solarKwh]
 * (SI Wh ÷ 1000 — the web chart, tooltip, and rollups all read kWh).
 */
data class SolarDayPoint(
    val dateKey: String,
    val label: String,
    val solarKwh: Double,
)

/**
 * The combined two-feed snapshot the view-model projects — the native analogue of the web component's
 * `useTeslaEnergySites` + `useTeslaEnergyHistory` composition. [hasSites] mirrors the web
 * `(sites ?? []).length > 0` gate (drives the "No Tesla Energy site linked" surface); [days] is the
 * resolved 30-day history and [todayKwh] is today's solar total resolved by date-key match. Pure data so
 * the projection is unit-tested without a UI host.
 */
data class SolarProductionSnapshot(
    val hasSites: Boolean,
    val days: List<SolarDayPoint>,
    val todayKwh: Double,
) {
    /**
     * Web `hasData = chartData.length > 0 && chartData.some(d => d.solar_kwh > 0)` — drives the chart vs
     * "No solar data" empty gate inside a linked-site surface.
     */
    val hasData: Boolean get() = days.isNotEmpty() && days.any { it.solarKwh > 0.0 }

    companion object {
        /** The "nothing resolved" fallback (no site linked, no history). */
        val EMPTY = SolarProductionSnapshot(hasSites = false, days = emptyList(), todayKwh = 0.0)

        /** A resolved snapshot that found no linked Tesla Energy site (web `hasSites === false`). */
        val NO_SITES = SolarProductionSnapshot(hasSites = false, days = emptyList(), todayKwh = 0.0)

        /** A linked-site snapshot carrying its decoded 30-day history (possibly empty / all-zero) + today's kWh. */
        fun ofDays(
            days: List<SolarDayPoint>,
            todayKwh: Double,
        ): SolarProductionSnapshot = SolarProductionSnapshot(hasSites = true, days = days, todayKwh = todayKwh)
    }
}

/**
 * The first energy site's id resolved from the `/tesla/energy-sites` list — the native analogue of the
 * web `siteId = (sites ?? [])[0]?.energy_site_id`. [hasSites] mirrors the web length gate independently
 * of whether the first row carried a usable id.
 */
data class SolarProductionSitesSummary(
    val hasSites: Boolean,
    val firstSiteId: Long?,
)

/** One projected summary statistic for the header row — the native analogue of a web `ChartSummaryStat`. */
data class SolarProductionStat(
    val label: String,
    val value: String,
    val unit: String?,
)

/**
 * The localized strings the surface needs, resolved through the i18n facade (P1/S10) at the Compose
 * boundary and passed in so the projection stays framework-free and JVM-testable. They map to the
 * `widget.solarProduction.*` keys; [solar] names the chart series (web `Area name=…`) + tooltip label.
 */
data class SolarProductionStrings(
    val title: String,
    val noSite: String,
    val noData: String,
    val today: String,
    val avg: String,
    val total30d: String,
    val solar: String,
)

/**
 * The fully projected, render-ready view of the solar production for one footprint — the native analogue
 * of everything the web component computes via `useMemo` (the `chartData` map and the `todayKwh` /
 * `totalKwh` / `avgKwh` rollups) plus its compact/standard stat selection. Pure data (no Compose types)
 * so the projection is unit-tested without a UI host.
 */
data class SolarProductionDisplay(
    val hasSites: Boolean,
    val hasData: Boolean,
    val isCompact: Boolean,
    val isWide: Boolean,
    val days: List<SolarDayPoint>,
    val stats: List<SolarProductionStat>,
    val title: String,
    val solarLabel: String,
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
fun parseSolarSites(json: JsonElement?): SolarProductionSitesSummary {
    val array = json as? JsonArray ?: return SolarProductionSitesSummary(hasSites = false, firstSiteId = null)
    val firstSiteId = (array.firstOrNull() as? JsonObject)?.long("energy_site_id")
    return SolarProductionSitesSummary(hasSites = array.isNotEmpty(), firstSiteId = firstSiteId)
}

/**
 * Decodes the raw `/tesla/energy-sites/{id}/energy-history?period=day` [json] array into the kWh-scaled
 * [SolarDayPoint] list — the native port of the web `chartData` map. Each row keeps its raw `YYYY-MM-DD`
 * date key (web `entry.timestamp.slice(0, 10)`), an `M/d` label in [zone] (web `shortDate`), and its
 * `solar_energy_wh` read null-tolerantly and scaled to kWh (web `(entry.solar_energy_wh ?? 0) / 1000`). A
 * non-array input yields an empty list; non-object rows are skipped.
 */
fun parseSolarDays(
    json: JsonElement?,
    zone: ZoneId = ZoneId.systemDefault(),
): List<SolarDayPoint> {
    val array = json as? JsonArray ?: return emptyList()
    return array.mapNotNull { element ->
        val obj = element as? JsonObject ?: return@mapNotNull null
        val timestamp = obj.string("timestamp") ?: ""
        SolarDayPoint(
            dateKey = timestamp.take(DATE_KEY_LENGTH),
            label = shortDate(timestamp, zone),
            solarKwh = obj.double("solar_energy_wh") / WH_PER_KWH,
        )
    }
}

/**
 * Today's solar total in kWh — the native analogue of the web `todayKwh` memo: the [days] row whose raw
 * date key string-matches [todayKey] (web `(e.timestamp ?? '').slice(0, 10) === key`), else `0`.
 */
fun todayKwh(
    days: List<SolarDayPoint>,
    todayKey: String,
): Double = days.firstOrNull { it.dateKey == todayKey }?.solarKwh ?: 0.0

/**
 * Builds the [SolarProductionSnapshot] for a linked site from its decoded history [json], resolving
 * today's kWh against [todayKey] and labelling rows in [zone].
 */
fun solarSnapshotOf(
    json: JsonElement?,
    todayKey: String,
    zone: ZoneId = ZoneId.systemDefault(),
): SolarProductionSnapshot {
    val days = parseSolarDays(json, zone)
    return SolarProductionSnapshot.ofDays(days, todayKwh(days, todayKey))
}

private fun JsonObject.double(key: String): Double = (this[key] as? JsonPrimitive)?.doubleOrNull?.takeIf { it.isFinite() } ?: 0.0

private fun JsonObject.long(key: String): Long? = (this[key] as? JsonPrimitive)?.longOrNull

private fun JsonObject.string(key: String): String? = (this[key] as? JsonPrimitive)?.contentOrNull

/**
 * Pure projection from a [SolarProductionSnapshot] to the render-ready [SolarProductionDisplay] — the
 * native port of the web component's `chartData` + `todayKwh` / `totalKwh` / `avgKwh` memos and its
 * compact/standard stat selection. Numbers format with [locale] (tests pin [Locale.US]); the stat unit
 * is the literal `kWh` the web hard-codes on every tile.
 */
object SolarProductionProjection {
    /** The fixed energy display unit shown on every stat tile (web hard-codes `unit: 'kWh'`). */
    const val KWH_UNIT: String = "kWh"

    /**
     * Project [snapshot] for [size] using the localized [strings], formatting numbers with [locale]. The
     * compact footprint emits only the Today + Daily Avg tiles (web compact branch); the standard
     * footprint adds the 30-Day Total. Stats are empty unless [SolarProductionSnapshot.hasData].
     */
    fun project(
        snapshot: SolarProductionSnapshot,
        size: SolarProductionSize,
        strings: SolarProductionStrings,
        locale: Locale = Locale.US,
    ): SolarProductionDisplay {
        val hasData = snapshot.hasData
        return SolarProductionDisplay(
            hasSites = snapshot.hasSites,
            hasData = hasData,
            isCompact = size.isCompact,
            isWide = size.isWide,
            days = snapshot.days,
            stats = if (hasData) stats(snapshot, size, strings, locale) else emptyList(),
            title = strings.title,
            solarLabel = strings.solar,
            noSiteMessage = strings.noSite,
            noDataMessage = strings.noData,
        )
    }

    /** The 30-day solar total in kWh (web `totalKwh = chartData.reduce(sum)`). */
    fun totalKwh(days: List<SolarDayPoint>): Double = days.sumOf { it.solarKwh }

    /** The mean daily solar in kWh (web `avgKwh = chartData.length > 0 ? total / length : 0`). */
    fun avgKwh(days: List<SolarDayPoint>): Double = if (days.isEmpty()) 0.0 else totalKwh(days) / days.size

    private fun stats(
        snapshot: SolarProductionSnapshot,
        size: SolarProductionSize,
        strings: SolarProductionStrings,
        locale: Locale,
    ): List<SolarProductionStat> {
        val items =
            mutableListOf(
                SolarProductionStat(strings.today, ChartFormat.number(snapshot.todayKwh, ONE_DECIMAL, locale), KWH_UNIT),
            )
        // Web compact branch shows Today + Daily Avg; the standard branch inserts the 30-Day Total between them.
        if (!size.isCompact) {
            items += SolarProductionStat(strings.total30d, ChartFormat.number(totalKwh(snapshot.days), INT_DECIMALS, locale), KWH_UNIT)
        }
        items += SolarProductionStat(strings.avg, ChartFormat.number(avgKwh(snapshot.days), ONE_DECIMAL, locale), KWH_UNIT)
        return items
    }
}
