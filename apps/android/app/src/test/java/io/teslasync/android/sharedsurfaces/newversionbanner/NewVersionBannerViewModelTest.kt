// Tests [NewVersionBannerViewModel] against the deployment-identity seam — covering the contract the view depends
// on: the identity feed re-shares onto a lifecycle-aware [io.teslasync.android.data.UiState] seeded as loading and
// surfaces content/error; the watcher captures boot once and flips newVersionAvailable on a redeploy (web
// useVersionWatcher); "Later" defers the active identity (web handleLater) and a newer deploy clears the deferral;
// "Reload" re-baselines the watcher and clears the banner (web window.location.reload); the actions log slug-only
// PII-safe events; and the one-shot view.opened fires exactly once with the surface slug (never a version string).
// The framework-free projection + fold are covered by their own tests. Runs in :app:testReleaseUnitTest.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.newversionbanner

import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.LogRecord
import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

@OptIn(ExperimentalCoroutinesApi::class)
class NewVersionBannerViewModelTest {
    private class RecordingLogger : Logger {
        val records = mutableListOf<LogRecord>()

        override fun log(
            level: LogLevel,
            event: String,
            fields: Map<String, String>,
        ) {
            records += LogRecord(level, event, fields)
        }
    }

    private val stamp = 1_700_000_000_000L

    private fun source(feed: Flow<Resource<String>>): NewVersionBannerSource = newVersionBannerSource { feed }

    private fun success(
        version: String,
        at: Long = stamp,
    ): Resource<String> = Resource.Success(version, at, false)

    // ── feed lifecycle → UiState ─────────────────────────────────────────────────────────────────────────────

    @Test
    fun stateSeedsAsLoadingBeforeAnyEmission() =
        runTest(UnconfinedTestDispatcher()) {
            val model = NewVersionBannerViewModel(source(flowOf()), RecordingLogger(), backgroundScope)
            assertTrue(model.state.value.isLoading)
        }

    @Test
    fun stateReflectsASuccessfulIdentity() =
        runTest(UnconfinedTestDispatcher()) {
            val model = NewVersionBannerViewModel(source(flowOf(success("v1"))), RecordingLogger(), backgroundScope)
            backgroundScope.launch { model.state.collect {} }
            advanceUntilIdle()

            assertTrue(model.state.value.isContent)
            assertEquals("v1", model.state.value.data)
        }

    @Test
    fun stateReflectsAHardError() =
        runTest(UnconfinedTestDispatcher()) {
            val errored =
                source(flowOf(Resource.Error<String>(cached = null, fetchedAt = null, stale = false, error = RuntimeException("x"))))
            val model = NewVersionBannerViewModel(errored, RecordingLogger(), backgroundScope)
            backgroundScope.launch { model.state.collect {} }
            advanceUntilIdle()

            assertTrue(model.state.value.isError)
        }

    // ── watcher: boot capture + redeploy detection (web useVersionWatcher) ───────────────────────────────────

    @Test
    fun watcherCapturesBootThenDetectsANewDeployment() =
        runTest(UnconfinedTestDispatcher()) {
            val feed = MutableStateFlow(success("v1"))
            val model = NewVersionBannerViewModel(source(feed), RecordingLogger(), backgroundScope)
            advanceUntilIdle()

            assertEquals("v1", model.watcher.value.bootVersion)
            assertEquals("v1", model.watcher.value.latestVersion)
            assertFalse(model.watcher.value.newVersionAvailable)

            feed.value = success("v2", stamp + 1)
            advanceUntilIdle()

            assertEquals("boot is captured once and never overwritten", "v1", model.watcher.value.bootVersion)
            assertEquals("v2", model.watcher.value.latestVersion)
            assertTrue(model.watcher.value.newVersionAvailable)
        }

    // ── later: defer the active identity (web handleLater) ───────────────────────────────────────────────────

    @Test
    fun laterDefersTheLatestIdentityAndLogsSlugOnly() =
        runTest(UnconfinedTestDispatcher()) {
            val feed = MutableStateFlow(success("v1"))
            val logger = RecordingLogger()
            val model = NewVersionBannerViewModel(source(feed), logger, backgroundScope)
            advanceUntilIdle()
            feed.value = success("v2", stamp + 1)
            advanceUntilIdle()

            model.later()

            assertEquals("v2", model.dismissedVersion.value)
            val later = logger.records.filter { it.event == "newVersion.later" }
            assertEquals(1, later.size)
            assertEquals(mapOf("surface" to "NewVersionBanner"), later.single().fields)
        }

    @Test
    fun laterIsANoopWhenNoIdentityIsKnown() =
        runTest(UnconfinedTestDispatcher()) {
            val feed = MutableStateFlow<Resource<String>>(Resource.Loading(cached = null, fetchedAt = null, stale = false))
            val logger = RecordingLogger()
            val model = NewVersionBannerViewModel(source(feed), logger, backgroundScope)
            advanceUntilIdle()

            model.later()

            assertNull(model.dismissedVersion.value)
            assertTrue("no deferral event is logged when there is nothing to defer", logger.records.none { it.event == "newVersion.later" })
        }

    @Test
    fun aNewerDeploymentClearsAPriorDeferral() =
        runTest(UnconfinedTestDispatcher()) {
            val feed = MutableStateFlow(success("v1"))
            val model = NewVersionBannerViewModel(source(feed), RecordingLogger(), backgroundScope)
            advanceUntilIdle()
            feed.value = success("v2", stamp + 1)
            advanceUntilIdle()
            model.later()
            assertEquals("v2", model.dismissedVersion.value)

            feed.value = success("v3", stamp + 2)
            advanceUntilIdle()

            assertNull("a deferral does not carry forward to a newer deployment", model.dismissedVersion.value)
            assertTrue(model.watcher.value.newVersionAvailable)
        }

    // ── reload: re-baseline onto the new deployment (web window.location.reload) ─────────────────────────────

    @Test
    fun reloadReBaselinesTheWatcherClearsTheBannerAndLogsSlugOnly() =
        runTest(UnconfinedTestDispatcher()) {
            val feed = MutableStateFlow(success("v1"))
            val logger = RecordingLogger()
            val model = NewVersionBannerViewModel(source(feed), logger, backgroundScope)
            advanceUntilIdle()
            feed.value = success("v2", stamp + 1)
            advanceUntilIdle()
            assertTrue(model.watcher.value.newVersionAvailable)

            model.reload()
            advanceUntilIdle()

            assertFalse("reload aligns boot to the new deployment so the banner clears", model.watcher.value.newVersionAvailable)
            assertEquals("v2", model.watcher.value.bootVersion)
            assertNull(model.dismissedVersion.value)
            val reload = logger.records.filter { it.event == "newVersion.reload" }
            assertEquals(1, reload.size)
            assertEquals(mapOf("surface" to "NewVersionBanner"), reload.single().fields)
        }

    @Test
    fun refreshLogsASlugOnlyEvent() =
        runTest(UnconfinedTestDispatcher()) {
            val logger = RecordingLogger()
            val model = NewVersionBannerViewModel(source(flowOf(success("v1"))), logger, backgroundScope)

            model.refresh()

            val refresh = logger.records.filter { it.event == "newVersion.refresh" }
            assertEquals(1, refresh.size)
            assertEquals(mapOf("surface" to "NewVersionBanner"), refresh.single().fields)
        }

    // ── diagnostics: the one-shot view.opened (P1/S11) ───────────────────────────────────────────────────────

    @Test
    fun viewOpenedEmitsDiagnosticOnceWithSlug() =
        runTest(UnconfinedTestDispatcher()) {
            val logger = RecordingLogger()
            val model = NewVersionBannerViewModel(source(flowOf(success("v1"))), logger, backgroundScope)

            model.recordViewOpened()
            model.recordViewOpened()

            val opened = logger.records.filter { it.event == "view.opened" }
            assertEquals(1, opened.size)
            assertEquals("NewVersionBanner", opened.first().fields["surface"])
            assertTrue("diagnostics carry only the surface slug", opened.first().fields.keys == setOf("surface"))
        }
}
