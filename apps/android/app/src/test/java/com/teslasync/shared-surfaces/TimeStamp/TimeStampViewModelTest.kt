// Tests [TimeStampViewModel] against the [TimeStampSource] seam with a fake settings + fleet + selection —
// covering every freshness state the config feed renders (loading / content / hard error / offline), the
// one-shot `view.opened` diagnostics event, and the refresh + retry restart of the combined feed. The
// framework-free projection (settings + vehicle → config, the per-state mapping) is covered by
// TimeStampModelTest. Runs in :android:testReleaseUnitTest.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.timestamp

import io.teslasync.android.data.UiPhase
import io.teslasync.shared.core.api.generated.Vehicle
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.LogRecord
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.net.ApiError
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asFlow
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
import kotlin.time.Instant

@OptIn(ExperimentalCoroutinesApi::class)
class TimeStampViewModelTest {
    private class FakeSource(
        private val settingsEmissions: List<Resource<JsonElement>>,
        private val vehiclesEmissions: List<Resource<List<Vehicle>>>,
        initialSelectedId: Long? = null,
    ) : TimeStampSource {
        private val mutableSelectedId = MutableStateFlow(initialSelectedId)
        var settingsCalls = 0
            private set
        var vehiclesCalls = 0
            private set

        override val selectedId: StateFlow<Long?> = mutableSelectedId

        override fun settings(): Flow<Resource<JsonElement>> {
            settingsCalls++
            return settingsEmissions.asFlow()
        }

        override fun vehicles(): Flow<Resource<List<Vehicle>>> {
            vehiclesCalls++
            return vehiclesEmissions.asFlow()
        }
    }

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

    private fun vehicle(
        id: Long,
        tz: String = "America/Los_Angeles",
    ): Vehicle =
        Vehicle(
            createdAt = Instant.parse("2026-01-01T00:00:00Z"),
            displayName = "Car $id",
            enrolledAt = Instant.parse("2026-01-01T00:00:00Z"),
            id = id,
            teslaId = 1000 + id,
            timezone = tz,
            updatedAt = Instant.parse("2026-01-01T00:10:00Z"),
            vin = "VIN$id",
        )

    private fun settingsSuccess(
        locale: String,
        timeFormat: String? = null,
    ): Resource<JsonElement> =
        Resource.Success(
            buildJsonObject {
                put("locale", locale)
                if (timeFormat != null) put("time_format_default", timeFormat)
            },
            fetchedAt = 100L,
            stale = false,
        )

    private fun vehiclesSuccess(vehicles: List<Vehicle>): Resource<List<Vehicle>> =
        Resource.Success(vehicles, fetchedAt = 100L, stale = false)

    private fun settingsLoading(): Resource<JsonElement> = Resource.Loading(cached = null, fetchedAt = null, stale = false)

    private fun vehiclesLoading(): Resource<List<Vehicle>> = Resource.Loading(cached = null, fetchedAt = null, stale = false)

    private fun vm(
        source: TimeStampSource,
        scope: CoroutineScope,
        logger: Logger = RecordingLogger(),
    ): TimeStampViewModel = TimeStampViewModel(source, logger, scope)

    @Test
    fun firstLoadWithNoCacheIsLoadingPhase() =
        runTest(UnconfinedTestDispatcher()) {
            val source = FakeSource(listOf(settingsLoading()), listOf(vehiclesLoading()))
            val model = vm(source, backgroundScope)
            backgroundScope.launch { model.state.collect {} }
            advanceUntilIdle()

            assertTrue(model.state.value.isLoading)
        }

    @Test
    fun bothSuccessResolvesTheConfigAsContent() =
        runTest(UnconfinedTestDispatcher()) {
            val source =
                FakeSource(
                    settingsEmissions = listOf(settingsSuccess("fr-FR", timeFormat = "absolute")),
                    vehiclesEmissions = listOf(vehiclesSuccess(listOf(vehicle(1)))),
                    initialSelectedId = 1L,
                )
            val model = vm(source, backgroundScope)
            backgroundScope.launch { model.state.collect {} }
            advanceUntilIdle()

            val state = model.state.value
            assertEquals(UiPhase.Content, state.phase)
            assertEquals("fr-FR", state.data?.localeTag)
            assertEquals("America/Los_Angeles", state.data?.vehicleTimezone)
            assertEquals(TimeFormat.Absolute, state.data?.timeFormatDefault)
        }

    @Test
    fun hardErrorWithNoCacheIsErrorPhase() =
        runTest(UnconfinedTestDispatcher()) {
            val source =
                FakeSource(
                    settingsEmissions = listOf(Resource.Error(cached = null, fetchedAt = null, stale = false, error = ApiError.Network())),
                    vehiclesEmissions = listOf(Resource.Error(cached = null, fetchedAt = null, stale = false, error = ApiError.Network())),
                )
            val model = vm(source, backgroundScope)
            backgroundScope.launch { model.state.collect {} }
            advanceUntilIdle()

            assertEquals(UiPhase.Error, model.state.value.phase)
            assertTrue(model.state.value.hasError)
            assertFalse(model.state.value.hasData)
        }

    @Test
    fun offlineKeepsCachedConfigWithStaleAndRetry() =
        runTest(UnconfinedTestDispatcher()) {
            val source =
                FakeSource(
                    settingsEmissions =
                        listOf(
                            Resource.Error(
                                cached = buildJsonObject { put("locale", "fr-FR") },
                                fetchedAt = 100L,
                                stale = true,
                                error = ApiError.Network(),
                            ),
                        ),
                    vehiclesEmissions = listOf(vehiclesSuccess(listOf(vehicle(1)))),
                    initialSelectedId = 1L,
                )
            val model = vm(source, backgroundScope)
            backgroundScope.launch { model.state.collect {} }
            advanceUntilIdle()

            val state = model.state.value
            assertEquals(UiPhase.Content, state.phase)
            assertEquals("fr-FR", state.data?.localeTag)
            assertTrue(state.stale)
            assertTrue(state.isOffline)
            assertTrue(state.canRetry)
        }

    @Test
    fun refreshRestartsTheFeedsAndLogs() =
        runTest(UnconfinedTestDispatcher()) {
            val source = FakeSource(listOf(settingsSuccess("en-US")), listOf(vehiclesSuccess(listOf(vehicle(1)))))
            val logger = RecordingLogger()
            val model = vm(source, backgroundScope, logger)
            backgroundScope.launch { model.state.collect {} }
            advanceUntilIdle()
            val settingsBefore = source.settingsCalls
            val vehiclesBefore = source.vehiclesCalls

            model.refresh()
            advanceUntilIdle()

            assertTrue(source.settingsCalls > settingsBefore)
            assertTrue(source.vehiclesCalls > vehiclesBefore)
            assertTrue(logger.records.any { it.event == "timeStamp.refresh" })
        }

    @Test
    fun retryAlsoRestartsTheFeeds() =
        runTest(UnconfinedTestDispatcher()) {
            val source = FakeSource(listOf(settingsSuccess("en-US")), listOf(vehiclesSuccess(listOf(vehicle(1)))))
            val model = vm(source, backgroundScope)
            backgroundScope.launch { model.state.collect {} }
            advanceUntilIdle()
            val settingsBefore = source.settingsCalls

            model.retry()
            advanceUntilIdle()

            assertTrue(source.settingsCalls > settingsBefore)
        }

    @Test
    fun viewOpenedEmitsDiagnosticsOnceWithSlug() =
        runTest(UnconfinedTestDispatcher()) {
            val logger = RecordingLogger()
            val source = FakeSource(listOf(settingsLoading()), listOf(vehiclesLoading()))
            val model = vm(source, backgroundScope, logger)

            model.onViewOpened()
            model.onViewOpened()

            val opened = logger.records.filter { it.event == "view.opened" }
            assertEquals(1, opened.size)
            assertEquals("TimeStamp", opened.first().fields["surface"])
        }
}
