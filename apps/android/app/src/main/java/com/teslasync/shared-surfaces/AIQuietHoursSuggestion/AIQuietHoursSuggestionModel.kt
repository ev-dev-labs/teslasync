// Pure, framework-free model + projection for the AIQuietHoursSuggestion shared surface — the native
// analogue of everything the web component derives before it returns JSX
// (web/src/components/ai/AIQuietHoursSuggestion.tsx). No Compose, no Android, no HTTP lives here, so every
// declaration is exercised off-device by the :android:testReleaseUnitTest gate and the composable stays a
// thin render layer (ADR-002).
//
// The web component is an AIFeatureCard whose primary surface is "header + Suggest button + streamed
// output". It drives `useAiStream` against POST /ai/settings/quiet-hours/draft (empty body — the backend
// reads the user's identity from the ForwardAuth subject and applies deterministic defaults), captures a
// typed QuietHoursWindowProposal from `tool_result` frames, and surfaces an "Apply to form" affordance that
// hands the proposed scalars back to the parent QuietHoursPanel via `onApplyDraft` — the AI panel NEVER
// persists, the baseline Save button stays the sole write path. This file owns the parity-critical pieces
// that have nothing to do with Compose:
//   - the i18n by-name facade (the [StringResolver] seam) + the surface's source keys (web `t(key, …)`),
//   - the typed [QuietHoursWindowProposal] + the `tool_result` → proposal extraction (web `handleEvent`),
//   - the parameterized preview-line builder (web's `previewWindow`/`previewWeekdays`/… interpolation),
//   - the native [AiStreamEvent] union + the SSE frame parser (the consume side of web `useAiStream`),
//   - the [QuietHoursRenderState] projection covering every state the prompt mandates
//     (resting / loading / content / empty / error / stale / offline),
//   - and the PII-safe `view.opened` diagnostic (P1/S11).
//
// `InvalidPackageDeclaration`/`MatchingDeclarationName`/`filename` are suppressed because the mandated
// surface directory (com/teslasync/shared-surfaces/AIQuietHoursSuggestion — the P3 prompt's allowed-files
// path) cannot form a valid Kotlin package identifier and the file hosts several co-located declarations,
// exactly as the sibling surfaces do.
@file:Suppress("InvalidPackageDeclaration", "MatchingDeclarationName", "ktlint:standard:filename")

package io.teslasync.android.sharedsurfaces.aiquiethourssuggestion

import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.doubleOrNull

/**
 * Canonical metadata for the surface. [ID] is the web `withAiFeature('quiet-hours-suggestion', …)` feature id
 * (the per-feature AI-Off gate); [SLUG] is the diagnostics surface slug emitted with the one-shot
 * `view.opened` event (P1/S11).
 */
object AIQuietHoursSuggestionRegistration {
    /** Per-feature AI-Off gate id — mirrors the web `withAiFeature('quiet-hours-suggestion', …)` argument. */
    const val ID: String = "quiet-hours-suggestion"

    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). */
    const val SLUG: String = "AIQuietHoursSuggestion"
}

/**
 * Emits the one PII-safe `view.opened` diagnostic with the surface [AIQuietHoursSuggestionRegistration.SLUG]
 * (P1/S11). Kept free of Compose so it is unit-tested with a recording [Logger]; the view-model calls it from
 * the first-composition effect. It carries only the static slug, so a diagnostics line can never leak a
 * window, timezone, or any proposed value (ADR-016).
 */
fun recordAIQuietHoursViewOpened(logger: Logger) {
    logger.info("view.opened", mapOf("surface" to AIQuietHoursSuggestionRegistration.SLUG))
}

// ── i18n facade (web `t(key, fallback)`) ─────────────────────────────────────────────────────────────────────

/** A by-name string resolver — the P1/S10 i18n facade in production, a map/fallback in tests (web `t`). */
typealias StringResolver = (key: String, fallback: String) -> String

private val NON_IDENTIFIER = Regex("[^A-Za-z0-9_]")

/**
 * Folds a dotted i18next key into the generated Android catalog resource name (web `a.b.c` →
 * `translation_a_b_c`), matching apps/shared/i18n/generators/gen-i18n.ts `androidName`. The production
 * resolver looks this up by name and falls back to the web English when the key is absent.
 */
fun foldCatalogKey(dottedKey: String): String = "translation_" + dottedKey.replace(NON_IDENTIFIER, "_").trim('_')

/** A resolver that always returns the web English fallback — used by @Preview and the off-device unit tests. */
val FallbackResolver: StringResolver = { _, fallback -> fallback }

/**
 * The surface's i18n keys + their exact web English fallbacks. The `notifications.quietHours.aiSuggestion.*`
 * keys are lifted verbatim from web/src/i18n/en.json (the component's `t(key, default)` calls); the `helix.*`
 * keys and the native state-chrome keys (`common.*`, `mqtt.stale`, `queryError.title`) carry the same fallback
 * the catalog / shared web scaffold renders, so the rendered English is identical either way.
 */
internal object AiQuietHoursKeys {
    const val TITLE = "notifications.quietHours.aiSuggestion.title"
    const val TITLE_EN = "Suggest a quiet-hours window from your notification history"

    const val DESCRIPTION = "notifications.quietHours.aiSuggestion.description"
    const val DESCRIPTION_EN =
        "Ask Helix to recommend ONE quiet-hours window based on the trailing 30 days of your notification " +
            "cadence. Helix never reads individual notification titles or messages — it consults a per-hour " +
            "aggregate of non-critical events to find the sparsest interval. Apply the recommendation to seed " +
            "the form below; you remain in control of the Save button."

    const val BADGE = "notifications.quietHours.aiSuggestion.badge"
    const val BADGE_EN = "Helix"

    const val SUGGEST_BUTTON = "notifications.quietHours.aiSuggestion.button"
    const val SUGGEST_BUTTON_EN = "Suggest quiet hours"

    const val APPLY_BUTTON = "notifications.quietHours.aiSuggestion.applyButton"
    const val APPLY_BUTTON_EN = "Apply to form"

    const val PREVIEW_LABEL = "notifications.quietHours.aiSuggestion.previewLabel"
    const val PREVIEW_LABEL_EN = "Proposed window (review before saving):"

    const val ASK_HELIX = "helix.askHelix"
    const val ASK_HELIX_EN = "Ask Helix"

    const val THINKING = "helix.thinking"
    const val THINKING_EN = "Helix is thinking…"

    const val BADGE_ARIA = "helix.ariaLabel"
    const val BADGE_ARIA_EN = "Helix"

    const val EMPTY = "common.noData"
    const val EMPTY_EN = "No data available"

    const val ERROR_TITLE = "queryError.title"
    const val ERROR_TITLE_EN = "Failed to load data"

    const val RETRY = "common.retry"
    const val RETRY_EN = "Retry"

    const val OFFLINE = "common.offline"
    const val OFFLINE_EN = "Offline"

    const val STALE = "mqtt.stale"
    const val STALE_EN = "Stale"
}

/** The fully-resolved display strings the composable paints — resolved off-device so i18n is unit-testable. */
@Suppress("LongParameterList")
data class AiQuietHoursLabels(
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
    val errorTitle: String,
    val retry: String,
    val offline: String,
    val stale: String,
)

/** Resolves every static surface label through [resolve], folding the web `t(key, fallback)` calls into one value. */
fun aiQuietHoursLabels(resolve: StringResolver): AiQuietHoursLabels =
    AiQuietHoursLabels(
        title = resolve(AiQuietHoursKeys.TITLE, AiQuietHoursKeys.TITLE_EN),
        description = resolve(AiQuietHoursKeys.DESCRIPTION, AiQuietHoursKeys.DESCRIPTION_EN),
        badge = resolve(AiQuietHoursKeys.BADGE, AiQuietHoursKeys.BADGE_EN),
        badgeAria = resolve(AiQuietHoursKeys.BADGE_ARIA, AiQuietHoursKeys.BADGE_ARIA_EN),
        suggestButton = resolve(AiQuietHoursKeys.SUGGEST_BUTTON, AiQuietHoursKeys.SUGGEST_BUTTON_EN),
        applyButton = resolve(AiQuietHoursKeys.APPLY_BUTTON, AiQuietHoursKeys.APPLY_BUTTON_EN),
        previewLabel = resolve(AiQuietHoursKeys.PREVIEW_LABEL, AiQuietHoursKeys.PREVIEW_LABEL_EN),
        askHelix = resolve(AiQuietHoursKeys.ASK_HELIX, AiQuietHoursKeys.ASK_HELIX_EN),
        thinking = resolve(AiQuietHoursKeys.THINKING, AiQuietHoursKeys.THINKING_EN),
        empty = resolve(AiQuietHoursKeys.EMPTY, AiQuietHoursKeys.EMPTY_EN),
        errorTitle = resolve(AiQuietHoursKeys.ERROR_TITLE, AiQuietHoursKeys.ERROR_TITLE_EN),
        retry = resolve(AiQuietHoursKeys.RETRY, AiQuietHoursKeys.RETRY_EN),
        offline = resolve(AiQuietHoursKeys.OFFLINE, AiQuietHoursKeys.OFFLINE_EN),
        stale = resolve(AiQuietHoursKeys.STALE, AiQuietHoursKeys.STALE_EN),
    )

/**
 * The Suggest button's accessible name — the native mirror of the web AIFeatureCard `aria-label`
 * (`"${askHelix} · ${buttonLabel}"`), so TalkBack announces the contextual Helix verb, not just "Ask Helix".
 */
fun suggestButtonContentDescription(resolve: StringResolver): String {
    val labels = aiQuietHoursLabels(resolve)
    return "${labels.askHelix} · ${labels.suggestButton}"
}

// ── Parameterized preview strings (web `t(key, fallback, { named })`) ─────────────────────────────────────────

/**
 * The five parameterized preview strings the captured proposal renders, with their dotted catalog keys, the
 * verbatim web English templates (`{{token}}` interpolation), and the ordered token names. The view resolves
 * each against the generated Android positional catalog (`%1$s`/`%2$s`/…); [FallbackPreviewProvider] fills the
 * `{{token}}` template for @Preview + off-device tests so the rendered text matches the web either way.
 */
enum class QuietHoursPreviewKey(
    val dottedKey: String,
    val fallbackTemplate: String,
    val tokens: List<String>,
) {
    Window(
        "notifications.quietHours.aiSuggestion.previewWindow",
        "Window: {{start}} → {{end}} ({{tz}})",
        listOf("start", "end", "tz"),
    ),
    Weekdays(
        "notifications.quietHours.aiSuggestion.previewWeekdays",
        "Weekday bitmask: {{weekdays}}",
        listOf("weekdays"),
    ),
    Bypass(
        "notifications.quietHours.aiSuggestion.previewBypass",
        "Bypass severities: {{severities}}",
        listOf("severities"),
    ),
    InsufficientHistory(
        "notifications.quietHours.aiSuggestion.previewInsufficientHistory",
        "Helix had insufficient notification history; this is a conservative default.",
        emptyList(),
    ),
    ExistingCount(
        "notifications.quietHours.aiSuggestion.previewExistingCount",
        "You already have {{count}} quiet-hours window(s) configured.",
        listOf("count"),
    ),
}

/**
 * Resolves a parameterized preview string by [QuietHoursPreviewKey] with positional [args] — the view backs
 * this with `context.getString` over the Android catalog; @Preview + tests use [FallbackPreviewProvider].
 */
fun interface PreviewStringProvider {
    fun format(
        key: QuietHoursPreviewKey,
        args: List<String>,
    ): String
}

/** Off-device provider: fills the web `{{token}}` template — used by @Preview and the unit tests. */
val FallbackPreviewProvider: PreviewStringProvider =
    PreviewStringProvider { key, args ->
        var out = key.fallbackTemplate
        key.tokens.forEachIndexed { index, token -> out = out.replace("{{$token}}", args.getOrElse(index) { "" }) }
        out
    }

/** The semantic tone of a preview line — secondary copy, or the amber caveat (web `text-amber-300`). */
enum class PreviewTone { Secondary, Warning }

/** One rendered preview line — the already-formatted [text] plus its display [tone]. */
data class QuietHoursPreviewLine(
    val text: String,
    val tone: PreviewTone,
)

/**
 * Builds the captured-proposal preview lines in the web component's exact order via [provider]: the window,
 * the weekday bitmask, and the bypass severities (always), then the insufficient-history caveat (only when the
 * tool flagged it) and the existing-window count (only when > 0). Pure so the conditional lines are unit-tested
 * off-device.
 */
fun quietHoursPreviewLines(
    proposal: QuietHoursWindowProposal,
    provider: PreviewStringProvider,
): List<QuietHoursPreviewLine> =
    buildList {
        add(
            QuietHoursPreviewLine(
                provider.format(
                    QuietHoursPreviewKey.Window,
                    listOf(proposal.startLocal, proposal.endLocal, proposal.timezone),
                ),
                PreviewTone.Secondary,
            ),
        )
        add(
            QuietHoursPreviewLine(
                provider.format(QuietHoursPreviewKey.Weekdays, listOf(proposal.weekdays.toString())),
                PreviewTone.Secondary,
            ),
        )
        add(
            QuietHoursPreviewLine(
                provider.format(QuietHoursPreviewKey.Bypass, listOf(proposal.bypassSeverities.joinToString(", "))),
                PreviewTone.Secondary,
            ),
        )
        if (proposal.status == STATUS_INSUFFICIENT_HISTORY) {
            add(
                QuietHoursPreviewLine(
                    provider.format(QuietHoursPreviewKey.InsufficientHistory, emptyList()),
                    PreviewTone.Warning,
                ),
            )
        }
        if (proposal.existingWindowsCount > 0) {
            add(
                QuietHoursPreviewLine(
                    provider.format(
                        QuietHoursPreviewKey.ExistingCount,
                        listOf(proposal.existingWindowsCount.toString()),
                    ),
                    PreviewTone.Secondary,
                ),
            )
        }
    }

// ── Proposed window (web `QuietHoursDraftProposal`) + apply patch (web `QuietHoursWindowInput`) ───────────────

/**
 * The typed envelope Helix proposes — the native mirror of the web `QuietHoursDraftProposal`. Only the fields
 * the baseline form consumes are carried, keeping the panel from overwriting fields the user did not consent
 * to changing. [weekdays] is a 7-bit weekday bitmask; [status] is `"ok"` or `"insufficient_history"`.
 */
data class QuietHoursWindowProposal(
    val startLocal: String,
    val endLocal: String,
    val timezone: String,
    val weekdays: Int,
    val bypassSeverities: List<String>,
    val status: String,
    val existingWindowsCount: Int,
)

/**
 * The patch handed to the parent QuietHoursPanel on "Apply to form" — the native mirror of the web
 * `QuietHoursWindowInput` payload. The AI panel never writes the API; the user clicks the canonical Save
 * button next.
 */
data class QuietHoursWindowInput(
    val enabled: Boolean,
    val startLocal: String,
    val endLocal: String,
    val timezone: String,
    val weekdays: Int,
    val bypassSeverities: List<String>,
)

/** Copies the proposed scalars into the apply patch with `enabled = true` (web `handleApply`). */
fun QuietHoursWindowProposal.toInput(): QuietHoursWindowInput =
    QuietHoursWindowInput(
        enabled = true,
        startLocal = startLocal,
        endLocal = endLocal,
        timezone = timezone,
        weekdays = weekdays,
        bypassSeverities = bypassSeverities,
    )

/** Web default for a non-string / absent `status` field (`typeof data.status === 'string' ? … : 'ok'`). */
const val STATUS_OK: String = "ok"

/** The `status` value that surfaces the amber conservative-default caveat (web `previewInsufficientHistory`). */
const val STATUS_INSUFFICIENT_HISTORY: String = "insufficient_history"

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

/** The tool whose `tool_result` carries the typed window (web `name === 'draft_quiet_hours_window'`). */
const val DRAFT_TOOL_NAME: String = "draft_quiet_hours_window"

/**
 * Captures the proposed [QuietHoursWindowProposal] from a `tool_result` event — the native mirror of the web
 * `handleEvent`. Returns `null` for any event that is not an OK `draft_quiet_hours_window` result, or whose
 * payload is missing a required typed field (`start_local`/`end_local`/`timezone` strings, a numeric
 * `weekdays`, an array `bypass_severities`) — exactly matching the web guards. Unlike the alert-tuning tool,
 * the window scalars sit DIRECTLY on `data` (there is no `proposed` wrapper).
 */
fun extractQuietHoursProposal(event: AiStreamEvent): QuietHoursWindowProposal? {
    val data = (event as? AiStreamEvent.ToolResult)?.windowObject() ?: return null
    return parseProposal(data)
}

/** The OK `draft_quiet_hours_window` result's `data` object, or `null` for any other / !ok frame. */
private fun AiStreamEvent.ToolResult.windowObject(): JsonObject? {
    if (name != DRAFT_TOOL_NAME || !ok) return null
    return data as? JsonObject
}

/**
 * Reads the typed window scalars off the tool-result `data` object (web's typed
 * `start_local`/`weekdays`/`bypass_severities` narrowing). Returns `null` when any required field is missing or
 * the wrong type, mirroring the web guard's early return. The multiple guard clauses are intentional, so
 * [ReturnCount] is suppressed.
 */
@Suppress("ReturnCount")
fun parseProposal(data: JsonObject): QuietHoursWindowProposal? {
    val startLocal = data.stringField("start_local") ?: return null
    val endLocal = data.stringField("end_local") ?: return null
    val timezone = data.stringField("timezone") ?: return null
    val weekdays = data.numberField("weekdays")?.toInt() ?: return null
    val bypass = (data["bypass_severities"] as? JsonArray)?.toStringList() ?: return null
    return QuietHoursWindowProposal(
        startLocal = startLocal,
        endLocal = endLocal,
        timezone = timezone,
        weekdays = weekdays,
        bypassSeverities = bypass,
        status = data.stringField("status") ?: STATUS_OK,
        existingWindowsCount = data.numberField("existing_windows_count")?.toInt() ?: 0,
    )
}

/** The string elements of a `bypass_severities` array — non-string entries dropped (web `.filter`). */
private fun JsonArray.toStringList(): List<String> = filterIsInstance<JsonPrimitive>().filter { it.isString }.map { it.content }

// ── SSE frame parser (the consume side of web `useAiStream`: parseSSEFrame + toTypedEvent) ───────────────────

private val SSE_LINE = Regex("\\r?\\n")

/**
 * Parses one blank-line-delimited SSE block into a typed [AiStreamEvent] — a faithful port of the web
 * `parseSSEFrame` + `toTypedEvent`. Returns `null` for a frame with no `event:` line, malformed JSON, or an
 * unknown/under-specified event type, so a transport can skip it instead of corrupting the stream (and a
 * future server adding a new event type cannot crash an older client).
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
    val proposal: QuietHoursWindowProposal? = null,
    val streamedText: String = "",
    val errorMessage: String? = null,
    val limit: AiLimitInfo? = null,
)

/** The mutually-exclusive surface the composable renders — the prompt's mandated state set + the resting card. */
enum class QuietHoursRenderState { Resting, Loading, Content, Empty, Error, Stale, Offline }

/**
 * The immutable snapshot the composable paints. [canStart] mirrors the web `canStart` prop
 * (`state !== 'paused-confirm'`, plus connectivity); [isBusy] disables the Suggest button while a stream is in
 * flight (web `streaming || paused-confirm`). [proposal] is retained across refresh/offline so the last-known
 * window is never blanked — it is flagged [stale], never hidden.
 */
@Suppress("LongParameterList")
data class QuietHoursSnapshot(
    val renderState: QuietHoursRenderState,
    val phase: AiStreamPhase,
    val proposal: QuietHoursWindowProposal?,
    val streamedText: String,
    val canStart: Boolean,
    val isBusy: Boolean,
    val errorMessage: String?,
    val limit: AiLimitInfo?,
    val offline: Boolean,
    val stale: Boolean,
)

/**
 * Projects the stream [runtime] + connectivity onto a [QuietHoursSnapshot] — the single, side-effect-free
 * place the prompt's render states are derived, so the composable only paints:
 *  - `online == false` ⇒ Offline (last-known [StreamRuntime.proposal] kept visible, suggest disabled);
 *  - a terminal error classified as a connectivity failure ⇒ Offline, any other error ⇒ Error (+ retry);
 *  - streaming with a previously-captured proposal ⇒ Stale (refreshing over last-known), otherwise Loading;
 *  - `paused-confirm` ⇒ Loading (still in flight);
 *  - a captured proposal or streamed replay text ⇒ Content;
 *  - nothing requested yet ⇒ Resting (the inviting card); everything resolved with nothing to show ⇒ Empty.
 */
fun projectQuietHours(
    runtime: StreamRuntime,
    online: Boolean,
): QuietHoursSnapshot {
    val busy = runtime.phase == AiStreamPhase.Streaming || runtime.phase == AiStreamPhase.PausedConfirm
    val canStart = runtime.phase != AiStreamPhase.PausedConfirm && online
    val renderState = renderStateFor(runtime, online)
    val offline = renderState == QuietHoursRenderState.Offline
    val stale = renderState == QuietHoursRenderState.Stale || (offline && runtime.proposal != null)
    return QuietHoursSnapshot(
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
 * [projectQuietHours] so each function stays within the cyclomatic-complexity budget.
 */
private fun renderStateFor(
    runtime: StreamRuntime,
    online: Boolean,
): QuietHoursRenderState {
    val networkError =
        runtime.phase == AiStreamPhase.Error && isNetworkFailure(runtime.limit?.reason, runtime.errorMessage)
    return when {
        !online -> QuietHoursRenderState.Offline
        networkError -> QuietHoursRenderState.Offline
        runtime.phase == AiStreamPhase.Error -> QuietHoursRenderState.Error
        runtime.phase == AiStreamPhase.Streaming && runtime.proposal != null -> QuietHoursRenderState.Stale
        runtime.phase == AiStreamPhase.Streaming -> QuietHoursRenderState.Loading
        runtime.phase == AiStreamPhase.PausedConfirm -> QuietHoursRenderState.Loading
        runtime.proposal != null -> QuietHoursRenderState.Content
        runtime.streamedText.isNotBlank() -> QuietHoursRenderState.Content
        runtime.phase == AiStreamPhase.Idle -> QuietHoursRenderState.Resting
        else -> QuietHoursRenderState.Empty
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
