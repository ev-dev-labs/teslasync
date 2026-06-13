// Pure, framework-free model for the AITripPostcardShareCardImageGeneration shared surface — the native analogue
// of every value the web component derives before returning JSX (web/src/components/ai/
// AITripPostcardShareCardImageGeneration.tsx, rendered through its AIFeatureCard scaffold + the useAiStream SSE
// hook + the withAiFeature off-mode gate). No Compose, no Android UI, no HTTP: every declaration here is exercised
// off-device by the :android:testReleaseUnitTest gate, keeping the composable a thin render layer and the stream
// holder a thin lifecycle layer over these pure functions.
//
// AITripPostcardShareCardImageGeneration is the "Draft a Helix share-card image" card beneath the recent-trips
// list on the sharing/trips page. The web component builds a deterministic request (`useMemo`) and POSTs it to
// `/ai/share-cards/trip-image/draft` via `useAiStream`, accumulating the streamed `delta.text` into a single
// proposed image prompt + preview spec and surfacing the idle -> streaming -> done / error lifecycle through
// AIFeatureCard + AiOutputPanel. Helix proposes only: the draft is never published, the existing Share workflow
// stays the publishing path. This file owns the parts the web render + hook derive from that contract:
//   * the draft endpoint path — web `useAiStream({ url: '/ai/share-cards/trip-image/draft' })`
//     ([TRIP_IMAGE_DRAFT_PATH]);
//   * the request body — web `useMemo(() => ({ trip_id, style_hint? }))` then `JSON.stringify(body)`, including the
//     same `trip_id` numeric coercion and the conditional, trimmed `style_hint`, in [draftRequestBody],
//     [resolveTripId], and [normalizeStyleHint];
//   * the action-readiness predicate — web `haveInputs = numericTripId > 0` ([hasTripSelected], with the honest
//     offline gate the P3 action-surface contract adds, in [isTripPostcardReady]);
//   * the SSE wire parser — web `parseSSEFrame` + `toTypedEvent` (event:/data: lines, blank-line-delimited frames,
//     JSON `data` payloads narrowed into the typed [AiStreamEvent] union, unknown/malformed frames dropped) over
//     the chunk re-assembly the web reader loop does ([SseFrameAccumulator]);
//   * the stream reducer — web `handleEvent` (`delta` appends text + flips to streaming, `done` settles, `error`
//     carries the message; tool/confirm frames update no surface state for this propose-only card), in
//     [reduceDraft] over [TripImageDraftUiState];
//   * the withAiFeature('trip-postcard-share-card-image-generation') off-mode gate — web `useAiEnabled` (a
//     registered feature id, a non-off `ai_mode`, and a per-feature `ai_features[id] === true` opt-in), in
//     [isTripPostcardEnabled].
//
// Binding (P1/S8): this surface performs NO HTTP from the view. The streamed bytes arrive over an injected
// [io.teslasync.android.sharedsurfaces.aitrippostcardsharecardimagegeneration.TripImageDraftTransport] seam the
// host wires to the shared resilient client; the lifecycle is owned by the co-located TripPostcardDraftController
// state holder. This file is the pure adapter both are unit-tested over.
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/shared-surfaces/AITripPostcardShareCardImageGeneration — the P3 prompt's allowed-files path)
// cannot form a valid Kotlin package (a hyphen and a PascalCase segment are illegal in a package identifier), so
// the package intentionally diverges from the path — exactly as the sibling shared surfaces do.
// `MatchingDeclarationName` is suppressed for the co-located supporting declarations.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.aitrippostcardsharecardimagegeneration

import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

/** The web AI feature id this surface is gated by (`withAiFeature('trip-postcard-share-card-image-generation', …)`). */
const val TRIP_POSTCARD_FEATURE_ID: String = "trip-postcard-share-card-image-generation"

/** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). Carries no PII. */
const val TRIP_POSTCARD_SLUG: String = "AITripPostcardShareCardImageGeneration"

/** The draft endpoint the web hook streams against (`useAiStream({ url: '/ai/share-cards/trip-image/draft' })`). */
const val TRIP_IMAGE_DRAFT_PATH: String = "/ai/share-cards/trip-image/draft"

/** The `ai_mode` value that fully disables every AI surface (ADR-015 §I1). */
internal const val AI_MODE_OFF: String = "off"

/** Settings document key for the global AI mode (web `settings.ai_mode`). */
internal const val AI_MODE_KEY: String = "ai_mode"

/** Settings document key for the per-feature opt-in map (web `settings.ai_features`). */
internal const val AI_FEATURES_KEY: String = "ai_features"

/** Default `finish_reason` when a `done` frame omits one (web `toTypedEvent` default `'stop'`). */
internal const val DEFAULT_FINISH_REASON: String = "stop"

/** Default error message when an `error` frame omits one (web `toTypedEvent` default `'unknown'`). */
internal const val UNKNOWN_ERROR: String = "unknown"

// ── Request body field names (web `useMemo` body keys) ──────────────────────────────────────────────
internal const val TRIP_ID_FIELD: String = "trip_id"
internal const val STYLE_HINT_FIELD: String = "style_hint"

/** Fallback trip id when the prop is absent (web `numericTripId` -> `0` when `tripId` is not a finite number). */
internal const val DEFAULT_TRIP_ID: Long = 0L

/** Lenient JSON reader for SSE `data:` payloads — unknown keys are ignored, matching the web parser. */
private val tripJson: Json = Json { ignoreUnknownKeys = true }

/**
 * The inputs the sharing/trips page feeds the card — the native mirror of the web `InnerSection` props
 * (`tripId?`, `styleHint?`). Both are optional; the page may render before the user picks a trip, and the
 * free-form style hint is optional. `tripId` is the currently selected recent-trip id (web `number`), coerced to
 * the `trip_id` the body carries by [resolveTripId]; `styleHint` is the optional stylistic stance (web `string`),
 * trimmed and conditionally included by [normalizeStyleHint].
 *
 * @property tripId the selected recent-trip id; absent / non-positive leaves [hasTripSelected] false.
 * @property styleHint the optional free-form style hint (e.g. "vintage", "minimal"); blank is treated as absent.
 */
data class TripPostcardInputs(
    val tripId: Long? = null,
    val styleHint: String? = null,
)

/** The lifecycle the draft stream moves through — the native analogue of the web `AiStreamState`. */
enum class DraftPhase {
    /** No stream started yet (web `'idle'`). */
    Idle,

    /** A stream is open; text accumulates as `delta` frames arrive (web `'streaming'`). */
    Streaming,

    /** The stream settled successfully (web `'done'`); the draft is the final proposed image prompt + spec. */
    Done,

    /** The stream ended in error (web `'error'`); [TripImageDraftUiState.error] carries the message. */
    Failed,
}

/**
 * The render-ready stream state — the native mirror of the slice of `useAiStream`'s result the AIFeatureCard +
 * AiOutputPanel read (`state` / `text` / `error`). Pure (no Compose types) so it is fully unit-tested off-device;
 * the composable only resolves localized labels and draws this.
 *
 * @property phase the lifecycle phase (web `stream.state`).
 * @property draft the accumulated `delta.text` proposed image prompt + preview spec (web `stream.text`); empty
 *   until the first delta arrives.
 * @property error the terminal error message when [phase] is [DraftPhase.Failed] (web `stream.error`).
 */
data class TripImageDraftUiState(
    val phase: DraftPhase = DraftPhase.Idle,
    val draft: String = "",
    val error: String? = null,
) {
    /** A stream is in flight (web `state === 'streaming'`); the action is disabled and shows progress. */
    val isStreaming: Boolean get() = phase == DraftPhase.Streaming

    /** The stream settled successfully (web `state === 'done'`). */
    val isDone: Boolean get() = phase == DraftPhase.Done

    /** The stream ended in error (web `state === 'error'`). */
    val isFailed: Boolean get() = phase == DraftPhase.Failed

    /** No stream has run yet (web `state === 'idle'`); the card shows its ready presentation. */
    val isIdle: Boolean get() = phase == DraftPhase.Idle

    /** At least one `delta` has accumulated draft text (web `text.length > 0`). */
    val hasDraft: Boolean get() = draft.isNotEmpty()

    /**
     * Whether the output panel renders anything — the web `hasAnything = text.length > 0 || state ===
     * 'streaming' || state === 'error' || state === 'done'` rule. Idle with no text renders no panel (the card
     * itself is the non-blank ready surface).
     */
    val hasOutput: Boolean get() = hasDraft || isStreaming || isDone || isFailed

    companion object {
        /** The pre-stream resting state shown before the user asks Helix for a share-card draft. */
        val IDLE: TripImageDraftUiState = TripImageDraftUiState()
    }
}

/**
 * Whether a trip is selected — a port of the web `haveInputs = numericTripId > 0` (a finite, positive trip id).
 * Drives both the empty hint ("Pick a trip from the list above…") and, combined with connectivity, the action
 * enable. Pure so the rule is asserted off-device and shared by the controller guard and the composable.
 */
fun hasTripSelected(inputs: TripPostcardInputs): Boolean = resolveTripId(inputs.tripId) > 0

/**
 * Whether the action can fire — a selected trip and connectivity. A port of the web `canStart={haveInputs}` plus
 * the honest offline gate the P3 action-surface contract requires (offline never opens a doomed stream).
 */
fun isTripPostcardReady(
    inputs: TripPostcardInputs,
    online: Boolean,
): Boolean = online && hasTripSelected(inputs)

/**
 * Coerces the [tripId] prop to the numeric `trip_id` the body carries — a port of the web `numericTripId =
 * typeof tripId === 'number' && Number.isFinite(tripId) ? tripId : 0`. An absent id yields [DEFAULT_TRIP_ID] (0),
 * exactly as the web falls back when `tripId` is `undefined`; a `Long` is always finite, so a present value is
 * used verbatim (the body still carries a non-positive id, which [hasTripSelected] then treats as no trip).
 */
internal fun resolveTripId(tripId: Long?): Long = tripId ?: DEFAULT_TRIP_ID

/**
 * Normalizes the [styleHint] prop to the optional `style_hint` the body carries — a port of the web
 * `if (typeof styleHint === 'string' && styleHint.trim() !== '') payload.style_hint = styleHint.trim()`. Returns
 * the trimmed hint when present and non-blank, otherwise `null` so [draftRequestBody] omits the field entirely.
 */
internal fun normalizeStyleHint(styleHint: String?): String? = styleHint?.trim()?.takeIf { it.isNotEmpty() }

/**
 * Serializes the request body the draft stream POSTs — a port of the web `useMemo(() => ({ trip_id, style_hint? }))`
 * then `JSON.stringify(body)`. Produces compact JSON with the web key order: `trip_id` always, then `style_hint`
 * only when a trimmed non-blank hint is present, so the transport hands the shared client exactly the bytes the
 * backend `/ai/share-cards/trip-image/draft` reads.
 */
fun draftRequestBody(inputs: TripPostcardInputs): String =
    buildJsonObject {
        put(TRIP_ID_FIELD, resolveTripId(inputs.tripId))
        normalizeStyleHint(inputs.styleHint)?.let { put(STYLE_HINT_FIELD, it) }
    }.toString()

/**
 * The typed Server-Sent-Events union the draft stream can carry — a 1:1 port of the web `AiStreamEvent`
 * discriminated union (web/src/hooks/useAiStream.ts). The draft endpoint emits `delta` fragments plus a terminal
 * `done`/`error` in practice, but the full union is reproduced so the parser is a faithful, reusable port and so
 * a future server frame can never crash an older client (unknown frames are dropped, not thrown).
 */
sealed interface AiStreamEvent {
    /** A streamed text fragment (web `{ type: 'delta', text }`); accumulated into the proposed draft. */
    data class Delta(
        val text: String,
    ) : AiStreamEvent

    /** A tool invocation frame (web `{ type: 'tool_call', id, name }`); transcript-only, no surface state. */
    data class ToolCall(
        val id: String,
        val name: String,
    ) : AiStreamEvent

    /** A tool result frame (web `{ type: 'tool_result', id, name, ok }`); transcript-only, no surface state. */
    data class ToolResult(
        val id: String,
        val name: String,
        val ok: Boolean,
    ) : AiStreamEvent

    /** A human-in-the-loop confirm frame (web `{ type: 'confirm_request', … }`); unused by this card. */
    data class ConfirmRequest(
        val continuationId: String,
        val tool: String,
        val summary: String,
    ) : AiStreamEvent

    /** The terminal success frame (web `{ type: 'done', finish_reason }`). */
    data class Done(
        val finishReason: String,
    ) : AiStreamEvent

    /** The terminal error frame (web `{ type: 'error', message }`). */
    data class Failure(
        val message: String,
    ) : AiStreamEvent
}

/**
 * Reassembles the raw UTF-8 chunks an SSE transport emits into whole frames — the native analogue of the web
 * reader loop's blank-line buffering (`buffer.split(SSE_DELIM_RE)`, keeping the trailing partial fragment for the
 * next read). Stateful across [feed] calls; [drain] yields any final fragment that arrived without a trailing
 * blank line (web's post-loop `if (buffer.trim()) …`).
 */
class SseFrameAccumulator {
    private val buffer = StringBuilder()

    /**
     * Appends [chunk] and returns every complete frame now available, retaining the trailing partial frame.
     * Blank frames are skipped (web `if (!raw.trim()) continue`).
     */
    fun feed(chunk: String): List<String> {
        buffer.append(chunk)
        val parts = FRAME_DELIM.split(buffer.toString())
        val remainder = parts.last()
        buffer.setLength(0)
        buffer.append(remainder)
        return parts.dropLast(1).filter { it.isNotBlank() }
    }

    /** Returns the buffered trailing fragment (if non-blank) and clears it — the final-frame drain. */
    fun drain(): String? {
        val rest = buffer.toString()
        buffer.setLength(0)
        return rest.takeIf { it.isNotBlank() }
    }

    private companion object {
        /** SSE event terminator: a blank line, tolerating `\n\n` and `\r\n\r\n` (web `SSE_DELIM_RE`). */
        val FRAME_DELIM = Regex("\\r?\\n\\r?\\n")
    }
}

/**
 * Parses one SSE frame (its lines, without the trailing blank line) into a typed [AiStreamEvent] — a port of the
 * web `parseSSEFrame`. Reads the `event:` discriminator and the joined `data:` payload (tolerating the one-space
 * and no-space `event:`/`data:` forms), JSON-decodes the payload, and narrows it via [toTypedEvent]. Returns
 * `null` for a frame with no event, a malformed JSON payload, or an unknown event type so the stream loop skips
 * it instead of corrupting the stream.
 */
fun parseSseFrame(raw: String): AiStreamEvent? {
    val frame = splitFrame(raw)
    if (frame.event.isEmpty()) return null
    return toTypedEvent(frame.event, parseData(frame.data))
}

/** The discriminator + raw `data` payload extracted from a frame's lines. */
private data class SseFrame(
    val event: String,
    val data: String,
)

private fun splitFrame(raw: String): SseFrame {
    var event = ""
    val dataParts = mutableListOf<String>()
    for (line in LINE_DELIM.split(raw)) {
        when {
            line.startsWith(":") -> Unit
            line.startsWith("event: ") -> event = line.substring("event: ".length)
            line.startsWith("data: ") -> dataParts.add(line.substring("data: ".length))
            line.startsWith("event:") -> event = line.substring("event:".length).trimStart()
            line.startsWith("data:") -> dataParts.add(line.substring("data:".length).trimStart())
        }
    }
    return SseFrame(event, dataParts.joinToString("\n"))
}

/** JSON-decodes a frame's `data` payload; an empty payload or malformed JSON yields `null` (web parity). */
private fun parseData(data: String): JsonElement? {
    if (data.isEmpty()) return null
    return runCatching { tripJson.parseToJsonElement(data) }.getOrNull()
}

/**
 * Narrows an `(event, data)` pair into the [AiStreamEvent] union — a port of the web `toTypedEvent`. A non-object
 * payload or a frame missing a required typed field yields `null` (the frame is dropped), exactly as the web
 * narrowing returns `null` for a malformed frame.
 */
private fun toTypedEvent(
    event: String,
    data: JsonElement?,
): AiStreamEvent? {
    val obj = data as? JsonObject ?: return null
    return when (event) {
        "delta" -> stringField(obj, "text")?.let { AiStreamEvent.Delta(it) }
        "tool_call" -> toolCall(obj)
        "tool_result" -> toolResult(obj)
        "confirm_request" -> confirmRequest(obj)
        "done" -> AiStreamEvent.Done(stringField(obj, "finish_reason") ?: DEFAULT_FINISH_REASON)
        "error" -> AiStreamEvent.Failure(stringField(obj, "message") ?: UNKNOWN_ERROR)
        else -> null
    }
}

private fun toolCall(obj: JsonObject): AiStreamEvent? {
    val id = stringField(obj, "id")
    val name = stringField(obj, "name")
    return if (id != null && name != null) AiStreamEvent.ToolCall(id, name) else null
}

private fun toolResult(obj: JsonObject): AiStreamEvent? {
    val id = stringField(obj, "id")
    val name = stringField(obj, "name")
    val ok = (obj["ok"] as? JsonPrimitive)?.booleanOrNull
    return if (id != null && name != null && ok != null) AiStreamEvent.ToolResult(id, name, ok) else null
}

private fun confirmRequest(obj: JsonObject): AiStreamEvent? {
    val continuationId = stringField(obj, "continuation_id")
    val tool = stringField(obj, "tool")
    val summary = stringField(obj, "summary")
    return if (continuationId != null && tool != null && summary != null) {
        AiStreamEvent.ConfirmRequest(continuationId, tool, summary)
    } else {
        null
    }
}

/** Reads [key] from [obj] only when it is a JSON string primitive (web `typeof d.x === 'string'`). */
private fun stringField(
    obj: JsonObject,
    key: String,
): String? = (obj[key] as? JsonPrimitive)?.takeIf { it.isString }?.content

/**
 * Applies an [event] to the current [state] — a port of the web `useAiStream` `handleEvent` plus its built-in
 * `delta.text` accumulator. A `delta` appends text and holds the stream open; `done`/`error` settle the lifecycle.
 * Tool and confirm frames update no surface state for this propose-only card (the web card neither shows a
 * transcript nor pauses), so they are folded through unchanged. Pure so every transition is asserted off-device.
 */
fun reduceDraft(
    state: TripImageDraftUiState,
    event: AiStreamEvent,
): TripImageDraftUiState =
    when (event) {
        is AiStreamEvent.Delta ->
            state.copy(phase = DraftPhase.Streaming, draft = state.draft + event.text, error = null)

        is AiStreamEvent.Done -> state.copy(phase = DraftPhase.Done)
        is AiStreamEvent.Failure -> state.copy(phase = DraftPhase.Failed, error = event.message)
        is AiStreamEvent.ToolCall -> state
        is AiStreamEvent.ToolResult -> state
        is AiStreamEvent.ConfirmRequest -> state
    }

/**
 * The withAiFeature('trip-postcard-share-card-image-generation') off-mode gate — a port of the web `useAiEnabled`.
 * The surface renders only when the settings document is present, `ai_mode` is something other than `'off'`, and
 * the per-feature `ai_features['trip-postcard-share-card-image-generation']` opt-in is exactly the boolean `true`
 * (no AI feature defaults to enabled, ADR-015 §I7). Any other shape — a not-yet-loaded document, an absent mode, a
 * missing or non-true flag — yields `false`, the same fail-closed verdict the backend `guard.Wrap` 404 reaches.
 * `trip-postcard-share-card-image-generation` is a registered feature id (see AiFeatureRegistry); the registry
 * membership check the web performs against typos is statically satisfied for this constant id.
 */
fun isTripPostcardEnabled(settings: JsonElement?): Boolean {
    val obj = settings as? JsonObject ?: return false
    val mode = stringField(obj, AI_MODE_KEY)
    val flag = (obj[AI_FEATURES_KEY] as? JsonObject)?.get(TRIP_POSTCARD_FEATURE_ID) as? JsonPrimitive
    val optedIn = flag != null && !flag.isString && flag.booleanOrNull == true
    return mode != null && mode != AI_MODE_OFF && optedIn
}

/**
 * The one PII-safe diagnostic this surface emits (P1/S11). Carries only the surface [SLUG] — never a trip id, the
 * style hint, or the proposed draft — so a diagnostics line can never leak which trip the user is sharing or what
 * Helix proposed. Kept free of Compose so it is unit-tested with a recording [Logger]; the state holder calls it
 * from the composable's first-composition effect.
 */
object TripPostcardDiagnostics {
    /** Diagnostics surface slug emitted with the `view.opened` event. */
    const val SLUG: String = TRIP_POSTCARD_SLUG

    private const val VIEW_OPENED: String = "view.opened"
    private const val SURFACE_KEY: String = "surface"

    /** Emits the `view.opened` diagnostic for this surface. Call from the first-composition effect. */
    fun recordViewOpened(logger: Logger) {
        logger.info(VIEW_OPENED, mapOf(SURFACE_KEY to SLUG))
    }
}

/** Splits a single SSE frame into its lines, tolerating `\n` and `\r\n` (web `LINE_DELIM_RE`). */
private val LINE_DELIM = Regex("\\r?\\n")
