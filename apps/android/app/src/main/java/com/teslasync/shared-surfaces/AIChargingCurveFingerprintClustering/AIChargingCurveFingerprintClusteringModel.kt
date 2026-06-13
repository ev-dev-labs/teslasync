// Pure, framework-free model + projection + SSE decode + diagnostics for the
// AIChargingCurveFingerprintClustering shared surface — the native analogue of everything
// web/src/components/ai/AIChargingCurveFingerprintClustering.tsx (plus the shared AIFeatureCard /
// AiOutputPanel / AIThinkingIndicator scaffold it renders through, and the useAiStream SSE consumer it
// drives) derives before returning JSX. No Compose, no Android framework, no HTTP: every declaration here
// is exercised off-device in the :android:testReleaseUnitTest gate (P3 acceptance: adapter + per-state +
// a11y-label tests), keeping the composable a thin render layer.
//
// The web surface is an opt-in AI feature card on the Charging Curves page. It calls
// `useAiStream({ url: '/ai/charging/curves/clusters/explain', body: { vehicle_id } })` and renders an
// `AIFeatureCard` (a GlassPanel → header [title + cyan Helix badge + description + optional empty hint]
// → "Ask Helix" button → AiOutputPanel). The Explain button is disabled while the stream is open OR
// when no vehicle is in scope (`!canStart || streaming`); the streamed delta text accumulates into the
// AiOutputPanel, which shows an animated thinking indicator while the SSE is open with no text yet, the
// accumulated narrative once tokens arrive, and an inline Helix error if the stream ends in `error`. The
// whole card is gated by `withAiFeature('charging-curve-fingerprint-clustering', …)`, so it is entirely
// absent when the feature is off (ADR-015 §I5).
//
// This file reproduces that surface's pure logic in framework-free Kotlin:
//   - [AiStreamPhase] mirrors useAiStream's lifecycle (idle → streaming → done | error) — the four
//     states the AiOutputPanel + button actually distinguish (the feature never triggers the
//     `paused-confirm` branch: its onEvent is a no-op and the explain route emits no confirm frame).
//   - [haveInputs] / [requestVehicleId] mirror the web `Number.isFinite(id) && id > 0` gate and the
//     `{ vehicle_id: finite ? id : 0 }` body shape.
//   - [buttonDisabled] mirrors the web `!canStart || isStreaming`.
//   - [outputPanelStateFor] mirrors AiOutputPanel's render branches (hidden / thinking / error / text).
//   - [shouldRender] mirrors the withAiFeature visibility gate.
//   - [cardAccessibilityLabel] folds the header into one TalkBack announcement (a11y-label coverage).
//   - [AiStreamFrame] + [parseAiSseEvent] + [AiSseFrameAccumulator] mirror useAiStream's SSE frame
//     parser bit-for-bit (blank-line-delimited frames, `event:`/`data:` lines, typed delta/done/error).
//
// The four surface strings (title, description, button, badge) resolve through existing P1/S10 catalog
// keys (`translation_charging_aiClustering_*`); the shared AIFeatureCard chrome strings (Ask Helix,
// thinking, error label, unknown) resolve through the by-name optional-catalog seam with the web default
// as the fallback — the same `t(key, default)` pattern the sibling AIRestorePanel port uses for keys the
// catalog may not yet carry (strings.xml is outside this surface's allowed files). The English source
// strings are reproduced in [AiClusteringDefaults] for the off-device contract test.
//
// `InvalidPackageDeclaration` is suppressed because the mandated surface directory
// (com/teslasync/shared-surfaces/AIChargingCurveFingerprintClustering — the P3 prompt's allowed-files
// path) cannot form a valid Kotlin package identifier (a hyphen segment and a PascalCase leaf are
// illegal), so the package intentionally diverges from the path — exactly as the sibling VisuallyHidden /
// AIRestorePanel surfaces do. `MatchingDeclarationName` is suppressed for the co-located declarations.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.aichargingcurvefingerprintclustering

import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive

/**
 * Canonical registry metadata for the surface. The diagnostics [SLUG] is emitted with the one-shot
 * `view.opened` event (P1/S11) and is the surface slug the prompt mandates
 * (`AIChargingCurveFingerprintClustering`); [FEATURE_ID] is the web feature flag the withAiFeature gate
 * keys on; [TEST_ID] mirrors the web `data-testid` the off-mode invariant asserts against.
 */
object AIChargingCurveFingerprintClusteringRegistration {
    /** The web feature id the visibility gate keys on (`withAiFeature('charging-curve-fingerprint-clustering', …)`). */
    const val FEATURE_ID: String = "charging-curve-fingerprint-clustering"

    /** Stable surface id — the web `data-testid="ai-feature-charging-curve-fingerprint-clustering-root"`. */
    const val TEST_ID: String = "ai-feature-charging-curve-fingerprint-clustering-root"

    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). */
    const val SLUG: String = "AIChargingCurveFingerprintClustering"
}

/**
 * The `/api/v1` path (sans prefix) the explain stream POSTs to — the web
 * `useAiStream({ url: '/ai/charging/curves/clusters/explain' })`. The transport adds the `/api/v1`
 * prefix, mirroring the resilient client's contract.
 */
const val AI_CLUSTERING_EXPLAIN_PATH: String = "/ai/charging/curves/clusters/explain"

/**
 * The web `t(key, default)` source strings. The four surface keys exist in the generated catalog
 * (`translation_charging_aiClustering_*`) so the composable shows the localized `stringResource`; the
 * shared AIFeatureCard chrome keys (`helix.*`, `ai.common.*`) may not yet be in the catalog, so the
 * composable resolves them by name and falls back to these English defaults — exactly as the web falls
 * back to the second `t()` argument. The values are reproduced here for the off-device contract test.
 */
object AiClusteringDefaults {
    /** Web `t('charging.aiClustering.title', …)`. */
    const val TITLE: String = "Explain the charging-curve cluster fingerprints"

    /** Web `t('charging.aiClustering.description', …)`. */
    const val DESCRIPTION: String =
        "Ask Helix to name and explain each deterministic charging-curve cluster fingerprint. " +
            "The narrator never changes the cluster bucketing \u2014 it grounds every sentence in the " +
            "same per-cluster numbers the curves below render."

    /** Web `t('charging.aiClustering.generateButton', 'Explain clusters')` — the per-feature verb / tooltip / aria hint. */
    const val BUTTON_LABEL: String = "Explain clusters"

    /** Web `t('charging.aiClustering.badge', 'Helix')`. */
    const val BADGE: String = "Helix"

    /** Web `t('helix.askHelix', 'Ask Helix')` — the universal Helix CTA shown on the action button. */
    const val ASK_HELIX: String = "Ask Helix"

    /** Web `t('helix.thinking', 'Helix is thinking…')` — the streaming button label + thinking-indicator label. */
    const val THINKING: String = "Helix is thinking\u2026"

    /** Web `t('helix.errorLabel', 'Helix error:')` — the inline error prefix in the output panel. */
    const val ERROR_LABEL: String = "Helix error:"

    /** Web `t('ai.common.errorUnknown', 'unknown')` — the fallback when an error frame carries no message. */
    const val ERROR_UNKNOWN: String = "unknown"

    /** The empty-hint shown under the description while no vehicle is in scope (web disabled-button context). */
    const val EMPTY_HINT: String = "Select a vehicle to explain its charging-curve clusters."
}

/** Android string-resource name for the web `charging.aiClustering.title` key. */
const val KEY_TITLE: String = "translation_charging_aiClustering_title"

/** Android string-resource name for the web `charging.aiClustering.description` key. */
const val KEY_DESCRIPTION: String = "translation_charging_aiClustering_description"

/** Android string-resource name for the web `charging.aiClustering.generateButton` key. */
const val KEY_BUTTON_LABEL: String = "translation_charging_aiClustering_generateButton"

/** Android string-resource name for the web `charging.aiClustering.badge` key. */
const val KEY_BADGE: String = "translation_charging_aiClustering_badge"

/** Android string-resource name for the web `helix.askHelix` key (resolved if present, else the default). */
const val KEY_ASK_HELIX: String = "translation_helix_askHelix"

/** Android string-resource name for the web `helix.thinking` key (resolved if present, else the default). */
const val KEY_THINKING: String = "translation_helix_thinking"

/** Android string-resource name for the web `helix.errorLabel` key (resolved if present, else the default). */
const val KEY_ERROR_LABEL: String = "translation_helix_errorLabel"

/** Android string-resource name for the web `ai.common.errorUnknown` key (resolved if present, else the default). */
const val KEY_ERROR_UNKNOWN: String = "translation_ai_common_errorUnknown"

/**
 * The user-facing stream lifecycle the surface renders — the native tag for useAiStream's `AiStreamState`,
 * narrowed to the four phases the AiOutputPanel + action button actually distinguish. [Idle] is the
 * pre-run state (no stream opened yet); [Streaming] is an open SSE connection; [Done] is a cleanly
 * finished stream; [Error] is a failed one. The web `paused-confirm` phase is unreachable for this
 * feature (its onEvent is a no-op and the explain route emits no confirm frame), so it is intentionally
 * not modeled — reproducing it would fabricate a branch the surface can never render.
 */
enum class AiStreamPhase { Idle, Streaming, Done, Error }

/**
 * The projected stream surface the ViewModel exposes and the view renders — the native analogue of the
 * useAiStream `{ state, text, error }` slice the AIFeatureCard reads, plus the resolved [canStart] gate.
 *
 * @property phase the stream lifecycle (web `state`).
 * @property text the accumulated delta narrative (web `text`); empty until the first token.
 * @property error the terminal error message when [phase] is [AiStreamPhase.Error] (web `error`), else null.
 * @property canStart whether the explain action may fire — a vehicle is in scope (web `canStart`/`haveInputs`).
 */
data class ClusteringSurfaceState(
    val phase: AiStreamPhase = AiStreamPhase.Idle,
    val text: String = "",
    val error: String? = null,
    val canStart: Boolean = false,
)

/**
 * The web `haveInputs = Number.isFinite(numericVehicleId) && numericVehicleId > 0`. The handler-side parser
 * validates `vehicle_id > 0`; this mirrors it so the action stays disabled until the active vehicle
 * resolves. A `null` id (selection unresolved) is not ready.
 */
fun haveInputs(vehicleId: Long?): Boolean = vehicleId != null && vehicleId > 0

/**
 * The web request body's `vehicle_id`: the resolved id when [haveInputs] holds, else `0` (the web
 * `Number.isFinite(numericVehicleId) ? numericVehicleId : 0`). Kept total so the body is always well-formed.
 */
fun requestVehicleId(vehicleId: Long?): Long = if (haveInputs(vehicleId)) vehicleId!! else 0L

/**
 * The web action button's `disabled = !canStart || isStreaming`. The button is inert while a stream is in
 * flight (double-submit protection mirrors the hook's `runningRef` coalescing) or when no vehicle is in
 * scope.
 */
fun buttonDisabled(
    canStart: Boolean,
    phase: AiStreamPhase,
): Boolean = !canStart || phase == AiStreamPhase.Streaming

/**
 * The withAiFeature visibility gate — the native analogue of the web HOC that returns `null` when the
 * feature is off (ADR-015 §I5). When [featureEnabled] is false the surface renders nothing at all; the
 * host supplies this flag from its AI-enabled state (the web `useAiEnabled(feature)`).
 */
fun shouldRender(featureEnabled: Boolean): Boolean = featureEnabled

/**
 * What the output panel renders for a given stream — the native mirror of AiOutputPanel's branches.
 * [Hidden] is the pre-run state (web returns `null` when `!hasAnything`); [Thinking] is an open stream with
 * no token yet (web `text.length === 0 && state === 'streaming'` → AIThinkingIndicator); [Error] is a
 * failed stream (web `state === 'error'`); [Text] is the accumulated narrative (web default branch).
 */
sealed interface OutputPanelState {
    /** No stream has run yet — the panel is absent (web `if (!hasAnything) return null`). */
    data object Hidden : OutputPanelState

    /** Open stream, no token yet — show the animated thinking indicator. */
    data object Thinking : OutputPanelState

    /** Terminal error — show the inline Helix error message. */
    data class Error(
        val message: String,
    ) : OutputPanelState

    /** Tokens have arrived (or the stream finished) — show the accumulated narrative. */
    data class Text(
        val text: String,
    ) : OutputPanelState
}

/**
 * Projects a stream's `(phase, text, error)` onto the [OutputPanelState] the view renders — the exact
 * AiOutputPanel branch order: nothing before any run, the error first, then the empty-while-streaming
 * thinking indicator, then the accumulated text. [errorFallback] supplies the "unknown" message when an
 * error frame carried none (web `error ?? t('ai.common.errorUnknown', 'unknown')`).
 */
fun outputPanelStateFor(
    phase: AiStreamPhase,
    text: String,
    error: String?,
    errorFallback: String = AiClusteringDefaults.ERROR_UNKNOWN,
): OutputPanelState {
    val hasAnything =
        text.isNotEmpty() ||
            phase == AiStreamPhase.Streaming ||
            phase == AiStreamPhase.Error ||
            phase == AiStreamPhase.Done
    return when {
        !hasAnything -> OutputPanelState.Hidden
        phase == AiStreamPhase.Error -> OutputPanelState.Error(error?.takeIf { it.isNotBlank() } ?: errorFallback)
        text.isEmpty() && phase == AiStreamPhase.Streaming -> OutputPanelState.Thinking
        else -> OutputPanelState.Text(text)
    }
}

/**
 * Folds the card header — [title], [badge], [description], and the [emptyHint] shown when [canStart] is
 * false — into a single TalkBack content description so the panel is announced as one coherent message.
 * The action button stays a separately-labeled control. Pure, so the a11y label is asserted off-device.
 */
fun cardAccessibilityLabel(
    title: String,
    badge: String,
    description: String,
    emptyHint: String,
    canStart: Boolean,
): String =
    buildString {
        append(title)
        append(". ")
        append(badge)
        append(". ")
        append(description)
        if (!canStart) {
            append(" ")
            append(emptyHint)
        }
    }

// ── SSE decode: the native mirror of useAiStream's frame parser ──────────────────────────────────────

/** Web `event: 'delta'` — an accumulated narrative token. */
private const val EVENT_DELTA: String = "delta"

/** Web `event: 'done'` — the stream finished cleanly. */
private const val EVENT_DONE: String = "done"

/** Web `event: 'error'` — the stream failed; carries a human-readable `message`. */
private const val EVENT_ERROR: String = "error"

/** The blank-line SSE frame terminator (web `/\r?\n\r?\n/`); some intermediaries normalise to CRLF. */
private val FRAME_DELIM: Regex = Regex("\\r?\\n\\r?\\n")

/** Splits a single frame into its lines (web `/\r?\n/`). */
private val LINE_DELIM: Regex = Regex("\\r?\\n")

/**
 * One typed event decoded from the explain SSE stream — the native slice of useAiStream's `AiStreamEvent`
 * union this feature consumes. Only [Delta] / [Done] / [Error] drive the rendered text + lifecycle; the
 * other wire events (`tool_call`, `tool_result`, `confirm_request`) are dropped by [parseAiSseEvent]
 * exactly as the web hook drops what it does not act on for this card.
 */
sealed interface AiStreamFrame {
    /** Web `{ type: 'delta', text }` — append [text] to the accumulated narrative. */
    data class Delta(
        val text: String,
    ) : AiStreamFrame

    /** Web `{ type: 'done' }` — the stream finished cleanly. */
    data object Done : AiStreamFrame

    /** Web `{ type: 'error', message }` — the stream failed with [message]. */
    data class Error(
        val message: String,
    ) : AiStreamFrame
}

/**
 * Reassembles raw UTF-8 chunks into whole SSE frames — the native mirror of useAiStream's read loop. A
 * fast backend may pack several blank-line-delimited frames into one chunk, or split one frame across
 * chunks, so [feed] buffers the trailing partial fragment between calls and returns only the complete
 * frames; [flush] drains any final fragment that arrived without a trailing blank line (some
 * intermediaries strip the last `\n\n`). Blank fragments are skipped (web `if (!raw.trim()) continue`).
 */
class AiSseFrameAccumulator {
    private val buffer = StringBuilder()

    /** Appends [chunk] and returns every complete frame it newly completes, keeping the trailing partial. */
    fun feed(chunk: String): List<String> {
        buffer.append(chunk)
        val parts = buffer.toString().split(FRAME_DELIM)
        buffer.setLength(0)
        buffer.append(parts.last())
        return parts.dropLast(1).filter { it.isNotBlank() }
    }

    /** Returns the buffered trailing fragment (if non-blank) and clears it — call once when the stream ends. */
    fun flush(): String? {
        val rest = buffer.toString()
        buffer.setLength(0)
        return rest.takeIf { it.isNotBlank() }
    }
}

/**
 * Parses a single SSE frame (its lines without the trailing blank line) into a typed [AiStreamFrame], or
 * `null` for a malformed / unknown frame so the loop skips it instead of corrupting the stream — the
 * native mirror of the web `parseSSEFrame` + `toTypedEvent`. A frame with no `event:` line, non-object
 * JSON, or an unrecognised event type yields `null`, so a future server event can never crash an older
 * client. [json] is the shared serializer (injected so the parse is deterministic in tests).
 */
fun parseAiSseEvent(
    rawFrame: String,
    json: Json = Json,
): AiStreamFrame? {
    var event = ""
    val dataParts = mutableListOf<String>()
    for (line in rawFrame.split(LINE_DELIM)) {
        when {
            line.startsWith(":") -> Unit
            line.startsWith("event:") -> event = line.removePrefix("event:").trimStart()
            line.startsWith("data:") -> dataParts += line.removePrefix("data:").trimStart()
            else -> Unit
        }
    }
    if (event.isEmpty()) return null
    return toTypedFrame(event, decodeJsonObject(json, dataParts.joinToString("\n")))
}

/** Narrows an `(event, data)` pair onto [AiStreamFrame], dropping unknown / dataless events (web `toTypedEvent`). */
private fun toTypedFrame(
    event: String,
    data: JsonObject?,
): AiStreamFrame? =
    when {
        data == null -> null
        event == EVENT_DELTA -> data.stringField("text")?.let { AiStreamFrame.Delta(it) }
        event == EVENT_DONE -> AiStreamFrame.Done
        event == EVENT_ERROR -> AiStreamFrame.Error(data.stringField("message") ?: AiClusteringDefaults.ERROR_UNKNOWN)
        else -> null
    }

/** Parses the joined `data:` payload into a JSON object, or `null` on an empty / malformed body (web `JSON.parse` guard). */
private fun decodeJsonObject(
    json: Json,
    raw: String,
): JsonObject? {
    if (raw.isEmpty()) return null
    return runCatching { json.parseToJsonElement(raw) }.getOrNull() as? JsonObject
}

/** Reads a JSON string field, or `null` when it is absent or not a string (web `typeof d.x !== 'string'` guard). */
private fun JsonObject.stringField(name: String): String? = (this[name] as? JsonPrimitive)?.takeIf { it.isString }?.content

// ── Diagnostics (P1/S11) ──────────────────────────────────────────────────────────────────────────

/** The stable, dot-namespaced diagnostics event emitted once when the surface opens (P1/S11). */
const val EVENT_VIEW_OPENED: String = "view.opened"

/** The structured-field key carrying the surface slug on the diagnostic. */
const val FIELD_SURFACE: String = "surface"

/**
 * Emits the one PII-safe `view.opened` diagnostic carrying only the surface
 * [AIChargingCurveFingerprintClusteringRegistration.SLUG] (P1/S11) — never a vehicle id or any streamed
 * narrative, so a diagnostics line can never leak what Helix was asked about or answered. Kept free of
 * Compose so it is unit-tested with a recording [Logger]; the ViewModel calls it once per surface open.
 */
fun recordAIChargingCurveClusteringOpened(logger: Logger) {
    logger.info(EVENT_VIEW_OPENED, mapOf(FIELD_SURFACE to AIChargingCurveFingerprintClusteringRegistration.SLUG))
}
