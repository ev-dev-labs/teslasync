package io.teslasync.android.featureviews.appearancesettings

import io.teslasync.android.data.UiPhase
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.LogRecord
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.net.ApiError
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Drives [AppearanceSettingsViewModel] over a fake [AppearanceSettingsSource] backed by an
 * [InMemoryAppearanceLocalStore] — covering every state the server-backed pickers render (loading / content /
 * empty / hard error / offline-cached), the partial-merge save + post-save refresh, the device-local pref
 * mutations + status-bar / tours-reset toasts, the tour-replay diagnostic, the refresh/retry re-fetch, and the
 * one-shot `view.opened` diagnostic. Run by the offline `:android:testReleaseUnitTest` gate.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class AppearanceSettingsViewModelTest {
    // ── server-prefs state matrix ─────────────────────────────────────────────────
    @Test
    fun loadsContentFromSettingsDocument() =
        runTest(UnconfinedTestDispatcher()) {
            val source = FakeSource(listOf(success(densityDoc("spacious"))))
            val vm = AppearanceSettingsViewModel(source, RecordingLogger(), backgroundScope)
            backgroundScope.launch { vm.serverPrefs.collect {} }
            advanceUntilIdle()

            val ui = vm.serverPrefs.value
            assertEquals(UiPhase.Content, ui.phase)
            val prefs = ui.data!!
            assertEquals(DensityId.Spacious, prefs.density)
            assertTrue(prefs.present)
        }

    @Test
    fun emptyDocumentIsEmptyPhaseShowingDefaults() =
        runTest(UnconfinedTestDispatcher()) {
            val source = FakeSource(listOf(success(buildJsonObject {})))
            val vm = AppearanceSettingsViewModel(source, RecordingLogger(), backgroundScope)
            backgroundScope.launch { vm.serverPrefs.collect {} }
            advanceUntilIdle()

            val ui = vm.serverPrefs.value
            assertEquals(UiPhase.Empty, ui.phase)
            assertEquals(DensityId.Comfortable, ui.data!!.density)
        }

    @Test
    fun loadingWithNoCacheIsLoadingPhase() =
        runTest(UnconfinedTestDispatcher()) {
            val source = FakeSource(listOf(Resource.Loading(cached = null, fetchedAt = null, stale = false)))
            val vm = AppearanceSettingsViewModel(source, RecordingLogger(), backgroundScope)
            backgroundScope.launch { vm.serverPrefs.collect {} }
            advanceUntilIdle()

            assertEquals(UiPhase.Loading, vm.serverPrefs.value.phase)
        }

    @Test
    fun hardErrorWithNoCacheIsErrorPhase() =
        runTest(UnconfinedTestDispatcher()) {
            val source =
                FakeSource(listOf(Resource.Error(cached = null, fetchedAt = null, stale = false, error = ApiError.Network())))
            val vm = AppearanceSettingsViewModel(source, RecordingLogger(), backgroundScope)
            backgroundScope.launch { vm.serverPrefs.collect {} }
            advanceUntilIdle()

            val ui = vm.serverPrefs.value
            assertEquals(UiPhase.Error, ui.phase)
            assertTrue(ui.hasError)
            assertFalse(ui.hasData)
        }

    @Test
    fun offlineKeepsCachedDocumentWithStaleAndRetry() =
        runTest(UnconfinedTestDispatcher()) {
            val source =
                FakeSource(
                    listOf(
                        Resource.Error(cached = densityDoc("compact"), fetchedAt = 100L, stale = true, error = ApiError.Network()),
                    ),
                )
            val vm = AppearanceSettingsViewModel(source, RecordingLogger(), backgroundScope)
            backgroundScope.launch { vm.serverPrefs.collect {} }
            advanceUntilIdle()

            val ui = vm.serverPrefs.value
            assertEquals(UiPhase.Content, ui.phase)
            assertEquals(DensityId.Compact, ui.data!!.density)
            assertTrue(ui.stale)
            assertTrue(ui.isOffline)
            assertTrue(ui.canRetry)
        }

    // ── partial-merge saves ───────────────────────────────────────────────────────
    @Test
    fun setDensitySavesMergedDocumentAndRefreshes() =
        runTest(UnconfinedTestDispatcher()) {
            val source = FakeSource(listOf(success(densityDoc("comfortable"))))
            val vm = AppearanceSettingsViewModel(source, RecordingLogger(), backgroundScope)
            backgroundScope.launch { vm.serverPrefs.collect {} }
            advanceUntilIdle()
            val callsBefore = source.settingsCalls

            vm.setDensity(DensityId.Spacious)
            advanceUntilIdle()

            assertEquals(1, source.savedDocuments.size)
            assertEquals("spacious", (source.savedDocuments.first() as JsonObject)["ui_density"]?.jsonPrimitive?.content)
            assertTrue(source.settingsCalls > callsBefore)
        }

    @Test
    fun setDensityIsNoOpWhenUnchanged() =
        runTest(UnconfinedTestDispatcher()) {
            val source = FakeSource(listOf(success(densityDoc("comfortable"))))
            val vm = AppearanceSettingsViewModel(source, RecordingLogger(), backgroundScope)
            backgroundScope.launch { vm.serverPrefs.collect {} }
            advanceUntilIdle()

            vm.setDensity(DensityId.Comfortable)
            advanceUntilIdle()

            assertTrue(source.savedDocuments.isEmpty())
        }

    @Test
    fun setDensityIsNoOpWhenSettingsNotLoaded() =
        runTest(UnconfinedTestDispatcher()) {
            val source = FakeSource(listOf(Resource.Loading(cached = null, fetchedAt = null, stale = false)))
            val vm = AppearanceSettingsViewModel(source, RecordingLogger(), backgroundScope)
            backgroundScope.launch { vm.serverPrefs.collect {} }
            advanceUntilIdle()

            vm.setDensity(DensityId.Spacious)
            advanceUntilIdle()

            assertTrue(source.savedDocuments.isEmpty())
        }

    @Test
    fun setTimeFormatAndChartPaletteMergeTheirOwnKey() =
        runTest(UnconfinedTestDispatcher()) {
            val source = FakeSource(listOf(success(densityDoc("comfortable"))))
            val vm = AppearanceSettingsViewModel(source, RecordingLogger(), backgroundScope)
            backgroundScope.launch { vm.serverPrefs.collect {} }
            advanceUntilIdle()

            vm.setTimeFormat(TimeFormatId.Absolute)
            vm.setChartPalette(ChartPaletteId.Neon)
            advanceUntilIdle()

            val docs = source.savedDocuments.map { it as JsonObject }
            assertTrue(docs.any { it["time_format_default"]?.jsonPrimitive?.content == "absolute" })
            assertTrue(docs.any { it["chart_palette"]?.jsonPrimitive?.content == "neon" })
        }

    // ── device-local mutations + toasts ───────────────────────────────────────────
    @Test
    fun setStatusBarEnabledPersistsAndEmitsInfoToast() =
        runTest(UnconfinedTestDispatcher()) {
            val source = FakeSource(emptyList())
            val vm = AppearanceSettingsViewModel(source, RecordingLogger(), backgroundScope)
            val toasts = mutableListOf<AppearanceToast>()
            backgroundScope.launch { vm.toasts.collect { toasts += it } }
            advanceUntilIdle()

            vm.setStatusBarEnabled(false)
            advanceUntilIdle()

            assertFalse(source.statusBar.value.enabled)
            assertEquals(listOf(AppearanceToast.StatusBarHidden), toasts)
        }

    @Test
    fun setStatusBarIconOnlyPersistsWithoutToast() =
        runTest(UnconfinedTestDispatcher()) {
            val source = FakeSource(emptyList())
            val vm = AppearanceSettingsViewModel(source, RecordingLogger(), backgroundScope)
            val toasts = mutableListOf<AppearanceToast>()
            backgroundScope.launch { vm.toasts.collect { toasts += it } }
            advanceUntilIdle()

            vm.setStatusBarIconOnly(true)
            advanceUntilIdle()

            assertTrue(source.statusBar.value.iconOnly)
            assertTrue(toasts.isEmpty())
        }

    @Test
    fun celebrationSettersPersistEachFlag() =
        runTest(UnconfinedTestDispatcher()) {
            val source = FakeSource(emptyList())
            val vm = AppearanceSettingsViewModel(source, RecordingLogger(), backgroundScope)

            vm.setCelebrationShowToasts(false)
            vm.setCelebrationPlaySound(true)
            vm.setCelebrationShowOnDashboard(false)
            vm.setCelebrationPushOnUnlock(false)
            advanceUntilIdle()

            val prefs = source.celebration.value
            assertFalse(prefs.showToasts)
            assertTrue(prefs.playSound)
            assertFalse(prefs.showOnDashboard)
            assertFalse(prefs.pushOnUnlock)
        }

    @Test
    fun setSidebarStylePersists() =
        runTest(UnconfinedTestDispatcher()) {
            val source = FakeSource(emptyList())
            val vm = AppearanceSettingsViewModel(source, RecordingLogger(), backgroundScope)

            vm.setSidebarStyle(SidebarStyle.Legacy)
            advanceUntilIdle()

            assertEquals(SidebarStyle.Legacy, source.sidebarStyle.value)
        }

    @Test
    fun resetAllToursClearsStoreAndEmitsSuccessToast() =
        runTest(UnconfinedTestDispatcher()) {
            val source = FakeSource(emptyList())
            val vm = AppearanceSettingsViewModel(source, RecordingLogger(), backgroundScope)
            val toasts = mutableListOf<AppearanceToast>()
            backgroundScope.launch { vm.toasts.collect { toasts += it } }
            advanceUntilIdle()

            vm.resetAllTours()
            advanceUntilIdle()

            assertTrue(
                source.local.completedTours.value
                    .isEmpty(),
            )
            assertEquals(listOf(AppearanceToast.ToursReset), toasts)
        }

    @Test
    fun replayTourUpdatesStoreAndLogsDiagnostic() =
        runTest(UnconfinedTestDispatcher()) {
            val logger = RecordingLogger()
            val source = FakeSource(emptyList())
            val vm = AppearanceSettingsViewModel(source, logger, backgroundScope)

            vm.replayTour(ProductTour.Main)
            advanceUntilIdle()

            assertFalse(
                source.local.completedTours.value
                    .contains(ProductTour.Main),
            )
            val replay = logger.records.single { it.event == "appearanceSettings.tourReplay" }
            assertEquals("main", replay.fields["tour"])
        }

    // ── refresh / telemetry ───────────────────────────────────────────────────────
    @Test
    fun refreshReCollectsSettingsAndLogs() =
        runTest(UnconfinedTestDispatcher()) {
            val logger = RecordingLogger()
            val source = FakeSource(listOf(success(densityDoc("comfortable"))))
            val vm = AppearanceSettingsViewModel(source, logger, backgroundScope)
            backgroundScope.launch { vm.serverPrefs.collect {} }
            advanceUntilIdle()
            val before = source.settingsCalls

            vm.refresh()
            advanceUntilIdle()

            assertTrue(source.settingsCalls > before)
            assertTrue(logger.records.any { it.event == "appearanceSettings.refresh" })
        }

    @Test
    fun viewOpenedEmitsDiagnosticsOnceWithSurfaceSlug() =
        runTest(UnconfinedTestDispatcher()) {
            val logger = RecordingLogger()
            val vm = AppearanceSettingsViewModel(FakeSource(emptyList()), logger, backgroundScope)

            vm.onViewOpened()
            vm.onViewOpened()

            val opened = logger.records.filter { it.event == "view.opened" }
            assertEquals(1, opened.size)
            assertEquals("AppearanceSettings", opened.first().fields["surface"])
        }

    // ── fakes / helpers ───────────────────────────────────────────────────────────
    private class FakeSource(
        private val settingsEmissions: List<Resource<JsonElement>>,
        private val saveResult: Result<JsonElement> = Result.success(buildJsonObject {}),
        val local: InMemoryAppearanceLocalStore = InMemoryAppearanceLocalStore(),
    ) : AppearanceSettingsSource {
        var settingsCalls = 0
            private set

        val savedDocuments = mutableListOf<JsonElement>()

        override fun settings(): Flow<Resource<JsonElement>> {
            settingsCalls++
            return settingsEmissions.asFlow()
        }

        override suspend fun saveSettings(document: JsonElement): Result<JsonElement> {
            savedDocuments += document
            return saveResult
        }

        override val statusBar: StateFlow<StatusBarPrefs> get() = local.statusBar
        override val celebration: StateFlow<CelebrationPrefs> get() = local.celebration
        override val sidebarStyle: StateFlow<SidebarStyle> get() = local.sidebarStyle

        override fun setStatusBar(prefs: StatusBarPrefs) = local.setStatusBar(prefs)

        override fun setCelebration(prefs: CelebrationPrefs) = local.setCelebration(prefs)

        override fun setSidebarStyle(style: SidebarStyle) = local.setSidebarStyle(style)

        override fun replayTour(tour: ProductTour) = local.replayTour(tour)

        override fun resetAllTours() = local.resetAllTours()
    }

    private class RecordingLogger : Logger {
        val records = mutableListOf<LogRecord>()

        override fun log(
            level: LogLevel,
            event: String,
            fields: Map<String, String>,
        ) {
            records.add(LogRecord(level, event, fields))
        }
    }

    private companion object {
        fun success(doc: JsonObject): Resource<JsonElement> = Resource.Success(doc, fetchedAt = 1L, stale = false)

        fun densityDoc(value: String): JsonObject = buildJsonObject { put("ui_density", value) }
    }
}
