// Pure, framework-free model + projection for the AICabinTemperatureImpactNarrative shared surface —
// the native analogue of the data the web component derives before returning JSX
// (web/src/components/ai/AICabinTemperatureImpactNarrative.tsx, the `withAiFeature` gate +
// `useAiStream` + `AIFeatureCard` composition). No Compose, no Android, no HTTP: every type here is
// unit-tested off-device in the :android:testReleaseUnitTest gate, keeping the composable a thin
// render layer.
//
// It carries the three concerns the web source folds together: the AI-Off gate (web `useAiEnabled`,
// ADR-015), the streamed-narration lifecycle (web `useAiStream`'s idle → streaming → done/error
// accumulator + SSE frame parser), and the vehicle-scope resolution (web `vehicleId ?? vehicles[0].id`).
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/shared-surfaces/AICabinTemperatureImpactNarrative — the P3 prompt's allowed-files
// path) cannot form a valid Kotlin package (a hyphen is illegal in a package identifier), so the
// package intentionally diverges from the path. `MatchingDeclarationName` is suppressed for the
// co-located supporting types.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.aicabintemperatureimpactnarrative

import io.teslasync.android.components.feedback.QueryErrorKind
import io.teslasync.android.data.ErrorKind
import io.teslasync.shared.core.api.generated.Vehicle
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.intOrNull

/**
 * Canonical registry metadata for this surface — the native mirror of the web AI-feature registry entry
 * (`internal/ai/features/registry.go` → `@/ai/features`, id `cabin-temperature-impact-narrative`). The
 * gate, the diagnostics slug and the narrate endpoint are pinned here so the native and web surfaces
 * stay in lockstep.
 */
object AICabinTemperatureImpactNarrativeRegistration {
    /** Stable AI-feature id (matches the web registry + the `ai_features` settings map key). */
    const val FEATURE_ID: String = "cabin-temperature-impact-narrative"

    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). */
    const val SLUG: String = "AICabinTemperatureImpactNarrative"

    /**
     * The `/api/v1`-relative path the narration stream is opened against (web `useAiStream({ url:
     * '/ai/climate/temperature-impact/narrate' })`). The shared client prepends `/api/v1` exactly once.
     */
    const val NARRATE_PATH: String = "/ai/climate/temperature-impact/narrate"

    /** The `ai_mode` sentinel that blocks every AI surface unconditionally (web ADR-015 §I1). */
    const val AI_MODE_OFF: String = "off"
}

/**
 * The discriminated union of every event the backend AI SSE writer emits (`internal/ai/stream/writer.go`)
 * — the native port of the web `AiStreamEvent` union. Only [Delta]/[Done]/[Error] drive the narration
 * lifecycle; the tool/confirm frames are parsed (so a forward-compatible server frame never corrupts the
 * stream) but are pass-through for this read-only narrator, exactly as the web `onEvent: () => {}` ignores
 * them.
 */
sealed interface AiNarrationEvent {
    /** A streamed text chunk; accumulated into the rendered narration (web `delta.text`). */
    data class Delta(
        val text: String,
    ) : AiNarrationEvent

    /** A tool invocation frame — pass-through for this surface (no tools in the narrate prompt). */
    data class ToolCall(
        val id: String,
        val name: String,
    ) : AiNarrationEvent

    /** A tool result frame — pass-through for this surface. */
    data class ToolResult(
        val id: String,
        val name: String,
        val ok: Boolean,
    ) : AiNarrationEvent

    /** A human-confirmation request frame — pass-through for this surface. */
    data class ConfirmRequest(
        val continuationId: String,
        val tool: String,
        val summary: String,
    ) : AiNarrationEvent

    /** The terminal success frame (web `done`); flips the lifecycle to [NarrationPhase.Done]. */
    data class Done(
        val finishReason: String,
        val usageIn: Int,
        val usageOut: Int,
    ) : AiNarrationEvent

    /**
     * The terminal error frame (web `error`). [kind]/[httpStatus] are set ONLY for a transport/HTTP
     * failure (so the surface can classify recovery copy); a server-emitted content error frame leaves
     * them null and carries the human-readable [message] verbatim, mirroring the web `AiOutputPanel`.
     */
    data class Error(
        val message: String,
        val reason: String? = null,
        val retryAfterS: Int? = null,
        val baselineAvailable: Boolean = true,
        val kind: ErrorKind? = null,
        val httpStatus: Int? = null,
    ) : AiNarrationEvent
}

/** The user-facing narration lifecycle (web `AiStreamState`, minus the tool-only `paused-confirm`). */
enum class NarrationPhase { Idle, Streaming, Done, Error }

/**
 * The mutually-exclusive surface the gated card renders. [Hidden] reproduces the web `withAiFeature`
 * null render (ADR-015 off-contract); the remaining branches map the prompt's generic
 * loading/empty/content/error/offline vocabulary onto the on-demand narration lifecycle.
 */
enum class NarrativeSurface {
    /** The AI feature flag is off → render nothing (web `withAiFeature` returns `null`). */
    Hidden,

    /** Gate on, no narration yet → the card header + description + action button (never a blank box). */
    Idle,

    /** A narration is streaming and no text has arrived yet → the "Helix is thinking" skeleton chrome. */
    Streaming,

    /** Streamed (or completed) narration text is available → render it. */
    Content,

    /** The stream failed → a classified error/offline surface with a retry affordance. */
    Error,
}

/**
 * Structured terminal-failure detail — the classified transport [kind] (+ [httpStatus]) for recovery
 * copy, or a server content-error [message] when [kind] is null, plus the optional rate-limit [limit].
 */
data class NarrationError(
    val message: String?,
    val kind: ErrorKind? = null,
    val httpStatus: Int? = null,
    val limit: NarrationLimit? = null,
) {
    /** True when this is a connectivity-class failure (offline-flavoured): show the "can't reach" copy. */
    val isNetworkClass: Boolean
        get() = kind == ErrorKind.Network || kind == ErrorKind.Timeout || kind == ErrorKind.CircuitOpen
}

/**
 * Structured rate-limit / cost-cap info parsed from a terminal error frame (web `AiLimitInfo`). Present
 * only when the frame carried a `reason`; [baselineAvailable] tells the surface the deterministic page
 * below still works, so the narrator can degrade silently.
 */
data class NarrationLimit(
    val reason: String,
    val retryAfterS: Int,
    val baselineAvailable: Boolean,
)

/**
 * The immutable, UI-thread-free state the ViewModel exposes — the native union of everything the web
 * `InnerSection` + `useAiStream` track: the AI-Off [gateEnabled] flag, the resolved [vehicleId] (web
 * `numericVehicleId`), the streamed [text] accumulator, the lifecycle [phase], and any terminal [error].
 * Pure data so the projection is unit-tested without a UI host.
 */
data class AICabinTemperatureImpactNarrativeState(
    val gateEnabled: Boolean,
    val vehicleId: Long?,
    val phase: NarrationPhase = NarrationPhase.Idle,
    val text: String = "",
    val error: NarrationError? = null,
) {
    /** True while a stream is in flight (web `state === 'streaming'`). */
    val isStreaming: Boolean get() = phase == NarrationPhase.Streaming

    /**
     * Whether the narrate action can fire — the web `canStart={haveInputs}` AND the card's
     * `!streaming` disable: the gate is on, a vehicle is in scope, and no stream is already running.
     */
    val canStart: Boolean get() = gateEnabled && vehicleId != null && phase != NarrationPhase.Streaming

    companion object {
        /** The gate-off state: nothing renders (web `withAiFeature` → `null`). */
        fun hidden(): AICabinTemperatureImpactNarrativeState = AICabinTemperatureImpactNarrativeState(gateEnabled = false, vehicleId = null)
    }
}

/**
 * Localized labels the surface folds into its output. Built from `stringResource` at the render boundary
 * (tests pass a deterministic instance), keeping the projection a pure, locale-stable function. Every
 * string resolves through the P1/S10 catalog; the error/empty recovery copy is owned by the shared
 * QueryError component, so only this surface's own labels live here.
 */
data class AICabinTemperatureImpactNarrativeStrings(
    val title: String,
    val description: String,
    val generateButton: String,
    val badge: String,
    val streamingLabel: String,
    val loadingLabel: String,
    val cancelLabel: String,
)

/**
 * Pure projection + lifecycle logic for the narration surface — the native port of the web
 * `useAiEnabled` gate, the `useAiStream` SSE parser + delta accumulator, and the vehicle-scope memo.
 */
object AICabinTemperatureImpactNarrativeProjection {
    private const val EVENT_DELTA = "delta"
    private const val EVENT_TOOL_CALL = "tool_call"
    private const val EVENT_TOOL_RESULT = "tool_result"
    private const val EVENT_CONFIRM = "confirm_request"
    private const val EVENT_DONE = "done"
    private const val EVENT_ERROR = "error"
    private const val DEFAULT_FINISH_REASON = "stop"
    private const val SSE_EVENT_PREFIX = "event:"
    private const val SSE_DATA_PREFIX = "data:"
    private const val SSE_COMMENT_PREFIX = ":"
    private const val HTTP_UNAUTHORIZED = 401
    private const val HTTP_FORBIDDEN = 403

    // Tolerant of an evolving server payload: an unknown field must never fail the whole frame.
    private val json = Json { ignoreUnknownKeys = true }

    // SSE frames are blank-line delimited (\n\n, sometimes \r\n\r\n through an intermediary); each
    // frame's lines are \n- or \r\n-separated. Mirrors the web SSE_DELIM_RE / LINE_DELIM_RE.
    private val frameDelimiter = Regex("\\r?\\n\\r?\\n")
    private val lineDelimiter = Regex("\\r?\\n")

    /**
     * The AI-Off gate (web `useAiEnabled`, ADR-015 fail-closed): the [settings] document must be a
     * present object, `ai_mode` must be present and not `"off"`, and `ai_features[FEATURE_ID]` must be
     * exactly `true`. Any other state — unresolved settings, missing map, missing/false key — is off.
     */
    fun isCabinNarrativeEnabled(settings: JsonElement?): Boolean {
        val obj = settings as? JsonObject ?: return false
        val mode = (obj["ai_mode"] as? JsonPrimitive)?.contentOrNull
        val features = obj["ai_features"] as? JsonObject
        val featureOn =
            (features?.get(AICabinTemperatureImpactNarrativeRegistration.FEATURE_ID) as? JsonPrimitive)
                ?.booleanOrNull == true
        return mode != null && mode != AICabinTemperatureImpactNarrativeRegistration.AI_MODE_OFF && featureOn
    }

    /**
     * The vehicle in scope — the [explicit] id when positive (web `vehicleId` prop), else the first
     * enrolled vehicle's id (web `vehicles?.[0]?.id`), both gated by `> 0`. Returns null when there is
     * no usable vehicle yet, which keeps the narrate button disabled (web `haveInputs` false).
     */
    fun resolveVehicleId(
        explicit: Long?,
        vehicles: List<Vehicle>?,
    ): Long? {
        explicit?.takeIf { it > 0L }?.let { return it }
        return vehicles?.firstOrNull()?.id?.takeIf { it > 0L }
    }

    /**
     * Parses a full SSE response body into the ordered list of typed events (web: the read-loop split on
     * the blank-line delimiter feeding `parseSSEFrame`). Malformed or unknown frames are skipped, never
     * fatal, so one bad frame cannot corrupt the narration.
     */
    fun parseNarrationStream(body: String): List<AiNarrationEvent> =
        frameDelimiter
            .split(body)
            .mapNotNull { frame -> frame.takeIf { it.isNotBlank() }?.let(::parseNarrationFrame) }

    /**
     * Parses one SSE frame (its lines, without the trailing blank line) into a typed [AiNarrationEvent],
     * or null on a malformed/unknown frame — the native port of the web `parseSSEFrame` + `toTypedEvent`.
     */
    fun parseNarrationFrame(raw: String): AiNarrationEvent? {
        var event = ""
        val dataParts = mutableListOf<String>()
        for (line in lineDelimiter.split(raw)) {
            when {
                line.startsWith(SSE_EVENT_PREFIX) -> event = line.removePrefix(SSE_EVENT_PREFIX).trim()
                line.startsWith(SSE_DATA_PREFIX) -> dataParts += line.removePrefix(SSE_DATA_PREFIX).trimStart()
                line.startsWith(SSE_COMMENT_PREFIX) -> Unit // SSE comment line — ignore.
            }
        }
        if (event.isEmpty()) return null
        val dataStr = dataParts.joinToString("\n")
        val data = if (dataStr.isEmpty()) null else parseFrameObject(dataStr)
        // A non-empty data string that did not parse to an object is malformed → skip the whole frame.
        val malformed = dataStr.isNotEmpty() && data == null
        return if (malformed) null else toTypedEvent(event, data)
    }

    private fun parseFrameObject(dataStr: String): JsonObject? = runCatching { json.parseToJsonElement(dataStr) as? JsonObject }.getOrNull()

    /**
     * Folds one [event] into the accumulated [state] — the native port of the web `useAiStream`
     * `handleEvent`: a delta appends text and keeps the stream live, `done` completes it, `error` fails
     * it, and tool/confirm frames are inert (read-only narrator). Pure, so the lifecycle is exhaustively
     * unit-tested.
     */
    fun reduceNarration(
        state: AICabinTemperatureImpactNarrativeState,
        event: AiNarrationEvent,
    ): AICabinTemperatureImpactNarrativeState =
        when (event) {
            is AiNarrationEvent.Delta ->
                state.copy(phase = NarrationPhase.Streaming, text = state.text + event.text, error = null)
            is AiNarrationEvent.Done -> state.copy(phase = NarrationPhase.Done)
            is AiNarrationEvent.Error ->
                state.copy(
                    phase = NarrationPhase.Error,
                    error =
                        NarrationError(
                            message = event.message,
                            kind = event.kind,
                            httpStatus = event.httpStatus,
                            limit =
                                event.reason?.let { reason ->
                                    NarrationLimit(reason, event.retryAfterS ?: 0, event.baselineAvailable)
                                },
                        ),
                )
            is AiNarrationEvent.ToolCall, is AiNarrationEvent.ToolResult, is AiNarrationEvent.ConfirmRequest -> state
        }

    /**
     * The starting state for a fresh narration run (web `start()`: state → streaming, text cleared,
     * error cleared). Coalesces a duplicate start while already streaming by returning the state
     * unchanged so a double-tap never restarts an in-flight stream.
     */
    fun startNarration(state: AICabinTemperatureImpactNarrativeState): AICabinTemperatureImpactNarrativeState =
        if (state.isStreaming) state else state.copy(phase = NarrationPhase.Streaming, text = "", error = null)

    /**
     * Promotes a stream that closed without a terminal frame to [NarrationPhase.Done] (web: "if the loop
     * ended without a terminal event AND we're still streaming, mark as done"), leaving any already
     * terminal phase untouched.
     */
    fun finishNarration(state: AICabinTemperatureImpactNarrativeState): AICabinTemperatureImpactNarrativeState =
        if (state.phase == NarrationPhase.Streaming) state.copy(phase = NarrationPhase.Done) else state

    /** Selects the surface to render from the current [state]. */
    fun narrativeSurface(state: AICabinTemperatureImpactNarrativeState): NarrativeSurface =
        when {
            !state.gateEnabled -> NarrativeSurface.Hidden
            state.phase == NarrationPhase.Error -> NarrativeSurface.Error
            state.isStreaming && state.text.isEmpty() -> NarrativeSurface.Streaming
            state.text.isNotEmpty() -> NarrativeSurface.Content
            else -> NarrativeSurface.Idle
        }

    /**
     * Maps a terminal [error] to the shared [QueryErrorKind] recovery bucket: a connectivity-class
     * failure → [QueryErrorKind.Network] ("can't reach server" + retry — the offline-flavoured surface),
     * an open breaker → [QueryErrorKind.Waiting], a 401/403 → [QueryErrorKind.Unauthorized] (sign-in), and
     * every other HTTP/content/unknown failure → [QueryErrorKind.ServerError] with a retry affordance.
     */
    fun narrationQueryErrorKind(error: NarrationError): QueryErrorKind =
        when (error.kind) {
            ErrorKind.CircuitOpen -> QueryErrorKind.Waiting
            ErrorKind.Network, ErrorKind.Timeout -> QueryErrorKind.Network
            ErrorKind.Http ->
                when (error.httpStatus) {
                    HTTP_UNAUTHORIZED, HTTP_FORBIDDEN -> QueryErrorKind.Unauthorized
                    else -> QueryErrorKind.ServerError
                }
            ErrorKind.Decode, ErrorKind.Unknown, null -> QueryErrorKind.ServerError
        }

    private fun toTypedEvent(
        event: String,
        data: JsonObject?,
    ): AiNarrationEvent? =
        if (data == null) {
            null
        } else {
            when (event) {
                EVENT_DELTA -> data.stringField("text")?.let(AiNarrationEvent::Delta)
                EVENT_TOOL_CALL -> parseToolCall(data)
                EVENT_TOOL_RESULT -> parseToolResult(data)
                EVENT_CONFIRM -> parseConfirmRequest(data)
                EVENT_DONE -> parseDone(data)
                EVENT_ERROR -> parseError(data)
                else -> null
            }
        }

    private fun parseToolCall(data: JsonObject): AiNarrationEvent? {
        val id = data.stringField("id")
        val name = data.stringField("name")
        return if (id != null && name != null) AiNarrationEvent.ToolCall(id, name) else null
    }

    private fun parseToolResult(data: JsonObject): AiNarrationEvent? {
        val id = data.stringField("id")
        val name = data.stringField("name")
        val ok = data.boolField("ok")
        return if (id != null && name != null && ok != null) AiNarrationEvent.ToolResult(id, name, ok) else null
    }

    private fun parseConfirmRequest(data: JsonObject): AiNarrationEvent? {
        val continuationId = data.stringField("continuation_id")
        val tool = data.stringField("tool")
        val summary = data.stringField("summary")
        return if (continuationId != null && tool != null && summary != null) {
            AiNarrationEvent.ConfirmRequest(continuationId, tool, summary)
        } else {
            null
        }
    }

    private fun parseDone(data: JsonObject): AiNarrationEvent {
        val usage = data["usage"] as? JsonObject
        return AiNarrationEvent.Done(
            finishReason = data.stringField("finish_reason") ?: DEFAULT_FINISH_REASON,
            usageIn = usage?.intField("in") ?: 0,
            usageOut = usage?.intField("out") ?: 0,
        )
    }

    private fun parseError(data: JsonObject): AiNarrationEvent =
        AiNarrationEvent.Error(
            message = data.stringField("message") ?: "unknown",
            reason = data.stringField("reason"),
            retryAfterS = data.intField("retry_after_s"),
            baselineAvailable = data.boolField("baseline_available") ?: true,
        )

    private fun JsonObject.stringField(key: String): String? = (this[key] as? JsonPrimitive)?.contentOrNull

    private fun JsonObject.intField(key: String): Int? = (this[key] as? JsonPrimitive)?.intOrNull

    private fun JsonObject.boolField(key: String): Boolean? = (this[key] as? JsonPrimitive)?.booleanOrNull
}
