// UI-thread-free state holder backing the Infrastructure dev-tools section — the native port of the web
// component's five-`useMutation` composition (web/src/features/admin/components/devtools/InfrastructureSection.tsx).
// It binds the [InfrastructureSectionSource] command seam (P1/S8), holds one independent [ToolRun] per
// tool, exposes the [run] action + the PII-safe one-shot `view.opened` diagnostic, and projects each
// finished request onto render-ready state via [InfrastructureSectionProjection]. The view never performs
// HTTP — it only collects [state] and calls [run] / [onViewOpened].
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/feature-views/InfrastructureSection) cannot form a valid Kotlin package.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.featureviews.infrastructure

import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import io.teslasync.android.data.BaseFeedViewModel
import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update

/**
 * @param source the on-demand `/dev-tools/{endpoint}` command seam (a shared-client adapter in production, a fake
 *   in tests). The view-model owns no networking — it only drives this seam and projects the outcome.
 * @param logger the single sanctioned redacting logger (ADR-016); receives `view.opened` + per-run events
 *   carrying only the non-PII endpoint slug + error kind (never a request body or response payload).
 * @param scope test seam; production passes nothing and uses `viewModelScope`.
 */
class InfrastructureSectionViewModel(
    private val source: InfrastructureSectionSource,
    logger: Logger,
    scope: CoroutineScope? = null,
) : BaseFeedViewModel(logger, scope) {
    private val mutableState = MutableStateFlow(InfrastructureSectionState.initial())

    /** The live per-tool run state to render (idle / running / succeeded / failed / offline). */
    val state: StateFlow<InfrastructureSectionState> = mutableState.asStateFlow()

    private var viewOpenedRecorded = false

    /**
     * Emits the one PII-safe `view.opened` diagnostic with the surface slug (P1/S11), at most once per
     * holder. Carries no request/response payload, so a diagnostics line can never leak operational data.
     * Call from the composable's first-composition effect.
     */
    fun onViewOpened() {
        if (viewOpenedRecorded) return
        viewOpenedRecorded = true
        logger.info("view.opened", mapOf("slug" to InfrastructureSectionRegistration.SLUG))
    }

    /**
     * Runs [tool] once (web `mutation.mutate()`): flips it to [RunPhase.Running], fires the single seam
     * call, then projects the outcome onto the tool's [ToolRun]. A second tap while the tool is already
     * running is ignored. [topic] and [message] are used only by [InfraTool.MqttTest]; the other tools
     * ignore them. Every transition is logged through the redacting [logger] with only the endpoint slug.
     */
    fun run(
        tool: InfraTool,
        topic: String = "",
        message: String = "",
    ) {
        if (mutableState.value.runOf(tool).isRunning) return
        mutableState.update { it.with(tool, ToolRun(phase = RunPhase.Running)) }
        logger.info("infrastructure.run", mapOf("tool" to tool.endpoint))
        launch {
            val run = InfrastructureSectionProjection.projectRun(source.execute(tool, topic, message))
            mutableState.update { it.with(tool, run) }
            if (run.isSucceeded) {
                logger.info("infrastructure.run.ok", mapOf("tool" to tool.endpoint))
            } else {
                logger.warn(
                    "infrastructure.run.fail",
                    mapOf("tool" to tool.endpoint, "kind" to (run.errorKind?.name ?: "body")),
                )
            }
        }
    }

    companion object {
        /** A [ViewModelProvider.Factory] a dev-tools host uses to construct this surface's ViewModel. */
        fun factory(
            source: InfrastructureSectionSource,
            logger: Logger,
        ): ViewModelProvider.Factory =
            viewModelFactory {
                initializer { InfrastructureSectionViewModel(source, logger) }
            }
    }
}
