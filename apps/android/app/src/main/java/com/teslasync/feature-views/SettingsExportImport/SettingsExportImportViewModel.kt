// UI-thread-free state holder backing the SettingsExportImport feature view — the native port of the
// settings-backup hook composition the web component owns (web/src/features/settings/components/
// SettingsExportImport.tsx). It binds the shared mutation seam [SettingsExportImportViewSource] (P1/S8), owns
// the import stage machine (idle → parsing → preview → applied), runs the export / dry-run / apply mutations
// tracking their in-flight flags, surfaces typed intake failures + one-shot toast effects, and emits the
// PII-safe `view.opened` diagnostic. The view never performs HTTP or file IO — it only collects state and
// invokes these methods with the platform-provided [PickedFile] / [SettingsBundleSaver].
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/feature-views/SettingsExportImport) cannot form a valid Kotlin package.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.featureviews.settingsexportimport

import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import io.teslasync.android.data.BaseFeedViewModel
import io.teslasync.shared.core.cache.Clock
import io.teslasync.shared.core.data.repo.SettingsBackupRepository
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.presentation.settingsbackup.SettingsBackupStore
import io.teslasync.shared.core.presentation.settingsbackup.SettingsBundle
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.receiveAsFlow
import kotlinx.coroutines.flow.update

/**
 * Lifecycle-aware state holder backing the Compose [SettingsExportImport] surface. It consumes the mutation-only
 * [SettingsExportImportViewSource] (P1/S8) and exposes the immutable [SettingsExportImportUiState] the screen
 * renders, so the screen stays a stateless Composable that only renders. Because the web domain has no `useQuery`
 * read, there is no cache-then-network feed here; instead the holder is a small state machine over the export
 * and import flows, exactly mirroring the web component's local state.
 *
 * It owns no networking or file IO. [export] serializes the fetched bundle and writes it through the
 * host-provided [SettingsBundleSaver]; [ingest] runs the size-guard → read → local-validate → dry-run pipeline
 * over a host-provided [PickedFile]; [applyImport] commits the previewed bundle; [reset] returns the import flow
 * to idle. One-shot toast outcomes are raised on [effects]; [recordViewOpened] emits the `view.opened`
 * diagnostic (P1/S11).
 *
 * @param source the settings-backup mutation seam (a shared-layer adapter in production, a fake in tests).
 * @param logger the single sanctioned redacting logger (ADR-016); receives `view.opened` + mutation events.
 * @param scope test seam; production passes nothing and uses `viewModelScope`.
 */
class SettingsExportImportViewModel(
    private val source: SettingsExportImportViewSource,
    logger: Logger,
    scope: CoroutineScope? = null,
) : BaseFeedViewModel(logger, scope) {
    private val mutableState = MutableStateFlow(SettingsExportImportUiState())
    private val effectChannel = Channel<SettingsExportImportEffect>(Channel.BUFFERED)

    private var pendingBundle: SettingsBundle? = null
    private var viewOpenedRecorded = false

    /** The immutable surface state: export in-flight, import stage, pending file, intake error, diffs, apply flag. */
    val uiState: StateFlow<SettingsExportImportUiState> = mutableState.asStateFlow()

    /** One-shot toast outcomes (export success/failure, apply success/failure). Collected once by the screen. */
    val effects: Flow<SettingsExportImportEffect> = effectChannel.receiveAsFlow()

    /**
     * Fetches the bundle and writes it to downloads through [saver] (web `handleExport`): on success raises
     * [SettingsExportImportEffect.ExportSucceeded]; an export OR a download-write failure raises
     * [SettingsExportImportEffect.ExportFailed] (never a false confirmation). The in-flight flag backs the
     * button's disabled + "Exporting…" state (web `exportMut.isPending`); a second tap while busy is ignored.
     */
    fun export(saver: SettingsBundleSaver) {
        if (mutableState.value.exporting) return
        mutableState.update { it.copy(exporting = true) }
        logger.info("settingsBackup.export")
        launch {
            try {
                runExport(saver)
            } finally {
                mutableState.update { it.copy(exporting = false) }
            }
        }
    }

    /**
     * Ingests a picked/dropped [file] (web `ingestFile`): resets the flow to parsing, then off the main thread
     * runs the size guard → read → local schema validation → dry-run preview, landing in [ImportStage.Preview]
     * on success or back at [ImportStage.Idle] with a typed [ImportError] on any failure.
     */
    fun ingest(file: PickedFile) {
        reset()
        mutableState.update { it.copy(stage = ImportStage.Parsing) }
        launch { intake(file) }
    }

    /**
     * Applies the previewed bundle (web `handleApply`): on success lands in [ImportStage.Applied] with the
     * applied diff and raises [SettingsExportImportEffect.ImportApplied]; on failure keeps the dry-run preview
     * visible (so the user can retry without re-uploading) and raises [SettingsExportImportEffect.ImportApplyFailed].
     */
    fun applyImport() {
        val bundle = pendingBundle ?: return
        if (mutableState.value.applying) return
        mutableState.update { it.copy(applying = true) }
        logger.info("settingsBackup.apply")
        launch {
            try {
                runApply(bundle)
            } finally {
                mutableState.update { it.copy(applying = false) }
            }
        }
    }

    /** Returns the import flow to idle, clearing the pending file, error, and both diffs (web `resetImport`). */
    fun reset() {
        pendingBundle = null
        mutableState.update { SettingsExportImportUiState(exporting = it.exporting) }
    }

    /**
     * Emits the one PII-safe `view.opened` diagnostic with the surface slug (P1/S11), at most once per holder.
     * Carries no filename, byte count, or section counts, so a diagnostics line can never leak what was backed up.
     */
    fun recordViewOpened() {
        if (viewOpenedRecorded) return
        viewOpenedRecorded = true
        recordSettingsExportImportViewOpened(logger)
    }

    private suspend fun runExport(saver: SettingsBundleSaver) {
        val bundle = source.exportSettings().getOrNull()
        if (bundle == null) {
            logger.warn("settingsBackup.exportFailed")
            effectChannel.trySend(SettingsExportImportEffect.ExportFailed)
            return
        }
        val saved = saver.save(source.defaultExportFilename(), encodeBundleJson(bundle))
        if (saved.isSuccess) {
            effectChannel.trySend(SettingsExportImportEffect.ExportSucceeded)
        } else {
            logger.warn("settingsBackup.exportFailed")
            effectChannel.trySend(SettingsExportImportEffect.ExportFailed)
        }
    }

    @Suppress("ReturnCount")
    private suspend fun intake(file: PickedFile) {
        if (file.sizeBytes > MAX_IMPORT_FILE_BYTES) {
            failIntake(ImportError.TooLarge)
            return
        }
        val text = runCatching { file.readText() }.getOrNull()
        if (text == null) {
            failIntake(ImportError.Read)
            return
        }
        when (val parsed = parseBundle(text)) {
            is BundleParse.Invalid -> failIntake(parsed.error)
            is BundleParse.Valid -> runPreview(file, parsed.bundle)
        }
    }

    private suspend fun runPreview(
        file: PickedFile,
        bundle: SettingsBundle,
    ) {
        pendingBundle = bundle
        mutableState.update { it.copy(pending = PendingImport(file.name, file.sizeBytes)) }
        source.dryRunImport(bundle).fold(
            onSuccess = { result ->
                mutableState.update { it.copy(stage = ImportStage.Preview, preview = result, error = null) }
            },
            onFailure = {
                logger.warn("settingsBackup.previewFailed")
                pendingBundle = null
                mutableState.update {
                    it.copy(stage = ImportStage.Idle, pending = null, error = ImportError.PreviewFailed)
                }
            },
        )
    }

    private suspend fun runApply(bundle: SettingsBundle) {
        source.applyImport(bundle).fold(
            onSuccess = { result ->
                val summary = summariseImport(result)
                pendingBundle = null
                mutableState.update {
                    it.copy(
                        stage = ImportStage.Applied,
                        applied = result,
                        preview = null,
                        pending = null,
                        error = null,
                    )
                }
                effectChannel.trySend(
                    SettingsExportImportEffect.ImportApplied(summary.added, summary.updated, summary.skipped),
                )
            },
            onFailure = {
                logger.warn("settingsBackup.applyFailed")
                effectChannel.trySend(SettingsExportImportEffect.ImportApplyFailed)
            },
        )
    }

    private fun failIntake(error: ImportError) {
        mutableState.update { it.copy(stage = ImportStage.Idle, error = error) }
    }

    companion object {
        /** A [ViewModelProvider.Factory] a host uses to construct this surface's ViewModel from a [source]. */
        fun factory(
            source: SettingsExportImportViewSource,
            logger: Logger,
        ): ViewModelProvider.Factory =
            viewModelFactory {
                initializer { SettingsExportImportViewModel(source, logger) }
            }

        /** Wire the surface from the shared **S8** [SettingsBackupStore]. */
        fun create(
            store: SettingsBackupStore,
            logger: Logger,
            scope: CoroutineScope? = null,
        ): SettingsExportImportViewModel = SettingsExportImportViewModel(settingsExportImportViewSource(store), logger, scope)

        /** Wire the surface from the shared **S7** [SettingsBackupRepository] + a [Clock]. */
        fun create(
            repository: SettingsBackupRepository,
            clock: Clock,
            logger: Logger,
            scope: CoroutineScope? = null,
        ): SettingsExportImportViewModel = SettingsExportImportViewModel(settingsExportImportViewSource(repository, clock), logger, scope)
    }
}
