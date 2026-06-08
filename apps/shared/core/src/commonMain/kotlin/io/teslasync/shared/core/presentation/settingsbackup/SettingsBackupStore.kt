package io.teslasync.shared.core.presentation.settingsbackup

import io.teslasync.shared.core.cache.Clock
import io.teslasync.shared.core.data.repo.SettingsBackupRepository
import io.teslasync.shared.core.data.repo.defaultExportFilename
import io.teslasync.shared.core.data.repo.summariseImportResult
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

/**
 * UI-free shared state holder for the settings backup feature — the cross-platform port of the web
 * `useSettingsBackup` hook domain (web/src/api/hooks/useSettingsBackup.ts). Every native
 * export/import screen (Android/Apple via KMP, Windows via the C# port) binds to this single holder
 * rather than re-implementing endpoints, the last-result cache, or the import-summary arithmetic.
 *
 * The web domain is three `useMutation`s with NO `useQuery` — the user explicitly clicks Export /
 * Preview / Apply, so there is no polling read and therefore no [io.teslasync.shared.core.data.repo.Resource]
 * feed here. Instead each mutation primes the in-memory query cache via `setQueryData`
 * (`settingsBackupKeys.lastExport` / `.lastImport`); that "last result" is reproduced as observable
 * [StateFlow] state so a native screen can render the most recent bundle/preview without re-fetching:
 *  - [lastExport] mirrors `setQueryData(settingsBackupKeys.lastExport, bundle)` — updated on every
 *    successful [exportSettings].
 *  - [lastImport] mirrors `setQueryData(settingsBackupKeys.lastImport, result)` — updated on every
 *    successful [dryRunImport] AND [applyImport] (both web hooks write the same key).
 *
 * The mutations are non-throwing suspend [Result]s mirroring the web hooks' mutationFn + onSuccess:
 *  - [exportSettings] (web `useExportSettings`) — `GET /settings/export`, caches the bundle.
 *  - [dryRunImport] (web `useDryRunImport`) — `POST /settings/import { dry_run: true }`, caches the result.
 *  - [applyImport] (web `useApplyImport`) — `POST /settings/import { dry_run: false }`, caches the result.
 *
 * The holder makes no network calls itself; it injects the S7 repository and a [Clock] (the latter
 * only for [defaultExportFilename], the UTC-date filename derivation). It mirrors the web hooks'
 * single-threaded usage and is not internally synchronised; drive it from one confinement (the
 * platform main scope).
 *
 * @property repo the S7 data port every mutation is routed through.
 * @property clock the wall-clock seam the export-filename derivation reads UTC "now" from.
 */
public class SettingsBackupStore(
    private val repo: SettingsBackupRepository,
    private val clock: Clock,
) {
    private val _lastExport = MutableStateFlow<SettingsBundle?>(null)
    private val _lastImport = MutableStateFlow<SettingsImportResult?>(null)

    /** The most recently exported bundle (web `settingsBackupKeys.lastExport`), or null before any export. */
    public val lastExport: StateFlow<SettingsBundle?> = _lastExport.asStateFlow()

    /** The most recent import result, dry-run or applied (web `settingsBackupKeys.lastImport`), or null before any. */
    public val lastImport: StateFlow<SettingsImportResult?> = _lastImport.asStateFlow()

    // ---- Mutations ----------------------------------------------------------------

    /** Exports the settings bundle and caches it into [lastExport] on success (web `useExportSettings`). */
    public suspend fun exportSettings(): Result<SettingsBundle> = repo.exportSettings().onSuccess { _lastExport.value = it }

    /** Previews an import and caches the result into [lastImport] on success (web `useDryRunImport`). */
    public suspend fun dryRunImport(bundle: SettingsBundle): Result<SettingsImportResult> =
        repo.dryRunImport(bundle).onSuccess { _lastImport.value = it }

    /** Applies an import and caches the result into [lastImport] on success (web `useApplyImport`). */
    public suspend fun applyImport(bundle: SettingsBundle): Result<SettingsImportResult> =
        repo.applyImport(bundle).onSuccess { _lastImport.value = it }

    // ---- Derivations --------------------------------------------------------------

    /**
     * The default save-as filename for the current export (web `defaultExportFilename`), built from
     * the injected clock's UTC date. Pure given the clock, so a screen can label the download button
     * without re-deriving the date arithmetic.
     */
    public fun defaultExportFilename(): String = defaultExportFilename(clock.nowMillis())

    /**
     * Folds an import result into its added/updated/skipped/total summary (web `summariseImportResult`)
     * so a screen can label "Apply N changes" without re-deriving the arithmetic.
     */
    public fun summarise(result: SettingsImportResult): ImportSummary = summariseImportResult(result)
}
