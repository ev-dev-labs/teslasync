// Pure, framework-free model + projection for the Power Flow History dashboard widget — the native
// analogue of everything the web component derives via `useMemo` before returning JSX
// (web/src/features/dashboard/widgets/PowerFlowHistoryWidget.tsx). No Compose, no Android, no HTTP:
// every type here is unit-tested off-device in the :android:testReleaseUnitTest gate, keeping the
// composable a thin render layer. The history feed arrives as raw SI JSON
// (`/tesla/energy-sites/{id}/live-status/history`, power in watts), so this file owns the decode (web
// optional-chaining → null-safe reads) plus the watts → kW display scaling the web does inline
// (`solar_power / 1000`). Power figures are routing readouts, not a stored unit-suffixed field, so no
// Phase-48 unit-preference conversion applies — the kW scaling mirrors the web verbatim.
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/dashboard-widgets/PowerFlowHistoryWidget — the P3 prompt's allowed-files path) cannot
// form a valid Kotlin package (a hyphen and a PascalCase segment are illegal in a package identifier),
// so the package intentionally diverges from the path. `MatchingDeclarationName` is suppressed for the
// co-located supporting types.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.dashboard.widgets.powerflowhistory

import io.teslasync.android.components.charts.ChartFormat
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.doubleOrNull
import kotlinx.serialization.json.longOrNull
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.util.Locale
import kotlin.math.max

/** Watts per kilowatt — the web `solar_power / 1000` display scaling. */
private const val WATTS_PER_KW = 1000.0

/** Milliseconds per hour — used to roll the 24-hour history window back from "now". */
private const val MILLIS_PER_HOUR = 3_600_000L

/** Stat / axis fraction digits (web `fmtNumber(.., 1)` / `fmt(v, 1)`). */
private const val VALUE_PRECISION = 1

/** Wall-clock HH:mm label pattern (web `shortTime` zero-pads hours + minutes). */
private const val TIME_PATTERN = "HH:mm"

/**
 * The widget's grid footprint (columns × rows). Mirrors the web `WidgetProps.size` plus the `isCompact`
 * / `isWide` logic in the web source: compact (stats-only, no chart/title) is a single column or fewer
 * (web `size.cols <= 1`); wide (wider axis ticks) is three or more columns (web `size.cols >= 3`).
 */
data class PowerFlowHistorySize(
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
 * web/src/features/dashboard/widgets/registry/energy.ts (`power-flow-history`). A dashboard grid host
 * binds this surface with the same [ID] and honours the same min/max footprint, so the native + web
 * grids stay in lockstep.
 */
object PowerFlowHistoryRegistration {
    /** Stable registry id (matches the web registry). */
    const val ID = "power-flow-history"

    /** Widget category (matches the web registry). */
    const val CATEGORY = "energy"

    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). */
    const val SLUG = "PowerFlowHistoryWidget"

    /** The history window the feed requests, in hours (web `since = now − 24h`). */
    const val SINCE_HOURS = 24

    /** Default footprint: 2 columns × 4 rows (web `defaultSize`). */
    val defaultSize = PowerFlowHistorySize(cols = 2, rows = 4)

    /** Minimum footprint: 2 columns × 4 rows (web `minSize`). */
    val minSize = PowerFlowHistorySize(cols = 2, rows = 4)

    /** Maximum footprint: 4 columns × 40 rows (web `maxSize`). */
    val maxSize = PowerFlowHistorySize(cols = 4, rows = 40)

    /** True when [size] already lies within the inclusive min/max footprint (clamping is a no-op). */
    fun isWithinBounds(size: PowerFlowHistorySize): Boolean = clamp(size) == size

    /** Clamp [size] into the supported min/max footprint. */
    fun clamp(size: PowerFlowHistorySize): PowerFlowHistorySize =
        PowerFlowHistorySize(
            cols = size.cols.coerceIn(minSize.cols, maxSize.cols),
            rows = size.rows.coerceIn(minSize.rows, maxSize.rows),
        )

    /**
     * The ISO-8601 instant 24 hours before [nowMillis] — the native analogue of the web
     * `since = new Date(); since.setHours(getHours() - 24); since.toISOString()` window start.
     */
    fun windowStartIso(nowMillis: Long): String = Instant.ofEpochMilli(nowMillis - SINCE_HOURS * MILLIS_PER_HOUR).toString()
}

/**
 * One decoded history row reduced to the five fields the web chart reads from each entry: the wall-clock
 * [timeLabel] (web `shortTime(entry.timestamp)`) and the four power channels converted from SI watts to
 * kW (web `solar_power / 1000`, …). The sign of [gridKw] / [batteryKw] carries direction exactly as the
 * web reads them; the stats + chart consume the signed kW value directly.
 */
data class PowerFlowSample(
    val timeLabel: String,
    val solarKw: Double,
    val batteryKw: Double,
    val gridKw: Double,
    val homeKw: Double,
) {
    /** True when any channel is non-zero — folds into the web `chartData.some(d => … !== 0)` data gate. */
    val isNonZero: Boolean
        get() = solarKw != 0.0 || batteryKw != 0.0 || gridKw != 0.0 || homeKw != 0.0
}

/**
 * The combined two-feed snapshot the view-model projects — the native analogue of the web component's
 * `useTeslaEnergySites` + `useTeslaEnergyLiveStatusHistory` composition. [hasSites] mirrors the web
 * `(sites ?? []).length > 0` gate (drives the "No Tesla Energy site linked" surface); [samples] is the
 * resolved 24-hour history. Pure data so the projection is unit-tested without a UI host.
 */
data class PowerFlowHistorySnapshot(
    val hasSites: Boolean,
    val samples: List<PowerFlowSample>,
) {
    /**
     * Web `hasData = chartData.length > 0 && chartData.some(d => solar/battery/grid/home !== 0)` — drives
     * the chart vs "No power flow data" empty gate inside a linked-site surface.
     */
    val hasData: Boolean get() = samples.isNotEmpty() && samples.any { it.isNonZero }

    companion object {
        /** The "nothing resolved" fallback (no site linked, no history). */
        val EMPTY = PowerFlowHistorySnapshot(hasSites = false, samples = emptyList())

        /** A resolved snapshot that found no linked Tesla Energy site (web `hasSites === false`). */
        val NO_SITES = PowerFlowHistorySnapshot(hasSites = false, samples = emptyList())

        /** A linked-site snapshot carrying its decoded 24-hour history (possibly empty / all-zero). */
        fun ofSamples(samples: List<PowerFlowSample>): PowerFlowHistorySnapshot =
            PowerFlowHistorySnapshot(hasSites = true, samples = samples)
    }
}

/**
 * The first energy site's id resolved from the `/tesla/energy-sites` list — the native analogue of the
 * web `siteId = (sites ?? [])[0]?.energy_site_id`. [hasSites] mirrors the web length gate independently
 * of whether the first row carried a usable id.
 */
data class PowerFlowSitesSummary(
    val hasSites: Boolean,
    val firstSiteId: Long?,
)

/** One projected summary statistic for the header row — the native analogue of a web `ChartSummaryStat`. */
data class PowerFlowHistoryStat(
    val label: String,
    val value: String,
    val unit: String?,
)

/**
 * The localized strings the surface needs, resolved through the i18n facade (P1/S10) at the Compose
 * boundary and passed in so the projection stays framework-free and JVM-testable. They map to the
 * `widget.powerFlowHistory.*` keys; the [solar]/[battery]/[grid]/[home] labels name the four chart
 * series (web `Area name=…`) and the legend.
 */
data class PowerFlowHistoryStrings(
    val title: String,
    val noSite: String,
    val noData: String,
    val avgSolar: String,
    val peakHome: String,
    val netGrid: String,
    val solar: String,
    val battery: String,
    val grid: String,
    val home: String,
)

/**
 * The fully projected, render-ready view of the power-flow history for one footprint — the native
 * analogue of everything the web component computes via `useMemo` (the `chartData` map and the
 * `avgSolar`/`peakHome`/`netGrid` rollups) before returning JSX. Pure data (no Compose types) so the
 * projection is unit-tested without a UI host.
 */
data class PowerFlowHistoryDisplay(
    val hasSites: Boolean,
    val hasData: Boolean,
    val isCompact: Boolean,
    val isWide: Boolean,
    val samples: List<PowerFlowSample>,
    val stats: List<PowerFlowHistoryStat>,
    val title: String,
    val solarLabel: String,
    val batteryLabel: String,
    val gridLabel: String,
    val homeLabel: String,
    val noSiteMessage: String,
    val noDataMessage: String,
)

/**
 * Formats an ISO-8601 [iso] timestamp as a zero-padded `HH:mm` wall-clock label in [zone] — the native
 * port of the web `shortTime`. An unparseable value returns the raw input (web returns `iso` when
 * `new Date(iso)` is `Invalid`).
 */
fun shortTime(
    iso: String,
    zone: ZoneId = ZoneId.systemDefault(),
): String =
    runCatching {
        DateTimeFormatter
            .ofPattern(TIME_PATTERN, Locale.US)
            .withZone(zone)
            .format(Instant.parse(iso))
    }.getOrNull() ?: iso

/**
 * The first site's `energy_site_id` from the energy-sites array (web `(sites ?? [])[0]?.energy_site_id`)
 * together with whether any site is linked (web `(sites ?? []).length > 0`). A non-array input, an empty
 * list, or a first row lacking the id all collapse to the matching no-site fields.
 */
fun parsePowerFlowSites(json: JsonElement?): PowerFlowSitesSummary {
    val array = json as? JsonArray ?: return PowerFlowSitesSummary(hasSites = false, firstSiteId = null)
    val firstSiteId = (array.firstOrNull() as? JsonObject)?.long("energy_site_id")
    return PowerFlowSitesSummary(hasSites = array.isNotEmpty(), firstSiteId = firstSiteId)
}

/**
 * Decodes the raw `/tesla/energy-sites/{id}/live-status/history` [json] array into the kW-scaled
 * [PowerFlowSample] list — the native port of the web `chartData` map. Each row's `timestamp` becomes a
 * `HH:mm` label in [zone] (web `shortTime`) and each SI watt power field is read null-tolerantly and
 * scaled to kW (web `(entry.x ?? 0) / 1000`). A non-array input yields an empty list; non-object rows
 * are skipped.
 */
fun parsePowerFlowSamples(
    json: JsonElement?,
    zone: ZoneId = ZoneId.systemDefault(),
): List<PowerFlowSample> {
    val array = json as? JsonArray ?: return emptyList()
    return array.mapNotNull { element ->
        val obj = element as? JsonObject ?: return@mapNotNull null
        PowerFlowSample(
            timeLabel = shortTime(obj.string("timestamp") ?: "", zone),
            solarKw = obj.double("solar_power") / WATTS_PER_KW,
            batteryKw = obj.double("battery_power") / WATTS_PER_KW,
            gridKw = obj.double("grid_power") / WATTS_PER_KW,
            homeKw = obj.double("load_power") / WATTS_PER_KW,
        )
    }
}

private fun JsonObject.double(key: String): Double = (this[key] as? JsonPrimitive)?.doubleOrNull?.takeIf { it.isFinite() } ?: 0.0

private fun JsonObject.long(key: String): Long? = (this[key] as? JsonPrimitive)?.longOrNull

private fun JsonObject.string(key: String): String? = (this[key] as? JsonPrimitive)?.contentOrNull

/**
 * Pure projection from a [PowerFlowHistorySnapshot] to the render-ready [PowerFlowHistoryDisplay] — the
 * native port of the web component's `chartData` + `avgSolarKw` / `peakHomeKw` / `netGridKwh` memos and
 * its compact/standard stat selection. Numbers format with [locale] (tests pin [Locale.US]); the stat
 * unit is the literal `kW` the web hard-codes on all three tiles.
 */
object PowerFlowHistoryProjection {
    /** The fixed kW display unit shown on every stat tile (web hard-codes `unit: 'kW'`). */
    const val KW_UNIT: String = "kW"

    /**
     * Project [snapshot] for [size] using the localized [strings], formatting numbers with [locale]. The
     * compact footprint emits only the Avg Solar + Peak Home tiles (web compact branch); the standard
     * footprint adds Net Grid. Stats are empty unless [PowerFlowHistorySnapshot.hasData].
     */
    fun project(
        snapshot: PowerFlowHistorySnapshot,
        size: PowerFlowHistorySize,
        strings: PowerFlowHistoryStrings,
        locale: Locale = Locale.US,
    ): PowerFlowHistoryDisplay {
        val samples = snapshot.samples
        val hasData = snapshot.hasData
        return PowerFlowHistoryDisplay(
            hasSites = snapshot.hasSites,
            hasData = hasData,
            isCompact = size.isCompact,
            isWide = size.isWide,
            samples = samples,
            stats = if (hasData) stats(samples, size, strings, locale) else emptyList(),
            title = strings.title,
            solarLabel = strings.solar,
            batteryLabel = strings.battery,
            gridLabel = strings.grid,
            homeLabel = strings.home,
            noSiteMessage = strings.noSite,
            noDataMessage = strings.noData,
        )
    }

    /** Mean solar kW over the window (web `avgSolarKw`); `0` for an empty window. */
    fun avgSolarKw(samples: List<PowerFlowSample>): Double = if (samples.isEmpty()) 0.0 else samples.sumOf { it.solarKw } / samples.size

    /** Peak home kW over the window, floored at 0 (web `reduce((mx, d) => Math.max(mx, d.home), 0)`). */
    fun peakHomeKw(samples: List<PowerFlowSample>): Double = samples.fold(0.0) { mx, sample -> max(mx, sample.homeKw) }

    /** Net grid kW over the window — the signed sum of every row (web `netGridKwh`). */
    fun netGridKw(samples: List<PowerFlowSample>): Double = samples.sumOf { it.gridKw }

    private fun stats(
        samples: List<PowerFlowSample>,
        size: PowerFlowHistorySize,
        strings: PowerFlowHistoryStrings,
        locale: Locale,
    ): List<PowerFlowHistoryStat> {
        val items =
            mutableListOf(
                PowerFlowHistoryStat(strings.avgSolar, format(avgSolarKw(samples), locale), KW_UNIT),
                PowerFlowHistoryStat(strings.peakHome, format(peakHomeKw(samples), locale), KW_UNIT),
            )
        // Web compact branch shows only Avg Solar + Peak Home; the standard branch adds Net Grid.
        if (!size.isCompact) {
            items += PowerFlowHistoryStat(strings.netGrid, format(netGridKw(samples), locale), KW_UNIT)
        }
        return items
    }

    private fun format(
        value: Double,
        locale: Locale,
    ): String = ChartFormat.number(value, VALUE_PRECISION, locale)
}
