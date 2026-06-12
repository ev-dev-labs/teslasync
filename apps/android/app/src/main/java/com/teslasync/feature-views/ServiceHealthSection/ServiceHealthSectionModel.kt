// Pure, framework-free model + projection for the Service Health feature view — the native analogue of
// everything web/src/features/system/components/status/ServiceHealthSection.tsx derives from the
// `getTelemetryStatus` (`GET /telemetry`) payload before returning JSX. No Compose, no Android framework,
// no HTTP: every type here is unit-tested off device in the :android:testReleaseUnitTest gate, keeping the
// composable a thin render layer.
//
// The web surface is a single polling `useQuery(getTelemetryStatus, refetchInterval: 2s)` rendered inside an
// AccordionSection: a loading branch (Skeleton), an error branch (QueryError), an empty branch (no telemetry
// payload), and a content branch with two header badges (Enabled/Disabled + "{activeCount} streaming") over
// four MetricCards (Mode / Vehicles Connected / Total Signals / Avg Signals/s) and a sortable, paginated
// DataTable of streaming vehicles (VIN / Status / Signals / Signals-per-second / Latency / Last Received).
// This file reproduces the data that branch derives — the `enabled` flag, `mode`, the aggregate
// total-signals + avg-signals-per-second figures, and one row per streaming vehicle — plus the web helper
// logic (`fmtInt`, `fmtNumber`, `formatDateTime`, the streaming/enabled badge tone, and the signal-count
// column sort).
//
// NOTE on the data seam: the shared KMP `TelemetryStore.mqttStatus()` normalizes `/telemetry` to the LOSSY
// `useMQTTStatus` shape (connected / broker / uptime / vehicles / topics) which DROPS `enabled`, `mode`, and
// `aggregate_stats`; binding to it would silently break parity (three missing MetricCards + the Enabled
// badge). So — exactly like the sibling HealthProbesSection projects the raw `/system/health` JSON, and like
// FleetApiSection owns its dev-tools seam — this surface projects the RAW `/telemetry` JsonElement itself and
// preserves every field the web source shows.
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/feature-views/ServiceHealthSection — the P3 prompt's allowed-files path) cannot form a valid
// Kotlin package (a hyphen and a PascalCase segment are illegal in a package identifier), so the package
// intentionally diverges from the path — exactly as the sibling feature-view surfaces do.
// `MatchingDeclarationName` is suppressed for the co-located supporting declarations.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.servicehealth

import io.teslasync.android.components.charts.ChartFormat
import io.teslasync.android.components.feedback.QueryErrorKind
import io.teslasync.android.components.feedback.classifyQueryError
import io.teslasync.android.components.ui.BadgeVariant
import io.teslasync.android.components.ui.SortDirection
import io.teslasync.android.components.ui.SortState
import io.teslasync.android.data.ErrorKind
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
import java.time.format.DateTimeFormatter
import java.util.Locale

/**
 * Canonical registry metadata for the Service Health surface — the native mirror of the web status section.
 * The diagnostics [SLUG] is emitted with the one-shot `view.opened` event (P1/S11).
 */
object ServiceHealthSectionRegistration {
    /** Stable surface id (also the `viewModel` key the host binds this surface with). */
    const val ID: String = "service-health-section"

    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). */
    const val SLUG: String = "ServiceHealthSection"
}

/**
 * The i18n keys the web source passes to `t(...)`, verbatim. The natural-key style (`t('Service Health')`) is
 * the web app's own convention here; some of these keys exist in the shared P1/S10 catalog (`Mode`, `Status`,
 * `Signals`, `Latency`, `Streaming`, `Idle`, `VIN`, `streaming`) and the rest fall back to the key text
 * exactly as react-i18next does on the web. The render layer resolves each through the Android resource
 * facade, falling back to the key (see `resolveServiceHealthText` in ServiceHealthSection.kt), so the
 * on-screen text matches the web verbatim. The [EMPTY_HINT] and the accordion affordance keys are
 * native-only microcopy (the web relies on react-query's never-null content + the DOM `aria-expanded`,
 * neither of which has an automatic native equivalent); they resolve by-name and fall back to these English
 * defaults.
 */
object ServiceHealthKeys {
    const val TITLE = "Service Health"
    const val DESCRIPTION = "Fleet Telemetry streaming status"
    const val ENABLED = "Enabled"
    const val DISABLED = "Disabled"
    const val STREAMING_SUFFIX = "streaming"
    const val MODE = "Mode"
    const val VEHICLES_CONNECTED = "Vehicles Connected"
    const val TOTAL_SIGNALS = "Total Signals"
    const val AVG_SIGNALS_PER_SECOND = "Avg Signals/s"
    const val COL_VIN = "VIN"
    const val COL_STATUS = "Status"
    const val COL_SIGNALS = "Signals"
    const val COL_SIGNALS_PER_SECOND = "Signals/s"
    const val COL_LATENCY = "Latency"
    const val COL_LAST_RECEIVED = "Last Received"
    const val ROW_STREAMING = "Streaming"
    const val ROW_IDLE = "Idle"
    const val NO_VEHICLES = "No vehicles connected"
    const val EMPTY_HINT = "No telemetry data available"
    const val LOADING = "Loading"
    const val EXPAND_ACTION = "Expand"
    const val COLLAPSE_ACTION = "Collapse"
    const val EXPANDED_STATE = "Expanded"
    const val COLLAPSED_STATE = "Collapsed"
}

/** The stable [SortState] key for the sortable Signals column (web `{ key: 'signal_count', sortable: true }`). */
const val SERVICE_HEALTH_SIGNAL_COUNT_KEY: String = "signal_count"

/** Unit suffix for the latency value — a universal symbol, not translatable copy (web `${…} ms`). */
const val SERVICE_HEALTH_LATENCY_UNIT: String = "ms"

/** The avg-signals-per-second fallback the web substitutes when the aggregate is absent (web `?? '0'`). */
const val SERVICE_HEALTH_DEFAULT_AVG: String = "0"

/**
 * One streaming vehicle row — the native analogue of a `Object.values(streaming_vehicles)` entry the web
 * `vehicleColumns` render. Pure data (no Compose types) so the table projection is unit-tested directly.
 *
 * @property vin the vehicle identification number (web `row.vin`, shown monospace).
 * @property isStreaming whether the vehicle is actively streaming (web `row.is_streaming` ⇒ the status badge).
 * @property signalCount total signals received (web `row.signal_count`); the sortable column.
 * @property signalsPerSecond current signal throughput (web `row.signals_per_second`).
 * @property latencyMs ingest latency in milliseconds (web `row.latency_ms`).
 * @property lastReceived the raw `last_received` timestamp, formatted at the boundary (web `formatDateTime`).
 */
data class ServiceVehicleRow(
    val vin: String,
    val isStreaming: Boolean,
    val signalCount: Long,
    val signalsPerSecond: Double,
    val latencyMs: Double,
    val lastReceived: String,
)

/**
 * The fully projected, render-ready view of the surface — the native analogue of everything the web
 * `ServiceHealthSection` derives before returning JSX. Pure data so every branch is unit-tested directly.
 *
 * @property enabled whether Fleet Telemetry is enabled (web `data.enabled` ⇒ the Enabled/Disabled badge).
 * @property mode the telemetry mode, shown verbatim (web `data.mode`).
 * @property totalSignals aggregate signals received (web `data.aggregate_stats?.total_signals_received ?? 0`).
 * @property avgSignalsPerSecond aggregate avg throughput, verbatim string (web `?? '0'`).
 * @property vehicles one row per streaming vehicle (web `Object.values(data.streaming_vehicles)`).
 * @property resolved whether `/telemetry` resolved to an object — the web `data != null` truthiness; `false`
 *   ⇒ the surface renders its friendly empty state instead of the metrics + table.
 */
data class ServiceHealthData(
    val enabled: Boolean,
    val mode: String,
    val totalSignals: Long,
    val avgSignalsPerSecond: String,
    val vehicles: List<ServiceVehicleRow>,
    val resolved: Boolean,
) {
    /** Count of actively-streaming vehicles (web `vehicles.filter(v => v.is_streaming).length`). */
    val activeCount: Int get() = vehicles.count { it.isStreaming }

    /** Web `data != null` — false ⇒ the empty state. */
    val hasData: Boolean get() = resolved

    companion object {
        /** The no-data projection (web `data == null` ⇒ the metrics + table never render). */
        val EMPTY: ServiceHealthData =
            ServiceHealthData(
                enabled = false,
                mode = "",
                totalSignals = 0L,
                avgSignalsPerSecond = SERVICE_HEALTH_DEFAULT_AVG,
                vehicles = emptyList(),
                resolved = false,
            )
    }
}

/**
 * Pure projection from the raw `/telemetry` payload to the render-ready [ServiceHealthData] — the native
 * port of the derivation work in `ServiceHealthSection.tsx`. Side-effect-free (no Android, no Compose, no
 * coroutines) so the gate unit-tests every branch without a device.
 */
object ServiceHealthProjection {
    /**
     * Build the projection from the raw `/telemetry` [status] object (web `getTelemetryStatus`). A non-object
     * [status] (null, `JsonNull`, or a scalar) yields the no-data projection (web `data == null`), which the
     * surface renders as its empty state. Both snake_case (the wire shape) and camelCase keys are accepted
     * defensively, mirroring the web's tolerance after `camelCaseKeys`.
     */
    fun build(status: JsonElement?): ServiceHealthData {
        val obj = status as? JsonObject ?: return ServiceHealthData.EMPTY
        val aggregate = obj["aggregate_stats"] as? JsonObject ?: obj["aggregateStats"] as? JsonObject
        return ServiceHealthData(
            enabled = boolField(obj, "enabled") ?: false,
            mode = stringField(obj, "mode") ?: "",
            totalSignals = firstLong(aggregate, "total_signals_received", "totalSignalsReceived") ?: 0L,
            avgSignalsPerSecond = avgSignalsPerSecond(aggregate),
            vehicles = parseVehicles(obj["streaming_vehicles"] ?: obj["streamingVehicles"]),
            resolved = true,
        )
    }

    /**
     * Stable order of the streaming-vehicle rows for the sortable Signals column. The native [androidx
     * `DataTable`] hoists the [sortState] and renders the rows as given, so the caller applies the sort: an
     * unsorted state (or any other column) preserves insertion order (web `Object.values`); the
     * [SERVICE_HEALTH_SIGNAL_COUNT_KEY] column sorts by [ServiceVehicleRow.signalCount] in the [sortState]
     * direction (web `sortable` on `signal_count`).
     */
    fun sortVehicles(
        rows: List<ServiceVehicleRow>,
        sortState: SortState,
    ): List<ServiceVehicleRow> {
        if (sortState.key != SERVICE_HEALTH_SIGNAL_COUNT_KEY) return rows
        val ascending = rows.sortedBy { it.signalCount }
        return if (sortState.direction == SortDirection.Asc) ascending else ascending.asReversed()
    }

    /** Badge tone for the Enabled/Disabled header chip — web `variant={data.enabled ? 'success' : 'neutral'}`. */
    fun enabledBadgeVariant(enabled: Boolean): BadgeVariant = if (enabled) BadgeVariant.Success else BadgeVariant.Neutral

    /** Badge tone for a vehicle's status chip — web `variant={row.is_streaming ? 'success' : 'neutral'}`. */
    fun streamingBadgeVariant(isStreaming: Boolean): BadgeVariant = if (isStreaming) BadgeVariant.Success else BadgeVariant.Neutral

    /** Format an integer count with locale grouping (web `fmtInt`). */
    fun formatCount(
        value: Long,
        locale: Locale = Locale.getDefault(),
    ): String = ChartFormat.number(value.toDouble(), INT_DECIMALS, locale) // parity:allow toDouble() numeric conversion, not a stub

    /** Format the signals-per-second throughput with one decimal (web `fmtNumber(value, 1)`). */
    fun formatThroughput(
        value: Double,
        locale: Locale = Locale.getDefault(),
    ): String = ChartFormat.number(value, THROUGHPUT_DECIMALS, locale)

    /** The "Latency" value — web `${fmtNumber(row.latency_ms, 0)} ms`. */
    fun formatLatency(
        latencyMs: Double,
        locale: Locale = Locale.getDefault(),
    ): String = "${ChartFormat.number(latencyMs, LATENCY_DECIMALS, locale)} $SERVICE_HEALTH_LATENCY_UNIT"

    /**
     * Format the `last_received` timestamp — the native parity of the web `formatDateTime`: a localized
     * "MMM d, yyyy, h:mm a" rendering, or the em dash for a blank/unparseable value (web returns `'—'` for a
     * null or `NaN`-date input). RFC-3339 instants (`…Z`) and offset date-times are both accepted.
     */
    fun formatLastReceived(
        iso: String?,
        zone: ZoneId = ZoneId.systemDefault(),
        locale: Locale = Locale.getDefault(),
    ): String {
        val instant = iso?.takeIf { it.isNotBlank() }?.let(::parseInstant) ?: return ChartFormat.EMPTY
        return DateTimeFormatter.ofPattern(LAST_RECEIVED_PATTERN, locale).format(instant.atZone(zone))
    }

    private fun parseInstant(iso: String): Instant? =
        runCatching { Instant.parse(iso) }.getOrNull()
            ?: runCatching { OffsetDateTime.parse(iso).toInstant() }.getOrNull()

    private fun avgSignalsPerSecond(aggregate: JsonObject?): String =
        (stringField(aggregate, "avg_signals_per_second") ?: stringField(aggregate, "avgSignalsPerSecond"))
            ?.takeIf { it.isNotBlank() }
            ?: SERVICE_HEALTH_DEFAULT_AVG

    private fun parseVehicles(raw: JsonElement?): List<ServiceVehicleRow> =
        when (raw) {
            is JsonObject -> raw.values.mapNotNull { it as? JsonObject }.map(::parseVehicle)
            is JsonArray -> raw.mapNotNull { it as? JsonObject }.map(::parseVehicle)
            else -> emptyList()
        }

    private fun parseVehicle(v: JsonObject): ServiceVehicleRow =
        ServiceVehicleRow(
            vin = stringField(v, "vin") ?: "",
            isStreaming = boolField(v, "is_streaming") ?: boolField(v, "isStreaming") ?: false,
            signalCount = firstLong(v, "signal_count", "signalCount") ?: 0L,
            signalsPerSecond = firstDouble(v, "signals_per_second", "signalsPerSecond") ?: 0.0,
            latencyMs = firstDouble(v, "latency_ms", "latencyMs") ?: 0.0,
            lastReceived = stringField(v, "last_received") ?: stringField(v, "lastReceived") ?: "",
        )

    private fun stringField(
        obj: JsonObject?,
        key: String,
    ): String? = (obj?.get(key) as? JsonPrimitive)?.contentOrNull

    private fun boolField(
        obj: JsonObject?,
        key: String,
    ): Boolean? = (obj?.get(key) as? JsonPrimitive)?.booleanOrNull

    private fun firstLong(
        obj: JsonObject?,
        vararg keys: String,
    ): Long? = keys.firstNotNullOfOrNull { key -> (obj?.get(key) as? JsonPrimitive)?.longOrNull }

    private fun firstDouble(
        obj: JsonObject?,
        vararg keys: String,
    ): Double? = keys.firstNotNullOfOrNull { key -> (obj?.get(key) as? JsonPrimitive)?.doubleOrNull }

    private const val INT_DECIMALS = 0
    private const val THROUGHPUT_DECIMALS = 1
    private const val LATENCY_DECIMALS = 0
    private const val LAST_RECEIVED_PATTERN = "MMM d, yyyy, h:mm a"
}

/** Maps the Android [errorKind] + HTTP [httpStatus] onto the feedback layer's recovery-oriented bucket. */
fun serviceHealthErrorKind(
    errorKind: ErrorKind?,
    httpStatus: Int?,
): QueryErrorKind =
    classifyQueryError(
        status = httpStatus,
        online = errorKind != ErrorKind.Network && errorKind != ErrorKind.Timeout,
        transientWaiting = errorKind == ErrorKind.CircuitOpen,
    )
