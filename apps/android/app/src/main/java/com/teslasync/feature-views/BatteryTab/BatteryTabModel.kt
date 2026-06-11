// Pure, framework-free model + projection for the Battery analytics feature view — the native analogue of
// everything the web component derives before returning JSX
// (web/src/features/analytics/components/analytics/BatteryTab.tsx). No Compose, no Android, no HTTP: every
// declaration here is unit-tested off-device in the :app:testReleaseUnitTest gate, keeping the composable a
// thin render layer.
//
// The web component is purely presentational — its parent (the Analytics page) loads the `FleetAnalytics`
// document and passes it down; BatteryTab reads `data?.battery_trend ?? []` and renders the latest-point
// metric cards plus four trend charts. This file owns the parts the web derives from that prop: the parsed
// trend rows, the five latest-point metric-card strings (web `fmtNumber`/`fmtInt`/`formatEnergy` over
// `safe(...)`), the per-chart plotted value series + x-axis labels (web `date.slice(5)`), and the accessible
// fallback table rows. Values stay SI on the wire; the SI -> display conversion happens here through the
// injected [UnitFormatter] (the web `useUnits` boundary), never by mutating the source.
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/feature-views/BatteryTab — the P3 prompt's allowed-files path) cannot form a valid Kotlin
// package (a hyphen and a PascalCase segment are illegal in a package identifier), so the package
// intentionally diverges from the path — exactly as the sibling feature-view surfaces do.
// `MatchingDeclarationName` is suppressed for the co-located supporting declarations.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.batterytab

import io.teslasync.android.components.charts.ChartFormat
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import io.teslasync.android.data.UnitFormatter
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.units.convertDistanceFromSI
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.doubleOrNull
import java.util.Locale

/** Em dash shown wherever a value is unknown — the web `fmtNumber`/`'—'` empty marker. */
internal const val BATTERY_EM_DASH: String = "\u2014"

/** The percent sign appended to the Health Score / Degradation cards (web `subtitle="%"`). */
internal const val BATTERY_PERCENT: String = "%"

/** Card-value precision constants, mirroring the web `fmtNumber(..., n)` / `fmtInt` calls verbatim. */
internal const val HEALTH_DECIMALS: Int = 1
internal const val CAPACITY_DECIMALS: Int = 1
internal const val DEGRADATION_DECIMALS: Int = 2
internal const val RANGE_DECIMALS: Int = 0
internal const val CYCLE_DECIMALS: Int = 0

/** Meters per kilometre — the web `fromKm` helper multiplies SI km by 1000 before converting. */
internal const val METERS_PER_KM: Double = 1000.0

/** Diagnostics + registry identifiers for the surface (P1/S11). */
object BatteryTabRegistration {
    /** Stable surface id. */
    const val ID: String = "battery-tab"

    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). */
    const val SLUG: String = "BatteryTab"
}

/**
 * One battery-trend sample — the native mirror of the web `battery_trend[]` element
 * (`{ date, health_score, capacity_wh, degradation_pct, range_km, cycle_count }`). Numeric fields are
 * nullable so a sparse row never throws and the line charts can draw a gap across a missing sample (the
 * Android counterpart of Recharts `connectNulls`); the metric cards coerce missing values to `0` via
 * [safeValue], reproducing the web `safe(...)` guard. [capacityWh] and [rangeKm] are SI (watt-hours,
 * kilometres); conversion to the user's unit is the projection's job, never this type's.
 */
data class BatteryTrendPoint(
    val date: String,
    val healthScore: Double?,
    val capacityWh: Double?,
    val degradationPct: Double?,
    val rangeKm: Double?,
    val cycleCount: Double?,
)

/**
 * The already-localized microcopy the composable reads from the i18n catalog (P1/S10) — every `t(...)` key
 * the web component resolves. The lifecycle-chrome strings (empty / error / retry / offline / freshness /
 * table headers) are resolved inline at the Compose boundary, so this holder stays a thin content carrier.
 */
data class BatteryTabStrings(
    val healthScore: String,
    val capacity: String,
    val degradation: String,
    val estRange: String,
    val cycles: String,
    val healthTimeline: String,
    val capacityTrend: String,
    val rangeTrend: String,
    val degradationCycles: String,
    val healthSeries: String,
    val rangeSeries: String,
    val degradPct: String,
    val cycleCount: String,
)

/**
 * The fully projected, render-ready view of the battery trend — the native analogue of everything the web
 * component computes before returning JSX: the five latest-point metric-card values, the four chart value
 * series + shared x-axis labels, the resolved distance-unit label, and the accessible fallback table rows.
 * Pure data (no Compose types) so the projection is unit-tested without a UI host.
 */
data class BatteryTabDisplay(
    val isEmpty: Boolean,
    val healthScoreValue: String,
    val capacityValue: String,
    val degradationValue: String,
    val estRangeValue: String,
    val cyclesValue: String,
    val distanceUnit: String,
    val xLabels: List<String>,
    val healthValues: List<Double?>,
    val capacityValues: List<Double?>,
    val rangeValues: List<Double?>,
    val degradationValues: List<Double?>,
    val cycleValues: List<Double?>,
    val healthTable: List<List<String>>,
    val capacityTable: List<List<String>>,
    val rangeTable: List<List<String>>,
    val degradationCyclesTable: List<List<String>>,
)

/**
 * Coerces a possibly-missing/non-finite number to a finite value — the native mirror of the web `safe(...)`
 * chart helper (`Number.isFinite(v) ? v : 0`). Used for the metric-card values so a null field renders as
 * `0` rather than blanking the card, exactly as the web does.
 */
internal fun safeValue(value: Double?): Double = if (value != null && value.isFinite()) value else 0.0

/**
 * Drops the leading `YYYY-` from an ISO date to the web's `MM-DD` axis tick (web `tickFormatter={(v) =>
 * v.slice(5)}`). Inputs shorter than the prefix are returned unchanged, mirroring JavaScript `slice`.
 */
internal fun sliceDateLabel(date: String): String = if (date.length > 5) date.substring(5) else date

/**
 * Parses the `FleetAnalytics` document's `battery_trend` array — the native mirror of the web
 * `data?.battery_trend ?? []`. Tolerant of the raw snake_case the shared repo serves and of the
 * camelCased dual-shape the web client can emit (`camelCaseKeys`), and null-tolerant per field so a partial
 * row never throws. A non-object document, a missing array, or a JSON-null collapses to an empty list,
 * reproducing JavaScript optional chaining.
 */
object BatteryTrend {
    fun parse(analytics: JsonElement?): List<BatteryTrendPoint> {
        val obj = analytics as? JsonObject
        val array = (obj?.get(KEY_TREND_SNAKE) as? JsonArray) ?: (obj?.get(KEY_TREND_CAMEL) as? JsonArray)
        return array?.mapNotNull { element -> (element as? JsonObject)?.toPoint() } ?: emptyList()
    }

    private fun JsonObject.toPoint(): BatteryTrendPoint =
        BatteryTrendPoint(
            date = stringAt(KEY_DATE) ?: "",
            healthScore = doubleAt(KEY_HEALTH_SNAKE, KEY_HEALTH_CAMEL),
            capacityWh = doubleAt(KEY_CAPACITY_SNAKE, KEY_CAPACITY_CAMEL),
            degradationPct = doubleAt(KEY_DEGRADATION_SNAKE, KEY_DEGRADATION_CAMEL),
            rangeKm = doubleAt(KEY_RANGE_SNAKE, KEY_RANGE_CAMEL),
            cycleCount = doubleAt(KEY_CYCLE_SNAKE, KEY_CYCLE_CAMEL),
        )

    private fun JsonObject.doubleAt(
        snake: String,
        camel: String,
    ): Double? = (this[snake] as? JsonPrimitive)?.doubleOrNull ?: (this[camel] as? JsonPrimitive)?.doubleOrNull

    private fun JsonObject.stringAt(key: String): String? = (this[key] as? JsonPrimitive)?.takeIf { it.isString }?.content

    private const val KEY_TREND_SNAKE = "battery_trend"
    private const val KEY_TREND_CAMEL = "batteryTrend"
    private const val KEY_DATE = "date"
    private const val KEY_HEALTH_SNAKE = "health_score"
    private const val KEY_HEALTH_CAMEL = "healthScore"
    private const val KEY_CAPACITY_SNAKE = "capacity_wh"
    private const val KEY_CAPACITY_CAMEL = "capacityWh"
    private const val KEY_DEGRADATION_SNAKE = "degradation_pct"
    private const val KEY_DEGRADATION_CAMEL = "degradationPct"
    private const val KEY_RANGE_SNAKE = "range_km"
    private const val KEY_RANGE_CAMEL = "rangeKm"
    private const val KEY_CYCLE_SNAKE = "cycle_count"
    private const val KEY_CYCLE_CAMEL = "cycleCount"
}

/**
 * The pure projection the composable renders — the native mirror of the web component's derivations.
 * Stateless and side-effect-free so it is fully covered by the off-device unit gate. The SI -> display
 * conversion uses the injected [UnitFormatter] (the web `useUnits` boundary): energy through
 * `formatEnergy`, distance through the shared `convertDistanceFromSI`, both keyed by the user's
 * [io.teslasync.shared.core.units.UnitPref].
 */
object BatteryTabProjection {
    /**
     * Projects [trend] for the live [formatter] into the render-ready [BatteryTabDisplay], reproducing the
     * web component's `latest` metric cards plus the four chart series + accessible tables. The metric
     * cards read the last sample (web `trend[trend.length - 1]`) through [safeValue]; the charts plot the
     * raw SI values (capacity) or the converted display value (range) over every sample in source order.
     */
    fun project(
        trend: List<BatteryTrendPoint>,
        formatter: UnitFormatter,
        locale: Locale = Locale.getDefault(),
    ): BatteryTabDisplay {
        val distanceUnit = formatter.prefs.distance.label
        val latest = trend.lastOrNull()
        val toRangeDisplay = { km: Double -> convertDistanceFromSI(km * METERS_PER_KM, formatter.prefs.distance) }

        return BatteryTabDisplay(
            isEmpty = trend.isEmpty(),
            healthScoreValue = cardNumber(latest?.healthScore, HEALTH_DECIMALS, locale, latest != null),
            capacityValue = cardEnergy(latest?.capacityWh, formatter, latest != null),
            degradationValue = cardNumber(latest?.degradationPct, DEGRADATION_DECIMALS, locale, latest != null),
            estRangeValue = cardRange(latest?.rangeKm, toRangeDisplay, locale, latest != null),
            cyclesValue = cardNumber(latest?.cycleCount, CYCLE_DECIMALS, locale, latest != null),
            distanceUnit = distanceUnit,
            xLabels = trend.map { sliceDateLabel(it.date) },
            healthValues = trend.map { it.healthScore },
            capacityValues = trend.map { it.capacityWh },
            rangeValues = trend.map { point -> point.rangeKm?.let(toRangeDisplay) },
            degradationValues = trend.map { it.degradationPct },
            cycleValues = trend.map { it.cycleCount },
            healthTable = trend.map { listOf(it.date, ChartFormat.number(it.healthScore, HEALTH_DECIMALS, locale)) },
            capacityTable = trend.map { listOf(it.date, formatter.energy(it.capacityWh, CAPACITY_DECIMALS)) },
            rangeTable =
                trend.map { point ->
                    listOf(point.date, ChartFormat.number(point.rangeKm?.let(toRangeDisplay), RANGE_DECIMALS, locale))
                },
            degradationCyclesTable =
                trend.map { point ->
                    listOf(
                        point.date,
                        ChartFormat.number(point.degradationPct, DEGRADATION_DECIMALS, locale),
                        ChartFormat.number(point.cycleCount, CYCLE_DECIMALS, locale),
                    )
                },
        )
    }

    /** A latest-point numeric card value (web `latest ? fmtNumber(safe(x), n) : '—'`). */
    private fun cardNumber(
        value: Double?,
        decimals: Int,
        locale: Locale,
        hasLatest: Boolean,
    ): String = if (!hasLatest) BATTERY_EM_DASH else ChartFormat.number(safeValue(value), decimals, locale)

    /** The capacity card value (web `latest ? formatEnergy(safe(capacity_wh), {precision:1}) : '—'`). */
    private fun cardEnergy(
        wattHours: Double?,
        formatter: UnitFormatter,
        hasLatest: Boolean,
    ): String = if (!hasLatest) BATTERY_EM_DASH else formatter.energy(safeValue(wattHours), CAPACITY_DECIMALS)

    /** The estimated-range card value (web `latest ? fmtNumber(fromKm(safe(range_km)), 0) : '—'`). */
    private fun cardRange(
        rangeKm: Double?,
        toRangeDisplay: (Double) -> Double,
        locale: Locale,
        hasLatest: Boolean,
    ): String =
        if (!hasLatest) {
            BATTERY_EM_DASH
        } else {
            ChartFormat.number(toRangeDisplay(safeValue(rangeKm)), RANGE_DECIMALS, locale)
        }
}

/** The mutually-exclusive surface drawn for a given [UiState] phase (web empty/content + the added chrome). */
enum class BatteryTabSurface { Loading, Error, Empty, Content }

/**
 * Maps a [UiState] onto the surface to render. Stale/offline cached data stays [BatteryTabSurface.Content]
 * (plus a freshness chip), never a blanked surface — the honest "last known" contract the sibling surfaces
 * follow.
 */
fun batteryTabSurface(state: UiState<*>): BatteryTabSurface =
    when (state.phase) {
        UiPhase.Loading -> BatteryTabSurface.Loading
        UiPhase.Error -> BatteryTabSurface.Error
        UiPhase.Empty -> BatteryTabSurface.Empty
        UiPhase.Content -> BatteryTabSurface.Content
    }

/**
 * Builds the cache-then-network [UiState] for the web-parity entry that takes the raw `FleetAnalytics`
 * document + a `loading` flag (web `data` / `isLoading` props): a first load with nothing parsed yet is
 * [UiPhase.Loading]; an empty trend is [UiPhase.Empty] (web `trend.length === 0`); otherwise the parsed
 * rows render as [UiPhase.Content].
 */
fun batteryTabStateOf(
    analytics: JsonElement?,
    loading: Boolean,
): UiState<List<BatteryTrendPoint>> {
    val trend = BatteryTrend.parse(analytics)
    val phase =
        when {
            loading && trend.isEmpty() -> UiPhase.Loading
            trend.isEmpty() -> UiPhase.Empty
            else -> UiPhase.Content
        }
    return UiState(phase = phase, data = trend)
}

/**
 * Emits the one PII-safe `view.opened` diagnostic with the surface [BatteryTabRegistration.SLUG] (P1/S11).
 * Kept free of Compose so it is unit-tested with a recording [Logger]; the composable calls it from its
 * first-composition effect.
 */
fun recordBatteryTabOpened(logger: Logger) {
    logger.info(EVENT_VIEW_OPENED, mapOf("surface" to BatteryTabRegistration.SLUG))
}

private const val EVENT_VIEW_OPENED = "view.opened"
