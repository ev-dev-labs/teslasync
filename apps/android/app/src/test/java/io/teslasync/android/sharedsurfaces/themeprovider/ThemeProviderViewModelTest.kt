package io.teslasync.android.sharedsurfaces.themeprovider

import io.teslasync.android.data.NoopLogger
import io.teslasync.android.data.UiPhase
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Drives [ThemeProviderViewModel] over a controllable fake [ThemeProviderSource], covering the full
 * lifecycle the web provider renders: a first fetch → loading, a server-saved appearance → content +
 * hydrating the local cache (the mount `useEffect`), a document with no appearance → the empty phase, a hard
 * fetch failure → error, cached settings after a failed refresh → the offline (stale + cached) surface, the
 * `setTheme`/`setMode`/`setCustomColors` writes persisting locally + full-replacing `PUT /settings`, a retry
 * re-fetching the document, and the PII-safe `view.opened` + `themeProvider.*` diagnostics — end to end
 * through the real `toUiState` projection. The VM's feed is `WhileSubscribed`, so each case keeps an active
 * collector alive on the background scope.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class ThemeProviderViewModelTest {
    private class FakeThemeProviderSource(
        initialSettings: Resource<JsonElement> = Resource.Loading(cached = null, fetchedAt = null, stale = false),
        initialSelection: ThemeSelection = ThemeProviderRegistration.DEFAULTS,
    ) : ThemeProviderSource {
        val settingsFeed = MutableStateFlow(initialSettings)
        private val selectionState = MutableStateFlow(initialSelection)
        var settingsCalls = 0
        var saveCalls = 0
        var savedDocument: JsonElement? = null
        val persisted = mutableListOf<ThemeSelection>()

        override fun settings(): Flow<Resource<JsonElement>> {
            settingsCalls++
            return settingsFeed
        }

        override suspend fun saveSettings(document: JsonElement): Result<JsonElement> {
            saveCalls++
            savedDocument = document
            return Result.success(document)
        }

        override val localSelection: StateFlow<ThemeSelection> get() = selectionState

        override fun persistSelection(selection: ThemeSelection) {
            persisted += selection
            selectionState.value = selection
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

    @Test
    fun loadingResolvesToContentWhenSettingsArrive() =
        runTest(UnconfinedTestDispatcher()) {
            val source = FakeThemeProviderSource()
            val vm = viewModel(source)
            observe(vm)
            advanceUntilIdle()
            assertEquals(UiPhase.Loading, vm.syncState.value.phase)

            source.settingsFeed.value = themefulSuccess()
            advanceUntilIdle()
            assertEquals(UiPhase.Content, vm.syncState.value.phase)
        }

    @Test
    fun documentWithoutAppearanceMapsToEmptyPhase() =
        runTest(UnconfinedTestDispatcher()) {
            val source = FakeThemeProviderSource(success(buildJsonObject { put("distance_unit", "mi") }))
            val vm = viewModel(source)
            observe(vm)
            advanceUntilIdle()
            assertEquals(UiPhase.Empty, vm.syncState.value.phase)
        }

    @Test
    fun hardErrorWithNoCacheIsErrorPhase() =
        runTest(UnconfinedTestDispatcher()) {
            val source =
                FakeThemeProviderSource(
                    Resource.Error(cached = null, fetchedAt = null, stale = false, error = IllegalStateException("x")),
                )
            val vm = viewModel(source)
            observe(vm)
            advanceUntilIdle()
            assertEquals(UiPhase.Error, vm.syncState.value.phase)
            assertNotNull(vm.syncState.value.errorKind)
        }

    @Test
    fun errorWithCachedSettingsKeepsThemAndFlagsOffline() =
        runTest(UnconfinedTestDispatcher()) {
            val source =
                FakeThemeProviderSource(
                    Resource.Error(
                        cached = themefulDocument(),
                        fetchedAt = STAMP,
                        stale = true,
                        error = IllegalStateException("read"),
                    ),
                )
            val vm = viewModel(source)
            observe(vm)
            advanceUntilIdle()

            val state = vm.syncState.value
            assertEquals(UiPhase.Content, state.phase)
            assertTrue(state.stale)
            assertEquals(ThemeSyncFreshness.Offline, ThemeProviderProjection.freshness(state))
        }

    @Test
    fun serverSavedAppearanceHydratesTheLocalSelection() =
        runTest(UnconfinedTestDispatcher()) {
            val source =
                FakeThemeProviderSource(
                    success(
                        buildJsonObject {
                            put("theme", "tesla-red")
                            put("mode", "oled")
                        },
                    ),
                )
            val vm = viewModel(source)
            observe(vm)
            advanceUntilIdle()

            assertEquals(ThemeId.TeslaRed, vm.selection.value.themeId)
            assertEquals(ModeId.Oled, vm.selection.value.modeId)
            assertTrue(source.persisted.isNotEmpty())
        }

    @Test
    fun setThemePersistsLocallyAndSavesMergedDocument() =
        runTest(UnconfinedTestDispatcher()) {
            val source = FakeThemeProviderSource(success(buildJsonObject { put("distance_unit", "mi") }))
            val vm = viewModel(source)
            observe(vm)
            advanceUntilIdle()

            vm.setTheme(ThemeId.TeslaRed)
            advanceUntilIdle()

            assertEquals(ThemeId.TeslaRed, vm.selection.value.themeId)
            assertTrue(source.persisted.any { it.themeId == ThemeId.TeslaRed })
            assertTrue(source.saveCalls >= 1)
            val doc = source.savedDocument as JsonObject
            assertEquals("tesla-red", doc["theme"]?.jsonPrimitive?.content)
            assertEquals("mi", doc["distance_unit"]?.jsonPrimitive?.content)
        }

    @Test
    fun setModeUpdatesSelectionAndSaves() =
        runTest(UnconfinedTestDispatcher()) {
            val source = FakeThemeProviderSource(success(buildJsonObject { put("distance_unit", "mi") }))
            val vm = viewModel(source)
            observe(vm)
            advanceUntilIdle()

            vm.setMode(ModeId.Sunset)
            advanceUntilIdle()

            assertEquals(ModeId.Sunset, vm.selection.value.modeId)
            val doc = source.savedDocument as JsonObject
            assertEquals("sunset", doc["mode"]?.jsonPrimitive?.content)
        }

    @Test
    fun setCustomColorsSwitchesToCustomThemeAndSaves() =
        runTest(UnconfinedTestDispatcher()) {
            val source = FakeThemeProviderSource(success(buildJsonObject { put("distance_unit", "mi") }))
            val vm = viewModel(source)
            observe(vm)
            advanceUntilIdle()

            vm.setCustomColors("#111111", "#222222")
            advanceUntilIdle()

            assertEquals(ThemeId.Custom, vm.selection.value.themeId)
            assertEquals("#111111", vm.selection.value.customPrimary)
            val doc = source.savedDocument as JsonObject
            assertEquals("custom", doc["theme"]?.jsonPrimitive?.content)
            assertEquals("#111111", doc["custom_primary"]?.jsonPrimitive?.content)
        }

    @Test
    fun retryReFetchesTheSettingsFeed() =
        runTest(UnconfinedTestDispatcher()) {
            val source = FakeThemeProviderSource(themefulSuccess())
            val vm = viewModel(source)
            observe(vm)
            advanceUntilIdle()
            val before = source.settingsCalls

            vm.retry()
            advanceUntilIdle()
            assertTrue(source.settingsCalls > before)
        }

    @Test
    fun retryEmitsRefreshDiagnosticWithSlug() =
        runTest(UnconfinedTestDispatcher()) {
            val logger = RecordingLogger()
            val vm = viewModel(FakeThemeProviderSource(themefulSuccess()), logger)
            observe(vm)
            advanceUntilIdle()

            vm.retry()
            advanceUntilIdle()

            val refresh = logger.events.single { it.first == "themeProvider.refresh" }
            assertEquals(mapOf("surface" to "ThemeProvider"), refresh.second)
        }

    @Test
    fun setThemeEmitsDiagnosticWithSlug() =
        runTest(UnconfinedTestDispatcher()) {
            val logger = RecordingLogger()
            val vm = viewModel(FakeThemeProviderSource(themefulSuccess()), logger)
            observe(vm)
            advanceUntilIdle()

            vm.setTheme(ThemeId.MatrixGreen)
            advanceUntilIdle()

            assertTrue(logger.events.any { it.first == "themeProvider.setTheme" && it.second == SLUG_FIELD })
        }

    @Test
    fun viewOpenedEmitsSlugExactlyOnce() =
        runTest(UnconfinedTestDispatcher()) {
            val logger = RecordingLogger()
            val vm = viewModel(FakeThemeProviderSource(themefulSuccess()), logger)

            vm.onViewOpened()
            vm.onViewOpened()

            val opened = logger.events.filter { it.first == "view.opened" }
            assertEquals(1, opened.size)
            assertEquals(SLUG_FIELD, opened.single().second)
        }

    private fun TestScope.viewModel(
        source: ThemeProviderSource,
        logger: Logger = NoopLogger,
    ): ThemeProviderViewModel = ThemeProviderViewModel(source, logger, backgroundScope)

    private fun TestScope.observe(vm: ThemeProviderViewModel) {
        backgroundScope.launch { vm.syncState.collect {} }
    }

    private fun success(document: JsonObject): Resource<JsonElement> = Resource.Success(document, fetchedAt = STAMP, stale = false)

    private fun themefulSuccess(): Resource<JsonElement> = success(themefulDocument())

    private fun themefulDocument(): JsonObject =
        buildJsonObject {
            put("theme", "neon-cyan")
            put("mode", "dark")
        }

    private companion object {
        const val STAMP = 1_700_000_000_000L
        val SLUG_FIELD = mapOf("surface" to "ThemeProvider")
    }
}
