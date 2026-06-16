// Pure, framework-free model + derivations for the CommandHistoryPage system surface — the native analogue of
// everything the web page derives before it returns JSX (web/src/features/system/pages/CommandHistoryPage.tsx,
// the vehicle command audit log). No Compose, no Android framework, no HTTP lives here: every type is exercised
// off-device, keeping the composable a thin render layer.
//
// The single feed arrives as the raw verbatim server JSON the shared S8 CommandsStore already exposes
// (`GET /vehicles/{vehicleId}/commands/history?limit=200` ▸ commandHistory(vehicleId)). So this file owns the
// parse + the client-side derivations the web component does inline: the per-row mapping, the command-name
// label catalog (web `COMMAND_LABELS` + `formatCommandName`), the status/search filter predicate (web
// `filtered` useMemo), the stat rollup (web `stats` useMemo — total-24h, success-rate, most-used, last-sent),
// and the per-row subtitle builder (web `buildSubtitle`). The command rows carry plain ids / strings / ISO
// timestamps — none are unit-bearing — so there is no SI conversion here; relative/locale time formatting is
// applied at the render boundary (S5).
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/system — the P3 prompt's allowed-files path) cannot form the package the rest of the app's
// `io.teslasync.android.*` namespace uses, so the package intentionally diverges from the path — exactly as
// the sibling admin / notifications surfaces do. `MatchingDeclarationName` is suppressed for the co-located
// supporting declarations.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.system.commandhistory

import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.longOrNull
import java.time.Instant
import java.time.OffsetDateTime
import java.time.ZoneOffset
import java.time.format.DateTimeFormatter
import kotlin.math.roundToInt

/** Em dash used as the universal "no value" marker, matching the web `'—'` fallback. */
internal const val EM_DASH: String = "\u2014"

/**
 * Canonical metadata for this surface. The web page is a top-level system route, not a draggable dashboard
 * widget, so there is no web registry row to mirror — this object carries the cross-cutting concerns the
 * surface owes: the navigation [ROUTE_ID] / [WEB_PATH] the host wires, the diagnostics [SLUG] emitted with
 * the one-shot `view.opened` event (P1/S11), the fixed [PAGE_SIZE] the web paginates at (`PAGE_SIZE = 25`),
 * and the [HISTORY_LIMIT] the web read hook caps the history at (`?limit=200`).
 */
object CommandHistoryPageRegistration {
    /** The navigation destination id (Destinations.kt `page("commandHistory", "/command-history", …)`). */
    const val ROUTE_ID: String = "commandHistory"

    /** The web route this surface mirrors (deep-link target). */
    const val WEB_PATH: String = "/command-history"

    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). */
    const val SLUG: String = "CommandHistoryPage"

    /** Rows per page — the web `PAGE_SIZE = 25`. */
    const val PAGE_SIZE: Int = 25

    /** History cap — the web `request('…/commands/history?limit=200')`. */
    const val HISTORY_LIMIT: Int = 200
}

/**
 * The active status facet mirroring the web `STATUS_FILTERS` tuple (`all` / `success` / `failed`). The
 * [key] is the stable value the URL param / TabNav carries; the page filters by exact `status == key`
 * (web `c.status === statusFilter`).
 */
enum class StatusFilter(val key: String) {
    All("all"),
    Success("success"),
    Failed("failed"),
    ;

    companion object {
        /** Resolve a filter from its stable [key], defaulting to [All] for an unknown/empty value. */
        fun fromKey(key: String): StatusFilter = entries.firstOrNull { it.key == key } ?: All
    }
}

/**
 * One command-audit row — the native mirror of the web `CommandLogEntry`. The wire fields are plain
 * scalars; [createdAtMillis] is the parsed epoch of [createdAt] for the render-boundary relative-time +
 * day-window derivations (web `new Date(c.created_at).getTime()`).
 */
data class CommandLogEntry(
    val id: Long,
    val vehicleId: Long,
    val command: String,
    val params: String,
    val status: String,
    val error: String,
    val createdAt: String,
    val createdAtMillis: Long,
) {
    /** Whether the command succeeded (web `c.status === 'success'`). */
    val isSuccess: Boolean get() = status == STATUS_SUCCESS

    internal companion object {
        const val STATUS_SUCCESS: String = "success"

        fun from(obj: JsonObject?): CommandLogEntry? {
            if (obj == null) return null
            val createdAt = obj.string("created_at") ?: ""
            return CommandLogEntry(
                id = obj.long("id") ?: 0L,
                vehicleId = obj.long("vehicle_id") ?: 0L,
                command = obj.string("command") ?: "",
                params = obj.string("params") ?: "",
                status = obj.string("status") ?: "",
                error = obj.string("error") ?: "",
                createdAt = createdAt,
                createdAtMillis = parseIsoMillis(createdAt),
            )
        }
    }
}

/**
 * The two active filters mirroring the web URL params (`status` + `q`). [hasAny] backs the web
 * `searchQuery || statusFilter !== 'all'` test that switches the empty timeline between the
 * "no commands match the filters" and "no commands yet" messages.
 */
data class CommandHistoryFilters(
    val status: StatusFilter = StatusFilter.All,
    val query: String = "",
) {
    /** Whether any facet is active (web `searchQuery || statusFilter !== 'all'`). */
    val hasAny: Boolean get() = status != StatusFilter.All || query.isNotBlank()
}

/**
 * The stat rollup computed from the FULL history (not the filtered slice) — the native mirror of the web
 * `stats` useMemo. Nullable [mostUsed] / [lastCommandMillis] reproduce the web `null` fallbacks so the
 * render boundary shows the em-dash before anything resolves, never a misleading zero.
 */
data class CommandStats(
    val total24h: Int,
    val successRate: Int,
    val mostUsed: String?,
    val lastCommandMillis: Long?,
) {
    internal companion object {
        val EMPTY: CommandStats = CommandStats(total24h = 0, successRate = 0, mostUsed = null, lastCommandMillis = null)
    }
}

/**
 * The curated command-name label catalog — the verbatim port of the web `COMMAND_LABELS` map. Keeps a
 * stable, human-readable label per known Tesla Fleet command so the audit rows read the same on every
 * platform; unknown commands fall through to [titleCaseCommand].
 */
private val COMMAND_LABELS: Map<String, String> =
    mapOf(
        "lock" to "Lock",
        "unlock" to "Unlock",
        "wake_up" to "Wake Up",
        "climate_on" to "Climate ON",
        "climate_off" to "Climate OFF",
        "honk_horn" to "Honk Horn",
        "flash_lights" to "Flash Lights",
        "charge_start" to "Start Charging",
        "charge_stop" to "Stop Charging",
        "set_charge_limit" to "Set Charge Limit",
        "set_temps" to "Set Temperature",
        "actuate_trunk" to "Open/Close Trunk",
        "actuate_frunk" to "Open Frunk",
        "window_control" to "Window Control",
        "sun_roof_control" to "Sunroof Control",
        "remote_start_drive" to "Remote Start",
        "set_sentry_mode" to "Sentry Mode",
        "set_speed_limit" to "Speed Limit",
        "clear_speed_limit" to "Clear Speed Limit",
        "set_valet_mode" to "Valet Mode",
        "reset_valet_pin" to "Reset Valet PIN",
        "schedule_software_update" to "Schedule Update",
        "cancel_software_update" to "Cancel Update",
        "media_toggle_playback" to "Media Play/Pause",
        "media_next_track" to "Next Track",
        "media_prev_track" to "Previous Track",
        "media_volume_up" to "Volume Up",
        "media_volume_down" to "Volume Down",
        "adjust_volume" to "Adjust Volume",
        "navigation_request" to "Navigate",
        "share" to "Share to Vehicle",
        "trigger_homelink" to "Trigger HomeLink",
        "set_bioweapon_mode" to "Bioweapon Defense",
        "set_climate_keeper" to "Climate Keeper",
        "set_cop_temp" to "Cabin Overheat Protection",
        "dog_mode_on" to "Dog Mode ON",
        "dog_mode_off" to "Dog Mode OFF",
        "camp_mode_on" to "Camp Mode ON",
        "camp_mode_off" to "Camp Mode OFF",
        "set_scheduled_departure" to "Scheduled Departure",
        "set_scheduled_charging" to "Scheduled Charging",
        "set_preconditioning_max" to "Max Preconditioning",
        "auto_conditioning_start" to "Start Preconditioning",
        "auto_conditioning_stop" to "Stop Preconditioning",
        "remote_seat_heater_request" to "Seat Heater",
        "remote_seat_cooler_request" to "Seat Cooler",
        "remote_steering_wheel_heater_request" to "Steering Wheel Heater",
        "close_charge_port" to "Close Charge Port",
        "open_charge_port" to "Open Charge Port",
        "set_pin_to_drive" to "PIN to Drive",
    )

/**
 * Human-readable command label — the port of the web `formatCommandName`: the curated [COMMAND_LABELS]
 * entry, else the raw key with underscores replaced by spaces and each word title-cased.
 */
fun formatCommandName(command: String): String = COMMAND_LABELS[command] ?: titleCaseCommand(command)

/** Title-cases a raw `snake_case` command (web `cmd.replace(/_/g,' ').replace(/\b\w/g, upper)`). */
private fun titleCaseCommand(command: String): String =
    command
        .split('_')
        .joinToString(" ") { word ->
            word.replaceFirstChar { ch -> ch.uppercaseChar() }
        }

/**
 * Parses the raw `/commands/history` JSON array into the typed rows, dropping any non-object element. The
 * web read hook applies `select: (data) => data ?? []`; a null/blank element yields the empty list here.
 */
fun parseCommands(json: JsonElement?): List<CommandLogEntry> {
    val array = json as? JsonArray ?: return emptyList()
    return array.mapNotNull { element -> CommandLogEntry.from(element as? JsonObject) }
}

/**
 * The active client-side filter predicate — the native port of the web `filtered` useMemo (the `'all'`
 * date-range preset is a no-op, so it is omitted): status by exact class, then a case-insensitive search
 * over BOTH the raw command and its formatted label (web `c.command` / `formatCommandName(c.command)`).
 */
fun filterCommands(
    commands: List<CommandLogEntry>,
    filters: CommandHistoryFilters,
): List<CommandLogEntry> {
    var result = commands
    if (filters.status != StatusFilter.All) {
        result = result.filter { it.status == filters.status.key }
    }
    val needle = filters.query.trim().lowercase()
    if (needle.isNotEmpty()) {
        result =
            result.filter { entry ->
                entry.command.lowercase().contains(needle) ||
                    formatCommandName(entry.command).lowercase().contains(needle)
            }
    }
    return result
}

/**
 * Computes the stat rollup from the FULL [commands] history (web `stats` useMemo): the count sent in the
 * last 24 h relative to [nowMillis], the integer success-rate percentage, the single most-used command
 * (first-encountered on a tie, matching the web stable sort), and the most-recent command's timestamp.
 */
fun computeStats(
    commands: List<CommandLogEntry>,
    nowMillis: Long,
): CommandStats {
    if (commands.isEmpty()) return CommandStats.EMPTY
    val total24h = commands.count { nowMillis - it.createdAtMillis < DAY_MILLIS }
    val successCount = commands.count { it.isSuccess }
    val successRate = ((successCount * PERCENT) / commands.size).roundToInt()

    val counts = LinkedHashMap<String, Int>()
    for (entry in commands) {
        counts[entry.command] = (counts[entry.command] ?: 0) + 1
    }
    val mostUsed = counts.entries.maxByOrNull { it.value }?.key

    val lastCommand = commands.firstOrNull()
    return CommandStats(
        total24h = total24h,
        successRate = successRate,
        mostUsed = mostUsed,
        lastCommandMillis = lastCommand?.createdAtMillis?.takeIf { lastCommand.createdAt.isNotBlank() },
    )
}

/** The 1-based slice of [filtered] for the current 1-based [page] at [PAGE_SIZE] (web `paginatedCommands`). */
fun pageSlice(
    filtered: List<CommandLogEntry>,
    page: Int,
    pageSize: Int = CommandHistoryPageRegistration.PAGE_SIZE,
): List<CommandLogEntry> {
    if (filtered.isEmpty() || pageSize <= 0) return emptyList()
    val start = (page - 1).coerceAtLeast(0) * pageSize
    if (start >= filtered.size) return emptyList()
    val end = (start + pageSize).coerceAtMost(filtered.size)
    return filtered.subList(start, end)
}

/**
 * Builds the per-row timeline subtitle — the native port of the web `buildSubtitle`: the decoded params
 * (`k: v` pairs, or the raw string when it is not a JSON object), then the error text, falling back to the
 * absolute UTC timestamp when neither is present. The data values round-trip verbatim; no English microcopy
 * is fabricated here (the render boundary owns any labels).
 */
fun buildSubtitle(entry: CommandLogEntry): String {
    val parts = mutableListOf<String>()

    val params = entry.params
    if (params.isNotBlank() && params != "{}") {
        val obj = runCatching { commandsJson.parseToJsonElement(params) as? JsonObject }.getOrNull()
        if (obj != null && obj.isNotEmpty()) {
            parts.add(obj.entries.joinToString(", ") { (key, value) -> "$key: ${primitiveText(value)}" })
        } else {
            parts.add(params)
        }
    }

    if (entry.error.isNotBlank()) {
        parts.add(entry.error)
    }

    if (parts.isEmpty()) {
        parts.add(formatAbsolute(entry.createdAtMillis))
    }

    return parts.joinToString(SUBTITLE_SEPARATOR)
}

/** Maps a [Resource]'s `data`/`cached` payload through [transform], preserving the freshness flags (ADR-013). */
internal fun <T, R> Resource<T>.mapData(transform: (T) -> R): Resource<R> =
    when (this) {
        is Resource.Loading -> Resource.Loading(cached?.let(transform), fetchedAt, stale)
        is Resource.Success -> Resource.Success(transform(data), fetchedAt, stale)
        is Resource.Error -> Resource.Error(cached?.let(transform), fetchedAt, stale, error)
    }

/** Emits the one PII-safe `view.opened` diagnostic with the surface slug (P1/S11); carries no log content. */
internal fun recordCommandHistoryPageOpened(logger: Logger) {
    logger.info("view.opened", mapOf("surface" to CommandHistoryPageRegistration.SLUG))
}

// ── Internal helpers ─────────────────────────────────────────────────────────────────────────────────────────

private val commandsJson = Json { ignoreUnknownKeys = true }

private const val DAY_MILLIS = 24L * 60L * 60L * 1000L
private const val PERCENT = 100.0
private const val SUBTITLE_SEPARATOR = " \u00B7 "

private val ABSOLUTE_FORMAT: DateTimeFormatter =
    DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm").withZone(ZoneOffset.UTC)

/** Formats an epoch-millis stamp as a stable UTC `yyyy-MM-dd HH:mm` string (the web `formatDateTime` fallback). */
private fun formatAbsolute(millis: Long): String =
    if (millis <= 0L) EM_DASH else ABSOLUTE_FORMAT.format(Instant.ofEpochMilli(millis))

/** The raw content of a JSON primitive (web `${v}` interpolation), or its source text for a composite value. */
private fun primitiveText(value: JsonElement): String = (value as? JsonPrimitive)?.contentOrNull ?: value.toString()

/**
 * Parses an RFC-3339 / ISO-8601 instant into epoch millis (the web `new Date(created_at).getTime()`),
 * tolerating both an explicit offset and a bare `Z`, and falling back to 0 for a missing/unparseable stamp
 * so a partial payload still renders rather than throwing.
 */
internal fun parseIsoMillis(iso: String): Long {
    if (iso.isBlank()) return 0L
    return runCatching { Instant.parse(iso).toEpochMilli() }
        .recoverCatching { OffsetDateTime.parse(iso).toInstant().toEpochMilli() }
        .getOrDefault(0L)
}

// ── JSON readers (tolerant accessors over the raw CommandsStore element) ────────────────────────────────────────

private fun JsonObject.prim(key: String): JsonPrimitive? = this[key] as? JsonPrimitive

private fun JsonObject.string(key: String): String? = prim(key)?.contentOrNull

private fun JsonObject.long(key: String): Long? = prim(key)?.longOrNull
