// The single data port the MaintenanceBanner shared surface binds to — the native analogue of the web source's
// hook (web/src/components/feedback/MaintenanceBanner.tsx: `useSystemHealth`). The web banner reads the resolved
// service-mode view from `/system/health`; the native port binds the shared `AdminStore.systemHealth()` feed
// (the cross-platform port of the `useAdmin` hook domain, the same `/system/health` cache-then-network
// `Resource` `SystemHealthWidget` shares). The view-model depends on this abstraction (a real adapter over the
// shared Admin layer in production, a fake in tests), never on a concrete store or HTTP client, so the view
// performs NO HTTP itself (P1/S8 boundary, ADR-002).
//
// `Resource<JsonElement>.mapToSnapshot` is the cached-payload → typed-projection data adapter that bridge is
// unit-tested on: the raw `/system/health` JSON is parsed through [MaintenanceBannerSnapshot.fromJson] at every
// emission so an instant cold-start cache replay and an offline "last known" value both render the real window,
// while a `Loading` with nothing cached stays a first load (web `!data`).
//
// `InvalidPackageDeclaration` is suppressed because the mandated surface directory
// (com/teslasync/shared-surfaces/MaintenanceBanner) cannot form a valid Kotlin package;
// `ktlint:standard:filename` / `MatchingDeclarationName` are suppressed for the co-located adapters alongside
// the namesake interface.
@file:Suppress("ktlint:standard:filename", "MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.maintenancebanner

import io.teslasync.shared.core.data.repo.AdminRepository
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.presentation.admin.AdminStore
import kotlinx.coroutines.flow.Flow
import kotlinx.serialization.json.JsonElement

/**
 * The seam the [MaintenanceBannerViewModel] binds to so it depends on an abstraction (real adapter ↔ test
 * fake), never on a concrete store or HTTP client. [systemHealth] is the cache-then-network `/system/health`
 * `Resource` stream the banner folds its mode / message / countdown / freshness from (web `useSystemHealth`).
 * No HTTP touches the view.
 */
interface MaintenanceBannerSource {
    /** Stream the cache-then-network `/system/health` payload (web `useSystemHealth`). */
    fun systemHealth(): Flow<Resource<JsonElement>>
}

/**
 * Binds the surface to the shared S8 [AdminStore] — the holder the `/system/health` feed is already shared on
 * app-wide (the KMP port of the `useSystemHealth` hook). Every observer of the same feed folds into one
 * upstream collection. Use this when a host shares one app-wide Admin feed across surfaces.
 */
fun maintenanceBannerSource(store: AdminStore): MaintenanceBannerSource =
    object : MaintenanceBannerSource {
        override fun systemHealth(): Flow<Resource<JsonElement>> = store.systemHealth()
    }

/**
 * Binds the surface to the shared S7 [AdminRepository] — the same cache-then-network data port the [AdminStore]
 * wraps. Each [MaintenanceBannerSource.systemHealth] call starts a new repository collection, so the
 * ViewModel's refresh triggers a real re-fetch (mirroring the web hook's `refetch`).
 */
fun maintenanceBannerSource(repository: AdminRepository): MaintenanceBannerSource =
    object : MaintenanceBannerSource {
        override fun systemHealth(): Flow<Resource<JsonElement>> = repository.systemHealth()
    }

/**
 * Builds a [MaintenanceBannerSource] from a [feed] provider — the host wiring seam used when a caller already
 * has the `/system/health` `Resource` flow in hand, and the test double used to drive each feed state
 * deterministically. Mirrors the contract of the store / repository adapters above.
 */
fun maintenanceBannerSource(feed: () -> Flow<Resource<JsonElement>>): MaintenanceBannerSource =
    object : MaintenanceBannerSource {
        override fun systemHealth(): Flow<Resource<JsonElement>> = feed()
    }

/**
 * Maps the shared feed's raw `/system/health` [Resource] (`JsonElement`, P1/S8) onto a typed
 * [MaintenanceBannerSnapshot] `Resource` — the single seam the ViewModel folds the banner state from. The
 * cached payload is parsed through [MaintenanceBannerSnapshot.fromJson] at every emission: a `Loading` /
 * `Error` with no cache keeps a `null` snapshot (web `!data` → banner absent), a present-but-unparseable
 * success falls back to [MaintenanceBannerSnapshot.ABSENT] (mode `ok` → banner hidden), and a resolved object
 * carries the real mode / message / until / updated_at through unchanged.
 */
fun Resource<JsonElement>.mapToSnapshot(): Resource<MaintenanceBannerSnapshot> =
    when (this) {
        is Resource.Loading ->
            Resource.Loading(cached = MaintenanceBannerSnapshot.fromJson(cached), fetchedAt = fetchedAt, stale = stale)

        is Resource.Success ->
            Resource.Success(
                data = MaintenanceBannerSnapshot.fromJson(data) ?: MaintenanceBannerSnapshot.ABSENT,
                fetchedAt = fetchedAt,
                stale = stale,
            )

        is Resource.Error ->
            Resource.Error(
                cached = MaintenanceBannerSnapshot.fromJson(cached),
                fetchedAt = fetchedAt,
                stale = stale,
                error = error,
            )
    }
