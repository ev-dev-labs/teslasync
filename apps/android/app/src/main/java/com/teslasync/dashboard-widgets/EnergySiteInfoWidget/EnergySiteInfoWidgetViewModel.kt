// UI-thread-free state holder backing the Energy Site widget — the native port of the web component's hook
// composition (web/src/features/dashboard/widgets/EnergySiteInfoWidget.tsx). It binds the shared Energy
// feeds (P1/S8) through [EnergySiteInfoSource]: it resolves the first linked site from the
// `useTeslaEnergySites` catalog (web `(sites ?? [])[0]?.energy_site_id`), then projects the
// `useTeslaEnergySiteInfo` cache-then-network envelope for that site onto the shared [UiState] surface
// (loading / content / empty / stale / offline / error). It exposes the single refresh action plus the
// PII-safe `view.opened` diagnostic. The view never performs HTTP — it only collects [state] and calls
// [refresh]/[recordViewOpened].
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/dashboard-widgets/EnergySiteInfoWidget) cannot form a valid Kotlin package.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.dashboard.widgets.energysiteinfo

import io.teslasync.android.data.BaseFeedViewModel
import io.teslasync.android.data.UiState
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.update
import kotlinx.serialization.json.JsonElement

/**
 * @param source the cache-then-network seam (a shared Energy-data-layer adapter in production, a fake in
 *   tests). The view-model owns no networking — it only resolves the linked site and projects the feeds.
 * @param logger the single sanctioned redacting logger (ADR-016); receives `view.opened` + `refresh`.
 * @param scope test seam; production passes nothing and uses `viewModelScope`.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class EnergySiteInfoWidgetViewModel(
    private val source: EnergySiteInfoSource,
    logger: Logger,
    scope: CoroutineScope? = null,
) : BaseFeedViewModel(logger, scope) {
    // Bumping the trigger re-collects the cache-then-network feed (the manual refetch affordance), exactly
    // as the shared store's own trigger ▸ flatMapLatest pipeline does for its memoized feeds.
    private val refreshTrigger = MutableStateFlow(0)
    private var viewOpenedRecorded = false

    /**
     * The site detail as cache-then-network UI state (loading / content / empty / stale / offline / error),
     * carrying the freshness stamp + error kind. Empty mirrors the web `WidgetDetailCard` empty branch — a
     * resolved feed with no detail object (`info == null`) shows the friendly empty state, with the message
     * chosen from [EnergySiteInfoState.hasSites] (no linked site vs. linked-but-no-detail).
     */
    val state: StateFlow<UiState<EnergySiteInfoState>> =
        refreshTrigger
            .flatMapLatest { siteInfoFeed() }
            .asUiState(isEmpty = { it.info == null })

    /** Re-runs the cache-then-network load (the web `refetch()` affordance + the error-surface retry). */
    fun refresh() {
        logger.info("energySiteInfo.refresh")
        refreshTrigger.update { it + 1 }
    }

    /**
     * Emits the one PII-safe `view.opened` diagnostic with the surface slug (P1/S11), at most once per
     * holder. Carries no site capacity / firmware / location payload, so a diagnostics line can never leak
     * the owner's energy system. Call from the composable's first-composition effect.
     */
    fun recordViewOpened() {
        if (viewOpenedRecorded) return
        viewOpenedRecorded = true
        logger.info("view.opened", mapOf("surface" to EnergySiteInfoRegistration.SLUG))
    }

    /**
     * The rendered feed: resolves the first linked site from the catalog and streams that site's detail. A
     * resolved site id drives the detail feed (hard error / retry only ever surfaces from this leg — web
     * `error={infoError ? … : null}`); when no site id resolves, the catalog leg is folded onto the surface
     * — a still-loading catalog stays loading, an empty/idless catalog becomes an empty success, and a hard
     * catalog error degrades to a cached empty (offline chip + the linked/no-site message) rather than the
     * hard error surface — all without ever issuing HTTP from the view.
     */
    private fun siteInfoFeed(): Flow<Resource<EnergySiteInfoState>> =
        source.energySites().flatMapLatest { sitesResource ->
            val siteId = parseFirstSiteId(sitesResource.cached)
            if (siteId != null) {
                source.energySiteInfo(siteId).map { it.toSiteInfoState() }
            } else {
                flowOf(noSiteResource(sitesResource))
            }
        }

    /**
     * Projects a `…/site-info` emission onto the domain state, decoding `data` into [EnergySiteInfo] while
     * preserving the cache-then-network freshness. `hasSites` is `true` because this leg is reached only
     * after a site id resolved. An info error with no cache stays a [Resource.Error] with `cached = null`,
     * so it surfaces as the hard error + retry (web `infoError`); an info error with a cached detail keeps
     * the detail visible behind the offline chip.
     */
    private fun Resource<JsonElement>.toSiteInfoState(): Resource<EnergySiteInfoState> =
        when (this) {
            is Resource.Loading ->
                Resource.Loading(cached = cached?.let { siteState(it) }, fetchedAt = fetchedAt, stale = stale)
            is Resource.Success ->
                Resource.Success(siteState(data), fetchedAt = fetchedAt, stale = stale)
            is Resource.Error ->
                Resource.Error(cached = cached?.let { siteState(it) }, fetchedAt = fetchedAt, stale = stale, error = error)
        }

    private fun siteState(json: JsonElement): EnergySiteInfoState = EnergySiteInfoState(hasSites = true, info = parseSiteInfo(json))

    /**
     * Folds a catalog emission that yields no usable site id onto the detail surface: a still-loading
     * catalog stays loading (skeleton); a resolved catalog becomes an empty success whose
     * [EnergySiteInfoState.hasSites] decides the message (linked-but-no-detail vs. no linked site); a hard
     * catalog error becomes a cached empty with `stale = true` + the error kind, so the surface shows the
     * friendly empty state behind an offline/error chip rather than the hard error screen.
     */
    private fun noSiteResource(sites: Resource<JsonElement>): Resource<EnergySiteInfoState> {
        val resolved = EnergySiteInfoState(hasSites = parseHasSite(sites.cached), info = null)
        return when (sites) {
            is Resource.Loading -> Resource.Loading(cached = null, fetchedAt = sites.fetchedAt, stale = sites.stale)
            is Resource.Success -> Resource.Success(resolved, fetchedAt = sites.fetchedAt, stale = sites.stale)
            is Resource.Error ->
                Resource.Error(cached = resolved, fetchedAt = sites.fetchedAt, stale = true, error = sites.error)
        }
    }
}
