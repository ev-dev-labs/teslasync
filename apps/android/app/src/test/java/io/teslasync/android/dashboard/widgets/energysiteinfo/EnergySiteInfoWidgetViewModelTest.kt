package io.teslasync.android.dashboard.widgets.energysiteinfo

import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.NoopLogger
import io.teslasync.android.data.UiPhase
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.net.ApiError
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.flow
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.add
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Drives [EnergySiteInfoWidgetViewModel] over a controllable fake [EnergySiteInfoSource], covering the full
 * cache-then-network state matrix the web component renders (loading / content / no-site empty /
 * no-detail empty / hard error + retry / stale-offline + retry / refresh re-fetch), the linked-site
 * resolution from the catalog (web `(sites ?? [])[0]?.energy_site_id`), the asymmetric error semantics (a
 * site-info failure is a hard error like web `infoError`, while a catalog failure degrades to a cached
 * empty rather than the hard error surface), and the PII-safe `view.opened` diagnostic.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class EnergySiteInfoWidgetViewModelTest {
    /** A fake whose feeds are re-read on every (re)collection, so a change before `refresh()` is observed. */
    private class FakeSource : EnergySiteInfoSource {
        var sitesEmissions: List<Resource<JsonElement>> = listOf(loading())
        val infoEmissions = mutableMapOf<Long, List<Resource<JsonElement>>>()

        override fun energySites(): Flow<Resource<JsonElement>> = flow { sitesEmissions.forEach { emit(it) } }

        override fun energySiteInfo(siteId: Long): Flow<Resource<JsonElement>> =
            flow { (infoEmissions[siteId] ?: listOf(loading())).forEach { emit(it) } }
    }

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
    fun loadingWhileCatalogLoads() =
        runTest(UnconfinedTestDispatcher()) {
            val vm = viewModel(FakeSource())
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()
            assertEquals(UiPhase.Loading, vm.state.value.phase)
        }

    @Test
    fun contentWhenLinkedSiteHasDetail() =
        runTest(UnconfinedTestDispatcher()) {
            val src = FakeSource()
            src.sitesEmissions = listOf(Resource.Success(sites(5L), 50L, false))
            src.infoEmissions[5L] = listOf(Resource.Success(infoResponse(powerW = 10500.0), 100L, false))
            val vm = viewModel(src)
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()

            val state = vm.state.value
            assertEquals(UiPhase.Content, state.phase)
            assertEquals(100L, state.fetchedAt)
            assertEquals(true, state.data?.hasSites)
            assertEquals(10500.0, state.data?.info?.nameplatePowerW)
        }

    @Test
    fun emptyNoSiteWhenCatalogResolvesEmpty() =
        runTest(UnconfinedTestDispatcher()) {
            val src = FakeSource()
            src.sitesEmissions = listOf(Resource.Success(buildJsonArray {}, 100L, false))
            val vm = viewModel(src)
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()

            val state = vm.state.value
            assertEquals(UiPhase.Empty, state.phase)
            assertEquals(false, state.data?.hasSites)
        }

    @Test
    fun emptyNoDataWhenLinkedSiteHasNoDetail() =
        runTest(UnconfinedTestDispatcher()) {
            val src = FakeSource()
            src.sitesEmissions = listOf(Resource.Success(sites(5L), 50L, false))
            src.infoEmissions[5L] = listOf(Resource.Success(buildJsonObject { put("data", JsonNull) }, 100L, false))
            val vm = viewModel(src)
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()

            val state = vm.state.value
            assertEquals(UiPhase.Empty, state.phase)
            assertEquals(true, state.data?.hasSites)
            assertNull(state.data?.info)
        }

    @Test
    fun emptyNoDataWhenCatalogEntryHasNoId() =
        runTest(UnconfinedTestDispatcher()) {
            val src = FakeSource()
            src.sitesEmissions =
                listOf(Resource.Success(buildJsonArray { add(buildJsonObject { put("resource_type", "battery") }) }, 100L, false))
            val vm = viewModel(src)
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()

            val state = vm.state.value
            assertEquals(UiPhase.Empty, state.phase)
            assertEquals(true, state.data?.hasSites)
        }

    @Test
    fun hardErrorWithRetryWhenSiteInfoFailsWithNoCache() =
        runTest(UnconfinedTestDispatcher()) {
            val src = FakeSource()
            src.sitesEmissions = listOf(Resource.Success(sites(5L), 50L, false))
            src.infoEmissions[5L] = listOf(loading(), Resource.Error(null, null, false, ApiError.Network()))
            val vm = viewModel(src)
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()

            val state = vm.state.value
            assertEquals(UiPhase.Error, state.phase)
            assertEquals(ErrorKind.Network, state.errorKind)
            assertTrue(state.canRetry)
        }

    @Test
    fun catalogErrorDegradesToEmptyNotHardError() =
        runTest(UnconfinedTestDispatcher()) {
            val src = FakeSource()
            src.sitesEmissions = listOf(loading(), Resource.Error(null, null, false, ApiError.Network()))
            val vm = viewModel(src)
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()

            val state = vm.state.value
            // A catalog failure must NOT raise the hard error surface (web only `infoError` does that).
            assertEquals(UiPhase.Empty, state.phase)
            assertTrue(state.hasError)
            assertTrue(state.canRetry)
            assertEquals(false, state.data?.hasSites)
        }

    @Test
    fun staleOfflineKeepsCachedDetailWithRetry() =
        runTest(UnconfinedTestDispatcher()) {
            val src = FakeSource()
            src.sitesEmissions = listOf(Resource.Success(sites(5L), 50L, false))
            val cached = infoResponse(powerW = 9000.0)
            src.infoEmissions[5L] = listOf(Resource.Success(cached, 100L, false))
            val vm = viewModel(src)
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()
            assertEquals(UiPhase.Content, vm.state.value.phase)

            src.infoEmissions[5L] = listOf(Resource.Error(cached, 100L, true, ApiError.Timeout()))
            vm.refresh()
            advanceUntilIdle()

            val state = vm.state.value
            assertEquals(UiPhase.Content, state.phase)
            assertTrue(state.stale)
            assertTrue(state.isOffline)
            assertTrue(state.canRetry)
            assertEquals(ErrorKind.Timeout, state.errorKind)
            assertEquals(9000.0, state.data?.info?.nameplatePowerW)
        }

    @Test
    fun refreshReFetchesUpdatedDetail() =
        runTest(UnconfinedTestDispatcher()) {
            val src = FakeSource()
            src.sitesEmissions = listOf(Resource.Success(sites(5L), 50L, false))
            src.infoEmissions[5L] = listOf(Resource.Success(infoResponse(powerW = 8000.0), 100L, false))
            val vm = viewModel(src)
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()
            val initial = vm.state.value
            assertEquals(8000.0, initial.data?.info?.nameplatePowerW)

            src.infoEmissions[5L] = listOf(Resource.Success(infoResponse(powerW = 12000.0), 200L, false))
            vm.refresh()
            advanceUntilIdle()

            val refreshed = vm.state.value
            assertEquals(12000.0, refreshed.data?.info?.nameplatePowerW)
            assertEquals(200L, refreshed.fetchedAt)
        }

    @Test
    fun recordViewOpenedEmitsSlugExactlyOnce() =
        runTest(UnconfinedTestDispatcher()) {
            val logger = RecordingLogger()
            val vm = viewModel(FakeSource(), logger = logger)

            vm.recordViewOpened()
            vm.recordViewOpened()

            val opened = logger.events.filter { it.first == "view.opened" }
            assertEquals(1, opened.size)
            assertEquals(mapOf("surface" to "EnergySiteInfoWidget"), opened.single().second)
        }

    @Test
    fun refreshEmitsDiagnosticWithoutSitePayload() =
        runTest(UnconfinedTestDispatcher()) {
            val logger = RecordingLogger()
            val vm = viewModel(FakeSource(), logger = logger)

            vm.refresh()

            assertTrue(logger.events.any { it.first == "energySiteInfo.refresh" })
            assertFalse(logger.events.any { it.second.containsKey("nameplate_power") })
            assertFalse(logger.events.any { it.second.containsKey("version") })
        }

    private fun TestScope.viewModel(
        source: EnergySiteInfoSource,
        logger: Logger = NoopLogger,
    ): EnergySiteInfoWidgetViewModel = EnergySiteInfoWidgetViewModel(source, logger, backgroundScope)

    private companion object {
        fun loading(): Resource<JsonElement> = Resource.Loading(cached = null, fetchedAt = null, stale = false)

        fun sites(vararg ids: Long): JsonElement =
            buildJsonArray { ids.forEach { id -> add(buildJsonObject { put("energy_site_id", id) }) } }

        fun infoResponse(
            powerW: Double? = null,
            energyWh: Double? = null,
            count: Int? = null,
            version: String? = null,
        ): JsonElement =
            buildJsonObject {
                put(
                    "data",
                    buildJsonObject {
                        powerW?.let { put("nameplate_power", it) }
                        energyWh?.let { put("nameplate_energy", it) }
                        count?.let { put("battery_count", it) }
                        version?.let { put("version", it) }
                    },
                )
            }
    }
}
