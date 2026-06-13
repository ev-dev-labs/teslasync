// Pure, framework-free model + projection for the DraftRestorePrompt shared surface — the native analogue
// of the data the web component derives before returning JSX
// (web/src/components/feedback/DraftRestorePrompt.tsx). No Compose, no Android UI, no HTTP: every type here
// is exercised by the :android:testReleaseUnitTest gate so the composable stays a thin render layer.
//
// The web `DraftRestorePrompt` surfaces unsaved `useFormDraft` work recovered after a tab close, crash, PWA
// reload, or auth redirect. It reads a CLIENT-SIDE draft registry (web `lib/draftIndex`, a localStorage
// mirror — not an API), filters out drafts being actively edited elsewhere, and renders a compact card with
// a "Review" affordance plus a modal listing each draft with per-row Resume / Discard. This model reproduces
// that selection (sort newest-first) and the relative "Saved {{when}}" age bucketing, and folds in the draft
// store's read lifecycle (the genuine async dependency on Android, where the registry is read off the main
// thread) so the surface can honestly render the prompt's loading / empty / error / stale / offline matrix
// without ever hiding a region.
//
// There is no native draft store in the shared core (web `lib/draftIndex` has no KMP port), so the registry
// lives next to the surface ([DraftRegistry] in DraftRestorePromptSource.kt) and this model stays a pure
// projection over whatever [DraftRecord]s it yields — the same approach the sibling surfaces take for their
// own per-surface projection logic. The cross-tab broadcast filtering and the `sessionStorage` one-shot
// guard the web uses are platform concerns: Android is single-process (no sibling tabs), and the one-shot
// guard is modelled as the view-model's per-session `dismissed` flag.
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/shared-surfaces/DraftRestorePrompt — the P3 prompt's allowed-files path) cannot form a
// valid Kotlin package (a hyphen is illegal in a package identifier), so the package intentionally diverges
// from the path. `MatchingDeclarationName` is suppressed for the co-located supporting types.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.draftrestoreprompt

import io.teslasync.android.components.feedback.QueryErrorKind
import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.UiState

/**
 * Canonical registry metadata for this surface — the native mirror of the web component's contract. The
 * diagnostics slug and the PII-safe structured-log event names are pinned here so the native and web
 * surfaces stay in lockstep and every diagnostic carries the surface slug only, never a draft label/route.
 */
object DraftRestorePromptRegistration {
    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). */
    const val SLUG: String = "DraftRestorePrompt"

    /** Structured-log field key carrying the surface slug. */
    const val SURFACE_KEY: String = "surface"

    /** Structured-log field key carrying a classified [ErrorKind] on a failed mutation. */
    const val KIND_KEY: String = "kind"

    /** The one PII-safe diagnostic emitted on first composition (P1/S11). */
    const val EVENT_VIEW_OPENED: String = "view.opened"

    /** Emitted when the draft feed is re-read after a hard error or stale TTL. */
    const val EVENT_REFRESH: String = "draftRestore.refresh"

    /** Emitted when the user dismisses the prompt for the session (web `sessionStorage` one-shot guard). */
    const val EVENT_DISMISS: String = "draftRestore.dismiss"

    /** Emitted when the user resumes a draft (web `navigate(entry.route)`). */
    const val EVENT_RESUME: String = "draftRestore.resume"

    /** Emitted when the user discards a single draft (web `discardDraftEnvelope`). */
    const val EVENT_DISCARD: String = "draftRestore.discard"

    /** Emitted when a single-draft discard fails (the store rejected the removal). */
    const val EVENT_DISCARD_FAILED: String = "draftRestore.discard.failed"

    /** Emitted when the user discards every draft at once (catalog `draft.recovery.discardAll`). */
    const val EVENT_DISCARD_ALL: String = "draftRestore.discardAll"

    /** Emitted when a discard-all fails. */
    const val EVENT_DISCARD_ALL_FAILED: String = "draftRestore.discardAll.failed"
}

/**
 * One recoverable unsaved draft — the native port of the web `DraftEntry` (`lib/draftIndex`). [storageKey]
 * is the stable persistence key (the row id + discard target, web `entry.storageKey`); [route] is the
 * in-app pathname Resume navigates to (web `entry.route`); [label] is the human title shown in the modal
 * (web `entry.label`, falling back to the catalog `fallbackLabel`); [savedAtEpochMs] is the save time used
 * to render the relative "Saved {{when}}" age (web `entry.savedAt`).
 */
data class DraftRecord(
    val storageKey: String,
    val route: String,
    val label: String? = null,
    val savedAtEpochMs: Long = 0L,
)

/**
 * The mutually-exclusive render surface the prompt draws. [Content] and [Empty] reproduce the web's two
 * visible branches (the draft list vs the modal's "No drafts to restore." message); [Loading] and [Error]
 * surface the genuine cold-start and hard-failure states of the draft-store read the records come from.
 */
enum class DraftRestorePhase {
    /** First draft-store read with nothing cached — render skeleton chrome (never a blank box). */
    Loading,

    /** One or more recoverable drafts are available — render the card + list. */
    Content,

    /** The store resolved with no drafts (web `getDrafts()` empty) — render the friendly empty state. */
    Empty,

    /** The store read failed with nothing cached — render a classified error with retry. */
    Error,
}

/**
 * The relative age of a draft's save time — the native port of the web `formatRelativeTime(entry.savedAt)`
 * token, carried as a structured bucket so the view resolves the localized phrase from the P1/S10 catalog
 * (the relative tokens are i18n, not native literals). Mirrors the sibling TimeStamp surface's `RelativeAge`.
 */
sealed interface DraftSavedAge {
    /** Under a minute old — catalog `freshness.justNow`. */
    data object JustNow : DraftSavedAge

    /** [count] whole minutes old — catalog `palette.recent.minutesAgo` plural. */
    data class Minutes(
        val count: Int,
    ) : DraftSavedAge

    /** [count] whole hours old — catalog `palette.recent.hoursAgo` plural. */
    data class Hours(
        val count: Int,
    ) : DraftSavedAge

    /** [count] whole days old — catalog `palette.recent.daysAgo` plural. */
    data class Days(
        val count: Int,
    ) : DraftSavedAge
}

/**
 * The immutable, render-ready projection the composable draws — everything the web `DraftRestorePrompt`
 * folds together: the newest-first [drafts] list, and the draft store's read lifecycle as the
 * cache-then-network freshness envelope ([stale] / [offline] / [refreshing] + [errorKind]) so the surface
 * honestly flags last-known data instead of presenting it as live. Pure data so [DraftRestoreProjection] is
 * unit-tested without a UI host.
 *
 * @property stale the cached draft list is past its TTL and a re-read is in flight (no failure yet).
 * @property offline the cached list is shown because a re-read failed (the store was unreachable).
 * @property freshnessStamp the `fetchedAt` of the shown list; keys the stale auto-refresh effect.
 */
data class DraftRestoreDisplay(
    val phase: DraftRestorePhase,
    val drafts: List<DraftRecord> = emptyList(),
    val stale: Boolean = false,
    val offline: Boolean = false,
    val refreshing: Boolean = false,
    val errorKind: ErrorKind? = null,
    val httpStatus: Int? = null,
    val freshnessStamp: Long? = null,
) {
    /** How many drafts are recoverable — the web `count` folded into the pluralized prompt body. */
    val count: Int get() = drafts.size

    /** True when a freshness chip (stale or offline) should be shown over the cached list. */
    val showFreshnessChip: Boolean get() = stale || offline

    /** True when a retry affordance should be offered (the hard-error surface). */
    val canRetry: Boolean get() = phase == DraftRestorePhase.Error

    /**
     * True when the compact bottom prompt card should surface: the loading skeleton or the populated
     * content, but never the resolved-empty or hard-error states (the web returns `null` when there is
     * nothing actionable, keeping the surface unobtrusive — the empty/error states live in the review modal).
     */
    val showCard: Boolean get() = phase == DraftRestorePhase.Loading || phase == DraftRestorePhase.Content
}

/**
 * Pure projection + age-bucketing logic for the DraftRestorePrompt surface — the native port of the web
 * component's `getDrafts()` selection plus the `formatRelativeTime` token derivation.
 */
object DraftRestoreProjection {
    private const val HTTP_UNAUTHORIZED = 401
    private const val HTTP_FORBIDDEN = 403
    private const val HTTP_NOT_FOUND = 404

    private const val MILLIS_PER_SECOND = 1_000L
    private const val SECONDS_PER_MINUTE = 60L
    private const val MINUTES_PER_HOUR = 60L
    private const val HOURS_PER_DAY = 24L
    private const val MILLIS_PER_MINUTE = MILLIS_PER_SECOND * SECONDS_PER_MINUTE
    private const val MILLIS_PER_HOUR = MILLIS_PER_MINUTE * MINUTES_PER_HOUR
    private const val MILLIS_PER_DAY = MILLIS_PER_HOUR * HOURS_PER_DAY

    /**
     * Folds the draft-store [state] (the records source) into the render-ready [DraftRestoreDisplay].
     *
     * Phase resolution honours both the web's two visible branches and the store read's async lifecycle: a
     * hard read failure with no cache → [DraftRestorePhase.Error]; a first read with nothing cached →
     * [DraftRestorePhase.Loading]; otherwise the records are available (fresh or cached) and the list decides
     * [DraftRestorePhase.Empty] (web `getDrafts()` empty) vs [DraftRestorePhase.Content]. Records are sorted
     * newest-first so the most recently abandoned work is offered first, matching the web list order.
     */
    fun project(state: UiState<List<DraftRecord>>): DraftRestoreDisplay {
        val drafts = (state.data ?: emptyList()).sortedByDescending { it.savedAtEpochMs }
        val phase =
            when {
                state.isError -> DraftRestorePhase.Error
                state.isLoading -> DraftRestorePhase.Loading
                drafts.isEmpty() -> DraftRestorePhase.Empty
                else -> DraftRestorePhase.Content
            }
        return DraftRestoreDisplay(
            phase = phase,
            drafts = drafts,
            stale = state.stale && state.errorKind == null,
            offline = state.stale && state.hasData && state.errorKind != null,
            refreshing = state.refreshing,
            errorKind = state.errorKind,
            httpStatus = state.httpStatus,
            freshnessStamp = state.fetchedAt,
        )
    }

    /**
     * Buckets a draft's [savedAtEpochMs] against [nowEpochMs] into the localized relative-age token the
     * view resolves from the catalog — the native port of the web `formatRelativeTime`: under a minute is
     * [DraftSavedAge.JustNow]; under an hour is whole [DraftSavedAge.Minutes]; under a day is whole
     * [DraftSavedAge.Hours]; otherwise whole [DraftSavedAge.Days] (clamped at ≥ 1 so a draft is never
     * "0 days ago"). A future or zero stamp clamps to [DraftSavedAge.JustNow].
     */
    fun savedAge(
        savedAtEpochMs: Long,
        nowEpochMs: Long,
    ): DraftSavedAge {
        val elapsed = (nowEpochMs - savedAtEpochMs).coerceAtLeast(0L)
        return when {
            elapsed < MILLIS_PER_MINUTE -> DraftSavedAge.JustNow
            elapsed < MILLIS_PER_HOUR -> DraftSavedAge.Minutes((elapsed / MILLIS_PER_MINUTE).toInt())
            elapsed < MILLIS_PER_DAY -> DraftSavedAge.Hours((elapsed / MILLIS_PER_HOUR).toInt())
            else -> DraftSavedAge.Days((elapsed / MILLIS_PER_DAY).coerceAtLeast(1L).toInt())
        }
    }

    /**
     * Maps the hard-error [display] onto the shared [QueryErrorKind] recovery bucket so the error surface
     * shows the right copy: an open breaker → [QueryErrorKind.Waiting]; a connectivity failure →
     * [QueryErrorKind.Network]; a 401/403 → [QueryErrorKind.Unauthorized]; a 404 → [QueryErrorKind.NotFound];
     * every other failure → [QueryErrorKind.ServerError] with a retry affordance.
     */
    fun queryErrorKind(display: DraftRestoreDisplay): QueryErrorKind =
        when (display.errorKind) {
            ErrorKind.CircuitOpen -> QueryErrorKind.Waiting
            ErrorKind.Network, ErrorKind.Timeout -> QueryErrorKind.Network
            ErrorKind.Http ->
                when (display.httpStatus) {
                    HTTP_UNAUTHORIZED, HTTP_FORBIDDEN -> QueryErrorKind.Unauthorized
                    HTTP_NOT_FOUND -> QueryErrorKind.NotFound
                    else -> QueryErrorKind.ServerError
                }
            ErrorKind.Decode, ErrorKind.Unknown, null -> QueryErrorKind.ServerError
        }
}
