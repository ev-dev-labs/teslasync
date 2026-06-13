// Pure, framework-free model + projection for the Combobox shared surface — the native analogue of
// everything the web component derives before returning JSX (web/src/components/forms/Combobox.tsx). No
// Compose, no Android, no HTTP: every declaration here is unit-tested off-device in the
// :android:testReleaseUnitTest gate, keeping the composable a thin render layer.
//
// The web `Combobox` is the shared "type to filter then pick" primitive (signal pickers, geocoded address
// inputs, vehicle pickers, …). It does not fetch on its own: the parent supplies `options` as either a
// static array (filtered locally via `defaultFilter`) or an async loader keyed by the typed query (every
// keystroke aborts the previous in-flight request). This native surface keeps that contract by binding the
// options through the shared S8 state-holder seam ([ComboboxSource]) — never HTTP of its own — and projects
// the resulting cache-then-network [Resource] (interpreted once, by the canonical
// [io.teslasync.android.data.toUiState]) onto the full lifecycle the prompt mandates: loading / results /
// empty / error, plus the ADR-013 stale·refreshing·offline freshness flags carried over cached rows.
//
// On top of the lifecycle this reproduces the rest of the web source's derivations exactly: the
// `maxVisibleOptions` cap with the "{{count}} more — refine search" remainder, the selected-row highlight,
// the active-descendant index (clamped + defaulted to the first row, reusing the shared
// [io.teslasync.android.components.forms.clampActiveIndex]), the clear-affordance visibility
// (`value !== null || inputValue.length > 0`), and the `useAnnouncer` result-count message
// (0 → "No results", 1 → "1 result", n → "{{count}} results").
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/shared-surfaces/Combobox — the P3 prompt's allowed-files path) cannot form a valid Kotlin
// package (a hyphen is illegal in a package identifier), so the package intentionally diverges from the
// path. `MatchingDeclarationName` is suppressed for the co-located supporting declarations.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.combobox

import io.teslasync.android.components.feedback.QueryErrorKind
import io.teslasync.android.components.forms.ComboOption
import io.teslasync.android.components.forms.clampActiveIndex
import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import io.teslasync.shared.core.diagnostics.Logger

/**
 * Canonical registry metadata for this surface — the native mirror of the web component's contract. The
 * diagnostics slug and the default visible-option cap (web `maxVisibleOptions = 50`) are pinned here so the
 * native and web surfaces stay in lockstep.
 */
object ComboboxRegistration {
    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). */
    const val SLUG: String = "Combobox"

    /** Default cap on the rows rendered in the dropdown (web `maxVisibleOptions = 50`). */
    const val DEFAULT_MAX_VISIBLE_OPTIONS: Int = 50

    /** The active-descendant sentinel meaning "no option is highlighted" (web `activeIndex = -1`). */
    const val NO_ACTIVE_INDEX: Int = -1
}

/**
 * The mutually-exclusive surface the dropdown renders for the current query — the native mirror of the web
 * Combobox's option-list branches (a loading indicator, the options list, or a "No results" row) extended
 * with the explicit error surface the prompt's state matrix mandates. Freshness (stale/refreshing/offline)
 * is carried as orthogonal flags on [ComboboxDisplay] so cached rows stay visible while a chip is shown.
 */
enum class ComboboxPhase {
    /** A first option load is in flight with nothing cached — a loading row (web Combobox `loading`). */
    Loading,

    /** One or more options are available to pick (fresh or cached). */
    Results,

    /** The feed resolved with zero matching options — a friendly "No results" row, never a blank menu. */
    Empty,

    /** A hard option-load failure with nothing cached to fall back on — an error row with a retry affordance. */
    Error,
}

/**
 * One render-ready dropdown row — a filtered [option] plus the two flags the web `<li role="option">`
 * carries: whether it is the currently-[selected] value (web `aria-selected` + bold) and whether it is the
 * [active] descendant the keyboard cursor sits on (web `activeIndex` highlight).
 */
data class ComboboxOptionRow(
    val option: ComboOption,
    val selected: Boolean,
    val active: Boolean,
)

/**
 * The projected, render-ready dropdown state — everything the web component computes for the option list
 * before mapping it to `<li>` rows, plus the ADR-013 freshness flags.
 *
 * @property phase the primary dropdown surface to render.
 * @property visibleOptions the capped rows to show (web `filteredOptions.slice(0, maxVisibleOptions)`).
 * @property totalCount the full filtered count before the cap (web `filteredOptions.length`).
 * @property hiddenCount how many filtered options the cap dropped (web `length - visible.length`).
 * @property stale whether [visibleOptions] are flagged stale (older than TTL, refresh in flight, no failure).
 * @property offline whether cached [visibleOptions] are shown because a refresh failed (network unreachable).
 * @property refreshing whether a refresh is currently running over already-shown rows.
 * @property errorKind the classification of the most recent failure, or `null` when there is none.
 * @property httpStatus the HTTP status when [errorKind] is [ErrorKind.Http], else `null`.
 * @property canRetry whether a retry affordance should be offered (hard error, or stale/offline cache).
 * @property freshnessStamp the `fetchedAt` of the shown rows; keys the stale auto-refresh effect.
 */
data class ComboboxDisplay(
    val phase: ComboboxPhase,
    val visibleOptions: List<ComboOption> = emptyList(),
    val totalCount: Int = 0,
    val hiddenCount: Int = 0,
    val stale: Boolean = false,
    val offline: Boolean = false,
    val refreshing: Boolean = false,
    val errorKind: ErrorKind? = null,
    val httpStatus: Int? = null,
    val canRetry: Boolean = false,
    val freshnessStamp: Long? = null,
) {
    /** True while a loading mark should spin in the input (web Combobox `loading` indicator). */
    val busy: Boolean get() = phase == ComboboxPhase.Loading || refreshing

    /** True when a freshness chip (stale or offline) should be shown over the cached rows. */
    val showFreshnessChip: Boolean get() = stale || offline

    /** True when more filtered options exist than the cap shows (web "{{count}} more — refine search"). */
    val hasHiddenOptions: Boolean get() = hiddenCount > 0
}

/**
 * The immutable, render-ready model the composable draws — the dropdown [display] folded together with the
 * interaction state the web component owns: the typed [query], whether the listbox is [expanded], the
 * highlighted [activeIndex], and the current [selectedValue]/[selectedLabel]. Pure data so the projection is
 * unit-tested without a UI host.
 *
 * @property rows the visible options enriched with their selected/active flags.
 * @property selectedLabel the label shown in the collapsed input (web `getOptionLabel(value)`).
 * @property clearable whether the clear (×) affordance shows (web `value !== null || inputValue.length > 0`).
 */
data class ComboboxUiModel(
    val display: ComboboxDisplay,
    val rows: List<ComboboxOptionRow>,
    val query: String,
    val expanded: Boolean,
    val activeIndex: Int,
    val selectedValue: String?,
    val selectedLabel: String,
    val clearable: Boolean,
)

/**
 * The transient interaction state the web Combobox owns alongside the option feed — the typed [query], the
 * open/closed [expanded] listbox, the highlighted [activeIndex], and the current [selected] option. Grouped
 * into one value so [ComboboxProjection.project] folds the feed and the interaction together in a single call.
 */
data class ComboboxInteraction(
    val selected: ComboOption? = null,
    val query: String = "",
    val expanded: Boolean = false,
    val activeIndex: Int = ComboboxRegistration.NO_ACTIVE_INDEX,
)

/**
 * The screen-reader result-count announcement the web `useAnnouncer` emits as the user types — a pure
 * descriptor (no localized text) so the threshold logic is unit-tested off-device and the composable maps it
 * to a `stringResource` at the render boundary.
 */
sealed interface ResultCount {
    /** Zero matches — announces "No results" (web `combobox.noResults`). */
    data object None : ResultCount

    /** Exactly one match — announces "1 result" (web `combobox.resultsCountOne`). */
    data object One : ResultCount

    /** [count] matches — announces "{{count}} results" (web `combobox.resultsCount`). */
    data class Many(
        val count: Int,
    ) : ResultCount
}

/**
 * Pure projection from the option feed + interaction state to the render-ready [ComboboxUiModel] — a 1:1
 * port of the web Combobox's option derivations: the `maxVisibleOptions` cap, the active-descendant clamp,
 * the selected-row highlight, the clear-affordance visibility, and the result-count announcement, layered
 * onto the shared cache-then-network lifecycle so freshness is interpreted identically here and on every
 * other native surface.
 */
object ComboboxProjection {
    private const val HTTP_UNAUTHORIZED = 401
    private const val HTTP_FORBIDDEN = 403
    private const val HTTP_NOT_FOUND = 404

    /**
     * Folds the option-feed [state] together with the [interaction] inputs into the render-ready model. The
     * dropdown phase is taken verbatim from the shared [toUiState] projection (so error-with-cache stays a
     * visible Results/Empty surface flagged offline, never a blank error), the rows are capped at
     * [maxVisibleOptions], the selected option drives the highlight + collapsed label, and the active
     * descendant is clamped into range (defaulting to the first row while the open listbox has results).
     */
    fun project(
        state: UiState<List<ComboOption>>,
        interaction: ComboboxInteraction,
        maxVisibleOptions: Int = ComboboxRegistration.DEFAULT_MAX_VISIBLE_OPTIONS,
    ): ComboboxUiModel {
        val options = state.data ?: emptyList()
        val cap = maxVisibleOptions.coerceAtLeast(0)
        val visible = if (cap == 0 || options.size <= cap) options else options.take(cap)
        val phase =
            when (state.phase) {
                UiPhase.Loading -> ComboboxPhase.Loading
                UiPhase.Empty -> ComboboxPhase.Empty
                UiPhase.Error -> ComboboxPhase.Error
                UiPhase.Content -> ComboboxPhase.Results
            }
        val activeIndex = resolveActiveIndex(interaction.activeIndex, visible.size, interaction.expanded, phase)
        val selectedValue = interaction.selected?.value
        val rows =
            visible.mapIndexed { index, option ->
                ComboboxOptionRow(
                    option = option,
                    selected = selectedValue != null && option.value == selectedValue,
                    active = index == activeIndex,
                )
            }
        val display =
            ComboboxDisplay(
                phase = phase,
                visibleOptions = visible,
                totalCount = options.size,
                hiddenCount = (options.size - visible.size).coerceAtLeast(0),
                stale = state.stale && state.errorKind == null,
                offline = state.stale && state.hasData && state.errorKind != null,
                refreshing = state.refreshing,
                errorKind = state.errorKind,
                httpStatus = state.httpStatus,
                canRetry = state.canRetry,
                freshnessStamp = state.fetchedAt,
            )
        return ComboboxUiModel(
            display = display,
            rows = rows,
            query = interaction.query,
            expanded = interaction.expanded,
            activeIndex = activeIndex,
            selectedValue = selectedValue,
            selectedLabel = interaction.selected?.label.orEmpty(),
            clearable = interaction.selected != null || interaction.query.isNotEmpty(),
        )
    }

    /**
     * The render-ready active-descendant index — the native port of the web effect that resets the active
     * option whenever the visible set changes. A highlight exists only while the listbox is [expanded] and
     * actually has [ComboboxPhase.Results]; the raw index is clamped into `[0, visibleCount)` (defaulting to
     * the first row, mirroring the web "default to first option when open and there are options").
     */
    fun resolveActiveIndex(
        rawActiveIndex: Int,
        visibleCount: Int,
        expanded: Boolean,
        phase: ComboboxPhase,
    ): Int {
        if (!expanded || phase != ComboboxPhase.Results || visibleCount == 0) return ComboboxRegistration.NO_ACTIVE_INDEX
        val clamped = clampActiveIndex(rawActiveIndex, visibleCount)
        return if (clamped < 0) 0 else clamped
    }

    /**
     * The screen-reader result-count descriptor for [resultCount] — the native port of the web
     * `useAnnouncer` message selection (0 → none, 1 → one, n → many), pure so the thresholds are unit-tested.
     */
    fun announcement(resultCount: Int): ResultCount =
        when {
            resultCount <= 0 -> ResultCount.None
            resultCount == 1 -> ResultCount.One
            else -> ResultCount.Many(resultCount)
        }

    /**
     * Maps the hard-error [display] onto the shared [QueryErrorKind] recovery bucket so the error row shows
     * the right copy: an open breaker → [QueryErrorKind.Waiting]; a connectivity failure →
     * [QueryErrorKind.Network]; a 401/403 → [QueryErrorKind.Unauthorized]; a 404 → [QueryErrorKind.NotFound];
     * every other HTTP/decode/unknown failure → [QueryErrorKind.ServerError] with a retry affordance.
     */
    fun queryErrorKind(display: ComboboxDisplay): QueryErrorKind =
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

/**
 * The one PII-safe diagnostic this surface emits (P1/S11). Carries only the surface [ComboboxRegistration.SLUG]
 * — never the typed query text or any resolved option label/value — so a diagnostics line can never leak what
 * the user is searching for or which option they picked.
 */
object ComboboxDiagnostics {
    private const val VIEW_OPENED = "view.opened"
    private const val SURFACE_KEY = "surface"

    /** The structured event name emitted when the user re-fetches the option feed after an error/stale chip. */
    const val REFRESH_EVENT: String = "combobox.refresh"

    /** The single structured field every diagnostic carries — the surface slug, nothing else. */
    fun surfaceField(): Map<String, String> = mapOf(SURFACE_KEY to ComboboxRegistration.SLUG)

    /** Emits the `view.opened` diagnostic for this surface. Call from the composable's first-composition effect. */
    fun recordViewOpened(logger: Logger) = logger.info(VIEW_OPENED, surfaceField())

    /** Emits the `combobox.refresh` diagnostic when the option feed is re-fetched (retry / stale refresh). */
    fun recordRefresh(logger: Logger) = logger.info(REFRESH_EVENT, surfaceField())
}
