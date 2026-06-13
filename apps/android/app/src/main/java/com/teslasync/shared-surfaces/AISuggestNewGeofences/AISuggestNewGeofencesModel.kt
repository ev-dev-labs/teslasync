// Pure, framework-free model + SSE decoder + projection + reducer + diagnostics for the AISuggestNewGeofences
// shared surface — the native analogue of the data the web component owns
// (web/src/components/ai/AISuggestNewGeofences.tsx together with the slice of web/src/hooks/useAiStream.ts it
// consumes). No Compose, no Android, no HTTP: every declaration here is unit-tested off-device in the
// :android:testReleaseUnitTest gate, keeping the composable a thin render layer and the source a thin transport.
//
// The web component opens a propose-only Helix draft stream (POST /ai/geofences/draft, with the location_id in
// the JSON body), parses the SSE frames with `parseSSEFrame`/`toTypedEvent`, and folds the single
// `tool_result(draft_geofence, ok)` frame into a typed `GeofenceDraft` via its `handleEvent` callback. The web
// envelope is nested: `ev.data` is a wrapper `{ draft: { … }, status, validation_error }` — the six draft fields
// live under `data.draft`, while `status` + `validation_error` live on the wrapper. This file owns exactly that
// data + decision surface, ported 1:1:
//   - [AiStreamEvent] mirrors the web `AiStreamEvent` discriminated union (the events the stream can carry).
//   - [AiGeofenceDraftPhase] mirrors the web `AiStreamState` lifecycle (idle → streaming → done | error, plus the
//     paused-confirm pause the web `canStart`/`isBusy` reference).
//   - [GeofenceDraft] mirrors the web `GeofenceDraft` envelope (the draft_geofence tool result).
//   - [AiGeofenceDraftReducer.parseFrame] reproduces the web `parseSSEFrame` + `toTypedEvent` verbatim.
//   - [AiGeofenceDraftReducer.draftFromToolResult] reproduces the web `handleEvent` validation verbatim (the
//     "data adapter": raw nested tool-result JSON → typed projection, including the wrapper/inner split).
//   - [AiGeofenceDraftReducer.reduce] folds one event into the render-ready [AiGeofenceDraftUiState].
//
// There is deliberately no cache-then-network lifecycle (loading / stale / offline over a cached value): the web
// source is an ON-DEMAND, point-in-time stream, not a cached feed, so a proposal is never "stale" and there is no
// cached draft to replay offline (covenant: no silent drift). The honest state set is the web one — idle,
// streaming (the prompt's "loading"), done-with-draft (ok or rejected), and error (a stream-open failure is the
// honest "offline" branch: there is no cached proposal to fall back to, so it surfaces as an error + retry).
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/shared-surfaces — the P3 prompt's allowed-files path) cannot form a valid Kotlin package (a
// hyphen segment is illegal in a package identifier), so the package intentionally diverges from the path —
// exactly as the sibling feature-view / misc-surface ports do. `MatchingDeclarationName` is suppressed for the
// co-located supporting declarations.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.aisuggestnewgeofences

import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.serialization.SerializationException
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.doubleOrNull

/**
 * The typed envelope returned by the `draft_geofence` tool — the native port of the web `GeofenceDraft` interface
 * (web/src/components/ai/AISuggestNewGeofences.tsx), itself mirroring the Go `geofenceDraft`
 * (internal/ai/tools/suggest_new_geofences.go). Kept narrow so the panel only renders fields it actually uses.
 *
 * @property locationId the visited-location synthetic id the proposal is scoped to (web `location_id`).
 * @property vehicleId the vehicle the visit pattern belongs to (web `vehicle_id`).
 * @property proposedName the concise human-readable name Helix proposed for the geofence (web `proposed_name`).
 * @property radiusM the proposed geofence radius in metres — SI on the wire, rendered as metres (web `radius_m`).
 * @property centroidLat the proposed centroid latitude in degrees (web `centroid_lat`).
 * @property centroidLon the proposed centroid longitude in degrees (web `centroid_lon`).
 * @property status `"ok"` when the validator accepted the draft, `"invalid"` (or any other non-ok string) when it
 *   did not — carried as a plain string so an unforeseen status never fails decoding (web `status`).
 * @property validationError the optional validator explanation shown beneath the proposal (web `validation_error`).
 */
data class GeofenceDraft(
    val locationId: Long,
    val vehicleId: Long,
    val proposedName: String,
    val radiusM: Double,
    val centroidLat: Double,
    val centroidLon: Double,
    val status: String,
    val validationError: String? = null,
) {
    /** Whether the validator accepted the draft — the only gate on the "Apply to form" action (web `status === 'ok'`). */
    val isOk: Boolean get() = status == OK_STATUS

    companion object {
        /** The accepted-proposal status the web component checks against (`'ok'`). */
        const val OK_STATUS: String = "ok"
    }
}

/**
 * The payload handed to the host when the user applies an accepted draft — the native port of the object the web
 * `onApplyDraft` callback receives (`{ name, latitude, longitude, radius }`). The host copies it into the existing
 * baseline Add Geofence form; this surface never writes to the API itself (web contract).
 *
 * @property name the proposed geofence name (web `draft.proposed_name`).
 * @property latitude the proposed centroid latitude (web `draft.centroid_lat`).
 * @property longitude the proposed centroid longitude (web `draft.centroid_lon`).
 * @property radius the proposed radius in metres (web `draft.radius_m`).
 */
data class GeofenceDraftApplication(
    val name: String,
    val latitude: Double,
    val longitude: Double,
    val radius: Double,
)

/**
 * The user-facing stream lifecycle — the native port of the web `AiStreamState`
 * (`'idle' | 'streaming' | 'paused-confirm' | 'done' | 'error'`). [PausedConfirm] is retained for 1:1 parity with
 * the web `canStart`/`isBusy` derivations even though this propose-only read tool never requests confirmation in
 * practice.
 */
enum class AiGeofenceDraftPhase {
    /** No proposal requested yet (web `'idle'`) — the friendly initial surface (description + CTA), never blank. */
    Idle,

    /** A draft stream is open (web `'streaming'`) — the "loading"/"Helix is thinking" affordance. */
    Streaming,

    /** The stream paused awaiting a tool confirmation (web `'paused-confirm'`). */
    PausedConfirm,

    /** The stream finished (web `'done'`) — a [GeofenceDraft] may or may not have been captured. */
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
     * A tool result frame (web `{ type: 'tool_result'; id; name; ok; data?; error? }`). The surface captures the
     * `draft_geofence` result here; [data] is the raw nested tool payload the projection validates.
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
 * @property errorMessage the technical failure message when [phase] is [AiGeofenceDraftPhase.Error] (web `stream.error`).
 */
data class AiGeofenceDraftUiState(
    val phase: AiGeofenceDraftPhase = AiGeofenceDraftPhase.Idle,
    val draft: GeofenceDraft? = null,
    val text: String = "",
    val errorMessage: String? = null,
) {
    /** True while a draft stream is open (web `stream.state === 'streaming'`). */
    val isStreaming: Boolean get() = phase == AiGeofenceDraftPhase.Streaming

    /** True while the stream is in-flight or paused — the web `isBusy` (`streaming || paused-confirm`) double-submit guard. */
    val isBusy: Boolean get() = phase == AiGeofenceDraftPhase.Streaming || phase == AiGeofenceDraftPhase.PausedConfirm

    /** True when the stream terminated in failure (web `stream.state === 'error'`). */
    val isError: Boolean get() = phase == AiGeofenceDraftPhase.Error

    /**
     * Whether the Suggest action may fire for [locationId] — the web `canStart` (`locationId > 0 &&
     * stream.state !== 'paused-confirm'`) combined with the AIFeatureCard streaming-disable
     * (`!canStart || isStreaming`). Computed, never a literal disabled flag (Rule W1-A).
     */
    fun canSuggest(locationId: Long): Boolean = locationId > 0 && phase != AiGeofenceDraftPhase.PausedConfirm && !isStreaming

    companion object {
        /** The cold initial state — nothing requested yet (web `'idle'` + `draft === null`). */
        val IDLE: AiGeofenceDraftUiState = AiGeofenceDraftUiState()
    }
}

/**
 * The pure SSE decoder + projection + reducer — the native port of the slice of web `useAiStream` this surface
 * relies on plus its `handleEvent`. Every function is total, side-effect-free, and off-device tested, so the
 * stream-to-draft contract is verified without a device or a network.
 */
object AiGeofenceDraftReducer {
    /** The tool name whose result carries the proposal (web `ev.name === 'draft_geofence'`). */
    const val DRAFT_TOOL_NAME: String = "draft_geofence"

    /** The wrapper key the six draft fields are nested under (web `ev.data.draft`). */
    const val DRAFT_WRAPPER_KEY: String = "draft"

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
     * Validates a `tool_result` frame and projects it onto a [GeofenceDraft] — the native port of the web
     * `handleEvent` body (the "data adapter"). Mirrors the web wrapper/inner split exactly: the six draft fields
     * are read from the nested `data.draft` object and must each be the right JSON type (numeric ids/radius/
     * centroid, string name), while `status` is read from the wrapper; `validation_error` is an optional wrapper
     * string. Returns `null` unless the frame is the `draft_geofence` result, succeeded (`ok`), and satisfies
     * every one of those guards — the exact `typeof` checks the web component applies before `setDraft`.
     */
    @Suppress("ReturnCount")
    fun draftFromToolResult(event: AiStreamEvent.ToolResult): GeofenceDraft? {
        if (event.name != DRAFT_TOOL_NAME || !event.ok) return null
        val wrapper = event.data as? JsonObject ?: return null
        val inner = wrapper[DRAFT_WRAPPER_KEY] as? JsonObject ?: return null
        val locationId = inner.numberField("location_id")?.toLong() ?: return null
        val vehicleId = inner.numberField("vehicle_id")?.toLong() ?: return null
        val proposedName = inner.stringField("proposed_name") ?: return null
        val radiusM = inner.numberField("radius_m") ?: return null
        val centroidLat = inner.numberField("centroid_lat") ?: return null
        val centroidLon = inner.numberField("centroid_lon") ?: return null
        val status = wrapper.stringField("status") ?: return null
        return GeofenceDraft(
            locationId = locationId,
            vehicleId = vehicleId,
            proposedName = proposedName,
            radiusM = radiusM,
            centroidLat = centroidLat,
            centroidLon = centroidLon,
            status = status,
            validationError = wrapper.stringField("validation_error"),
        )
    }

    /**
     * Folds one decoded [event] into [state] — the native analogue of the web hook's per-event state updates
     * combined with the component's `handleEvent`. A `tool_result` carrying a valid `draft_geofence` captures the
     * proposal; `delta` accumulates text; `confirm_request`/`done`/`error` advance the lifecycle; `tool_call` and
     * non-draft/invalid results are inert.
     */
    fun reduce(
        state: AiGeofenceDraftUiState,
        event: AiStreamEvent,
    ): AiGeofenceDraftUiState =
        when (event) {
            is AiStreamEvent.Delta -> state.copy(text = state.text + event.text)
            is AiStreamEvent.ToolResult ->
                draftFromToolResult(event)?.let { state.copy(draft = it) } ?: state
            is AiStreamEvent.ConfirmRequest -> state.copy(phase = AiGeofenceDraftPhase.PausedConfirm)
            is AiStreamEvent.Done -> state.copy(phase = AiGeofenceDraftPhase.Done)
            is AiStreamEvent.Failure ->
                state.copy(phase = AiGeofenceDraftPhase.Error, errorMessage = event.message)
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
object AISuggestNewGeofencesRegistration {
    /** The AI-off feature gate id (web `withAiFeature('suggest-new-geofences', …)`). */
    const val FEATURE_ID: String = "suggest-new-geofences"

    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). */
    const val SLUG: String = "AISuggestNewGeofences"

    /** Root test tag — the native analogue of the web off-mode gate `data-testid` (`ai-feature-{id}-root`). */
    const val ROOT_TEST_TAG: String = "ai-feature-$FEATURE_ID-root"

    /** Suggest action test tag (web `buttonTestId="ai-feature-suggest-new-geofences-suggest"`). */
    const val SUGGEST_TEST_TAG: String = "ai-feature-$FEATURE_ID-suggest"

    /** Draft panel test tag (web `data-testid="ai-feature-suggest-new-geofences-draft"`). */
    const val DRAFT_TEST_TAG: String = "ai-feature-$FEATURE_ID-draft"

    /** Apply action test tag (web `data-testid="ai-feature-suggest-new-geofences-apply"`). */
    const val APPLY_TEST_TAG: String = "ai-feature-$FEATURE_ID-apply"
}

private const val VIEW_OPENED_EVENT = "view.opened"
private const val SUGGEST_EVENT = "aiSuggestGeofence.suggest"
private const val APPLIED_EVENT = "aiSuggestGeofence.applied"
private const val SURFACE_FIELD = "surface"
private const val STATUS_FIELD = "status"

/**
 * Emits the one PII-safe `view.opened` diagnostic with the surface [AISuggestNewGeofencesRegistration.SLUG]
 * (P1/S11). Carries only the slug — never the location id, the current label, the centroid, or the proposed name
 * (all tagged PII by this feature's redaction policy) — so a diagnostics line can never leak where the user is or
 * what Helix proposed.
 */
fun recordAISuggestNewGeofencesOpened(logger: Logger) {
    logger.info(VIEW_OPENED_EVENT, mapOf(SURFACE_FIELD to AISuggestNewGeofencesRegistration.SLUG))
}

/** Records that a draft was requested (web Suggest click). Carries only the slug — no location id or centroid. */
fun recordAISuggestNewGeofencesSuggested(logger: Logger) {
    logger.info(SUGGEST_EVENT, mapOf(SURFACE_FIELD to AISuggestNewGeofencesRegistration.SLUG))
}

/**
 * Records that a proposal was applied to the parent form (web "Apply to form" click). Carries only the slug and
 * the non-PII validator [status] (`ok`/`invalid`) — never the proposed name, radius, or centroid.
 */
fun recordAISuggestNewGeofencesApplied(
    logger: Logger,
    status: String,
) {
    logger.info(APPLIED_EVENT, mapOf(SURFACE_FIELD to AISuggestNewGeofencesRegistration.SLUG, STATUS_FIELD to status))
}
