// The data seam the Health Probes section binds to, plus its production bindings over the shared S8
// AdminStore / S7 AdminRepository. Named after the surface bundle (HealthProbesSection*) rather than the
// single interface it declares. The view (composable) performs NO HTTP — it only collects state from the
// ViewModel, which drives this seam, satisfying the "no direct HTTP from the view" contract while
// reproducing the web component's single `useQuery(getExtendedHealth, refetchInterval: 30s)` polling feed.
//
// The web `HealthProbesSection` reads exactly one endpoint — `getExtendedHealth` → `GET /system/health` —
// so this seam declares exactly one feed, [systemHealth], mirroring the web hook 1:1. It is the same
// `/system/health` feed the shared [AdminStore] already shares app-wide (the KMP port of the `useAdmin`
// hook domain), so every observer folds into one upstream collection.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/feature-views/HealthProbesSection) cannot form a valid Kotlin package.
@file:Suppress("ktlint:standard:filename", "MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.healthprobes

import io.teslasync.shared.core.data.repo.AdminRepository
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.presentation.admin.AdminStore
import kotlinx.coroutines.flow.Flow
import kotlinx.serialization.json.JsonElement

/**
 * The single seam the [HealthProbesSectionViewModel] depends on so it binds to an abstraction (real
 * adapter ↔ test fake), never to a concrete client — the Android analogue of the web component's
 * `useQuery(getExtendedHealth)` (P1/S8 state-holder boundary). [systemHealth] streams the cache-then-network
 * `/system/health` payload (web `getExtendedHealth`); each call returns a fresh [Resource] flow so the
 * ViewModel's refresh / retry restart a real upstream collection. No HTTP touches the view.
 */
interface HealthProbesSectionSource {
    /** Stream the cache-then-network `/system/health` payload (web `getExtendedHealth`). */
    fun systemHealth(): Flow<Resource<JsonElement>>
}

/**
 * Binds the surface to the shared S8 [AdminStore] — the holder the `/system/health` feed is already shared
 * through app-wide (the KMP port of the `useAdmin` hook domain). The read uses the store's shared feed, so
 * every observer of `systemHealth` folds into one upstream collection. Use this when a host shares one
 * app-wide Admin feed across surfaces.
 */
fun healthProbesSource(store: AdminStore): HealthProbesSectionSource =
    object : HealthProbesSectionSource {
        override fun systemHealth(): Flow<Resource<JsonElement>> = store.systemHealth()
    }

/**
 * Binds the surface to the shared S7 [AdminRepository] — the same cache-then-network data port the
 * [AdminStore] wraps. Each [HealthProbesSectionSource.systemHealth] call starts a new repository
 * collection, so the ViewModel's refresh / retry trigger a real re-fetch (mirroring the web hook's
 * `refetch`).
 */
fun healthProbesSource(repository: AdminRepository): HealthProbesSectionSource =
    object : HealthProbesSectionSource {
        override fun systemHealth(): Flow<Resource<JsonElement>> = repository.systemHealth()
    }
