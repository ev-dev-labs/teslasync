// Pure, framework-free model + reducer + surface classifier for the AINLDriveSearch shared surface — the native
// analogue of everything the web component derives around its stream
// (web/src/components/ai/AINLDriveSearch.tsx → AIFeatureCard → AiOutputPanel, driven by useAiStream). No Compose,
// no Android UI, no HTTP: every declaration here is unit-tested off-device in the :android:testReleaseUnitTest
// gate, keeping the composable a thin render layer (ADR-002).
//
// The web surface is `withAiFeature('nl-drive-search-replay', InnerSection)`. InnerSection POSTs { prompt } to
// `/ai/drives/search` via useAiStream and feeds the accumulated delta text, lifecycle state, and error into
// AIFeatureCard — its `onEvent` is a no-op, so the only rendered output is the streamed narration text (the
// assistant narrating the matching drive). The HOC renders nothing when the AI feature is gated off (ai_mode
// off), reproduced here as [DriveSearchSurface.Hidden] (Honesty Covenant #9: documented, not silent). Every
// other state renders a non-blank surface as the P3 contract requires.
//
// The useAiStream lifecycle (idle -> streaming -> done | error) is mapped onto the P3 state vocabulary:
//   loading  => Streaming with no delta yet ([DriveSearchSurface.Working], a thinking indicator)
//   empty    => Idle ([DriveSearchSurface.Resting], the resting card inviting a search) or a blank Done
//   content  => Live (streaming partial text) / Ready (completed narration)
//   error    => Failed (no last-known) — a QueryError-equivalent with retry
//   stale    => Ready with a result older than the freshness window (a stale chip + manual re-search)
//   offline  => Cached (a connectivity failure that keeps the last-known result + an offline chip + retry)
// Re-running an LLM search is an explicit, billable action, so the stale surface invites a manual re-search
// rather than auto-refreshing (documented divergence from the templated "auto-refresh", Honesty Covenant #9).
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/shared-surfaces/AINLDriveSearch — the P3 prompt's allowed-files path) cannot form a valid
// Kotlin package (a hyphen is illegal in a package identifier), so the package intentionally diverges from the
// path — exactly as the sibling AICostForecastNarration / AIGeofenceAwareAutomationSuggestions surfaces do.
// `MatchingDeclarationName`/`filename` are suppressed for the co-located supporting declarations.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration", "ktlint:standard:filename")

package io.teslasync.android.sharedsurfaces.ainldrivesearch

import io.teslasync.android.data.ErrorKind
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive

/** Per-feature AI-Off gate id — mirrors the web `withAiFeature('nl-drive-search-replay', …)` (ADR-015 §I5). */
const val AI_NL_DRIVE_SEARCH_FEATURE_ID: String = "nl-drive-search-replay"

/**
 * Diagnostics surface slug emitted with the `view.opened` event (P1/S11). Carries no VIN, drive id, prompt, or
 * any generated text, so a diagnostics line can never leak the operator's fleet state or the model output.
 */
const val AI_NL_DRIVE_SEARCH_SLUG: String = "AINLDriveSearch"

/**
 * The `/api/v1`-relative SSE route the production source opens (web `useAiStream({ url: '/ai/drives/search' })`).
 * Documented here so the host adapter and the contract test agree on the one path this surface streams against.
 */
const val AI_NL_DRIVE_SEARCH_URL: String = "/ai/drives/search"

/**
 * How long a completed search result is considered fresh before the surface flags it stale and invites a manual
 * re-search. Five minutes mirrors the app's live-data staleness budget; it is generous because a narrated drive
 * search does not churn second-to-second.
 */
const val DRIVE_SEARCH_FRESHNESS_WINDOW_MS: Long = 5L * 60L * 1_000L

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
 * The surface's i18n keys + their web English fallbacks. Each fallback equals the string i18next actually
 * renders for that key from web/src/i18n/en.json — the source of truth the web `t(key, default)` resolves to
 * (note the prompt-hint key's inline `.tsx` default is stale, so the en.json catalog value is used here); the
 * `helix.*` fallbacks carry the same English the shared web scaffold (`AIFeatureCard` / `AIBadge`) renders, and
 * the `common.*` + native state-chrome keys carry the English the prompt's "every state must render" contract
 * requires — so the rendered English is identical whether or not the generated catalog ships the key.
 */
internal object DriveSearchKeys {
    const val TITLE = "drives.aiSearch.title"
    const val TITLE_EN = "Find a drive in natural language"

    const val DESCRIPTION = "drives.aiSearch.description"
    const val DESCRIPTION_EN =
        "Describe a drive (for example \"last Friday's trip to the coast\") and jump straight to its replay — " +
            "the assistant only narrates your own drives."

    const val BADGE = "drives.aiSearch.badge"
    const val BADGE_EN = "Helix"

    const val SEARCH_BUTTON = "drives.aiSearch.searchButton"
    const val SEARCH_BUTTON_EN = "Search with Helix"

    const val PROMPT_HINT = "drives.aiSearch.placeholder" // parity:allow i18n key path, not a stub
    const val PROMPT_HINT_EN =
        "Describe a drive — for example \"last Friday's coast trip\" or " +
            "\"the one with the lowest efficiency last week\""

    const val NO_MATCH = "drives.aiSearch.noMatch"
    const val NO_MATCH_EN = "No matching drive found yet. Try describing it a different way."

    const val ERROR_TITLE = "drives.aiSearch.errorTitle"
    const val ERROR_TITLE_EN = "Couldn't search your drives"

    const val ASK_HELIX = "helix.askHelix"
    const val ASK_HELIX_EN = "Ask Helix"

    const val THINKING = "helix.thinking"
    const val THINKING_EN = "Helix is thinking…"

    const val BADGE_ARIA = "helix.ariaLabel"
    const val BADGE_ARIA_EN = "Helix"

    const val RETRY = "common.retry"
    const val RETRY_EN = "Retry"

    const val OFFLINE = "common.offline"
    const val OFFLINE_EN = "Offline"

    const val STALE = "common.stale"
    const val STALE_EN = "Stale"
}

/** The fully-resolved display strings the composable paints — resolved off-device so i18n is unit-testable. */
@Suppress("LongParameterList")
data class DriveSearchLabels(
    val title: String,
    val description: String,
    val badge: String,
    val badgeAria: String,
    val searchButton: String,
    val promptHint: String,
    val noMatch: String,
    val errorTitle: String,
    val askHelix: String,
    val thinking: String,
    val retry: String,
    val offline: String,
    val stale: String,
)

/** Resolves every surface label through [resolve], folding the web `t(key, fallback)` calls into one value. */
fun driveSearchLabels(resolve: StringResolver): DriveSearchLabels =
    DriveSearchLabels(
        title = resolve(DriveSearchKeys.TITLE, DriveSearchKeys.TITLE_EN),
        description = resolve(DriveSearchKeys.DESCRIPTION, DriveSearchKeys.DESCRIPTION_EN),
        badge = resolve(DriveSearchKeys.BADGE, DriveSearchKeys.BADGE_EN),
        badgeAria = resolve(DriveSearchKeys.BADGE_ARIA, DriveSearchKeys.BADGE_ARIA_EN),
        searchButton = resolve(DriveSearchKeys.SEARCH_BUTTON, DriveSearchKeys.SEARCH_BUTTON_EN),
        promptHint = resolve(DriveSearchKeys.PROMPT_HINT, DriveSearchKeys.PROMPT_HINT_EN),
        noMatch = resolve(DriveSearchKeys.NO_MATCH, DriveSearchKeys.NO_MATCH_EN),
        errorTitle = resolve(DriveSearchKeys.ERROR_TITLE, DriveSearchKeys.ERROR_TITLE_EN),
        askHelix = resolve(DriveSearchKeys.ASK_HELIX, DriveSearchKeys.ASK_HELIX_EN),
        thinking = resolve(DriveSearchKeys.THINKING, DriveSearchKeys.THINKING_EN),
        retry = resolve(DriveSearchKeys.RETRY, DriveSearchKeys.RETRY_EN),
        offline = resolve(DriveSearchKeys.OFFLINE, DriveSearchKeys.OFFLINE_EN),
        stale = resolve(DriveSearchKeys.STALE, DriveSearchKeys.STALE_EN),
    )

/**
 * The Search button's accessible name — the native mirror of the web AIFeatureCard `aria-label`
 * (`"${askHelix} · ${buttonLabel}"`), so TalkBack announces the contextual Helix verb, not just "Ask Helix".
 */
fun searchButtonContentDescription(resolve: StringResolver): String {
    val labels = driveSearchLabels(resolve)
    return "${labels.askHelix} · ${labels.searchButton}"
}

// ── AI stream chunk model (the consume side of web `useAiStream`) ────────────────────────────────────────────

/**
 * One parsed frame of the search stream — the native narrowing of the web `AiStreamEvent` union that this
 * surface consumes (its `onEvent` is a no-op, so only delta/done/error matter). [Delta] frames accumulate text;
 * [Done] closes the stream cleanly; [Failed] carries the classified failure so the render boundary can localize
 * it (never the raw provider message).
 */
sealed interface AiSearchChunk {
    /** A `delta` frame — a chunk of narrated prose appended to the accumulator (web `delta.text`). */
    data class Delta(
        val text: String,
    ) : AiSearchChunk

    /** The terminal `done` frame — the stream finished cleanly. */
    data object Done : AiSearchChunk

    /** A terminal `error` frame — carries the [ErrorKind] the UI maps to localized recovery copy. */
    data class Failed(
        val errorKind: ErrorKind,
    ) : AiSearchChunk
}

private val SSE_LINE = Regex("\\r?\\n")
private val NETWORK_MARKERS = listOf("network", "offline", "unreachable", "connection", "stream_http_0")
private val TIMEOUT_MARKERS = listOf("timeout", "timed out")

/**
 * Parses one blank-line-delimited SSE block into an [AiSearchChunk] — a faithful port of the consume side of web
 * `useAiStream` (parseSSEFrame + toTypedEvent), narrowed to the frames this surface reacts to. Returns `null`
 * for a frame with no `event:` line, malformed JSON, or an event type this surface ignores (tool/confirm
 * frames, which the web `onEvent` no-ops), so a transport can skip it instead of corrupting the stream.
 */
fun parseAiSearchFrame(raw: String): AiSearchChunk? {
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
    val data = if (dataStr.isEmpty()) null else runCatching { Json.parseToJsonElement(dataStr) }.getOrNull()
    // A non-empty payload that failed to parse is a malformed frame → drop it (web returns null).
    return if (dataStr.isNotEmpty() && data == null) null else toSearchChunk(event, data as? JsonObject)
}

private fun toSearchChunk(
    event: String,
    obj: JsonObject?,
): AiSearchChunk? =
    when (event) {
        "delta" -> obj?.stringField("text")?.let { AiSearchChunk.Delta(it) }
        "done" -> AiSearchChunk.Done
        "error" -> AiSearchChunk.Failed(classifyStreamError(obj?.stringField("reason"), obj?.stringField("message")))
        else -> null
    }

/**
 * Classifies a terminal stream `error` frame into the Android [ErrorKind], folding the structured `reason` (web
 * F9 limit fields) and the `stream_http_*` / network-ish `message` the fetch transport surfaces. A connectivity
 * marker yields [ErrorKind.Network] (rendered offline), a timeout marker [ErrorKind.Timeout], anything else
 * [ErrorKind.Http] (a hard error).
 */
fun classifyStreamError(
    reason: String?,
    message: String?,
): ErrorKind {
    val haystack = "${reason.orEmpty()} ${message.orEmpty()}".lowercase()
    return when {
        NETWORK_MARKERS.any { haystack.contains(it) } -> ErrorKind.Network
        TIMEOUT_MARKERS.any { haystack.contains(it) } -> ErrorKind.Timeout
        else -> ErrorKind.Http
    }
}

/** Connectivity-class failures the surface renders as offline/last-known rather than a hard error. */
fun isOfflineKind(errorKind: ErrorKind?): Boolean =
    errorKind == ErrorKind.Network || errorKind == ErrorKind.Timeout || errorKind == ErrorKind.CircuitOpen

// ── Surface state + reducer (the native mirror of useAiStream's reactive surface) ────────────────────────────

/** The search-stream lifecycle, narrowed to what this surface reacts to (idle -> streaming -> done | failed). */
enum class DriveSearchPhase {
    /** No search requested yet — the resting card with the Search action (web `state === 'idle'`). */
    Idle,

    /** A stream is open; delta text accumulates until a terminal frame (web `state === 'streaming'`). */
    Streaming,

    /** The stream closed successfully — the accumulated text is the narrated result (web `state === 'done'`). */
    Done,

    /** The stream ended in a terminal error frame or threw (web `state === 'error'`). */
    Failed,
}

/**
 * The immutable surface state the [AINLDriveSearchViewModel] exposes. It carries the AI feature gate (web
 * `withAiFeature`), the free-text [prompt] bound to the textarea (web `prompt` state -> `canStart`), the stream
 * [phase], the in-flight [streamingText] accumulator, the last committed result ([committedText], kept across a
 * failed re-search so an offline surface can still show last-known), the classified [errorKind], and the
 * completion [fetchedAt] stamp used for the freshness check.
 *
 * @property gateEnabled whether the AI feature is on (web `useAiEnabled('nl-drive-search-replay')`).
 * @property prompt the free-text query the textarea binds; a non-blank prompt enables the Search action.
 * @property phase the stream lifecycle phase.
 * @property streamingText the delta accumulator for the in-flight stream (web useAiStream `text`).
 * @property committedText the last successfully completed result, preserved for the offline surface.
 * @property errorKind the classification of the most recent failure, or `null`.
 * @property fetchedAt epoch-millis stamp of [committedText], or `null` when nothing has completed.
 */
data class DriveSearchState(
    val gateEnabled: Boolean = true,
    val prompt: String = "",
    val phase: DriveSearchPhase = DriveSearchPhase.Idle,
    val streamingText: String = "",
    val committedText: String = "",
    val errorKind: ErrorKind? = null,
    val fetchedAt: Long? = null,
) {
    /** Web `canStart = prompt.trim().length > 0`: the Search action is available only with a non-blank prompt. */
    val canStart: Boolean get() = prompt.trim().isNotEmpty()

    /** True while a stream is open (drives the button's busy affordance + disables re-entry). */
    val isStreaming: Boolean get() = phase == DriveSearchPhase.Streaming
}

/** Tracks the free-text prompt (web `setPrompt`); a non-blank prompt is a precondition of a search. */
fun DriveSearchState.withPrompt(text: String): DriveSearchState = copy(prompt = text)

/**
 * Opens a fresh search: enter [DriveSearchPhase.Streaming], clear the in-flight accumulator, and drop any prior
 * error. The last [DriveSearchState.committedText] is intentionally retained (not shown while streaming) so a
 * failed re-search can fall back to last-known — the web clears its visible text the same way at `start()`,
 * surfacing the thinking indicator until the first delta.
 */
fun DriveSearchState.startSearching(): DriveSearchState = copy(phase = DriveSearchPhase.Streaming, streamingText = "", errorKind = null)

/** Reduces one parsed [AiSearchChunk] into the next state (delta accumulation / done / failure). */
fun DriveSearchState.onChunk(
    chunk: AiSearchChunk,
    nowMs: Long,
): DriveSearchState =
    when (chunk) {
        is AiSearchChunk.Delta -> copy(streamingText = streamingText + chunk.text)
        AiSearchChunk.Done -> markDone(nowMs)
        is AiSearchChunk.Failed -> markFailed(chunk.errorKind)
    }

/**
 * Commits the accumulated text as the result and stamps it for the freshness check. A blank result keeps a
 * blank [DriveSearchState.committedText] so the surface renders its friendly empty state rather than a blank box.
 */
fun DriveSearchState.markDone(nowMs: Long): DriveSearchState =
    copy(phase = DriveSearchPhase.Done, committedText = streamingText, fetchedAt = nowMs)

/** Marks the stream failed with the classified [kind]; the prior committed result is left intact. */
fun DriveSearchState.markFailed(kind: ErrorKind): DriveSearchState = copy(phase = DriveSearchPhase.Failed, errorKind = kind)

/**
 * Closes a stream that ended without an explicit terminal frame (the producer simply completed). Mirrors the web
 * hook promoting a still-`streaming` state to `done` when the reader drains, so the UI never hangs on the
 * thinking indicator.
 */
fun DriveSearchState.finishIfStreaming(nowMs: Long): DriveSearchState = if (phase == DriveSearchPhase.Streaming) markDone(nowMs) else this

// ── Render-state classification (every state the prompt mandates) ────────────────────────────────────────────

/**
 * The render-ready classification of [DriveSearchState] — a closed set of mutually-exclusive surfaces the view
 * switches on, so every branch is exhaustively covered and unit-tested off-device. Maps the stream lifecycle
 * onto the P3 loading / empty / content / error / stale / offline contract.
 */
sealed interface DriveSearchSurface {
    /** The AI feature is gated off — the whole surface collapses (web `withAiFeature` renders `null`). */
    data object Hidden : DriveSearchSurface

    /** Resting/idle: the card with the Search action, enabled only when [canStart] (web `prompt` non-blank). */
    data class Resting(
        val canStart: Boolean,
    ) : DriveSearchSurface

    /** Streaming with no delta yet — the thinking indicator (the surface's loading state). */
    data object Working : DriveSearchSurface

    /** Streaming with partial text — the narrated result rendering live as it arrives. */
    data class Live(
        val text: String,
    ) : DriveSearchSurface

    /** Completed with text — the narrated result; [stale] flags a result older than the freshness window. */
    data class Ready(
        val text: String,
        val stale: Boolean,
    ) : DriveSearchSurface

    /** Completed but blank — a friendly empty state (no matching drive narrated). */
    data object Empty : DriveSearchSurface

    /** Failed but a prior result exists — last-known kept visible; [offline] picks the chip/copy. */
    data class Cached(
        val text: String,
        val offline: Boolean,
    ) : DriveSearchSurface

    /** Failed with no last-known — a QueryError-equivalent with retry; [offline] picks the recovery copy. */
    data class Failed(
        val offline: Boolean,
    ) : DriveSearchSurface
}

/**
 * Selects the render-ready [DriveSearchSurface] for [state]. Pure (no Compose/clock): the caller supplies
 * [nowMs] and the [windowMs] freshness budget so the staleness decision is deterministic and testable.
 */
fun classifyDriveSearch(
    state: DriveSearchState,
    nowMs: Long,
    windowMs: Long = DRIVE_SEARCH_FRESHNESS_WINDOW_MS,
): DriveSearchSurface {
    if (!state.gateEnabled) return DriveSearchSurface.Hidden
    return when (state.phase) {
        DriveSearchPhase.Idle -> DriveSearchSurface.Resting(state.canStart)
        DriveSearchPhase.Streaming ->
            if (state.streamingText.isBlank()) {
                DriveSearchSurface.Working
            } else {
                DriveSearchSurface.Live(state.streamingText)
            }

        DriveSearchPhase.Done ->
            if (state.committedText.isBlank()) {
                DriveSearchSurface.Empty
            } else {
                DriveSearchSurface.Ready(state.committedText, isStale(state.fetchedAt, nowMs, windowMs))
            }

        DriveSearchPhase.Failed -> failedSurface(state)
    }
}

/** Failure -> last-known [DriveSearchSurface.Cached] when a prior result exists, else a hard failure. */
private fun failedSurface(state: DriveSearchState): DriveSearchSurface {
    val offline = isOfflineKind(state.errorKind)
    return if (state.committedText.isNotBlank()) {
        DriveSearchSurface.Cached(state.committedText, offline)
    } else {
        DriveSearchSurface.Failed(offline)
    }
}

/** True when a completed result stamped at [fetchedAt] is older than [windowMs] relative to [nowMs]. */
fun isStale(
    fetchedAt: Long?,
    nowMs: Long,
    windowMs: Long,
): Boolean = fetchedAt != null && nowMs - fetchedAt > windowMs

// ── Accessibility labels (pure, so TalkBack-label presence is unit-tested off-device) ────────────────────────

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

/** The localized announcement fragments [searchOutputAccessibilityLabel] composes — resolved by the view. */
data class DriveSearchOutputLabels(
    val working: String,
    val empty: String,
    val stale: String,
    val offline: String,
    val error: String,
)

/**
 * Builds the accessibility description for the output region per [surface] from already-localized parts, or
 * `null` when the output region carries no announcement (the resting/hidden surfaces, whose card chrome is
 * announced instead). Pure so the per-state a11y labels are unit-tested off-device.
 */
fun searchOutputAccessibilityLabel(
    surface: DriveSearchSurface,
    labels: DriveSearchOutputLabels,
): String? =
    when (surface) {
        DriveSearchSurface.Hidden, is DriveSearchSurface.Resting -> null
        DriveSearchSurface.Working, is DriveSearchSurface.Live -> labels.working
        DriveSearchSurface.Empty -> labels.empty
        is DriveSearchSurface.Ready -> if (surface.stale) "${labels.stale}. ${surface.text}" else surface.text
        is DriveSearchSurface.Cached -> "${if (surface.offline) labels.offline else labels.error}. ${surface.text}"
        is DriveSearchSurface.Failed -> labels.error
    }

// ── JSON field helper (web's typed narrowing) ────────────────────────────────────────────────────────────────

/** Reads [key] as a string primitive, allowing the empty string (web `typeof === 'string'`). */
private fun JsonObject.stringField(key: String): String? {
    val primitive = this[key] as? JsonPrimitive ?: return null
    return if (primitive.isString) primitive.content else null
}
