// UI-thread-free state holder backing the Compose [HashCalculator] — the native port of the web tool's hook
// composition (web/src/features/admin/components/devtools/tools/HashCalculator.tsx). The web tool keeps the
// input and result in `useState` and toggles a `computing` flag around the async digest; here that becomes a
// lifecycle-aware [UiState] of the [HashDigest], covering every state the surface renders: empty (nothing
// computed yet — the web `!hashResult` guard), loading (the web `computing` flag), content (the digest), a
// hard error + retry (the web `catch` branch), and — through the ADR-013 freshness contract — the stale /
// offline envelope (a failed recompute keeps the last digest visible). The injected [HashCalculatorEngine]
// (P1/S8) computes on-device; the view-model performs no HTTP (ADR-002).
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/feature-views/HashCalculator) cannot form a valid Kotlin package.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.feature.views.hashcalculator

import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import io.teslasync.android.data.BaseFeedViewModel
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import io.teslasync.android.data.toUiState
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

/**
 * State holder backing the Compose [HashCalculator].
 *
 * It owns the result [state] only — the input text is the surface's local UI state (web `useState`), passed
 * back in on [compute]. A blank input is a no-op that resets to the empty state (web `if (!inputVal) return`);
 * a non-blank input transitions loading → content, keeping any prior digest visible while the recompute runs
 * (web leaves the old `hashResult` on screen while `computing`). A compute failure folds through the shared
 * [toUiState] contract: the error state with a retry when nothing was shown, or the stale "last known" digest
 * with a retry when one was. It owns no networking and exposes the PII-safe `view.opened` diagnostic (P1/S11).
 *
 * @param engine the on-device SHA-256 seam (P1/S8) — the production engine in the app, a fake in tests.
 * @param logger the single sanctioned redacting logger (ADR-016).
 * @param scope test seam; production passes nothing and uses `viewModelScope`.
 * @param clock millisecond source for the freshness stamp; overridable so tests stay deterministic.
 */
class HashCalculatorViewModel(
    private val engine: HashCalculatorEngine,
    logger: Logger,
    scope: CoroutineScope? = null,
    private val clock: () -> Long = System::currentTimeMillis,
) : BaseFeedViewModel(logger, scope) {
    private val mutableState = MutableStateFlow(UiState(UiPhase.Empty, data = HashDigest.EMPTY))

    /** The digest as loading / content / empty / stale / offline / error UI state (blank hex → empty). */
    val state: StateFlow<UiState<HashDigest>> = mutableState.asStateFlow()

    private var viewOpenedRecorded = false

    /** Records the one-shot `view.opened` diagnostics event (P1/S11) — PII-safe, surface slug only. */
    fun onAppear() {
        if (viewOpenedRecorded) return
        viewOpenedRecorded = true
        logger.info(EVENT_VIEW_OPENED, mapOf(FIELD_SURFACE to HashCalculatorRegistration.SLUG))
    }

    /**
     * Computes the SHA-256 of [input] (web `compute()`). A blank input resets to the empty state without
     * touching the engine; otherwise it shows loading over any prior digest, then content or — on failure —
     * the error / stale envelope. Only the surface slug is logged: the input text never leaves the view-model.
     */
    fun compute(input: String) {
        if (input.isEmpty()) {
            mutableState.value = UiState(UiPhase.Empty, data = HashDigest.EMPTY)
            return
        }
        val current = mutableState.value
        val prior = current.data?.takeIf { !it.isBlank }
        val priorFetchedAt = current.fetchedAt
        mutableState.value = Resource.Loading(cached = prior, fetchedAt = priorFetchedAt, stale = false).toUiState { it.isBlank }
        logger.info(EVENT_COMPUTE, mapOf(FIELD_SURFACE to HashCalculatorRegistration.SLUG))
        launch {
            val result = runCatching { engine.digest(input) }
            mutableState.value = hashResource(result, prior, priorFetchedAt, clock()).toUiState { it.isBlank }
        }
    }

    /** Retry after a failure — recomputes the current [input]; backs the error state's retry affordance. */
    fun retry(input: String) = compute(input)

    /** Refresh over the visible digest — recomputes the current [input]; backs the stale/offline chip. */
    fun refresh(input: String) = compute(input)

    companion object {
        private const val EVENT_VIEW_OPENED = "view.opened"
        private const val EVENT_COMPUTE = "hashCalculator.compute"
        private const val FIELD_SURFACE = "surface"

        /** A [ViewModelProvider.Factory] a host uses to construct this surface's ViewModel. */
        fun factory(
            engine: HashCalculatorEngine,
            logger: Logger,
        ): ViewModelProvider.Factory =
            viewModelFactory {
                initializer { HashCalculatorViewModel(engine, logger) }
            }
    }
}

/** Surface registration metadata — the diagnostics slug emitted with `view.opened` (P1/S11). */
object HashCalculatorRegistration {
    /** The stable surface slug (matches the prompt + web component name). */
    const val SLUG = "HashCalculator"
}
