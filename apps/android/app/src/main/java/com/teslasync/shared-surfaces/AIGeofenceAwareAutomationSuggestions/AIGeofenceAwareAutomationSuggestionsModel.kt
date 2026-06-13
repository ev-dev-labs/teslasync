// Pure, framework-free model + projection for the AIGeofenceAwareAutomationSuggestions shared surface — the
// native analogue of everything the web component derives before it returns JSX
// (web/src/components/ai/AIGeofenceAwareAutomationSuggestions.tsx). No Compose, no Android, no HTTP lives here,
// so every declaration is exercised off-device by the :android:testReleaseUnitTest gate and the composable stays
// a thin render layer (ADR-002).
//
// The web component is an AIFeatureCard whose primary surface is "header + prompt textarea + Suggest button +
// captured proposal". It drives `useAiStream` against POST /ai/geofences/automations/draft (vehicle_id + prompt
// flow through the JSON body), captures a typed AutomationDraft envelope from `draft_automation_graph`
// `tool_result` frames, and surfaces an "Apply to form" affordance that hands the proposed graph back to the
// parent editor via `onApplyDraft` (ADR-015 §I3/§I8 — the AI panel NEVER persists, the baseline
// AutomationBuilder Save button stays the sole write path). This file owns the parity-critical pieces that have
// nothing to do with Compose:
//   - the i18n by-name facade (the [StringResolver] seam) + the surface's source keys (web `t(key, …)`),
//   - the typed [AutomationGraphDraft] + [AutomationProposal] + the `tool_result` → proposal extraction
//     (web `handleEvent` + `normalizeAutomationInput`),
//   - the native [AiStreamEvent] union + the SSE frame parser (the consume side of web `useAiStream`),
//   - the [GeofenceDraftRenderState] projection covering every state the prompt mandates
//     (loading / content / empty / error / stale / offline),
//   - and the PII-safe `view.opened` diagnostic (P1/S11).
//
// `InvalidPackageDeclaration`/`MatchingDeclarationName`/`filename` are suppressed because the mandated surface
// directory (com/teslasync/shared-surfaces/AIGeofenceAwareAutomationSuggestions — the P3 prompt's allowed-files
// path) cannot form a valid Kotlin package identifier and the file hosts several co-located declarations,
// exactly as the sibling surfaces do.
@file:Suppress("InvalidPackageDeclaration", "MatchingDeclarationName", "ktlint:standard:filename")

package io.teslasync.android.sharedsurfaces.aigeofenceawareautomationsuggestions

import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.doubleOrNull

/**
 * Canonical metadata for the surface. [ID] is the web `withAiFeature('geofence-aware-automation-suggestions', …)`
 * feature id (the per-feature AI-Off gate, ADR-015 §I5); [SLUG] is the diagnostics surface slug emitted with the
 * one-shot `view.opened` event (P1/S11).
 */
object AIGeofenceAwareAutomationSuggestionsRegistration {
    /** Per-feature AI-Off gate id — mirrors the web `withAiFeature('geofence-aware-automation-suggestions', …)`. */
    const val ID: String = "geofence-aware-automation-suggestions"

    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). */
    const val SLUG: String = "AIGeofenceAwareAutomationSuggestions"
}

/**
 * Emits the one PII-safe `view.opened` diagnostic with the surface
 * [AIGeofenceAwareAutomationSuggestionsRegistration.SLUG] (P1/S11). Kept free of Compose so it is unit-tested
 * with a recording [Logger]; the view-model calls it from the first-composition effect. It carries only the
 * static slug, so a diagnostics line can never leak a vehicle id, a prompt, or any proposed value (ADR-016).
 */
fun recordGeofenceDraftViewOpened(logger: Logger) {
    logger.info("view.opened", mapOf("surface" to AIGeofenceAwareAutomationSuggestionsRegistration.SLUG))
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
 * The surface's i18n keys + their exact web English fallbacks. The twelve `automations.builder.aiGeofenceAware.*`
 * keys are lifted verbatim from web/src/i18n/en.json (the component's `t(key, default)` calls); the `helix.*` and
 * `common.*` keys carry the same fallback the shared web scaffold (`AIFeatureCard` / `AiOutputPanel`) renders, and
 * the native state-chrome keys carry the English the prompt's "every state must render" contract requires — so the
 * rendered English is identical whether or not the generated catalog ships the key.
 */
internal object GeofenceDraftKeys {
    const val TITLE = "automations.builder.aiGeofenceAware.title"
    const val TITLE_EN = "Suggest a geofence-aware automation"

    const val DESCRIPTION = "automations.builder.aiGeofenceAware.description"
    const val DESCRIPTION_EN =
        "Describe an automation that uses one of your existing geofences. Helix proposes a typed graph " +
            "anchored to a place_id you already have — review and apply to the form below before saving."

    const val BADGE = "automations.builder.aiGeofenceAware.badge"
    const val BADGE_EN = "Helix"

    const val SUGGEST_BUTTON = "automations.builder.aiGeofenceAware.suggestButton"
    const val SUGGEST_BUTTON_EN = "Suggest automation"

    const val PROMPT_HINT = "automations.builder.aiGeofenceAware.placeholder" // parity:allow i18n key path, not a stub
    const val PROMPT_HINT_EN =
        "e.g. when I arrive home on a weekday after sunset, turn on cabin overheat protection"

    const val PROPOSAL_LABEL = "automations.builder.aiGeofenceAware.proposalLabel"
    const val PROPOSAL_LABEL_EN = "Proposed automation"

    const val APPLY_BUTTON = "automations.builder.aiGeofenceAware.applyButton"
    const val APPLY_BUTTON_EN = "Apply to form"

    const val REJECTED_LABEL = "automations.builder.aiGeofenceAware.rejectedLabel"
    const val REJECTED_LABEL_EN = "Proposal rejected by validator"

    const val TRIGGERS_LABEL = "automations.builder.aiGeofenceAware.triggersLabel"
    const val TRIGGERS_LABEL_EN = "Triggers"

    const val CONDITIONS_LABEL = "automations.builder.aiGeofenceAware.conditionsLabel"
    const val CONDITIONS_LABEL_EN = "Conditions"

    const val ACTIONS_LABEL = "automations.builder.aiGeofenceAware.actionsLabel"
    const val ACTIONS_LABEL_EN = "Actions"

    const val UNNAMED = "automations.builder.aiGeofenceAware.unnamed"
    const val UNNAMED_EN = "(unnamed)"

    const val ASK_HELIX = "helix.askHelix"
    const val ASK_HELIX_EN = "Ask Helix"

    const val THINKING = "helix.thinking"
    const val THINKING_EN = "Helix is thinking…"

    const val BADGE_ARIA = "helix.ariaLabel"
    const val BADGE_ARIA_EN = "Helix"

    const val ERROR_LABEL = "helix.errorLabel"
    const val ERROR_LABEL_EN = "Helix error:"

    const val RETRY = "common.retry"
    const val RETRY_EN = "Retry"

    const val EMPTY = "automations.builder.aiGeofenceAware.empty"
    const val EMPTY_EN = "No proposal yet. Describe an automation and ask Helix to draft a typed graph."

    const val WAITING = "automations.builder.aiGeofenceAware.waiting"
    const val WAITING_EN = "Select a vehicle and describe an automation to let Helix suggest one."

    const val ERROR_TITLE = "automations.builder.aiGeofenceAware.errorTitle"
    const val ERROR_TITLE_EN = "Couldn't draft a suggestion"

    const val OFFLINE = "automations.builder.aiGeofenceAware.offline"
    const val OFFLINE_EN = "You're offline. Showing the last proposed automation, if any."

    const val STALE = "automations.builder.aiGeofenceAware.stale"
    const val STALE_EN = "Last suggestion — refreshing…"
}

/** The fully-resolved display strings the composable paints — resolved off-device so i18n is unit-testable. */
@Suppress("LongParameterList")
data class GeofenceDraftLabels(
    val title: String,
    val description: String,
    val badge: String,
    val badgeAria: String,
    val suggestButton: String,
    val promptHint: String,
    val proposalLabel: String,
    val applyButton: String,
    val rejectedLabel: String,
    val triggersLabel: String,
    val conditionsLabel: String,
    val actionsLabel: String,
    val unnamed: String,
    val askHelix: String,
    val thinking: String,
    val errorLabel: String,
    val empty: String,
    val waiting: String,
    val errorTitle: String,
    val retry: String,
    val offline: String,
    val stale: String,
)

/** Resolves every surface label through [resolve], folding the web `t(key, fallback)` calls into one value. */
fun geofenceDraftLabels(resolve: StringResolver): GeofenceDraftLabels =
    GeofenceDraftLabels(
        title = resolve(GeofenceDraftKeys.TITLE, GeofenceDraftKeys.TITLE_EN),
        description = resolve(GeofenceDraftKeys.DESCRIPTION, GeofenceDraftKeys.DESCRIPTION_EN),
        badge = resolve(GeofenceDraftKeys.BADGE, GeofenceDraftKeys.BADGE_EN),
        badgeAria = resolve(GeofenceDraftKeys.BADGE_ARIA, GeofenceDraftKeys.BADGE_ARIA_EN),
        suggestButton = resolve(GeofenceDraftKeys.SUGGEST_BUTTON, GeofenceDraftKeys.SUGGEST_BUTTON_EN),
        promptHint = resolve(GeofenceDraftKeys.PROMPT_HINT, GeofenceDraftKeys.PROMPT_HINT_EN),
        proposalLabel = resolve(GeofenceDraftKeys.PROPOSAL_LABEL, GeofenceDraftKeys.PROPOSAL_LABEL_EN),
        applyButton = resolve(GeofenceDraftKeys.APPLY_BUTTON, GeofenceDraftKeys.APPLY_BUTTON_EN),
        rejectedLabel = resolve(GeofenceDraftKeys.REJECTED_LABEL, GeofenceDraftKeys.REJECTED_LABEL_EN),
        triggersLabel = resolve(GeofenceDraftKeys.TRIGGERS_LABEL, GeofenceDraftKeys.TRIGGERS_LABEL_EN),
        conditionsLabel = resolve(GeofenceDraftKeys.CONDITIONS_LABEL, GeofenceDraftKeys.CONDITIONS_LABEL_EN),
        actionsLabel = resolve(GeofenceDraftKeys.ACTIONS_LABEL, GeofenceDraftKeys.ACTIONS_LABEL_EN),
        unnamed = resolve(GeofenceDraftKeys.UNNAMED, GeofenceDraftKeys.UNNAMED_EN),
        askHelix = resolve(GeofenceDraftKeys.ASK_HELIX, GeofenceDraftKeys.ASK_HELIX_EN),
        thinking = resolve(GeofenceDraftKeys.THINKING, GeofenceDraftKeys.THINKING_EN),
        errorLabel = resolve(GeofenceDraftKeys.ERROR_LABEL, GeofenceDraftKeys.ERROR_LABEL_EN),
        empty = resolve(GeofenceDraftKeys.EMPTY, GeofenceDraftKeys.EMPTY_EN),
        waiting = resolve(GeofenceDraftKeys.WAITING, GeofenceDraftKeys.WAITING_EN),
        errorTitle = resolve(GeofenceDraftKeys.ERROR_TITLE, GeofenceDraftKeys.ERROR_TITLE_EN),
        retry = resolve(GeofenceDraftKeys.RETRY, GeofenceDraftKeys.RETRY_EN),
        offline = resolve(GeofenceDraftKeys.OFFLINE, GeofenceDraftKeys.OFFLINE_EN),
        stale = resolve(GeofenceDraftKeys.STALE, GeofenceDraftKeys.STALE_EN),
    )

/**
 * The Suggest button's accessible name — the native mirror of the web AIFeatureCard `aria-label`
 * (`"${askHelix} · ${buttonLabel}"`), so TalkBack announces the contextual Helix verb, not just "Ask Helix".
 */
fun suggestButtonContentDescription(resolve: StringResolver): String {
    val labels = geofenceDraftLabels(resolve)
    return "${labels.askHelix} · ${labels.suggestButton}"
}

// ── Proposed automation graph (web `AutomationFullInput` + `AutomationDraft`) ─────────────────────────────────

/**
 * The typed automation graph Helix proposes — the native mirror of the web `AutomationFullInput` the
 * `normalizeAutomationInput` narrowing produces. The [triggers]/[conditions]/[actions] are carried as their raw
 * wire elements so the full graph can be handed back to the parent editor unchanged; the composable shows only
 * their [triggerCount]/[conditionCount]/[actionCount] (web's `.length`). Nothing is persisted here — the parent
 * copies this into the baseline AutomationBuilder form (ADR-015 §I3/§I8).
 */
data class AutomationGraphDraft(
    val name: String,
    val description: String,
    val vehicleId: Long,
    val enabled: Boolean,
    val triggers: List<JsonElement>,
    val conditions: List<JsonElement>,
    val actions: List<JsonElement>,
) {
    /** Trigger node count (web `draft.triggers.length`). */
    val triggerCount: Int get() = triggers.size

    /** Condition node count (web `draft.conditions.length`). */
    val conditionCount: Int get() = conditions.size

    /** Action node count (web `draft.actions.length`). */
    val actionCount: Int get() = actions.size
}

/**
 * The captured `draft_automation_graph` envelope — the native mirror of the web `AutomationDraft`
 * (`{ draft, status, validation_error }`). The [graph] is shown regardless of [status]; [isOk] (web
 * `status === 'ok'`) gates the "Apply to form" affordance, and a non-ok status surfaces the validator-rejected
 * notice. [validationError] is the optional human-readable reason the validator returned.
 */
data class AutomationProposal(
    val graph: AutomationGraphDraft,
    val status: String,
    val validationError: String? = null,
) {
    /** True only when the validator accepted the graph (web `draft.status === 'ok'`), enabling Apply. */
    val isOk: Boolean get() = status == "ok"
}

/**
 * Defensively coerces the typed envelope the LLM produces into the [AutomationGraphDraft] the parent's
 * form expects — the native mirror of the web `normalizeAutomationInput`. Anything we cannot positively prove
 * from the wire shape is rejected (return `null`) so a malformed draft never silently corrupts the user's form
 * state: [name] must be a string (empty allowed), [vehicleId] a JSON number, [enabled] a boolean, and
 * triggers/conditions/actions JSON arrays. [description] defaults to the empty string when absent.
 */
@Suppress("ReturnCount")
fun normalizeAutomationInput(value: JsonElement?): AutomationGraphDraft? {
    val obj = value as? JsonObject ?: return null
    val name = obj.stringField("name") ?: return null
    val vehicleId = obj.numberField("vehicle_id") ?: return null
    val enabled = obj.booleanField("enabled") ?: return null
    val triggers = obj.arrayField("triggers") ?: return null
    val conditions = obj.arrayField("conditions") ?: return null
    val actions = obj.arrayField("actions") ?: return null
    return AutomationGraphDraft(
        name = name,
        description = obj.stringField("description") ?: "",
        vehicleId = vehicleId.toLong(),
        enabled = enabled,
        triggers = triggers,
        conditions = conditions,
        actions = actions,
    )
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

/** The tool whose `tool_result` carries the typed automation graph (web `name === 'draft_automation_graph'`). */
const val DRAFT_TOOL_NAME: String = "draft_automation_graph"

/**
 * Captures the proposed [AutomationProposal] from a `tool_result` event — the native mirror of the web
 * `handleEvent`. Returns `null` for any event that is not an OK `draft_automation_graph` result whose `draft`
 * normalizes and whose `status` is a string, exactly matching the web guards. Unlike a validated-only flow the
 * draft is captured for any status; the non-ok case is surfaced as a validator-rejected proposal downstream.
 */
@Suppress("ReturnCount")
fun extractProposal(event: AiStreamEvent): AutomationProposal? {
    val result = event as? AiStreamEvent.ToolResult ?: return null
    if (result.name != DRAFT_TOOL_NAME || !result.ok) return null
    val data = result.data as? JsonObject ?: return null
    val graph = normalizeAutomationInput(data["draft"]) ?: return null
    val status = data.stringField("status") ?: return null
    return AutomationProposal(
        graph = graph,
        status = status,
        validationError = data.nonEmptyStringField("validation_error"),
    )
}

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
 * argument (and the view re-renders atomically): the stream [phase], the last captured [proposal], the
 * accumulated descriptive-replay [streamedText], and the terminal [errorMessage]/[limit].
 */
data class StreamRuntime(
    val phase: AiStreamPhase = AiStreamPhase.Idle,
    val proposal: AutomationProposal? = null,
    val streamedText: String = "",
    val errorMessage: String? = null,
    val limit: AiLimitInfo? = null,
)

/** The mutually-exclusive surface the composable renders — the prompt's mandated state set. */
enum class GeofenceDraftRenderState { Loading, Content, Empty, Error, Stale, Offline }

/**
 * The immutable snapshot the composable paints. [canStart] mirrors the web `canStart` prop
 * (`(vehicleId ?? 0) > 0 && prompt.trim().length > 0 && state !== 'paused-confirm'`, plus connectivity);
 * [isBusy] disables the Suggest button while a stream is in flight (web `streaming || paused-confirm`).
 * [proposal] is retained across refresh/offline so the last-known graph is never blanked — it is flagged
 * [stale], never hidden.
 */
@Suppress("LongParameterList")
data class GeofenceDraftSnapshot(
    val renderState: GeofenceDraftRenderState,
    val phase: AiStreamPhase,
    val proposal: AutomationProposal?,
    val streamedText: String,
    val canStart: Boolean,
    val isBusy: Boolean,
    val errorMessage: String?,
    val limit: AiLimitInfo?,
    val offline: Boolean,
    val stale: Boolean,
)

/**
 * Projects the vehicle scope + prompt-readiness + stream [runtime] + connectivity onto a [GeofenceDraftSnapshot]
 * — the single, side-effect-free place the prompt's six render states are derived, so the composable only paints:
 *  - `online == false` ⇒ Offline (last-known [StreamRuntime.proposal] kept visible, suggest disabled);
 *  - a terminal error classified as a connectivity failure ⇒ Offline, any other error ⇒ Error (+ retry);
 *  - streaming with a previously-captured proposal ⇒ Stale (refreshing over last-known), otherwise Loading;
 *  - `paused-confirm` ⇒ Loading (still in flight);
 *  - a captured proposal or streamed replay text ⇒ Content;
 *  - everything resolved with nothing to show ⇒ Empty.
 */
fun projectGeofenceDraft(
    vehicleId: Long,
    promptReady: Boolean,
    runtime: StreamRuntime,
    online: Boolean,
): GeofenceDraftSnapshot {
    val busy = runtime.phase == AiStreamPhase.Streaming || runtime.phase == AiStreamPhase.PausedConfirm
    val startable = vehicleId > 0L && promptReady
    val canStart = startable && runtime.phase != AiStreamPhase.PausedConfirm && online
    val renderState = renderStateFor(runtime, online)
    val offline = renderState == GeofenceDraftRenderState.Offline
    val stale = renderState == GeofenceDraftRenderState.Stale || (offline && runtime.proposal != null)
    return GeofenceDraftSnapshot(
        renderState = renderState,
        phase = runtime.phase,
        proposal = runtime.proposal,
        streamedText = runtime.streamedText,
        canStart = canStart,
        isBusy = busy,
        errorMessage = runtime.errorMessage,
        limit = runtime.limit,
        offline = offline,
        stale = stale,
    )
}

/**
 * Decides which render surface to show for the current stream [runtime] + connectivity. Extracted from
 * [projectGeofenceDraft] so each function stays within the cyclomatic-complexity budget.
 */
private fun renderStateFor(
    runtime: StreamRuntime,
    online: Boolean,
): GeofenceDraftRenderState {
    val networkError =
        runtime.phase == AiStreamPhase.Error && isNetworkFailure(runtime.limit?.reason, runtime.errorMessage)
    return when {
        !online -> GeofenceDraftRenderState.Offline
        networkError -> GeofenceDraftRenderState.Offline
        runtime.phase == AiStreamPhase.Error -> GeofenceDraftRenderState.Error
        runtime.phase == AiStreamPhase.Streaming && runtime.proposal != null -> GeofenceDraftRenderState.Stale
        runtime.phase == AiStreamPhase.Streaming -> GeofenceDraftRenderState.Loading
        runtime.phase == AiStreamPhase.PausedConfirm -> GeofenceDraftRenderState.Loading
        runtime.proposal != null -> GeofenceDraftRenderState.Content
        runtime.streamedText.isNotBlank() -> GeofenceDraftRenderState.Content
        else -> GeofenceDraftRenderState.Empty
    }
}

/**
 * Classifies a terminal stream failure as a connectivity problem (so it renders as Offline rather than a hard
 * error), folding the structured `reason` (web F9 limit fields) and the `stream_http_0` / network-ish message
 * the fetch transport surfaces on an unreachable host. Mirrors the Android `errorKindOf` Network/Timeout fold.
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

/** Reads [key] as a boolean, only when it is a non-string JSON primitive (web `typeof === 'boolean'`). */
private fun JsonObject.booleanField(key: String): Boolean? {
    val primitive = (this[key] as? JsonPrimitive)?.takeUnless { it.isString } ?: return null
    return primitive.booleanOrNull
}

/** Reads [key] as a JSON array, returning its elements (web `Array.isArray(value)`). */
private fun JsonObject.arrayField(key: String): List<JsonElement>? = (this[key] as? JsonArray)?.toList()

/** Reads [key] as a string primitive, allowing the empty string (web `typeof === 'string'`). */
private fun JsonObject.stringField(key: String): String? {
    val primitive = this[key] as? JsonPrimitive ?: return null
    return if (primitive.isString) primitive.content else null
}

/** Reads [key] as a non-empty string primitive (web `typeof === 'string' && value !== ''`). */
private fun JsonObject.nonEmptyStringField(key: String): String? = stringField(key)?.takeIf { it.isNotEmpty() }
