// Pure, framework-free model + projection for the Live Power Flow dashboard widget — the native
// analogue of everything the web component derives via `useMemo` before returning JSX
// (web/src/features/dashboard/widgets/LivePowerFlowWidget.tsx). No Compose, no Android, no HTTP: every
// type here is unit-tested off-device in the :app:testReleaseUnitTest gate, keeping the composable a
// thin render layer. The live-status feed arrives as raw SI JSON
// (`/tesla/energy-sites/{id}/live-status`, power in watts), so this file owns the decode (web
// optional-chaining → null-safe reads) plus the watts → kW display scaling the web does inline
// (`solar_power / 1000`). Power figures are routing readouts, not a stored unit-suffixed field, so no
// Phase-48 unit-preference conversion applies — the kW scaling mirrors the web verbatim.
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/dashboard-widgets/LivePowerFlowWidget — the P3 prompt's allowed-files path) cannot form
// a valid Kotlin package (a hyphen and a PascalCase segment are illegal in a package identifier), so the
// package intentionally diverges from the path. `MatchingDeclarationName` is suppressed for the
// co-located supporting types.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.dashboard.widgets.livepowerflow

import io.teslasync.android.components.datadisplay.FreshnessAge
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.doubleOrNull
import kotlinx.serialization.json.longOrNull
import java.util.Locale
import kotlin.math.abs
import kotlin.math.min

private const val KW_SUFFIX = " kW"
private const val SPACE = " "

/** Watts per kilowatt — the web `solar_power / 1000` display scaling. */
private const val WATTS_PER_KW = 1000.0

/**
 * The widget's grid footprint (columns × rows). Mirrors the web `WidgetProps.size` plus the `isCompact`
 * rule in the web source (`size.cols <= 1`), which routes the shared flow diagram into its compact
 * presentation (smaller nodes, abbreviated labels, top-three arrows).
 */
data class LivePowerFlowSize(
    val cols: Int,
    val rows: Int,
) {
    /** True at a single column or fewer (web `isCompact = size.cols <= 1`). */
    val isCompact: Boolean get() = cols <= COMPACT_MAX_COLS

    private companion object {
        const val COMPACT_MAX_COLS = 1
    }
}

/**
 * Canonical registry metadata for this surface — the native mirror of the web registry entry in
 * web/src/features/dashboard/widgets/registry/energy.ts (`live-power-flow`). A dashboard grid host binds
 * this surface with the same [ID] and honours the same min/max footprint, so the native + web grids stay
 * in lockstep.
 */
object LivePowerFlowRegistration {
    /** Stable registry id (matches the web registry). */
    const val ID = "live-power-flow"

    /** Widget category (matches the web registry). */
    const val CATEGORY = "energy"

    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). */
    const val SLUG = "LivePowerFlowWidget"

    /** Default footprint: 2 columns × 4 rows (web `defaultSize`). */
    val defaultSize = LivePowerFlowSize(cols = 2, rows = 4)

    /** Minimum footprint: 2 columns × 4 rows (web `minSize`). */
    val minSize = LivePowerFlowSize(cols = 2, rows = 4)

    /** Maximum footprint: 4 columns × 40 rows (web `maxSize`). */
    val maxSize = LivePowerFlowSize(cols = 4, rows = 40)

    /** True when [size] already lies within the inclusive min/max footprint (clamping is a no-op). */
    fun isWithinBounds(size: LivePowerFlowSize): Boolean = clamp(size) == size

    /** Clamp [size] into the supported min/max footprint. */
    fun clamp(size: LivePowerFlowSize): LivePowerFlowSize =
        LivePowerFlowSize(
            cols = size.cols.coerceIn(minSize.cols, maxSize.cols),
            rows = size.rows.coerceIn(minSize.rows, maxSize.rows),
        )
}

/** Glyph family for a flow node; mapped to a concrete `ImageVector` at the render boundary. */
enum class PowerFlowGlyph { Solar, Grid, Home, Battery }

/** Anchor position of a flow node; mapped to a fractional coordinate at the render boundary. */
enum class PowerFlowPosition { Top, Bottom, Left, Right, Center }

/**
 * Semantic flow color, decoupled from the chart-token names so the render boundary can map each to the
 * nearest design-token hue: Solar (web `text-yellow-400`), Grid (web `text-blue-400`), Home (web
 * `text-emerald-400`), Battery (web `text-purple-400`).
 */
enum class PowerFlowTint { Solar, Grid, Home, Battery, Neutral }

/**
 * One node of the flow diagram — the native counterpart of the web `FlowNode`. [value] is the numeric
 * readout the animated badge counts up to (web renders `AnimatedNumber value={node.value} decimals={1}`),
 * [formattedValue] is the unit-bearing string folded into the [contentDescription] for TalkBack.
 */
data class PowerFlowNode(
    val id: String,
    val label: String,
    val value: Double,
    val formattedValue: String,
    val glyph: PowerFlowGlyph,
    val position: PowerFlowPosition,
    val contentDescription: String,
)

/**
 * One directed flow between two nodes — the native counterpart of the web `FlowArrow`. [active] drives
 * the animated dash (web `strokeDasharray` + `dashFlow`), [magnitude] scales the stroke width.
 */
data class PowerFlowArrow(
    val fromId: String,
    val toId: String,
    val magnitude: Double,
    val active: Boolean,
    val tint: PowerFlowTint,
)

/**
 * The decoded `/tesla/energy-sites/{id}/live-status` power-flow snapshot — the native analogue of the
 * fields the web component reads from `liveStatus` (`solar_power`, `battery_power`, `grid_power`,
 * `load_power`). All four are SI watts on the wire; a missing/JSON-null field collapses to zero, exactly
 * like the web `liveStatus?.solar_power ?? 0`. The sign of [batteryW] / [gridW] carries direction
 * (battery charging > 0 / discharging < 0; grid importing > 0 / exporting < 0), exactly as the web reads
 * them.
 */
data class LivePowerStatus(
    val solarW: Double,
    val batteryW: Double,
    val gridW: Double,
    val homeW: Double,
)

/**
 * The combined two-feed snapshot the view-model projects — the native analogue of the web component's
 * `useTeslaEnergySites` + `useTeslaEnergyLiveStatus` composition. [hasSites] mirrors the web
 * `(sites ?? []).length > 0` gate (drives the "No Tesla Energy site linked" surface); [status] is the
 * resolved live-status body (`null` models `liveStatus` being undefined, i.e. the "No live power data"
 * surface). Pure data so the projection is unit-tested without a UI host.
 */
data class LivePowerFlowSnapshot(
    val hasSites: Boolean,
    val status: LivePowerStatus?,
) {
    /** Web `hasData = liveStatus != null` — drives the flow-diagram empty gate. */
    val hasData: Boolean get() = status != null

    companion object {
        /** The "nothing resolved" fallback (no site linked, no live status). */
        val EMPTY = LivePowerFlowSnapshot(hasSites = false, status = null)

        /** A resolved snapshot that found no linked Tesla Energy site (web `hasSites === false`). */
        val NO_SITES = LivePowerFlowSnapshot(hasSites = false, status = null)

        /** A linked-site snapshot whose live-status body has not resolved (web `liveStatus` undefined). */
        val SITE_WITHOUT_STATUS = LivePowerFlowSnapshot(hasSites = true, status = null)
    }
}

/**
 * The first energy site's id resolved from the `/tesla/energy-sites` list — the native analogue of the
 * web `siteId = (sites ?? [])[0]?.energy_site_id`. [hasSites] mirrors the web length gate independently
 * of whether the first row carried a usable id.
 */
data class EnergySitesSummary(
    val hasSites: Boolean,
    val firstSiteId: Long?,
)

/**
 * Localized labels + the relative-time formatter the surface folds into its output. The pure
 * [LivePowerFlowProjection] reads the node labels + empty messages; the composable chrome additionally
 * reads [title] / [refreshLabel] / [refreshingLabel] / [offlineLabel] / [formatRelative]. Keeping i18n
 * out of the projection lets it stay a pure, locale-stable function.
 */
data class LivePowerFlowStrings(
    val title: String,
    val noSite: String,
    val noData: String,
    val solar: String,
    val grid: String,
    val home: String,
    val battery: String,
    val refreshLabel: String,
    val refreshingLabel: String,
    val offlineLabel: String,
    val formatRelative: (FreshnessAge) -> String,
)

/**
 * The fully projected, render-ready view of the live power flow for one footprint — the native analogue
 * of everything the web component computes before returning JSX (the `nodes`/`arrows` memos plus the
 * `hasSites` / `hasData` gates). Pure data (no Compose types) so the projection is unit-tested without a
 * UI host. [nodes] / [arrows] are empty whenever [hasData] is false (web returns `[]`).
 */
data class LivePowerFlowDisplay(
    val hasSites: Boolean,
    val hasData: Boolean,
    val isCompact: Boolean,
    val nodes: List<PowerFlowNode>,
    val arrows: List<PowerFlowArrow>,
    val title: String,
    val noSiteMessage: String,
    val noDataMessage: String,
)

/**
 * Decodes the raw `/tesla/energy-sites/{id}/live-status` [json] into a [LivePowerStatus]. A non-object
 * input or an empty object (the view-model's no-status sentinel) yields `null`, reproducing the web
 * `hasData = liveStatus != null` gate; otherwise every power field is read null-tolerantly and a
 * missing/JSON-null/non-finite value collapses to zero (web `liveStatus?.x ?? 0`).
 */
fun parseLiveStatus(json: JsonElement?): LivePowerStatus? {
    val obj = (json as? JsonObject)?.takeIf { it.isNotEmpty() } ?: return null
    return LivePowerStatus(
        solarW = obj.double("solar_power"),
        batteryW = obj.double("battery_power"),
        gridW = obj.double("grid_power"),
        homeW = obj.double("load_power"),
    )
}

/**
 * The first site's `energy_site_id` from the energy-sites array (web `(sites ?? [])[0]?.energy_site_id`)
 * together with whether any site is linked (web `(sites ?? []).length > 0`). A non-array input, an empty
 * list, or a first row lacking the id all collapse to the matching no-site fields.
 */
fun parseEnergySites(json: JsonElement?): EnergySitesSummary {
    val array = json as? JsonArray ?: return EnergySitesSummary(hasSites = false, firstSiteId = null)
    val hasSites = array.isNotEmpty()
    val firstSiteId = (array.firstOrNull() as? JsonObject)?.long("energy_site_id")
    return EnergySitesSummary(hasSites = hasSites, firstSiteId = firstSiteId)
}

private fun JsonObject.double(key: String): Double = (this[key] as? JsonPrimitive)?.doubleOrNull?.takeIf { it.isFinite() } ?: 0.0

private fun JsonObject.long(key: String): Long? = (this[key] as? JsonPrimitive)?.longOrNull

/**
 * Pure projection from a [LivePowerFlowSnapshot] to the render-ready [LivePowerFlowDisplay] — the native
 * port of the web component's `nodes` + `arrows` memos. Watts are scaled to kW exactly as the web does
 * (`/ 1000`); node readouts use the absolute kW value (web `Math.abs(...)`); arrow direction + activation
 * follow the web's sign tests verbatim. Pure + locale-stable, so it is unit-tested without a UI host.
 */
object LivePowerFlowProjection {
    /** Node readout fraction digits (web `AnimatedNumber decimals={1}` / `fmtNumber(.., 1)`). */
    const val VALUE_PRECISION = 1

    /** Solar→home activation threshold (web `active: solarKw > 0.01`). */
    const val SOLAR_ACTIVE_THRESHOLD = 0.01

    /** Stable node identifiers (match the web `FlowNode.id`s). */
    const val NODE_SOLAR = "solar"
    const val NODE_GRID = "grid"
    const val NODE_HOME = "home"
    const val NODE_BATTERY = "battery"

    /** Project [snapshot] for [size] using the localized [strings]. */
    fun project(
        snapshot: LivePowerFlowSnapshot,
        size: LivePowerFlowSize,
        strings: LivePowerFlowStrings,
    ): LivePowerFlowDisplay {
        val status = snapshot.status
        return LivePowerFlowDisplay(
            hasSites = snapshot.hasSites,
            hasData = status != null,
            isCompact = size.isCompact,
            nodes = status?.let { nodes(it, strings) } ?: emptyList(),
            arrows = status?.let { arrows(it) } ?: emptyList(),
            title = strings.title,
            noSiteMessage = strings.noSite,
            noDataMessage = strings.noData,
        )
    }

    private fun nodes(
        status: LivePowerStatus,
        strings: LivePowerFlowStrings,
    ): List<PowerFlowNode> {
        val solarKw = abs(safe(status.solarW) / WATTS_PER_KW)
        val gridKw = abs(safe(status.gridW) / WATTS_PER_KW)
        val homeKw = abs(safe(status.homeW) / WATTS_PER_KW)
        val batteryKw = abs(safe(status.batteryW) / WATTS_PER_KW)
        return listOf(
            node(NODE_SOLAR, strings.solar, solarKw, PowerFlowGlyph.Solar, PowerFlowPosition.Top),
            node(NODE_GRID, strings.grid, gridKw, PowerFlowGlyph.Grid, PowerFlowPosition.Left),
            node(NODE_HOME, strings.home, homeKw, PowerFlowGlyph.Home, PowerFlowPosition.Right),
            node(NODE_BATTERY, strings.battery, batteryKw, PowerFlowGlyph.Battery, PowerFlowPosition.Bottom),
        )
    }

    /**
     * The directed flows pushed by the web component, in the same order and under the same sign tests:
     * solar→home (producing), solar→battery (excess charging), battery→home (discharging, `batteryW < 0`),
     * grid→home (importing, `gridW > 0`), home→grid (exporting, `gridW < 0`), grid→battery (charging from
     * grid, `batteryW > 0 && solarKw <= 0`). Only flows that meet their condition are emitted.
     */
    private fun arrows(status: LivePowerStatus): List<PowerFlowArrow> {
        val solarW = safe(status.solarW)
        val batteryW = safe(status.batteryW)
        val gridW = safe(status.gridW)
        val solarKw = solarW / WATTS_PER_KW
        val gridKw = gridW / WATTS_PER_KW
        val batteryKw = batteryW / WATTS_PER_KW
        return buildList {
            if (solarKw > 0) {
                add(PowerFlowArrow(NODE_SOLAR, NODE_HOME, solarKw, solarKw > SOLAR_ACTIVE_THRESHOLD, PowerFlowTint.Solar))
            }
            if (solarKw > 0 && batteryW > 0) {
                add(PowerFlowArrow(NODE_SOLAR, NODE_BATTERY, min(solarKw, abs(batteryKw)), true, PowerFlowTint.Solar))
            }
            if (batteryW < 0) {
                add(PowerFlowArrow(NODE_BATTERY, NODE_HOME, abs(batteryKw), true, PowerFlowTint.Battery))
            }
            if (gridW > 0) {
                add(PowerFlowArrow(NODE_GRID, NODE_HOME, gridKw, true, PowerFlowTint.Grid))
            }
            if (gridW < 0) {
                add(PowerFlowArrow(NODE_HOME, NODE_GRID, abs(gridKw), true, PowerFlowTint.Home))
            }
            if (batteryW > 0 && solarKw <= 0) {
                add(PowerFlowArrow(NODE_GRID, NODE_BATTERY, abs(batteryKw), true, PowerFlowTint.Grid))
            }
        }
    }

    private fun node(
        id: String,
        label: String,
        valueKw: Double,
        glyph: PowerFlowGlyph,
        position: PowerFlowPosition,
    ): PowerFlowNode {
        val formatted = kw(valueKw)
        return PowerFlowNode(id, label, valueKw, formatted, glyph, position, "$label$SPACE$formatted")
    }

    /** Format a kW figure exactly as the web node (`${fmtNumber(Math.abs(value), 1)} kW`). */
    fun kw(value: Double): String = "${formatNumber(abs(safe(value)), VALUE_PRECISION)}$KW_SUFFIX"

    /**
     * Locale-stable decimal formatter (web `fmtNumber`): en-US grouping + fixed fraction digits with
     * round-half-up, matching `Intl.NumberFormat` / the shared `ChartFormat.number` the animated readout
     * uses, so the projected strings are deterministic regardless of device locale.
     */
    fun formatNumber(
        value: Double,
        decimals: Int,
    ): String = String.format(Locale.US, "%,.${decimals}f", safe(value))

    private fun safe(value: Double): Double = if (value.isFinite()) value else 0.0
}
