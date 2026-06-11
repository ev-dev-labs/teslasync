// The data port the Telemetry Errors widget binds to (P1/S8 state-holder seam) — the native analogue
// of the web `useFleetTelemetryErrorVINs` + `useFleetTelemetryErrors` hook composition
// (web/src/api/hooks/useTelemetry.ts). The view never performs HTTP itself; a shared-store/repository
// adapter (or a test fake) drives this. Cache-then-network freshness is preserved end to end
// (ADR-013): the fold carries every emission's cached / stale / error flags onto one combined
// `Resource` so the view-model can render the full state matrix.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/dashboard-widgets/TelemetryErrorsWidget) cannot form a valid Kotlin package.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.dashboard.widgets.telemetryerrors

import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.data.repo.TelemetryRepository
import io.teslasync.shared.core.presentation.telemetry.FleetTelemetryError
import io.teslasync.shared.core.presentation.telemetry.FleetTelemetryErrorVIN
import io.teslasync.shared.core.presentation.telemetry.TelemetryStore
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.combine

/**
 * Streams the combined cache-then-network telemetry-error payload the widget renders. A single-method
 * seam so the view-model depends on an abstraction (real adapter ↔ test fake), never on a concrete
 * store/repository or the network. Each (re)collection is a fresh combined `Resource` stream, so the
 * view-model's refresh trigger re-subscribing performs the web `refetch()`.
 */
fun interface TelemetryErrorsSource {
    /** The cache-then-network combined error-VINs + errors feed (cached values first, then refreshed). */
    fun stream(): Flow<Resource<TelemetryErrorsData>>
}

/**
 * Fold the two independent cache-then-network feeds (error-VINs + errors) into one combined
 * [Resource] of [TelemetryErrorsData], preserving every freshness flag — the native analogue of the
 * web component consuming two `useQuery` results. The envelope rules mirror the web semantics:
 *  - nothing cached on either feed and at least one still loading → first-load skeleton ([Resource.Loading] null);
 *  - a hard failure with NO data anywhere → [Resource.Error] with no cache (the mandated hard-error surface);
 *  - a failure with data available on either feed → offline/last-known ([Resource.Error] + cache + `stale`);
 *  - either feed still refreshing over cache → [Resource.Loading] carrying the merged cache;
 *  - otherwise both resolved → [Resource.Success].
 * The freshness stamp is the later of the two feeds' stamps (web `Math.max(vinsUpdatedAt, errorsUpdatedAt)`).
 */
internal fun foldTelemetryErrors(
    vins: Resource<List<FleetTelemetryErrorVIN>>,
    errors: Resource<List<FleetTelemetryError>>,
): Resource<TelemetryErrorsData> {
    if (isFirstLoad(vins, errors)) {
        return Resource.Loading(cached = null, fetchedAt = null, stale = false)
    }
    val data = TelemetryErrorsData(vins.cached ?: emptyList(), errors.cached ?: emptyList())
    val fetchedAt = laterStamp(vins.stamp(), errors.stamp())
    val stale = vins.stale || errors.stale
    val failure = firstFailure(vins, errors)
    return when {
        failure != null -> errorResource(data, fetchedAt, stale, failure)
        vins is Resource.Loading || errors is Resource.Loading ->
            Resource.Loading(cached = data, fetchedAt = fetchedAt, stale = stale)
        else -> Resource.Success(data = data, fetchedAt = fetchedAt ?: 0L, stale = false)
    }
}

/** Nothing cached on either feed and at least one still loading → the first-load skeleton. */
private fun isFirstLoad(
    vins: Resource<*>,
    errors: Resource<*>,
): Boolean {
    val nothingCached = vins.cached == null && errors.cached == null
    val stillLoading = vins is Resource.Loading || errors is Resource.Loading
    return nothingCached && stillLoading
}

/** The error of whichever feed failed first (VINs take precedence), or `null` when neither failed. */
private fun firstFailure(
    vins: Resource<*>,
    errors: Resource<*>,
): Throwable? = (vins as? Resource.Error)?.error ?: (errors as? Resource.Error)?.error

/** A hard error when nothing is cached, otherwise an offline/last-known error keeping the cache. */
private fun errorResource(
    data: TelemetryErrorsData,
    fetchedAt: Long?,
    stale: Boolean,
    failure: Throwable,
): Resource<TelemetryErrorsData> =
    if (data.hasData) {
        Resource.Error(cached = data, fetchedAt = fetchedAt, stale = true, error = failure)
    } else {
        Resource.Error(cached = null, fetchedAt = fetchedAt, stale = stale, error = failure)
    }

/**
 * Binds the surface to the shared **S7** [TelemetryRepository] — the cold cache-then-network feeds
 * where the view-model's refresh trigger re-subscribing performs a genuine re-fetch (web `refetch()`).
 * Each [TelemetryErrorsSource.stream] starts fresh `error-vins` + `errors` collections combined into one.
 */
fun telemetryErrorsSource(repository: TelemetryRepository): TelemetryErrorsSource =
    TelemetryErrorsSource {
        combine(
            repository.fleetTelemetryErrorVINs(),
            repository.fleetTelemetryErrors(null),
        ) { vins, errors -> foldTelemetryErrors(vins, errors) }
    }

/**
 * Binds the surface to the shared **S8** [TelemetryStore] — the memoized, multi-observer error-VINs +
 * errors feeds every Telemetry surface shares. Use this when a host shares one app-wide feed across
 * surfaces; the store folds every observer into a single upstream collection.
 */
fun telemetryErrorsSource(store: TelemetryStore): TelemetryErrorsSource =
    TelemetryErrorsSource {
        combine(
            store.fleetTelemetryErrorVINs(),
            store.fleetTelemetryErrors(),
        ) { vins, errors -> foldTelemetryErrors(vins, errors) }
    }

/** The freshness stamp of any [Resource] variant, or `null` when nothing has loaded. */
private fun Resource<*>.stamp(): Long? =
    when (this) {
        is Resource.Loading -> fetchedAt
        is Resource.Success -> fetchedAt
        is Resource.Error -> fetchedAt
    }

private fun laterStamp(
    a: Long?,
    b: Long?,
): Long? =
    when {
        a == null -> b
        b == null -> a
        else -> maxOf(a, b)
    }
