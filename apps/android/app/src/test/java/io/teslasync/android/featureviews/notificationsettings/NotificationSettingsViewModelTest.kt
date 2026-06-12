package io.teslasync.android.featureviews.notificationsettings

import io.teslasync.android.data.NoopLogger
import io.teslasync.android.data.UiPhase
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.Logger
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
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Drives [NotificationSettingsViewModel] over a controllable fake [NotificationSettingsSource], covering the
 * cache-then-network `/settings` tab-signals matrix (loading / content / hard error + retry recovery /
 * stale-offline), the full-document merge save (web `{ ...settings, [key]: value }`, the "skip before load"
 * guard), the device-local sound + web-push preference mutations + persistence, the Test-button force-play
 * delegation, and the PII-safe `view.opened` diagnostic. Mirrors the web hook behaviour
 * (web/src/features/settings/components/NotificationSettings.tsx).
 */
@OptIn(ExperimentalCoroutinesApi::class)
class NotificationSettingsViewModelTest {
    private val loadedDocument: JsonObject =
        buildJsonObject {
            put(FIELD_TAB_BADGE_ENABLED, true)
            put(FIELD_CRITICAL_FLASH_ENABLED, true)
            put("other_setting", "keep-me")
        }

    @Test
    fun tabSignalsLoadingWhenNoCache() =
        runTest(UnconfinedTestDispatcher()) {
            val vm = viewModel(FakeSource(listOf(Resource.Loading(null, null, false))))
            backgroundScope.launch { vm.tabSignals.collect {} }
            advanceUntilIdle()
            assertEquals(UiPhase.Loading, vm.tabSignals.value.phase)
        }

    @Test
    fun tabSignalsContentWhenLoaded() =
        runTest(UnconfinedTestDispatcher()) {
            val src = FakeSource(listOf(Resource.Loading(null, null, false), Resource.Success(loadedDocument, 100L, false)))
            val vm = viewModel(src)
            backgroundScope.launch { vm.tabSignals.collect {} }
            advanceUntilIdle()

            val state = vm.tabSignals.value
            assertEquals(UiPhase.Content, state.phase)
            assertEquals(TabSignals(badgeEnabled = true, criticalFlashEnabled = true), state.data)
            assertEquals(100L, state.fetchedAt)
        }

    @Test
    fun tabSignalsErrorWithNoCacheRecoversOnRetry() =
        runTest(UnconfinedTestDispatcher()) {
            val src = FakeSource(listOf(Resource.Error(null, null, false, RuntimeException("offline"))))
            val vm = viewModel(src)
            backgroundScope.launch { vm.tabSignals.collect {} }
            advanceUntilIdle()
            assertEquals(UiPhase.Error, vm.tabSignals.value.phase)
            assertTrue(vm.tabSignals.value.canRetry)

            src.documentEmissions = listOf(Resource.Success(loadedDocument, 200L, false))
            vm.retry()
            advanceUntilIdle()
            assertEquals(UiPhase.Content, vm.tabSignals.value.phase)
        }

    @Test
    fun tabSignalsOfflineKeepsLastKnownStale() =
        runTest(UnconfinedTestDispatcher()) {
            val src = FakeSource(listOf(Resource.Error(loadedDocument, 100L, true, RuntimeException("offline"))))
            val vm = viewModel(src)
            backgroundScope.launch { vm.tabSignals.collect {} }
            advanceUntilIdle()

            val state = vm.tabSignals.value
            assertEquals(UiPhase.Content, state.phase)
            assertTrue(state.stale)
            assertTrue(state.isOffline)
            assertTrue(state.canRetry)
        }

    @Test
    fun setTabBadgeMergesIntoFullDocumentPreservingOtherFields() =
        runTest(UnconfinedTestDispatcher()) {
            val src = FakeSource(listOf(Resource.Success(loadedDocument, 100L, false)))
            val vm = viewModel(src)
            backgroundScope.launch { vm.tabSignals.collect {} }
            advanceUntilIdle()

            vm.setTabBadge(false)
            advanceUntilIdle()

            val saved = src.savedDocuments.last() as JsonObject
            assertEquals(false, saved[FIELD_TAB_BADGE_ENABLED]?.jsonPrimitive?.booleanOrNull)
            assertEquals(true, saved[FIELD_CRITICAL_FLASH_ENABLED]?.jsonPrimitive?.booleanOrNull)
            assertEquals("keep-me", saved["other_setting"]?.jsonPrimitive?.content)
        }

    @Test
    fun setTabBadgeSkippedBeforeDocumentLoads() =
        runTest(UnconfinedTestDispatcher()) {
            val src = FakeSource(listOf(Resource.Loading(null, null, false)))
            val vm = viewModel(src)
            backgroundScope.launch { vm.tabSignals.collect {} }
            advanceUntilIdle()

            vm.setTabBadge(false)
            advanceUntilIdle()
            // Web `if (!settings) return` — nothing is saved before the document has loaded.
            assertTrue(src.savedDocuments.isEmpty())
        }

    @Test
    fun onAppearLoadsDeviceLocalPreferences() =
        runTest(UnconfinedTestDispatcher()) {
            val src =
                FakeSource(listOf(Resource.Loading(null, null, false))).apply {
                    soundPrefs = NotificationSoundPrefs.DEFAULT.copy(master = true, volume = 0.4f)
                    webPushPrefs = WebPushPrefs(alerts = false, exportStatus = true)
                }
            val vm = viewModel(src)
            vm.onAppear()
            advanceUntilIdle()

            assertTrue(vm.soundPrefs.value.master)
            assertEquals(0.4f, vm.soundPrefs.value.volume, FLOAT_DELTA)
            assertFalse(vm.webPushPrefs.value.alerts)
        }

    @Test
    fun setSoundMasterPersistsAndUpdates() =
        runTest(UnconfinedTestDispatcher()) {
            val src = FakeSource(listOf(Resource.Loading(null, null, false)))
            val vm = viewModel(src)
            vm.onAppear()
            advanceUntilIdle()

            vm.setSoundMaster(true)
            advanceUntilIdle()
            assertTrue(vm.soundPrefs.value.master)
            assertTrue(src.savedSound.last().master)
        }

    @Test
    fun setSoundCategoryShallowMergesOneChannel() =
        runTest(UnconfinedTestDispatcher()) {
            val src = FakeSource(listOf(Resource.Loading(null, null, false)))
            val vm = viewModel(src)
            vm.onAppear()
            advanceUntilIdle()

            vm.setSoundCategory(NotificationSoundCategory.InfoAlert, true)
            advanceUntilIdle()
            assertTrue(vm.soundPrefs.value.isCategoryEnabled(NotificationSoundCategory.InfoAlert))
            // The other channels keep their default gates.
            assertTrue(vm.soundPrefs.value.isCategoryEnabled(NotificationSoundCategory.CriticalAlert))
        }

    @Test
    fun setVolumePercentConvertsToFraction() =
        runTest(UnconfinedTestDispatcher()) {
            val src = FakeSource(listOf(Resource.Loading(null, null, false)))
            val vm = viewModel(src)
            vm.onAppear()
            advanceUntilIdle()

            vm.setVolumePercent(80)
            advanceUntilIdle()
            assertEquals(0.8f, vm.soundPrefs.value.volume, FLOAT_DELTA)
        }

    @Test
    fun setAlertsAndExportStatusPersist() =
        runTest(UnconfinedTestDispatcher()) {
            val src = FakeSource(listOf(Resource.Loading(null, null, false)))
            val vm = viewModel(src)
            vm.onAppear()
            advanceUntilIdle()

            vm.setAlerts(false)
            vm.setExportStatus(false)
            advanceUntilIdle()
            assertFalse(vm.webPushPrefs.value.alerts)
            assertFalse(vm.webPushPrefs.value.exportStatus)
            assertFalse(src.savedWebPush.last().exportStatus)
        }

    @Test
    fun testSoundUsesTheForcePlayOverride() =
        runTest(UnconfinedTestDispatcher()) {
            val src = FakeSource(listOf(Resource.Loading(null, null, false)))
            val vm = viewModel(src)

            val result = vm.testSound(NotificationSoundCategory.InfoAlert)
            assertEquals(SoundPlayResult.Played, result)
            val (playedPrefs, playedCategory) = src.played.last()
            // The override forces master + the channel on even though the saved prefs default them off.
            assertTrue(playedPrefs.master)
            assertTrue(playedPrefs.isCategoryEnabled(NotificationSoundCategory.InfoAlert))
            assertEquals(NotificationSoundCategory.InfoAlert, playedCategory)
        }

    @Test
    fun viewOpenedRecordedExactlyOnce() =
        runTest(UnconfinedTestDispatcher()) {
            val logger = RecordingLogger()
            val vm = viewModel(FakeSource(listOf(Resource.Loading(null, null, false))), logger)

            vm.onAppear()
            advanceUntilIdle()
            vm.onAppear()
            advanceUntilIdle()

            val opened = logger.events.filter { it.first == "view.opened" }
            assertEquals(1, opened.size)
            assertEquals(mapOf("surface" to "NotificationSettings"), opened.single().second)
        }

    // ── fakes / helpers ─────────────────────────────────────────────────────────────

    private fun TestScope.viewModel(
        source: NotificationSettingsSource,
        logger: Logger = NoopLogger,
    ): NotificationSettingsViewModel = NotificationSettingsViewModel(source, logger, backgroundScope)

    private class FakeSource(
        var documentEmissions: List<Resource<JsonElement>>,
    ) : NotificationSettingsSource {
        var soundPrefs: NotificationSoundPrefs = NotificationSoundPrefs.DEFAULT
        var webPushPrefs: WebPushPrefs = WebPushPrefs.DEFAULT
        var saveResult: Result<Unit> = Result.success(Unit)
        var playResult: SoundPlayResult = SoundPlayResult.Played
        val savedDocuments = mutableListOf<JsonElement>()
        val savedSound = mutableListOf<NotificationSoundPrefs>()
        val savedWebPush = mutableListOf<WebPushPrefs>()
        val played = mutableListOf<Pair<NotificationSoundPrefs, NotificationSoundCategory>>()

        override fun settingsDocument(): Flow<Resource<JsonElement>> = flow { documentEmissions.forEach { emit(it) } }

        override suspend fun saveSettingsDocument(document: JsonElement): Result<Unit> {
            savedDocuments += document
            return saveResult
        }

        override suspend fun loadWebPushPrefs(): WebPushPrefs = webPushPrefs

        override suspend fun saveWebPushPrefs(prefs: WebPushPrefs) {
            savedWebPush += prefs
            webPushPrefs = prefs
        }

        override suspend fun loadSoundPrefs(): NotificationSoundPrefs = soundPrefs

        override suspend fun saveSoundPrefs(prefs: NotificationSoundPrefs) {
            savedSound += prefs
            soundPrefs = prefs
        }

        override fun playSound(
            prefs: NotificationSoundPrefs,
            category: NotificationSoundCategory,
        ): SoundPlayResult {
            played += prefs to category
            return playResult
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

    private companion object {
        const val FLOAT_DELTA = 1e-4f
    }
}
