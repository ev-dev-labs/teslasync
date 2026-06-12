// Pure, framework-free model + projection for the FSMSubFSMPanel feature view — the native analogue of
// everything the web component derives before returning JSX
// (web/src/features/system/components/FSMSubFSMPanel.tsx). No Compose, no Android, no HTTP: every
// declaration here is unit-tested off-device in the :android:testReleaseUnitTest gate, keeping the
// composable a thin render layer over these pure functions.
//
// The web component is purely presentational: it takes the already-decoded `activeSubs` + the active
// `fsmType` filter as props (its only hook is `useTranslation`) and renders the vehicle's active drive /
// charge sub-FSMs as a small grid, or an empty state when there are none — and renders nothing at all when
// the debugger is filtered to a non-vehicle FSM. The native surface keeps that contract: it binds no data
// hook of its own. The host supplies the sub-FSM rows through the shared P1/S8 state-holder layer (the
// `FsmStore.stats` cache-then-network feed, whose `active_subs` payload this file decodes) as a [UiState],
// so the view also renders every lifecycle state that layer can carry — loading, hard error, empty,
// content, and stale/offline ("last known") — without ever fetching.
//
// This file owns the parts the web component computes from those props: the `fsmType === 'vehicle' ||
// 'all'` visibility gate, the `type === 'drive'` icon/label/terminal-state branch, the
// `!terminalStates.includes(state)` active test, the `getStateColor(fsmType, state)` → semantic tone
// mapping (a faithful collapse of the web FSM registry's per-state base `variant`), the tolerant
// ISO-8601 → epoch-millis parse the relative-time chip builds on, the `active_subs` JSON decode, the
// `(subs, isLoading, error)` / `Resource` → lifecycle [UiState] adapters, and the PII-safe `view.opened`
// diagnostic.
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/feature-views/FSMSubFSMPanel — the P3 prompt's allowed-files path) cannot form a valid
// Kotlin package (a hyphen and a PascalCase segment are illegal in a package identifier), so the package
// intentionally diverges from the path — exactly as the sibling feature-view surfaces do.
// `MatchingDeclarationName` is suppressed for the co-located supporting declarations.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.fsmsubfsmpanel

import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import io.teslasync.android.data.errorKindOf
import io.teslasync.android.data.httpStatusOf
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.longOrNull
import java.time.Instant
import java.time.LocalDateTime
import java.time.OffsetDateTime
import java.time.ZoneOffset
import java.time.format.DateTimeParseException

/**
 * Diagnostics surface slug emitted with the `view.opened` event (P1/S11). Carries no vehicle id, drive /
 * session id, or state, so a diagnostics line can never leak the fleet's operational posture.
 */
const val FSM_SUB_FSM_PANEL_SLUG: String = "FSMSubFSMPanel"

// Raw wire field keys (snake_case, served verbatim by the Go FSM handler — no camelCaseKeys transform in
// the shared layer, so these match the wire contract in web/src/types/fsm/ui-types.ts). The `/fsm/stats`
// payload is `{ enabled, stats:{state→ms}, active_subs:[{ type, state, start_time, drive_id?, session_id? }] }`.
private const val FIELD_ACTIVE_SUBS = "active_subs"
private const val FIELD_TYPE = "type"
private const val FIELD_STATE = "state"
private const val FIELD_START_TIME = "start_time"
private const val FIELD_DRIVE_ID = "drive_id"
private const val FIELD_SESSION_ID = "session_id"

private const val WIRE_TYPE_DRIVE = "drive"

/**
 * The kind of sub-FSM a vehicle can be running — the native mirror of the web `ActiveSubFSM['type']`
 * union (`'drive' | 'charge'`). The web component branches binarily (`type === 'drive' ? … : …`), so
 * anything that is not the literal `"drive"` is treated as a charge session; [fromWire] reproduces that
 * exactly, keeping the surface forward-compatible if the backend ever adds a value.
 */
enum class SubFsmKind {
    Drive,
    Charge,
    ;

    companion object {
        /** Maps the wire `type` string onto a [SubFsmKind] — `"drive"` ⇒ [Drive], everything else ⇒ [Charge]. */
        fun fromWire(wire: String?): SubFsmKind = if (wire == WIRE_TYPE_DRIVE) Drive else Charge
    }
}

/**
 * Semantic tone of a sub-FSM state badge — a pure, framework-free enum the composable maps to a
 * `components/ui` `BadgeVariant` / status color. It is the native collapse of the web FSM registry's
 * per-state base `variant` (web/src/types/fsm/{drive,charge}-session.ts + theme.ts): the registry's
 * cosmetic hue overrides (orange/indigo/purple/cyan) fold back to their semantic base band so the badge
 * stays on the design-token palette, mirroring how the native `FSMBadge` already maps web FSM colors.
 */
enum class SubFsmStateTone { Success, Warning, Info, Neutral }

/**
 * One active sub-FSM row — the native mirror of the web `ActiveSubFSM` interface. SI/units-free: a
 * [kind], its current [state] name, the ISO-8601 [startTime] the relative-time chip renders, and the
 * optional originating [driveId] / [sessionId]. Decoded from the shared `FsmStore.stats` feed by
 * [parseActiveSubs]; the host never hands the view raw JSON.
 */
data class ActiveSubFsm(
    val kind: SubFsmKind,
    val state: String,
    val startTime: String,
    val driveId: Long? = null,
    val sessionId: Long? = null,
)

/**
 * Pure projection from the panel's inputs to its render state — a 1:1 port of the web component's branch
 * ladder and per-row derivations. Stateless and side-effect-free so it is fully covered by the off-device
 * unit gate; the composable only resolves localized strings, picks colors, and draws what these return.
 */
object FSMSubFSMPanelProjection {
    /** Drive-session terminal states — the web `['completed', 'recovered']`. */
    private val DRIVE_TERMINAL_STATES = setOf("completed", "recovered")

    /** Charge-session terminal states — the web `['done', 'recovered']`. */
    private val CHARGE_TERMINAL_STATES = setOf("done", "recovered")

    /**
     * Whether the panel renders at all — the web `fsmType === 'vehicle' || fsmType === 'all'` gate that
     * returns `null` for any other debugger filter (the sub-FSMs are a vehicle-FSM concept). The composable
     * draws nothing when this is `false`, exactly like the web early `return null`.
     */
    fun isVehicleView(fsmType: String): Boolean = fsmType == "vehicle" || fsmType == "all"

    /**
     * Whether a sub-FSM is still live — the web `!terminalStates.includes(sub.state)` test, with the
     * terminal set selected by [ActiveSubFsm.kind] (drive ⇒ completed/recovered, charge ⇒ done/recovered).
     * The active row gets the green icon chip + the pulsing dot; a terminal row is shown muted.
     */
    fun isActive(sub: ActiveSubFsm): Boolean {
        val terminal = if (sub.kind == SubFsmKind.Drive) DRIVE_TERMINAL_STATES else CHARGE_TERMINAL_STATES
        return sub.state.lowercase() !in terminal
    }

    /**
     * Maps a sub-FSM (kind + state) to its badge [SubFsmStateTone] — the native resolution of the web
     * `getStateColor(fsmType, state)` for the two sub-FSM machines. State names are matched case-insensitively
     * (the web `getStateColor` lowercases first); an unknown state folds to [SubFsmStateTone.Neutral] (the web
     * `DEFAULT_STATE`).
     */
    fun stateTone(
        kind: SubFsmKind,
        state: String,
    ): SubFsmStateTone =
        when (kind) {
            SubFsmKind.Drive -> driveTone(state.lowercase())
            SubFsmKind.Charge -> chargeTone(state.lowercase())
        }

    private fun driveTone(state: String): SubFsmStateTone =
        when (state) {
            "pending" -> SubFsmStateTone.Warning
            "active" -> SubFsmStateTone.Success
            "ending" -> SubFsmStateTone.Warning
            "completed" -> SubFsmStateTone.Info
            "recovered" -> SubFsmStateTone.Neutral
            else -> SubFsmStateTone.Neutral
        }

    private fun chargeTone(state: String): SubFsmStateTone =
        when (state) {
            "pending" -> SubFsmStateTone.Warning
            "active" -> SubFsmStateTone.Success
            "completing" -> SubFsmStateTone.Info
            "done" -> SubFsmStateTone.Success
            "recovered" -> SubFsmStateTone.Neutral
            else -> SubFsmStateTone.Neutral
        }

    /**
     * Decodes the raw `/fsm/stats` [json] into the sub-FSM rows the web reads as
     * `statsQuery.data?.active_subs ?? []`. A non-object input, a missing `active_subs` array, or a malformed
     * element all collapse to an empty / skipped entry, reproducing the web optional-chaining; insertion
     * order is preserved. Missing `type`/`state`/`start_time` fall back to charge/empty so a partial row
     * still renders (with an em-dash relative time) rather than throwing.
     */
    fun parseActiveSubs(json: JsonElement?): List<ActiveSubFsm> {
        val array = (json as? JsonObject)?.get(FIELD_ACTIVE_SUBS) as? JsonArray ?: return emptyList()
        return array.mapNotNull { element ->
            val obj = element as? JsonObject ?: return@mapNotNull null
            ActiveSubFsm(
                kind = SubFsmKind.fromWire(obj.stringField(FIELD_TYPE)),
                state = obj.stringField(FIELD_STATE) ?: "",
                startTime = obj.stringField(FIELD_START_TIME) ?: "",
                driveId = obj.longField(FIELD_DRIVE_ID),
                sessionId = obj.longField(FIELD_SESSION_ID),
            )
        }
    }

    /**
     * Maps the web hook's `(activeSubs, isLoading, isFetching, error)` fields onto the shared
     * cache-then-network [UiState] (P1/S8), reproducing the web component's body branch precedence: a first
     * load wins over everything ([UiPhase.Loading]); else a hard error ([UiPhase.Error], the retry button is
     * the recovery); else an empty list is the web `subs.length === 0` empty state ([UiPhase.Empty]); else
     * the grid ([UiPhase.Content]). [isFetching] is carried as [UiState.refreshing]. The host's own state
     * holder can instead emit a richer [UiState] carrying stale/offline via [projectFromResource]; the
     * composable renders those too.
     */
    fun projectUiState(
        activeSubs: List<ActiveSubFsm>,
        isLoading: Boolean,
        isFetching: Boolean,
        error: Boolean,
    ): UiState<List<ActiveSubFsm>> =
        when {
            isLoading -> UiState(phase = UiPhase.Loading, refreshing = isFetching)
            error -> UiState(phase = UiPhase.Error, errorKind = ErrorKind.Unknown, refreshing = isFetching)
            activeSubs.isEmpty() -> UiState(phase = UiPhase.Empty, data = emptyList(), refreshing = isFetching)
            else -> UiState(phase = UiPhase.Content, data = activeSubs, refreshing = isFetching)
        }

    /**
     * Folds the shared `FsmStore.stats` cache-then-network [res] (ADR-013 [Resource]) directly onto the
     * [UiState] surface — the binding a host uses when it owns the feed rather than the decoded list. A first
     * load with nothing cached is [UiPhase.Loading]; a hard error with no cached payload is [UiPhase.Error];
     * otherwise the cached/fresh `active_subs` drive the empty/content split while a failed refresh over
     * cached data keeps the rows visible and flags stale + errorKind ("last known"), so the surface never
     * blanks on a transient network blip.
     */
    fun projectFromResource(res: Resource<JsonElement>): UiState<List<ActiveSubFsm>> {
        val cached = parseActiveSubs(present(res.cached))
        return when {
            res is Resource.Loading && res.cached == null -> UiState.loading()
            res is Resource.Error && res.cached == null ->
                UiState(
                    phase = UiPhase.Error,
                    fetchedAt = res.fetchedAt,
                    stale = res.stale,
                    errorKind = errorKindOf(res.error),
                    httpStatus = httpStatusOf(res.error),
                )
            else -> {
                val err = res as? Resource.Error
                UiState(
                    phase = if (cached.isEmpty()) UiPhase.Empty else UiPhase.Content,
                    data = cached,
                    fetchedAt = fetchedAtOf(res),
                    stale = res.stale || err != null,
                    refreshing = res is Resource.Loading,
                    errorKind = err?.let { errorKindOf(it.error) },
                    httpStatus = err?.let { httpStatusOf(it.error) },
                )
            }
        }
    }

    /**
     * Tolerant ISO-8601 → epoch-millisecond parse for the `start_time` instant the relative-time chip
     * renders. Accepts an RFC-3339 instant (`…Z`), an offset date-time, or a zoneless local date-time
     * treated as UTC; a blank or unparseable value yields `null` (the render layer then shows the em-dash
     * fallback). Pure (java.time only) so it is unit-tested deterministically.
     */
    fun parseIsoMillis(raw: String?): Long? {
        if (raw.isNullOrBlank()) return null
        return PARSERS.firstNotNullOfOrNull { it(raw) }
    }

    private val PARSERS: List<(String) -> Long?> =
        listOf(
            { raw -> tryParse { Instant.parse(raw).toEpochMilli() } },
            { raw -> tryParse { OffsetDateTime.parse(raw).toInstant().toEpochMilli() } },
            { raw -> tryParse { LocalDateTime.parse(raw).toInstant(ZoneOffset.UTC).toEpochMilli() } },
        )

    private fun tryParse(block: () -> Long): Long? =
        try {
            block()
        } catch (_: DateTimeParseException) {
            null
        }

    /** A JSON value that is genuinely present (web truthy): non-null and not the JSON `null` literal. */
    private fun present(element: JsonElement?): JsonElement? = element?.takeIf { it !is JsonNull }

    private fun fetchedAtOf(res: Resource<*>): Long? =
        when (res) {
            is Resource.Loading -> res.fetchedAt
            is Resource.Success -> res.fetchedAt
            is Resource.Error -> res.fetchedAt
        }?.takeIf { it > 0L }

    /** Read a JSON string field, or `null` when absent / JSON `null` / not a quoted string. */
    private fun JsonObject.stringField(key: String): String? =
        (this[key] as? JsonPrimitive)?.let { if (it.isString) it.contentOrNull else null }

    /** Read a JSON number field as a Long, or `null` when absent / JSON `null` / not a number. */
    private fun JsonObject.longField(key: String): Long? = (this[key] as? JsonPrimitive)?.longOrNull
}

/**
 * Emits the one PII-safe `view.opened` diagnostic with the surface [FSM_SUB_FSM_PANEL_SLUG] (P1/S11). Kept
 * free of Compose so it is unit-tested with a recording [Logger]; the composable calls it from its
 * first-composition effect.
 */
fun recordFsmSubFsmPanelOpened(logger: Logger) {
    logger.info("view.opened", mapOf("surface" to FSM_SUB_FSM_PANEL_SLUG))
}
