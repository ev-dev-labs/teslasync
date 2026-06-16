// Pure, framework-free model + projection for the LiveLogsPage admin surface — the native analogue of
// everything the web page derives before it returns JSX (web/src/features/admin/pages/LiveLogsPage.tsx, the
// operator-facing live log tail). No Compose, no Android framework, no networking lives here: every type is
// exercised off-device, keeping the composable a thin render layer.
//
// The live feed itself is owned by the shared KMP holder
// (io.teslasync.shared.core.presentation.logstream.LogStreamStore — the cross-platform port of the web
// `useLogStream` hook). This file owns the client-side derivations the web component does inline: the level →
// badge tone map, the time/message/field/vehicle extraction over each row's raw zerolog JSON, the
// client-side vehicle filter, the connection-status classification (web `ConnectionBadge`), the table-region
// phase (loading / empty / content), and the download `.txt` body + filename. Values are plain log strings —
// none are unit-bearing — so there is no SI conversion here.
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/admin — the P3 prompt's allowed-files path) cannot form the package the rest of the app's
// `io.teslasync.android.*` namespace uses, so the package intentionally diverges from the path — exactly as
// the sibling admin surfaces do. `MatchingDeclarationName` is suppressed for the co-located types.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration", "TooManyFunctions")

package io.teslasync.android.admin.livelogs

import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.presentation.logstream.LogStreamEvent
import io.teslasync.shared.core.presentation.logstream.LogStreamLevel
import io.teslasync.shared.core.presentation.logstream.LogStreamState
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter

/** Em dash used as the universal "no value" marker, matching the web `'—'` fallback. */
internal const val EM_DASH: String = "\u2014"

/**
 * Canonical metadata for this surface. The web page is an (unrouted) admin tail, not a draggable dashboard
 * widget, so there is no web registry row to mirror — this object carries the cross-cutting concerns the
 * surface owes: the navigation [ROUTE_ID] the host wires, the [WEB_SOURCE] it mirrors, and the diagnostics
 * [SLUG] emitted with the one-shot `view.opened` event (P1/S11).
 */
object LiveLogsRegistration {
    /** The page-host id the route is registered under (web page is unrouted, so this is its stable key). */
    const val ROUTE_ID: String = "LiveLogsPage"

    /** The web source this surface mirrors (the page is unrouted — no URL deep-link target). */
    const val WEB_SOURCE: String = "web/src/features/admin/pages/LiveLogsPage.tsx"

    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). */
    const val SLUG: String = "LiveLogsPage"
}

/** Semantic tone for a log/connection badge, mapped to the design-system badge palette at the render boundary. */
enum class LiveLogsTone { Info, Success, Warning, Danger, Neutral }

/**
 * The connection-badge classification mirroring the web `ConnectionBadge`: a hard transport error wins, then
 * a torn-down stream, then a not-yet-open stream, then the paused-but-receiving hold, else live.
 */
enum class LiveLogsConnection { Error, Disconnected, Connecting, Paused, Connected }

/** The table-region phase — the lifecycle surface the GlassPanel4 body switches on. */
enum class LiveLogsPhase { Loading, Empty, Content }

/**
 * The page's local interaction snapshot — the union of the web component's `useState` group folded into one
 * immutable value so the composable reads a single source. [level] + [grep] are the server-side filters that
 * restart the subscription; [grepDraft] is the un-applied text bound to the field; [vehicleFilter] is the
 * client-side filter applied to the current buffer; [paused] / [autoscroll] / [enabled] mirror the web flags;
 * [reconnectEpoch] bumps to force a fresh subscription (web's enabled false→true reconnect).
 */
data class LiveLogsInteraction(
    val level: LogStreamLevel = LogStreamLevel.Info,
    val grep: String = "",
    val grepDraft: String = "",
    val vehicleFilter: String = "",
    val paused: Boolean = false,
    val autoscroll: Boolean = true,
    val enabled: Boolean = true,
    val reconnectEpoch: Int = 0,
)

/**
 * The render-ready projection the surface binds to: the vehicle-[events] (already client-filtered), the
 * [bufferedCount] (the full rolling buffer size, web `stream.events.length`), [totalReceived], server [drops],
 * the [connection] badge classification, the [errorMessage] (or null), and the table [phase]. [hasError] gates
 * the GlassPanel3 error affordance (web `stream.error ? … : null`).
 */
data class LiveLogsUiState(
    val events: List<LogStreamEvent>,
    val bufferedCount: Int,
    val totalReceived: Int,
    val drops: Int,
    val connection: LiveLogsConnection,
    val hasError: Boolean,
    val errorMessage: String?,
    val phase: LiveLogsPhase,
) {
    companion object {
        /** Pre-subscription seed: an empty, not-yet-connected stream (web cold start → "Connecting…"). */
        val INITIAL: LiveLogsUiState =
            LiveLogsUiState(
                events = emptyList(),
                bufferedCount = 0,
                totalReceived = 0,
                drops = 0,
                connection = LiveLogsConnection.Connecting,
                hasError = false,
                errorMessage = null,
                phase = LiveLogsPhase.Loading,
            )
    }
}

/** The level-order the filter dropdown offers, mirroring the web `LEVEL_OPTIONS`. */
val LIVE_LOGS_LEVELS: List<LogStreamLevel> =
    listOf(LogStreamLevel.Debug, LogStreamLevel.Info, LogStreamLevel.Warn, LogStreamLevel.Error)

/** Resolves a [LogStreamLevel] from its wire token (the Select's option value), defaulting to `info`. */
fun levelFromWire(wire: String): LogStreamLevel =
    LIVE_LOGS_LEVELS.firstOrNull { it.wire == wire } ?: LogStreamLevel.Info

/**
 * Level → badge tone, mirroring the web `levelBadgeVariant`: debug/trace neutral, info info, warn warning,
 * error/err/fatal/panic danger, everything else neutral.
 */
fun levelTone(level: String): LiveLogsTone =
    when (level.lowercase()) {
        "debug", "trace" -> LiveLogsTone.Neutral
        "info" -> LiveLogsTone.Info
        "warn", "warning" -> LiveLogsTone.Warning
        "error", "err", "fatal", "panic" -> LiveLogsTone.Danger
        else -> LiveLogsTone.Neutral
    }

/**
 * Classifies the connection badge, mirroring the web `ConnectionBadge` precedence exactly. A hard transport
 * error wins; otherwise a disabled (torn-down) stream; otherwise a not-yet-open stream; otherwise the
 * paused-but-still-receiving hold; otherwise live.
 */
fun connectionStatus(
    hasError: Boolean,
    enabled: Boolean,
    isConnected: Boolean,
    paused: Boolean,
): LiveLogsConnection =
    when {
        hasError -> LiveLogsConnection.Error
        !enabled -> LiveLogsConnection.Disconnected
        !isConnected -> LiveLogsConnection.Connecting
        paused -> LiveLogsConnection.Paused
        else -> LiveLogsConnection.Connected
    }

/**
 * Folds the shared [LogStreamState] + the local [interaction] into the render-ready [LiveLogsUiState] — the
 * native equivalent of the web page's `filteredEvents` memo + the inline state branches. The vehicle filter
 * is applied client-side to the current buffer (web `extractVehicleId` predicate); the phase is Content when
 * any row survives the filter, Loading while a fresh stream is still connecting with nothing buffered, and
 * Empty otherwise (so GlassPanel4 never collapses to a blank region).
 */
fun projectLiveLogs(
    stream: LogStreamState,
    interaction: LiveLogsInteraction,
): LiveLogsUiState {
    val filtered = filterByVehicle(stream.events, interaction.vehicleFilter)
    val connection =
        connectionStatus(
            hasError = stream.error != null,
            enabled = interaction.enabled,
            isConnected = stream.isConnected,
            paused = interaction.paused,
        )
    val phase =
        when {
            filtered.isNotEmpty() -> LiveLogsPhase.Content
            connection == LiveLogsConnection.Connecting -> LiveLogsPhase.Loading
            else -> LiveLogsPhase.Empty
        }
    return LiveLogsUiState(
        events = filtered,
        bufferedCount = stream.events.size,
        totalReceived = stream.totalReceived,
        drops = stream.drops,
        connection = connection,
        hasError = stream.error != null,
        errorMessage = stream.error,
        phase = phase,
    )
}

/**
 * Applies the client-side vehicle filter to [events], mirroring the web `filteredEvents` memo: a blank filter
 * passes everything, otherwise only rows whose parsed `vehicle_id` (any of the web candidate keys) equals the
 * trimmed needle survive.
 */
fun filterByVehicle(
    events: List<LogStreamEvent>,
    vehicleFilter: String,
): List<LogStreamEvent> {
    val needle = vehicleFilter.trim()
    if (needle.isEmpty()) return events
    return events.filter { extractVehicleId(it.parsed) == needle }
}

/**
 * Formats an epoch-millis receipt time as `HH:mm:ss.SSS`, mirroring the web `formatTime`: locale clock with
 * millisecond precision so a bursty stream stays distinguishable. [zone] is injectable for deterministic
 * off-device tests.
 */
fun formatLogTime(
    receivedAtMillis: Long,
    zone: ZoneId = ZoneId.systemDefault(),
): String =
    runCatching {
        TIME_FORMAT.format(Instant.ofEpochMilli(receivedAtMillis).atZone(zone))
    }.getOrDefault("")

/**
 * The message a row reports, mirroring the web `extractMessage`: the parsed `message` (or `msg`) string field
 * when present, otherwise the raw payload line.
 */
fun extractMessage(
    parsed: JsonObject?,
    raw: String,
): String {
    if (parsed == null) return raw
    stringField(parsed, "message")?.let { return it }
    stringField(parsed, "msg")?.let { return it }
    return raw
}

/**
 * The non-reserved structured fields of a parsed row as ordered key/value pairs, mirroring the web
 * `extractFields`: skips level/time/message/msg and nulls, stringifies primitives verbatim and objects/arrays
 * as compact JSON.
 */
fun extractFields(parsed: JsonObject?): List<Pair<String, String>> {
    if (parsed == null) return emptyList()
    val skip = setOf("level", "time", "message", "msg")
    val out = ArrayList<Pair<String, String>>(parsed.size)
    for ((key, value) in parsed) {
        if (key in skip) continue
        if (value is JsonNull) continue
        out.add(key to stringifyValue(value))
    }
    return out
}

/**
 * The vehicle id a row carries, mirroring the web `extractVehicleId`: the first of `vehicle_id` / `vehicleID`
 * / `vehicleId` that is a non-empty string or a number, else null.
 */
fun extractVehicleId(parsed: JsonObject?): String? {
    if (parsed == null) return null
    for (candidate in VEHICLE_ID_KEYS) {
        val primitive = parsed[candidate] as? JsonPrimitive ?: continue
        if (primitive.isString) {
            if (primitive.content.isNotEmpty()) return primitive.content
        } else if (primitive.content != "null" && primitive.content.isNotEmpty()) {
            // A JSON number renders unquoted; mirror the web `String(v)` coercion.
            return primitive.content
        }
    }
    return null
}

/**
 * One downloadable `.txt` line for [event], mirroring the web `eventToText`:
 * `[HH:mm:ss.SSS] LEVEL <raw payload>`.
 */
fun eventToLine(
    event: LogStreamEvent,
    zone: ZoneId = ZoneId.systemDefault(),
): String = "[${formatLogTime(event.receivedAt, zone)}] ${event.level.uppercase()} ${event.payload}"

/** The full download body — every visible [events] row joined by newlines (web `filteredEvents.map(...).join`). */
fun downloadBody(
    events: List<LogStreamEvent>,
    zone: ZoneId = ZoneId.systemDefault(),
): String = events.joinToString("\n") { eventToLine(it, zone) }

/**
 * The filename timestamp token, mirroring the web `downloadFilename`: an ISO instant with `:` replaced by `-`
 * and the fractional seconds dropped (e.g. `2026-06-14T20-50-09Z`). Fed into the `liveLogs.filename` resource
 * (`teslasync-logs-%1$s.txt`).
 */
fun downloadTimestamp(
    nowMillis: Long,
    zone: ZoneId = ZoneId.systemDefault(),
): String {
    val iso = STAMP_FORMAT.format(Instant.ofEpochMilli(nowMillis).atZone(zone))
    return iso.replace(":", "-").replace(FRACTION_REGEX, "Z")
}

/** Emits the one PII-safe `view.opened` diagnostic with the surface slug (P1/S11); carries no log content. */
internal fun recordLiveLogsPageOpened(logger: Logger) {
    logger.info("view.opened", mapOf("surface" to LiveLogsRegistration.SLUG))
}

// ── internals ────────────────────────────────────────────────────────────────────────────────────────────

private val VEHICLE_ID_KEYS = listOf("vehicle_id", "vehicleID", "vehicleId")
private val TIME_FORMAT: DateTimeFormatter = DateTimeFormatter.ofPattern("HH:mm:ss.SSS")
private val STAMP_FORMAT: DateTimeFormatter = DateTimeFormatter.ofPattern("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'")
private val FRACTION_REGEX = Regex("\\.\\d+Z$")

private const val FIELD_VALUE_MAX = 32

private fun stringField(
    obj: JsonObject,
    key: String,
): String? {
    val primitive = obj[key] as? JsonPrimitive ?: return null
    return if (primitive.isString) primitive.content else null
}

private fun stringifyValue(value: kotlinx.serialization.json.JsonElement): String =
    when (value) {
        is JsonPrimitive -> value.content
        is JsonObject -> value.toString()
        is JsonArray -> value.toString()
    }

/** Truncates a long field value to [FIELD_VALUE_MAX] chars with an ellipsis, mirroring the web chip cap. */
fun truncateFieldValue(value: String): String = if (value.length > FIELD_VALUE_MAX) "${value.take(FIELD_VALUE_MAX)}\u2026" else value
