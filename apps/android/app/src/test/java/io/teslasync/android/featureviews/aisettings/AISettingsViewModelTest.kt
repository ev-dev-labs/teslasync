package io.teslasync.android.featureviews.aisettings

import io.teslasync.android.data.ErrorKind
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
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Drives [AISettingsViewModel] over a controllable fake [AISettingsViewSource], covering the full
 * cache-then-network state matrix the `/settings` read can be in (loading / content / empty / hard error +
 * retry / stale-offline + retry), the today-usage projection for the cost-cap bar, the save delegation
 * (patch shape + off-branch clear + post-save refresh + the in-flight flag reset), and the PII-safe
 * `view.opened` + refresh diagnostics. Mirrors the web component's hook behaviour
 * (web/src/features/settings/components/AISettings.tsx). Run by the `:android:testReleaseUnitTest` gate.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class AISettingsViewModelTest {
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
        var settingsEmissions: List<Resource<JsonElement>>,
        var usageEmissions: List<Resource<JsonElement>> = listOf(Resource.Loading(null, null, false)),
    ) : AISettingsViewSource {
        var saveResult: Result<JsonElement> = Result.success(JsonObject(emptyMap()))
        val savedPatches = mutableListOf<JsonObject>()
        var settingsCollections = 0

        override fun settings(): Flow<Resource<JsonElement>> =
            flow {
                settingsCollections += 1
                settingsEmissions.forEach { emit(it) }
            }

        override fun usageToday(): Flow<Resource<JsonElement>> = flow { usageEmissions.forEach { emit(it) } }

        override suspend fun saveAiSettings(patch: JsonObject): Result<JsonElement> {
            savedPatches += patch
            return saveResult
        }
    }

    @Test
    fun loadingWhenNoCache() =
        runTest(UnconfinedTestDispatcher()) {
            val vm = viewModel(FakeSource(listOf(Resource.Loading(null, null, false))))
            backgroundScope.launch { vm.settings.collect {} }
            advanceUntilIdle()
            assertEquals(UiPhase.Loading, vm.settings.value.phase)
        }

    @Test
    fun contentWhenDocumentPresent() =
        runTest(UnconfinedTestDispatcher()) {
            val src = FakeSource(listOf(Resource.Loading(null, null, false), Resource.Success(cloudDoc(), 100L, false)))
            val vm = viewModel(src)
            backgroundScope.launch { vm.settings.collect {} }
            advanceUntilIdle()

            val state = vm.settings.value
            assertEquals(UiPhase.Content, state.phase)
            assertEquals(HelixMode.Cloud, state.data?.mode)
            assertEquals(500L, state.data?.costCapCents)
            assertEquals(100L, state.fetchedAt)
        }

    @Test
    fun emptyWhenBlankDocument() =
        runTest(UnconfinedTestDispatcher()) {
            val vm = viewModel(FakeSource(listOf(Resource.Success(JsonObject(emptyMap()), 100L, false))))
            backgroundScope.launch { vm.settings.collect {} }
            advanceUntilIdle()
            assertEquals(UiPhase.Empty, vm.settings.value.phase)
        }

    @Test
    fun hardErrorWithRetryWhenNoCache() =
        runTest(UnconfinedTestDispatcher()) {
            val src = FakeSource(listOf(Resource.Loading(null, null, false), Resource.Error(null, null, false, ApiError.Network())))
            val vm = viewModel(src)
            backgroundScope.launch { vm.settings.collect {} }
            advanceUntilIdle()

            val state = vm.settings.value
            assertEquals(UiPhase.Error, state.phase)
            assertEquals(ErrorKind.Network, state.errorKind)
            assertTrue(state.canRetry)
        }

    @Test
    fun staleOfflineKeepsCacheWithRetry() =
        runTest(UnconfinedTestDispatcher()) {
            val src = FakeSource(listOf(Resource.Success(cloudDoc(), 100L, false)))
            val vm = viewModel(src)
            backgroundScope.launch { vm.settings.collect {} }
            advanceUntilIdle()
            assertEquals(
                HelixMode.Cloud,
                vm.settings.value.data
                    ?.mode,
            )

            src.settingsEmissions = listOf(Resource.Error(cloudDoc(), 100L, true, ApiError.Timeout()))
            vm.retry()
            advanceUntilIdle()

            val state = vm.settings.value
            assertEquals(UiPhase.Content, state.phase)
            assertEquals(HelixMode.Cloud, state.data?.mode)
            assertTrue(state.stale)
            assertTrue(state.isOffline)
            assertTrue(state.canRetry)
            assertEquals(ErrorKind.Timeout, state.errorKind)
        }

    @Test
    fun usageTodayProjectsCostMicroCents() =
        runTest(UnconfinedTestDispatcher()) {
            val usage = buildJsonObject { put("cost_micro_cents", 4_200_000L) }
            val src = FakeSource(listOf(Resource.Loading(null, null, false)), listOf(Resource.Success(usage, 1L, false)))
            val vm = viewModel(src)
            backgroundScope.launch { vm.usageToday.collect {} }
            advanceUntilIdle()

            assertEquals(UiPhase.Content, vm.usageToday.value.phase)
            assertEquals(
                4_200_000L,
                vm.usageToday.value.data
                    ?.costMicroCents,
            )
        }

    @Test
    fun saveCloudDelegatesModePatchAndRefreshes() =
        runTest(UnconfinedTestDispatcher()) {
            val src = FakeSource(listOf(Resource.Success(offDoc(), 1L, false)))
            val vm = viewModel(src)
            backgroundScope.launch { vm.settings.collect {} }
            advanceUntilIdle()
            val collectionsBeforeSave = src.settingsCollections

            vm.save(HelixMode.Cloud)
            advanceUntilIdle()

            val patch = src.savedPatches.single()
            assertEquals("cloud", patch["ai_mode"]?.jsonPrimitive?.content)
            assertEquals(1, patch.size)
            assertTrue("save success must restart the read", src.settingsCollections > collectionsBeforeSave)
            assertFalse(vm.saving.value)
        }

    @Test
    fun saveOffClearsFeatures() =
        runTest(UnconfinedTestDispatcher()) {
            val src = FakeSource(listOf(Resource.Success(cloudDoc(), 1L, false)))
            val vm = viewModel(src)

            vm.save(HelixMode.Off)
            advanceUntilIdle()

            val patch = src.savedPatches.single()
            assertEquals("off", patch["ai_mode"]?.jsonPrimitive?.content)
            assertTrue(patch["ai_features"]?.jsonObject?.isEmpty() == true)
        }

    @Test
    fun saveFailureResetsSavingFlagAndKeepsState() =
        runTest(UnconfinedTestDispatcher()) {
            val src = FakeSource(listOf(Resource.Success(offDoc(), 1L, false)))
            src.saveResult = Result.failure(ApiError.Network())
            val vm = viewModel(src)

            vm.save(HelixMode.Local)
            advanceUntilIdle()

            assertEquals(
                "local",
                src.savedPatches
                    .single()["ai_mode"]
                    ?.jsonPrimitive
                    ?.content,
            )
            assertFalse(vm.saving.value)
        }

    @Test
    fun recordViewOpenedEmitsSlugExactlyOnce() =
        runTest(UnconfinedTestDispatcher()) {
            val logger = RecordingLogger()
            val vm = viewModel(FakeSource(emptyList()), logger)

            vm.recordViewOpened()
            vm.recordViewOpened()

            val opened = logger.events.filter { it.first == "view.opened" }
            assertEquals(1, opened.size)
            assertEquals(mapOf("surface" to "AISettings"), opened.single().second)
        }

    @Test
    fun refreshEmitsDiagnosticEvent() =
        runTest(UnconfinedTestDispatcher()) {
            val logger = RecordingLogger()
            val vm = viewModel(FakeSource(emptyList()), logger)

            vm.refresh()

            assertTrue(logger.events.any { it.first == "aiSettings.refresh" })
            assertNull(vm.settings.value.data)
        }

    private fun cloudDoc(capCents: Int = 500) =
        buildJsonObject {
            put("ai_mode", "cloud")
            put("ai_cost_cap_cents", capCents)
        }

    private fun offDoc() = buildJsonObject { put("ai_mode", "off") }

    private fun TestScope.viewModel(
        source: AISettingsViewSource,
        logger: Logger = RecordingLogger(),
    ): AISettingsViewModel = AISettingsViewModel(source, logger, backgroundScope)
}
