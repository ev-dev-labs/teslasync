// Pure, framework-free model for the AIWatchFaceNLResponse shared surface — the native analogue of every value
// the web component derives before returning JSX (web/src/components/ai/AIWatchFaceNLResponse.tsx, rendered
// through its AIFeatureCard scaffold + the useAiStream SSE hook + the withAiFeature off-mode gate). No Compose,
// no Android UI, no HTTP: every declaration here is exercised off-device by the :android:testReleaseUnitTest
// gate, keeping the composable a thin render layer and the stream holder a thin lifecycle layer over these pure
// functions.
//
// AIWatchFaceNLResponse is the watch-face "Ask Helix about your car" narrator card. The web component takes an
// OPTIONAL free-text question (an empty box is allowed — the backend falls back to a deterministic glance
// summary), POSTs it as `{ message }` (omitted when blank, so the body is `{}`) to `/ai/watch/respond` via
// useAiStream, and accumulates the streamed `delta.text` into a single narrated answer, surfacing the
// idle → streaming → paused-confirm → done / error lifecycle through AIFeatureCard + AiOutputPanel. The render
// contract is NARRATIVE: the strategy emits delta narration only — it never claims to have changed a setting or
// sent a vehicle command, so tool/confirm frames carry no proposal this card would apply. This file owns the
// parts the web render + hook derive from that contract:
//   • the respond endpoint path — web `useAiStream({ url: '/ai/watch/respond' })` ([WATCH_RESPOND_PATH]);
//   • the optional-message request body — web `useMemo(() => ({ message: trimmed || undefined }))` then
//     `JSON.stringify(body)`, which serializes a blank question as `{}` ([watchRespondRequestBody]);
//   • the message hard cap mirroring the backend `aiWatchFaceNLResponseMaxMessageLen` parser ([MAX_MESSAGE_CHARS],
//     [capMessage]);
//   • the action-readiness predicate — web `canStart = messageWithinCap && state !== 'paused-confirm'`, plus the
//     honest offline gate the P3 action-surface contract adds ([isWatchRespondReady]); an empty question is
//     allowed (the backend default-summary path), so a non-empty message is NOT required;
//   • the SSE wire parser — web `parseSSEFrame` + `toTypedEvent` over the chunk re-assembly the web reader loop
//     does ([SseFrameAccumulator], [parseWatchFrame]);
//   • the stream reducer — web `useAiStream` `handleEvent` + its `delta.text` accumulator + the
//     paused-confirm transition, in [reduceWatchRespond] over [WatchRespondUiState];
//   • the surface classifier folding the lifecycle onto the P3 loading / empty / content / error / stale /
//     offline contract ([classifyWatchRespond]);
//   • the withAiFeature('watch-face-nl-response') off-mode gate — web `useAiEnabled` ([isWatchRespondEnabled]).
//
// Binding (P1/S8): this surface performs NO HTTP from the view. The streamed bytes arrive over an injected
// [io.teslasync.android.sharedsurfaces.aiwatchfacenlresponse.WatchRespondTransport] seam the host wires to the
// shared resilient client; the lifecycle is owned by the co-located [WatchRespondController]. This file is the
// pure adapter both are unit-tested over.
//
// Parity-with-honesty (Honesty Covenant #9, documented not silent):
//   • The web `canStart` references `paused-confirm`; the union is reproduced and the gate honours it even though
//     a NARRATIVE-only strategy is not expected to emit a confirm frame — the useAiStream analogue still
//     transitions on one, so the gate stays meaningful + testable.
//   • Re-running an LLM narration is an explicit, billable action, so the stale surface invites a manual re-ask
//     (a stale chip) rather than auto-refreshing (documented divergence from the templated "auto-refresh").
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/shared-surfaces/AIWatchFaceNLResponse — the P3 prompt's allowed-files path) cannot form a valid
// Kotlin package (a hyphen and a PascalCase segment are illegal in a package identifier), so the package
// intentionally diverges from the path — exactly as the sibling shared surfaces do. `MatchingDeclarationName` is
// suppressed for the co-located supporting declarations.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.aiwatchfacenlresponse

import io.teslasync.android.data.ErrorKind
import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

/** The web AI feature id this surface is gated by (`withAiFeature('watch-face-nl-response', …)`). */
const val WATCH_FACE_NL_FEATURE_ID: String = "watch-face-nl-response"

/** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). Carries no question/answer PII. */
const val WATCH_FACE_NL_SLUG: String = "AIWatchFaceNLResponse"

/** The respond endpoint the web hook streams against (`useAiStream({ url: '/ai/watch/respond' })`). */
const val WATCH_RESPOND_PATH: String = "/ai/watch/respond"

/**
 * The maximum question length the Ask action will submit — the native mirror of the web `MaxMessageChars`
 * constant, which itself mirrors the backend handler's `aiWatchFaceNLResponseMaxMessageLen` cap so a
 * parser-rejection 400 never reaches the user. Keep these in sync with the web + backend constants.
 */
const val MAX_MESSAGE_CHARS: Int = 1000

/**
 * How long a completed narration is considered fresh before the surface flags it stale and invites a manual
 * re-ask. Five minutes mirrors the app's live-data staleness budget; it is generous because a glance summary of
 * canonical state does not churn second-to-second, and re-running it costs an LLM call.
 */
const val WATCH_FRESHNESS_WINDOW_MS: Long = 5L * 60L * 1_000L

/** The `ai_mode` value that fully disables every AI surface (ADR-015 §I1). */
internal const val AI_MODE_OFF: String = "off"

/** Settings document key for the global AI mode (web `settings.ai_mode`). */
internal const val AI_MODE_KEY: String = "ai_mode"

/** Settings document key for the per-feature opt-in map (web `settings.ai_features`). */
internal const val AI_FEATURES_KEY: String = "ai_features"

/** The JSON body key carrying the user's optional question (web request body `{ message }`). */
internal const val MESSAGE_FIELD: String = "message"

/** Default `finish_reason` when a `done` frame omits one (web `toTypedEvent` default `'stop'`). */
internal const val DEFAULT_FINISH_REASON: String = "stop"

/** Default error message when an `error` frame omits one (web `toTypedEvent` default `'unknown'`). */
internal const val UNKNOWN_ERROR: String = "unknown"

/** Lenient JSON reader for SSE `data:` payloads — unknown keys are ignored, matching the web parser. */
private val watchJson: Json = Json { ignoreUnknownKeys = true }

/**
 * The typed Server-Sent-Events union the respond stream can carry — a 1:1 port of the web `AiStreamEvent`
 * discriminated union (web/src/hooks/useAiStream.ts). The narrator emits `delta` answer fragments plus the
 * `tool_call`/`tool_result`/`confirm_request` frames the generic hook understands and a terminal `done`/`error`.
 * The full union is reproduced so the parser is a faithful, reusable port and so a future server frame can never
 * crash an older client (unknown frames are dropped, not thrown).
 */
sealed interface AiStreamEvent {
    /** A streamed text fragment (web `{ type: 'delta', text }`); accumulated into the narrated answer. */
    data class Delta(
        val text: String,
    ) : AiStreamEvent

    /** A tool invocation frame (web `{ type: 'tool_call', id, name }`); inert for this narrate-only card. */
    data class ToolCall(
        val id: String,
        val name: String,
    ) : AiStreamEvent

    /** A tool result frame (web `{ type: 'tool_result', id, name, ok }`); inert for this narrate-only card. */
    data class ToolResult(
        val id: String,
        val name: String,
        val ok: Boolean,
    ) : AiStreamEvent

    /** A human-in-the-loop confirm frame (web `{ type: 'confirm_request', … }`); pauses the stream. */
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

/** The lifecycle the respond stream moves through — the native analogue of the web `AiStreamState` union. */
enum class WatchRespondPhase {
    /** No stream started yet (web `'idle'`); the card shows its ready presentation. */
    Idle,

    /** A stream is open; text accumulates as `delta` frames arrive (web `'streaming'`). */
    Streaming,

    /** A confirm frame paused the stream (web `'paused-confirm'`); the action is gated off while paused. */
    PausedConfirm,

    /** The stream settled successfully (web `'done'`); the accumulated text is the narrated answer. */
    Done,

    /** The stream ended in error (web `'error'`); [WatchRespondUiState.error] carries the message. */
    Failed,
}

/**
 * The render-ready stream state — the native mirror of the slice of `useAiStream`'s result the AIFeatureCard +
 * AiOutputPanel read (`state` / `text` / `error`), extended with the last-committed narration + freshness stamp
 * the P3 stale/offline contract needs. Pure (no Compose types) so it is fully unit-tested off-device.
 *
 * @property phase the lifecycle phase (web `stream.state`).
 * @property streamingText the in-flight `delta.text` accumulator (web `stream.text`); empty until a delta.
 * @property committedText the last successfully completed narration, retained for the offline/cached surface.
 * @property error the terminal error message when [phase] is [WatchRespondPhase.Failed] (web `stream.error`).
 * @property errorKind the classification of the most recent failure (offline vs. in-band), or `null`.
 * @property fetchedAt epoch-millis stamp of [committedText], or `null` when nothing has completed.
 */
data class WatchRespondUiState(
    val phase: WatchRespondPhase = WatchRespondPhase.Idle,
    val streamingText: String = "",
    val committedText: String = "",
    val error: String? = null,
    val errorKind: ErrorKind? = null,
    val fetchedAt: Long? = null,
) {
    /** A stream is in flight (web `state === 'streaming'`); the action is disabled and shows progress. */
    val isStreaming: Boolean get() = phase == WatchRespondPhase.Streaming

    /** The stream is paused awaiting a confirm (web `state === 'paused-confirm'`). */
    val isPaused: Boolean get() = phase == WatchRespondPhase.PausedConfirm

    /** The stream settled successfully (web `state === 'done'`). */
    val isDone: Boolean get() = phase == WatchRespondPhase.Done

    /** The stream ended in error (web `state === 'error'`). */
    val isFailed: Boolean get() = phase == WatchRespondPhase.Failed

    /** No stream has run yet (web `state === 'idle'`); the card shows its ready presentation. */
    val isIdle: Boolean get() = phase == WatchRespondPhase.Idle

    /** True once the in-flight accumulator holds at least one `delta` (web `text.length > 0`). */
    val hasResults: Boolean get() = streamingText.isNotEmpty()
}

/**
 * Mirrors the web Textarea `maxLength={MaxMessageChars}` hard input cap: a longer value is truncated to the
 * first [MAX_MESSAGE_CHARS] characters so the state never holds an over-cap question (which would 400).
 */
fun capMessage(value: String): String = if (value.length > MAX_MESSAGE_CHARS) value.substring(0, MAX_MESSAGE_CHARS) else value

/**
 * Whether the action can fire — the web `canStart = messageWithinCap && state !== 'paused-confirm'`, plus the
 * honest offline gate the P3 action-surface contract requires (offline never opens a doomed stream). An EMPTY
 * question is allowed: the backend applies its deterministic default-summary prompt, so connectivity + a
 * within-cap message + a non-paused stream is the whole predicate. Pure so the button-enable rule is asserted
 * off-device and shared by both the controller guard and the composable.
 */
fun isWatchRespondReady(
    message: String,
    phase: WatchRespondPhase,
    online: Boolean,
): Boolean = online && message.trim().length <= MAX_MESSAGE_CHARS && phase != WatchRespondPhase.PausedConfirm

/**
 * Serializes the request body the respond stream POSTs — a port of the web
 * `useMemo(() => ({ message: trimmed.length > 0 ? trimmed : undefined }))` then `JSON.stringify(body)`. A blank
 * or whitespace-only question serializes as `{}` (the honest "user did not supply a question" signal that drives
 * the backend default-summary path); a real question serializes as `{"message":"…"}` with correct escaping for
 * quotes, newlines, and unicode, so the transport hands the shared client exactly the bytes `/ai/watch/respond`
 * reads.
 */
fun watchRespondRequestBody(message: String): String {
    val trimmed = message.trim()
    return if (trimmed.isEmpty()) {
        buildJsonObject {}.toString()
    } else {
        buildJsonObject { put(MESSAGE_FIELD, trimmed) }.toString()
    }
}

/**
 * Opens a fresh ask: enter [WatchRespondPhase.Streaming], clear the in-flight accumulator, and drop any prior
 * error. The last [WatchRespondUiState.committedText] is intentionally retained (not shown while streaming) so a
 * failed re-ask can fall back to last-known — the web clears its visible text the same way at `start()`,
 * surfacing the thinking indicator until the first delta.
 */
fun WatchRespondUiState.startAsking(): WatchRespondUiState =
    copy(phase = WatchRespondPhase.Streaming, streamingText = "", error = null, errorKind = null)

/**
 * Applies one parsed [event] to the current state — a port of the web `useAiStream` `handleEvent` plus its
 * built-in `delta.text` accumulator. A `delta` appends text and holds the stream open; `done` commits + stamps;
 * `error` settles to failed; a `confirm_request` pauses the stream (web `paused-confirm`). Tool frames update no
 * surface state for this NARRATIVE-only card. Pure so every transition is asserted off-device.
 */
fun WatchRespondUiState.reduceWatchRespond(
    event: AiStreamEvent,
    nowMs: Long,
): WatchRespondUiState =
    when (event) {
        is AiStreamEvent.Delta ->
            copy(
                phase = WatchRespondPhase.Streaming,
                streamingText = streamingText + event.text,
                error = null,
                errorKind = null,
            )

        is AiStreamEvent.Done -> markDone(nowMs)
        is AiStreamEvent.Failure -> markFailed(event.message, ErrorKind.Unknown)
        is AiStreamEvent.ConfirmRequest -> copy(phase = WatchRespondPhase.PausedConfirm)
        is AiStreamEvent.ToolCall -> this
        is AiStreamEvent.ToolResult -> this
    }

/**
 * Commits the accumulated narration as the answer and stamps it for the freshness check. A blank result keeps a
 * blank [WatchRespondUiState.committedText] so the surface renders its friendly empty state rather than an empty
 * box.
 */
fun WatchRespondUiState.markDone(nowMs: Long): WatchRespondUiState =
    copy(phase = WatchRespondPhase.Done, committedText = streamingText, fetchedAt = nowMs)

/** Marks the stream failed with [message] + the classified [kind]; the prior committed narration is left intact. */
fun WatchRespondUiState.markFailed(
    message: String?,
    kind: ErrorKind,
): WatchRespondUiState = copy(phase = WatchRespondPhase.Failed, error = message, errorKind = kind)

/**
 * Closes a stream that ended without an explicit terminal frame (the producer simply completed). Mirrors the web
 * hook promoting a still-`streaming` state to `done` when the reader drains, so the UI never hangs on the
 * thinking indicator. A paused/settled state is left untouched.
 */
fun WatchRespondUiState.finishIfStreaming(nowMs: Long): WatchRespondUiState =
    if (phase == WatchRespondPhase.Streaming) markDone(nowMs) else this

/**
 * The render-ready classification of [WatchRespondUiState] — a closed set of mutually-exclusive surfaces the
 * view switches on, so every branch is exhaustively covered and unit-tested off-device. Maps the stream
 * lifecycle onto the P3 loading / empty / content / error / stale / offline contract. The off-mode gate is
 * applied upstream by the composable ([isWatchRespondEnabled]) — the withAiFeature HOC analogue — so this
 * classifier handles only the live stream surfaces.
 */
sealed interface WatchSurface {
    /** Resting/idle: the card with the question form and no output panel (web panel absent until a stream runs). */
    data object Resting : WatchSurface

    /** Streaming with no delta yet — the thinking indicator (the surface's loading state). */
    data object Working : WatchSurface

    /** Streaming (or paused) with partial text — the narration rendering live as it arrives. */
    data class Live(
        val text: String,
    ) : WatchSurface

    /** Completed with text — the narrated answer; [stale] flags a fetch older than the freshness window. */
    data class Ready(
        val text: String,
        val stale: Boolean,
    ) : WatchSurface

    /** Completed but blank — a friendly empty state (the model returned nothing). */
    data object Empty : WatchSurface

    /** Failed but a prior narration exists — last-known kept visible; [offline] picks the chip/copy. */
    data class Cached(
        val text: String,
        val offline: Boolean,
    ) : WatchSurface

    /** Failed with no last-known — a QueryError-equivalent with retry; [offline] picks the recovery copy. */
    data class Failed(
        val offline: Boolean,
        val message: String?,
    ) : WatchSurface
}

/**
 * Selects the render-ready [WatchSurface] for [state]. Pure (no Compose/clock): the caller supplies [nowMs] and
 * the [windowMs] freshness budget so the staleness decision is deterministic and testable. A paused stream folds
 * onto the same live/thinking surfaces as streaming (the narration so far stays visible).
 */
fun classifyWatchRespond(
    state: WatchRespondUiState,
    nowMs: Long,
    windowMs: Long = WATCH_FRESHNESS_WINDOW_MS,
): WatchSurface =
    when (state.phase) {
        WatchRespondPhase.Idle -> WatchSurface.Resting
        WatchRespondPhase.Streaming, WatchRespondPhase.PausedConfirm ->
            if (state.streamingText.isBlank()) WatchSurface.Working else WatchSurface.Live(state.streamingText)

        WatchRespondPhase.Done ->
            if (state.committedText.isBlank()) {
                WatchSurface.Empty
            } else {
                WatchSurface.Ready(state.committedText, isStale(state.fetchedAt, nowMs, windowMs))
            }

        WatchRespondPhase.Failed -> failedSurface(state)
    }

/** Failure → last-known [WatchSurface.Cached] when a prior narration exists, else a hard failure. */
private fun failedSurface(state: WatchRespondUiState): WatchSurface {
    val offline = state.errorKind == ErrorKind.Network
    return if (state.committedText.isNotBlank()) {
        WatchSurface.Cached(state.committedText, offline)
    } else {
        WatchSurface.Failed(offline, state.error)
    }
}

/** True when a completed narration stamped at [fetchedAt] is older than [windowMs] relative to [nowMs]. */
fun isStale(
    fetchedAt: Long?,
    nowMs: Long,
    windowMs: Long,
): Boolean = fetchedAt != null && nowMs - fetchedAt > windowMs

// ── SSE wire parsing (web parseSSEFrame + the reader-loop buffering) ──────────────────────────────────────────

/**
 * Reassembles the raw UTF-8 chunks an SSE transport emits into whole frames — the native analogue of the web
 * reader loop's blank-line buffering (`buffer.split(SSE_DELIM_RE)`, keeping the trailing partial fragment for
 * the next read). Stateful across [feed] calls; [drain] yields any final fragment that arrived without a
 * trailing blank line (web's post-loop `if (buffer.trim()) …`).
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
fun parseWatchFrame(raw: String): AiStreamEvent? {
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
    return runCatching { watchJson.parseToJsonElement(data) }.getOrNull()
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

// ── Off-mode gate (web useAiEnabled) ─────────────────────────────────────────────────────────────────────────

/**
 * The withAiFeature('watch-face-nl-response') off-mode gate — a port of the web `useAiEnabled`. The surface
 * renders only when the settings document is present, `ai_mode` is something other than `'off'`, and the
 * per-feature `ai_features['watch-face-nl-response']` opt-in is exactly the boolean `true` (no AI feature
 * defaults to enabled, ADR-015 §I7). Any other shape — a not-yet-loaded document, an absent mode, a missing or
 * non-true flag — yields `false`, the same fail-closed verdict the backend `guard.Wrap` 404 reaches.
 */
fun isWatchRespondEnabled(settings: JsonElement?): Boolean {
    val obj = settings as? JsonObject ?: return false
    val mode = stringField(obj, AI_MODE_KEY)
    val flag = (obj[AI_FEATURES_KEY] as? JsonObject)?.get(WATCH_FACE_NL_FEATURE_ID) as? JsonPrimitive
    val optedIn = flag != null && !flag.isString && flag.booleanOrNull == true
    return mode != null && mode != AI_MODE_OFF && optedIn
}

// ── Accessibility labels (merged TalkBack descriptions, resolved off-device) ─────────────────────────────────

/**
 * Builds the merged accessibility description for the card header from already-localized parts (web reads the
 * title, the "Helix" badge, and the description as one block). Kept pure so TalkBack-label presence is
 * unit-tested without a Compose host.
 */
fun headerAccessibilityLabel(
    title: String,
    badge: String,
    description: String,
): String = "$title ($badge). $description"

/** The localized announcement fragments [outputAccessibilityLabel] composes — resolved by the view from i18n. */
data class WatchOutputLabels(
    val working: String,
    val empty: String,
    val stale: String,
    val offline: String,
    val error: String,
)

/**
 * Builds the accessibility description for the output region per [surface] from already-localized parts, or
 * `null` when the output region carries no announcement (the resting surface, whose card chrome + question form
 * are announced instead). Pure so the per-state a11y labels are unit-tested off-device.
 */
fun outputAccessibilityLabel(
    surface: WatchSurface,
    labels: WatchOutputLabels,
): String? =
    when (surface) {
        WatchSurface.Resting -> null
        WatchSurface.Working, is WatchSurface.Live -> labels.working
        WatchSurface.Empty -> labels.empty
        is WatchSurface.Ready -> if (surface.stale) "${labels.stale}. ${surface.text}" else surface.text
        is WatchSurface.Cached -> "${if (surface.offline) labels.offline else labels.error}. ${surface.text}"
        is WatchSurface.Failed -> if (surface.offline) "${labels.offline}. ${labels.error}" else labels.error
    }

// ── Diagnostics (P1/S11 view.opened contract) ────────────────────────────────────────────────────────────────

/**
 * The one PII-safe diagnostic this surface emits (P1/S11). Carries only the surface [SLUG] — never the user's
 * question or the narrated answer — so a diagnostics line can never leak what the user asked or what Helix
 * returned. Kept free of Compose so it is unit-tested with a recording [Logger]; the state holder calls it from
 * the composable's first-composition effect.
 */
object WatchRespondDiagnostics {
    /** Diagnostics surface slug emitted with the `view.opened` event. */
    const val SLUG: String = WATCH_FACE_NL_SLUG

    private const val VIEW_OPENED: String = "view.opened"
    private const val SURFACE_KEY: String = "surface"

    /** Emits the `view.opened` diagnostic for this surface. Call from the first-composition effect. */
    fun recordViewOpened(logger: Logger) {
        logger.info(VIEW_OPENED, mapOf(SURFACE_KEY to SLUG))
    }
}

/** Splits a single SSE frame into its lines, tolerating `\n` and `\r\n` (web `LINE_DELIM_RE`). */
private val LINE_DELIM = Regex("\\r?\\n")
