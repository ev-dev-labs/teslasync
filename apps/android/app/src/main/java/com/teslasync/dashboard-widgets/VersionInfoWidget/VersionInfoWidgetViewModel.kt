// UI-thread-free state holder backing the Version Info widget — the native port of the web component's hook
// composition (web/src/features/dashboard/widgets/VersionInfoWidget.tsx). It binds the shared Settings feeds
// (P1/S8) through [VersionInfoSource]: the `useVersionInfo` envelope drives the shared [UiState] surface
// (loading / content / empty / stale / offline / error) and the `useCaptureStats` envelope is folded in as
// best-effort stat data that never gates the shell — mirroring the web, whose loading/error/empty all key
// off `version` (`isLoading = version.isLoading`, `hasData = version.data != null`) while `capture.data` is
// read opportunistically with `?? 0`. It exposes the single refresh action plus the PII-safe `view.opened`
// diagnostic. The view never performs HTTP — it only collects [state] and calls [refresh]/[recordViewOpened].
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/dashboard-widgets/VersionInfoWidget) cannot form a valid Kotlin package.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.dashboard.widgets.versioninfo

import io.teslasync.android.data.BaseFeedViewModel
import io.teslasync.android.data.UiState
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.update
import kotlinx.serialization.json.JsonElement

/**
 * @param source the cache-then-network seam (a shared Settings-data-layer adapter in production, a fake in
 *   tests). The view-model owns no networking — it only composes the two feeds and projects them.
 * @param logger the single sanctioned redacting logger (ADR-016); receives `view.opened` + `refresh`.
 * @param scope test seam; production passes nothing and uses `viewModelScope`.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class VersionInfoWidgetViewModel(
    private val source: VersionInfoSource,
    logger: Logger,
    scope: CoroutineScope? = null,
) : BaseFeedViewModel(logger, scope) {
    // Bumping the trigger re-collects both cache-then-network feeds (the manual refetch affordance), exactly
    // as the shared store's own trigger ▸ flatMapLatest pipeline does for its memoized feeds.
    private val refreshTrigger = MutableStateFlow(0)
    private var viewOpenedRecorded = false

    /**
     * The composed surface as cache-then-network UI state (loading / content / stale / offline / error),
     * carrying the freshness stamp + error kind from the **version** feed — the leg that backs the web
     * `WidgetShell` freshness contract and the only one that can raise the hard error / empty surface (web
     * `isLoading`/`error`/`hasData` all read `version`). Empty mirrors the web `version.data == null` guard;
     * a decoded `/system/version` payload is always an object, so — as on the web — the empty branch is a
     * defensive fallback the stateless renderer still honours.
     */
    val state: StateFlow<UiState<VersionInfoState>> =
        refreshTrigger
            .flatMapLatest { composedFeed() }
            .asUiState(isEmpty = { it.version == null })

    /** Re-runs the cache-then-network load (the web `refetch()` affordance + the error-surface retry). */
    fun refresh() {
        logger.info("versionInfo.refresh")
        refreshTrigger.update { it + 1 }
    }

    /**
     * Emits the one PII-safe `view.opened` diagnostic with the surface slug (P1/S11), at most once per
     * holder. Carries no version / build / capture payload, so a diagnostics line can never leak deployment
     * detail. Call from the composable's first-composition effect.
     */
    fun recordViewOpened() {
        if (viewOpenedRecorded) return
        viewOpenedRecorded = true
        logger.info("view.opened", mapOf("surface" to VersionInfoRegistration.SLUG))
    }

    /**
     * Composes the two feeds: the version envelope drives the resulting [Resource] (its Loading/Success/Error
     * + freshness flags surface unchanged), while the capture envelope is folded in as best-effort stat data
     * read from whatever is currently cached — a still-loading or failed capture feed never degrades the
     * surface, exactly like the web reading `capture.data` with `?? 0`.
     */
    private fun composedFeed(): Flow<Resource<VersionInfoState>> =
        combine(source.versionInfo(), source.captureStats()) { versionResource, captureResource ->
            versionResource.withCapture(VersionInfoProjection.parseCapture(captureResource.cached))
        }

    private fun Resource<JsonElement>.withCapture(capture: CaptureFields): Resource<VersionInfoState> =
        when (this) {
            is Resource.Loading ->
                Resource.Loading(cached = cached?.let { stateOf(it, capture) }, fetchedAt = fetchedAt, stale = stale)
            is Resource.Success ->
                Resource.Success(stateOf(data, capture), fetchedAt = fetchedAt, stale = stale)
            is Resource.Error ->
                Resource.Error(cached = cached?.let { stateOf(it, capture) }, fetchedAt = fetchedAt, stale = stale, error = error)
        }

    private fun stateOf(
        versionJson: JsonElement,
        capture: CaptureFields,
    ): VersionInfoState = VersionInfoState(version = VersionInfoProjection.parseVersion(versionJson), capture = capture)
}
