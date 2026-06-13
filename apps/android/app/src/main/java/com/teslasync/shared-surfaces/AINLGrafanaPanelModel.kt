// Pure, framework-free model + parser + reducer + surface classifier for the AINLGrafanaPanel shared surface —
// the native analogue of everything the web component derives around its draft stream
// (web/src/components/ai/AINLGrafanaPanel.tsx → AIFeatureCard → AiOutputPanel, driven by useAiStream).
// No Compose, no Android UI, no HTTP: every declaration here is unit-tested off-device in the
// :android:testReleaseUnitTest gate, keeping the composable a thin render layer.
//
// The web surface is `withAiFeature('nl-grafana-panel', InnerSection)`. InnerSection POSTs `{ prompt }` to
// `/ai/power/grafana-panel/draft` via useAiStream, accumulates the streamed assistant prose, and watches the
// stream for a `tool_result` named `draft_grafana_panel` whose payload it parses (web `parseGrafanaPanelDraft`)
// into a typed [GrafanaPanelDraft]. The draft is captured locally — the LLM never mutates editor state — and is
// applied only through the host `onApply` callback after an explicit click. The HOC renders nothing when the AI
// feature is gated off, so the canonical baseline this surface ships against is "gate off => nothing rendered" —
// reproduced here as [DraftSurface.Hidden] (Honesty Covenant #9: documented, not silent). Every other state
// renders a non-blank surface as the P3 contract requires.
//
// The useAiStream lifecycle (idle -> streaming -> done | error) is mapped onto the P3 state vocabulary:
//   loading  => Streaming with no delta yet ([DraftSurface.Working], a thinking indicator)
//   empty    => Idle ([DraftSurface.Resting], the resting card inviting a draft) or a Done with no draft/prose
//   content  => Live (streaming partial prose) / Ready (a captured draft, ready to apply) / Narrated (prose,
//               no draft)
//   error    => Failed (no captured draft) — a QueryError-equivalent with retry
//   stale    => Ready/Narrated with a fetch older than the freshness window (a stale chip + manual redraft)
//   offline  => Cached (a network failure that keeps a draft captured before the failure + an offline chip)
// Two documented divergences from the templated cache-then-network feed (Honesty Covenant #9): (1) re-running
// an LLM generation is an explicit, billable action, so the stale surface invites a manual redraft rather than
// auto-refreshing; (2) because each draft is for a *different* prompt, a new request clears the prior draft
// (web `setDraft(null)` at start) rather than retaining it as cross-request "last known" — so the offline
// surface shows a cached value only when this very stream captured a draft before failing.
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/shared-surfaces — the P3 prompt's allowed-files path) cannot form a valid Kotlin package
// (a hyphen is illegal in a package identifier), so the package intentionally diverges from the path —
// exactly as the sibling AIChargingDiagnosis surface does. `MatchingDeclarationName` is suppressed for the
// co-located supporting declarations.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.ainlgrafanapanel

import io.teslasync.android.data.ErrorKind

/**
 * Diagnostics surface slug emitted with the `view.opened` event (P1/S11). Carries no VIN, prompt text, or any
 * generated content, so a diagnostics line can never leak the operator's fleet state or the model output.
 */
const val AI_NL_GRAFANA_PANEL_SLUG: String = "AINLGrafanaPanel"

/**
 * The tool name the LLM calls to emit a typed panel draft (web `ev.name === 'draft_grafana_panel'`). Any other
 * tool result is ignored by the reducer, exactly as the web `onEvent` filter does.
 */
const val DRAFT_GRAFANA_PANEL_TOOL: String = "draft_grafana_panel"

/**
 * How long a captured draft is considered fresh before the surface flags it stale and invites a manual redraft.
 * Five minutes mirrors the app's live-data staleness budget; it is generous because a panel draft does not
 * churn second-to-second and re-running the model is an explicit, billable action.
 */
const val GRAFANA_DRAFT_FRESHNESS_WINDOW_MS: Long = 5L * 60L * 1_000L

/**
 * The typed payload the Helix panel emits when the LLM successfully calls `draft_grafana_panel` — the native
 * mirror of the web `GrafanaPanelDraft` interface (and the Go-side `GrafanaPanelDraft` DTO). The field set is
 * intentionally narrow: only the panel envelope fields the deterministic Grafana editor already owns.
 *
 * @property prompt the natural-language request that produced this draft.
 * @property panel the proposed Grafana panel envelope.
 * @property rationale a plain-language explanation of why this panel answers the prompt.
 * @property referencedTables the source tables the draft's queries read from.
 */
data class GrafanaPanelDraft(
    val prompt: String,
    val panel: GrafanaPanelEnvelope,
    val rationale: String,
    val referencedTables: List<String>,
)

/** The proposed Grafana panel envelope (web `GrafanaPanelEnvelope`). */
data class GrafanaPanelEnvelope(
    val title: String,
    val type: String,
    val datasource: GrafanaDatasourceRef,
    val targets: List<GrafanaPanelTarget>,
    val gridPos: GrafanaPanelGridPos,
)

/** A Grafana datasource reference (web `GrafanaDatasourceRef`). */
data class GrafanaDatasourceRef(
    val type: String,
    val uid: String,
)

/** A single panel query target (web `GrafanaPanelTarget`); SQL or expression, with an optional render format. */
data class GrafanaPanelTarget(
    val refId: String,
    val rawSql: String? = null,
    val expr: String? = null,
    val format: String? = null,
)

/** The panel's grid placement (web `GrafanaPanelGridPos`). */
data class GrafanaPanelGridPos(
    val x: Int,
    val y: Int,
    val w: Int,
    val h: Int,
)

/** The useAiStream lifecycle, narrowed to what this surface reacts to (idle -> streaming -> done | failed). */
enum class DraftPhase {
    /** No draft requested yet — the resting card with the prompt field + Draft action (web `state === 'idle'`). */
    Idle,

    /** A stream is open; prose accumulates and a draft may be captured (web `state === 'streaming'`). */
    Streaming,

    /** The stream closed successfully — any captured [GrafanaDraftState.draft] is ready (web `state === 'done'`). */
    Done,

    /** The stream ended in a terminal error frame or threw (web `state === 'error'`). */
    Failed,
}

/**
 * One parsed frame of the draft stream — the native narrowing of the web `AiStreamEvent` union this surface
 * consumes. [Delta] frames accumulate prose; [ToolResult] carries a decoded tool payload the reducer parses;
 * [Done] closes the stream successfully; [Failed] carries the classified transport/HTTP failure so the render
 * boundary can localize it (never the raw provider message).
 */
sealed interface AiStreamChunk {
    /** A `delta` frame — a chunk of generated prose appended to the accumulator (web `delta.text`). */
    data class Delta(
        val text: String,
    ) : AiStreamChunk

    /**
     * A `tool_result` frame (web `ev.type === 'tool_result'`). [name] is matched against
     * [DRAFT_GRAFANA_PANEL_TOOL]; [data] is the decoded JSON object (web `ev.data`) the reducer feeds to
     * [parseGrafanaPanelDraft]. A non-draft tool or an unparseable payload is ignored, exactly as web does.
     */
    data class ToolResult(
        val name: String,
        val data: Map<String, Any?>?,
    ) : AiStreamChunk

    /** The terminal `done` frame — the stream finished cleanly. */
    data object Done : AiStreamChunk

    /** A terminal `error` frame — carries the [ErrorKind] the UI maps to localized recovery copy. */
    data class Failed(
        val errorKind: ErrorKind,
    ) : AiStreamChunk
}

/**
 * The immutable surface state the [AINLGrafanaPanelViewModel] exposes. It carries the AI feature gate (web
 * `withAiFeature`), the natural-language [prompt] (web `prompt` state -> `hasPrompt` -> `canDraft`), the stream
 * [phase], the in-flight [streamingText] prose accumulator (retained after a clean finish as the committed
 * narration), the captured [draft] (web `draft` state — cleared at each new request, set on a parsed tool
 * result), the classified [errorKind], and the completion [fetchedAt] stamp used for the freshness check.
 *
 * @property gateEnabled whether the AI feature is on (web `useAiEnabled('nl-grafana-panel')`).
 * @property prompt the natural-language panel request; blank/whitespace disables the Draft action.
 * @property phase the stream lifecycle phase.
 * @property streamingText the delta accumulator for the in-flight stream (web useAiStream `text`).
 * @property draft the captured typed draft, or `null` until the LLM calls `draft_grafana_panel`.
 * @property errorKind the classification of the most recent failure, or `null`.
 * @property fetchedAt epoch-millis stamp of the completed stream, or `null` when nothing has completed.
 */
data class GrafanaDraftState(
    val gateEnabled: Boolean = true,
    val prompt: String = "",
    val phase: DraftPhase = DraftPhase.Idle,
    val streamingText: String = "",
    val draft: GrafanaPanelDraft? = null,
    val errorKind: ErrorKind? = null,
    val fetchedAt: Long? = null,
) {
    /** The trimmed request (web `prompt.trim()`). */
    val trimmedPrompt: String get() = prompt.trim()

    /** Web `hasPrompt = trimmed.length > 0`: the Draft action requires a non-blank request. */
    val hasPrompt: Boolean get() = trimmedPrompt.isNotEmpty()

    /** True while a stream is open (drives the button's busy affordance + disables re-entry). */
    val isStreaming: Boolean get() = phase == DraftPhase.Streaming

    /** Web `canDraft = !isStreaming && hasPrompt`: the Draft action is available only when idle with a request. */
    val canDraft: Boolean get() = !isStreaming && hasPrompt

    /** Web `canApply = !!draft && !isStreaming`: Apply is enabled once a draft is captured and the stream ends. */
    val canApply: Boolean get() = draft != null && !isStreaming
}

/**
 * Opens a fresh draft: enter [DraftPhase.Streaming], clear the prose accumulator, drop any prior draft (web
 * `setDraft(null)` at `start()`), and clear any prior error. The cleared draft is why the offline surface only
 * shows a cached value when *this* stream captures one before failing — a deliberate divergence from a
 * cross-request "last known" feed (Honesty Covenant #9), because each draft answers a different prompt.
 */
fun GrafanaDraftState.startDrafting(): GrafanaDraftState =
    copy(phase = DraftPhase.Streaming, streamingText = "", draft = null, errorKind = null)

/** Reduces one parsed [AiStreamChunk] into the next state (delta accumulation / tool capture / done / failure). */
fun GrafanaDraftState.onChunk(
    chunk: AiStreamChunk,
    nowMs: Long,
): GrafanaDraftState =
    when (chunk) {
        is AiStreamChunk.Delta -> copy(streamingText = streamingText + chunk.text)
        is AiStreamChunk.ToolResult -> onToolResult(chunk)
        AiStreamChunk.Done -> markDone(nowMs)
        is AiStreamChunk.Failed -> markFailed(chunk.errorKind)
    }

/**
 * Captures a parsed draft from a `draft_grafana_panel` tool result (web `onEvent` -> `setDraft`). A non-draft
 * tool name or an unparseable payload leaves the state untouched, exactly as the web filter does.
 */
private fun GrafanaDraftState.onToolResult(chunk: AiStreamChunk.ToolResult): GrafanaDraftState =
    if (chunk.name == DRAFT_GRAFANA_PANEL_TOOL) {
        parseGrafanaPanelDraft(chunk.data)?.let { copy(draft = it) } ?: this
    } else {
        this
    }

/** Closes the stream successfully and stamps the completion for the freshness check; the draft is left as-is. */
fun GrafanaDraftState.markDone(nowMs: Long): GrafanaDraftState = copy(phase = DraftPhase.Done, fetchedAt = nowMs)

/** Marks the stream failed with the classified [kind]; any draft captured before the failure is left intact. */
fun GrafanaDraftState.markFailed(kind: ErrorKind): GrafanaDraftState = copy(phase = DraftPhase.Failed, errorKind = kind)

/**
 * Closes a stream that ended without an explicit terminal frame (the producer simply completed). Mirrors the
 * web hook promoting a still-`streaming` state to `done` when the reader drains, so the UI never hangs on the
 * thinking indicator.
 */
fun GrafanaDraftState.finishIfStreaming(nowMs: Long): GrafanaDraftState = if (phase == DraftPhase.Streaming) markDone(nowMs) else this

/**
 * The render-ready classification of [GrafanaDraftState] — a closed set of mutually-exclusive surfaces the view
 * switches on, so every branch is exhaustively covered and unit-tested off-device. Maps the stream lifecycle
 * onto the P3 loading / empty / content / error / stale / offline contract.
 */
sealed interface DraftSurface {
    /** The AI feature is gated off — the whole surface collapses (web `withAiFeature` renders `null`). */
    data object Hidden : DraftSurface

    /** Resting/idle: the card with the prompt field + Draft action, enabled only when [canDraft]. */
    data class Resting(
        val canDraft: Boolean,
    ) : DraftSurface

    /** Streaming with no prose yet — the thinking indicator (the surface's loading state). */
    data object Working : DraftSurface

    /** Streaming with partial prose — the assistant narration rendering live as it arrives. */
    data class Live(
        val narration: String,
    ) : DraftSurface

    /** Completed with a captured draft — the draft summary + Apply action; [stale] flags an aged fetch. */
    data class Ready(
        val draft: GrafanaPanelDraft,
        val narration: String,
        val stale: Boolean,
    ) : DraftSurface

    /** Completed with prose but no draft (the model answered without calling the tool); [stale] flags an aged fetch. */
    data class Narrated(
        val narration: String,
        val stale: Boolean,
    ) : DraftSurface

    /** Completed with neither draft nor prose — a friendly empty state (never a blank box). */
    data object Empty : DraftSurface

    /** Failed but this stream captured a draft and/or prose — kept visible; [offline] picks the chip/copy. */
    data class Cached(
        val draft: GrafanaPanelDraft?,
        val narration: String,
        val offline: Boolean,
    ) : DraftSurface

    /** Failed with nothing captured — a QueryError-equivalent with retry; [offline] picks the recovery copy. */
    data class Failed(
        val offline: Boolean,
    ) : DraftSurface
}

/**
 * Selects the render-ready [DraftSurface] for [state]. Pure (no Compose/clock): the caller supplies [nowMs] and
 * the [windowMs] freshness budget so the staleness decision is deterministic and testable.
 */
fun classifyGrafanaDraft(
    state: GrafanaDraftState,
    nowMs: Long,
    windowMs: Long = GRAFANA_DRAFT_FRESHNESS_WINDOW_MS,
): DraftSurface {
    if (!state.gateEnabled) return DraftSurface.Hidden
    return when (state.phase) {
        DraftPhase.Idle -> DraftSurface.Resting(state.canDraft)
        DraftPhase.Streaming ->
            if (state.streamingText.isBlank()) DraftSurface.Working else DraftSurface.Live(state.streamingText)

        DraftPhase.Done -> doneSurface(state, isStale(state.fetchedAt, nowMs, windowMs))
        DraftPhase.Failed -> failedSurface(state)
    }
}

/** Done -> a captured draft (Ready), else prose-only (Narrated), else a friendly empty state. */
private fun doneSurface(
    state: GrafanaDraftState,
    stale: Boolean,
): DraftSurface =
    when {
        state.draft != null -> DraftSurface.Ready(state.draft, state.streamingText, stale)
        state.streamingText.isNotBlank() -> DraftSurface.Narrated(state.streamingText, stale)
        else -> DraftSurface.Empty
    }

/** Failure -> last-known [DraftSurface.Cached] when this stream captured anything, else a hard failure. */
private fun failedSurface(state: GrafanaDraftState): DraftSurface {
    val offline = state.errorKind == ErrorKind.Network
    return if (state.draft != null || state.streamingText.isNotBlank()) {
        DraftSurface.Cached(state.draft, state.streamingText, offline)
    } else {
        DraftSurface.Failed(offline)
    }
}

/** True when a completed draft stamped at [fetchedAt] is older than [windowMs] relative to [nowMs]. */
fun isStale(
    fetchedAt: Long?,
    nowMs: Long,
    windowMs: Long,
): Boolean = fetchedAt != null && nowMs - fetchedAt > windowMs

// ── Tool-payload parser — the native port of web `parseGrafanaPanelDraft(data: unknown)` ─────────────────────

/**
 * Validates and projects a decoded `draft_grafana_panel` tool payload into a typed [GrafanaPanelDraft], or
 * `null` when any required field is missing or mistyped — a faithful port of the web `parseGrafanaPanelDraft`
 * guard chain. The input is the decoded JSON object (web `ev.data`: `{ status, draft }`); the host adapter
 * supplies it as a plain `Map`/`List`/scalar tree so this stays dependency-free and unit-tested off-device.
 *
 * `ReturnCount` is suppressed: a validating projection of an external contract is clearest as a sequence of
 * guard clauses, and every early `null` mirrors a specific web `return null`.
 */
@Suppress("ReturnCount")
fun parseGrafanaPanelDraft(data: Map<String, Any?>?): GrafanaPanelDraft? {
    if (data == null || data["status"] != "ok") return null
    val draft = asMap(data["draft"]) ?: return null
    val prompt = asString(draft["prompt"]) ?: return null
    val rationale = asString(draft["rationale"]) ?: return null
    val panel = parsePanelEnvelope(asMap(draft["panel"])) ?: return null
    return GrafanaPanelDraft(
        prompt = prompt,
        panel = panel,
        rationale = rationale,
        referencedTables = parseStringList(draft["referenced_tables"]),
    )
}

/** Projects the `panel` object; `null` when the title/type/datasource/grid placement are missing or mistyped. */
@Suppress("ReturnCount")
private fun parsePanelEnvelope(panel: Map<String, Any?>?): GrafanaPanelEnvelope? {
    if (panel == null) return null
    val title = asString(panel["title"]) ?: return null
    val type = asString(panel["type"]) ?: return null
    val datasource = parseDatasource(asMap(panel["datasource"])) ?: return null
    val gridPos = parseGridPos(asMap(panel["grid_pos"])) ?: return null
    return GrafanaPanelEnvelope(
        title = title,
        type = type,
        datasource = datasource,
        targets = parseTargets(panel["targets"]),
        gridPos = gridPos,
    )
}

/** Projects the `datasource` object; `null` unless both `type` and `uid` are strings. */
private fun parseDatasource(datasource: Map<String, Any?>?): GrafanaDatasourceRef? {
    val type = asString(datasource?.get("type"))
    val uid = asString(datasource?.get("uid"))
    return if (type != null && uid != null) GrafanaDatasourceRef(type, uid) else null
}

/** Projects the `grid_pos` object; `null` unless all of x/y/w/h are numbers (web `typeof === 'number'`). */
@Suppress("ReturnCount")
private fun parseGridPos(gridPos: Map<String, Any?>?): GrafanaPanelGridPos? {
    val x = asInt(gridPos?.get("x")) ?: return null
    val y = asInt(gridPos?.get("y")) ?: return null
    val w = asInt(gridPos?.get("w")) ?: return null
    val h = asInt(gridPos?.get("h")) ?: return null
    return GrafanaPanelGridPos(x, y, w, h)
}

/** Projects the `targets` array, dropping any entry missing a string `ref_id` (web `.filter(...)`). */
private fun parseTargets(value: Any?): List<GrafanaPanelTarget> = asList(value).orEmpty().mapNotNull { parseTarget(it) }

/** Projects one target; `null` unless `ref_id` is a string. Optional SQL/expr/format are kept when present. */
private fun parseTarget(value: Any?): GrafanaPanelTarget? {
    val target = asMap(value) ?: return null
    val refId = asString(target["ref_id"])
    return if (refId != null) {
        GrafanaPanelTarget(refId, asString(target["raw_sql"]), asString(target["expr"]), asString(target["format"]))
    } else {
        null
    }
}

/** Projects a string array, dropping non-string entries (web `referenced_tables.filter(typeof === 'string')`). */
private fun parseStringList(value: Any?): List<String> = asList(value).orEmpty().mapNotNull { it as? String }

@Suppress("UNCHECKED_CAST")
private fun asMap(value: Any?): Map<String, Any?>? = value as? Map<String, Any?>

@Suppress("UNCHECKED_CAST")
private fun asList(value: Any?): List<Any?>? = value as? List<Any?>

private fun asString(value: Any?): String? = value as? String

private fun asInt(value: Any?): Int? = (value as? Number)?.toInt()

// ── Accessibility-label builders (TalkBack-label presence; unit-tested off-device) ───────────────────────────

/**
 * Builds the merged accessibility description for the card header from already-localized parts (web reads the
 * title, the "Helix" badge, and the description as one block). Kept pure so TalkBack-label presence is unit-
 * tested without a Compose host.
 */
fun headerAccessibilityLabel(
    title: String,
    badge: String,
    description: String,
): String = "$title ($badge). $description"

/** The localized announcement fragments [outputAccessibilityLabel] composes — resolved by the view from i18n. */
data class DraftOutputLabels(
    val working: String,
    val empty: String,
    val stale: String,
    val offline: String,
    val error: String,
    val ready: String,
)

/**
 * Builds the accessibility description for the output region per [surface] from already-localized parts, or
 * `null` when the output region carries no announcement (the resting/hidden surfaces, whose card chrome is
 * announced instead). Pure so the per-state a11y labels are unit-tested off-device.
 */
fun outputAccessibilityLabel(
    surface: DraftSurface,
    labels: DraftOutputLabels,
): String? =
    when (surface) {
        DraftSurface.Hidden, is DraftSurface.Resting -> null
        DraftSurface.Working, is DraftSurface.Live -> labels.working
        DraftSurface.Empty -> labels.empty
        is DraftSurface.Ready -> readyAnnouncement(surface.draft, surface.stale, labels)
        is DraftSurface.Narrated -> if (surface.stale) "${labels.stale}. ${surface.narration}" else surface.narration
        is DraftSurface.Cached -> cachedAnnouncement(surface, labels)
        is DraftSurface.Failed -> labels.error
    }

/** The Ready announcement: the draft heading + panel title, prefixed with the stale chip when aged. */
private fun readyAnnouncement(
    draft: GrafanaPanelDraft,
    stale: Boolean,
    labels: DraftOutputLabels,
): String {
    val core = "${labels.ready}: ${draft.panel.title}"
    return if (stale) "${labels.stale}. $core" else core
}

/** The Cached announcement: the offline/error chip + the captured draft's title (or the retained prose). */
private fun cachedAnnouncement(
    surface: DraftSurface.Cached,
    labels: DraftOutputLabels,
): String {
    val chip = if (surface.offline) labels.offline else labels.error
    val body = surface.draft?.let { "${labels.ready}: ${it.panel.title}" } ?: surface.narration
    return "$chip. $body"
}
