// UI-thread-free state holder backing the Compose [UuidGenerator] — the native port of the web tool's hook
// composition (web .../tools/UuidGenerator.tsx). The web tool keeps the `string[]` in `useState`; here that
// becomes a lifecycle-aware [UiState] of the [UuidBatch], covering every state the surface renders: empty
// (nothing generated yet — the web `uuids.length > 0` guard), loading (the first generate before a result),
// content (the list), a hard error + retry, and — through the ADR-013 freshness contract — the stale /
// offline envelope (a failed re-generate keeps the last list visible). The injected [UuidEngine] (P1/S8)
// generates on-device; the view-model performs no HTTP (ADR-002).
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/feature-views/UuidGenerator) cannot form a valid Kotlin package.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.featureviews.uuidgenerator

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
 * State holder backing the Compose [UuidGenerator].
 *
 * It owns the generated-list [state]. Each [generate] shows loading over any prior list (the web leaves the
 * existing items on screen), then content — a fresh [UuidBatch] with the new id prepended and capped at ten
 * (web `[uuid, ...prev].slice(0, 10)`). A generate failure folds through the shared [toUiState] contract: the
 * error state with a retry when nothing was shown, or the stale "last known" list with a retry when one was.
 * It owns no networking and exposes the PII-safe `view.opened` diagnostic (P1/S11) — only the surface slug is
 * ever logged, never the generated ids.
 *
 * @param engine the on-device UUID seam (P1/S8) — the production generator in the app, a fake in tests.
 * @param logger the single sanctioned redacting logger (ADR-016).
 * @param scope test seam; production passes nothing and uses `viewModelScope`.
 * @param clock millisecond source for the freshness stamp; overridable so tests stay deterministic.
 */
class UuidGeneratorViewModel(
    private val engine: UuidEngine,
    logger: Logger,
    scope: CoroutineScope? = null,
    private val clock: () -> Long = System::currentTimeMillis,
) : BaseFeedViewModel(logger, scope) {
    private val mutableState = MutableStateFlow(UiState(UiPhase.Empty, data = UuidBatch.EMPTY))

    /** The list as loading / content / empty / stale / offline / error UI state (no ids yet → empty). */
    val state: StateFlow<UiState<UuidBatch>> = mutableState.asStateFlow()

    private var viewOpenedRecorded = false

    /** Records the one-shot `view.opened` diagnostics event (P1/S11) — PII-safe, surface slug only. */
    fun onAppear() {
        if (viewOpenedRecorded) return
        viewOpenedRecorded = true
        logger.info(EVENT_VIEW_OPENED, mapOf(FIELD_SURFACE to UuidGeneratorRegistration.SLUG))
    }

    /**
     * Generates a fresh UUID and prepends it to the list (web Generate handler). Shows loading over any prior
     * list, then content or — on failure — the error / stale envelope. Only the surface slug is logged: the
     * generated id never leaves the view-model.
     */
    fun generate() {
        val current = mutableState.value
        val prior = current.data?.takeIf { !it.isBlank }
        val priorFetchedAt = current.fetchedAt
        mutableState.value =
            Resource.Loading(cached = prior, fetchedAt = priorFetchedAt, stale = false).toUiState { it.isBlank }
        logger.info(EVENT_GENERATE, mapOf(FIELD_SURFACE to UuidGeneratorRegistration.SLUG))
        launch {
            val base = prior ?: UuidBatch.EMPTY
            val result = runCatching { UuidGeneratorProjection.prepend(base, engine.next()) }
            mutableState.value = uuidResource(result, prior, priorFetchedAt, clock()).toUiState { it.isBlank }
        }
    }

    /** Retry after a failure — generates again; backs the error state's retry affordance. */
    fun retry() = generate()

    /** Refresh over the visible list — generates again; backs the stale/offline chip. */
    fun refresh() = generate()

    companion object {
        private const val EVENT_VIEW_OPENED = "view.opened"
        private const val EVENT_GENERATE = "uuidGenerator.generate"
        private const val FIELD_SURFACE = "surface"

        /** A [ViewModelProvider.Factory] a host uses to construct this surface's ViewModel. */
        fun factory(
            engine: UuidEngine,
            logger: Logger,
        ): ViewModelProvider.Factory =
            viewModelFactory {
                initializer { UuidGeneratorViewModel(engine, logger) }
            }
    }
}
