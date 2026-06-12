// The data port the [TeslaAccountSectionViewModel] binds to (P1/S8 state-holder seam) — the native
// analogue of the web component's Tesla Fleet auth hook composition
// (web/src/api/hooks/useSettings.ts → web/src/features/settings/components/TeslaAccountSection.tsx). The
// view never performs HTTP itself; a shared adapter (the S8 SettingsStore or the S7 SettingsRepository) or
// a test fake drives this. Cache-then-network freshness is preserved end to end (ADR-013): the auth-status
// emission's cached/stale/error flags flow through unchanged so the view-model can render the full state
// matrix.
//
// `InvalidPackageDeclaration`/`filename`/`MatchingDeclarationName` are suppressed: the mandated surface
// directory (com/teslasync/feature-views/TeslaAccountSection) cannot form a valid Kotlin package and the
// file hosts the seam plus its two bindings, mirroring the sibling surfaces.
@file:Suppress("InvalidPackageDeclaration", "ktlint:standard:filename", "MatchingDeclarationName")

package io.teslasync.android.featureviews.teslaaccountsection

import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.data.repo.SettingsRepository
import io.teslasync.shared.core.presentation.settings.AuthStatus
import io.teslasync.shared.core.presentation.settings.AuthUrlResult
import io.teslasync.shared.core.presentation.settings.SettingsStore
import io.teslasync.shared.core.presentation.settings.SyncVehiclesResult
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.flowOf

/**
 * The single seam the [TeslaAccountSectionViewModel] depends on so it binds to an abstraction (real
 * adapter ↔ test fake), never to a concrete store or the network. [authStatus] is the cache-then-network
 * feed the web `useAuthStatus` hook serves; [reauthNeeded] is the global "token expired" re-auth signal
 * the web component mirrors from the re-auth banner's document events (web `pillDisconnected`); the four
 * mutations mirror the web `useAuthURL` / `useRefreshAuth` / `useDisconnectAuth` / `useSyncVehicles`
 * non-throwing results. No HTTP touches the view.
 */
interface TeslaAccountSource {
    /** Stream the cache-then-network Tesla auth status (web `useAuthStatus`, `GET /auth/status`). */
    fun authStatus(): Flow<Resource<AuthStatus>>

    /**
     * Stream the "token expired, re-auth required" signal (web `pillDisconnected`, driven by the global
     * re-auth banner's `teslasync:tesla-auth-expired` / `-recovered` document events). The shared bindings
     * default this to a constant `false` so the surface never falsely claims an expiry; a host that owns a
     * cross-screen re-auth signal supplies it here so the "Disconnected" pill surfaces before the next
     * failed call, exactly as on web.
     */
    fun reauthNeeded(): Flow<Boolean>

    /** Request a Tesla OAuth authorize URL (web `useAuthURL`, `POST /auth/url`); invalidates nothing. */
    suspend fun authUrl(): Result<AuthUrlResult>

    /** Refresh the Fleet token (web `useRefreshAuth`, `POST /auth/refresh`); invalidates auth-status. */
    suspend fun refreshAuth(): Result<Unit>

    /** Disconnect the Tesla account (web `useDisconnectAuth`, `POST /auth/disconnect`); invalidates auth-status. */
    suspend fun disconnectAuth(): Result<Unit>

    /** Re-sync vehicles from the Fleet account (web `useSyncVehicles`, `POST /vehicles/sync`). */
    suspend fun syncVehicles(): Result<SyncVehiclesResult>
}

/**
 * Binds the surface to the shared **S8** [SettingsStore] — the memoized, multi-observer auth-status feed
 * every Settings surface shares app-wide (web `useAuthStatus`). Mutations route through the store so it
 * refreshes exactly the feeds the matching web hook invalidates (auth-status for refresh/disconnect,
 * nothing for the URL request, the vehicles feed for sync); the view-model additionally restarts its own
 * auth-status collection after refresh/disconnect so a host using either binding refreshes uniformly. No
 * HTTP touches the view — the store (S7/S8) owns it. [reauthSignal] carries the optional cross-screen
 * "token expired" signal (default: never expired).
 */
fun teslaAccountSource(
    store: SettingsStore,
    reauthSignal: Flow<Boolean> = flowOf(false),
): TeslaAccountSource =
    object : TeslaAccountSource {
        override fun authStatus(): Flow<Resource<AuthStatus>> = store.authStatus()

        override fun reauthNeeded(): Flow<Boolean> = reauthSignal

        override suspend fun authUrl(): Result<AuthUrlResult> = store.authUrl()

        override suspend fun refreshAuth(): Result<Unit> = store.refreshAuth()

        override suspend fun disconnectAuth(): Result<Unit> = store.disconnectAuth()

        override suspend fun syncVehicles(): Result<SyncVehiclesResult> = store.syncVehicles()
    }

/**
 * Binds the surface directly to the shared **S7** [SettingsRepository]. Each [authStatus] call starts a
 * NEW cache-then-network collection, so the view-model's refresh/retry trigger a genuine re-fetch (the web
 * `refetch()` behaviour) — the binding to use when a host does not share a single app-wide store. The
 * view-model restarts its read collection after a successful refresh/disconnect to reflect the write.
 * [reauthSignal] carries the optional cross-screen "token expired" signal (default: never expired).
 */
fun teslaAccountSource(
    repository: SettingsRepository,
    reauthSignal: Flow<Boolean> = flowOf(false),
): TeslaAccountSource =
    object : TeslaAccountSource {
        override fun authStatus(): Flow<Resource<AuthStatus>> = repository.authStatus()

        override fun reauthNeeded(): Flow<Boolean> = reauthSignal

        override suspend fun authUrl(): Result<AuthUrlResult> = repository.authUrl()

        override suspend fun refreshAuth(): Result<Unit> = repository.refreshAuth()

        override suspend fun disconnectAuth(): Result<Unit> = repository.disconnectAuth()

        override suspend fun syncVehicles(): Result<SyncVehiclesResult> = repository.syncVehicles()
    }
