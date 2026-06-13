// Pure, framework-free model + projection for the AICrossRuleConflictDetection shared surface — the native
// analogue of everything the web component derives before it returns JSX
// (web/src/components/ai/AICrossRuleConflictDetection.tsx). No Compose, no Android, no HTTP lives here, so every
// declaration is exercised off-device by the :app:testReleaseUnitTest gate and the composable stays a thin
// render layer (ADR-002).
//
// The web component is an AIFeatureCard whose primary surface is "header + Detect button + streamed output". It
// drives `useAiStream` against POST /ai/alerts/rules/conflicts, captures a typed RuleConflict[] from the
// `detect_rule_conflicts` tool_result frame, and renders each conflict with two "Review rule {id}" affordances
// that hand the offending rule back to the parent AlertStudio editor via `onSelectRule` (the AI panel NEVER
// persists — the baseline editor's Save button stays the sole write path). This file owns the parity-critical
// pieces that have nothing to do with Compose:
//   - the i18n by-name facade (the [StringResolver] seam) + the surface's source keys (web `t(key, …)`),
//   - the typed [RuleConflict] + the `tool_result` → conflicts extraction (web `handleEvent`),
//   - the native [AiStreamEvent] union + the SSE frame parser (the consume side of web `useAiStream`),
//   - the [AiConflictsRenderState] projection covering every state the prompt mandates
//     (loading / content / empty / error / stale / offline),
//   - and the PII-safe `view.opened` diagnostic (P1/S11).
//
// `InvalidPackageDeclaration`/`MatchingDeclarationName`/`filename` are suppressed because the mandated surface
// directory (com/teslasync/shared-surfaces/AICrossRuleConflictDetection — the P3 prompt's allowed-files path)
// cannot form a valid Kotlin package identifier and the file hosts several co-located declarations, exactly as
// the sibling surfaces do.
@file:Suppress("InvalidPackageDeclaration", "MatchingDeclarationName", "ktlint:standard:filename")

package io.teslasync.android.sharedsurfaces.aicrossruleconflictdetection

import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.doubleOrNull
import kotlinx.serialization.json.longOrNull

/** Fewer than two rules can never structurally conflict — the web `ruleIds.length < 2` disable guard. */
const val MIN_RULE_COUNT: Int = 2

/**
 * Canonical metadata for the surface. [ID] is the web `withAiFeature('cross-rule-conflict-detection', …)`
 * feature id (the per-feature AI-Off gate, ADR-015 §I5); [SLUG] is the diagnostics surface slug emitted with the
 * one-shot `view.opened` event (P1/S11).
 */
object AICrossRuleConflictDetectionRegistration {
    /** Per-feature AI-Off gate id — mirrors the web `withAiFeature('cross-rule-conflict-detection', …)` arg. */
    const val ID: String = "cross-rule-conflict-detection"

    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). */
    const val SLUG: String = "AICrossRuleConflictDetection"
}

/**
 * Emits the one PII-safe `view.opened` diagnostic with the surface
 * [AICrossRuleConflictDetectionRegistration.SLUG] (P1/S11). Kept free of Compose so it is unit-tested with a
 * recording [Logger]; the view-model calls it from the first-composition effect. It carries only the static
 * slug, so a diagnostics line can never leak a rule id, vehicle, or any conflict detail (ADR-016).
 */
fun recordAIConflictsViewOpened(logger: Logger) {
    logger.info("view.opened", mapOf("surface" to AICrossRuleConflictDetectionRegistration.SLUG))
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
 * The surface's i18n keys + their exact web English fallbacks. The `notifications.alertStudio.aiConflicts.*` keys
 * are lifted verbatim from web/src/i18n/en.json (the component's `t(key, default)` calls); the `helix.*` /
 * `common.*` keys and the native state-chrome / flag-chip keys carry the same English the shared web scaffold
 * (`AIFeatureCard` / `AiOutputPanel`) and the component's inline chip literals render, so the painted English is
 * identical whether or not the catalog defines them.
 */
internal object AiConflictsKeys {
    const val TITLE = "notifications.alertStudio.aiConflicts.title"
    const val TITLE_EN = "Detect cross-rule conflicts"

    const val DESCRIPTION = "notifications.alertStudio.aiConflicts.description"
    const val DESCRIPTION_EN =
        "Surface structural overlaps between your alert rule definitions. " +
            "Review only — Helix never edits, merges, or deletes rules."

    const val BADGE = "notifications.alertStudio.aiConflicts.badge"
    const val BADGE_EN = "Helix"

    const val DETECT_BUTTON = "notifications.alertStudio.aiConflicts.detectButton"
    const val DETECT_BUTTON_EN = "Detect conflicts"

    const val REVIEW_BUTTON = "notifications.alertStudio.aiConflicts.reviewButton"
    const val REVIEW_BUTTON_EN = "Review rule"

    const val EMPTY_MESSAGE = "notifications.alertStudio.aiConflicts.emptyMessage"
    const val EMPTY_MESSAGE_EN = "No structural conflicts found in the current rule set."

    const val KIND_REDUNDANT = "notifications.alertStudio.aiConflicts.kind.redundant_duplicate"
    const val KIND_REDUNDANT_EN = "Redundant duplicate"

    const val KIND_OVERLAPPING = "notifications.alertStudio.aiConflicts.kind.overlapping_threshold"
    const val KIND_OVERLAPPING_EN = "Overlapping threshold"

    // Native chrome (fallback-resolved; mirrors the shared AIFeatureCard / AiOutputPanel English).
    const val ASK_HELIX = "helix.askHelix"
    const val ASK_HELIX_EN = "Ask Helix"

    const val THINKING = "helix.thinking"
    const val THINKING_EN = "Helix is thinking…"

    const val BADGE_ARIA = "helix.ariaLabel"
    const val BADGE_ARIA_EN = "Helix"

    const val RETRY = "common.retry"
    const val RETRY_EN = "Retry"

    const val ERROR_TITLE = "notifications.alertStudio.aiConflicts.errorTitle"
    const val ERROR_TITLE_EN = "Couldn't detect conflicts"

    const val OFFLINE = "notifications.alertStudio.aiConflicts.offline"
    const val OFFLINE_EN = "You're offline. Showing the last detected conflicts, if any."

    const val STALE = "notifications.alertStudio.aiConflicts.stale"
    const val STALE_EN = "Last result — refreshing…"

    const val WAITING = "notifications.alertStudio.aiConflicts.waiting"
    const val WAITING_EN = "Select at least two rules to let Helix detect cross-rule conflicts."

    // The conflict label prefix + flag chips (web inline literals, routed through the facade so no English
    // literal lives in native code — they resolve to these exact strings via fallback).
    const val RULE_PREFIX = "notifications.alertStudio.aiConflicts.rulePrefix"
    const val RULE_PREFIX_EN = "Rule"

    const val FLAG_SUBSUMES = "notifications.alertStudio.aiConflicts.flags.subsumes"
    const val FLAG_SUBSUMES_EN = "subsumes"

    const val FLAG_SEVERITY = "notifications.alertStudio.aiConflicts.flags.severityMismatch"
    const val FLAG_SEVERITY_EN = "severity mismatch"

    const val FLAG_COOLDOWN = "notifications.alertStudio.aiConflicts.flags.cooldownMismatch"
    const val FLAG_COOLDOWN_EN = "cooldown mismatch"

    const val FLAG_TRIGGER = "notifications.alertStudio.aiConflicts.flags.triggerModeMismatch"
    const val FLAG_TRIGGER_EN = "trigger mode mismatch"
}

/** Wire kind discriminators (web `kind === 'redundant_duplicate'` / `'overlapping_threshold'`). */
internal object ConflictKind {
    const val REDUNDANT_DUPLICATE = "redundant_duplicate"
    const val OVERLAPPING_THRESHOLD = "overlapping_threshold"
}

/** The fully-resolved display strings the composable paints — resolved off-device so i18n is unit-testable. */
@Suppress("LongParameterList")
data class AiConflictsLabels(
    val title: String,
    val description: String,
    val badge: String,
    val badgeAria: String,
    val detectButton: String,
    val reviewButton: String,
    val askHelix: String,
    val thinking: String,
    val emptyMessage: String,
    val waiting: String,
    val errorTitle: String,
    val retry: String,
    val offline: String,
    val stale: String,
    val rulePrefix: String,
    val kindRedundant: String,
    val kindOverlapping: String,
    val flagSubsumes: String,
    val flagSeverity: String,
    val flagCooldown: String,
    val flagTrigger: String,
)

/** Resolves every surface label through [resolve], folding the web `t(key, fallback)` calls into one value. */
fun aiConflictsLabels(resolve: StringResolver): AiConflictsLabels =
    AiConflictsLabels(
        title = resolve(AiConflictsKeys.TITLE, AiConflictsKeys.TITLE_EN),
        description = resolve(AiConflictsKeys.DESCRIPTION, AiConflictsKeys.DESCRIPTION_EN),
        badge = resolve(AiConflictsKeys.BADGE, AiConflictsKeys.BADGE_EN),
        badgeAria = resolve(AiConflictsKeys.BADGE_ARIA, AiConflictsKeys.BADGE_ARIA_EN),
        detectButton = resolve(AiConflictsKeys.DETECT_BUTTON, AiConflictsKeys.DETECT_BUTTON_EN),
        reviewButton = resolve(AiConflictsKeys.REVIEW_BUTTON, AiConflictsKeys.REVIEW_BUTTON_EN),
        askHelix = resolve(AiConflictsKeys.ASK_HELIX, AiConflictsKeys.ASK_HELIX_EN),
        thinking = resolve(AiConflictsKeys.THINKING, AiConflictsKeys.THINKING_EN),
        emptyMessage = resolve(AiConflictsKeys.EMPTY_MESSAGE, AiConflictsKeys.EMPTY_MESSAGE_EN),
        waiting = resolve(AiConflictsKeys.WAITING, AiConflictsKeys.WAITING_EN),
        errorTitle = resolve(AiConflictsKeys.ERROR_TITLE, AiConflictsKeys.ERROR_TITLE_EN),
        retry = resolve(AiConflictsKeys.RETRY, AiConflictsKeys.RETRY_EN),
        offline = resolve(AiConflictsKeys.OFFLINE, AiConflictsKeys.OFFLINE_EN),
        stale = resolve(AiConflictsKeys.STALE, AiConflictsKeys.STALE_EN),
        rulePrefix = resolve(AiConflictsKeys.RULE_PREFIX, AiConflictsKeys.RULE_PREFIX_EN),
        kindRedundant = resolve(AiConflictsKeys.KIND_REDUNDANT, AiConflictsKeys.KIND_REDUNDANT_EN),
        kindOverlapping = resolve(AiConflictsKeys.KIND_OVERLAPPING, AiConflictsKeys.KIND_OVERLAPPING_EN),
        flagSubsumes = resolve(AiConflictsKeys.FLAG_SUBSUMES, AiConflictsKeys.FLAG_SUBSUMES_EN),
        flagSeverity = resolve(AiConflictsKeys.FLAG_SEVERITY, AiConflictsKeys.FLAG_SEVERITY_EN),
        flagCooldown = resolve(AiConflictsKeys.FLAG_COOLDOWN, AiConflictsKeys.FLAG_COOLDOWN_EN),
        flagTrigger = resolve(AiConflictsKeys.FLAG_TRIGGER, AiConflictsKeys.FLAG_TRIGGER_EN),
    )

/**
 * The Detect button's accessible name — the native mirror of the web AIFeatureCard `aria-label`
 * (`"${askHelix} · ${buttonLabel}"`), so TalkBack announces the contextual Helix verb, not just "Ask Helix".
 */
fun detectButtonContentDescription(resolve: StringResolver): String {
    val labels = aiConflictsLabels(resolve)
    return "${labels.askHelix} · ${labels.detectButton}"
}

// ── Captured conflict (web `RuleConflict`) ───────────────────────────────────────────────────────────────────

/**
 * One structural conflict between two alert rules — the native mirror of the web `RuleConflict` envelope
 * returned by the `detect_rule_conflicts` tool. Kept narrow so the panel only renders the fields it uses; the
 * boolean mismatch flags drive the severity chips and the names/signal/reason drive the descriptive subtitle.
 */
@Suppress("LongParameterList")
data class RuleConflict(
    val kind: String,
    val ruleAId: Long,
    val ruleBId: Long,
    val ruleAName: String? = null,
    val ruleBName: String? = null,
    val signalName: String? = null,
    val reason: String? = null,
    val severityMismatch: Boolean = false,
    val cooldownMismatch: Boolean = false,
    val triggerModeMismatch: Boolean = false,
    val subsumes: Boolean = false,
) {
    /** A stable list key (web `key={`${c.kind}:${c.rule_a_id}:${c.rule_b_id}`}`). */
    val rowKey: String get() = "$kind:$ruleAId:$ruleBId"
}

/** Severity intent of a conflict flag chip — amber for "subsumes", rose for a hard mismatch (web colors). */
enum class ConflictChipTone { Amber, Rose }

/** A single flag chip rendered under a conflict (web's `subsumes` / `… mismatch` pills). */
data class ConflictChip(
    val text: String,
    val tone: ConflictChipTone,
)

/** The kind label (web `labelForKind`): the localized name for a known kind, else the raw wire discriminator. */
fun labelForKind(
    kind: String,
    labels: AiConflictsLabels,
): String =
    when (kind) {
        ConflictKind.REDUNDANT_DUPLICATE -> labels.kindRedundant
        ConflictKind.OVERLAPPING_THRESHOLD -> labels.kindOverlapping
        else -> kind
    }

/**
 * The descriptive subtitle for a conflict (web `Rule {a}{(name)} ↔ Rule {b}{(name)}{ · signal}`). Names and the
 * signal suffix are appended only when present, exactly matching the web's truthy guards.
 */
fun conflictPairLine(
    conflict: RuleConflict,
    rulePrefix: String,
): String {
    val left = "$rulePrefix ${conflict.ruleAId}" + (conflict.ruleAName?.let { " ($it)" } ?: "")
    val right = "$rulePrefix ${conflict.ruleBId}" + (conflict.ruleBName?.let { " ($it)" } ?: "")
    val signal = conflict.signalName?.let { " · $it" } ?: ""
    return "$left ↔ $right$signal"
}

/** The "Review rule {id}" affordance label (web `{reviewButton} {id}`). */
fun reviewRuleLabel(
    labels: AiConflictsLabels,
    ruleId: Long,
): String = "${labels.reviewButton} $ruleId"

/** The flag chips to render for a conflict, in the web component's order (subsumes, then the mismatches). */
fun conflictChips(
    conflict: RuleConflict,
    labels: AiConflictsLabels,
): List<ConflictChip> =
    buildList {
        if (conflict.subsumes) add(ConflictChip(labels.flagSubsumes, ConflictChipTone.Amber))
        if (conflict.severityMismatch) add(ConflictChip(labels.flagSeverity, ConflictChipTone.Rose))
        if (conflict.cooldownMismatch) add(ConflictChip(labels.flagCooldown, ConflictChipTone.Rose))
        if (conflict.triggerModeMismatch) add(ConflictChip(labels.flagTrigger, ConflictChipTone.Rose))
    }

// ── AI stream event model (native mirror of web `useAiStream`'s AiStreamEvent union) ─────────────────────────

/** The lifecycle of the detection stream — the native mirror of the web `AiStreamState`. */
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

/** The tool whose `tool_result` carries the typed conflict list (web `name === 'detect_rule_conflicts'`). */
const val DETECT_TOOL_NAME: String = "detect_rule_conflicts"

/**
 * Captures the conflict list from a `tool_result` event — the native mirror of the web `handleEvent`. Returns
 * `null` for any event that is not an OK `detect_rule_conflicts` result with a `conflicts` array (web returns
 * without calling `setConflicts`); a present-but-empty `conflicts` array yields an empty list (web still calls
 * `setConflicts([])` so the "no conflicts found" state renders). Malformed rows are skipped per web's guards.
 */
fun extractConflicts(event: AiStreamEvent): List<RuleConflict>? {
    val array = (event as? AiStreamEvent.ToolResult)?.conflictsArray() ?: return null
    return array.mapNotNull { element -> (element as? JsonObject)?.let(::parseConflict) }
}

/** The OK `detect_rule_conflicts` result's `conflicts` array, or `null` for any other / !ok / non-array frame. */
private fun AiStreamEvent.ToolResult.conflictsArray(): JsonArray? {
    val data = (this.data as? JsonObject)?.takeIf { name == DETECT_TOOL_NAME && ok } ?: return null
    return data["conflicts"] as? JsonArray
}

/** Reads one conflict off a `conflicts[]` element (web's typed `rule_a_id`/`kind`/… narrowing). */
fun parseConflict(obj: JsonObject): RuleConflict? {
    val ruleAId = obj.longField("rule_a_id")
    val ruleBId = obj.longField("rule_b_id")
    val kind = obj.stringField("kind")
    if (ruleAId == null || ruleBId == null || kind == null) return null
    return RuleConflict(
        kind = kind,
        ruleAId = ruleAId,
        ruleBId = ruleBId,
        ruleAName = obj.nonEmptyStringField("rule_a_name"),
        ruleBName = obj.nonEmptyStringField("rule_b_name"),
        signalName = obj.nonEmptyStringField("signal_name"),
        reason = obj.nonEmptyStringField("reason"),
        severityMismatch = obj.boolField("severity_mismatch"),
        cooldownMismatch = obj.boolField("cooldown_mismatch"),
        triggerModeMismatch = obj.boolField("trigger_mode_mismatch"),
        subsumes = obj.boolField("subsumes"),
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

/** The rule set + optional vehicle the stream targets (web `ruleIds` / `vehicleId` props). */
data class RulesTarget(
    val ruleIds: List<Long>,
    val vehicleId: Long?,
)

/**
 * The mutable runtime the view-model folds the stream into. Kept as one value so the projection takes a single
 * argument (and the view re-renders atomically): the stream [phase], the last captured [conflicts] (`null` until
 * a `tool_result` arrives — distinct from an empty list = "detected, none"), the accumulated descriptive-replay
 * [streamedText], and the terminal [errorMessage]/[limit].
 */
data class StreamRuntime(
    val phase: AiStreamPhase = AiStreamPhase.Idle,
    val conflicts: List<RuleConflict>? = null,
    val streamedText: String = "",
    val errorMessage: String? = null,
    val limit: AiLimitInfo? = null,
)

/** The mutually-exclusive surface the composable renders — the prompt's mandated state set. */
enum class AiConflictsRenderState { Loading, Content, Empty, Error, Stale, Offline }

/**
 * The immutable snapshot the composable paints. [canStart] mirrors the web `canStart` prop
 * (`ruleIds.length >= 2 && state !== 'paused-confirm'`, plus connectivity); [isBusy] disables the Detect button
 * while a stream is in flight (web `streaming || paused-confirm`). [conflicts] is retained across refresh/offline
 * so the last-known list is never blanked — it is flagged [stale], never hidden. [hasResult] distinguishes a
 * resolved-but-empty result ("no conflicts found") from the pre-detection waiting state.
 */
@Suppress("LongParameterList")
data class AiConflictsSnapshot(
    val renderState: AiConflictsRenderState,
    val phase: AiStreamPhase,
    val conflicts: List<RuleConflict>,
    val hasResult: Boolean,
    val streamedText: String,
    val canStart: Boolean,
    val isBusy: Boolean,
    val errorMessage: String?,
    val limit: AiLimitInfo?,
    val offline: Boolean,
    val stale: Boolean,
)

/**
 * Projects the rule count + stream [runtime] + connectivity onto an [AiConflictsSnapshot] — the single,
 * side-effect-free place the prompt's six render states are derived, so the composable only paints:
 *  - `online == false` ⇒ Offline (last-known [StreamRuntime.conflicts] kept visible, detect disabled);
 *  - a terminal error classified as a connectivity failure ⇒ Offline, any other error ⇒ Error (+ retry);
 *  - streaming with a previously-captured non-empty list ⇒ Stale (refreshing over last-known), else Loading;
 *  - a captured non-empty list (or streamed replay text) ⇒ Content;
 *  - everything resolved with nothing to show ⇒ Empty (with the "no conflicts" or "waiting" copy).
 */
fun projectAiConflicts(
    ruleCount: Int,
    runtime: StreamRuntime,
    online: Boolean,
): AiConflictsSnapshot {
    val busy = runtime.phase == AiStreamPhase.Streaming || runtime.phase == AiStreamPhase.PausedConfirm
    val canStart = ruleCount >= MIN_RULE_COUNT && runtime.phase != AiStreamPhase.PausedConfirm && online
    val renderState = renderStateFor(runtime, online)
    val offline = renderState == AiConflictsRenderState.Offline
    val captured = runtime.conflicts
    val stale =
        renderState == AiConflictsRenderState.Stale || (offline && !captured.isNullOrEmpty())
    return AiConflictsSnapshot(
        renderState = renderState,
        phase = runtime.phase,
        conflicts = captured ?: emptyList(),
        hasResult = captured != null,
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
 * [projectAiConflicts] so each function stays within the cyclomatic-complexity budget.
 */
private fun renderStateFor(
    runtime: StreamRuntime,
    online: Boolean,
): AiConflictsRenderState {
    val captured = runtime.conflicts
    val hasRows = !captured.isNullOrEmpty()
    val streaming = runtime.phase == AiStreamPhase.Streaming || runtime.phase == AiStreamPhase.PausedConfirm
    val networkError =
        runtime.phase == AiStreamPhase.Error && isNetworkFailure(runtime.limit?.reason, runtime.errorMessage)
    return when {
        !online -> AiConflictsRenderState.Offline
        networkError -> AiConflictsRenderState.Offline
        runtime.phase == AiStreamPhase.Error -> AiConflictsRenderState.Error
        streaming && hasRows -> AiConflictsRenderState.Stale
        streaming -> AiConflictsRenderState.Loading
        hasRows -> AiConflictsRenderState.Content
        captured != null -> AiConflictsRenderState.Empty
        runtime.streamedText.isNotBlank() -> AiConflictsRenderState.Content
        else -> AiConflictsRenderState.Empty
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

/** Reads [key] as an integral id, only when it is a non-string JSON number (web `typeof === 'number'`). */
private fun JsonObject.longField(key: String): Long? {
    val primitive = (this[key] as? JsonPrimitive)?.takeUnless { it.isString } ?: return null
    return primitive.longOrNull ?: primitive.doubleOrNull?.toLong()
}

/** Reads [key] as a string primitive, allowing the empty string (web `typeof === 'string'`). */
private fun JsonObject.stringField(key: String): String? {
    val primitive = this[key] as? JsonPrimitive ?: return null
    return if (primitive.isString) primitive.content else null
}

/** Reads [key] as a non-empty string primitive (web `typeof === 'string' && value !== ''`). */
private fun JsonObject.nonEmptyStringField(key: String): String? = stringField(key)?.takeIf { it.isNotEmpty() }

/** Reads [key] as a strict boolean `true` (web `value === true`); a string `"true"` does NOT qualify. */
private fun JsonObject.boolField(key: String): Boolean {
    val primitive = (this[key] as? JsonPrimitive)?.takeUnless { it.isString } ?: return false
    return primitive.booleanOrNull == true
}
