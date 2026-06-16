// Pure, framework-free model + derivations for the SecurityAccessPage admin surface — the native analogue of
// everything the web page computes before it returns JSX
// (web/src/features/admin/pages/SecurityAccessPage.tsx + ../components/security-access/helpers.ts). No Compose,
// no Android framework, no HTTP lives here: every type is exercised off-device, keeping the composable a thin
// render layer.
//
// The history feed arrives as the raw verbatim server JSON the shared S8 AdminStore already exposes
// (`GET /security?vehicle_id=` ▸ securityEvents(id), a JSON array of forward-folded security rows). So this file
// owns the parse + the client-side derivations the web component does inline: the per-row field extraction (the
// backend serializes raw `signal.SignalValue`s, so a "string" field may arrive as a JSON bool/number — every
// accessor is union-tolerant, mirroring web `asNonEmptyString`), the lock/door/window/sentry "is it secure?"
// logic (web `doorClosed` / `allWindowsClosed` / `isSentryActive`), and the sentry-uptime percentage. No security
// field is unit-bearing (a lock bool, a sentry enum, ISO timestamps, small counts), so there is no SI conversion
// here — locale / date formatting is applied at the render boundary (S5).
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/admin — the P3 prompt's allowed-files path) cannot form the package the rest of the app's
// `io.teslasync.android.*` namespace uses, so the package intentionally diverges from the path — exactly as the
// sibling ApiLogsPage / IngestXRayPage admin surfaces do. `MatchingDeclarationName` is suppressed for the
// co-located types.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.admin.securityaccess

import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.longOrNull

/** Em dash used as the universal "no value" marker, matching the web `'—'` fallback. */
internal const val EM_DASH: String = "\u2014"

private const val PERCENT_SCALE: Double = 100.0

/**
 * Canonical metadata for this surface. The web page is a top-level admin route, not a draggable dashboard widget,
 * so there is no web registry row to mirror — this object carries the cross-cutting concerns the surface owes:
 * the navigation [ROUTE_ID] / [WEB_PATH] the host wires and the diagnostics [SLUG] emitted with the one-shot
 * `view.opened` event (P1/S11).
 */
object SecurityAccessRegistration {
    /** The navigation destination id (Destinations.kt `page("securityAccess", "/security-access", …)`). */
    const val ROUTE_ID: String = "securityAccess"

    /** The web route this surface mirrors (deep-link target). */
    const val WEB_PATH: String = "/security-access"

    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). */
    const val SLUG: String = "SecurityAccessPage"
}

/** A window position, mirroring the web `WindowState` union (`Closed` / `Venting` / `Open` / `Unknown`). */
enum class WindowState { Closed, Venting, Open, Unknown }

/**
 * One decoded security/access row — the native counterpart of the web `SecurityEvent`. Every field is nullable
 * because the forward-folded signal feed may not have observed a given signal yet; the string-typed signals
 * (`sentryMode` / `doorState` / the windows / `centerDisplay`) are read union-tolerantly since the backend
 * serializes the raw `signal.SignalValue`, which may be a JSON bool/number rather than a string.
 */
data class SecurityRow(
    val locked: Boolean?,
    val sentryMode: String?,
    val doorState: String?,
    val fdWindow: String?,
    val fpWindow: String?,
    val rdWindow: String?,
    val rpWindow: String?,
    val homelinkNearby: Boolean?,
    val guestMode: Boolean?,
    val homelinkDeviceCount: Long?,
    val driverSeatOccupied: Boolean?,
    val centerDisplay: String?,
    val speedLimitMode: String?,
    val valetModeEnabled: Boolean?,
    val serviceMode: Boolean?,
    val pairedPhoneKeyCount: Long?,
    val lightsHazardsActive: Boolean?,
    val lightsHighBeams: Boolean?,
    val lightsTurnSignal: String?,
    val createdAt: String?,
)

/**
 * The decoded page payload (web's `latest` + `history` + the memoized stat derivations), projected from the raw
 * `GET /security` JSON array. [latest] is the most recent row (the array is returned newest-first), [rows] is the
 * full history, and the booleans/percentage are the page's `useMemo` derivations.
 */
data class SecurityAccessData(
    val rows: List<SecurityRow>,
    val latest: SecurityRow?,
    val isSecure: Boolean,
    val sentryActive: Boolean,
    val sentryUptimePct: Int,
    val totalEvents: Int,
) {
    /** No history at all — gates the native Empty phase (web `history.length === 0`). */
    val isEmpty: Boolean get() = rows.isEmpty()

    companion object {
        /** The neutral payload rendered before the first decode (and the no-vehicle sentinel). */
        val EMPTY: SecurityAccessData =
            SecurityAccessData(
                rows = emptyList(),
                latest = null,
                isSecure = true,
                sentryActive = false,
                sentryUptimePct = 0,
                totalEvents = 0,
            )

        /** Decodes the raw `GET /security` array [element] into the page payload (web `select: safeArray`). */
        fun from(element: JsonElement?): SecurityAccessData {
            val rows = parseSecurityRows(element)
            val latest = rows.firstOrNull()
            return SecurityAccessData(
                rows = rows,
                latest = latest,
                isSecure = isSecure(latest),
                sentryActive = latest?.let { isSentryActive(it.sentryMode) } ?: false,
                sentryUptimePct = computeSentryUptimePct(rows),
                totalEvents = rows.size,
            )
        }
    }
}

/** Parses the raw `GET /security` JSON array into [SecurityRow]s; a non-array (or null) decodes to empty. */
fun parseSecurityRows(element: JsonElement?): List<SecurityRow> {
    val array = element as? JsonArray ?: return emptyList()
    return array.mapNotNull { (it as? JsonObject)?.let(::parseSecurityRow) }
}

private fun parseSecurityRow(obj: JsonObject): SecurityRow =
    SecurityRow(
        locked = obj.boolField("locked"),
        sentryMode = obj.strField("sentry_mode", "sentryMode"),
        doorState = obj.strField("door_state", "doorState"),
        fdWindow = obj.strField("fd_window", "fdWindow"),
        fpWindow = obj.strField("fp_window", "fpWindow"),
        rdWindow = obj.strField("rd_window", "rdWindow"),
        rpWindow = obj.strField("rp_window", "rpWindow"),
        homelinkNearby = obj.boolField("homelink_nearby", "homelinkNearby"),
        guestMode = obj.boolField("guest_mode", "guestMode"),
        homelinkDeviceCount = obj.longField("homelink_device_count", "homelinkDeviceCount"),
        driverSeatOccupied = obj.boolField("driver_seat_occupied", "driverSeatOccupied"),
        centerDisplay = obj.strField("center_display", "centerDisplay"),
        speedLimitMode = obj.strField("speed_limit_mode", "speedLimitMode"),
        valetModeEnabled = obj.boolField("valet_mode_enabled", "valetModeEnabled"),
        serviceMode = obj.boolField("service_mode", "serviceMode"),
        pairedPhoneKeyCount = obj.longField("paired_phone_key_count", "pairedPhoneKeyCount"),
        lightsHazardsActive = obj.boolField("lights_hazards_active", "lightsHazardsActive"),
        lightsHighBeams = obj.boolField("lights_high_beams", "lightsHighBeams"),
        lightsTurnSignal = obj.strField("lights_turn_signal", "lightsTurnSignal"),
        createdAt = obj.strField("created_at", "createdAt"),
    )

// ── Union-tolerant accessors (web `asNonEmptyString` intent) ──────────────────────────────────────────────────

private fun JsonObject.primitive(vararg keys: String): JsonPrimitive? {
    for (key in keys) {
        val value = this[key] ?: continue
        if (value is JsonNull) continue
        return value as? JsonPrimitive ?: continue
    }
    return null
}

/** Reads a string-ish signal, accepting a JSON string OR a bool/number serialized as one (raw SignalValue). */
private fun JsonObject.strField(vararg keys: String): String? = primitive(*keys)?.contentOrNull?.takeUnless { it.isBlank() }

/** Reads a bool signal, accepting a real JSON bool OR a `"true"/"1"/"on"` style string (raw SignalValue). */
private fun JsonObject.boolField(vararg keys: String): Boolean? {
    val primitive = primitive(*keys) ?: return null
    primitive.booleanOrNull?.let { return it }
    return when (primitive.contentOrNull?.trim()?.lowercase()) {
        "true", "1", "on", "yes" -> true
        "false", "0", "off", "no" -> false
        else -> null
    }
}

private fun JsonObject.longField(vararg keys: String): Long? = primitive(*keys)?.longOrNull

// ── Pure derivations (web ../components/security-access/helpers.ts) ───────────────────────────────────────────

/** True when the door reads closed (web `doorClosed`): null / `closed` / `0` / `false` are all "closed". */
fun doorClosed(state: String?): Boolean {
    val raw = state?.trim()?.lowercase() ?: return true
    return raw.isEmpty() || raw == "closed" || raw == "closedall" || raw == "0" || raw == "false"
}

/** Classifies a raw window value into a [WindowState] (web `parseWindowState`). */
fun parseWindowState(raw: String?): WindowState {
    val lower = raw?.trim()?.lowercase()?.takeUnless { it.isEmpty() } ?: return WindowState.Unknown
    return when {
        lower == "closed" || lower == "0" -> WindowState.Closed
        lower.contains("vent") -> WindowState.Venting
        lower.contains("open") || lower != "0" -> WindowState.Open
        else -> WindowState.Unknown
    }
}

/** True when all four windows read closed (web `allWindowsClosed`). */
fun allWindowsClosed(row: SecurityRow?): Boolean {
    if (row == null) return true
    return listOf(row.fdWindow, row.fpWindow, row.rdWindow, row.rpWindow)
        .map(::parseWindowState)
        .all { it == WindowState.Closed }
}

/** The number of windows not fully closed (web `windowSummary` open/venting count). */
fun openWindowCount(row: SecurityRow?): Int {
    if (row == null) return 0
    return listOf(row.fdWindow, row.fpWindow, row.rdWindow, row.rpWindow)
        .map(::parseWindowState)
        .count { it != WindowState.Closed }
}

/** True when the SentryMode value means armed — any non-Off state (web `isSentryActive`). */
fun isSentryActive(value: String?): Boolean {
    val raw = value?.trim()?.takeUnless { it.isEmpty() } ?: return false
    return !raw.lowercase().contains("off")
}

/**
 * Whether the vehicle is currently secure (web `isSecure`): locked AND doors closed AND all windows closed.
 * With no latest row the vehicle is treated as secure (web `if (!latest) return true`).
 */
fun isSecure(latest: SecurityRow?): Boolean {
    if (latest == null) return true
    return latest.locked == true && doorClosed(latest.doorState) && allWindowsClosed(latest)
}

/** Sentry uptime as a whole-percent of rows where sentry read armed (web `computeSentryUptime`, rounded). */
fun computeSentryUptimePct(rows: List<SecurityRow>): Int {
    if (rows.isEmpty()) return 0
    val on = rows.count { isSentryActive(it.sentryMode) }
    return (on * PERCENT_SCALE / rows.size).toInt()
}

// ── Resource re-shaping ───────────────────────────────────────────────────────────────────────────────────────

/**
 * Maps a [Resource]'s payload through [transform] while preserving its phase / freshness / error — the holder's
 * `securityEvents` JSON feed is decoded into [SecurityAccessData] without collapsing the loading / stale / offline
 * states the UI needs (mirrors the sibling IngestXRayPage's `mapData`).
 */
fun <T, R> Resource<T>.mapData(transform: (T) -> R): Resource<R> =
    when (this) {
        is Resource.Loading -> Resource.Loading(cached?.let(transform), fetchedAt, stale)
        is Resource.Success -> Resource.Success(transform(data), fetchedAt, stale)
        is Resource.Error -> Resource.Error(cached?.let(transform), fetchedAt, stale, error)
    }

/** Emits the one PII-safe `view.opened` diagnostic with the surface slug (P1/S11); carries no row content. */
internal fun recordSecurityAccessPageOpened(logger: Logger) {
    logger.info("view.opened", mapOf("surface" to SecurityAccessRegistration.SLUG))
}
