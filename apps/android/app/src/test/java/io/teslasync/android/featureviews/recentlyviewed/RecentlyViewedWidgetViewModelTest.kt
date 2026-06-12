package io.teslasync.android.featureviews.recentlyviewed

import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Drives [RecentlyViewedWidgetViewModel]: the PII-safe `view.opened` diagnostic (P1/S11) and the mapping
 * of the read-only client store onto the render surface. The web source has a synchronous client store
 * with two data branches — a populated list and an empty hint — so the holder's states are Loading (the
 * pre-resolution frame), Empty (no entries), and Content (newest-first, capped to the display limit).
 */
@OptIn(ExperimentalCoroutinesApi::class)
class RecentlyViewedWidgetViewModelTest {
    private class RecordingLogger : Logger {
        val events = mutableListOf<Pair<String, Map<String, String>>>()

        override fun log(
            level: LogLevel,
            event: String,
            fields: Map<String, String>,
        ) {
            events += event to fields
        }
    }

    @Test
    fun recordViewOpenedEmitsSlugExactlyOnce() =
        runTest(UnconfinedTestDispatcher()) {
            val logger = RecordingLogger()
            val vm = RecentlyViewedWidgetViewModel(emptyStore(), logger, scope = backgroundScope)

            vm.recordViewOpened()
            vm.recordViewOpened()

            val opened = logger.events.filter { it.first == "view.opened" }
            assertEquals(1, opened.size)
            assertEquals(mapOf("surface" to "RecentlyViewedWidget"), opened.single().second)
        }

    @Test
    fun viewOpenedCarriesOnlyTheSurfaceSlug() =
        runTest(UnconfinedTestDispatcher()) {
            val logger = RecordingLogger()
            val vm = RecentlyViewedWidgetViewModel(emptyStore(), logger, scope = backgroundScope)

            vm.recordViewOpened()

            // Recent-page paths/titles are privacy-sensitive; the diagnostic leaks nothing beyond the slug.
            val opened = logger.events.single()
            assertEquals(setOf("surface"), opened.second.keys)
        }

    @Test
    fun initialStateIsLoadingBeforeTheStoreResolves() =
        runTest(UnconfinedTestDispatcher()) {
            val vm = RecentlyViewedWidgetViewModel(emptyStore(), RecordingLogger(), scope = backgroundScope)

            // WhileSubscribed keeps the initial value until the UI subscribes — the skeleton frame.
            assertEquals(RecentlyViewedUiState.Loading, vm.state.value)
        }

    @Test
    fun emptyStoreMapsToEmptyState() =
        runTest(UnconfinedTestDispatcher()) {
            val vm = RecentlyViewedWidgetViewModel(emptyStore(), RecordingLogger(), scope = backgroundScope)

            backgroundScope.launch { vm.state.collect {} }

            assertEquals(RecentlyViewedUiState.Empty, vm.state.value)
        }

    @Test
    fun entriesMapToContentNewestFirstCappedToLimit() =
        runTest(UnconfinedTestDispatcher()) {
            val entries =
                listOf(
                    entry("/a", NOW - 4_000L),
                    entry("/b", NOW),
                    entry("/c", NOW - 1_000L),
                    entry("/d", NOW - 2_000L),
                    entry("/e", NOW - 3_000L),
                    entry("/f", NOW - 5_000L),
                )
            val vm =
                RecentlyViewedWidgetViewModel(
                    store = RecentPagesStore { flowOf(entries) },
                    logger = RecordingLogger(),
                    limit = 5,
                    scope = backgroundScope,
                )

            backgroundScope.launch { vm.state.collect {} }

            val state = vm.state.value
            assertTrue(state is RecentlyViewedUiState.Content)
            val paths = (state as RecentlyViewedUiState.Content).entries.map { it.path }
            assertEquals(listOf("/b", "/c", "/d", "/e", "/a"), paths)
        }

    private fun emptyStore(): RecentPagesStore = RecentPagesStore { flowOf(emptyList()) }

    private fun entry(
        path: String,
        visitedAt: Long,
    ): RecentPageEntry = RecentPageEntry(path = path, title = path, kind = RecentPageKind.Page, visitedAt = visitedAt)

    private companion object {
        const val NOW = 1_780_000_000_000L
    }
}
