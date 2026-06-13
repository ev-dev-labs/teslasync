// Pure, framework-free model + reducer + surface classifier for the AINLSqlPlayground shared surface — the
// native analogue of everything the web component derives around its stream
// (web/src/components/ai/AINLSqlPlayground.tsx -> AIFeatureCard -> AiOutputPanel, driven by useAiStream).
// No Compose, no Android UI, no HTTP: every declaration here is unit-tested off-device in the
// :android:testReleaseUnitTest gate, keeping the composable a thin render layer (ADR-002).
//
// The web surface is `withAiFeature('nl-sql-playground', InnerSection)`. InnerSection POSTs the trimmed
// natural-language `{ prompt }` to `/ai/power/sql/draft` via useAiStream, feeds the accumulated delta text +
// lifecycle state + error into AIFeatureCard, and — distinct from the pure-narration siblings — captures a typed
// read-only SQL draft from the `draft_readonly_sql` tool_result frame. When a draft is captured an "Apply to
// editor" affordance appears; clicking it hands the typed [SqlDraft] back to the parent SqlPlaygroundPage via the
// view's `onApply` callback, which copies it into the deterministic manual editor. The LLM NEVER executes or
// edits editor state directly (ADR-015 I8 propose-only) — this model therefore carries no mutation, it only
// reduces the draft stream onto a render contract and surfaces the captured draft for review.
//
// The HOC renders nothing when the AI feature is gated off (ai_mode off), so the canonical baseline this surface
// ships against is "gate off => nothing rendered" — reproduced here as [SqlDraftSurface.Hidden] (Honesty
// Covenant #9: documented, not silent). Every other state renders a non-blank surface as the P3 contract
// requires. The useAiStream lifecycle (idle -> streaming -> done | error) is mapped onto the P3 state vocabulary:
//   loading  => Streaming with no delta yet ([SqlDraftSurface.Working], a thinking indicator)
//   empty    => Idle ([SqlDraftSurface.Resting], the resting card inviting a draft) or a blank Done
//   content  => Live (streaming partial SQL) / Ready (completed draft text)
//   error    => Failed (no last-known) — a QueryError-equivalent with retry
//   stale    => Ready with a draft older than the freshness window (a stale chip + manual re-draft)
//   offline  => Cached (a network failure that keeps the last-known draft text + an offline chip + retry)
// Unlike a cache-then-network feed there is no automatic background refresh: re-running an LLM draft is an
// explicit, billable action, so the stale surface invites a manual re-draft rather than auto-refreshing
// (documented divergence from the templated "auto-refresh", Honesty Covenant #9).
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/shared-surfaces — the P3 prompt's allowed-files path) cannot form a valid Kotlin package
// (a hyphen is illegal in a package identifier), so the package intentionally diverges from the path —
// exactly as the sibling AICrossRuleConflictDetection / AIDigestNarration surfaces do. `MatchingDeclarationName`
// is suppressed for the co-located supporting declarations.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.ainlsqlplayground

import io.teslasync.android.data.ErrorKind
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive

/**
 * Diagnostics surface slug emitted with the `view.opened` event (P1/S11). Carries no prompt text, generated SQL,
 * or any draft detail, so a diagnostics line can never leak the operator's question or the model output.
 */
const val AI_NL_SQL_PLAYGROUND_SLUG: String = "AINLSqlPlayground"

/** The per-feature AI-Off gate id — mirrors the web `withAiFeature('nl-sql-playground', ...)` argument. */
const val NL_SQL_PLAYGROUND_FEATURE_ID: String = "nl-sql-playground"

/** The tool whose `tool_result` carries the typed read-only draft (web `name === 'draft_readonly_sql'`). */
const val DRAFT_TOOL_NAME: String = "draft_readonly_sql"

/**
 * How long a completed draft is considered fresh before the surface flags it stale and invites a manual
 * re-draft. Five minutes mirrors the app's live-data staleness budget; it is generous because an LLM SQL draft
 * for a single question does not churn second-to-second.
 */
const val DRAFT_FRESHNESS_WINDOW_MS: Long = 5L * 60L * 1_000L

// ── Captured draft (web `ReadonlySQLDraft`) ───────────────────────────────────────────────────────────────────

/**
 * The typed read-only SQL draft the Helix panel emits when the LLM successfully calls `draft_readonly_sql` —
 * the native mirror of the web `ReadonlySQLDraft` interface and the Go-side `ReadonlySQLDraft` DTO. The field set
 * is intentionally narrow: only the fields the SqlPlaygroundPage's deterministic editor already owns.
 *
 * @property prompt the natural-language question the draft answers (web `prompt`).
 * @property sql the proposed read-only SELECT/WITH statement (web `sql`).
 * @property rationale the model's short explanation of the draft (web `rationale`).
 * @property referencedTables the curated catalog tables the draft reads (web `referenced_tables`).
 */
data class SqlDraft(
    val prompt: String,
    val sql: String,
    val rationale: String,
    val referencedTables: List<String>,
)

/**
 * Parses a `draft_readonly_sql` tool_result payload into a [SqlDraft] — a faithful port of the web
 * `parseReadonlySQLDraft`. Returns `null` (web parity, never throwing) for a payload that is not an object, is
 * not `status === 'ok'`, has no `draft` object, or is missing any of the required string fields; the
 * `referenced_tables` array is filtered to its string entries, an absent/non-array value yielding an empty list.
 */
@Suppress("ReturnCount")
fun parseReadonlySqlDraft(data: JsonElement?): SqlDraft? {
    val obj = data as? JsonObject ?: return null
    if (obj.stringField("status") != "ok") return null
    val draft = obj["draft"] as? JsonObject ?: return null
    val prompt = draft.stringField("prompt") ?: return null
    val sql = draft.stringField("sql") ?: return null
    val rationale = draft.stringField("rationale") ?: return null
    val tables =
        (draft["referenced_tables"] as? JsonArray)
            ?.mapNotNull { element -> (element as? JsonPrimitive)?.takeIf { it.isString }?.content }
            ?: emptyList()
    return SqlDraft(prompt = prompt, sql = sql, rationale = rationale, referencedTables = tables)
}

/** Reads a JSON string field (web `typeof x === 'string'`): the unescaped content, or `null` for any non-string. */
private fun JsonObject.stringField(key: String): String? = (this[key] as? JsonPrimitive)?.takeIf { it.isString }?.content

// ── Stream chunk (native narrowing of the web `AiStreamEvent` union this surface consumes) ────────────────────

/**
 * One parsed frame of the draft stream — the native narrowing of the web `AiStreamEvent` union that this surface
 * reacts to. Delta frames accumulate the streamed SQL text; [DraftCaptured] carries the typed draft lifted from a
 * `draft_readonly_sql` tool_result (web `parseReadonlySQLDraft`); [Done] closes the stream successfully; [Failed]
 * carries the classified transport/HTTP failure so the render boundary can localize it (never the raw message).
 * The SSE-frame -> chunk decoding is the host adapter's responsibility (P1/S8 boundary), exactly as the sibling
 * narration surfaces document.
 */
sealed interface AiStreamChunk {
    /** A `delta` frame — a chunk of generated SQL/prose appended to the accumulator (web `delta.text`). */
    data class Delta(
        val text: String,
    ) : AiStreamChunk

    /** A captured `draft_readonly_sql` tool_result — the typed draft the Apply affordance hands back. */
    data class DraftCaptured(
        val draft: SqlDraft,
    ) : AiStreamChunk

    /** The terminal `done` frame — the stream finished cleanly. */
    data object Done : AiStreamChunk

    /** A terminal `error` frame — carries the [ErrorKind] the UI maps to localized recovery copy. */
    data class Failed(
        val errorKind: ErrorKind,
    ) : AiStreamChunk
}

/** The useAiStream lifecycle, narrowed to what this surface reacts to (idle -> streaming -> done | failed). */
enum class DraftPhase {
    /** No draft requested yet — the resting card with the Draft action (web `state === 'idle'`). */
    Idle,

    /** A stream is open; delta text accumulates until a terminal frame (web `state === 'streaming'`). */
    Streaming,

    /** The stream closed successfully — the accumulated text is the draft replay (web `state === 'done'`). */
    Done,

    /** The stream ended in a terminal error frame or threw (web `state === 'error'`). */
    Failed,
}

/**
 * The immutable surface state the [AINLSqlPlaygroundViewModel] exposes. It carries the AI feature gate
 * (web `withAiFeature`), the free-text [prompt] (web InnerSection's `prompt` state -> `canStart`), the stream
 * [phase], the in-flight [streamingText] accumulator, the last committed draft text ([committedText], kept across
 * a failed re-draft so an offline surface can still show last-known), the captured typed [draft] (web `draft`
 * state -> the Apply affordance), the classified [errorKind], and the completion [fetchedAt] stamp.
 *
 * @property gateEnabled whether the AI feature is on (web `useAiEnabled('nl-sql-playground')`).
 * @property prompt the free-text question (web `prompt`); blank/whitespace => the draft action is disabled.
 * @property phase the stream lifecycle phase.
 * @property streamingText the delta accumulator for the in-flight stream (web useAiStream `text`).
 * @property committedText the last successfully completed draft replay, preserved for the offline surface.
 * @property draft the typed draft captured from the tool_result, or `null` (web `draft` state).
 * @property errorKind the classification of the most recent failure, or `null`.
 * @property fetchedAt epoch-millis stamp of [committedText], or `null` when nothing has completed.
 */
data class AiSqlDraftState(
    val gateEnabled: Boolean = true,
    val prompt: String = "",
    val phase: DraftPhase = DraftPhase.Idle,
    val streamingText: String = "",
    val committedText: String = "",
    val draft: SqlDraft? = null,
    val errorKind: ErrorKind? = null,
    val fetchedAt: Long? = null,
) {
    /** Web `trimmed = prompt.trim()`: the prompt with surrounding whitespace removed. */
    val trimmedPrompt: String get() = prompt.trim()

    /** Web `hasPrompt = trimmed.length > 0`: whether the question is non-empty. */
    val hasPrompt: Boolean get() = trimmedPrompt.isNotEmpty()

    /** Web `canStart = hasPrompt`: the draft action is available only with a non-empty question. */
    val canStart: Boolean get() = hasPrompt

    /** True while a stream is open (drives the button's busy affordance + disables re-entry). */
    val isStreaming: Boolean get() = phase == DraftPhase.Streaming

    /** Web `canApply = !!draft && !isStreaming`: the Apply affordance is enabled only off a captured draft. */
    val canApply: Boolean get() = draft != null && !isStreaming
}

/** Sets the free-text [next] prompt (web `setPrompt`). */
fun AiSqlDraftState.withPrompt(next: String): AiSqlDraftState = copy(prompt = next)

/**
 * Opens a fresh draft: enter [DraftPhase.Streaming], clear the in-flight accumulator, drop any prior error, and
 * clear the captured [AiSqlDraftState.draft] (web `handleDraft` calls `setDraft(null)` before `stream.start()`).
 * The last [AiSqlDraftState.committedText] is intentionally retained (not shown while streaming) so a failed
 * re-draft can fall back to last-known, surfacing the thinking indicator until the first delta.
 */
fun AiSqlDraftState.startDrafting(): AiSqlDraftState =
    copy(phase = DraftPhase.Streaming, streamingText = "", errorKind = null, draft = null)

/** Reduces one parsed [AiStreamChunk] into the next state (delta accumulation / draft capture / done / failure). */
fun AiSqlDraftState.onChunk(
    chunk: AiStreamChunk,
    nowMs: Long,
): AiSqlDraftState =
    when (chunk) {
        is AiStreamChunk.Delta -> copy(streamingText = streamingText + chunk.text)
        is AiStreamChunk.DraftCaptured -> copy(draft = chunk.draft)
        AiStreamChunk.Done -> markDone(nowMs)
        is AiStreamChunk.Failed -> markFailed(chunk.errorKind)
    }

/**
 * Commits the accumulated text as the completed draft replay and stamps it for the freshness check. A blank
 * result keeps a blank [AiSqlDraftState.committedText] so the surface renders its friendly empty state rather
 * than an empty box (the captured [AiSqlDraftState.draft], if any, still drives the Apply affordance).
 */
fun AiSqlDraftState.markDone(nowMs: Long): AiSqlDraftState = copy(phase = DraftPhase.Done, committedText = streamingText, fetchedAt = nowMs)

/** Marks the stream failed with the classified [kind]; the prior committed draft + captured draft are left intact. */
fun AiSqlDraftState.markFailed(kind: ErrorKind): AiSqlDraftState = copy(phase = DraftPhase.Failed, errorKind = kind)

/**
 * Closes a stream that ended without an explicit terminal frame (the producer simply completed). Mirrors the web
 * hook promoting a still-`streaming` state to `done` when the reader drains, so the UI never hangs on the
 * thinking indicator.
 */
fun AiSqlDraftState.finishIfStreaming(nowMs: Long): AiSqlDraftState = if (phase == DraftPhase.Streaming) markDone(nowMs) else this

// ── Output-panel surface (every state the prompt mandates) ────────────────────────────────────────────────────

/**
 * The render-ready classification of the output region of [AiSqlDraftState] — a closed set of mutually-exclusive
 * surfaces the view switches on, so every branch is exhaustively covered and unit-tested off-device. Maps the
 * stream lifecycle onto the P3 loading / empty / content / error / stale / offline contract. The captured
 * [AiSqlDraftState.draft] + the Apply affordance are orthogonal to this output surface and are driven directly
 * from state, exactly as the web AIFeatureCard's output panel is independent of its `children` Apply button.
 */
sealed interface SqlDraftSurface {
    /** The AI feature is gated off — the whole surface collapses (web `withAiFeature` renders `null`). */
    data object Hidden : SqlDraftSurface

    /** Resting/idle: the card with the Draft action, enabled only when [canStart] (web `canStart`). */
    data class Resting(
        val canStart: Boolean,
    ) : SqlDraftSurface

    /** Streaming with no delta yet — the thinking indicator (the surface's loading state). */
    data object Working : SqlDraftSurface

    /** Streaming with partial text — the draft rendering live as it arrives. */
    data class Live(
        val text: String,
    ) : SqlDraftSurface

    /** Completed with text — the draft replay; [stale] flags a draft older than the freshness window. */
    data class Ready(
        val text: String,
        val stale: Boolean,
    ) : SqlDraftSurface

    /** Completed but blank — a friendly empty state (the model streamed no text). */
    data object Empty : SqlDraftSurface

    /** Failed but a prior draft replay exists — last-known kept visible; [offline] picks the chip/copy. */
    data class Cached(
        val text: String,
        val offline: Boolean,
    ) : SqlDraftSurface

    /** Failed with no last-known — a QueryError-equivalent with retry; [offline] picks the recovery copy. */
    data class Failed(
        val offline: Boolean,
    ) : SqlDraftSurface
}

/**
 * Selects the render-ready [SqlDraftSurface] for [state]. Pure (no Compose/clock): the caller supplies [nowMs]
 * and the [windowMs] freshness budget so the staleness decision is deterministic and testable.
 */
fun classifyDraft(
    state: AiSqlDraftState,
    nowMs: Long,
    windowMs: Long = DRAFT_FRESHNESS_WINDOW_MS,
): SqlDraftSurface {
    if (!state.gateEnabled) return SqlDraftSurface.Hidden
    return when (state.phase) {
        DraftPhase.Idle -> SqlDraftSurface.Resting(state.canStart)
        DraftPhase.Streaming ->
            if (state.streamingText.isBlank()) {
                SqlDraftSurface.Working
            } else {
                SqlDraftSurface.Live(state.streamingText)
            }

        DraftPhase.Done ->
            if (state.committedText.isBlank()) {
                SqlDraftSurface.Empty
            } else {
                SqlDraftSurface.Ready(state.committedText, isStale(state.fetchedAt, nowMs, windowMs))
            }

        DraftPhase.Failed -> failedSurface(state)
    }
}

/** Failure -> last-known [SqlDraftSurface.Cached] when a prior draft replay exists, else a hard failure. */
private fun failedSurface(state: AiSqlDraftState): SqlDraftSurface {
    val offline = state.errorKind == ErrorKind.Network
    return if (state.committedText.isNotBlank()) {
        SqlDraftSurface.Cached(state.committedText, offline)
    } else {
        SqlDraftSurface.Failed(offline)
    }
}

/** True when a completed draft stamped at [fetchedAt] is older than [windowMs] relative to [nowMs]. */
fun isStale(
    fetchedAt: Long?,
    nowMs: Long,
    windowMs: Long,
): Boolean = fetchedAt != null && nowMs - fetchedAt > windowMs

// ── i18n facade (web `t(key, fallback)`) ─────────────────────────────────────────────────────────────────────

/** A by-name string resolver — the P1/S10 i18n facade in production, a map/fallback in tests (web `t`). */
typealias StringResolver = (key: String, fallback: String) -> String

private val NON_IDENTIFIER = Regex("[^A-Za-z0-9_]")

/**
 * Folds a dotted i18next key into the generated Android catalog resource name (web `a.b.c` -> `translation_a_b_c`),
 * matching apps/shared/i18n/generators/gen-i18n.ts `androidName`. The production resolver looks this up by name
 * and falls back to the web English when the key is absent.
 */
fun foldCatalogKey(dottedKey: String): String = "translation_" + dottedKey.replace(NON_IDENTIFIER, "_").trim('_')

/** A resolver that always returns the web English fallback — used by @Preview and the off-device unit tests. */
val FallbackResolver: StringResolver = { _, fallback -> fallback }

/**
 * The surface's i18n keys + their exact web English fallbacks. The `powerSql.aiDrafter.*` keys are lifted verbatim
 * from the web component's `t(key, default)` calls; the `helix.*` / `common.*` / `mqtt.*` keys carry the same
 * English the shared web scaffold (`AIFeatureCard` / `AiOutputPanel`) and the lifecycle chrome render, so the
 * painted English is identical whether or not the catalog defines a given key.
 */
internal object AiNlSqlKeys {
    const val TITLE = "powerSql.aiDrafter.title"
    const val TITLE_EN = "Helix natural-language SQL drafter"

    const val DESCRIPTION = "powerSql.aiDrafter.description"
    const val DESCRIPTION_EN =
        "Describe the question in plain English (e.g. \"how many drives last week\"). Helix proposes a typed " +
            "read-only SQL draft you can apply to the editor with one click; it never executes the query directly."

    const val BUTTON = "powerSql.aiDrafter.button"
    const val BUTTON_EN = "Draft SQL"

    const val BADGE = "powerSql.aiDrafter.badge"
    const val BADGE_EN = "Helix"

    const val PROMPT_HINT = "powerSql.aiDrafter.promptPlaceholder" // parity:allow i18n key lifted verbatim from web AINLSqlPlayground.tsx
    const val PROMPT_HINT_EN = "e.g. how many drives did I take last week"

    const val PROMPT_LABEL = "powerSql.aiDrafter.promptLabel"
    const val PROMPT_LABEL_EN = "SQL request"

    const val APPLY_BUTTON = "powerSql.aiDrafter.applyButton"
    const val APPLY_BUTTON_EN = "Apply to editor"

    const val APPLY_TOOLTIP = "powerSql.aiDrafter.applyTooltip"
    const val APPLY_TOOLTIP_EN =
        "Copy the proposed SQL into the editor above. You can still edit it before clicking Run."

    // Native state-chrome keys (fallback-resolved; mirror the shared AIFeatureCard / AiOutputPanel English).
    const val ASK_HELIX = "helix.askHelix"
    const val ASK_HELIX_EN = "Ask Helix"

    const val BADGE_ARIA = "helix.ariaLabel"
    const val BADGE_ARIA_EN = "Helix"

    const val THINKING = "chatbot.thinking"
    const val THINKING_EN = "Helix is thinking\u2026"

    const val EMPTY = "common.noData"
    const val EMPTY_EN = "No data available"

    const val STALE = "mqtt.stale"
    const val STALE_EN = "Stale"

    const val OFFLINE = "common.offline"
    const val OFFLINE_EN = "Offline"

    const val RETRY = "common.retry"
    const val RETRY_EN = "Retry"

    const val ERROR = "powerSql.aiDrafter.error"
    const val ERROR_EN = "Helix couldn't draft the query. Please try again."
}

/** The fully-resolved display strings the composable paints — resolved off-device so i18n is unit-testable. */
@Suppress("LongParameterList")
data class AiNlSqlLabels(
    val title: String,
    val description: String,
    val button: String,
    val badge: String,
    val badgeAria: String,
    val promptHint: String,
    val promptLabel: String,
    val applyButton: String,
    val applyTooltip: String,
    val askHelix: String,
    val thinking: String,
    val empty: String,
    val stale: String,
    val offline: String,
    val retry: String,
    val error: String,
)

/** Resolves every surface label through [resolve], folding the web `t(key, fallback)` calls into one value. */
fun aiNlSqlLabels(resolve: StringResolver): AiNlSqlLabels =
    AiNlSqlLabels(
        title = resolve(AiNlSqlKeys.TITLE, AiNlSqlKeys.TITLE_EN),
        description = resolve(AiNlSqlKeys.DESCRIPTION, AiNlSqlKeys.DESCRIPTION_EN),
        button = resolve(AiNlSqlKeys.BUTTON, AiNlSqlKeys.BUTTON_EN),
        badge = resolve(AiNlSqlKeys.BADGE, AiNlSqlKeys.BADGE_EN),
        badgeAria = resolve(AiNlSqlKeys.BADGE_ARIA, AiNlSqlKeys.BADGE_ARIA_EN),
        promptHint = resolve(AiNlSqlKeys.PROMPT_HINT, AiNlSqlKeys.PROMPT_HINT_EN),
        promptLabel = resolve(AiNlSqlKeys.PROMPT_LABEL, AiNlSqlKeys.PROMPT_LABEL_EN),
        applyButton = resolve(AiNlSqlKeys.APPLY_BUTTON, AiNlSqlKeys.APPLY_BUTTON_EN),
        applyTooltip = resolve(AiNlSqlKeys.APPLY_TOOLTIP, AiNlSqlKeys.APPLY_TOOLTIP_EN),
        askHelix = resolve(AiNlSqlKeys.ASK_HELIX, AiNlSqlKeys.ASK_HELIX_EN),
        thinking = resolve(AiNlSqlKeys.THINKING, AiNlSqlKeys.THINKING_EN),
        empty = resolve(AiNlSqlKeys.EMPTY, AiNlSqlKeys.EMPTY_EN),
        stale = resolve(AiNlSqlKeys.STALE, AiNlSqlKeys.STALE_EN),
        offline = resolve(AiNlSqlKeys.OFFLINE, AiNlSqlKeys.OFFLINE_EN),
        retry = resolve(AiNlSqlKeys.RETRY, AiNlSqlKeys.RETRY_EN),
        error = resolve(AiNlSqlKeys.ERROR, AiNlSqlKeys.ERROR_EN),
    )

// ── Accessibility-label builders (TalkBack-label presence; pure so unit-tested without a Compose host) ────────

/**
 * Builds the merged accessibility description for the card header from already-localized parts (web reads the
 * title, the "Helix" badge, and the description as one block).
 */
fun headerAccessibilityLabel(
    title: String,
    badge: String,
    description: String,
): String = "$title ($badge). $description"

/**
 * The Draft button's accessible name — the native mirror of the web AIFeatureCard `aria-label`
 * (`"${askHelix} \u00b7 ${buttonLabel}"`), so TalkBack announces the contextual Helix verb, not just "Ask Helix".
 */
fun draftButtonContentDescription(
    askHelix: String,
    button: String,
): String = "$askHelix \u00b7 $button"

/**
 * Builds the accessibility description for the output region per [surface] from already-localized parts, or
 * `null` when the output region carries no announcement (the resting/hidden surfaces, whose card chrome is
 * announced instead).
 */
fun outputAccessibilityLabel(
    surface: SqlDraftSurface,
    labels: SqlDraftOutputLabels,
): String? =
    when (surface) {
        SqlDraftSurface.Hidden, is SqlDraftSurface.Resting -> null
        SqlDraftSurface.Working, is SqlDraftSurface.Live -> labels.working
        SqlDraftSurface.Empty -> labels.empty
        is SqlDraftSurface.Ready -> if (surface.stale) joinAnnouncement(labels.stale, surface.text) else surface.text
        is SqlDraftSurface.Cached -> joinAnnouncement(if (surface.offline) labels.offline else labels.error, surface.text)
        is SqlDraftSurface.Failed -> labels.error
    }

/**
 * Joins an announcement [prefix] (a status label) with a [body] into one TalkBack utterance. A prefix that
 * already ends in sentence punctuation ('.', '!', '?') is followed by a single space so the announcement never
 * doubles a period — the localized draft error is a full sentence, while the offline/stale chips are bare words
 * that take the inserted ". ".
 */
private fun joinAnnouncement(
    prefix: String,
    body: String,
): String {
    val last = prefix.lastOrNull()
    val separator = if (last == '.' || last == '!' || last == '?') " " else ". "
    return "$prefix$separator$body"
}

/** The localized announcement fragments [outputAccessibilityLabel] composes — resolved by the view from i18n. */
data class SqlDraftOutputLabels(
    val working: String,
    val empty: String,
    val stale: String,
    val offline: String,
    val error: String,
)
