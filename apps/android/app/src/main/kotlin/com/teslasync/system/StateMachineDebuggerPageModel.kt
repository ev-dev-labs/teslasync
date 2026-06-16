// Pure, framework-free metadata + domain model for the StateMachineDebuggerPage system surface — the native analogue
// of the cross-cutting concerns + derivations the web page owns (web/src/features/system/pages/
// StateMachineDebuggerPage.tsx, the multi-FSM transition debugger mounted at /state-debugger). No Compose, no Android
// framework, no HTTP lives here, so the route identity, the four raw-JSON decoders (`/fsm/stats`, `/fsm/transitions`,
// `/signals/{id}/snapshot`, and the typed `/vehicles/{id}/state`), and every page derivation (state distribution,
// per-state transition summary with average interval, flap detection, the current-state mode reduction, and the
// duration/count/timestamp formatters) are all exercised off-device and the composable stays a thin render layer.
//
// The FSM feeds are NOT unit-bearing (state names, triggers, transition counts, pagination ints, RFC-3339 instants),
// so — exactly like the shared `FsmRepository` — the payloads round-trip as raw [kotlinx.serialization.json.JsonElement]
// and are decoded here with the web hook's exact field names (`to_state`, `fsm_name`, `active_subs`, …). The single
// unit-bearing read, `/vehicles/{id}/state`, arrives already typed + SI from the shared `VehiclesStore`; this layer
// only projects the four fields the live-state hero needs.
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory (com/teslasync/system — the P3
// prompt's allowed-files path) cannot form the package the rest of the app's `io.teslasync.android.*` namespace uses,
// so the package intentionally diverges from the path — exactly as the sibling CommandsPage / DiagnosticPage surfaces
// do. `MatchingDeclarationName` is suppressed for the co-located registration + model + derivation types.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.system.statemachinedebugger

import io.teslasync.shared.core.api.generated.VehicleState
import io.teslasync.shared.core.data.repo.FsmType
import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.intOrNull
import kotlinx.serialization.json.longOrNull
import java.time.Instant
import java.time.OffsetDateTime
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import kotlin.math.floor
import kotlin.math.roundToLong

/**
 * Canonical metadata for the StateMachineDebuggerPage surface. The web page is a top-level system route, so this
 * object carries the cross-cutting concerns the surface owes: the navigation [ROUTE_ID] / [WEB_PATH] the host wires
 * (already a metadata-only destination at Destinations.kt `page("stateDebugger", "/state-debugger", NavGroup.System)`),
 * the diagnostics [SLUG] emitted with the one-shot `view.opened` event (P1/S11), and the deep-link prefix the
 * "Share permalink" affordance copies (web `CopyButton text={permalinkUrl}`).
 */
object StateMachineDebuggerRegistration {
    /** The navigation destination id (Destinations.kt `page("stateDebugger", "/state-debugger", NavGroup.System)`). */
    const val ROUTE_ID: String = "stateDebugger"

    /** The web route this surface mirrors (deep-link target). */
    const val WEB_PATH: String = "/state-debugger"

    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). */
    const val SLUG: String = "StateMachineDebuggerPage"

    /**
     * The deep-link prefix the "Share permalink" header action copies — the native analogue of the web permalink the
     * `CopyButton` puts on the clipboard. The selected vehicle id is appended as `?vehicle_id={id}` so the recipient
     * lands on the same vehicle's debugger.
     */
    const val SHARE_DEEP_LINK_PREFIX: String = "teslasync://app/state-debugger"
}

/** The page's "all time" window — `hours=0`, no `start`/`end` (web default range collapses to the all-time API call). */
const val HOURS_ALL_TIME: Int = 0

/** Default page size for the transition log (web `useState(50)`). */
const val DEFAULT_PER_PAGE: Int = 50

/** The per-page options the size selector offers (web `[25, 50, 100]`). */
val PER_PAGE_OPTIONS: List<Int> = listOf(25, 50, 100)

/** Maximum recent transitions the live state-timeline renders as chips (the web `windowMinutes` visual, bounded). */
const val TIMELINE_MAX_CHIPS: Int = 30

private const val FLAP_WINDOW_MILLIS: Long = 60_000L
private const val FLAP_THRESHOLD: Int = 5
private const val SECONDS_PER_MINUTE: Double = 60.0
private const val SECONDS_PER_HOUR: Double = 3600.0
private const val MILLIS_PER_SECOND: Double = 1000.0

private const val EVENT_VIEW_OPENED = "view.opened"
private const val FIELD_SURFACE = "surface"

/** Emits the one PII-safe `view.opened` diagnostic with the surface slug (P1/S11); carries no vehicle data. */
internal fun recordStateMachineDebuggerOpened(logger: Logger) {
    logger.info(EVENT_VIEW_OPENED, mapOf(FIELD_SURFACE to StateMachineDebuggerRegistration.SLUG))
}

// ── FSM domain types (decoded from the raw JSON feeds, web `web/src/types/fsm/ui-types.ts`) ───────────────────────

/**
 * One FSM transition row — the native analogue of the web `FSMTransition` (`/fsm/transitions` `data[]`). [details] is
 * flattened to a string map at decode so the detail panel renders each context entry as a `key: value` chip without
 * re-touching the raw JSON.
 */
data class FsmTransition(
    val id: Long,
    val vehicleId: Long,
    val ts: String,
    val fsmName: String,
    val fromState: String,
    val toState: String,
    val trigger: String,
    val details: Map<String, String>,
)

/** One active sub-FSM (drive/charge) — the web `ActiveSubFSM` shape from `/fsm/stats` `active_subs[]`. */
data class ActiveSubFsm(
    val type: String,
    val state: String,
    val startTime: String,
    val driveId: Long?,
    val sessionId: Long?,
)

/** The `/fsm/stats` envelope — the web `FSMStats` (`enabled`, `stats` count map, optional `active_subs`). */
data class FsmStats(
    val enabled: Boolean,
    val stats: Map<String, Int>,
    val activeSubs: List<ActiveSubFsm>,
)

/** The paged `/fsm/transitions` response — the web `FSMTransitionResponse`. */
data class FsmTransitionsPage(
    val data: List<FsmTransition>,
    val total: Int,
    val page: Int,
    val perPage: Int,
)

/** A single state's slice of the distribution donut (web `pieData` entry): a state [name] and its transition [value]. */
data class StateSlice(
    val name: String,
    val value: Int,
)

/** A row of the transition-counts table (web `StatSummaryRow`): a [toState], its [count], and its [avgIntervalSec]. */
data class TransitionSummaryRow(
    val toState: String,
    val count: Int,
    val avgIntervalSec: Double,
)

/** One signal in a point-in-time snapshot (web `/signals/{id}/snapshot` `signals` entry), flattened for display. */
data class SnapshotSignal(
    val name: String,
    val value: String,
)

/** The decoded `/signals/{id}/snapshot` body (web `SignalSnapshotResponse`) — the selected transition's inspector. */
data class SnapshotData(
    val at: String,
    val count: Int,
    val signals: List<SnapshotSignal>,
) {
    companion object {
        /** The empty snapshot (no transition selected, or the instant carried no signals). */
        fun empty(): SnapshotData = SnapshotData(at = "", count = 0, signals = emptyList())
    }
}

/** The four live-state fields the hero renders, projected from the typed `/vehicles/{id}/state` (web `currentState`). */
data class FsmCurrentState(
    val state: String,
    val since: String?,
    val isCharging: Boolean,
    val speed: Double,
)

/** One vehicle in the header switcher (web vehicle `Select` option): the [id] and its display [label]. */
data class VehicleOption(
    val id: Long,
    val label: String,
)

/** The render-time mode of the live FSM (web `is_charging ? Charging : speed>0 ? Drive : asleep ? Sleep : Idle`). */
enum class FsmMode { Charging, Drive, Sleep, Idle }

/**
 * The immutable success surface the ViewModel exposes and the page renders — the vehicle switcher options, the
 * resolved live state, the current page of transitions, and the per-source in-flight flags so each panel draws its own
 * loading/empty surface (the web page never gates the whole screen on one feed). The expensive derivations
 * (distribution, summary, flap set) are lazy properties so the bound state holder and the page never disagree.
 */
data class DebuggerData(
    val vehicles: List<VehicleOption>,
    val selectedId: Long?,
    val currentState: FsmCurrentState?,
    val currentStateLoading: Boolean,
    val transitions: List<FsmTransition>,
    val totalTransitions: Int,
    val page: Int,
    val perPage: Int,
    val fsmType: FsmType,
    val activeSubs: List<ActiveSubFsm>,
    val transitionsLoading: Boolean,
) {
    /** Whether any vehicle is enrolled (web `vehicleOptions.length > 0`). */
    val hasVehicles: Boolean get() = vehicles.isNotEmpty()

    /** The donut/distribution slices, grouped by destination state and sorted by count (web `pieData`). */
    val distribution: List<StateSlice> get() = stateDistribution(transitions)

    /** The transition-counts rows with average interval, grouped by destination state (web `summaryRows`). */
    val summaryRows: List<TransitionSummaryRow> get() = transitionSummary(transitions)

    /** The number of transitions flagged as state-flapping in this page (web `flapIds.size`). */
    val flapCount: Int get() = computeFlapIds(transitions).size

    /** Transitions on the current page (web `totalTransitionsOnPage`). */
    val totalOnPage: Int get() = transitions.size

    /** The lower-cased current state name for the summary card (web `stateName`). */
    val currentStateName: String? get() = currentState?.state?.lowercase()

    /** The most-recent transitions the live timeline draws as chips (newest first, capped). */
    val recentTransitions: List<FsmTransition>
        get() =
            transitions
                .sortedByDescending { parseEpochMillis(it.ts) ?: Long.MIN_VALUE }
                .take(TIMELINE_MAX_CHIPS)

    /** The selected transition by [id], or `null` (web `transitions.find(tr => tr.id === selectedId)`). */
    fun transitionById(id: Long?): FsmTransition? = id?.let { sel -> transitions.firstOrNull { it.id == sel } }
}

/** The render mode of [state] (web `currentState` mode reduction). */
fun fsmModeOf(state: FsmCurrentState?): FsmMode {
    if (state == null) return FsmMode.Idle
    return when {
        state.isCharging -> FsmMode.Charging
        state.speed > 0.0 -> FsmMode.Drive
        state.state.equals("asleep", ignoreCase = true) -> FsmMode.Sleep
        else -> FsmMode.Idle
    }
}

/** Project a typed [VehicleState] into the four-field live hero model (web `stateResponse?.state`). */
fun toCurrentState(state: VehicleState?): FsmCurrentState? =
    state?.let {
        FsmCurrentState(
            state = it.state,
            since = it.since?.toString(),
            isCharging = it.isCharging,
            speed = it.speed,
        )
    }

// ── Raw-JSON decoders (web hook `queryFn` shapes, exact field names) ──────────────────────────────────────────────

/**
 * Decode the raw `/fsm/stats` body into [FsmStats] (web `useFSMStats`). A non-object body, a missing `stats` map, or a
 * malformed `active_subs` row each degrades to its empty default so a partial payload never throws.
 */
fun parseFsmStats(element: JsonElement?): FsmStats {
    val obj = element as? JsonObject ?: return FsmStats(enabled = false, stats = emptyMap(), activeSubs = emptyList())
    val statsObj = obj["stats"] as? JsonObject
    val stats =
        buildMap {
            statsObj?.forEach { (state, count) -> (count as? JsonPrimitive)?.intOrNull?.let { put(state, it) } }
        }
    val subs =
        (obj["active_subs"] as? JsonArray)
            ?.mapNotNull { it as? JsonObject }
            ?.map { row ->
                ActiveSubFsm(
                    type = row.stringField("type").orEmpty(),
                    state = row.stringField("state").orEmpty(),
                    startTime = row.stringField("start_time").orEmpty(),
                    driveId = row.longField("drive_id"),
                    sessionId = row.longField("session_id"),
                )
            }
            ?: emptyList()
    return FsmStats(enabled = obj.boolField("enabled") ?: false, stats = stats, activeSubs = subs)
}

/**
 * Decode the raw `/fsm/transitions` body into [FsmTransitionsPage] (web `useFSMTransitions`). A non-array `data` field
 * yields an empty page; each row's `details` object is flattened to a string map for the detail panel.
 */
fun parseFsmTransitions(element: JsonElement?): FsmTransitionsPage {
    val obj = element as? JsonObject ?: return FsmTransitionsPage(emptyList(), 0, 1, 0)
    val rows =
        (obj["data"] as? JsonArray)
            ?.mapNotNull { it as? JsonObject }
            ?.map { row ->
                FsmTransition(
                    id = row.longField("id") ?: 0L,
                    vehicleId = row.longField("vehicle_id") ?: 0L,
                    ts = row.stringField("ts").orEmpty(),
                    fsmName = row.stringField("fsm_name").orEmpty(),
                    fromState = row.stringField("from_state").orEmpty(),
                    toState = row.stringField("to_state").orEmpty(),
                    trigger = row.stringField("trigger").orEmpty(),
                    details = parseDetails(row["details"]),
                )
            }
            ?: emptyList()
    return FsmTransitionsPage(
        data = rows,
        total = obj.intField("total") ?: rows.size,
        page = obj.intField("page") ?: 1,
        perPage = obj.intField("per_page") ?: rows.size,
    )
}

/**
 * Decode the raw `/signals/{id}/snapshot` body into [SnapshotData] (web `SignalSnapshotResponse`). Each `signals`
 * entry is a `{value, kind, ts, …}` object — the `value` is surfaced as a display string; a bare primitive is
 * surfaced directly. A non-object body collapses to [SnapshotData.empty].
 */
fun parseSnapshot(element: JsonElement?): SnapshotData {
    val obj = element as? JsonObject ?: return SnapshotData.empty()
    val signalsObj = obj["signals"] as? JsonObject
    val signals =
        signalsObj
            ?.entries
            ?.map { (name, raw) -> SnapshotSignal(name = name, value = snapshotValueString(raw)) }
            ?.sortedBy { it.name }
            ?: emptyList()
    return SnapshotData(
        at = obj.stringField("at").orEmpty(),
        count = obj.intField("count") ?: signals.size,
        signals = signals,
    )
}

private fun parseDetails(element: JsonElement?): Map<String, String> {
    val obj = element as? JsonObject ?: return emptyMap()
    return obj.entries.associate { (key, value) -> key to jsonValueString(value) }
}

private fun snapshotValueString(element: JsonElement?): String =
    when (element) {
        is JsonObject -> jsonValueString(element["value"] ?: element)
        else -> jsonValueString(element)
    }

private fun jsonValueString(element: JsonElement?): String =
    when (element) {
        null, is JsonNull -> "—"
        is JsonPrimitive -> element.contentOrNull ?: element.toString()
        else -> element.toString()
    }

// ── Derivations (web page memos, pure + testable) ─────────────────────────────────────────────────────────────────

/** The donut data: transitions grouped by destination state, counted, and sorted by count descending (web `pieData`). */
fun stateDistribution(transitions: List<FsmTransition>): List<StateSlice> =
    transitions
        .groupingBy { it.toState }
        .eachCount()
        .entries
        .sortedByDescending { it.value }
        .map { StateSlice(name = it.key, value = it.value) }

/**
 * The transition-counts rows (web `summaryRows`): grouped by destination state, each carrying its count and the
 * average gap between its (time-sorted) occurrences in seconds. A single-occurrence state has a zero interval.
 */
fun transitionSummary(transitions: List<FsmTransition>): List<TransitionSummaryRow> =
    transitions
        .groupBy { it.toState }
        .map { (state, rows) ->
            val times = rows.mapNotNull { parseEpochMillis(it.ts) }.sorted()
            val avgInterval =
                if (times.size > 1) {
                    var totalGap = 0L
                    for (i in 1 until times.size) totalGap += times[i] - times[i - 1]
                    (totalGap * 1.0) / (times.size - 1) / MILLIS_PER_SECOND
                } else {
                    0.0
                }
            TransitionSummaryRow(toState = state, count = rows.size, avgIntervalSec = avgInterval)
        }
        .sortedByDescending { it.count }

/**
 * The set of transition ids flagged as state-flapping — the exact port of the web `computeFlapIds`: per `fsm_name`,
 * over the time-sorted rows, any 60-second forward window containing more than five transitions marks every row in
 * that window as flapped.
 */
fun computeFlapIds(transitions: List<FsmTransition>): Set<Long> {
    val flapped = mutableSetOf<Long>()
    val byType = transitions.groupBy { it.fsmName }
    for ((_, list) in byType) {
        val sorted = list.sortedBy { parseEpochMillis(it.ts) ?: Long.MIN_VALUE }
        for (i in sorted.indices) {
            val start = parseEpochMillis(sorted[i].ts) ?: continue
            val windowEnd = start + FLAP_WINDOW_MILLIS
            var count = 0
            var j = i
            while (j < sorted.size) {
                val tj = parseEpochMillis(sorted[j].ts) ?: break
                if (tj <= windowEnd) count++ else break
                j++
            }
            if (count > FLAP_THRESHOLD) {
                var k = i
                while (k < sorted.size) {
                    val tk = parseEpochMillis(sorted[k].ts) ?: break
                    if (tk <= windowEnd) flapped.add(sorted[k].id) else break
                    k++
                }
            }
        }
    }
    return flapped
}

// ── Formatters (web `formatDuration` / `fmtInt` / `TimeStamp`) ────────────────────────────────────────────────────

/** Human duration for an interval in [seconds] — the exact port of the web `formatDuration`. */
fun formatDuration(seconds: Double): String {
    if (seconds < SECONDS_PER_MINUTE) return "${seconds.roundToLong()}s"
    if (seconds < SECONDS_PER_HOUR) return "${(seconds / SECONDS_PER_MINUTE).roundToLong()}m"
    val hours = floor(seconds / SECONDS_PER_HOUR).toLong()
    val minutesRaw = (seconds % SECONDS_PER_HOUR) / SECONDS_PER_MINUTE
    return if (minutesRaw >= 0.5) "${hours}h ${minutesRaw.roundToLong()}m" else "${hours}h"
}

/** Thousands-grouped integer for the count/total labels (web `fmtInt`). Locale-stable so derivations test cleanly. */
fun formatCount(value: Int): String {
    val negative = value < 0
    val digits = kotlin.math.abs(value.toLong()).toString()
    val grouped = digits.reversed().chunked(3).joinToString(",").reversed()
    return if (negative) "-$grouped" else grouped
}

/** Absolute wall-clock stamp for a transition [ts] (web `TimeStamp format="absolute"`); falls back to the raw value. */
fun formatAbsoluteTime(ts: String): String = formatWith(ts, ABSOLUTE_FORMAT)

/** Compact `HH:mm:ss` stamp for the dense table/timeline (web relative `TimeStamp`); falls back to the raw value. */
fun formatClockTime(ts: String): String = formatWith(ts, CLOCK_FORMAT)

/** Parse an RFC-3339 instant (with `Z` or a numeric offset) to epoch millis, or `null` when unparseable. */
fun parseEpochMillis(ts: String): Long? {
    if (ts.isBlank()) return null
    return runCatching { Instant.parse(ts).toEpochMilli() }
        .recoverCatching { OffsetDateTime.parse(ts).toInstant().toEpochMilli() }
        .getOrNull()
}

private val ABSOLUTE_FORMAT: DateTimeFormatter =
    DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm:ss").withZone(ZoneId.systemDefault())

private val CLOCK_FORMAT: DateTimeFormatter =
    DateTimeFormatter.ofPattern("HH:mm:ss").withZone(ZoneId.systemDefault())

private fun formatWith(
    ts: String,
    formatter: DateTimeFormatter,
): String {
    val millis = parseEpochMillis(ts) ?: return ts
    return runCatching { formatter.format(Instant.ofEpochMilli(millis)) }.getOrDefault(ts)
}

// ── Internal JSON accessors (mirroring the CommandsPage decoder helpers) ──────────────────────────────────────────

private fun JsonObject.stringField(key: String): String? = (this[key] as? JsonPrimitive)?.contentOrNull

private fun JsonObject.longField(key: String): Long? = (this[key] as? JsonPrimitive)?.longOrNull

private fun JsonObject.intField(key: String): Int? = (this[key] as? JsonPrimitive)?.intOrNull

private fun JsonObject.boolField(key: String): Boolean? = (this[key] as? JsonPrimitive)?.booleanOrNull
