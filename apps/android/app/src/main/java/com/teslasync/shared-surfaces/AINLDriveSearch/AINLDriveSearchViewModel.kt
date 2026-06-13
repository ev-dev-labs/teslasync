// UI-thread-free state holder backing the AINLDriveSearch shared surface — the native port of the web
// component's `withAiFeature` gate + `useAiStream({ url:'/ai/drives/search', body:{ prompt } })` composition
// (web/src/components/ai/AINLDriveSearch.tsx). It binds the AI gate + search stream (P1/S8) through
// [AINLDriveSearchSource], owns the free-text prompt the backend reads from the JSON body, reduces each parsed
// SSE chunk onto the immutable [DriveSearchState] surface (idle / streaming / done / failed, with last-known
// retained for the offline surface), and exposes the prompt + search + retry actions plus the PII-safe
// `view.opened` diagnostic. The view never performs HTTP — it only collects [state] and calls [setPrompt] /
// [search] / [retry] / [onViewOpened].
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/shared-surfaces)
// cannot form a valid Kotlin package.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.ainldrivesearch

import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import io.teslasync.android.data.BaseFeedViewModel
import io.teslasync.android.data.errorKindOf
import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.catch
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

/**
 * Lifecycle-aware state holder backing the Compose [AINLDriveSearch] surface. It owns no networking — it only
 * reduces the frames the injected [source] produces. [setPrompt] tracks the textarea text gating the action
 * (web `setPrompt`); [search] opens a fresh stream (web `stream.start()`) and folds each chunk into [state];
 * [retry] re-runs the search behind the error/offline affordance; and [onViewOpened] emits the one-shot
 * diagnostic. The AI panel never persists — it only narrates the user's own drives (the baseline drive list
 * stays the canonical navigation path).
 *
 * @param source the AI-gate + search-stream seam (a shared-AI-layer adapter in production, a fake in tests).
 * @param logger the single sanctioned redacting logger (ADR-016); receives `view.opened` + `search` events
 *   carrying only the non-PII surface slug (never the prompt or any narrated text).
 * @param scope test seam; production passes nothing and uses `viewModelScope`.
 * @param clock wall-clock seam for completion stamps + the freshness check; injectable for deterministic tests.
 */
class AINLDriveSearchViewModel(
    private val source: AINLDriveSearchSource,
    logger: Logger,
    scope: CoroutineScope? = null,
    private val clock: () -> Long = { System.currentTimeMillis() },
) : BaseFeedViewModel(logger, scope) {
    private val mutableState = MutableStateFlow(DriveSearchState())
    private var streamJob: Job? = null
    private var viewOpenedRecorded = false

    /**
     * The live surface state: the AI gate, the free-text prompt (web `prompt` -> `canStart`), the stream phase,
     * the in-flight + last-committed result text, the classified error, and the freshness stamp. The render
     * boundary classifies this into a [DriveSearchSurface]; every state renders a non-blank surface.
     */
    val state: StateFlow<DriveSearchState> = mutableState.asStateFlow()

    init {
        // Bind the AI-feature gate (web `useAiEnabled('nl-drive-search-replay')`); `false` collapses the surface.
        launch { source.aiEnabled().collect { enabled -> mutableState.update { it.copy(gateEnabled = enabled) } } }
    }

    /** Tracks the free-text prompt the textarea binds (web `setPrompt`); a non-blank prompt enables [search]. */
    fun setPrompt(text: String) {
        if (mutableState.value.prompt == text) return
        mutableState.update { it.withPrompt(text) }
    }

    /**
     * Opens a fresh search stream for the current prompt (web `stream.start()`), reducing each parsed chunk into
     * [state]. A no-op with a blank prompt (web `canStart`) or while a stream is already open (the hook's
     * in-flight guard). A thrown transport failure is classified into the same
     * [io.teslasync.android.data.ErrorKind] taxonomy as an explicit terminal failure frame.
     */
    fun search() {
        val current = mutableState.value
        if (!current.canStart || current.isStreaming) return
        logger.info("aiNlDriveSearch.search")
        streamJob?.cancel()
        val prompt = current.prompt
        mutableState.update { it.startSearching() }
        streamJob =
            stateScope.launch {
                source
                    .search(prompt)
                    .catch { cause -> mutableState.update { it.markFailed(errorKindOf(cause)) } }
                    .collect { chunk -> mutableState.update { it.onChunk(chunk, clock()) } }
                mutableState.update { it.finishIfStreaming(clock()) }
            }
    }

    /** Retry after a failure — identical to [search]; backs the error/offline surfaces' retry affordance. */
    fun retry() = search()

    /**
     * Emits the one PII-safe `view.opened` diagnostic with the surface slug (P1/S11), at most once per holder.
     * Carries no prompt or narrated text, so a diagnostics line can never leak fleet state. Call from the
     * composable's first-composition effect.
     */
    fun onViewOpened() {
        if (viewOpenedRecorded) return
        viewOpenedRecorded = true
        logger.info("view.opened", mapOf("slug" to AI_NL_DRIVE_SEARCH_SLUG))
    }

    companion object {
        /** A [ViewModelProvider.Factory] a host uses to construct this surface's ViewModel. */
        fun factory(
            source: AINLDriveSearchSource,
            logger: Logger,
        ): ViewModelProvider.Factory =
            viewModelFactory {
                initializer { AINLDriveSearchViewModel(source, logger) }
            }
    }
}
