// UI-thread-free state holder backing the DataTableBulkBar shared surface. The web component
// (web/src/components/ui/DataTableBulkBar.tsx) is a controlled, presentational selection toolbar with no data
// fetch, no confirm round-trip, and no imperative announcer (its "{{count}} selected" label is a declarative
// polite live region), so — unlike the data-bound / confirm-gated siblings — this holder binds NO Source seam:
// its single responsibility is the PII-safe one-shot `view.opened` diagnostic (P1/S11). The view performs NO
// business logic — it only calls [onViewOpened] and threads its props (`count`, `onClear`, the actions slot)
// straight to the stateless renderer.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/shared-surfaces)
// cannot form a valid Kotlin package.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.datatablebulkbar

import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import io.teslasync.android.data.BaseFeedViewModel
import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.coroutines.CoroutineScope

/**
 * State holder backing the Compose [DataTableBulkBar] — the Android port of the web `DataTableBulkBar`. The web
 * component is fully controlled: it derives nothing asynchronously, holds no local state, and reads only
 * `useTranslation`, so this holder owns no feed and no interaction seam. It exists solely to route the surface's
 * PII-safe `view.opened` diagnostic through the shared state-holder layer (P1/S8, ADR-002), keeping the
 * composable a thin renderer.
 *
 * @param logger the single sanctioned redacting logger (ADR-016); receives only the PII-safe `view.opened`
 *   event carrying the non-PII surface slug (never a selection id or any user content).
 * @param scope test seam; production passes nothing and uses `viewModelScope`.
 */
class DataTableBulkBarViewModel(
    logger: Logger,
    scope: CoroutineScope? = null,
) : BaseFeedViewModel(logger, scope) {
    private var viewOpenedRecorded = false

    /** Emits the one PII-safe `view.opened` diagnostic (P1/S11), at most once per holder. */
    fun onViewOpened() {
        if (viewOpenedRecorded) return
        viewOpenedRecorded = true
        recordDataTableBulkBarViewOpened(logger)
    }

    companion object {
        /** A [ViewModelProvider.Factory] a host uses to construct this surface's ViewModel. */
        fun factory(logger: Logger): ViewModelProvider.Factory =
            viewModelFactory {
                initializer { DataTableBulkBarViewModel(logger) }
            }
    }
}
