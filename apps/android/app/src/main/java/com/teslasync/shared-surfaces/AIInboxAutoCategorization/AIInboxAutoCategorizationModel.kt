// Pure, framework-free model + projection for the AIInboxAutoCategorization shared surface — the native
// analogue of everything the web component derives before it returns JSX
// (web/src/components/ai/AIInboxAutoCategorization.tsx). No Compose, no Android, no HTTP lives here, so every
// declaration is exercised off-device by the :android:testReleaseUnitTest gate and the composable stays a thin
// render layer (ADR-002).
//
// The web component is an AIFeatureCard whose primary surface is "header + Suggest button + captured proposal".
// It drives `useAiStream` against POST /ai/alerts/inbox/categorize over an optional inbox scope (vehicle /
// window / severities / rule_ids), captures a typed list of CategoryBucket from `draft_alert_categories`
// `tool_result` frames, and surfaces an "Apply categories as filter" affordance that hands the union of every
// proposed rule_id back to the parent inbox via `onApplyCategories` (the AI panel NEVER persists — the user
// merely narrows the deterministic baseline list). This file owns the parity-critical pieces that have nothing
// to do with Compose:
//   - the i18n by-name facade (the [StringResolver] seam) + the surface's source keys (web `t(key, …)`),
//   - the request-body builder that omits null/empty scope fields (web's `useMemo` body),
//   - the typed [CategoryBucket] + the `tool_result` → buckets extraction (web `handleEvent`),
//   - the native [AiStreamEvent] union + the SSE frame parser (the consume side of web `useAiStream`),
//   - the [AiCategorizeRenderState] projection covering every state the prompt mandates
//     (loading / content / empty / error / stale / offline),
//   - and the PII-safe `view.opened` diagnostic (P1/S11).
//
// `InvalidPackageDeclaration`/`MatchingDeclarationName`/`filename` are suppressed because the mandated surface
// directory (com/teslasync/shared-surfaces/AIInboxAutoCategorization — the P3 prompt's allowed-files path)
// cannot form a valid Kotlin package identifier and the file hosts several co-located declarations, exactly as
// the sibling surfaces do.
@file:Suppress("InvalidPackageDeclaration", "MatchingDeclarationName", "ktlint:standard:filename")

package io.teslasync.android.sharedsurfaces.aiinboxautocategorization

import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.doubleOrNull
import kotlinx.serialization.json.put

/**
 * Canonical metadata for the surface. [ID] is the web `withAiFeature('inbox-auto-categorization', …)` feature id
 * (the per-feature AI-Off gate); [SLUG] is the diagnostics surface slug emitted with the one-shot `view.opened`
 * event (P1/S11).
 */
object AIInboxAutoCategorizationRegistration {
    /** Per-feature AI-Off gate id — mirrors the web `withAiFeature('inbox-auto-categorization', …)` argument. */
    const val ID: String = "inbox-auto-categorization"

    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). */
    const val SLUG: String = "AIInboxAutoCategorization"
}

/**
 * Emits the one PII-safe `view.opened` diagnostic with the surface [AIInboxAutoCategorizationRegistration.SLUG]
 * (P1/S11). Kept free of Compose so it is unit-tested with a recording [Logger]; the view-model calls it from
 * the first-composition effect. It carries only the static slug, so a diagnostics line can never leak a vehicle
 * id, a rule id, an alert title, or any proposed value (ADR-016).
 */
fun recordAIInboxCategorizationViewOpened(logger: Logger) {
    logger.info("view.opened", mapOf("surface" to AIInboxAutoCategorizationRegistration.SLUG))
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
 * The surface's i18n keys + their exact web English fallbacks. The six `notifications.inbox.aiCategorize.*` keys
 * are lifted verbatim from web/src/i18n/en.json (the component's `t(key, default)` calls); the `helix.*`,
 * `common.retry`, and native state-chrome keys carry the same fallback the shared web scaffold (`AIFeatureCard` /
 * `AiOutputPanel`) renders when a key is absent, so the rendered English is identical either way.
 */
internal object AiCategorizeKeys {
    const val TITLE = "notifications.inbox.aiCategorize.title"
    const val TITLE_EN = "Suggest inbox categories"

    const val DESCRIPTION = "notifications.inbox.aiCategorize.description"
    const val DESCRIPTION_EN =
        "Bucket recent alerts into categories from your inbox history. Descriptive replay only — review before applying."

    const val BADGE = "notifications.inbox.aiCategorize.badge"
    const val BADGE_EN = "Helix"

    const val SUGGEST_BUTTON = "notifications.inbox.aiCategorize.suggestButton"
    const val SUGGEST_BUTTON_EN = "Suggest categories"

    const val APPLY_BUTTON = "notifications.inbox.aiCategorize.applyButton"
    const val APPLY_BUTTON_EN = "Apply categories as filter"

    const val PREVIEW_LABEL = "notifications.inbox.aiCategorize.previewLabel"
    const val PREVIEW_LABEL_EN = "Proposed categories (review before applying):"

    const val ASK_HELIX = "helix.askHelix"
    const val ASK_HELIX_EN = "Ask Helix"

    const val THINKING = "helix.thinking"
    const val THINKING_EN = "Helix is thinking…"

    const val BADGE_ARIA = "helix.ariaLabel"
    const val BADGE_ARIA_EN = "Helix"

    const val EMPTY = "notifications.inbox.aiCategorize.empty"
    const val EMPTY_EN = "No categories yet. Ask Helix to bucket recent alerts from your inbox history."

    const val ERROR_TITLE = "notifications.inbox.aiCategorize.errorTitle"
    const val ERROR_TITLE_EN = "Couldn't suggest categories"

    const val RETRY = "common.retry"
    const val RETRY_EN = "Retry"

    const val OFFLINE = "notifications.inbox.aiCategorize.offline"
    const val OFFLINE_EN = "You're offline. Showing the last proposed categories, if any."

    const val STALE = "notifications.inbox.aiCategorize.stale"
    const val STALE_EN = "Last suggestion — refreshing…"
}

/** The fully-resolved display strings the composable paints — resolved off-device so i18n is unit-testable. */
@Suppress("LongParameterList")
data class AiCategorizeLabels(
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

/** Resolves every surface label through [resolve], folding the web `t(key, fallback)` calls into one value. */
fun aiCategorizeLabels(resolve: StringResolver): AiCategorizeLabels =
    AiCategorizeLabels(
        title = resolve(AiCategorizeKeys.TITLE, AiCategorizeKeys.TITLE_EN),
        description = resolve(AiCategorizeKeys.DESCRIPTION, AiCategorizeKeys.DESCRIPTION_EN),
        badge = resolve(AiCategorizeKeys.BADGE, AiCategorizeKeys.BADGE_EN),
        badgeAria = resolve(AiCategorizeKeys.BADGE_ARIA, AiCategorizeKeys.BADGE_ARIA_EN),
        suggestButton = resolve(AiCategorizeKeys.SUGGEST_BUTTON, AiCategorizeKeys.SUGGEST_BUTTON_EN),
        applyButton = resolve(AiCategorizeKeys.APPLY_BUTTON, AiCategorizeKeys.APPLY_BUTTON_EN),
        previewLabel = resolve(AiCategorizeKeys.PREVIEW_LABEL, AiCategorizeKeys.PREVIEW_LABEL_EN),
        askHelix = resolve(AiCategorizeKeys.ASK_HELIX, AiCategorizeKeys.ASK_HELIX_EN),
        thinking = resolve(AiCategorizeKeys.THINKING, AiCategorizeKeys.THINKING_EN),
        empty = resolve(AiCategorizeKeys.EMPTY, AiCategorizeKeys.EMPTY_EN),
        errorTitle = resolve(AiCategorizeKeys.ERROR_TITLE, AiCategorizeKeys.ERROR_TITLE_EN),
        retry = resolve(AiCategorizeKeys.RETRY, AiCategorizeKeys.RETRY_EN),
        offline = resolve(AiCategorizeKeys.OFFLINE, AiCategorizeKeys.OFFLINE_EN),
        stale = resolve(AiCategorizeKeys.STALE, AiCategorizeKeys.STALE_EN),
    )

/**
 * The Suggest button's accessible name — the native mirror of the web AIFeatureCard `aria-label`
 * (`"${askHelix} · ${buttonLabel}"`), so TalkBack announces the contextual Helix verb, not just "Ask Helix".
 */
fun suggestButtonContentDescription(resolve: StringResolver): String {
    val labels = aiCategorizeLabels(resolve)
    return "${labels.askHelix} · ${labels.suggestButton}"
}

// ── Inbox scope (web InnerSection props → `useMemo` request body) ─────────────────────────────────────────────

/**
 * The optional inbox scope the stream is requested over — the native mirror of the web component's
 * `vehicleId` / `severities` / `ruleIds` / `windowDays` props. Equality drives the view-model's
 * cancel-and-reset-on-change behaviour (web's `useEffect` cleanup keyed on the same four inputs), so a stale
 * stream from a previous filter can never bleed proposals into the current view.
 *
 * @property vehicleId optional vehicle scope (web `vehicle_id`); `null` categorizes the entire inbox.
 * @property severities optional severity filter (web `severities`); empty is omitted (backend default = all).
 * @property ruleIds optional rule filter (web `rule_ids`); empty is omitted.
 * @property windowDays optional inbox window in days (web `window_days`); `null` is omitted (backend default = 7).
 */
data class InboxScope(
    val vehicleId: Long? = null,
    val severities: List<String> = emptyList(),
    val ruleIds: List<Long> = emptyList(),
    val windowDays: Int? = null,
)

/**
 * Builds the POST body for `/ai/alerts/inbox/categorize` from [scope] — a faithful port of the web `useMemo`
 * body: only fields that have a value are emitted (a `null` vehicle id, a `null` window, an empty severities
 * list, and an empty rule-id list are all dropped) so the backend's optional-field defaults apply. Pure +
 * unit-tested so the wire contract is verified off-device.
 */
fun inboxCategorizeRequestBody(scope: InboxScope): JsonObject =
    buildJsonObject {
        scope.vehicleId?.let { put("vehicle_id", it) }
        scope.windowDays?.let { put("window_days", it) }
        scope.severities.takeIf { it.isNotEmpty() }?.let { put("severities", JsonArray(it.map(::JsonPrimitive))) }
        scope.ruleIds
            .takeIf { it.isNotEmpty() }
            ?.let { ids -> put("rule_ids", JsonArray(ids.map { JsonPrimitive(it) })) }
    }

// ── Proposed categories (web `CategoryBucket`) ───────────────────────────────────────────────────────────────

/**
 * One proposed inbox category — the native mirror of the web `CategoryBucket`, kept narrow so the panel can
 * never trust a field the LLM did not emit. [ruleIds] are the deterministic rule ids the "Apply" affordance
 * narrows the baseline list by; [sampleTitles] are captured (matching the web's typed narrowing) for parity even
 * though, like the web, they are not painted in the chip.
 *
 * @property category the bucket label (web `category`; a non-empty string).
 * @property count the number of alerts in the bucket (web `count`; a non-negative number).
 * @property ruleIds the positive rule ids the bucket spans (web `rule_ids`, each `> 0`).
 * @property sampleTitles representative alert titles (web `sample_titles`, each non-empty).
 */
data class CategoryBucket(
    val category: String,
    val count: Int,
    val ruleIds: List<Long> = emptyList(),
    val sampleTitles: List<String> = emptyList(),
)

/** The tool whose `tool_result` carries the proposed buckets (web `name === 'draft_alert_categories'`). */
const val DRAFT_TOOL_NAME: String = "draft_alert_categories"

/**
 * Captures the proposed buckets from a `tool_result` event — the native mirror of the web `handleEvent`. Returns
 * `null` for any event that is not an OK `draft_alert_categories` result with a `status: "ok"` envelope and a
 * `categories` array, or whose array contains no recognizable bucket — exactly matching the web guard that only
 * calls `setProposal` when `buckets.length > 0`.
 */
fun extractCategories(event: AiStreamEvent): List<CategoryBucket>? {
    val categories = (event as? AiStreamEvent.ToolResult)?.categoriesArray() ?: return null
    return parseCategories(categories).ifEmpty { null }
}

/** The OK `draft_alert_categories` result's `categories` array, or `null` for any other / !ok / non-status:ok frame. */
private fun AiStreamEvent.ToolResult.categoriesArray(): JsonArray? {
    val data = (this.data as? JsonObject)?.takeIf { name == DRAFT_TOOL_NAME && ok } ?: return null
    val statusOk = (data["status"] as? JsonPrimitive)?.takeIf { it.isString }?.content == "ok"
    return if (statusOk) data["categories"] as? JsonArray else null
}

/** Reads every recognizable bucket off the `categories` array (web's per-element typed narrowing). */
fun parseCategories(categories: JsonArray): List<CategoryBucket> =
    categories.mapNotNull { element -> (element as? JsonObject)?.let(::parseBucket) }

/** Parses one `categories` element; `null` when it lacks a non-empty `category` or a non-negative `count`. */
private fun parseBucket(obj: JsonObject): CategoryBucket? {
    val category = obj.nonEmptyStringField("category")
    val count = obj.numberField("count")?.takeIf { it >= 0 }?.toInt()
    return if (category != null && count != null) {
        CategoryBucket(category, count, obj.positiveLongList("rule_ids"), obj.nonEmptyStringList("sample_titles"))
    } else {
        null
    }
}

/**
 * The union of every proposed rule id across [buckets], de-duplicated and sorted ascending — the native mirror of
 * the web `allRuleIds` memo. This is the list the "Apply categories as filter" affordance hands to the parent.
 */
fun allRuleIds(buckets: List<CategoryBucket>): List<Long> = buckets.flatMap { it.ruleIds }.toSortedSet().toList()

// ── AI stream event model (native mirror of web `useAiStream`'s AiStreamEvent union) ─────────────────────────

/** The lifecycle of the categorize stream — the native mirror of the web `AiStreamState`. */
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
 * argument (and the view re-renders atomically): the stream [phase], the last captured [proposal] buckets, the
 * accumulated descriptive-replay [streamedText], and the terminal [errorMessage]/[limit].
 */
data class StreamRuntime(
    val phase: AiStreamPhase = AiStreamPhase.Idle,
    val proposal: List<CategoryBucket>? = null,
    val streamedText: String = "",
    val errorMessage: String? = null,
    val limit: AiLimitInfo? = null,
)

/** The mutually-exclusive surface the composable renders — the prompt's mandated state set. */
enum class AiCategorizeRenderState { Loading, Content, Empty, Error, Stale, Offline }

/**
 * The immutable snapshot the composable paints. [canStart] mirrors the web `canStart` (`state !== 'paused-confirm'`,
 * plus connectivity — the entire inbox is categorizable, so unlike the rule-scoped sibling there is no
 * vehicle/rule precondition); [isBusy] disables the Suggest button while a stream is in flight (web
 * `streaming || paused-confirm`). [proposal] is retained across refresh/offline so the last-known buckets are
 * never blanked — they are flagged [stale], never hidden. [applyEnabled] mirrors the web Apply guard
 * (`allRuleIds.length === 0 || isBusy`), and [allRuleIds] is the union the Apply affordance hands to the parent.
 */
@Suppress("LongParameterList")
data class AiCategorizeSnapshot(
    val renderState: AiCategorizeRenderState,
    val phase: AiStreamPhase,
    val proposal: List<CategoryBucket>?,
    val streamedText: String,
    val canStart: Boolean,
    val isBusy: Boolean,
    val applyEnabled: Boolean,
    val allRuleIds: List<Long>,
    val errorMessage: String?,
    val limit: AiLimitInfo?,
    val offline: Boolean,
    val stale: Boolean,
)

/**
 * Projects the stream [runtime] + connectivity onto an [AiCategorizeSnapshot] — the single, side-effect-free
 * place the prompt's six render states are derived, so the composable only paints:
 *  - `online == false` ⇒ Offline (last-known [StreamRuntime.proposal] kept visible, suggest disabled);
 *  - a terminal error classified as a connectivity failure ⇒ Offline, any other error ⇒ Error (+ retry);
 *  - streaming with a previously-captured proposal ⇒ Stale (refreshing over last-known), otherwise Loading;
 *  - `paused-confirm` ⇒ Loading (still in flight);
 *  - a captured proposal or streamed replay text ⇒ Content;
 *  - everything resolved with nothing to show ⇒ Empty.
 */
fun projectAiCategorize(
    runtime: StreamRuntime,
    online: Boolean,
): AiCategorizeSnapshot {
    val busy = runtime.phase == AiStreamPhase.Streaming || runtime.phase == AiStreamPhase.PausedConfirm
    val canStart = runtime.phase != AiStreamPhase.PausedConfirm && online
    val renderState = renderStateFor(runtime, online)
    val offline = renderState == AiCategorizeRenderState.Offline
    val stale = renderState == AiCategorizeRenderState.Stale || (offline && runtime.proposal != null)
    val ruleIds = runtime.proposal?.let(::allRuleIds).orEmpty()
    return AiCategorizeSnapshot(
        renderState = renderState,
        phase = runtime.phase,
        proposal = runtime.proposal,
        streamedText = runtime.streamedText,
        canStart = canStart,
        isBusy = busy,
        applyEnabled = ruleIds.isNotEmpty() && !busy,
        allRuleIds = ruleIds,
        errorMessage = runtime.errorMessage,
        limit = runtime.limit,
        offline = offline,
        stale = stale,
    )
}

/**
 * Decides which render surface to show for the current stream [runtime] + connectivity. Extracted from
 * [projectAiCategorize] so each function stays within the cyclomatic-complexity budget.
 */
private fun renderStateFor(
    runtime: StreamRuntime,
    online: Boolean,
): AiCategorizeRenderState {
    val networkError =
        runtime.phase == AiStreamPhase.Error && isNetworkFailure(runtime.limit?.reason, runtime.errorMessage)
    val hasProposal = !runtime.proposal.isNullOrEmpty()
    return when {
        !online -> AiCategorizeRenderState.Offline
        networkError -> AiCategorizeRenderState.Offline
        runtime.phase == AiStreamPhase.Error -> AiCategorizeRenderState.Error
        runtime.phase == AiStreamPhase.Streaming && hasProposal -> AiCategorizeRenderState.Stale
        runtime.phase == AiStreamPhase.Streaming -> AiCategorizeRenderState.Loading
        runtime.phase == AiStreamPhase.PausedConfirm -> AiCategorizeRenderState.Loading
        hasProposal -> AiCategorizeRenderState.Content
        runtime.streamedText.isNotBlank() -> AiCategorizeRenderState.Content
        else -> AiCategorizeRenderState.Empty
    }
}

/**
 * Classifies a terminal stream failure as a connectivity problem (so it renders as Offline rather than a hard
 * error), folding the structured `reason` (web limit fields) and the `stream_http_0` / network-ish message the
 * fetch transport surfaces on an unreachable host. Mirrors the Android `errorKindOf` Network/Timeout fold.
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

// ── Accessibility labels (built off-device so TalkBack-label presence is unit-tested) ────────────────────────

/**
 * The merged accessibility description for the card header from already-localized parts (web reads the title,
 * the "Helix" badge, and the description as one block). Pure so the label is unit-tested without a Compose host.
 */
fun headerAccessibilityLabel(
    title: String,
    badge: String,
    description: String,
): String = "$title ($badge). $description"

/**
 * The spoken description for one category chip — the visible chip paints `category · count` (web parity), so the
 * label reads the label and the count together. Pure so the per-chip a11y name is unit-tested off-device.
 */
fun categoryChipContentDescription(bucket: CategoryBucket): String = "${bucket.category}, ${bucket.count}"

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

/** Reads [key] as an array of positive numbers, dropping strings/non-positives (web `typeof === 'number' && v > 0`). */
private fun JsonObject.positiveLongList(key: String): List<Long> =
    (this[key] as? JsonArray)
        ?.mapNotNull {
            (it as? JsonPrimitive)
                ?.takeUnless { p -> p.isString }
                ?.doubleOrNull
                ?.takeIf { v -> v > 0 }
                ?.toLong()
        }.orEmpty()

/** Reads [key] as an array of non-empty strings (web `typeof === 'string' && v !== ''`). */
private fun JsonObject.nonEmptyStringList(key: String): List<String> =
    (this[key] as? JsonArray)
        ?.mapNotNull { (it as? JsonPrimitive)?.takeIf { p -> p.isString }?.content?.takeIf { s -> s.isNotEmpty() } }
        .orEmpty()
