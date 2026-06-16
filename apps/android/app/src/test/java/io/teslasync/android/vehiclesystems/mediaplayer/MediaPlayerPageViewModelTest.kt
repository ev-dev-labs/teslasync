@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.vehiclesystems.mediaplayer

import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.net.ApiError
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.flow
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Drives [MediaPlayerPageViewModel] over a controllable fake [MediaPlayerPageSource], covering the latest-snapshot +
 * listening-history feeds' cache-then-network state matrix (loading / content / empty / error / no-vehicle), the
 * settings-derived display preference, the refresh re-fetch, and the PII-safe `view.opened` diagnostic — end to end
 * through the real `Resource → UiState` projection.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class MediaPlayerPageViewModelTest {
    private val snapshotJson: JsonElement =
        Json.parseToJsonElement(
            """{"id":7,"playback_status":"Playing","playback_source":"Spotify","now_playing_title":"Song A","audio_volume":7,"created_at":"2024-01-01T00:00:00Z"}""",
        )

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

    private class FakeSource(
        val selected: MutableStateFlow<Long?> = MutableStateFlow(1L),
        var latest: List<Resource<JsonElement>> = listOf(Resource.Success(JsonNull, 0L, false)),
        var history: List<Resource<JsonElement>> = listOf(Resource.Success(JsonArray(emptyList()), 0L, false)),
        val settingsFlow: MutableStateFlow<Resource<JsonElement>> =
            MutableStateFlow(Resource.Success(JsonObject(emptyMap()), 0L, false)),
    ) : MediaPlayerPageSource {
        var latestCalls = 0
        var historyCalls = 0

        override fun selectedVehicleId(): StateFlow<Long?> = selected

        override fun latestMedia(vehicleId: String): Flow<Resource<JsonElement>> {
            latestCalls++
            return flow { latest.forEach { emit(it) } }
        }

        override fun mediaHistory(vehicleId: String): Flow<Resource<JsonElement>> {
            historyCalls++
            return flow { history.forEach { emit(it) } }
        }

        override fun settings(): Flow<Resource<JsonElement>> = settingsFlow
    }

    @Test
    fun latestContentWhenSnapshotLoaded() =
        runTest(UnconfinedTestDispatcher()) {
            val vm = viewModel(FakeSource(latest = listOf(Resource.Success(snapshotJson, 100L, false))))
            backgroundScope.launch { vm.latestState.collect {} }
            advanceUntilIdle()
            assertTrue(vm.latestState.value.isContent)
            assertEquals("Song A", vm.latestState.value.data?.nowPlayingTitle)
        }

    @Test
    fun latestEmptyWhenNullPayload() =
        runTest(UnconfinedTestDispatcher()) {
            val vm = viewModel(FakeSource(latest = listOf(Resource.Success(JsonNull, 100L, false))))
            backgroundScope.launch { vm.latestState.collect {} }
            advanceUntilIdle()
            assertTrue(vm.latestState.value.isEmpty)
        }

    @Test
    fun latestEmptyWithNoFetchWhenNoVehicle() =
        runTest(UnconfinedTestDispatcher()) {
            val src = FakeSource(selected = MutableStateFlow(null), latest = listOf(Resource.Success(snapshotJson, 1L, false)))
            val vm = viewModel(src)
            backgroundScope.launch { vm.latestState.collect {} }
            advanceUntilIdle()
            assertTrue(vm.latestState.value.isEmpty)
            assertEquals(0, src.latestCalls)
        }

    @Test
    fun latestHardErrorOffersRetry() =
        runTest(UnconfinedTestDispatcher()) {
            val vm = viewModel(FakeSource(latest = listOf(Resource.Error(null, null, false, ApiError.Network()))))
            backgroundScope.launch { vm.latestState.collect {} }
            advanceUntilIdle()
            assertTrue(vm.latestState.value.isError)
            assertTrue(vm.latestState.value.canRetry)
        }

    @Test
    fun historyContentWhenRowsLoaded() =
        runTest(UnconfinedTestDispatcher()) {
            val rows = Json.parseToJsonElement("""[$snapshotJson]""")
            val vm = viewModel(FakeSource(history = listOf(Resource.Success(rows, 100L, false))))
            backgroundScope.launch { vm.historyState.collect {} }
            advanceUntilIdle()
            assertTrue(vm.historyState.value.isContent)
            assertEquals(1, vm.historyState.value.data?.size)
        }

    @Test
    fun historyEmptyWhenNoRows() =
        runTest(UnconfinedTestDispatcher()) {
            val vm = viewModel(FakeSource(history = listOf(Resource.Success(JsonArray(emptyList()), 100L, false))))
            backgroundScope.launch { vm.historyState.collect {} }
            advanceUntilIdle()
            assertTrue(vm.historyState.value.isEmpty)
        }

    @Test
    fun historyEmptyWithNoFetchWhenNoVehicle() =
        runTest(UnconfinedTestDispatcher()) {
            val rows = Json.parseToJsonElement("""[$snapshotJson]""")
            val src = FakeSource(selected = MutableStateFlow(null), history = listOf(Resource.Success(rows, 1L, false)))
            val vm = viewModel(src)
            backgroundScope.launch { vm.historyState.collect {} }
            advanceUntilIdle()
            assertTrue(vm.historyState.value.isEmpty)
            assertEquals(0, src.historyCalls)
        }

    @Test
    fun refreshReFetchesBothFeeds() =
        runTest(UnconfinedTestDispatcher()) {
            val src = FakeSource(latest = listOf(Resource.Success(snapshotJson, 1L, false)))
            val vm = viewModel(src)
            backgroundScope.launch { vm.latestState.collect {} }
            backgroundScope.launch { vm.historyState.collect {} }
            advanceUntilIdle()
            val before = src.latestCalls

            vm.refresh()
            advanceUntilIdle()

            assertTrue(src.latestCalls > before)
            assertTrue(src.historyCalls >= 2)
        }

    @Test
    fun displayPrefsReflectLocaleSetting() =
        runTest(UnconfinedTestDispatcher()) {
            val src =
                FakeSource(
                    settingsFlow =
                        MutableStateFlow(
                            Resource.Success(Json.parseToJsonElement("""{"locale":"fr-FR"}"""), 0L, false),
                        ),
                )
            val vm = viewModel(src)
            backgroundScope.launch { vm.displayPrefs.collect {} }
            advanceUntilIdle()
            assertEquals("fr-FR", vm.displayPrefs.value.locale)
        }

    @Test
    fun recordViewOpenedEmitsSlugExactlyOnce() =
        runTest(UnconfinedTestDispatcher()) {
            val logger = RecordingLogger()
            val vm = viewModel(FakeSource(), logger)

            vm.recordViewOpened()
            vm.recordViewOpened()

            val opened = logger.events.filter { it.first == "view.opened" }
            assertEquals(1, opened.size)
            assertEquals(mapOf("surface" to "MediaPlayerPage"), opened.single().second)
            assertFalse(opened.single().second.containsKey("vehicle_id"))
        }

    private fun TestScope.viewModel(
        source: MediaPlayerPageSource,
        logger: Logger = RecordingLogger(),
    ): MediaPlayerPageViewModel = MediaPlayerPageViewModel(source, logger, backgroundScope)
}
