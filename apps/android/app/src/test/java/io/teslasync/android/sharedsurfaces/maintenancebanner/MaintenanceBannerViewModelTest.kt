// Tests [MaintenanceBannerViewModel] against the shared `/system/health` seam — covering the contract the view
// depends on: each emission folds onto the lifecycle-aware [MaintenanceBannerRender] the surface renders, a
// resolved `ok` / cold load keeps the banner hidden (web `!data || mode === 'ok'`), an error with a cached
// active window stays visible + stale (offline / last-known), the dismiss hides the banner and logs a slug-only
// event, a freshly-pushed operator snapshot re-surfaces after a dismissal, the countdown advances on [tick],
// and the one-shot `view.opened` fires exactly once with the surface slug. The framework-free projection is
// covered by MaintenanceBannerProjectionTest. Runs in :android:testReleaseUnitTest.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.maintenancebanner

import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.LogRecord
import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.Instant

@OptIn(ExperimentalCoroutinesApi::class)
class MaintenanceBannerViewModelTest {
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

    private val t0 = Instant.parse("2025-01-01T12:00:00Z").toEpochMilli()
    private val untilPlus90s = "2025-01-01T12:01:30Z"

    private fun healthJson(
        mode: String,
        until: String = "",
        updatedAt: String = "2025-01-01T11:00:00Z",
    ): JsonElement =
        buildJsonObject {
            put("mode", mode)
            if (until.isNotEmpty()) put("maintenance_until", until)
            put("maintenance_updated_at", updatedAt)
        }

    private fun success(
        mode: String,
        until: String = "",
        updatedAt: String = "2025-01-01T11:00:00Z",
    ): Resource<JsonElement> = Resource.Success(healthJson(mode, until, updatedAt), fetchedAt = 0L, stale = false)

    @Test
    fun okSnapshotKeepsTheBannerHidden() =
        runTest(UnconfinedTestDispatcher()) {
            val feed = MutableStateFlow<Resource<JsonElement>>(success(ServiceMode.RAW_OK))
            val vm = MaintenanceBannerViewModel(maintenanceBannerSource { feed }, RecordingLogger(), backgroundScope)
            backgroundScope.launch { vm.render.collect {} }
            advanceUntilIdle()

            assertFalse("mode ok hides the banner", vm.render.value.visible)
            assertTrue("an ok snapshot is the empty UI phase", vm.uiState.value.isEmpty)
        }

    @Test
    fun maintenanceSnapshotShowsTheBanner() =
        runTest(UnconfinedTestDispatcher()) {
            val feed = MutableStateFlow<Resource<JsonElement>>(success(ServiceMode.RAW_MAINTENANCE, until = untilPlus90s))
            val vm = MaintenanceBannerViewModel(maintenanceBannerSource { feed }, RecordingLogger(), backgroundScope)
            backgroundScope.launch { vm.render.collect {} }
            advanceUntilIdle()

            val render = vm.render.value
            assertTrue("maintenance is visible", render.visible)
            assertTrue("maintenance variant", render.maintenance)
            assertTrue("the uiState is content", vm.uiState.value.isContent)
        }

    @Test
    fun coldLoadWithNoCacheKeepsTheBannerAbsent() =
        runTest(UnconfinedTestDispatcher()) {
            val feed = MutableStateFlow<Resource<JsonElement>>(Resource.Loading(cached = null, fetchedAt = null, stale = false))
            val vm = MaintenanceBannerViewModel(maintenanceBannerSource { feed }, RecordingLogger(), backgroundScope)
            backgroundScope.launch { vm.render.collect {} }
            advanceUntilIdle()

            assertFalse("a cold load with nothing cached keeps the banner absent (web !data)", vm.render.value.visible)
            assertTrue("the uiState is a first load", vm.uiState.value.isLoading)
        }

    @Test
    fun errorWithCachedMaintenanceStaysVisibleAndStale() =
        runTest(UnconfinedTestDispatcher()) {
            val cached = healthJson(ServiceMode.RAW_MAINTENANCE, until = untilPlus90s)
            val feed =
                MutableStateFlow<Resource<JsonElement>>(
                    Resource.Error(cached = cached, fetchedAt = 0L, stale = true, error = RuntimeException("offline")),
                )
            val vm = MaintenanceBannerViewModel(maintenanceBannerSource { feed }, RecordingLogger(), backgroundScope, clock = { t0 })
            backgroundScope.launch { vm.render.collect {} }
            advanceUntilIdle()

            val render = vm.render.value
            assertTrue("a cached active window stays visible while offline", render.visible)
            assertTrue("offline / last-known shows the stale chip", render.showStaleChip)
        }

    @Test
    fun dismissHidesTheBannerAndLogsSlugOnly() =
        runTest(UnconfinedTestDispatcher()) {
            val logger = RecordingLogger()
            val feed = MutableStateFlow<Resource<JsonElement>>(success(ServiceMode.RAW_MAINTENANCE))
            val vm = MaintenanceBannerViewModel(maintenanceBannerSource { feed }, logger, backgroundScope)
            backgroundScope.launch { vm.render.collect {} }
            advanceUntilIdle()

            vm.dismiss(vm.render.value.currentKey)
            advanceUntilIdle()

            assertFalse("a dismissed banner hides", vm.render.value.visible)
            val dismiss = logger.records.filter { it.event == "maintenanceBanner.dismiss" }
            assertEquals(1, dismiss.size)
            assertEquals(mapOf("surface" to "MaintenanceBanner"), dismiss.single().fields)
        }

    @Test
    fun aFreshlyPushedSnapshotResurfacesAfterDismiss() =
        runTest(UnconfinedTestDispatcher()) {
            val feed = MutableStateFlow<Resource<JsonElement>>(success(ServiceMode.RAW_MAINTENANCE, updatedAt = "2025-01-01T11:00:00Z"))
            val vm = MaintenanceBannerViewModel(maintenanceBannerSource { feed }, RecordingLogger(), backgroundScope)
            backgroundScope.launch { vm.render.collect {} }
            advanceUntilIdle()

            vm.dismiss(vm.render.value.currentKey)
            advanceUntilIdle()
            assertFalse("dismissed", vm.render.value.visible)

            feed.value = success(ServiceMode.RAW_MAINTENANCE, updatedAt = "2025-01-01T13:00:00Z")
            advanceUntilIdle()
            assertTrue("a new operator snapshot re-surfaces the banner", vm.render.value.visible)
        }

    @Test
    fun aRecurringIdenticalWindowResurfacesAfterAnInterveningSnapshot() =
        runTest(UnconfinedTestDispatcher()) {
            val feed = MutableStateFlow<Resource<JsonElement>>(success(ServiceMode.RAW_MAINTENANCE, updatedAt = "2025-01-01T11:00:00Z"))
            val vm = MaintenanceBannerViewModel(maintenanceBannerSource { feed }, RecordingLogger(), backgroundScope)
            backgroundScope.launch { vm.render.collect {} }
            advanceUntilIdle()

            vm.dismiss(vm.render.value.currentKey)
            advanceUntilIdle()

            // An intervening snapshot clears the stale dismissal (web reset effect)…
            feed.value = success(ServiceMode.RAW_DEGRADED, updatedAt = "2025-01-01T12:00:00Z")
            advanceUntilIdle()
            // …so the original window re-surfaces even though its fingerprint is identical to the dismissed one.
            feed.value = success(ServiceMode.RAW_MAINTENANCE, updatedAt = "2025-01-01T11:00:00Z")
            advanceUntilIdle()
            assertTrue("a recurring identical window re-surfaces", vm.render.value.visible)
        }

    @Test
    fun tickAdvancesTheCountdown() =
        runTest(UnconfinedTestDispatcher()) {
            var nowVar = t0
            val feed = MutableStateFlow<Resource<JsonElement>>(success(ServiceMode.RAW_MAINTENANCE, until = untilPlus90s))
            val vm = MaintenanceBannerViewModel(maintenanceBannerSource { feed }, RecordingLogger(), backgroundScope, clock = { nowVar })
            backgroundScope.launch { vm.render.collect {} }
            advanceUntilIdle()

            assertEquals(Countdown.EndsIn("1m 30s"), vm.render.value.countdown)

            nowVar = t0 + 45_000L
            vm.tick()
            advanceUntilIdle()

            assertEquals(Countdown.EndsIn("45s"), vm.render.value.countdown)
        }

    @Test
    fun viewOpenedEmitsOnceWithSlug() =
        runTest(UnconfinedTestDispatcher()) {
            val logger = RecordingLogger()
            val feed = MutableStateFlow<Resource<JsonElement>>(success(ServiceMode.RAW_OK))
            val vm = MaintenanceBannerViewModel(maintenanceBannerSource { feed }, logger, backgroundScope)

            vm.recordViewOpened()
            vm.recordViewOpened()

            val opened = logger.records.filter { it.event == "view.opened" }
            assertEquals(1, opened.size)
            assertEquals("MaintenanceBanner", opened.single().fields["surface"])
            assertTrue("diagnostics carry only the surface slug", opened.single().fields.keys == setOf("surface"))
        }
}
