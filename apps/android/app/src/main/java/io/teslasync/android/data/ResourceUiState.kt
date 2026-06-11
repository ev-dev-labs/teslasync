package io.teslasync.android.data

import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.net.ApiError

/**
 * Pure projection of a shared-core [Resource] onto the Android [UiState] surface — the one place the
 * ADR-013 cache-then-network contract is turned into Compose-renderable state. It is a side-effect-free
 * function so it is fully unit-testable off-device (no Android, no coroutines).
 *
 * Mapping (covering loading / cached / refreshing / empty / stale / error / retry):
 *  - [Resource.Loading] with no cache → [UiPhase.Loading] (spinner, no data).
 *  - [Resource.Loading] with a cached value → [UiPhase.Content]/[UiPhase.Empty] showing the cached
 *    value with [UiState.refreshing] = true (refresh in flight over last-known data), carrying its
 *    [Resource.Loading.stale] flag.
 *  - [Resource.Success] → [UiPhase.Content]/[UiPhase.Empty], never stale.
 *  - [Resource.Error] with a cached value → keeps the cached value visible as
 *    [UiPhase.Content]/[UiPhase.Empty] with `stale = true` and the [ErrorKind] set, so the UI shows an
 *    "offline / last known" banner + retry instead of blanking working data.
 *  - [Resource.Error] with no cache → [UiPhase.Error] with the [ErrorKind] set (error screen + retry).
 *
 * @param isEmpty decides whether a non-null payload is "empty" for this domain. Defaults to a sensible
 *   structural check (empty collection/map/array or blank text); list/detail pages pass their own.
 */
fun <T> Resource<T>.toUiState(isEmpty: (T) -> Boolean = { isStructurallyEmpty(it) }): UiState<T> =
    when (this) {
        is Resource.Loading ->
            cached?.let { value ->
                UiState(
                    phase = phaseFor(value, isEmpty),
                    data = value,
                    fetchedAt = fetchedAt,
                    stale = stale,
                    refreshing = true,
                )
            } ?: UiState.loading()

        is Resource.Success ->
            UiState(
                phase = phaseFor(data, isEmpty),
                data = data,
                fetchedAt = fetchedAt,
            )

        is Resource.Error ->
            cached?.let { value ->
                UiState(
                    phase = phaseFor(value, isEmpty),
                    data = value,
                    fetchedAt = fetchedAt,
                    stale = true,
                    errorKind = errorKindOf(error),
                    httpStatus = httpStatusOf(error),
                )
            } ?: UiState(
                phase = UiPhase.Error,
                fetchedAt = fetchedAt,
                stale = stale,
                errorKind = errorKindOf(error),
                httpStatus = httpStatusOf(error),
            )
    }

/** Classifies a failure into the Android [ErrorKind], folding the shared [ApiError] taxonomy. */
fun errorKindOf(error: Throwable): ErrorKind =
    when (error) {
        is ApiError.Network -> ErrorKind.Network
        is ApiError.Timeout -> ErrorKind.Timeout
        is ApiError.Http -> ErrorKind.Http
        is ApiError.Decode -> ErrorKind.Decode
        is ApiError.CircuitOpen -> ErrorKind.CircuitOpen
        else -> ErrorKind.Unknown
    }

/** The HTTP status of an [ApiError.Http] failure, or `null` for any other failure. */
fun httpStatusOf(error: Throwable): Int? = (error as? ApiError.Http)?.status

private fun <T> phaseFor(
    value: T,
    isEmpty: (T) -> Boolean,
): UiPhase = if (isEmpty(value)) UiPhase.Empty else UiPhase.Content

/** Structural emptiness fallback used when a caller supplies no domain-specific predicate. */
internal fun isStructurallyEmpty(value: Any?): Boolean =
    when (value) {
        null -> true
        is Collection<*> -> value.isEmpty()
        is Map<*, *> -> value.isEmpty()
        is Array<*> -> value.isEmpty()
        is CharSequence -> value.isBlank()
        else -> false
    }
