// Pure, framework-free model + derivations for the MQTTInspectorPage telemetry surface — the native analogue of
// everything the web page computes before composing its panels (web/src/features/telemetry/pages/MQTTInspectorPage.tsx,
// the MQTT connection-status + streaming-telemetry monitor). No Compose, no Android UI, no HTTP: every declaration
// here is plain Kotlin (it references only the shared-core TelemetryStatus/VehicleTelemetry DTOs, the framework-free
// BadgeVariant enum, and the pure freshness helpers), so the composable stays a thin render layer and the whole
// derivation is asserted off-device in the :android:testDebugUnitTest gate.
//
// The web page binds one `useMQTTStatus` read (`GET /telemetry`) and folds it into four KPI tiles (streaming
// vehicles / total signals / total batches / signals-per-second), a client-accumulated throughput series, a
// connection-info panel (broker / uptime / topic patterns), and a per-vehicle breakdown table. The non-trivial
// derivations live here as pure functions:
//   • [mqttTotals]          — the four reduce()s the StatCards read (web `totalSignals`/`totalBatches`/`totalRate`).
//   • [ThroughputAccumulator] — the `useEffect`-driven delta history (web `throughputHistory`, capped to 60 points,
//     delta-gated, leading-zero-skipped) reproduced as an immutable reducer over successive status snapshots.
//   • [formatUptime]        — the web local `formatUptime(seconds)` helper.
//   • [mqttVehicleRows]     — the per-vehicle table projection (web `buildVehicleColumns` render fns), including the
//     stale/live classification (web `STALE_THRESHOLD = 120s`) and the en-US number formatting (`fmtInt`/`fmtNumber`).
//
// SI boundary: MQTT status carries counts (signals, batches), a rate (signals/sec), and an uptime in seconds — none
// are user-preference units, so the page performs NO SI conversion (the web renders these raw too). Phase-42 stores
// everything as SI; values round-trip verbatim and only display formatting (grouping/precision) is applied here.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/telemetry) diverges from
// the `io.teslasync.android.*` package the rest of the app uses, exactly as the sibling A7 pages do.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.telemetry.mqttinspector

import io.teslasync.android.components.datadisplay.DEFAULT_STALE_SECONDS
import io.teslasync.android.components.datadisplay.FreshnessAge
import io.teslasync.android.components.datadisplay.computeAgeSeconds
import io.teslasync.android.components.datadisplay.formatFreshnessAge
import io.teslasync.android.components.datadisplay.relativeAge
import io.teslasync.android.components.ui.BadgeVariant
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.presentation.telemetry.TelemetryStatus
import io.teslasync.shared.core.presentation.telemetry.VehicleTelemetry
import java.time.Instant
import java.time.OffsetDateTime
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.util.Locale

/**
 * Identity of the surface for the navigation registry + diagnostics (P1/S11) — the native mirror of the web
 * `MQTTInspectorPage` route. [ROUTE_ID] matches the [io.teslasync.android.navigation.Destinations] entry
 * `page("mqttInspector", "/mqtt-inspector", NavGroup.Telemetry)`, so [io.teslasync.android.navigation.PageHosts]
 * binds this surface to that destination (and its `/mqtt-inspector` deep link) without the nav module depending on it.
 */
object MqttInspectorPageRegistration {
    /** The navigation destination id (Destinations.kt `page("mqttInspector", "/mqtt-inspector", …)`). */
    const val ROUTE_ID: String = "mqttInspector"

    /** The web route this surface mirrors (deep-link target). */
    const val WEB_PATH: String = "/mqtt-inspector"

    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). Carries no telemetry data. */
    const val SLUG: String = "MQTTInspectorPage"
}

/**
 * Emits the one PII-safe `view.opened` diagnostic with the surface [MqttInspectorPageRegistration.SLUG] (P1/S11).
 * Kept free of Compose so it is unit-testable with a recording [Logger]; the page calls it from its first
 * composition. Carries no VIN, broker, or signal figure.
 */
fun recordMqttInspectorPageOpened(logger: Logger) {
    logger.info(EVENT_VIEW_OPENED, mapOf(FIELD_SURFACE to MqttInspectorPageRegistration.SLUG))
}

private const val EVENT_VIEW_OPENED = "view.opened"
private const val FIELD_SURFACE = "surface"

/** The em dash the web renders for any null/absent value (`'—'`). */
internal const val EM_DASH: String = "\u2014"

/** The vehicle-staleness window in seconds — the web `STALE_THRESHOLD = 120` (also ADR-013's 2-minute window). */
const val STALE_THRESHOLD_SECONDS: Long = DEFAULT_STALE_SECONDS

/** Max throughput points retained — the web `.slice(-60)` cap. */
const val THROUGHPUT_MAX_POINTS: Int = 60

/** Minimum throughput points before the chart renders — the web `throughputHistory.length > 2` guard. */
const val THROUGHPUT_MIN_POINTS: Int = 2

/** Default precision for the signals-per-second figures — the web `fmtNumber` default (`_globalPrecision = 2`). */
private const val RATE_FRACTION_DIGITS: Int = 2

private const val SECONDS_PER_HOUR: Long = 3_600
private const val SECONDS_PER_MINUTE: Long = 60

// ── KPI totals (web `totalSignals` / `totalBatches` / `totalRate`) ─────────────────────────────────────────────

/**
 * The four summary figures the StatCards read — the native fold of the web page's three `reduce()`s plus the
 * vehicle count: streaming vehicles (`vehicles.length`), total signals (`Σ signalCount`), total batches
 * (`Σ batchCount`), and the aggregate rate (`Σ signalsPerSecond`). All counts stay raw (no unit conversion).
 */
data class MqttTotals(
    val streamingVehicles: Int = 0,
    val totalSignals: Long = 0,
    val totalBatches: Long = 0,
    val totalRate: Double = 0.0,
)

/** Folds a [TelemetryStatus] (or `null`) into its [MqttTotals] — the web summary reduces, null-safe per ADR-002. */
fun mqttTotals(status: TelemetryStatus?): MqttTotals {
    val vehicles = status?.vehicles ?: emptyList()
    return MqttTotals(
        streamingVehicles = vehicles.size,
        totalSignals = vehicles.sumOf { it.signalCount },
        totalBatches = vehicles.sumOf { it.batchCount },
        totalRate = vehicles.sumOf { it.signalsPerSecond ?: 0.0 },
    )
}

/**
 * Whether a status snapshot carries nothing worth rendering — the empty-state boundary for the feed (the web
 * `status ? … : <EmptyState noStatus/>` case). True when the broker is absent, no vehicle is streaming, no topic
 * is advertised, the uptime is unknown, AND the broker is reported disconnected — i.e. the normalizer returned a
 * default/absent status. Drives [io.teslasync.android.data.UiPhase.Empty].
 */
fun isEmptyStatus(status: TelemetryStatus): Boolean =
    !status.connected &&
        status.broker.isNullOrBlank() &&
        status.vehicles.isEmpty() &&
        status.topics.isEmpty() &&
        status.uptimeSeconds == null

// ── Throughput history (web `throughputHistory` useEffect) ─────────────────────────────────────────────────────

/**
 * One point in the client-accumulated throughput series — the native analogue of the web `ThroughputPoint`
 * (`{ time, signals }`). [timeMillis] is the wall-clock instant the sample was taken (formatted to a clock label
 * at the render boundary by [formatClockLabel]); [signals] is the non-negative delta of total signals since the
 * previous sample (web `Math.max(delta, 0)`).
 */
data class ThroughputPoint(
    val timeMillis: Long,
    val signals: Long,
)

/**
 * The immutable reducer reproducing the web page's throughput `useEffect` (web/src/features/telemetry/pages/
 * MQTTInspectorPage.tsx L114-122). The web effect, keyed on `totalSignals`, keeps a `prevTotalRef` and a bounded
 * `throughputHistory`: it skips the leading all-zero sample, computes the delta against the previous total, and —
 * when the delta is non-negative — appends `{ time: now, signals: max(delta, 0) }`, capping the series at the last
 * 60 points. Reproduced here as a pure fold over successive status snapshots so the history survives recomposition
 * (re-shared in the ViewModel) and is asserted off-device.
 *
 * @property prevTotal the last observed total-signals value (web `prevTotalRef.current`), or `null` before the
 *   first counted sample.
 * @property points the bounded throughput series (web `throughputHistory`), oldest-first, capped to
 *   [THROUGHPUT_MAX_POINTS].
 */
data class ThroughputAccumulator(
    val prevTotal: Long? = null,
    val points: List<ThroughputPoint> = emptyList(),
) {
    /**
     * Folds the next status snapshot into the series at wall-clock [nowMillis]. Mirrors the web effect exactly:
     *  - a leading sample whose total is `0` with no prior total is skipped (web early `return`);
     *  - an unchanged total since the last counted sample appends nothing (the web effect's `[totalSignals]`
     *    dependency only fires on a change);
     *  - the first counted sample records a `0`-delta point (web `delta = prev !== null ? … : 0`);
     *  - a decreased total (counter reset) updates the running total but appends no point (web `if (delta >= 0)`);
     *  - otherwise a `max(delta, 0)` point is appended and the series is capped to the last [THROUGHPUT_MAX_POINTS].
     */
    fun next(
        status: TelemetryStatus?,
        nowMillis: Long,
    ): ThroughputAccumulator {
        val total = mqttTotals(status).totalSignals
        if (total == 0L && prevTotal == null) return this
        if (prevTotal != null && total == prevTotal) return this
        val delta = if (prevTotal == null) 0L else total - prevTotal
        if (delta < 0L) return copy(prevTotal = total)
        val appended = points + ThroughputPoint(timeMillis = nowMillis, signals = maxOf(delta, 0L))
        return ThroughputAccumulator(
            prevTotal = total,
            points = if (appended.size > THROUGHPUT_MAX_POINTS) appended.takeLast(THROUGHPUT_MAX_POINTS) else appended,
        )
    }
}

/** Whether enough throughput points have accumulated to render the chart — the web `length > 2` guard. */
fun hasThroughputChart(points: List<ThroughputPoint>): Boolean = points.size > THROUGHPUT_MIN_POINTS

// ── Display formatting (en-US, no SI conversion) ───────────────────────────────────────────────────────────────

/**
 * Locale-aware number formatting reproducing the web `numberFormat` helpers
 * (`fmtInt`/`fmtNumber`, web/src/lib/numberFormat.ts) the KPIs + table read. Pure (JVM-tested): a non-finite value
 * is coerced to `0` exactly as the web `safeNumber`, and grouping/precision follow `Intl.NumberFormat('en-US')`
 * with equal min/max fraction digits (`String.format`'s `HALF_UP` matches ECMAScript `halfExpand`).
 */
object MqttFormat {
    /** Web `fmtInt(value)` → `fmtNumber(value, 0)` — grouped integer (0 dp). */
    fun int(
        value: Long,
        locale: Locale = Locale.US,
    ): String = String.format(locale, "%,d", value)

    /** Web `fmtNumber(value)` — grouped number at the default precision (`_globalPrecision = 2`). */
    fun number(
        value: Double,
        digits: Int = RATE_FRACTION_DIGITS,
        locale: Locale = Locale.US,
    ): String {
        val safe = if (value.isFinite()) value else 0.0
        return String.format(locale, "%,.${digits}f", safe)
    }
}

/**
 * Formats an uptime in seconds for the connection-info panel — a 1:1 port of the web local `formatUptime`
 * (web/src/features/telemetry/pages/MQTTInspectorPage.tsx L32-35): under an hour renders `"{m}m"`, otherwise
 * `"{h}h {m}m"` where the trailing minutes are floored. Pure and JVM-tested.
 */
fun formatUptime(seconds: Double): String {
    val total = if (seconds.isFinite() && seconds > 0) seconds.toLong() else 0L
    if (total < SECONDS_PER_HOUR) return "${total / SECONDS_PER_MINUTE}m"
    val hours = total / SECONDS_PER_HOUR
    val minutes = (total % SECONDS_PER_HOUR) / SECONDS_PER_MINUTE
    return "${hours}h ${minutes}m"
}

private val CLOCK_FORMATTER: DateTimeFormatter = DateTimeFormatter.ofPattern("HH:mm:ss")

/**
 * Formats a throughput sample's [timeMillis] into the chart x-axis clock label — the native analogue of the web
 * `formatTime(new Date())`. Display-only (no SI), rendered at the surface's [zone] (system default in production,
 * injectable for tests). A 24-hour `HH:mm:ss` label keeps the axis compact and locale-stable.
 */
fun formatClockLabel(
    timeMillis: Long,
    zone: ZoneId = ZoneId.systemDefault(),
): String = Instant.ofEpochMilli(timeMillis).atZone(zone).format(CLOCK_FORMATTER)

// ── Per-vehicle breakdown table (web `buildVehicleColumns`) ────────────────────────────────────────────────────

/**
 * One projected row of the vehicle-breakdown table — the native analogue of a web `VehicleTelemetry` row after the
 * `buildVehicleColumns` render functions have run. Every field is already display-formatted so the composable cell
 * is a thin `Text`/`Badge`, and the whole projection is asserted off-device.
 *
 * @property vin the vehicle VIN (web monospace cell).
 * @property state the raw stream state for the State badge, or `null` (web `'—'`).
 * @property stateOnline whether [state] is the `"online"` success tone (web `variant === 'online' ? 'success' …`).
 * @property signals the grouped signal count (web `fmtInt(signalCount)`).
 * @property batches the grouped batch count (web `fmtInt(batchCount)`).
 * @property signalsPerSecond the grouped rate, or `'—'` when absent (web `fmtNumber(signalsPerSecond)`).
 * @property lastReceived the relative "x ago" label, or `'—'` when never received (web `formatRelative`).
 * @property stale whether the row is stale (no receipt, or older than [STALE_THRESHOLD_SECONDS]) — drives the
 *   Live/Stale status badge (web `isStale ? 'warning' : 'success'`).
 */
data class MqttVehicleRow(
    val vin: String,
    val state: String?,
    val stateOnline: Boolean,
    val signals: String,
    val batches: String,
    val signalsPerSecond: String,
    val lastReceived: String,
    val stale: Boolean,
)

/** The State badge tone — `"online"` success, any other non-null state neutral (web `Badge variant`). */
fun stateVariant(stateOnline: Boolean): BadgeVariant = if (stateOnline) BadgeVariant.Success else BadgeVariant.Neutral

/**
 * Whether a vehicle is stale at [nowMillis] — the web `!lastReceived || (now - lastReceived)/1000 > STALE_THRESHOLD`.
 * A missing or unparseable timestamp is stale; otherwise the age is compared against [STALE_THRESHOLD_SECONDS].
 */
fun isVehicleStale(
    lastReceived: String?,
    nowMillis: Long,
): Boolean {
    val millis = parseIsoMillis(lastReceived) ?: return true
    val ageSeconds = computeAgeSeconds(millis, nowMillis) ?: return true
    return ageSeconds > STALE_THRESHOLD_SECONDS
}

/**
 * Projects the streaming vehicles into display rows at [nowMillis] — the native `buildVehicleColumns` fold. Counts
 * are grouped with [MqttFormat], the rate falls back to `'—'` when null, and the relative-receipt label reuses the
 * shared freshness buckets ([relativeAge]/[formatFreshnessAge]) so it matches every other "x ago" surface.
 */
fun mqttVehicleRows(
    vehicles: List<VehicleTelemetry>,
    nowMillis: Long,
): List<MqttVehicleRow> =
    vehicles.map { v ->
        MqttVehicleRow(
            vin = v.vin,
            state = v.state,
            stateOnline = v.state == VEHICLE_STATE_ONLINE,
            signals = MqttFormat.int(v.signalCount),
            batches = MqttFormat.int(v.batchCount),
            signalsPerSecond = v.signalsPerSecond?.let { MqttFormat.number(it) } ?: EM_DASH,
            lastReceived = formatLastReceived(v.lastReceived, nowMillis),
            stale = isVehicleStale(v.lastReceived, nowMillis),
        )
    }

/** The count of stale vehicles — the web `staleVehicles.length` badge on the breakdown header. */
fun staleVehicleCount(
    vehicles: List<VehicleTelemetry>,
    nowMillis: Long,
): Int = vehicles.count { isVehicleStale(it.lastReceived, nowMillis) }

/** The relative-receipt label, or `'—'` when never received / unparseable (web `lastReceived ? formatRelative …`). */
private fun formatLastReceived(
    lastReceived: String?,
    nowMillis: Long,
): String {
    val millis = parseIsoMillis(lastReceived) ?: return EM_DASH
    val age = relativeAge(computeAgeSeconds(millis, nowMillis))
    return if (age is FreshnessAge.Unknown) EM_DASH else formatFreshnessAge(age)
}

/** The backend's online stream-state token (web `v.state === 'online'`). */
private const val VEHICLE_STATE_ONLINE: String = "online"

/** Parses an ISO-8601 instant (offset or `Z`) to epoch millis, or `null` when absent/malformed (never throws). */
internal fun parseIsoMillis(value: String?): Long? {
    if (value.isNullOrBlank()) return null
    return runCatching { OffsetDateTime.parse(value).toInstant().toEpochMilli() }
        .recoverCatching { Instant.parse(value).toEpochMilli() }
        .getOrNull()
}
