// Pure, framework-free model + SSE decoder + projection + reducer + diagnostics for the
// AIAutoNameUnnamedLocations shared surface — the native analogue of the data the web component owns
// (web/src/components/ai/AIAutoNameUnnamedLocations.tsx together with the slice of web/src/hooks/useAiStream.ts
// it consumes). No Compose, no Android, no HTTP: every declaration here is unit-tested off-device in the
// :android:testReleaseUnitTest gate, keeping the composable a thin render layer and the source a thin transport.
//
// The web component opens a propose-only Helix draft stream (POST /ai/locations/{id}/name/draft), parses the
// SSE frames with `parseSSEFrame`/`toTypedEvent`, and folds the single `tool_result(draft_location_name, ok)`
// frame into a typed `LocationNameDraft` via its `handleEvent` callback. This file owns exactly that data +
// decision surface, ported 1:1:
//   - [AiStreamEvent] mirrors the web `AiStreamEvent` discriminated union (the events the stream can carry).
//   - [AiNameDraftPhase] mirrors the web `AiStreamState` lifecycle (idle → streaming → done | error, plus the
//     paused-confirm pause the web `canStart`/`isBusy` reference).
//   - [LocationNameDraft] mirrors the web `LocationNameDraft` envelope (the draft_location_name tool result).
//   - [AiNameDraftReducer.parseFrame] reproduces the web `parseSSEFrame` + `toTypedEvent` verbatim.
//   - [AiNameDraftReducer.draftFromToolResult] reproduces the web `handleEvent` validation verbatim (the
//     "data adapter": raw tool-result JSON → typed projection).
//   - [AiNameDraftReducer.reduce] folds one event into the render-ready [AiNameDraftUiState].
//
// There is deliberately no cache-then-network lifecycle (loading / stale / offline over a cached value): the web
// source is an ON-DEMAND, point-in-time stream, not a cached feed, so a proposal is never "stale" and there is
// no cached draft to replay offline (covenant: no silent drift). The honest state set is the web one — idle,
// streaming (the prompt's "loading"), done-with-draft (ok or rejected), and error (a stream-open failure is the
// honest "offline" branch: there is no cached proposal to fall back to, so it surfaces as an error + retry).
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/shared-surfaces — the P3 prompt's allowed-files path) cannot form a valid Kotlin package (a
// hyphen segment is illegal in a package identifier), so the package intentionally diverges from the path —
// exactly as the sibling feature-view / misc-surface ports do. `MatchingDeclarationName` is suppressed for the
// co-located supporting declarations.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.aiautonameunnamedlocations

import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.serialization.SerializationException
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.doubleOrNull

/**
 * The typed envelope returned by the `draft_location_name` tool — the native port of the web
 * `LocationNameDraft` interface (web/src/components/ai/AIAutoNameUnnamedLocations.tsx), itself mirroring the Go
 * `locationNameDraft` (internal/ai/tools/auto_name_unnamed_locations.go). Kept narrow so the panel only renders
 * fields it actually uses.
 *
 * @property locationId the visited-location synthetic id the proposal is scoped to (web `location_id`).
 * @property proposedName the concise human-readable name Helix proposed (web `proposed_name`).
 * @property status `"ok"` when the validator accepted the name, `"rejected"` (or any other non-ok string) when
 *   it did not — carried as a plain string so an unforeseen status never fails decoding (web `status`).
 * @property reason the optional validator explanation shown beneath the name (web `reason`).
 */
data class LocationNameDraft(
    val locationId: Long,
    val proposedName: String,
    val status: String,
    val reason: String? = null,
) {
    /** Whether the validator accepted the proposal — the only gate on the "Apply to form" action (web `status === 'ok'`). */
    val isOk: Boolean get() = status == OK_STATUS

    companion object {
        /** The accepted-proposal status the web component checks against (`'ok'`). */
        const val OK_STATUS: String = "ok"
    }
}

/**
 * The user-facing stream lifecycle — the native port of the web `AiStreamState`
 * (`'idle' | 'streaming' | 'paused-confirm' | 'done' | 'error'`). [PausedConfirm] is retained for 1:1 parity
 * with the web `canStart`/`isBusy` derivations even though this propose-only read tool never requests
 * confirmation in practice.
 */
enum class AiNameDraftPhase {
    /** No proposal requested yet (web `'idle'`) — the friendly initial surface (description + CTA), never blank. */
    Idle,

    /** A draft stream is open (web `'streaming'`) — the "loading"/"Helix is thinking" affordance. */
    Streaming,

    /** The stream paused awaiting a tool confirmation (web `'paused-confirm'`). */
    PausedConfirm,

    /** The stream finished (web `'done'`) — a [LocationNameDraft] may or may not have been captured. */
    Done,

    /** The stream failed to open or errored mid-flight (web `'error'`). */
    Error,
}

/**
 * One Server-Sent-Event the draft stream can carry — the native port of the web `AiStreamEvent` discriminated
 * union (web/src/hooks/useAiStream.ts). Only the fields this surface (and its decoder parity tests) read are
 * modelled; an unknown event type decodes to `null` so a future server event can never crash an older client
 * (web `toTypedEvent` default branch).
 */
sealed interface AiStreamEvent {
    /** Accumulated assistant text (web `{ type: 'delta'; text }`). */
    data class Delta(
        val text: String,
    ) : AiStreamEvent

    /** A tool invocation announcement (web `{ type: 'tool_call'; id; name; arguments }`). */
    data class ToolCall(
        val id: String,
        val name: String,
        val arguments: JsonElement?,
    ) : AiStreamEvent

    /**
     * A tool result frame (web `{ type: 'tool_result'; id; name; ok; data?; error? }`). The surface captures
     * the `draft_location_name` result here; [data] is the raw tool payload the projection validates.
     */
    data class ToolResult(
        val id: String,
        val name: String,
        val ok: Boolean,
        val data: JsonElement?,
        val error: String?,
    ) : AiStreamEvent

    /** A tool-confirmation request that pauses the stream (web `{ type: 'confirm_request'; … }`). */
    data class ConfirmRequest(
        val continuationId: String,
        val tool: String,
        val summary: String,
    ) : AiStreamEvent

    /** The terminal success frame (web `{ type: 'done'; finish_reason; usage }`). */
    data class Done(
        val finishReason: String,
    ) : AiStreamEvent

    /** The terminal error frame (web `{ type: 'error'; message; … }`). [message] feeds the surface's error state. */
    data class Failure(
        val message: String,
    ) : AiStreamEvent
}

/**
 * The immutable, render-ready state the surface draws — the native projection of the web component's local state
 * (`stream.state` + the captured `draft`). The composable switches surfaces on [phase] and renders [draft] /
 * [text] / [errorMessage]; it never re-derives the contract.
 *
 * @property phase the stream lifecycle (web `stream.state`).
 * @property draft the captured proposal, or `null` before one arrives (web `draft`).
 * @property text accumulated assistant delta text (web `stream.text`), shown in the streaming affordance.
 * @property errorMessage the technical failure message when [phase] is [AiNameDraftPhase.Error] (web `stream.error`).
 */
data class AiNameDraftUiState(
    val phase: AiNameDraftPhase = AiNameDraftPhase.Idle,
    val draft: LocationNameDraft? = null,
    val text: String = "",
    val errorMessage: String? = null,
) {
    /** True while a draft stream is open (web `stream.state === 'streaming'`). */
    val isStreaming: Boolean get() = phase == AiNameDraftPhase.Streaming

    /** True while the stream is in-flight or paused — the web `isBusy` (`streaming || paused-confirm`) double-submit guard. */
    val isBusy: Boolean get() = phase == AiNameDraftPhase.Streaming || phase == AiNameDraftPhase.PausedConfirm

    /** True when the stream terminated in failure (web `stream.state === 'error'`). */
    val isError: Boolean get() = phase == AiNameDraftPhase.Error

    /**
     * Whether the Suggest action may fire for [locationId] — the web `canStart` (`locationId > 0 &&
     * stream.state !== 'paused-confirm'`) combined with the AIFeatureCard streaming-disable
     * (`!canStart || isStreaming`). Computed, never a literal disabled flag (Rule W1-A).
     */
    fun canSuggest(locationId: Long): Boolean = locationId > 0 && phase != AiNameDraftPhase.PausedConfirm && !isStreaming

    companion object {
        /** The cold initial state — nothing requested yet (web `'idle'` + `draft === null`). */
        val IDLE: AiNameDraftUiState = AiNameDraftUiState()
    }
}

/**
 * The pure SSE decoder + projection + reducer — the native port of the slice of web `useAiStream` this surface
 * relies on plus its `handleEvent`. Every function is total, side-effect-free, and off-device tested, so the
 * stream-to-draft contract is verified without a device or a network.
 */
object AiNameDraftReducer {
    /** The tool name whose result carries the proposal (web `ev.name === 'draft_location_name'`). */
    const val DRAFT_TOOL_NAME: String = "draft_location_name"

    private const val EVENT_PREFIX: String = "event:"
    private const val DATA_PREFIX: String = "data:"
    private const val COMMENT_PREFIX: String = ":"
    private const val DEFAULT_FINISH_REASON: String = "stop"
    private const val DEFAULT_ERROR_MESSAGE: String = "unknown"

    private val lineDelimiter = Regex("\\r?\\n")

    // Lenient JSON: the wire payloads are server-shaped and may carry fields the surface ignores; a decode
    // failure yields a dropped frame (web JSON.parse catch → return null), never a crash.
    private val json = Json { ignoreUnknownKeys = true }

    /**
     * Parses a single SSE frame block (the lines of one event, without the trailing blank line) into a typed
     * [AiStreamEvent] — the native port of the web `parseSSEFrame`. Returns `null` for a frame with no `event:`
     * field, a malformed `data:` JSON body, or an unknown event type, so the read loop skips it instead of
     * corrupting the stream.
     */
    @Suppress("ReturnCount")
    fun parseFrame(raw: String): AiStreamEvent? {
        var event = ""
        val dataParts = mutableListOf<String>()
        for (line in raw.split(lineDelimiter)) {
            when {
                line.startsWith("$EVENT_PREFIX ") -> event = line.removePrefix("$EVENT_PREFIX ")
                line.startsWith("$DATA_PREFIX ") -> dataParts += line.removePrefix("$DATA_PREFIX ")
                line.startsWith(EVENT_PREFIX) -> event = line.removePrefix(EVENT_PREFIX).trimStart()
                line.startsWith(DATA_PREFIX) -> dataParts += line.removePrefix(DATA_PREFIX).trimStart()
                line.startsWith(COMMENT_PREFIX) -> Unit // SSE comment line — ignored per spec.
            }
        }
        if (event.isEmpty()) return null
        val dataStr = dataParts.joinToString("\n")
        val data: JsonElement? =
            if (dataStr.isEmpty()) {
                null
            } else {
                try {
                    json.parseToJsonElement(dataStr)
                } catch (_: SerializationException) {
                    return null
                }
            }
        return toTypedEvent(event, data)
    }

    /**
     * Narrows an (event, data) pair into the [AiStreamEvent] union — the native port of the web `toTypedEvent`.
     * Requires a JSON object payload and the per-type required fields; any shortfall yields `null` (the frame is
     * dropped), mirroring the web type guards exactly.
     */
    @Suppress("ReturnCount", "CyclomaticComplexMethod")
    fun toTypedEvent(
        event: String,
        data: JsonElement?,
    ): AiStreamEvent? {
        val obj = data as? JsonObject ?: return null
        return when (event) {
            "delta" -> obj.stringField("text")?.let { AiStreamEvent.Delta(it) }
            "tool_call" -> {
                val id = obj.stringField("id") ?: return null
                val name = obj.stringField("name") ?: return null
                AiStreamEvent.ToolCall(id, name, obj["arguments"])
            }
            "tool_result" -> {
                val id = obj.stringField("id") ?: return null
                val name = obj.stringField("name") ?: return null
                val ok = obj.boolField("ok") ?: return null
                AiStreamEvent.ToolResult(id, name, ok, obj["data"], obj.stringField("error"))
            }
            "confirm_request" -> {
                val continuationId = obj.stringField("continuation_id") ?: return null
                val tool = obj.stringField("tool") ?: return null
                val summary = obj.stringField("summary") ?: return null
                AiStreamEvent.ConfirmRequest(continuationId, tool, summary)
            }
            "done" -> AiStreamEvent.Done(obj.stringField("finish_reason") ?: DEFAULT_FINISH_REASON)
            "error" -> AiStreamEvent.Failure(obj.stringField("message") ?: DEFAULT_ERROR_MESSAGE)
            else -> null
        }
    }

    /**
     * Validates a `tool_result` frame and projects it onto a [LocationNameDraft] — the native port of the web
     * `handleEvent` body (the "data adapter"). Returns `null` unless the frame is the `draft_location_name`
     * result, succeeded (`ok`), and carries a numeric `location_id`, a string `proposed_name`, and a string
     * `status` — the exact `typeof` guards the web component applies before `setDraft`.
     */
    @Suppress("ReturnCount")
    fun draftFromToolResult(event: AiStreamEvent.ToolResult): LocationNameDraft? {
        if (event.name != DRAFT_TOOL_NAME || !event.ok) return null
        val obj = event.data as? JsonObject ?: return null
        val locationId = obj.numberField("location_id")?.toLong() ?: return null
        val proposedName = obj.stringField("proposed_name") ?: return null
        val status = obj.stringField("status") ?: return null
        return LocationNameDraft(
            locationId = locationId,
            proposedName = proposedName,
            status = status,
            reason = obj.stringField("reason"),
        )
    }

    /**
     * Folds one decoded [event] into [state] — the native analogue of the web hook's per-event state updates
     * combined with the component's `handleEvent`. A `tool_result` carrying a valid `draft_location_name`
     * captures the proposal; `delta` accumulates text; `confirm_request`/`done`/`error` advance the lifecycle;
     * `tool_call` and non-draft/invalid results are inert.
     */
    fun reduce(
        state: AiNameDraftUiState,
        event: AiStreamEvent,
    ): AiNameDraftUiState =
        when (event) {
            is AiStreamEvent.Delta -> state.copy(text = state.text + event.text)
            is AiStreamEvent.ToolResult ->
                draftFromToolResult(event)?.let { state.copy(draft = it) } ?: state
            is AiStreamEvent.ConfirmRequest -> state.copy(phase = AiNameDraftPhase.PausedConfirm)
            is AiStreamEvent.Done -> state.copy(phase = AiNameDraftPhase.Done)
            is AiStreamEvent.Failure ->
                state.copy(phase = AiNameDraftPhase.Error, errorMessage = event.message)
            is AiStreamEvent.ToolCall -> state
        }

    /** Reads [key] as a JSON string field (the web `typeof === 'string'` guard); `null` for any other shape. */
    private fun JsonObject.stringField(key: String): String? = (this[key] as? JsonPrimitive)?.takeIf { it.isString }?.content

    /** Reads [key] as a JSON numeric field (the web `typeof === 'number'` guard); `null` for any other shape. */
    private fun JsonObject.numberField(key: String): Double? = (this[key] as? JsonPrimitive)?.takeIf { !it.isString }?.doubleOrNull

    /** Reads [key] as a JSON boolean field (the web `typeof === 'boolean'` guard); `null` for any other shape. */
    private fun JsonObject.boolField(key: String): Boolean? =
        (this[key] as? JsonPrimitive)?.takeIf { !it.isString }?.content?.toBooleanStrictOrNull()
}

/**
 * The stable identity + a11y/test contract of the surface — the native mirror of the web `withAiFeature` gate id
 * and the component's `data-testid`s. Centralised so the view, the diagnostics, and the tests never drift.
 */
object AIAutoNameUnnamedLocationsRegistration {
    /** The AI-off feature gate id (web `withAiFeature('auto-name-unnamed-locations', …)`). */
    const val FEATURE_ID: String = "auto-name-unnamed-locations"

    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). */
    const val SLUG: String = "AIAutoNameUnnamedLocations"

    /** Root test tag — the native analogue of the web off-mode gate `data-testid` (`ai-feature-{id}-root`). */
    const val ROOT_TEST_TAG: String = "ai-feature-$FEATURE_ID-root"

    /** Suggest action test tag (web `buttonTestId="ai-feature-auto-name-unnamed-locations-suggest"`). */
    const val SUGGEST_TEST_TAG: String = "ai-feature-$FEATURE_ID-suggest"

    /** Draft panel test tag (web `data-testid="ai-feature-auto-name-unnamed-locations-draft"`). */
    const val DRAFT_TEST_TAG: String = "ai-feature-$FEATURE_ID-draft"

    /** Apply action test tag (web `data-testid="ai-feature-auto-name-unnamed-locations-apply"`). */
    const val APPLY_TEST_TAG: String = "ai-feature-$FEATURE_ID-apply"
}

private const val VIEW_OPENED_EVENT = "view.opened"
private const val SUGGEST_EVENT = "aiAutoName.suggest"
private const val APPLIED_EVENT = "aiAutoName.applied"
private const val SURFACE_FIELD = "surface"
private const val STATUS_FIELD = "status"

/**
 * Emits the one PII-safe `view.opened` diagnostic with the surface [AIAutoNameUnnamedLocationsRegistration.SLUG]
 * (P1/S11). Carries only the slug — never the location id, the current label, or the proposed name (all tagged
 * PII by this feature's redaction policy) — so a diagnostics line can never leak where the user is or what Helix
 * proposed.
 */
fun recordAIAutoNameUnnamedLocationsOpened(logger: Logger) {
    logger.info(VIEW_OPENED_EVENT, mapOf(SURFACE_FIELD to AIAutoNameUnnamedLocationsRegistration.SLUG))
}

/** Records that a draft was requested (web Suggest click). Carries only the slug — no location id or name. */
fun recordAIAutoNameUnnamedLocationsSuggested(logger: Logger) {
    logger.info(SUGGEST_EVENT, mapOf(SURFACE_FIELD to AIAutoNameUnnamedLocationsRegistration.SLUG))
}

/**
 * Records that a proposal was applied to the parent form (web "Apply to form" click). Carries only the slug and
 * the non-PII validator [status] (`ok`/`rejected`) — never the proposed name itself.
 */
fun recordAIAutoNameUnnamedLocationsApplied(
    logger: Logger,
    status: String,
) {
    logger.info(APPLIED_EVENT, mapOf(SURFACE_FIELD to AIAutoNameUnnamedLocationsRegistration.SLUG, STATUS_FIELD to status))
}
