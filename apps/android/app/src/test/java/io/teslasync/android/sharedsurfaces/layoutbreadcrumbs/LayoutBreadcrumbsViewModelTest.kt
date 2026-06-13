// Off-device unit tests for [LayoutBreadcrumbsViewModel] over the real in-memory store (the
// :android:testReleaseUnitTest gate). They cover the override-store passthrough the surface collects (web
// `useBreadcrumbOverrides()`) and the PII-safe `view.opened` diagnostic emitted at most once per holder.
package io.teslasync.android.sharedsurfaces.layoutbreadcrumbs

import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Test

@OptIn(ExperimentalCoroutinesApi::class)
class LayoutBreadcrumbsViewModelTest {
    @Test
    fun overridesReflectTheStore() =
        runTest(UnconfinedTestDispatcher()) {
            val store = InMemoryBreadcrumbOverridesStore()
            val viewModel = viewModel(store = store)

            store.register(1, mapOf("driveDetail" to "Trip to office"))

            assertEquals(mapOf("driveDetail" to "Trip to office"), viewModel.overrides.value)
        }

    @Test
    fun onViewOpenedEmitsSlugExactlyOnce() =
        runTest(UnconfinedTestDispatcher()) {
            val logger = RecordingLogger()
            val viewModel = viewModel(logger = logger)

            viewModel.onViewOpened()
            viewModel.onViewOpened()

            val opened = logger.events.filter { it.first == "view.opened" }
            assertEquals(1, opened.size)
            assertEquals(mapOf("surface" to "LayoutBreadcrumbs"), opened.single().second)
        }

    private fun TestScope.viewModel(
        store: BreadcrumbOverridesStore = InMemoryBreadcrumbOverridesStore(),
        logger: RecordingLogger = RecordingLogger(),
    ): LayoutBreadcrumbsViewModel = LayoutBreadcrumbsViewModel(store, logger, scope = backgroundScope)
}
