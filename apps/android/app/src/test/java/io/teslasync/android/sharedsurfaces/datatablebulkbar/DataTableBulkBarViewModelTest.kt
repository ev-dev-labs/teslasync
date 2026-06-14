// Off-device unit tests for [DataTableBulkBarViewModel] over a recording fake (the :app:testReleaseUnitTest gate):
// the PII-safe `view.opened` diagnostic is emitted exactly once per holder (idempotent), carrying only the surface
// slug. The web component is a controlled presentational bar with no fetch / confirm / announcer, so the holder's
// sole responsibility is this one diagnostic.
//
// `InvalidPackageDeclaration` is not needed here — the test lives in the surface's real package directory.
package io.teslasync.android.sharedsurfaces.datatablebulkbar

import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Test

@OptIn(ExperimentalCoroutinesApi::class)
class DataTableBulkBarViewModelTest {
    @Test
    fun onViewOpenedEmitsSlugExactlyOnce() =
        runTest(UnconfinedTestDispatcher()) {
            val logger = RecordingLogger()
            val vm = viewModel(logger = logger)

            vm.onViewOpened()
            vm.onViewOpened()

            val opened = logger.events.filter { it.first == "view.opened" }
            assertEquals(1, opened.size)
            assertEquals(mapOf("slug" to "DataTableBulkBar"), opened.single().second)
        }

    private fun TestScope.viewModel(logger: Logger = RecordingLogger()): DataTableBulkBarViewModel =
        DataTableBulkBarViewModel(logger, scope = backgroundScope)
}
