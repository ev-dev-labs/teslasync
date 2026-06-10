package io.teslasync.shared.core.data.repo

import kotlinx.coroutines.flow.Flow
import kotlinx.serialization.json.JsonElement

/**
 * The S7 data port for the FSM shadow-mode debugger — the cross-platform analogue of the web
 * `useFSM` hook domain (web/src/api/hooks/useFSM.ts), backed by the Go handlers under
 * `/api/v1/fsm/stats` and `/api/v1/fsm/transitions`. Every native FSM surface (Android/Apple via KMP, Windows via the C# port)
 * reaches the backend exclusively through this interface, so a single fake stands in for the whole
 * domain in the S8 state-holder tests.
 *
 * The domain is two reads and no mutations — `useFSM.ts` contains exactly two `useQuery`s and no
 * mutations — so each read streams a cache-then-network [Resource] (ADR-013): the cached value
 * first for an instant cold start, then the refreshed value. There is nothing to invalidate here.
 *
 * Payloads are carried as raw [JsonElement] (the same verbatim-SI strategy as
 * [AnomaliesRepository]/[AdminRepository]): the FSM feeds are not unit-bearing (state names,
 * triggers, transition counts, timestamps, pagination ints), so there is no display conversion to
 * do here and the exact server shape round-trips unchanged.
 *
 * The web hooks gate both queries with `enabled: !!entityId`. That gate is a presentation concern
 * and lives in the S8 [io.teslasync.shared.core.presentation.fsm.FsmStore]; this port takes a
 * non-blank `entityId` and is only ever called once a vehicle is selected.
 *
 * The transitions query carries two client-side derivations ported from the web hook — the
 * `fsm_name` param ([fsmNameParam], suppressed for [FsmType.ALL]) and the half-open instant window
 * (the `start`/`end` pair, present only when both ends are supplied). Both are folded into the pure
 * [buildFsmTransitionsQuery] function and locked by golden vectors shared with the C# port so the
 * three platforms cannot drift (ADR-004).
 */
public interface FsmRepository {
    /**
     * `GET /fsm/stats?vehicle_id={entityId}` — the FSM shadow-mode stats envelope plus, when a
     * vehicle is supplied, its active sub-FSM state (web `useFSMStats`). `entityId` is snake_case
     * `vehicle_id`, matching the web template literal exactly.
     */
    public fun stats(entityId: String): Flow<Resource<JsonElement>>

    /**
     * `GET /fsm/transitions?vehicle_id={entityId}&hours={hours}&page={page}&per_page={perPage}`
     * (plus an optional `fsm_name` and an optional half-open `start`/`end` instant window) — the
     * paged FSM transition log (web `useFSMTransitions`). The query shape is the pure
     * [buildFsmTransitionsQuery] derivation; `startInstant`/`endInstantExclusive` MUST be RFC-3339
     * instants representing the half-open `[start, end)` window already resolved to the user's
     * display timezone, and both must be present for the window to be applied (mirroring the web
     * hook's `startInstant && endInstantExclusive` guard).
     */
    public fun transitions(
        entityId: String,
        fsmType: FsmType,
        hours: Int,
        page: Int,
        perPage: Int,
        startInstant: String? = null,
        endInstantExclusive: String? = null,
    ): Flow<Resource<JsonElement>>
}

/**
 * The closed set of FSM filters the web `FSMType` union exposes (`'all' | 'vehicle' |
 * 'telemetry_connection'`, web/src/types/fsm/ui-types.ts). [wire] is the exact `fsm_name` query
 * value the backend filters on; [ALL] has no wire value because it suppresses the `fsm_name`
 * param entirely (the web `fsmType === 'all' ? '' : fsm_name` branch).
 */
public enum class FsmType(
    public val wire: String?,
) {
    ALL(null),
    VEHICLE("vehicle"),
    TELEMETRY_CONNECTION("telemetry_connection"),
}

/**
 * The `fsm_name` param decision ported from the web `useFSMTransitions`
 * (`nameParam = fsmType === 'all' ? '' : '&fsm_name=' + fsmType`): [FsmType.ALL] suppresses the
 * param (returns `null`); every other filter contributes its [FsmType.wire] value. Pure and
 * language-neutral so the C# port mirrors it exactly (golden-locked, ADR-004).
 */
public fun fsmNameParam(fsmType: FsmType): String? = fsmType.wire

/**
 * The full `GET /fsm/transitions` query map ported from the web `useFSMTransitions` template
 * literal, in the web's parameter order:
 *  1. always `vehicle_id`, `hours`, `page`, `per_page`;
 *  2. `fsm_name` only for a non-[FsmType.ALL] filter ([fsmNameParam]);
 *  3. the half-open `start`/`end` instant window only when BOTH [startInstant] and
 *     [endInstantExclusive] are supplied (the web `startInstant && endInstantExclusive` guard) —
 *     a calendar-day-only or half-open shape never reaches the wire, which is what stops a
 *     non-UTC user from silently dropping today's local rows.
 *
 * Returned as an insertion-ordered map so the param order is stable and golden-comparable. Pure and
 * language-neutral so the C# port mirrors it exactly (golden-locked, ADR-004).
 */
public fun buildFsmTransitionsQuery(
    entityId: String,
    fsmType: FsmType,
    hours: Int,
    page: Int,
    perPage: Int,
    startInstant: String? = null,
    endInstantExclusive: String? = null,
): Map<String, String> {
    val query = LinkedHashMap<String, String>()
    query["vehicle_id"] = entityId
    query["hours"] = hours.toString()
    query["page"] = page.toString()
    query["per_page"] = perPage.toString()
    fsmNameParam(fsmType)?.let { query["fsm_name"] = it }
    if (startInstant != null && endInstantExclusive != null) {
        query["start"] = startInstant
        query["end"] = endInstantExclusive
    }
    return query
}

/**
 * The stable cache key for a transitions feed, mirroring the web `fsmKeys.transitions` query-key
 * tuple (`[entityId, fsmType, hours, page, perPage, startInstant ?? '', endInstant ?? '']`) so each
 * distinct filter/window/page combination caches independently. Pure and golden-locked (ADR-004).
 */
public fun fsmTransitionsKey(
    entityId: String,
    fsmType: FsmType,
    hours: Int,
    page: Int,
    perPage: Int,
    startInstant: String? = null,
    endInstantExclusive: String? = null,
): String =
    listOf(
        entityId,
        fsmType.name,
        hours.toString(),
        page.toString(),
        perPage.toString(),
        startInstant ?: "",
        endInstantExclusive ?: "",
    ).joinToString(":")
