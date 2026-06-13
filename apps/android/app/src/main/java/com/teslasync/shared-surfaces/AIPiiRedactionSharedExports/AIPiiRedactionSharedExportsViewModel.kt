// UI-thread-free state holder backing the AIPiiRedactionSharedExports shared surface — the native port of the
// web component's `withAiFeature` gate + `useAiStream({ url:'/ai/exports/redaction/draft', body:{export_type} })`
// composition (web/src/components/ai/AIPiiRedactionSharedExports.tsx). It binds the AI gate + plan stream
// (P1/S8) through [AIPiiRedactionSharedExportsSource], reduces each parsed SSE frame onto the immutable
// [AiRedactionPlanState] surface (idle / streaming / done / failed, with last-known retained for the offline
// surface), and exposes the export-type, plan, and retry actions plus the PII-safe `view.opened` diagnostic.
// The view never performs HTTP — it only collects [state] and calls [setExportType] / [generate] / [retry] /
// [onViewOpened].
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/shared-surfaces)
// cannot form a valid Kotlin package.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.aipiiredactionsharedexports

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
 * @param source the AI-gate + plan-stream seam (a shared-AI-layer adapter in production, a fake in tests). The
 *   view-model owns no networking — it only reduces this port's frames.
 * @param logger the single sanctioned redacting logger (ADR-016); receives `view.opened` + `plan` events
 *   carrying only the non-PII surface slug (never the export type or any generated text).
 * @param scope test seam; production passes nothing and uses `viewModelScope`.
 * @param clock wall-clock seam for completion stamps + the freshness check; injectable for deterministic tests.
 */
class AIPiiRedactionSharedExportsViewModel(
    private val source: AIPiiRedactionSharedExportsSource,
    logger: Logger,
    scope: CoroutineScope? = null,
    private val clock: () -> Long = { System.currentTimeMillis() },
) : BaseFeedViewModel(logger, scope) {
    private val mutableState = MutableStateFlow(AiRedactionPlanState())
    private var streamJob: Job? = null
    private var viewOpenedRecorded = false

    /**
     * The live surface state: the AI gate, the chosen export type (web `canStart`), the stream phase, the
     * in-flight + last-committed plan text, the classified error, and the freshness stamp. The render boundary
     * classifies this into a [RedactionSurface]; every state renders a non-blank surface.
     */
    val state: StateFlow<AiRedactionPlanState> = mutableState.asStateFlow()

    init {
        // Bind the AI-feature gate (web `useAiEnabled('pii-redaction-shared-exports')`); `false` collapses it.
        launch { source.aiEnabled().collect { enabled -> mutableState.update { it.copy(gateEnabled = enabled) } } }
    }

    /**
     * Binds the chosen export type from the Select (web `setExportType`). A non-blank export type is what
     * enables the "Suggest redactions" action via [AiRedactionPlanState.canStart].
     */
    fun setExportType(exportType: String) {
        if (mutableState.value.exportType == exportType) return
        mutableState.update { it.withExportType(exportType) }
    }

    /**
     * Opens a fresh plan stream from the current export type (web `stream.start()`), reducing each parsed frame
     * into [state]. A no-op unless an export type is chosen (web `canStart`), or while a stream is already open
     * (the hook's in-flight guard). A thrown transport failure is classified into the same
     * [io.teslasync.android.data.ErrorKind] taxonomy as an explicit terminal failure frame.
     */
    fun generate() {
        val current = mutableState.value
        if (!current.canStart || current.isStreaming) return
        val exportType = current.exportType
        logger.info("aiPiiRedactionSharedExports.plan")
        streamJob?.cancel()
        mutableState.update { it.startPlanning() }
        streamJob =
            stateScope.launch {
                source
                    .draft(exportType)
                    .catch { cause -> mutableState.update { it.markFailed(errorKindOf(cause)) } }
                    .collect { chunk -> mutableState.update { it.onChunk(chunk, clock()) } }
                mutableState.update { it.finishIfStreaming(clock()) }
            }
    }

    /** Retry after a failure — identical to [generate]; backs the error/offline surfaces' retry affordance. */
    fun retry() = generate()

    /**
     * Emits the one PII-safe `view.opened` diagnostic with the surface slug (P1/S11), at most once per holder.
     * Carries no export type or generated text, so a diagnostics line can never leak user data. Call from the
     * composable's first-composition effect.
     */
    fun onViewOpened() {
        if (viewOpenedRecorded) return
        viewOpenedRecorded = true
        logger.info("view.opened", mapOf("slug" to AI_PII_REDACTION_SHARED_EXPORTS_SLUG))
    }

    companion object {
        /** A [ViewModelProvider.Factory] a host uses to construct this surface's ViewModel. */
        fun factory(
            source: AIPiiRedactionSharedExportsSource,
            logger: Logger,
        ): ViewModelProvider.Factory =
            viewModelFactory {
                initializer { AIPiiRedactionSharedExportsViewModel(source, logger) }
            }
    }
}
