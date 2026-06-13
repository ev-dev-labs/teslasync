// Pure, framework-free model + projection for the AINLDashboardComposer shared surface — the native analogue of
// everything the web component derives before it returns JSX (web/src/components/ai/AINLDashboardComposer.tsx).
// No Compose, no Android, no HTTP lives here, so every declaration is exercised off-device by the
// :app:testReleaseUnitTest gate and the composable stays a thin render layer (ADR-002).
//
// The web component is an AIFeatureCard whose primary surface is "header + prompt textarea + Draft button +
// streamed output". It drives `useAiStream` against POST /ai/power/dashboard/draft with `{ prompt }`, captures a
// typed DashboardLayoutDraft from the `draft_dashboard_layout` tool_result frame, and — once a draft exists —
// renders an "Apply to editor" affordance that hands the typed draft back to the parent /power/dashboards editor
// via `onApply` (the AI panel NEVER writes editor state; the manual JSON composer stays the sole write path).
// This file owns the parity-critical pieces that have nothing to do with Compose:
//   - the i18n by-name facade (the [StringResolver] seam) + the surface's source keys (web `t(key, …)`),
//   - the typed [DashboardLayoutDraft] + the `tool_result` → draft extraction (web `parseDashboardLayoutDraft`),
//   - the native [AiStreamEvent] union + the SSE frame parser (the consume side of web `useAiStream`),
//   - the [AiNlDashboardRenderState] projection covering every state the prompt mandates
//     (loading / content / empty / error / stale / offline),
//   - the accessibility-label builders (TalkBack-label presence),
//   - and the PII-safe `view.opened` diagnostic (P1/S11).
//
// `InvalidPackageDeclaration`/`MatchingDeclarationName`/`filename` are suppressed because the mandated surface
// directory (com/teslasync/shared-surfaces/AINLDashboardComposer — the P3 prompt's allowed-files path) cannot
// form a valid Kotlin package identifier and the file hosts several co-located declarations, exactly as the
// sibling surfaces do.
@file:Suppress("InvalidPackageDeclaration", "MatchingDeclarationName", "ktlint:standard:filename")

package io.teslasync.android.sharedsurfaces.ainldashboardcomposer

import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.doubleOrNull

/**
 * Canonical metadata for the surface. [ID] is the web `withAiFeature('nl-dashboard-composer', …)` feature id (the
 * per-feature AI-Off gate, ADR-015 §I5); [SLUG] is the diagnostics surface slug emitted with the one-shot
 * `view.opened` event (P1/S11).
 */
object AINLDashboardComposerRegistration {
    /** Per-feature AI-Off gate id — mirrors the web `withAiFeature('nl-dashboard-composer', …)` arg. */
    const val ID: String = "nl-dashboard-composer"

    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). */
    const val SLUG: String = "AINLDashboardComposer"
}

/**
 * Emits the one PII-safe `view.opened` diagnostic with the surface [AINLDashboardComposerRegistration.SLUG]
 * (P1/S11). Kept free of Compose so it is unit-tested with a recording [Logger]; the view-model calls it from the
 * first-composition effect. It carries only the static slug, so a diagnostics line can never leak the user's
 * prompt, the drafted dashboard, or any panel detail (ADR-016).
 */
fun recordAINLDashboardComposerViewOpened(logger: Logger) {
    logger.info("view.opened", mapOf("surface" to AINLDashboardComposerRegistration.SLUG))
}

// ── i18n facade (web `t(key, fallback)`) ─────────────────────────────────────────────────────────────────────

/** A by-name string resolver — the P1/S10 i18n facade in production, a map/fallback in tests (web `t`). */
typealias StringResolver = (key: String, fallback: String) -> String

private val NON_IDENTIFIER = Regex("[^A-Za-z0-9_]")

/**
 * Folds a dotted i18next key into the generated Android catalog resource name (web `a.b.c` → `translation_a_b_c`),
 * matching apps/shared/i18n/generators/gen-i18n.ts `androidName`. The production resolver looks this up by name
 * and falls back to the web English when the key is absent.
 */
fun foldCatalogKey(dottedKey: String): String = "translation_" + dottedKey.replace(NON_IDENTIFIER, "_").trim('_')

/** A resolver that always returns the web English fallback — used by @Preview and the off-device unit tests. */
val FallbackResolver: StringResolver = { _, fallback -> fallback }

/**
 * The surface's i18n keys + their exact web English fallbacks. The `powerDashboards.aiDrafter.*` keys are lifted
 * verbatim from the component's `t(key, default)` calls; the web component relies on those inline defaults (the
 * keys are not yet in the shared catalog), so the production resolver resolves them through fallback exactly as
 * the web does. The `helix.*` / `common.*` keys and the native state-chrome keys carry the same English the
 * shared web scaffold (`AIFeatureCard` / `AiOutputPanel`) renders, so the painted English is identical whether or
 * not the catalog defines them.
 */
internal object AiDrafterKeys {
    const val TITLE = "powerDashboards.aiDrafter.title"
    const val TITLE_EN = "Helix natural-language dashboard composer"

    const val DESCRIPTION = "powerDashboards.aiDrafter.description"
    const val DESCRIPTION_EN =
        "Describe the dashboard you want in plain English (e.g. \"give me an overview dashboard with daily " +
            "drives, current battery, and recent alerts\"). Helix proposes a typed dashboard JSON draft built " +
            "from the in-scope curated panel catalog you can apply to the editor with one click; it never " +
            "pushes the dashboard to Grafana directly."

    const val DRAFT_BUTTON = "powerDashboards.aiDrafter.button"
    const val DRAFT_BUTTON_EN = "Draft dashboard"

    const val BADGE = "powerDashboards.aiDrafter.badge"
    const val BADGE_EN = "Helix"

    // The prompt-field supporting hint — the web Textarea hint shown beneath the field. The dotted key mirrors
    // the web i18n key verbatim; the constant line carries a `parity:allow` reason because that key ends in a
    // token the gate flags.
    const val PROMPT_HINT = "powerDashboards.aiDrafter.promptPlaceholder" // parity:allow verbatim web i18n key
    const val PROMPT_HINT_EN =
        "e.g. give me an overview dashboard with daily drives, current battery, and recent alerts"

    const val PROMPT_LABEL = "powerDashboards.aiDrafter.promptLabel"
    const val PROMPT_LABEL_EN = "Dashboard request"

    const val APPLY_BUTTON = "powerDashboards.aiDrafter.applyButton"
    const val APPLY_BUTTON_EN = "Apply to editor"

    const val APPLY_TOOLTIP = "powerDashboards.aiDrafter.applyTooltip"
    const val APPLY_TOOLTIP_EN =
        "Copy the proposed dashboard JSON into the editor above. You can still edit it before clicking Copy to " +
            "clipboard."

    // Native chrome (fallback-resolved; mirrors the shared AIFeatureCard / AiOutputPanel English).
    const val ASK_HELIX = "helix.askHelix"
    const val ASK_HELIX_EN = "Ask Helix"

    const val THINKING = "helix.thinking"
    const val THINKING_EN = "Helix is thinking…"

    const val BADGE_ARIA = "helix.ariaLabel"
    const val BADGE_ARIA_EN = "Helix"

    const val RETRY = "common.retry"
    const val RETRY_EN = "Retry"

    // Native state-chrome the prompt's mandated offline / stale / error / empty states need (routed through the
    // facade so no English literal lives in native code; resolve to these exact strings via fallback).
    const val DRAFT_READY = "powerDashboards.aiDrafter.draftReady"
    const val DRAFT_READY_EN = "Draft ready"

    const val UNTITLED = "powerDashboards.aiDrafter.untitled"
    const val UNTITLED_EN = "Untitled dashboard"

    const val PANELS_LABEL = "powerDashboards.aiDrafter.panelsLabel"
    const val PANELS_LABEL_EN = "Panels"

    const val WAITING = "powerDashboards.aiDrafter.waiting"
    const val WAITING_EN = "Describe the dashboard you want, then let Helix draft it."

    const val EMPTY = "powerDashboards.aiDrafter.empty"
    const val EMPTY_EN = "Helix didn't return a dashboard draft. Try rephrasing your request."

    const val ERROR_TITLE = "powerDashboards.aiDrafter.errorTitle"
    const val ERROR_TITLE_EN = "Couldn't draft the dashboard"

    const val OFFLINE = "powerDashboards.aiDrafter.offline"
    const val OFFLINE_EN = "You're offline. Showing the last drafted dashboard, if any."

    const val STALE = "powerDashboards.aiDrafter.stale"
    const val STALE_EN = "Last draft — refreshing…"
}

/** The fully-resolved display strings the composable paints — resolved off-device so i18n is unit-testable. */
@Suppress("LongParameterList")
data class AiDrafterLabels(
    val title: String,
    val description: String,
    val badge: String,
    val badgeAria: String,
    val draftButton: String,
    val applyButton: String,
    val applyTooltip: String,
    val promptLabel: String,
    val promptHint: String,
    val askHelix: String,
    val thinking: String,
    val retry: String,
    val draftReady: String,
    val untitled: String,
    val panelsLabel: String,
    val waiting: String,
    val empty: String,
    val errorTitle: String,
    val offline: String,
    val stale: String,
)

/** Resolves every surface label through [resolve], folding the web `t(key, fallback)` calls into one value. */
fun aiDrafterLabels(resolve: StringResolver): AiDrafterLabels =
    AiDrafterLabels(
        title = resolve(AiDrafterKeys.TITLE, AiDrafterKeys.TITLE_EN),
        description = resolve(AiDrafterKeys.DESCRIPTION, AiDrafterKeys.DESCRIPTION_EN),
        badge = resolve(AiDrafterKeys.BADGE, AiDrafterKeys.BADGE_EN),
        badgeAria = resolve(AiDrafterKeys.BADGE_ARIA, AiDrafterKeys.BADGE_ARIA_EN),
        draftButton = resolve(AiDrafterKeys.DRAFT_BUTTON, AiDrafterKeys.DRAFT_BUTTON_EN),
        applyButton = resolve(AiDrafterKeys.APPLY_BUTTON, AiDrafterKeys.APPLY_BUTTON_EN),
        applyTooltip = resolve(AiDrafterKeys.APPLY_TOOLTIP, AiDrafterKeys.APPLY_TOOLTIP_EN),
        promptLabel = resolve(AiDrafterKeys.PROMPT_LABEL, AiDrafterKeys.PROMPT_LABEL_EN),
        promptHint = resolve(AiDrafterKeys.PROMPT_HINT, AiDrafterKeys.PROMPT_HINT_EN),
        askHelix = resolve(AiDrafterKeys.ASK_HELIX, AiDrafterKeys.ASK_HELIX_EN),
        thinking = resolve(AiDrafterKeys.THINKING, AiDrafterKeys.THINKING_EN),
        retry = resolve(AiDrafterKeys.RETRY, AiDrafterKeys.RETRY_EN),
        draftReady = resolve(AiDrafterKeys.DRAFT_READY, AiDrafterKeys.DRAFT_READY_EN),
        untitled = resolve(AiDrafterKeys.UNTITLED, AiDrafterKeys.UNTITLED_EN),
        panelsLabel = resolve(AiDrafterKeys.PANELS_LABEL, AiDrafterKeys.PANELS_LABEL_EN),
        waiting = resolve(AiDrafterKeys.WAITING, AiDrafterKeys.WAITING_EN),
        empty = resolve(AiDrafterKeys.EMPTY, AiDrafterKeys.EMPTY_EN),
        errorTitle = resolve(AiDrafterKeys.ERROR_TITLE, AiDrafterKeys.ERROR_TITLE_EN),
        offline = resolve(AiDrafterKeys.OFFLINE, AiDrafterKeys.OFFLINE_EN),
        stale = resolve(AiDrafterKeys.STALE, AiDrafterKeys.STALE_EN),
    )

/**
 * The Draft button's accessible name — the native mirror of the web AIFeatureCard `aria-label`
 * (`"${askHelix} · ${buttonLabel}"`), so TalkBack announces the contextual Helix verb, not just "Ask Helix".
 */
fun draftButtonContentDescription(resolve: StringResolver): String {
    val labels = aiDrafterLabels(resolve)
    return "${labels.askHelix} · ${labels.draftButton}"
}

/**
 * The Apply button's accessible name — the visible "Apply to editor" verb plus the web `title` tooltip, so
 * TalkBack announces what the affordance does (web's `<Button title={…}>Apply to editor</Button>`).
 */
fun applyButtonContentDescription(labels: AiDrafterLabels): String = "${labels.applyButton}. ${labels.applyTooltip}"

/** The merged header announcement — title, Helix badge, and the descriptive caveat as one TalkBack message. */
fun headerAccessibilityLabel(
    title: String,
    badge: String,
    description: String,
): String = "$title ($badge). $description"

// ── Captured draft (web `DashboardLayoutDraft`) ──────────────────────────────────────────────────────────────

/**
 * The typed dashboard draft the Helix panel emits when the LLM successfully calls `draft_dashboard_layout` — the
 * native mirror of the web `DashboardLayoutDraft` (and the Go-side DashboardLayoutDraft DTO). The field set is
 * intentionally narrow: only the dashboard envelope fields the deterministic editor already owns.
 */
data class DashboardLayoutDraft(
    val prompt: String,
    val dashboard: DashboardEnvelope,
    val rationale: String,
    val referencedPanels: List<String>,
)

/** The dashboard envelope: a title and the placed panel slots (web `DashboardEnvelope`). */
data class DashboardEnvelope(
    val title: String,
    val slots: List<DashboardSlot>,
)

/** One placed panel: the curated panel name and its grid position (web `DashboardSlot`). */
data class DashboardSlot(
    val panelName: String,
    val gridPos: DashboardSlotGrid,
)

/** A panel's grid rectangle (web `DashboardSlotGrid`). */
data class DashboardSlotGrid(
    val x: Int,
    val y: Int,
    val w: Int,
    val h: Int,
)

/**
 * The distinct panel names to surface in the draft preview: the placed slot panels, or — when the draft placed no
 * slots — the LLM's referenced-panel list. Blank names are dropped so the preview never shows an empty chip.
 */
fun draftPanelNames(draft: DashboardLayoutDraft): List<String> {
    val fromSlots = draft.dashboard.slots.map { it.panelName }
    val source = fromSlots.ifEmpty { draft.referencedPanels }
    return source.filter { it.isNotBlank() }.distinct()
}

/** The drafted dashboard title for display, falling back to the localized "Untitled dashboard" when blank. */
fun draftTitle(
    draft: DashboardLayoutDraft,
    labels: AiDrafterLabels,
): String = draft.dashboard.title.ifBlank { labels.untitled }

/** The "Panels: a · b · c" summary line, or `null` when the draft references no panels at all. */
fun draftPanelsLine(
    draft: DashboardLayoutDraft,
    labels: AiDrafterLabels,
): String? {
    val names = draftPanelNames(draft)
    if (names.isEmpty()) return null
    return "${labels.panelsLabel}: ${names.joinToString(" · ")}"
}

// ── AI stream event model (native mirror of web `useAiStream`'s AiStreamEvent union) ─────────────────────────

/** The lifecycle of the draft stream — the native mirror of the web `AiStreamState`. */
enum class AiStreamPhase { Idle, Streaming, PausedConfirm, Done, Error }

/** Structured rate-limit / cost-cap info parsed from a terminal `error` frame (web `AiLimitInfo`). */
data class AiLimitInfo(
    val reason: String,
    val retryAfterS: Int,
    val bannerLevel: String,
    val baselineAvailable: Boolean,
)

/** The discriminated union of every SSE event the backend AI writer emits (web `AiStreamEvent`). */
sealed interface AiStreamEvent {
    data class Delta(
        val text: String,
    ) : AiStreamEvent

    data class ToolCall(
        val id: String,
        val name: String,
    ) : AiStreamEvent

    data class ToolResult(
        val id: String,
        val name: String,
        val ok: Boolean,
        val data: JsonElement?,
        val error: String?,
    ) : AiStreamEvent

    data class ConfirmRequest(
        val continuationId: String,
        val tool: String,
        val summary: String,
    ) : AiStreamEvent

    data class Done(
        val finishReason: String,
    ) : AiStreamEvent

    data class StreamError(
        val message: String,
        val reason: String?,
        val retryAfterS: Int?,
        val bannerLevel: String?,
        val baselineAvailable: Boolean,
    ) : AiStreamEvent
}

/** The tool whose `tool_result` carries the typed draft (web `name === 'draft_dashboard_layout'`). */
const val DRAFT_TOOL_NAME: String = "draft_dashboard_layout"

/** The success discriminator the tool envelope must carry (web `obj.status !== 'ok'`). */
const val DRAFT_STATUS_OK: String = "ok"

/**
 * Captures the draft from a `tool_result` event — the native mirror of the web `onEvent` handler. Returns `null`
 * for any event that is not a `draft_dashboard_layout` result with a parseable `{ status: 'ok', draft }` payload
 * (web returns without calling `setDraft`). Mirrors the web's parse, which does NOT gate on the `ok` flag — only
 * the envelope's own `status` field decides success.
 */
fun extractDraft(event: AiStreamEvent): DashboardLayoutDraft? {
    val result = (event as? AiStreamEvent.ToolResult)?.takeIf { it.name == DRAFT_TOOL_NAME } ?: return null
    return parseDashboardLayoutDraft(result.data)
}

/**
 * Parses a `draft_dashboard_layout` tool payload into a [DashboardLayoutDraft] — a faithful port of the web
 * `parseDashboardLayoutDraft`. Requires `status === 'ok'` and a `draft` object carrying string `prompt`,
 * `rationale`, and `dashboard.title`; malformed `slots` rows are skipped and a non-array `slots` /
 * `referenced_panels` yields an empty list. Returns `null` for any shape the web guard rejects.
 */
fun parseDashboardLayoutDraft(data: JsonElement?): DashboardLayoutDraft? {
    val draft = (data as? JsonObject)?.takeIf { it.stringField("status") == DRAFT_STATUS_OK }?.get("draft") as? JsonObject
    val dashboard = draft?.get("dashboard") as? JsonObject
    val prompt = draft?.stringField("prompt")
    val rationale = draft?.stringField("rationale")
    val title = dashboard?.stringField("title")
    if (prompt == null || rationale == null || title == null) return null
    val slots = (dashboard["slots"] as? JsonArray)?.mapNotNull { (it as? JsonObject)?.let(::parseSlot) } ?: emptyList()
    val panels =
        (draft["referenced_panels"] as? JsonArray)
            ?.mapNotNull { (it as? JsonPrimitive)?.takeIf { p -> p.isString }?.content }
            ?: emptyList()
    return DashboardLayoutDraft(
        prompt = prompt,
        dashboard = DashboardEnvelope(title = title, slots = slots),
        rationale = rationale,
        referencedPanels = panels,
    )
}

/** Reads one slot off a `slots[]` element (web's typed `panel_name` / `grid_pos.{x,y,w,h}` narrowing). */
fun parseSlot(obj: JsonObject): DashboardSlot? {
    val panelName = obj.stringField("panel_name")
    val grid = (obj["grid_pos"] as? JsonObject)?.let(::parseGrid)
    return if (panelName != null && grid != null) DashboardSlot(panelName, grid) else null
}

/** Reads a `grid_pos` rectangle, requiring all four numeric coordinates (web's `typeof g.x === 'number'` …). */
private fun parseGrid(obj: JsonObject): DashboardSlotGrid? {
    val coords =
        listOfNotNull(
            obj.numberField("x"),
            obj.numberField("y"),
            obj.numberField("w"),
            obj.numberField("h"),
        )
    return if (coords.size == GRID_COORDINATE_COUNT) {
        DashboardSlotGrid(x = coords[0].toInt(), y = coords[1].toInt(), w = coords[2].toInt(), h = coords[3].toInt())
    } else {
        null
    }
}

private const val GRID_COORDINATE_COUNT = 4

// ── SSE frame parser (the consume side of web `useAiStream`: parseSSEFrame + toTypedEvent) ───────────────────

private val SSE_LINE = Regex("\\r?\\n")

/**
 * Parses one blank-line-delimited SSE block into a typed [AiStreamEvent] — a faithful port of the web
 * `parseSSEFrame` + `toTypedEvent`. Returns `null` for a frame with no `event:` line, malformed JSON, or an
 * unknown/under-specified event type, so a transport can skip it instead of corrupting the stream (and a future
 * server adding a new event type cannot crash an older client).
 */
fun parseSseFrame(raw: String): AiStreamEvent? {
    var event = ""
    val dataParts = mutableListOf<String>()
    for (line in raw.split(SSE_LINE)) {
        when {
            line.startsWith(":") -> Unit
            line.startsWith("event: ") -> event = line.removePrefix("event: ")
            line.startsWith("data: ") -> dataParts += line.removePrefix("data: ")
            line.startsWith("event:") -> event = line.removePrefix("event:").trimStart()
            line.startsWith("data:") -> dataParts += line.removePrefix("data:").trimStart()
        }
    }
    if (event.isEmpty()) return null
    val dataStr = dataParts.joinToString("\n")
    val data: JsonElement? = if (dataStr.isEmpty()) null else runCatching { Json.parseToJsonElement(dataStr) }.getOrNull()
    // A non-empty payload that failed to parse is a malformed frame → drop it (web returns null).
    return if (dataStr.isNotEmpty() && data == null) null else toTypedEvent(event, data)
}

private fun toTypedEvent(
    event: String,
    data: JsonElement?,
): AiStreamEvent? {
    val obj = data as? JsonObject ?: return null
    return when (event) {
        "delta" -> obj.stringField("text")?.let { AiStreamEvent.Delta(it) }
        "tool_call" -> obj.toToolCall()
        "tool_result" -> obj.toToolResult()
        "confirm_request" -> obj.toConfirmRequest()
        "done" -> AiStreamEvent.Done(obj.stringField("finish_reason") ?: "stop")
        "error" -> obj.toStreamError()
        else -> null
    }
}

private fun JsonObject.toToolCall(): AiStreamEvent.ToolCall? {
    val id = stringField("id")
    val name = stringField("name")
    return if (id != null && name != null) AiStreamEvent.ToolCall(id, name) else null
}

private fun JsonObject.toToolResult(): AiStreamEvent.ToolResult? {
    val id = stringField("id")
    val name = stringField("name")
    val ok = (this["ok"] as? JsonPrimitive)?.booleanOrNull
    return if (id != null && name != null && ok != null) {
        AiStreamEvent.ToolResult(id, name, ok, this["data"], nonEmptyStringField("error"))
    } else {
        null
    }
}

private fun JsonObject.toConfirmRequest(): AiStreamEvent.ConfirmRequest? {
    val cont = stringField("continuation_id")
    val tool = stringField("tool")
    val summary = stringField("summary")
    return if (cont != null && tool != null && summary != null) {
        AiStreamEvent.ConfirmRequest(cont, tool, summary)
    } else {
        null
    }
}

private fun JsonObject.toStreamError(): AiStreamEvent.StreamError =
    AiStreamEvent.StreamError(
        message = stringField("message") ?: "unknown",
        reason = nonEmptyStringField("reason"),
        retryAfterS = numberField("retry_after_s")?.toInt(),
        bannerLevel = nonEmptyStringField("banner_level"),
        baselineAvailable = (this["baseline_available"] as? JsonPrimitive)?.booleanOrNull ?: true,
    )

// ── Render-state projection (every state the prompt mandates) ────────────────────────────────────────────────

/**
 * The mutable runtime the view-model folds the stream into. Kept as one value so the projection takes a single
 * argument (and the view re-renders atomically): the stream [phase], the last captured [draft] (`null` until a
 * `tool_result` arrives), the accumulated descriptive-replay [streamedText], and the terminal [errorMessage]/
 * [limit].
 */
data class StreamRuntime(
    val phase: AiStreamPhase = AiStreamPhase.Idle,
    val draft: DashboardLayoutDraft? = null,
    val streamedText: String = "",
    val errorMessage: String? = null,
    val limit: AiLimitInfo? = null,
)

/** The mutually-exclusive surface the composable renders — the prompt's mandated state set. */
enum class AiNlDashboardRenderState { Loading, Content, Empty, Error, Stale, Offline }

/**
 * The immutable snapshot the composable paints. [promptText] is the controlled textarea value; [hasPrompt]
 * mirrors the web `hasPrompt` (`prompt.trim().length > 0`). [canStart] is the web `canDraft`
 * (`!isStreaming && hasPrompt`, plus connectivity); [canApply] is the web `canApply` (`!!draft && !isStreaming`,
 * connectivity-independent — applying writes the local editor). [draft] is retained across refresh/offline so the
 * last-known draft is never blanked — it is flagged [stale], never hidden. [hasResult] distinguishes a finished
 * generation (so Empty shows "no draft" copy) from the pre-draft resting state (so Empty shows "describe …").
 */
@Suppress("LongParameterList")
data class AiNlDashboardSnapshot(
    val renderState: AiNlDashboardRenderState,
    val phase: AiStreamPhase,
    val promptText: String,
    val hasPrompt: Boolean,
    val draft: DashboardLayoutDraft?,
    val hasResult: Boolean,
    val streamedText: String,
    val canStart: Boolean,
    val canApply: Boolean,
    val isBusy: Boolean,
    val errorMessage: String?,
    val limit: AiLimitInfo?,
    val offline: Boolean,
    val stale: Boolean,
)

/**
 * Projects the controlled [promptText] + stream [runtime] + connectivity onto an [AiNlDashboardSnapshot] — the
 * single, side-effect-free place the prompt's six render states are derived, so the composable only paints:
 *  - `online == false` ⇒ Offline (last-known [StreamRuntime.draft] kept visible, Draft disabled);
 *  - a terminal error classified as a connectivity failure ⇒ Offline, any other error ⇒ Error (+ retry);
 *  - streaming with a previously-captured draft ⇒ Stale (refreshing over last-known), else Loading;
 *  - a captured draft (or streamed replay text) ⇒ Content;
 *  - everything resolved with nothing to show ⇒ Empty (with the "no draft" or "describe …" copy).
 */
fun projectAiNlDashboard(
    promptText: String,
    runtime: StreamRuntime,
    online: Boolean,
): AiNlDashboardSnapshot {
    val hasPrompt = promptText.trim().isNotEmpty()
    val busy = runtime.phase == AiStreamPhase.Streaming || runtime.phase == AiStreamPhase.PausedConfirm
    val canStart = hasPrompt && online && !busy
    val canApply = runtime.draft != null && !busy
    val renderState = renderStateFor(runtime, online)
    val offline = renderState == AiNlDashboardRenderState.Offline
    val stale = renderState == AiNlDashboardRenderState.Stale || (offline && runtime.draft != null)
    return AiNlDashboardSnapshot(
        renderState = renderState,
        phase = runtime.phase,
        promptText = promptText,
        hasPrompt = hasPrompt,
        draft = runtime.draft,
        hasResult = runtime.phase == AiStreamPhase.Done,
        streamedText = runtime.streamedText,
        canStart = canStart,
        canApply = canApply,
        isBusy = busy,
        errorMessage = runtime.errorMessage,
        limit = runtime.limit,
        offline = offline,
        stale = stale,
    )
}

/**
 * Decides which render surface to show for the current stream [runtime] + connectivity. Extracted from
 * [projectAiNlDashboard] so each function stays within the cyclomatic-complexity budget.
 */
private fun renderStateFor(
    runtime: StreamRuntime,
    online: Boolean,
): AiNlDashboardRenderState {
    val hasDraft = runtime.draft != null
    val streaming = runtime.phase == AiStreamPhase.Streaming || runtime.phase == AiStreamPhase.PausedConfirm
    val networkError =
        runtime.phase == AiStreamPhase.Error && isNetworkFailure(runtime.limit?.reason, runtime.errorMessage)
    return when {
        !online -> AiNlDashboardRenderState.Offline
        networkError -> AiNlDashboardRenderState.Offline
        runtime.phase == AiStreamPhase.Error -> AiNlDashboardRenderState.Error
        streaming && hasDraft -> AiNlDashboardRenderState.Stale
        streaming -> AiNlDashboardRenderState.Loading
        hasDraft -> AiNlDashboardRenderState.Content
        runtime.streamedText.isNotBlank() -> AiNlDashboardRenderState.Content
        else -> AiNlDashboardRenderState.Empty
    }
}

/**
 * Classifies a terminal stream failure as a connectivity problem (so it renders as Offline rather than a hard
 * error), folding the structured `reason` (web F9 limit fields) and the `stream_http_0` / network-ish message the
 * fetch transport surfaces on an unreachable host. Mirrors the Android `errorKindOf` Network/Timeout fold.
 */
fun isNetworkFailure(
    reason: String?,
    message: String?,
): Boolean {
    val haystack = "${reason.orEmpty()} ${message.orEmpty()}".lowercase()
    if (haystack.isBlank()) return false
    return NETWORK_MARKERS.any { haystack.contains(it) }
}

private val NETWORK_MARKERS = listOf("network", "offline", "timeout", "timed out", "unreachable", "stream_http_0")

// ── JSON field helpers (web's typed narrowing) ───────────────────────────────────────────────────────────────

/** Reads [key] as a number, only when it is a non-string JSON primitive (web `typeof === 'number'`). */
private fun JsonObject.numberField(key: String): Double? {
    val primitive = (this[key] as? JsonPrimitive)?.takeUnless { it.isString } ?: return null
    return primitive.doubleOrNull
}

/** Reads [key] as a string primitive, allowing the empty string (web `typeof === 'string'`). */
private fun JsonObject.stringField(key: String): String? {
    val primitive = this[key] as? JsonPrimitive ?: return null
    return if (primitive.isString) primitive.content else null
}

/** Reads [key] as a non-empty string primitive (web `typeof === 'string' && value !== ''`). */
private fun JsonObject.nonEmptyStringField(key: String): String? = stringField(key)?.takeIf { it.isNotEmpty() }
