// UI-thread-free state holder backing the QueryError surface — the native port of the web component's
// connectivity-aware branch derivation (web/src/components/feedback/QueryError.tsx). It binds the live
// connectivity stream (P1/S8) through [QueryErrorSource], projects it together with the injected failure into
// the framework-free [QueryErrorRender] the composable paints, and reproduces the web offline-only
// auto-retry-on-reconnect effect via [reconnect]: a lifecycle-bound, non-buffering signal that fires once per
// offline→online transition — but only for a failure that carries no HTTP status (the web `status ===
// undefined` guard). It also emits the one-shot PII-safe `view.opened` diagnostic. The view never performs
// I/O — it only collects [render] / [online] / [reconnect] and calls [recordViewOpened].
//
// Both [online] (and the [render] derived from it) and [reconnect] collect the connectivity stream only while
// the surface observes them (`WhileSubscribed` / the composable's effect), so the platform network callback is
// registered only while the surface is on-screen and a reconnect that happens while the surface is gone can
// never be replayed as a stale retry — matching the web listener that is armed only while the component is
// mounted.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/shared-surfaces/QueryError) cannot form a valid Kotlin package.
// `MatchingDeclarationName` is suppressed for the co-located transition-detection helper.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.queryerror

import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import io.teslasync.android.data.BaseFeedViewModel
import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.emptyFlow
import kotlinx.coroutines.flow.flow
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.stateIn

/**
 * State holder backing the Compose `QueryError` surface — the Android port of the web `QueryError`'s
 * `useOnlineStatus` + branch derivation over a failed query.
 *
 * It collects the injected [source]'s connectivity stream (the P1/S8 boundary), folds it with the [failure]
 * into a lifecycle-aware [render] flow (the resolved branch + retry-enabled + announcement tone), and exposes
 * [reconnect] — a non-buffering signal that fires once per offline→online transition while the surface is
 * observed, the native mirror of the web effect that re-invokes `onRetry` once the connection returns. Both
 * are armed only when the failure [armsAutoRetryOnReconnect]. [recordViewOpened] emits the P1/S11 `view.opened`
 * event exactly once per surface open.
 *
 * @param source the connectivity seam (a `ConnectivityManager` adapter in production, a fake flow in tests).
 *   The view-model owns no I/O — it only projects the stream.
 * @param failure the classified failed query to render, or `null` for the no-error case (web `if (!error)`),
 *   in which case [render] is `null` and nothing is drawn.
 * @param logger the single sanctioned redacting logger (ADR-016); receives the `view.opened` event.
 * @param scope test seam; production passes nothing and uses `viewModelScope`.
 */
class QueryErrorViewModel(
    source: QueryErrorSource,
    private val failure: QueryErrorFailure?,
    logger: Logger,
    scope: CoroutineScope? = null,
) : BaseFeedViewModel(logger, scope) {
    private val connectivity: Flow<Boolean> = source.online()

    /**
     * Live connectivity, seeded optimistically `true` so the first frame is never an artificial blank.
     * Collected only while the surface observes it ([SharingStarted.WhileSubscribed]).
     */
    val online: StateFlow<Boolean> =
        connectivity.stateIn(
            scope = stateScope,
            started = SharingStarted.WhileSubscribed(STOP_TIMEOUT_MILLIS),
            initialValue = true,
        )

    /**
     * The resolved render the composable paints — loading-free because the surface is itself the error
     * display: `null` for a `null` failure (nothing drawn, web `if (!error) return null`), otherwise the
     * branch + retry-enabled + announcement tone for the current connectivity. The initial value is the
     * optimistic-online projection so the first frame already shows the right branch.
     */
    val render: StateFlow<QueryErrorRender?> =
        online
            .map { projectQueryError(failure, it) }
            .stateIn(
                scope = stateScope,
                started = SharingStarted.WhileSubscribed(STOP_TIMEOUT_MILLIS),
                initialValue = projectQueryError(failure, online.value),
            )

    /**
     * One-shot offline→online recovery signals — the native mirror of the web offline auto-retry effect. The
     * composable collects this and forwards each emission to the host's retry, so a user who lost connectivity
     * does not have to tap Retry when it returns. It is a cold, non-buffering flow collected fresh by the
     * composable's lifecycle-bound effect, so (like the web listener) it never replays a reconnect that
     * happened while the surface was gone, and it is [emptyFlow] for any failure that does not
     * [armsAutoRetryOnReconnect] (a failure with a status, or a transient wait).
     */
    val reconnect: Flow<Unit> =
        if (armsAutoRetryOnReconnect(failure)) connectivity.offlineToOnlineSignals() else emptyFlow()

    private var viewOpenedRecorded = false

    /**
     * Emits the one PII-safe `view.opened` diagnostic with the surface slug (P1/S11), at most once per
     * holder. Carries no error status / message and no connectivity payload, so a diagnostics line can never
     * leak which query failed. Call from the composable's first-composition effect.
     */
    fun recordViewOpened() {
        if (viewOpenedRecorded) return
        viewOpenedRecorded = true
        recordQueryErrorOpened(logger)
    }

    companion object {
        /** A [ViewModelProvider.Factory] a host uses to construct this surface's ViewModel for [failure]. */
        fun factory(
            source: QueryErrorSource,
            failure: QueryErrorFailure?,
            logger: Logger,
        ): ViewModelProvider.Factory =
            viewModelFactory {
                initializer { QueryErrorViewModel(source, failure, logger) }
            }
    }
}

/**
 * Emits [Unit] on every offline→online transition of this connectivity stream — the reliable, non-conflating
 * detector backing the auto-retry. It reads the raw stream (not a conflating `StateFlow`), so no intermediate
 * offline value is ever collapsed away; the first emission only seeds the previous state, so a fresh collector
 * (e.g. on re-composition) never fires for a reconnect it did not witness.
 */
private fun Flow<Boolean>.offlineToOnlineSignals(): Flow<Unit> =
    flow {
        var previousOnline: Boolean? = null
        collect { isOnline ->
            if (previousOnline == false && isOnline) emit(Unit)
            previousOnline = isOnline
        }
    }
