// Pure, framework-free model + projection for the SavedViewMenu shared surface — the native analogue of the
// data the web component derives before returning JSX (web/src/components/data-display/SavedViewMenu.tsx: the
// `useSavedViews` + `useSearchParams` composition that computes the sorted rows, the active view, the default
// view, and the first-mount auto-apply). No Compose, no Android UI, no HTTP: every type here is exercised by
// the :android:testReleaseUnitTest gate so the composable stays a thin render layer.
//
// The web component lists the saved views (pinned first), badges the one whose `query` matches the current
// querystring as "applied", and — on first mount, when the URL has no querystring and a default view exists —
// auto-applies that default exactly once. This model reproduces that selection + ordering exactly and folds
// in the cache-then-network lifecycle of the saved-views feed (the genuine async dependency behind the hook)
// so the surface can honestly render the prompt's loading / empty / error / stale / offline matrix without
// ever hiding a region.
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/shared-surfaces/SavedViewMenu — the P3 prompt's allowed-files path) cannot form a valid
// Kotlin package (a hyphen is illegal in a package identifier), so the package intentionally diverges from
// the path. `MatchingDeclarationName` is suppressed for the co-located supporting types.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.savedviewmenu

import io.teslasync.android.components.feedback.QueryErrorKind
import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import io.teslasync.shared.core.presentation.savedviews.SavedView

/**
 * Canonical registry metadata for this surface — the native mirror of the web component's contract. The
 * diagnostics slug, the structured log event names, and the toast i18n keys (the web `useMutationToast`
 * keys) are pinned here so the native and web surfaces stay in lockstep.
 */
object SavedViewMenuRegistration {
    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). */
    const val SLUG: String = "SavedViewMenu"

    /** Structured-log field key carrying the surface slug. */
    const val SURFACE_KEY: String = "surface"

    /** Structured-log field key carrying a classified [ErrorKind] name on a mutation failure. */
    const val KIND_KEY: String = "kind"

    const val EVENT_VIEW_OPENED: String = "view.opened"
    const val EVENT_REFRESH: String = "savedViews.refresh"
    const val EVENT_CREATE: String = "savedViews.create"
    const val EVENT_CREATE_FAILED: String = "savedViews.createFailed"
    const val EVENT_UPDATE: String = "savedViews.update"
    const val EVENT_UPDATE_FAILED: String = "savedViews.updateFailed"
    const val EVENT_DELETE: String = "savedViews.delete"
    const val EVENT_DELETE_FAILED: String = "savedViews.deleteFailed"
    const val EVENT_SET_DEFAULT: String = "savedViews.setDefault"
    const val EVENT_SET_DEFAULT_FAILED: String = "savedViews.setDefaultFailed"

    // Toast i18n keys — the exact web `useMutationToast` keys (web/src/api/hooks/useSavedViews.ts), each with
    // a matching entry in the P1/S10 catalog (translation_toast_savedViews_*). The render boundary owns the
    // lookup; the keys never carry a pre-localized sentence (ADR-014).
    const val TOAST_CREATE_SUCCESS: String = "toast.savedViews.create.success"
    const val TOAST_CREATE_ERROR: String = "toast.savedViews.create.error"
    const val TOAST_UPDATE_SUCCESS: String = "toast.savedViews.update.success"
    const val TOAST_UPDATE_ERROR: String = "toast.savedViews.update.error"
    const val TOAST_DELETE_SUCCESS: String = "toast.savedViews.delete.success"
    const val TOAST_DELETE_ERROR: String = "toast.savedViews.delete.error"
    const val TOAST_SET_DEFAULT_SUCCESS: String = "toast.savedViews.setDefault.success"
    const val TOAST_SET_DEFAULT_ERROR: String = "toast.savedViews.setDefault.error"
    const val TOAST_UNSET_DEFAULT_SUCCESS: String = "toast.savedViews.unsetDefault.success"
}

/**
 * Localized labels the surface folds into its output. Built from `stringResource` at the render boundary
 * (tests pass a deterministic instance), keeping [SavedViewMenuProjection] a pure, locale-stable function.
 * Every string resolves through the P1/S10 catalog; the two `*Template` fields carry a positional `%1$s`
 * argument that [deleteConfirm] / [announceApplied] fill in at the render boundary.
 */
data class SavedViewMenuStrings(
    val title: String,
    val manage: String,
    val empty: String,
    val saveCurrent: String,
    val defaultBadge: String,
    val setDefault: String,
    val unsetDefault: String,
    val pin: String,
    val unpin: String,
    val rename: String,
    val delete: String,
    val cancel: String,
    val save: String,
    val saving: String,
    val close: String,
    val name: String,
    val nameHint: String,
    val makeDefault: String,
    val appliedBadge: String,
    val clearApplied: String,
    val emptyQuery: String,
    val deleteTitle: String,
    val deleteConfirmTemplate: String,
    val staleLabel: String,
    val offlineLabel: String,
    val loadingLabel: String,
    val announceAppliedTemplate: String,
    val announceCleared: String,
) {
    /** The delete confirmation prompt with [name] interpolated (web `savedViews.deleteConfirm`). */
    fun deleteConfirm(name: String): String = deleteConfirmTemplate.format(name)

    /** The polite "view applied" announcement with [name] interpolated (web `savedViews.announceApplied`). */
    fun announceApplied(name: String): String = announceAppliedTemplate.format(name)
}

/**
 * The immutable, render-ready projection the composable draws — everything the web `SavedViewMenu` folds
 * together from `useSavedViews` + `useSearchParams`: the ordered [views] (pinned first), the [activeView]
 * whose `query` matches the current querystring, the [defaultView] (for the first-mount auto-apply), and the
 * cache-then-network freshness envelope ([stale]/[offline]/[refreshing] + [errorKind]) so the surface
 * honestly flags last-known data instead of presenting it as live. Pure data so [SavedViewMenuProjection] is
 * unit-tested without a UI host.
 *
 * @property phase the primary list surface to render (loading / content / empty / error).
 * @property views the saved views, pinned first then case-insensitively by name (web ordering).
 * @property activeView the view whose `query` equals the current querystring, or `null`.
 * @property defaultView the view flagged as default, or `null`.
 * @property freshnessStamp the `fetchedAt` of the shown rows; keys the stale auto-refresh effect.
 */
data class SavedViewMenuDisplay(
    val phase: UiPhase,
    val views: List<SavedView> = emptyList(),
    val activeView: SavedView? = null,
    val defaultView: SavedView? = null,
    val stale: Boolean = false,
    val offline: Boolean = false,
    val refreshing: Boolean = false,
    val errorKind: ErrorKind? = null,
    val httpStatus: Int? = null,
    val freshnessStamp: Long? = null,
) {
    /** True when a freshness chip (stale or offline) should be shown over the cached rows. */
    val showFreshnessChip: Boolean get() = stale || offline

    /** True when a retry affordance should be offered (the hard-error surface). */
    val canRetry: Boolean get() = phase == UiPhase.Error

    /** True when there are rows to render. */
    val hasViews: Boolean get() = views.isNotEmpty()
}

/**
 * Pure projection + selection logic for the SavedViewMenu surface — the native port of the web component's
 * `useMemo`-derived `views` / `activeView` / `defaultView` and its first-mount auto-apply decision.
 */
object SavedViewMenuProjection {
    private const val HTTP_UNAUTHORIZED = 401
    private const val HTTP_FORBIDDEN = 403
    private const val HTTP_NOT_FOUND = 404

    /**
     * Orders the saved views the way the menu renders them — pinned first, then case-insensitively by name.
     * Mirrors the existing native `sortedSavedViews` ordering and the web component's "pinned views first,
     * then unpinned" contract.
     */
    fun sortViews(views: List<SavedView>): List<SavedView> =
        views.sortedWith(compareByDescending<SavedView> { it.isPinned }.thenBy { it.name.lowercase() })

    /** The view whose `query` matches [currentQuery] — the web `views.find(v => v.query === currentQuery)`. */
    fun activeView(
        views: List<SavedView>,
        currentQuery: String,
    ): SavedView? = views.firstOrNull { it.query == currentQuery }

    /** The default view — the web `views.find(v => v.is_default)`. */
    fun defaultView(views: List<SavedView>): SavedView? = views.firstOrNull { it.isDefault }

    /**
     * Whether the first-mount auto-apply should fire — the web mount effect that applies the default view's
     * query exactly once when the URL has no querystring and a default exists. The once-guard is the
     * caller's (a remembered flag), exactly as the web `autoAppliedRef` guards re-application.
     */
    fun shouldAutoApplyDefault(
        currentQuery: String,
        default: SavedView?,
    ): Boolean = default != null && currentQuery.isEmpty()

    /**
     * Folds the saved-views [state] (the cache-then-network feed) and the current querystring into the
     * render-ready [SavedViewMenuDisplay]. The list phase comes straight from the feed's [UiState] (loading /
     * content / empty / error), and the stale/offline envelope honours the ADR-013 freshness contract so
     * cached rows shown after a failed refresh are flagged, never presented as live.
     */
    fun project(
        state: UiState<List<SavedView>>,
        currentQuery: String,
    ): SavedViewMenuDisplay {
        val views = sortViews(state.data ?: emptyList())
        return SavedViewMenuDisplay(
            phase = state.phase,
            views = views,
            activeView = activeView(views, currentQuery),
            defaultView = defaultView(views),
            stale = state.stale && state.errorKind == null,
            offline = state.stale && state.hasData && state.errorKind != null,
            refreshing = state.refreshing,
            errorKind = state.errorKind,
            httpStatus = state.httpStatus,
            freshnessStamp = state.fetchedAt,
        )
    }

    /**
     * Maps the hard-error [display] onto the shared [QueryErrorKind] recovery bucket so the error surface
     * shows the right copy: an open breaker → [QueryErrorKind.Waiting]; a connectivity failure →
     * [QueryErrorKind.Network]; a 401/403 → [QueryErrorKind.Unauthorized]; a 404 → [QueryErrorKind.NotFound];
     * every other HTTP/decode/unknown failure → [QueryErrorKind.ServerError] with a retry affordance.
     */
    fun queryErrorKind(display: SavedViewMenuDisplay): QueryErrorKind =
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
