// Pure, framework-free model + projection for the ComboboxMulti shared surface — the native analogue of the
// state the web component derives before it returns JSX (web/src/components/forms/ComboboxMulti.tsx: the
// `defaultFilter` + selected-key hiding + `visibleOptions` slice + the result-count announcement). No Compose,
// no Android UI, no HTTP: every type here is exercised by the :android:testReleaseUnitTest gate so the
// composable stays a thin render layer.
//
// The web `ComboboxMulti<T>` is a fully-controlled WAI-ARIA multi-select combobox. Its data contract is, per
// option, a stable key (`getOptionKey`), a visible label (`getOptionLabel`), and an optional chip label
// (`getChipLabel`); this surface captures that exactly with the concrete [ComboboxMultiOption] (key + label +
// chipLabel) rather than a Kotlin generic, the idiomatic native shape the sibling forms `ComboOption` already
// uses. The options themselves arrive through the caller-supplied [ComboboxMultiOptionsSource] (the web
// `options` prop — a static array OR an async loader), whose genuine cache-then-network lifecycle is folded in
// through [io.teslasync.android.data.UiState] so the dropdown can honestly render loading / content / empty /
// error / stale / offline without ever hiding a region.
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/shared-surfaces/ComboboxMulti — the P3 prompt's allowed-files path) cannot form a valid Kotlin
// package (a hyphen is illegal in a package identifier), so the package intentionally diverges from the path.
// `MatchingDeclarationName` is suppressed for the co-located supporting types.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.comboboxmulti

import io.teslasync.android.components.feedback.QueryErrorKind
import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.UiState

/**
 * Canonical registry metadata for this surface — the native mirror of the web component's contract. The
 * diagnostics slug and the web defaults (`maxVisibleOptions = 50`, `asyncDebounceMs = 200`) are pinned here so
 * the native and web surfaces stay in lockstep.
 */
object ComboboxMultiRegistration {
    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11, prompt-mandated). */
    const val SLUG: String = "ComboboxMulti"

    /** Web `maxVisibleOptions` default — caps the rendered dropdown rows for performance. */
    const val DEFAULT_MAX_VISIBLE_OPTIONS: Int = 50

    /** Web `asyncDebounceMs` default — the async-loader keystroke debounce window, in ms. */
    const val DEFAULT_ASYNC_DEBOUNCE_MS: Long = 200L
}

/**
 * One combobox option — the native port of the web generic `T` reduced to the three values the component reads
 * from it: a stable [key] (`getOptionKey`, used for de-duplication + a11y ids), a visible [label]
 * (`getOptionLabel`), and a [chipLabel] (`getChipLabel`, defaulting to [label]) shown on the selected chip.
 */
data class ComboboxMultiOption(
    val key: String,
    val label: String,
    val chipLabel: String = label,
)

/**
 * The render request the projection folds against the options feed — bundles the controlled selection and the
 * caller's caps so [ComboboxMultiProjection.project] keeps a two-argument signature. [selected] is the web
 * `value` prop; [maxItems] / [maxVisibleOptions] / [loading] mirror the same-named web props.
 */
data class ComboboxMultiRequest(
    val query: String,
    val selected: List<ComboboxMultiOption>,
    val maxItems: Int? = null,
    val maxVisibleOptions: Int = ComboboxMultiRegistration.DEFAULT_MAX_VISIBLE_OPTIONS,
    val loading: Boolean = false,
)

/**
 * The mutually-exclusive body the dropdown draws once it is open — the native analogue of the web `<ul>`'s
 * conditional `<li>` branches. [Options] is the populated list; [Empty] is the web "No results" /
 * "Maximum reached" row; [Loading] is the web spinner row; [Error] surfaces a hard async-loader failure that
 * has no cached options to fall back on (the web swallows this to an empty list — this surface offers an
 * honest retry instead).
 */
enum class ComboboxListPhase { Loading, Options, Empty, Error }

/**
 * Which screen-reader result-count message to voice — the native split of the web announce effect's
 * `count === 0 ? noResults : count === 1 ? resultsCountOne : resultsCount`. Kept locale-free so it is unit
 * tested without a string catalog; the view resolves the actual copy.
 */
enum class ResultAnnouncement { NoResults, OneResult, ManyResults }

/**
 * The immutable, render-ready projection the composable draws — everything the web `ComboboxMulti` folds before
 * returning: the [visibleOptions] (filtered, selected-hidden, capped), the [totalMatches] (for the announce +
 * the "{{count}} more" footer), the [overflowCount], the [atMax] guard, the dropdown [listPhase], and the
 * options feed's freshness envelope ([stale] / [offline] / [refreshing] + [errorKind]) so last-known data is
 * never presented as live. Pure data so [ComboboxMultiProjection] is unit-tested without a UI host.
 */
data class ComboboxMultiDisplay(
    val visibleOptions: List<ComboboxMultiOption>,
    val totalMatches: Int,
    val overflowCount: Int,
    val atMax: Boolean,
    val listPhase: ComboboxListPhase,
    val fieldLoading: Boolean,
    val stale: Boolean = false,
    val offline: Boolean = false,
    val refreshing: Boolean = false,
    val errorKind: ErrorKind? = null,
    val httpStatus: Int? = null,
) {
    /** True when the dropdown should show a "{{count}} more — refine search" footer (web overflow `<li>`). */
    val hasOverflow: Boolean get() = overflowCount > 0

    /** True when a freshness chip (stale or offline) should be shown over the cached options. */
    val showFreshnessChip: Boolean get() = stale || offline
}

/**
 * Pure projection + filter logic for the ComboboxMulti surface — the native port of the web `defaultFilter`,
 * the selected-key hiding, the `visibleOptions` slice, the result-count announce branch, and the keyboard
 * active-index arithmetic.
 */
object ComboboxMultiProjection {
    private const val HTTP_UNAUTHORIZED = 401
    private const val HTTP_FORBIDDEN = 403
    private const val HTTP_NOT_FOUND = 404

    /**
     * Case-insensitive label filter — the native port of the web `defaultFilter`. A blank [query] returns the
     * options unchanged; otherwise each option whose [ComboboxMultiOption.label] contains the trimmed query is
     * kept.
     */
    fun filterOptions(
        options: List<ComboboxMultiOption>,
        query: String,
    ): List<ComboboxMultiOption> {
        val trimmed = query.trim()
        return if (trimmed.isEmpty()) {
            options
        } else {
            options.filter { it.label.contains(trimmed, ignoreCase = true) }
        }
    }

    /**
     * Folds the options feed [optionsState] (the web `options` prop's resolved value + lifecycle) and the
     * render [request] into the [ComboboxMultiDisplay] the composable draws. Filters by query, hides already
     * selected keys (web `selectedKeys` set), caps to `maxVisibleOptions`, and resolves the dropdown phase from
     * the feed's cache-then-network state honouring both the web's visible branches and the genuine async
     * lifecycle.
     */
    fun project(
        optionsState: UiState<List<ComboboxMultiOption>>,
        request: ComboboxMultiRequest,
    ): ComboboxMultiDisplay {
        val selectedKeys = request.selected.mapTo(HashSet()) { it.key }
        val atMax = request.maxItems != null && request.selected.size >= request.maxItems
        val base = optionsState.data ?: emptyList()
        val filtered = filterOptions(base, request.query).filterNot { it.key in selectedKeys }
        val cap = request.maxVisibleOptions.coerceAtLeast(0)
        val visible = filtered.take(cap)
        val overflow = (filtered.size - visible.size).coerceAtLeast(0)
        val hasData = optionsState.hasData
        val phase =
            when {
                optionsState.isLoading -> ComboboxListPhase.Loading
                optionsState.isError && !hasData -> ComboboxListPhase.Error
                visible.isEmpty() -> ComboboxListPhase.Empty
                else -> ComboboxListPhase.Options
            }
        return ComboboxMultiDisplay(
            visibleOptions = visible,
            totalMatches = filtered.size,
            overflowCount = overflow,
            atMax = atMax,
            listPhase = phase,
            fieldLoading = request.loading || optionsState.isLoading || optionsState.refreshing,
            stale = optionsState.stale && optionsState.errorKind == null,
            offline = optionsState.stale && hasData && optionsState.errorKind != null,
            refreshing = optionsState.refreshing,
            errorKind = optionsState.errorKind,
            httpStatus = optionsState.httpStatus,
        )
    }

    /**
     * Selects the screen-reader result-count message branch — the web announce effect's
     * `0 → noResults`, `1 → resultsCountOne`, `n → resultsCount`. Operates on the post-filter match count.
     */
    fun resultAnnouncement(matchCount: Int): ResultAnnouncement =
        when {
            matchCount <= 0 -> ResultAnnouncement.NoResults
            matchCount == 1 -> ResultAnnouncement.OneResult
            else -> ResultAnnouncement.ManyResults
        }

    /**
     * Maps the options feed's failure onto the shared [QueryErrorKind] recovery bucket so the error surface
     * shows the right copy — the same mapping the sibling Range surface uses.
     */
    fun queryErrorKind(
        errorKind: ErrorKind?,
        httpStatus: Int?,
    ): QueryErrorKind =
        when (errorKind) {
            ErrorKind.CircuitOpen -> QueryErrorKind.Waiting
            ErrorKind.Network, ErrorKind.Timeout -> QueryErrorKind.Network
            ErrorKind.Http ->
                when (httpStatus) {
                    HTTP_UNAUTHORIZED, HTTP_FORBIDDEN -> QueryErrorKind.Unauthorized
                    HTTP_NOT_FOUND -> QueryErrorKind.NotFound
                    else -> QueryErrorKind.ServerError
                }
            ErrorKind.Decode, ErrorKind.Unknown, null -> QueryErrorKind.ServerError
        }

    /**
     * The next active option on ArrowDown — the web `prev < len - 1 ? prev + 1 : 0` wrap-around. Returns -1
     * when there is nothing to highlight.
     */
    fun nextActiveIndex(
        current: Int,
        size: Int,
    ): Int =
        when {
            size <= 0 -> -1
            current < size - 1 -> current + 1
            else -> 0
        }

    /**
     * The previous active option on ArrowUp — the web `prev > 0 ? prev - 1 : len - 1` wrap-around. Returns -1
     * when there is nothing to highlight.
     */
    fun previousActiveIndex(
        current: Int,
        size: Int,
    ): Int =
        when {
            size <= 0 -> -1
            current > 0 -> current - 1
            else -> size - 1
        }

    /**
     * Reconciles the active index when the visible options change — the web reset effect: closed or empty ⇒
     * no active option (-1); an in-range index is preserved; anything else snaps to the first option.
     */
    fun reconcileActiveIndex(
        current: Int,
        open: Boolean,
        size: Int,
    ): Int =
        when {
            !open || size <= 0 -> -1
            current in 0 until size -> current
            else -> 0
        }
}
