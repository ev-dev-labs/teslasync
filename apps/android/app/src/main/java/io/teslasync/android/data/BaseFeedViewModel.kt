package io.teslasync.android.data

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.receiveAsFlow
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch

/**
 * Base AndroidX [ViewModel] for every TeslaSync page ViewModel (A7). It establishes the lifecycle
 * collection pattern that keeps screens stateless Composables driven by shared-core state holders
 * (ADR-002): a shared `StateFlow<Resource<T>>` is mapped through [toUiState] and re-shared in
 * [stateScope] with `WhileSubscribed`, so the upstream shared-core feed is collected only while the UI
 * observes it (via `collectAsStateWithLifecycle`) and is dropped shortly after the screen leaves.
 *
 * It owns NO networking or business logic — it only consumes the injected shared stores. It also
 * provides the cross-cutting page concerns the data layer must standardise: a one-shot [events]
 * channel (toasts / command outcomes), the redacting [logger] (ADR-016 — the only sanctioned logger),
 * and a [launch] helper bound to the ViewModel scope.
 *
 * It is intentionally `abstract`: it has no screen state of its own and must never be instantiated
 * directly — concrete page ViewModels subclass it.
 *
 * @param logger the single sanctioned redacting logger.
 * @param scope test seam; production passes nothing and uses [viewModelScope], while tests inject a
 *   `TestScope`-backed scope so flows run on virtual time.
 */
@Suppress("UnnecessaryAbstractClass")
abstract class BaseFeedViewModel(
    protected val logger: Logger,
    scope: CoroutineScope? = null,
) : ViewModel() {
    /** The scope shared feeds are re-shared in and mutations run in — [viewModelScope] in production. */
    protected val stateScope: CoroutineScope = scope ?: viewModelScope

    private val eventChannel = Channel<UiEvent>(Channel.BUFFERED)

    /** One-shot UI effects (toasts, command outcomes). Collected once by the screen; never replayed. */
    val events: Flow<UiEvent> = eventChannel.receiveAsFlow()

    /** Sends a one-shot [UiEvent] to the screen. Safe to call from any thread. */
    protected fun emitEvent(event: UiEvent) {
        eventChannel.trySend(event)
    }

    /** Launches [block] on the ViewModel scope (cancelled automatically when the ViewModel clears). */
    protected fun launch(block: suspend CoroutineScope.() -> Unit) {
        stateScope.launch(block = block)
    }

    /**
     * Projects a shared-core cache-then-network feed onto a lifecycle-aware [UiState] stream. The
     * upstream is collected only while the returned flow is observed ([SharingStarted.WhileSubscribed]
     * with a short stop timeout to survive config changes), and the initial value is the projection of
     * the feed's current [StateFlow.value] so the first frame is never an artificial blank.
     */
    protected fun <T> StateFlow<Resource<T>>.asUiState(isEmpty: (T) -> Boolean = { isStructurallyEmpty(it) }): StateFlow<UiState<T>> =
        map { it.toUiState(isEmpty) }
            .stateIn(
                scope = stateScope,
                started = SharingStarted.WhileSubscribed(STOP_TIMEOUT_MILLIS),
                initialValue = value.toUiState(isEmpty),
            )

    /**
     * The plain-[Flow] variant of [asUiState] for a derived feed that is not itself a `StateFlow`
     * (e.g. a `flatMapLatest` over the selected vehicle). It starts from [UiState.loading] because a
     * cold [Flow] has no current value to project until it is collected.
     */
    protected fun <T> Flow<Resource<T>>.asUiState(isEmpty: (T) -> Boolean = { isStructurallyEmpty(it) }): StateFlow<UiState<T>> =
        map { it.toUiState(isEmpty) }
            .stateIn(
                scope = stateScope,
                started = SharingStarted.WhileSubscribed(STOP_TIMEOUT_MILLIS),
                initialValue = UiState.loading(),
            )

    protected companion object {
        /** Keep a feed's upstream alive briefly across config changes / fast re-subscribes. */
        const val STOP_TIMEOUT_MILLIS = 5_000L
    }
}
