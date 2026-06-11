package io.teslasync.android.featureviews.referencelinks

import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * Drives [ReferenceLinksSectionViewModel]. The surface binds no feed, so the only behaviour to cover is the
 * PII-safe `view.opened` diagnostic (P1/S11): emitted exactly once per holder and carrying nothing beyond
 * the surface slug.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class ReferenceLinksSectionViewModelTest {
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
            val vm = ReferenceLinksSectionViewModel(logger, backgroundScope)

            vm.recordViewOpened()
            vm.recordViewOpened()

            val opened = logger.events.filter { it.first == "view.opened" }
            assertEquals(1, opened.size)
            assertEquals(mapOf("surface" to "ReferenceLinksSection"), opened.single().second)
        }

    @Test
    fun viewOpenedCarriesOnlyTheSurfaceSlug() =
        runTest(UnconfinedTestDispatcher()) {
            val logger = RecordingLogger()
            val vm = ReferenceLinksSectionViewModel(logger, backgroundScope)

            vm.recordViewOpened()

            // The diagnostic exposes only the slug — this surface reads no vehicle/activity data to leak.
            val opened = logger.events.single()
            assertEquals(setOf("surface"), opened.second.keys)
        }
}
