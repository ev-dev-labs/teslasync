// Pure, framework-free model + projection for the AIAlertTuningSuggestions shared surface — the native
// analogue of everything the web component derives before it returns JSX
// (web/src/components/ai/AIAlertTuningSuggestions.tsx). No Compose, no Android, no HTTP lives here, so every
// declaration is exercised off-device by the :app:testReleaseUnitTest gate and the composable stays a thin
// render layer (ADR-002).
//
// The web component is an AIFeatureCard whose primary surface is "header + Suggest button + streamed output".
// It drives `useAiStream` against POST /ai/alerts/rules/{ruleID}/tune/draft, captures a typed
// AlertRulePatchProposal from `tool_result` frames, and surfaces an "Apply to form" affordance that hands the
// proposed scalars back to the parent editor via `onApplyDraft` (ADR-015 §I3/§I8 — the AI panel NEVER persists,
// the baseline AlertStudio Save button stays the sole write path). This file owns the parity-critical pieces
// that have nothing to do with Compose:
//   - the i18n by-name facade (the [StringResolver] seam) + the surface's six source keys (web `t(key, …)`),
//   - the typed [AlertRuleDraftPatch] + the `tool_result` → patch extraction (web `handleEvent`),
//   - the native [AiStreamEvent] union + the SSE frame parser (the consume side of web `useAiStream`),
//   - the [AiTuningRenderState] projection covering every state the prompt mandates
//     (loading / content / empty / error / stale / offline),
//   - and the PII-safe `view.opened` diagnostic (P1/S11).
//
// `InvalidPackageDeclaration`/`MatchingDeclarationName`/`filename` are suppressed because the mandated surface
// directory (com/teslasync/shared-surfaces/AIAlertTuningSuggestions — the P3 prompt's allowed-files path)
// cannot form a valid Kotlin package identifier and the file hosts several co-located declarations, exactly as
// the sibling surfaces do.
@file:Suppress("InvalidPackageDeclaration", "MatchingDeclarationName", "ktlint:standard:filename")

package io.teslasync.android.sharedsurfaces.aialerttuningsuggestions

import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.doubleOrNull
import kotlin.math.floor

/**
 * Canonical metadata for the surface. [ID] is the web `withAiFeature('alert-tuning-suggestions', …)` feature id
 * (the per-feature AI-Off gate, ADR-015 §I5); [SLUG] is the diagnostics surface slug emitted with the one-shot
 * `view.opened` event (P1/S11).
 */
object AIAlertTuningSuggestionsRegistration {
    /** Per-feature AI-Off gate id — mirrors the web `withAiFeature('alert-tuning-suggestions', …)` argument. */
    const val ID: String = "alert-tuning-suggestions"

    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). */
    const val SLUG: String = "AIAlertTuningSuggestions"
}

/**
 * Emits the one PII-safe `view.opened` diagnostic with the surface [AIAlertTuningSuggestionsRegistration.SLUG]
 * (P1/S11). Kept free of Compose so it is unit-tested with a recording [Logger]; the view-model calls it from
 * the first-composition effect. It carries only the static slug, so a diagnostics line can never leak a rule id,
 * vehicle, or any proposed value (ADR-016).
 */
fun recordAITuningViewOpened(logger: Logger) {
    logger.info("view.opened", mapOf("surface" to AIAlertTuningSuggestionsRegistration.SLUG))
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
 * The surface's i18n keys + their exact web English fallbacks. The six `notifications.alertStudio.aiTuning.*`
 * keys are lifted verbatim from web/src/i18n/en.json (the component's `t(key, default)` calls); the `helix.*`
 * keys and the native state-chrome keys carry the same fallback the shared web scaffold (`AIFeatureCard` /
 * `AiOutputPanel`) renders when a key is absent, so the rendered English is identical either way.
 */
internal object AiTuningKeys {
    const val TITLE = "notifications.alertStudio.aiTuning.title"
    const val TITLE_EN = "Suggest lower-noise tuning"

    const val DESCRIPTION = "notifications.alertStudio.aiTuning.description"
    const val DESCRIPTION_EN =
        "Review recent firings and propose a typed AlertRule patch. Descriptive replay only — review before saving."

    const val BADGE = "notifications.alertStudio.aiTuning.badge"
    const val BADGE_EN = "Helix"

    const val SUGGEST_BUTTON = "notifications.alertStudio.aiTuning.suggestButton"
    const val SUGGEST_BUTTON_EN = "Suggest tuning"

    const val APPLY_BUTTON = "notifications.alertStudio.aiTuning.applyButton"
    const val APPLY_BUTTON_EN = "Apply to form"

    const val PREVIEW_LABEL = "notifications.alertStudio.aiTuning.previewLabel"
    const val PREVIEW_LABEL_EN = "Proposed patch (review before saving):"

    const val ASK_HELIX = "helix.askHelix"
    const val ASK_HELIX_EN = "Ask Helix"

    const val THINKING = "helix.thinking"
    const val THINKING_EN = "Helix is thinking…"

    const val BADGE_ARIA = "helix.ariaLabel"
    const val BADGE_ARIA_EN = "Helix"

    const val EMPTY = "notifications.alertStudio.aiTuning.empty"
    const val EMPTY_EN = "No proposal yet. Ask Helix to review recent firings and draft a typed patch."

    const val WAITING = "notifications.alertStudio.aiTuning.waiting"
    const val WAITING_EN = "Select a rule to let Helix suggest lower-noise tuning."

    const val ERROR_TITLE = "notifications.alertStudio.aiTuning.errorTitle"
    const val ERROR_TITLE_EN = "Couldn't draft a suggestion"

    const val RETRY = "common.retry"
    const val RETRY_EN = "Retry"

    const val OFFLINE = "notifications.alertStudio.aiTuning.offline"
    const val OFFLINE_EN = "You're offline. Showing the last proposed patch, if any."

    const val STALE = "notifications.alertStudio.aiTuning.stale"
    const val STALE_EN = "Last suggestion — refreshing…"
}

/** The fully-resolved display strings the composable paints — resolved off-device so i18n is unit-testable. */
@Suppress("LongParameterList")
data class AiTuningLabels(
    val title: String,
    val description: String,
    val badge: String,
    val badgeAria: String,
    val suggestButton: String,
    val applyButton: String,
    val previewLabel: String,
    val askHelix: String,
    val thinking: String,
    val empty: String,
    val waiting: String,
    val errorTitle: String,
    val retry: String,
    val offline: String,
    val stale: String,
)

/** Resolves every surface label through [resolve], folding the web `t(key, fallback)` calls into one value. */
fun aiTuningLabels(resolve: StringResolver): AiTuningLabels =
    AiTuningLabels(
        title = resolve(AiTuningKeys.TITLE, AiTuningKeys.TITLE_EN),
        description = resolve(AiTuningKeys.DESCRIPTION, AiTuningKeys.DESCRIPTION_EN),
        badge = resolve(AiTuningKeys.BADGE, AiTuningKeys.BADGE_EN),
        badgeAria = resolve(AiTuningKeys.BADGE_ARIA, AiTuningKeys.BADGE_ARIA_EN),
        suggestButton = resolve(AiTuningKeys.SUGGEST_BUTTON, AiTuningKeys.SUGGEST_BUTTON_EN),
        applyButton = resolve(AiTuningKeys.APPLY_BUTTON, AiTuningKeys.APPLY_BUTTON_EN),
        previewLabel = resolve(AiTuningKeys.PREVIEW_LABEL, AiTuningKeys.PREVIEW_LABEL_EN),
        askHelix = resolve(AiTuningKeys.ASK_HELIX, AiTuningKeys.ASK_HELIX_EN),
        thinking = resolve(AiTuningKeys.THINKING, AiTuningKeys.THINKING_EN),
        empty = resolve(AiTuningKeys.EMPTY, AiTuningKeys.EMPTY_EN),
        waiting = resolve(AiTuningKeys.WAITING, AiTuningKeys.WAITING_EN),
        errorTitle = resolve(AiTuningKeys.ERROR_TITLE, AiTuningKeys.ERROR_TITLE_EN),
        retry = resolve(AiTuningKeys.RETRY, AiTuningKeys.RETRY_EN),
        offline = resolve(AiTuningKeys.OFFLINE, AiTuningKeys.OFFLINE_EN),
        stale = resolve(AiTuningKeys.STALE, AiTuningKeys.STALE_EN),
    )

/**
 * The Suggest button's accessible name — the native mirror of the web AIFeatureCard `aria-label`
 * (`"${askHelix} · ${buttonLabel}"`), so TalkBack announces the contextual Helix verb, not just "Ask Helix".
 */
fun suggestButtonContentDescription(resolve: StringResolver): String {
    val labels = aiTuningLabels(resolve)
    return "${labels.askHelix} · ${labels.suggestButton}"
}

// ── Proposed patch (web `AlertRuleDraftPatch`) ───────────────────────────────────────────────────────────────

/**
 * The subset of AlertRule scalars Helix is allowed to propose — the native mirror of the web
 * `AlertRuleDraftPatch`, kept narrow so the panel can never overwrite fields the user did not consent to
 * changing (signal_name, vehicle scope). All fields are optional: only the keys present in the tool result are
 * carried. The wire labels in [toPreviewRows] are rendered verbatim (web parity — they are field names, not
 * localized copy).
 */
data class AlertRuleDraftPatch(
    val valueNum: Double? = null,
    val valueMin: Double? = null,
    val valueMax: Double? = null,
    val cooldownMin: Int? = null,
    val severity: String? = null,
    val triggerMode: String? = null,
    val op: String? = null,
) {
    /** True when no recognized scalar was proposed (an empty `proposed` object). */
    val isEmpty: Boolean
        get() = toPreviewRows().isEmpty()

    /**
     * The preview rows the composable lists, in the web component's exact order and with its verbatim wire
     * labels (`value_num`, `value_min`, …). Numbers drop a redundant `.0` so an integer proposal reads "21",
     * matching how the web renders a JSON integer.
     */
    fun toPreviewRows(): List<Pair<String, String>> =
        buildList {
            valueNum?.let { add("value_num" to formatPatchNumber(it)) }
            valueMin?.let { add("value_min" to formatPatchNumber(it)) }
            valueMax?.let { add("value_max" to formatPatchNumber(it)) }
            cooldownMin?.let { add("cooldown_min" to it.toString()) }
            severity?.let { add("severity" to it) }
            triggerMode?.let { add("trigger_mode" to it) }
            op?.let { add("op" to it) }
        }
}

/** Renders an integral double without a trailing `.0` (web prints a JSON integer as "21", not "21.0"). */
fun formatPatchNumber(value: Double): String =
    if (value.isFinite() && floor(value) == value) value.toLong().toString() else value.toString()

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

/** The tool whose `tool_result` carries the typed AlertRule patch (web `name === 'draft_alert_rule_patch'`). */
const val DRAFT_TOOL_NAME: String = "draft_alert_rule_patch"

/**
 * Captures the proposed [AlertRuleDraftPatch] from a `tool_result` event — the native mirror of the web
 * `handleEvent`. Returns `null` for any event that is not an OK `draft_alert_rule_patch` result with a
 * `status: "ok"` envelope and a `proposed` object, exactly matching the web guards. A `proposed` object with no
 * recognized scalars yields an [AlertRuleDraftPatch.isEmpty] patch (web still calls `setProposal` in that case).
 */
fun extractDraftPatch(event: AiStreamEvent): AlertRuleDraftPatch? {
    val proposed = (event as? AiStreamEvent.ToolResult)?.proposedObject() ?: return null
    return parseProposed(proposed)
}

/** The OK `draft_alert_rule_patch` result's `proposed` object, or `null` for any other / !ok / non-`status:ok` frame. */
private fun AiStreamEvent.ToolResult.proposedObject(): JsonObject? {
    val data = (this.data as? JsonObject)?.takeIf { name == DRAFT_TOOL_NAME && ok } ?: return null
    val statusOk = (data["status"] as? JsonPrimitive)?.takeIf { it.isString }?.content == "ok"
    return if (statusOk) data["proposed"] as? JsonObject else null
}

/** Reads the recognized scalars off a `proposed` object (web's typed `value_num`/`severity`/… narrowing). */
fun parseProposed(proposed: JsonObject): AlertRuleDraftPatch =
    AlertRuleDraftPatch(
        valueNum = proposed.numberField("value_num"),
        valueMin = proposed.numberField("value_min"),
        valueMax = proposed.numberField("value_max"),
        cooldownMin = proposed.numberField("cooldown_min")?.toInt(),
        severity = proposed.nonEmptyStringField("severity"),
        triggerMode = proposed.nonEmptyStringField("trigger_mode"),
        op = proposed.nonEmptyStringField("op"),
    )

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

/** The rule + optional vehicle the stream targets (web `ruleId` / `vehicleId` props). */
data class RuleTarget(
    val ruleId: Long,
    val vehicleId: Long?,
)

/**
 * The mutable runtime the view-model folds the stream into. Kept as one value so the projection takes a single
 * argument (and the view re-renders atomically): the stream [phase], the last captured [proposal], the
 * accumulated descriptive-replay [streamedText], and the terminal [errorMessage]/[limit].
 */
data class StreamRuntime(
    val phase: AiStreamPhase = AiStreamPhase.Idle,
    val proposal: AlertRuleDraftPatch? = null,
    val streamedText: String = "",
    val errorMessage: String? = null,
    val limit: AiLimitInfo? = null,
)

/** The mutually-exclusive surface the composable renders — the prompt's mandated state set. */
enum class AiTuningRenderState { Loading, Content, Empty, Error, Stale, Offline }

/**
 * The immutable snapshot the composable paints. [canStart] mirrors the web `canStart` prop
 * (`!!ruleId && state !== 'paused-confirm'`, plus connectivity); [isBusy] disables the Suggest button while a
 * stream is in flight (web `streaming || paused-confirm`). [proposal] is retained across refresh/offline so the
 * last-known patch is never blanked — it is flagged [stale], never hidden.
 */
@Suppress("LongParameterList")
data class AiTuningSnapshot(
    val renderState: AiTuningRenderState,
    val phase: AiStreamPhase,
    val proposal: AlertRuleDraftPatch?,
    val streamedText: String,
    val canStart: Boolean,
    val isBusy: Boolean,
    val errorMessage: String?,
    val limit: AiLimitInfo?,
    val offline: Boolean,
    val stale: Boolean,
)

/**
 * Projects the rule target + stream [runtime] + connectivity onto an [AiTuningSnapshot] — the single,
 * side-effect-free place the prompt's six render states are derived, so the composable only paints:
 *  - `online == false` ⇒ Offline (last-known [StreamRuntime.proposal] kept visible, suggest disabled);
 *  - a terminal error classified as a connectivity failure ⇒ Offline, any other error ⇒ Error (+ retry);
 *  - streaming with a previously-captured proposal ⇒ Stale (refreshing over last-known), otherwise Loading;
 *  - `paused-confirm` ⇒ Loading (still in flight);
 *  - a captured proposal or streamed replay text ⇒ Content;
 *  - everything resolved with nothing to show ⇒ Empty.
 */
fun projectAiTuning(
    ruleId: Long,
    runtime: StreamRuntime,
    online: Boolean,
): AiTuningSnapshot {
    val busy = runtime.phase == AiStreamPhase.Streaming || runtime.phase == AiStreamPhase.PausedConfirm
    val canStart = ruleId > 0L && runtime.phase != AiStreamPhase.PausedConfirm && online
    val renderState = renderStateFor(runtime, online)
    val offline = renderState == AiTuningRenderState.Offline
    val stale = renderState == AiTuningRenderState.Stale || (offline && runtime.proposal != null)
    return AiTuningSnapshot(
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
 * [projectAiTuning] so each function stays within the cyclomatic-complexity budget.
 */
private fun renderStateFor(
    runtime: StreamRuntime,
    online: Boolean,
): AiTuningRenderState {
    val networkError =
        runtime.phase == AiStreamPhase.Error && isNetworkFailure(runtime.limit?.reason, runtime.errorMessage)
    return when {
        !online -> AiTuningRenderState.Offline
        networkError -> AiTuningRenderState.Offline
        runtime.phase == AiStreamPhase.Error -> AiTuningRenderState.Error
        runtime.phase == AiStreamPhase.Streaming && runtime.proposal != null -> AiTuningRenderState.Stale
        runtime.phase == AiStreamPhase.Streaming -> AiTuningRenderState.Loading
        runtime.phase == AiStreamPhase.PausedConfirm -> AiTuningRenderState.Loading
        runtime.proposal != null -> AiTuningRenderState.Content
        runtime.streamedText.isNotBlank() -> AiTuningRenderState.Content
        else -> AiTuningRenderState.Empty
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

/** Reads [key] as a string primitive, allowing the empty string (web `typeof === 'string'`). */
private fun JsonObject.stringField(key: String): String? {
    val primitive = this[key] as? JsonPrimitive ?: return null
    return if (primitive.isString) primitive.content else null
}

/** Reads [key] as a non-empty string primitive (web `typeof === 'string' && value !== ''`). */
private fun JsonObject.nonEmptyStringField(key: String): String? = stringField(key)?.takeIf { it.isNotEmpty() }
