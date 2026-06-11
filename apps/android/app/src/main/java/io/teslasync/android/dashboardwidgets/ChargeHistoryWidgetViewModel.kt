package io.teslasync.android.dashboardwidgets

import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import io.teslasync.android.data.BaseFeedViewModel
import io.teslasync.android.data.UiState
import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.update

/**
 * Static registry metadata for the ChargeHistory surface — the canonical id, category and grid-size
 * constraints from `web/src/features/dashboard/widgets/registry/charging.ts`. A dashboard host
 * registers the surface with this id and honors these size bounds, mirroring the web registry exactly.
 */
object ChargeHistoryWidgetDescriptor {
    /** Canonical registry id (web `charge-history`). */
    const val ID: String = "charge-history"

    /** Registry category (web `charging`). */
    const val CATEGORY: String = "charging"

    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). */
    const val SURFACE_SLUG: String = "ChargeHistoryWidget"

    /** Registry default footprint (2×4). */
    val defaultSize: ChargeHistorySize = ChargeHistorySize(cols = 2, rows = 4)

    /** Registry minimum footprint (2×2). */
    val minSize: ChargeHistorySize = ChargeHistorySize(cols = 2, rows = 2)

    /** Registry maximum footprint (4×40). */
    val maxSize: ChargeHistorySize = ChargeHistorySize(cols = 4, rows = 40)
}

/**
 * State holder backing the Compose [ChargeHistoryWidget] — the Android port of the web
 * `ChargeHistoryWidget`'s hook composition (`web/src/features/dashboard/widgets/ChargeHistoryWidget.tsx`).
 *
 * It binds the injected [ChargeHistorySource] (the P1/S8 shared-layer seam) to a lifecycle-aware
 * [UiState] of the charge-history snapshot via [BaseFeedViewModel.asUiState], covering every state the
 * web widget renders: loading (no cache), content, empty (no vehicle / ≤1 session), hard error, and —
 * through the ADR-013 freshness contract — stale / offline (cached chart kept visible with the
 * staleness + error flags). The view stays a thin renderer; it performs no HTTP and owns no business
 * logic (ADR-002).
 *
 * [refresh] bumps a trigger that restarts a fresh upstream collection (the web `refetch()`), and
 * [onAppear] emits the P1/S11 `view.opened` diagnostics event exactly once per surface open.
 *
 * @param source the shared cache-then-network charge-history seam.
 * @param logger the single sanctioned redacting logger (ADR-016).
 * @param scope test seam; production uses `viewModelScope`.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class ChargeHistoryWidgetViewModel(
    private val source: ChargeHistorySource,
    logger: Logger,
    scope: CoroutineScope? = null,
) : BaseFeedViewModel(logger, scope) {
    private val refreshTrigger = MutableStateFlow(0)
    private var viewOpenedRecorded = false

    /** The recent charge history as cache-then-network UI state (≤1 session → empty). */
    val state: StateFlow<UiState<ChargeHistorySnapshot>> =
        refreshTrigger
            .flatMapLatest { source.stream() }
            .asUiState { !it.hasChartData }

    /** Records the one-shot `view.opened` diagnostics event (P1/S11) — PII-safe, slug only. */
    fun onAppear() {
        if (viewOpenedRecorded) return
        viewOpenedRecorded = true
        logger.info("view.opened", mapOf("surface" to ChargeHistoryWidgetDescriptor.SURFACE_SLUG))
    }

    /** Re-fetches the charge history (web `refetch()`); restarts a fresh cache-then-network collection. */
    fun refresh() {
        logger.info("chargeHistory.refresh")
        refreshTrigger.update { it + 1 }
    }

    companion object {
        /** A [ViewModelProvider.Factory] a dashboard host uses to construct this surface's ViewModel. */
        fun factory(
            source: ChargeHistorySource,
            logger: Logger,
        ): ViewModelProvider.Factory =
            viewModelFactory {
                initializer { ChargeHistoryWidgetViewModel(source, logger) }
            }
    }
}
