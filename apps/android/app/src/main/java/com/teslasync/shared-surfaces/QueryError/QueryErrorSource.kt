// The single data port the QueryError shared surface binds to — the native analogue of the web component's
// ONE live data hook, `useOnlineStatus`. The web `QueryError` takes the failed query's `error` as a prop and
// reads live connectivity from `useOnlineStatus()` (backed by the resilience module's online/offline
// broadcaster) to swap the network branch between "Can't reach server" and "You're offline" and to
// auto-retry once the connection returns. This seam is that connectivity source: the view-model depends on
// the abstraction (a real ConnectivityManager-backed adapter in production, a fake `Flow<Boolean>` in tests),
// never on the platform directly, so the view performs NO I/O (P1/S8 boundary, ADR-002).
//
// `InvalidPackageDeclaration` is suppressed because the mandated surface directory
// (com/teslasync/shared-surfaces/QueryError) cannot form a valid Kotlin package; `ktlint:standard:filename` /
// `MatchingDeclarationName` are suppressed for the co-located adapters alongside the namesake interface.
@file:Suppress("ktlint:standard:filename", "MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.queryerror

import android.net.ConnectivityManager
import android.net.Network
import android.net.NetworkCapabilities
import android.net.NetworkRequest
import kotlinx.coroutines.channels.awaitClose
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.callbackFlow
import kotlinx.coroutines.flow.conflate
import kotlinx.coroutines.flow.distinctUntilChanged

/**
 * The seam the [QueryErrorViewModel] binds to so it depends on an abstraction (real adapter ↔ test fake),
 * never on the platform connectivity service. [online] is the live online/offline stream the network branch
 * and the auto-retry-on-reconnect behaviour read (web `useOnlineStatus`); `true` means a validated internet
 * connection is available. No I/O touches the view.
 */
interface QueryErrorSource {
    /**
     * The live connectivity stream (web `useOnlineStatus`). Emits `true` while a validated internet
     * transport is available and `false` otherwise, re-emitting on every transition so the surface can swap
     * the offline / online network copy and auto-retry when connectivity returns.
     */
    fun online(): Flow<Boolean>
}

/**
 * Builds a [QueryErrorSource] from a single connectivity-stream provider — the host wiring seam used when a
 * caller already has an online/offline flow in hand (and the test double used to drive each connectivity
 * state deterministically). Mirrors the per-source contract of the other shared surfaces.
 */
fun queryErrorSource(online: () -> Flow<Boolean>): QueryErrorSource =
    object : QueryErrorSource {
        override fun online(): Flow<Boolean> = online()
    }

/**
 * Binds the surface to the platform [ConnectivityManager] — the production connectivity source (the native
 * equivalent of the web resilience module's online/offline broadcaster behind `useOnlineStatus`). The
 * returned source re-emits the validated-internet state on every network transition, de-duplicated and
 * conflated so the surface only re-projects on a genuine connectivity change. The host wires this from the
 * application context (see `rememberConnectivityQueryErrorSource`); tests use [queryErrorSource] instead.
 */
fun ConnectivityManager.asQueryErrorSource(): QueryErrorSource {
    val connectivityManager = this
    return queryErrorSource { connectivityManager.onlineFlow() }
}

/**
 * The validated-internet connectivity stream backing [asQueryErrorSource]. Seeds with the current state, then
 * re-emits on every available / lost / capabilities-changed callback; unregisters the callback when the last
 * collector leaves. De-duplicated + conflated so only real transitions reach the surface.
 */
private fun ConnectivityManager.onlineFlow(): Flow<Boolean> =
    callbackFlow {
        val callback =
            object : ConnectivityManager.NetworkCallback() {
                override fun onAvailable(network: Network) {
                    trySend(isOnlineNow())
                }

                override fun onLost(network: Network) {
                    trySend(isOnlineNow())
                }

                override fun onCapabilitiesChanged(
                    network: Network,
                    networkCapabilities: NetworkCapabilities,
                ) {
                    trySend(isOnlineNow())
                }

                override fun onUnavailable() {
                    trySend(false)
                }
            }
        trySend(isOnlineNow())
        val request =
            NetworkRequest
                .Builder()
                .addCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)
                .build()
        registerNetworkCallback(request, callback)
        awaitClose { unregisterNetworkCallback(callback) }
    }.distinctUntilChanged()
        .conflate()

/**
 * Whether a validated internet transport is currently available — the point-in-time read the connectivity
 * callbacks fold into the [online] stream. Mirrors the web `navigator.onLine` snapshot, but requires the
 * `VALIDATED` capability so a captive-portal / no-internet Wi-Fi is honestly reported as offline.
 */
private fun ConnectivityManager.isOnlineNow(): Boolean {
    val capabilities = activeNetwork?.let(::getNetworkCapabilities)
    return capabilities != null &&
        capabilities.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET) &&
        capabilities.hasCapability(NetworkCapabilities.NET_CAPABILITY_VALIDATED)
}
