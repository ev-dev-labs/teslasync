// Pure, framework-free model + projection for the AIDataRepairSuggestions shared surface — the native
// analogue of everything the web component derives before it returns JSX
// (web/src/components/ai/AIDataRepairSuggestions.tsx). No Compose, no Android, no HTTP lives here, so every
// declaration is exercised off-device by the :android:testReleaseUnitTest gate and the composable stays a thin
// render layer (ADR-002).
//
// The web component is an AIFeatureCard whose primary surface is "header + Draft button + streamed output". It
// drives `useAiStream` against POST /ai/system/data-repair/draft with an EMPTY body — the backend reads the
// in-scope stale-session inventory itself (the canonical ChargingRepo.GetStale / DriveRepo.GetStale paths), so
// there is no per-request input and no typed proposal envelope: the suggestion is the descriptive repair plan
// accumulated from the SSE `delta` frames into the shared AiOutputPanel. Helix never writes (ADR-015 §I3/§I8) —
// the baseline DataRepairPage Save / Close / Discard buttons stay the sole write path. This file owns the
// parity-critical pieces that have nothing to do with Compose:
//   - the i18n by-name facade (the [StringResolver] seam) + the surface's source keys (web `t(key, …)`),
//   - the native [AiStreamEvent] union + the SSE frame parser (the consume side of web `useAiStream`),
//   - the [AiDataRepairRenderState] projection covering every state the prompt mandates
//     (loading / content / empty / error / stale / offline),
//   - and the PII-safe `view.opened` diagnostic (P1/S11).
//
// `InvalidPackageDeclaration`/`MatchingDeclarationName`/`filename` are suppressed because the mandated surface
// directory (com/teslasync/shared-surfaces/AIDataRepairSuggestions — the P3 prompt's allowed-files path) cannot
// form a valid Kotlin package identifier and the file hosts several co-located declarations, exactly as the
// sibling surfaces do.
@file:Suppress("InvalidPackageDeclaration", "MatchingDeclarationName", "ktlint:standard:filename")

package io.teslasync.android.sharedsurfaces.aidatarepairsuggestions

import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.doubleOrNull

/**
 * Canonical metadata for the surface. [ID] is the web `withAiFeature('data-repair-suggestions', …)` feature id
 * (the per-feature AI-Off gate, ADR-015 §I5); [SLUG] is the diagnostics surface slug emitted with the one-shot
 * `view.opened` event (P1/S11).
 */
object AIDataRepairSuggestionsRegistration {
    /** Per-feature AI-Off gate id — mirrors the web `withAiFeature('data-repair-suggestions', …)` argument. */
    const val ID: String = "data-repair-suggestions"

    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). */
    const val SLUG: String = "AIDataRepairSuggestions"

    /** The registered backend route the draft stream POSTs against (web `useAiStream({ url })`). */
    const val DRAFT_ROUTE: String = "/ai/system/data-repair/draft"
}

/**
 * Emits the one PII-safe `view.opened` diagnostic with the surface [AIDataRepairSuggestionsRegistration.SLUG]
 * (P1/S11). Kept free of Compose so it is unit-tested with a recording [Logger]; the view-model calls it from the
 * first-composition effect. It carries only the static slug, so a diagnostics line can never leak a session id,
 * vehicle, or any drafted value (ADR-016).
 */
fun recordAIDataRepairViewOpened(logger: Logger) {
    logger.info("view.opened", mapOf("surface" to AIDataRepairSuggestionsRegistration.SLUG))
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
 * The surface's i18n keys + their exact web English fallbacks. The four `dataRepair.aiSuggestions.*` source keys
 * carry the verbatim inline fallbacks the web component passes to `t(key, default)` (the keys are not in the
 * shared catalog, so the web renders the fallback — this resolver folds + falls back identically). The `helix.*`
 * + `ai.common.*` keys carry the same fallback the shared web scaffold (`AIFeatureCard` / `AIBadge` /
 * `AiOutputPanel`) renders when a key is absent, and the native state-chrome keys carry English consistent with
 * that scaffold, so the rendered English is identical either way.
 */
internal object AiDataRepairKeys {
    const val TITLE = "dataRepair.aiSuggestions.title"
    const val TITLE_EN = "Helix repair suggestions"

    const val DESCRIPTION = "dataRepair.aiSuggestions.description"
    const val DESCRIPTION_EN =
        "Propose a typed repair plan (close, discard, or partial-update) for one stale charging session or drive " +
            "from the inventory below. The LLM never writes — review the proposal here and click the canonical " +
            "Save / Close / Discard button on the matching baseline form to apply it."

    const val BADGE = "dataRepair.aiSuggestions.badge"
    const val BADGE_EN = "Helix"

    const val DRAFT_BUTTON = "dataRepair.aiSuggestions.button"
    const val DRAFT_BUTTON_EN = "Draft repair plan"

    const val ASK_HELIX = "helix.askHelix"
    const val ASK_HELIX_EN = "Ask Helix"

    const val THINKING = "helix.thinking"
    const val THINKING_EN = "Helix is thinking…"

    const val BADGE_ARIA = "helix.ariaLabel"
    const val BADGE_ARIA_EN = "Helix"

    const val ERROR_LABEL = "helix.errorLabel"
    const val ERROR_LABEL_EN = "Helix error:"

    const val ERROR_UNKNOWN = "ai.common.errorUnknown"
    const val ERROR_UNKNOWN_EN = "unknown"

    const val EMPTY = "dataRepair.aiSuggestions.empty"
    const val EMPTY_EN = "No repair plan yet. Ask Helix to review the stale-session inventory and draft a typed plan."

    const val ERROR_TITLE = "dataRepair.aiSuggestions.errorTitle"
    const val ERROR_TITLE_EN = "Couldn't draft a repair plan"

    const val RETRY = "common.retry"
    const val RETRY_EN = "Retry"

    const val OFFLINE = "dataRepair.aiSuggestions.offline"
    const val OFFLINE_EN = "You're offline. Showing the last drafted plan, if any."

    const val STALE = "dataRepair.aiSuggestions.stale"
    const val STALE_EN = "Last suggestion — refreshing…"
}

/** The fully-resolved display strings the composable paints — resolved off-device so i18n is unit-testable. */
@Suppress("LongParameterList")
data class AiDataRepairLabels(
    val title: String,
    val description: String,
    val badge: String,
    val badgeAria: String,
    val draftButton: String,
    val askHelix: String,
    val thinking: String,
    val errorLabel: String,
    val errorUnknown: String,
    val empty: String,
    val errorTitle: String,
    val retry: String,
    val offline: String,
    val stale: String,
)

/** Resolves every surface label through [resolve], folding the web `t(key, fallback)` calls into one value. */
fun aiDataRepairLabels(resolve: StringResolver): AiDataRepairLabels =
    AiDataRepairLabels(
        title = resolve(AiDataRepairKeys.TITLE, AiDataRepairKeys.TITLE_EN),
        description = resolve(AiDataRepairKeys.DESCRIPTION, AiDataRepairKeys.DESCRIPTION_EN),
        badge = resolve(AiDataRepairKeys.BADGE, AiDataRepairKeys.BADGE_EN),
        badgeAria = resolve(AiDataRepairKeys.BADGE_ARIA, AiDataRepairKeys.BADGE_ARIA_EN),
        draftButton = resolve(AiDataRepairKeys.DRAFT_BUTTON, AiDataRepairKeys.DRAFT_BUTTON_EN),
        askHelix = resolve(AiDataRepairKeys.ASK_HELIX, AiDataRepairKeys.ASK_HELIX_EN),
        thinking = resolve(AiDataRepairKeys.THINKING, AiDataRepairKeys.THINKING_EN),
        errorLabel = resolve(AiDataRepairKeys.ERROR_LABEL, AiDataRepairKeys.ERROR_LABEL_EN),
        errorUnknown = resolve(AiDataRepairKeys.ERROR_UNKNOWN, AiDataRepairKeys.ERROR_UNKNOWN_EN),
        empty = resolve(AiDataRepairKeys.EMPTY, AiDataRepairKeys.EMPTY_EN),
        errorTitle = resolve(AiDataRepairKeys.ERROR_TITLE, AiDataRepairKeys.ERROR_TITLE_EN),
        retry = resolve(AiDataRepairKeys.RETRY, AiDataRepairKeys.RETRY_EN),
        offline = resolve(AiDataRepairKeys.OFFLINE, AiDataRepairKeys.OFFLINE_EN),
        stale = resolve(AiDataRepairKeys.STALE, AiDataRepairKeys.STALE_EN),
    )

/**
 * The Draft button's accessible name — the native mirror of the web AIFeatureCard `aria-label`
 * (`"${askHelix} · ${buttonLabel}"`), so TalkBack announces the contextual Helix verb, not just "Ask Helix".
 */
fun draftButtonContentDescription(resolve: StringResolver): String {
    val labels = aiDataRepairLabels(resolve)
    return "${labels.askHelix} · ${labels.draftButton}"
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

/**
 * The discriminated union of every SSE event the backend AI writer emits (web `AiStreamEvent`). The draft
 * endpoint only accumulates `delta` text into the output panel, but the parser stays at full parity with
 * `useAiStream` so a future server adding a `tool_call`/`tool_result`/`confirm_request` frame is decoded (not
 * crashed on) by an older client; the reducer simply ignores the tool frames this surface has no use for.
 */
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
 * argument (and the view re-renders atomically): the stream [phase], the accumulated descriptive-replay
 * [streamedText] of the IN-FLIGHT draft, the last COMPLETED [lastPlan] (retained across a refresh so the
 * stale/offline surfaces keep the last-known plan visible rather than blanking it), and the terminal
 * [errorMessage]/[limit].
 */
data class StreamRuntime(
    val phase: AiStreamPhase = AiStreamPhase.Idle,
    val streamedText: String = "",
    val lastPlan: String = "",
    val errorMessage: String? = null,
    val limit: AiLimitInfo? = null,
)

/** The mutually-exclusive surface the composable renders — the prompt's mandated state set. */
enum class AiDataRepairRenderState { Loading, Content, Empty, Error, Stale, Offline }

/**
 * The immutable snapshot the composable paints. [canStart] mirrors the web `canStart` prop
 * (`state !== 'streaming'`, plus connectivity); [isBusy] disables the Draft button + shows the thinking label
 * while a stream is in flight (web `streaming`). [text] is the descriptive plan to show — the in-flight
 * accumulation when present, otherwise the last completed plan — so the last-known plan is never blanked across a
 * refresh/offline transition; it is flagged [stale], never hidden.
 */
@Suppress("LongParameterList")
data class AiDataRepairSnapshot(
    val renderState: AiDataRepairRenderState,
    val phase: AiStreamPhase,
    val text: String,
    val canStart: Boolean,
    val isBusy: Boolean,
    val errorMessage: String?,
    val limit: AiLimitInfo?,
    val offline: Boolean,
    val stale: Boolean,
)

/**
 * Projects the stream [runtime] + connectivity onto an [AiDataRepairSnapshot] — the single, side-effect-free
 * place the prompt's six render states are derived, so the composable only paints:
 *  - `online == false` ⇒ Offline (last-known plan kept visible, draft disabled);
 *  - a terminal error classified as a connectivity failure ⇒ Offline, any other error ⇒ Error (+ retry);
 *  - streaming/paused with a previously-completed plan ⇒ Stale (refreshing over last-known), otherwise Loading;
 *  - a completed/in-flight plan with text ⇒ Content;
 *  - everything resolved with nothing to show ⇒ Empty.
 */
fun projectAiDataRepair(
    runtime: StreamRuntime,
    online: Boolean,
): AiDataRepairSnapshot {
    val busy = runtime.phase == AiStreamPhase.Streaming || runtime.phase == AiStreamPhase.PausedConfirm
    val canStart = online && runtime.phase != AiStreamPhase.Streaming && runtime.phase != AiStreamPhase.PausedConfirm
    val text = runtime.streamedText.ifBlank { runtime.lastPlan }
    val renderState = renderStateFor(runtime, text, online)
    val offline = renderState == AiDataRepairRenderState.Offline
    val stale = renderState == AiDataRepairRenderState.Stale || (offline && text.isNotBlank())
    return AiDataRepairSnapshot(
        renderState = renderState,
        phase = runtime.phase,
        text = text,
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
 * [projectAiDataRepair] so each function stays within the cyclomatic-complexity budget. [text] is the resolved
 * display plan (in-flight accumulation, else the last completed plan).
 */
private fun renderStateFor(
    runtime: StreamRuntime,
    text: String,
    online: Boolean,
): AiDataRepairRenderState {
    val busy = runtime.phase == AiStreamPhase.Streaming || runtime.phase == AiStreamPhase.PausedConfirm
    val networkError =
        runtime.phase == AiStreamPhase.Error && isNetworkFailure(runtime.limit?.reason, runtime.errorMessage)
    return when {
        !online -> AiDataRepairRenderState.Offline
        networkError -> AiDataRepairRenderState.Offline
        runtime.phase == AiStreamPhase.Error -> AiDataRepairRenderState.Error
        busy && runtime.lastPlan.isNotBlank() -> AiDataRepairRenderState.Stale
        busy -> AiDataRepairRenderState.Loading
        text.isNotBlank() -> AiDataRepairRenderState.Content
        else -> AiDataRepairRenderState.Empty
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
