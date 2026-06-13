package io.teslasync.android.sharedsurfaces.unitinput

import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.NoopLogger
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
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Drives [UnitInputViewModel] over a controllable fake [UnitInputSettingsSource], covering the settings
 * document's cache-then-network lifecycle the surface renders — loading → content, the hard error, the
 * stale/offline envelope projected with a value — plus retry re-fetching, and the PII-safe `view.opened` /
 * `unitinput.refresh` diagnostics (P1/S11 — surface slug only, never the typed value). The view never
 * performs HTTP; every read flows through the fake source.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class UnitInputViewModelTest {
    @Test
    fun settingsSuccessExposesContent() =
        runTest(UnconfinedTestDispatcher()) {
            val vm = viewModel(FakeSource(success(metric())))
            backgroundScope.launch { vm.settings.collect {} }
            advanceUntilIdle()

            assertTrue(vm.settings.value.isContent)
            assertTrue(vm.settings.value.hasData)
        }

    @Test
    fun firstLoadWithNoCacheExposesLoading() =
        runTest(UnconfinedTestDispatcher()) {
            val vm = viewModel(FakeSource(Resource.Loading(cached = null, fetchedAt = null, stale = false)))
            backgroundScope.launch { vm.settings.collect {} }
            advanceUntilIdle()

            assertTrue(vm.settings.value.isLoading)
        }

    @Test
    fun hardErrorWithNoCacheExposesError() =
        runTest(UnconfinedTestDispatcher()) {
            val vm =
                viewModel(
                    FakeSource(Resource.Error(cached = null, fetchedAt = null, stale = false, error = ApiError.Network())),
                )
            backgroundScope.launch { vm.settings.collect {} }
            advanceUntilIdle()

            assertTrue(vm.settings.value.isError)
            assertEquals(ErrorKind.Network, vm.settings.value.errorKind)
        }

    @Test
    fun cachedErrorProjectsOfflineValue() =
        runTest(UnconfinedTestDispatcher()) {
            val vm =
                viewModel(
                    FakeSource(
                        Resource.Error(cached = km(), fetchedAt = 5L, stale = true, error = ApiError.Timeout()),
                    ),
                )
            backgroundScope.launch { vm.settings.collect {} }
            advanceUntilIdle()

            val display = UnitInputProjection.project(vm.settings.value, 60.0, UnitKind.Distance)
            assertEquals(UnitInputPhase.Content, display.phase)
            assertEquals("96.56", display.formattedValue)
            assertEquals("km", display.symbol)
            assertTrue(display.offline)
            assertFalse(display.stale)
        }

    @Test
    fun retryReFetchesAndEmitsDiagnostic() =
        runTest(UnconfinedTestDispatcher()) {
            val logger = RecordingLogger()
            val source = FakeSource(Resource.Error(cached = null, fetchedAt = null, stale = false, error = ApiError.Network()))
            val vm = viewModel(source, logger)
            backgroundScope.launch { vm.settings.collect {} }
            advanceUntilIdle()
            assertTrue(vm.settings.value.isError)
            val callsBefore = source.calls

            source.resource = success(metric())
            vm.retry()
            advanceUntilIdle()

            assertTrue(source.calls > callsBefore)
            assertTrue(vm.settings.value.isContent)
            val refresh = logger.events.single { it.first == "unitinput.refresh" }
            assertEquals(mapOf("surface" to "UnitInput"), refresh.second)
        }

    @Test
    fun viewOpenedEmitsSlugExactlyOnce() =
        runTest(UnconfinedTestDispatcher()) {
            val logger = RecordingLogger()
            val vm = viewModel(FakeSource(success(metric())), logger)

            vm.onViewOpened()
            vm.onViewOpened()

            val opened = logger.events.filter { it.first == "view.opened" }
            assertEquals(1, opened.size)
            assertEquals(mapOf("surface" to "UnitInput"), opened.single().second)
        }

    private class FakeSource(
        var resource: Resource<JsonElement>,
    ) : UnitInputSettingsSource {
        var calls: Int = 0

        override fun settings(): Flow<Resource<JsonElement>> {
            calls++
            return flow { emit(resource) }
        }
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

    private fun TestScope.viewModel(
        source: UnitInputSettingsSource,
        logger: Logger = NoopLogger,
    ): UnitInputViewModel = UnitInputViewModel(source, logger, backgroundScope)

    private companion object {
        fun metric(): JsonElement = buildJsonObject { put("unit_of_length", "mi") }

        fun km(): JsonElement = buildJsonObject { put("unit_of_length", "km") }

        fun success(document: JsonElement): Resource<JsonElement> = Resource.Success(document, fetchedAt = 1L, stale = false)
    }
}
