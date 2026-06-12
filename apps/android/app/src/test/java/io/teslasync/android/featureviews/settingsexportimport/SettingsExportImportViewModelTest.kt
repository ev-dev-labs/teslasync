package io.teslasync.android.featureviews.settingsexportimport

import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.net.ApiError
import io.teslasync.shared.core.presentation.settingsbackup.SettingsBundle
import io.teslasync.shared.core.presentation.settingsbackup.SettingsBundleSections
import io.teslasync.shared.core.presentation.settingsbackup.SettingsImportResult
import io.teslasync.shared.core.presentation.settingsbackup.SettingsImportSectionResult
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.IOException

/**
 * Drives [SettingsExportImportViewModel] over a controllable fake [SettingsExportImportViewSource] +
 * [SettingsBundleSaver] + [PickedFile], covering the whole surface: the export flow (fetch → encode → write →
 * success/failure effect + the in-flight flag), the import stage machine (too-large / read-failure / invalid-JSON
 * intake errors, the dry-run preview, the preview-failure reset), apply (applied diff + counts effect + keep
 * preview on failure), reset, and the PII-safe `view.opened` diagnostic. Mirrors the web component's hook
 * behaviour (web/src/features/settings/components/SettingsExportImport.tsx). Run by `:android:testReleaseUnitTest`.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class SettingsExportImportViewModelTest {
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
        var exportResult: Result<SettingsBundle> = Result.success(sampleBundle()),
        var dryRunResult: Result<SettingsImportResult> = Result.success(sampleResult()),
        var applyResult: Result<SettingsImportResult> = Result.success(sampleResult()),
    ) : SettingsExportImportViewSource {
        val dryRunBundles = mutableListOf<SettingsBundle>()
        val applyBundles = mutableListOf<SettingsBundle>()

        override suspend fun exportSettings(): Result<SettingsBundle> = exportResult

        override suspend fun dryRunImport(bundle: SettingsBundle): Result<SettingsImportResult> {
            dryRunBundles += bundle
            return dryRunResult
        }

        override suspend fun applyImport(bundle: SettingsBundle): Result<SettingsImportResult> {
            applyBundles += bundle
            return applyResult
        }

        override fun defaultExportFilename(): String = EXPORT_FILENAME
    }

    private class FakeSaver(
        var result: Result<Unit> = Result.success(Unit),
    ) : SettingsBundleSaver {
        val saved = mutableListOf<Pair<String, String>>()

        override suspend fun save(
            filename: String,
            json: String,
        ): Result<Unit> {
            saved += filename to json
            return result
        }
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
            assertEquals(mapOf("surface" to "SettingsExportImport"), opened.single().second)
        }

    @Test
    fun exportSuccessWritesBundleToDownloadsAndRaisesEffect() =
        runTest(UnconfinedTestDispatcher()) {
            val source = FakeSource()
            val saver = FakeSaver()
            val vm = viewModel(source)
            val effects = collectEffects(vm)

            vm.export(saver)
            advanceUntilIdle()

            val saved = saver.saved.single()
            assertEquals(EXPORT_FILENAME, saved.first)
            assertTrue("encoded bundle JSON is written", saved.second.contains("schema_version"))
            assertEquals(listOf(SettingsExportImportEffect.ExportSucceeded), effects)
            assertFalse(vm.uiState.value.exporting)
        }

    @Test
    fun exportFailureRaisesExportFailedAndSkipsWrite() =
        runTest(UnconfinedTestDispatcher()) {
            val source = FakeSource(exportResult = Result.failure(ApiError.Network()))
            val saver = FakeSaver()
            val vm = viewModel(source)
            val effects = collectEffects(vm)

            vm.export(saver)
            advanceUntilIdle()

            assertTrue("a failed export never writes a file", saver.saved.isEmpty())
            assertEquals(listOf(SettingsExportImportEffect.ExportFailed), effects)
            assertFalse(vm.uiState.value.exporting)
        }

    @Test
    fun exportWriteFailureRaisesExportFailed() =
        runTest(UnconfinedTestDispatcher()) {
            val vm = viewModel(FakeSource())
            val effects = collectEffects(vm)

            vm.export(FakeSaver(result = Result.failure(IOException())))
            advanceUntilIdle()

            assertEquals(listOf(SettingsExportImportEffect.ExportFailed), effects)
        }

    @Test
    fun ingestTooLargeShowsTooLargeError() =
        runTest(UnconfinedTestDispatcher()) {
            val vm = viewModel(FakeSource())

            vm.ingest(PickedFile("big.json", MAX_IMPORT_FILE_BYTES + 1) { VALID_BUNDLE_JSON })
            advanceUntilIdle()

            assertEquals(ImportError.TooLarge, vm.uiState.value.error)
            assertEquals(ImportStage.Idle, vm.uiState.value.stage)
        }

    @Test
    fun ingestReadFailureShowsReadError() =
        runTest(UnconfinedTestDispatcher()) {
            val vm = viewModel(FakeSource())

            vm.ingest(PickedFile("x.json", 32L) { throw IOException() })
            advanceUntilIdle()

            assertEquals(ImportError.Read, vm.uiState.value.error)
            assertEquals(ImportStage.Idle, vm.uiState.value.stage)
        }

    @Test
    fun ingestInvalidJsonShowsInvalidJsonError() =
        runTest(UnconfinedTestDispatcher()) {
            val vm = viewModel(FakeSource())

            vm.ingest(PickedFile("x.json", 8L) { "not json {" })
            advanceUntilIdle()

            assertTrue(vm.uiState.value.error is ImportError.InvalidJson)
            assertEquals(ImportStage.Idle, vm.uiState.value.stage)
        }

    @Test
    fun ingestValidBundleRunsDryRunAndShowsPreview() =
        runTest(UnconfinedTestDispatcher()) {
            val source = FakeSource()
            val vm = viewModel(source)

            vm.ingest(PickedFile("bundle.json", 96L) { VALID_BUNDLE_JSON })
            advanceUntilIdle()

            val state = vm.uiState.value
            assertEquals(ImportStage.Preview, state.stage)
            assertEquals("bundle.json", state.pending?.filename)
            assertEquals(source.dryRunResult.getOrNull(), state.preview)
            assertNull(state.error)
            assertEquals(1, source.dryRunBundles.size)
        }

    @Test
    fun ingestPreviewFailureShowsPreviewErrorAndResetsStage() =
        runTest(UnconfinedTestDispatcher()) {
            val source = FakeSource(dryRunResult = Result.failure(ApiError.Timeout()))
            val vm = viewModel(source)

            vm.ingest(PickedFile("bundle.json", 96L) { VALID_BUNDLE_JSON })
            advanceUntilIdle()

            val state = vm.uiState.value
            assertEquals(ImportError.PreviewFailed, state.error)
            assertEquals(ImportStage.Idle, state.stage)
            assertNull(state.pending)
        }

    @Test
    fun applyImportSuccessShowsAppliedAndRaisesCountsEffect() =
        runTest(UnconfinedTestDispatcher()) {
            val source = FakeSource(applyResult = Result.success(sampleResult(added = 4, updated = 2, skipped = 7)))
            val vm = viewModel(source)
            val effects = collectEffects(vm)
            vm.ingest(PickedFile("bundle.json", 96L) { VALID_BUNDLE_JSON })
            advanceUntilIdle()

            vm.applyImport()
            advanceUntilIdle()

            val state = vm.uiState.value
            assertEquals(ImportStage.Applied, state.stage)
            assertEquals(source.applyResult.getOrNull(), state.applied)
            assertNull(state.preview)
            assertFalse(state.applying)
            assertEquals(listOf(SettingsExportImportEffect.ImportApplied(4, 2, 7)), effects)
            assertEquals(1, source.applyBundles.size)
        }

    @Test
    fun applyImportFailureKeepsPreviewAndRaisesFailure() =
        runTest(UnconfinedTestDispatcher()) {
            val source = FakeSource(applyResult = Result.failure(ApiError.Network()))
            val vm = viewModel(source)
            val effects = collectEffects(vm)
            vm.ingest(PickedFile("bundle.json", 96L) { VALID_BUNDLE_JSON })
            advanceUntilIdle()

            vm.applyImport()
            advanceUntilIdle()

            val state = vm.uiState.value
            assertEquals("preview stays visible so the user can retry", ImportStage.Preview, state.stage)
            assertEquals(source.dryRunResult.getOrNull(), state.preview)
            assertFalse(state.applying)
            assertEquals(listOf(SettingsExportImportEffect.ImportApplyFailed), effects)
        }

    @Test
    fun resetReturnsImportFlowToIdle() =
        runTest(UnconfinedTestDispatcher()) {
            val vm = viewModel(FakeSource())
            vm.ingest(PickedFile("bundle.json", 96L) { VALID_BUNDLE_JSON })
            advanceUntilIdle()

            vm.reset()

            val state = vm.uiState.value
            assertEquals(ImportStage.Idle, state.stage)
            assertNull(state.pending)
            assertNull(state.preview)
            assertNull(state.error)
        }

    @Test
    fun applyWithoutPendingBundleIsNoOp() =
        runTest(UnconfinedTestDispatcher()) {
            val source = FakeSource()
            val vm = viewModel(source)
            val effects = collectEffects(vm)

            vm.applyImport()
            advanceUntilIdle()

            assertTrue(source.applyBundles.isEmpty())
            assertTrue(effects.isEmpty())
            assertEquals(ImportStage.Idle, vm.uiState.value.stage)
        }

    private fun TestScope.collectEffects(vm: SettingsExportImportViewModel): List<SettingsExportImportEffect> {
        val effects = mutableListOf<SettingsExportImportEffect>()
        backgroundScope.launch { vm.effects.collect { effects += it } }
        return effects
    }

    private fun TestScope.viewModel(
        source: SettingsExportImportViewSource,
        logger: Logger = RecordingLogger(),
    ): SettingsExportImportViewModel = SettingsExportImportViewModel(source, logger, backgroundScope)

    private companion object {
        const val EXPORT_FILENAME = "teslasync-settings-20260612.json"

        fun sampleBundle(): SettingsBundle =
            SettingsBundle(schemaVersion = 1, exportedAt = "2026-06-12T00:00:00Z", sections = SettingsBundleSections())

        fun sampleResult(
            added: Int = 2,
            updated: Int = 1,
            skipped: Int = 3,
        ): SettingsImportResult =
            SettingsImportResult(
                dryRun = true,
                sections = mapOf("alert_rules" to SettingsImportSectionResult(added, updated, skipped)),
            )

        const val VALID_BUNDLE_JSON =
            """{"schema_version":1,"exported_at":"2026-06-12T00:00:00Z","sections":{"alert_rules":[{"id":1}]}}"""
    }
}
