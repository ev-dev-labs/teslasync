// Pure, framework-free model + projection for the FSMStateDiagram feature view — the native analogue of
// everything the web component derives before returning JSX
// (web/src/features/system/components/FSMStateDiagram.tsx + web/src/types/fsm/*). No Compose, no Android
// framework, no HTTP: every declaration here is unit-tested off-device in the :android:testReleaseUnitTest
// gate, keeping the composable a thin render layer.
//
// The web component is purely presentational — its parent (the FSM state-machine debugger page) owns the
// `useFSMTransitions` query and passes the `transitions` array down; the component's only hook is
// `useTranslation`. This file owns the parts the web component computes from the `fsmType` + `transitions`
// props: the per-fsm ordered state list + semantic state variant (web `FSM_STATES` + `getStateColor`), the
// transition roll-up into per-state counts / per-edge counts / latest ("current") state (the web `useMemo`),
// the rendered node + arrow + edge-summary view models (the web JSX derivations), and the lifecycle
// classifier the composable switches on. An unknown `fsmType` (e.g. the web `all`, which has no `FSM_STATES`
// entry) yields a null projection so the composable shows the "select a specific FSM type" empty state — the
// web `if (!states || !edges)` branch.
//
// Color decision (parity + P1/S9): the web `getStateColor` resolves each state to a semantic `BadgeVariant`
// (success/warning/danger/info/neutral — the `theme.ts` `VARIANT_THEME` source of truth) and then applies
// optional Tailwind-class `overrides` (e.g. charging->cyan, parked->purple). This port reproduces the
// semantic variant faithfully and maps it to a platform design token at the render boundary, reusing the
// same Badge/FSMDistributionWidget/StateTimelineWidget token convention. The web per-state Tailwind
// `overrides` are class strings with no native token equivalent; per the platform guideline ("use platform
// tokens, do not port Tailwind classes") they are intentionally collapsed to the state's semantic variant
// rather than approximated with raw hex. The variant data itself is ported verbatim.
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/feature-views/FSMStateDiagram — the P3 prompt's allowed-files path) cannot form a valid
// Kotlin package (a hyphen and a PascalCase segment are illegal in a package identifier), so the package
// intentionally diverges from the path — exactly as the sibling feature-view surfaces do.
// `MatchingDeclarationName` is suppressed for the co-located supporting types.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.fsmstatediagram

import java.time.Instant
import java.time.LocalDateTime
import java.time.OffsetDateTime
import java.time.ZoneOffset
import java.time.format.DateTimeParseException
import java.util.Locale

/**
 * Diagnostics surface slug emitted with the `view.opened` event (P1/S11). Carries no VIN, vehicle id, or
 * transition detail, so a diagnostics line can never leak a vehicle's state history.
 */
const val FSM_STATE_DIAGRAM_SLUG: String = "FSMStateDiagram"

/** The web `fsmType === 'all'` sentinel: counts every FSM's transitions rather than filtering by name. */
internal const val FSM_TYPE_ALL: String = "all"

/** The web default `fsmType` the registry falls back to for an unknown key (web `FSM_REGISTRY.vehicle`). */
internal const val FSM_TYPE_VEHICLE: String = "vehicle"

/** The web edge key separator (`${from}->${to}`) shared by the roll-up, the arrow label, and the summary. */
internal const val EDGE_SEPARATOR: String = "->"

/** The web edge-summary cap (`.slice(0, 10)`): only the ten busiest transitions are chipped. */
internal const val EDGE_SUMMARY_LIMIT: Int = 10

// ── i18n key mirrors (P1/S10) ──
// The web `t('fsm.*')` keys, flattened to the generated Android catalog names. Referencing them in one place
// keeps the composable and the off-device test in lockstep with the catalog and documents the web -> native
// key contract. Both keys already exist in res/values/strings.xml.

/** Panel heading — web `t('fsm.stateDiagram', 'State Diagram')`. */
const val KEY_STATE_DIAGRAM: String = "translation_fsm_stateDiagram"

/** Empty-state copy — web `t('fsm.selectFsmType', 'Select a specific FSM type to view its state diagram')`. */
const val KEY_SELECT_FSM_TYPE: String = "translation_fsm_selectFsmType"

/**
 * Semantic state tone — the native analogue of the web `BadgeVariant` (`theme.ts` `VARIANT_THEME`) that
 * `getStateColor` resolves every FSM state to. The composable maps each tone to a design token (never raw
 * hex), so light/dark/high-contrast all stay correct. Kept Compose-free so the registry + projection are
 * unit-tested off-device.
 */
enum class FsmStateTone { Success, Warning, Danger, Info, Neutral }

/**
 * One FSM state as the diagram knows it — its [name] (the web state-name string, in its canonical FSM order)
 * and its semantic [tone]. Pure data; the composable resolves [tone] to a color.
 */
data class FsmStateDef(
    val name: String,
    val tone: FsmStateTone,
)

/**
 * One FSM's diagram definition — the ordered [states] the web `FSM_STATES[fsmType]` exposes. The web also
 * carries an `edges` adjacency (`FSM_EDGES[fsmType]`), but the component only reads it for the
 * `if (!states || !edges)` known-type guard — its `outEdges` map is computed and never rendered — so the
 * presence of a definition is the faithful equivalent and the dead adjacency is intentionally not ported.
 */
data class FsmDefinition(
    val states: List<FsmStateDef>,
)

/**
 * The minimal typed projection of one web `FSMTransition` this surface consumes (web reads `fsm_name`,
 * `from_state`, `to_state`, `ts` in its `useMemo`; `id`/`vehicle_id`/`trigger`/`details` are unused here and
 * intentionally omitted). The host parses the shared FsmStore's raw `JsonElement` transition feed into these
 * rows and passes them down, mirroring the web parent handing the component its `transitions` prop.
 */
data class FsmTransitionRow(
    val fsmName: String,
    val fromState: String,
    val toState: String,
    val ts: String,
)

/**
 * The web FSM registry, reduced to exactly what the diagram reads: per `fsmType`, the ordered state list +
 * each state's semantic variant. Ported verbatim from the `web/src/types/fsm` files (`*_STATES` order +
 * `*_STATE_ENTRIES[state].variant`). The eight registered machines mirror `FSM_REGISTRY`; the web `all`
 * filter has no `FSM_STATES` entry, so [definitionFor]`("all")` is null (the empty-state branch).
 */
object FsmRegistry {
    private fun def(vararg states: Pair<String, FsmStateTone>): FsmDefinition =
        FsmDefinition(states.map { (name, tone) -> FsmStateDef(name, tone) })

    /** fsmType -> ordered definition. Keys + order + tones match `web/src/types/fsm/registry.ts`. */
    val definitions: Map<String, FsmDefinition> =
        mapOf(
            "vehicle" to
                def(
                    "online" to FsmStateTone.Success,
                    "driving" to FsmStateTone.Success,
                    "charging" to FsmStateTone.Warning,
                    "parked" to FsmStateTone.Info,
                    "updating" to FsmStateTone.Info,
                    "asleep" to FsmStateTone.Neutral,
                    "offline" to FsmStateTone.Danger,
                ),
            "drive_session" to
                def(
                    "pending" to FsmStateTone.Warning,
                    "active" to FsmStateTone.Success,
                    "ending" to FsmStateTone.Warning,
                    "completed" to FsmStateTone.Info,
                    "recovered" to FsmStateTone.Neutral,
                ),
            "charge_session" to
                def(
                    "pending" to FsmStateTone.Warning,
                    "active" to FsmStateTone.Success,
                    "completing" to FsmStateTone.Info,
                    "done" to FsmStateTone.Success,
                    "recovered" to FsmStateTone.Neutral,
                ),
            "command" to
                def(
                    "queued" to FsmStateTone.Neutral,
                    "waking" to FsmStateTone.Warning,
                    "wake_confirmed" to FsmStateTone.Info,
                    "wake_timeout" to FsmStateTone.Warning,
                    "sending" to FsmStateTone.Info,
                    "succeeded" to FsmStateTone.Success,
                    "failed" to FsmStateTone.Danger,
                    "timed_out" to FsmStateTone.Warning,
                    "retrying" to FsmStateTone.Neutral,
                    "gave_up" to FsmStateTone.Danger,
                ),
            "notification" to
                def(
                    "created" to FsmStateTone.Neutral,
                    "sending" to FsmStateTone.Info,
                    "delivered" to FsmStateTone.Success,
                    "partial" to FsmStateTone.Warning,
                    "failed" to FsmStateTone.Danger,
                    "retrying" to FsmStateTone.Neutral,
                    "dead" to FsmStateTone.Danger,
                ),
            "alert_cooldown" to
                def(
                    "armed" to FsmStateTone.Success,
                    "fired" to FsmStateTone.Danger,
                    "suppressed" to FsmStateTone.Warning,
                ),
            "automation" to
                def(
                    "idle" to FsmStateTone.Neutral,
                    "evaluating" to FsmStateTone.Info,
                    "executing" to FsmStateTone.Warning,
                    "succeeded" to FsmStateTone.Success,
                    "partial" to FsmStateTone.Warning,
                    "failed" to FsmStateTone.Danger,
                    "retrying" to FsmStateTone.Warning,
                    "gave_up" to FsmStateTone.Danger,
                    "skipped" to FsmStateTone.Neutral,
                    "cooldown" to FsmStateTone.Neutral,
                    "disabled" to FsmStateTone.Danger,
                ),
            "telemetry_connection" to
                def(
                    "unknown" to FsmStateTone.Neutral,
                    "connecting" to FsmStateTone.Warning,
                    "streaming" to FsmStateTone.Success,
                    "stale" to FsmStateTone.Warning,
                    "disconnected" to FsmStateTone.Danger,
                    "polling_only" to FsmStateTone.Info,
                ),
        )

    /** The ordered definition for [fsmType], or null for an unknown key (web `FSM_STATES[fsmType]`). */
    fun definitionFor(fsmType: String): FsmDefinition? = definitions[fsmType]

    /**
     * The semantic tone for [state] within [fsmType] — the native analogue of the web `getStateColor`: an
     * unknown [fsmType] falls back to the vehicle machine's states, and an unknown [state] (matched
     * case-insensitively, like the web `states[state.toLowerCase()]`) folds to [FsmStateTone.Neutral] (the
     * web `DEFAULT_STATE`). Used for both the rendered nodes and the edge-summary chips (whose from/to may be
     * any state name present in the data).
     */
    fun toneFor(
        fsmType: String,
        state: String,
    ): FsmStateTone {
        val def = definitions[fsmType] ?: definitions.getValue(FSM_TYPE_VEHICLE)
        val key = state.lowercase(Locale.ROOT)
        return def.states.firstOrNull { it.name.lowercase(Locale.ROOT) == key }?.tone ?: FsmStateTone.Neutral
    }
}

/** The already-localized strings the panel renders. The web reads each via `t('fsm.*')`. */
data class FsmStateDiagramStrings(
    val title: String,
    val selectFsmType: String,
)

/**
 * One render-ready state node — the native mirror of a single rendered web node. [count] is the roll-up of
 * transitions touching this state; [isCurrent] marks the latest `to_state` (the web pulsing indicator);
 * [isActive] is the web `count > 0` (an inactive node renders dimmed, never hidden); [arrowCountToNext] is
 * the transition count for the `name->nextState` edge shown above the arrow, or null when absent / last.
 */
data class FsmStateNodeVm(
    val name: String,
    val tone: FsmStateTone,
    val count: Int,
    val isCurrent: Boolean,
    val isActive: Boolean,
    val hasArrow: Boolean,
    val arrowCountToNext: Int?,
)

/**
 * One edge-summary chip — the native mirror of a rendered web summary entry (`from -> to xcount`). [from] and
 * [to] carry their own resolved [fromTone]/[toTone] so the chip colors each endpoint like the web does.
 */
data class FsmEdgeSummaryVm(
    val from: String,
    val fromTone: FsmStateTone,
    val to: String,
    val toTone: FsmStateTone,
    val count: Int,
)

/**
 * The fully projected diagram for a KNOWN fsmType — the ordered [nodes] (always rendered, dimmed when
 * inactive) and the top-[EDGE_SUMMARY_LIMIT] [edgeSummary] chips (present only when transitions produced
 * edges, the web `edgeCounts.size > 0` guard). A null projection (unknown fsmType) is the empty-state branch.
 */
data class FsmDiagramContent(
    val nodes: List<FsmStateNodeVm>,
    val edgeSummary: List<FsmEdgeSummaryVm>,
)

/** The intermediate transition roll-up — the web `useMemo` result before the JSX derivations. */
internal data class FsmTransitionRollup(
    val stateCounts: Map<String, Int>,
    val edgeCounts: Map<String, Int>,
    val latestState: String,
)

/**
 * The pure projection the composable renders — the native mirror of the web component's render-time
 * derivations (the `useMemo` roll-up + the node/arrow/edge-summary JSX). Stateless and side-effect-free so
 * it is fully covered by the off-device unit gate.
 */
object FsmStateDiagramProjection {
    /** True when [fsmType] is a known machine (web `FSM_STATES[fsmType]` truthy). */
    fun isKnownFsmType(fsmType: String): Boolean = FsmRegistry.definitionFor(fsmType) != null

    /**
     * Projects [fsmType] + [transitions] into the render-ready [FsmDiagramContent], or null when [fsmType] is
     * unknown (the web `if (!states || !edges)` empty-state branch). For a known type the nodes are always
     * produced from the canonical state order (dimmed when their count is zero — never hidden), and the edge
     * summary is the busiest transitions, exactly as the web JSX builds them.
     */
    fun project(
        fsmType: String,
        transitions: List<FsmTransitionRow>,
    ): FsmDiagramContent? {
        val def = FsmRegistry.definitionFor(fsmType) ?: return null
        val rollup = rollUp(fsmType, transitions)
        return FsmDiagramContent(
            nodes = nodes(def, rollup),
            edgeSummary = edgeSummary(fsmType, rollup.edgeCounts),
        )
    }

    /**
     * The web `useMemo`: count every transition touching each state (both `from` and `to`), tally per-edge
     * counts, and track the most-recent `to_state` as the current state. Transitions are filtered by
     * [fsmType] unless it is `all` (web `fsmType !== 'all' && tr.fsm_name !== fsmType` skip). An unparseable
     * `ts` never wins the "latest" race (web `NaN > latestTime` is always false).
     */
    internal fun rollUp(
        fsmType: String,
        transitions: List<FsmTransitionRow>,
    ): FsmTransitionRollup {
        val stateCounts = LinkedHashMap<String, Int>()
        val edgeCounts = LinkedHashMap<String, Int>()
        var latestState = ""
        var latestMillis = 0L
        for (tr in transitions) {
            if (fsmType != FSM_TYPE_ALL && tr.fsmName != fsmType) continue
            stateCounts[tr.toState] = (stateCounts[tr.toState] ?: 0) + 1
            stateCounts[tr.fromState] = (stateCounts[tr.fromState] ?: 0) + 1
            val edgeKey = tr.fromState + EDGE_SEPARATOR + tr.toState
            edgeCounts[edgeKey] = (edgeCounts[edgeKey] ?: 0) + 1
            val millis = parseTimestampMillis(tr.ts)
            if (millis != null && millis > latestMillis) {
                latestMillis = millis
                latestState = tr.toState
            }
        }
        return FsmTransitionRollup(stateCounts, edgeCounts, latestState)
    }

    /** Build the ordered node view models from the canonical state list + the roll-up (web node map). */
    private fun nodes(
        def: FsmDefinition,
        rollup: FsmTransitionRollup,
    ): List<FsmStateNodeVm> =
        def.states.mapIndexed { index, state ->
            val count = rollup.stateCounts[state.name] ?: 0
            val hasArrow = index < def.states.size - 1
            val arrowCountToNext =
                if (hasArrow) {
                    rollup.edgeCounts[state.name + EDGE_SEPARATOR + def.states[index + 1].name]
                } else {
                    null
                }
            FsmStateNodeVm(
                name = state.name,
                tone = state.tone,
                count = count,
                isCurrent = state.name == rollup.latestState && rollup.latestState.isNotEmpty(),
                isActive = count > 0,
                hasArrow = hasArrow,
                arrowCountToNext = arrowCountToNext,
            )
        }

    /**
     * The web edge summary: every observed edge, sorted by count descending, capped at
     * [EDGE_SUMMARY_LIMIT], split back into from/to and re-colored. A stable secondary sort by edge key keeps
     * the ordering deterministic for equal counts (the web relies on `Map` insertion order; this is the
     * deterministic, test-friendly equivalent).
     */
    private fun edgeSummary(
        fsmType: String,
        edgeCounts: Map<String, Int>,
    ): List<FsmEdgeSummaryVm> =
        edgeCounts.entries
            .sortedWith(compareByDescending<Map.Entry<String, Int>> { it.value }.thenBy { it.key })
            .take(EDGE_SUMMARY_LIMIT)
            .mapNotNull { (edge, count) ->
                val parts = edge.split(EDGE_SEPARATOR)
                if (parts.size != 2) {
                    null
                } else {
                    FsmEdgeSummaryVm(
                        from = parts[0],
                        fromTone = FsmRegistry.toneFor(fsmType, parts[0]),
                        to = parts[1],
                        toTone = FsmRegistry.toneFor(fsmType, parts[1]),
                        count = count,
                    )
                }
            }

    /**
     * Tolerant ISO-8601 -> epoch-ms parse — the native analogue of the web `new Date(tr.ts).getTime()`. Tries
     * an RFC-3339 instant, then an offset date-time, then a zoneless local date-time treated as UTC; a blank
     * or unparseable value yields null so it never wins the "latest" race.
     */
    fun parseTimestampMillis(ts: String?): Long? {
        if (ts.isNullOrBlank()) return null
        return parsers.firstNotNullOfOrNull { it(ts) }
    }

    private val parsers: List<(String) -> Long?> =
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
}

/**
 * The mutually-exclusive top-level surface the composable switches on — the native lifecycle chrome the
 * host's cache-then-network feed implies around the web component's content/empty branches. [Ready] then
 * internally renders the diagram or the "select a specific FSM type" empty state from the projection;
 * [Loading]/[Error] render the first-load skeleton and the retry surface.
 */
enum class FsmStateDiagramSurface { Loading, Error, Ready }

/**
 * Classifies the lifecycle flags of a `UiState` into the surface to render. A first load with nothing cached
 * shows [Loading]; a hard error with no cached fallback shows [Error]; everything else (content, empty, and
 * stale/offline "last known") is [Ready] and lets the projection decide diagram-vs-empty. Loading takes
 * precedence over error so a refresh-with-skeleton never flashes the error surface.
 */
fun fsmStateDiagramSurfaceFor(
    isLoading: Boolean,
    isError: Boolean,
): FsmStateDiagramSurface =
    when {
        isLoading -> FsmStateDiagramSurface.Loading
        isError -> FsmStateDiagramSurface.Error
        else -> FsmStateDiagramSurface.Ready
    }
