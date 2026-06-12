// The data + platform ports the SettingsExportImport feature view binds to (P1/S8 state-holder seam) — the
// native analogue of the web component's hook composition (web/src/api/hooks/useSettingsBackup.ts →
// web/src/features/settings/components/SettingsExportImport.tsx). The view never performs HTTP or file IO
// itself; a shared adapter (the S8 SettingsBackupStore or the S7 SettingsBackupRepository) drives the data
// seam, and the host wires the platform IO ports ([PickedFile] reader, [SettingsBundleSaver]). All three are
// fakeable so the view-model is driven entirely off-device in tests.
//
// Unlike most surfaces this domain is mutation-only (the web hooks are `useMutation`, not `useQuery`, because
// the user explicitly clicks Export / Preview / Apply), so there is no cache-then-network read here and no
// [io.teslasync.shared.core.data.repo.Resource] feed — the seam exposes three suspend [Result] mutations plus
// the UTC-date export-filename derivation.
//
// `InvalidPackageDeclaration`/`filename`/`MatchingDeclarationName` are suppressed: the mandated surface
// directory (com/teslasync/feature-views/SettingsExportImport) cannot form a valid Kotlin package and the file
// hosts the seam plus its bindings and the IO ports, mirroring the sibling surfaces.
@file:Suppress("InvalidPackageDeclaration", "ktlint:standard:filename", "MatchingDeclarationName")

package io.teslasync.android.featureviews.settingsexportimport

import io.teslasync.shared.core.cache.Clock
import io.teslasync.shared.core.data.repo.SettingsBackupRepository
import io.teslasync.shared.core.data.repo.defaultExportFilename
import io.teslasync.shared.core.presentation.settingsbackup.SettingsBackupStore
import io.teslasync.shared.core.presentation.settingsbackup.SettingsBundle
import io.teslasync.shared.core.presentation.settingsbackup.SettingsImportResult

/**
 * The single data seam the [SettingsExportImportViewModel] depends on so it binds to an abstraction (real
 * adapter ↔ test fake), never to a concrete store or the network. The three mutations are the web
 * `useExportSettings` / `useDryRunImport` / `useApplyImport` non-throwing `Result`s; [defaultExportFilename]
 * is the web `defaultExportFilename` UTC-date derivation used to name the download. No HTTP touches the view.
 */
interface SettingsExportImportViewSource {
    /** `GET /settings/export` — the in-memory settings bundle (web `useExportSettings`). */
    suspend fun exportSettings(): Result<SettingsBundle>

    /** `POST /settings/import { dry_run: true }` — the per-section preview diff (web `useDryRunImport`). */
    suspend fun dryRunImport(bundle: SettingsBundle): Result<SettingsImportResult>

    /** `POST /settings/import { dry_run: false }` — applies the bundle (web `useApplyImport`). */
    suspend fun applyImport(bundle: SettingsBundle): Result<SettingsImportResult>

    /** The UTC-date save-as filename for the current export (web `defaultExportFilename`). */
    fun defaultExportFilename(): String
}

/**
 * A file the user picked (or dropped) for import — the native analogue of the web `File` the change/drop
 * handlers receive. [name] + [sizeBytes] drive the preview header and the size guard; [readText] reads the
 * full UTF-8 contents (web `file.text()`) and throws on an IO failure, which the view-model maps to the
 * "Failed to read the file." surface. The host backs this with a `ContentResolver`; tests pass a fake.
 */
class PickedFile(
    val name: String,
    val sizeBytes: Long,
    val readText: suspend () -> String,
)

/**
 * The save-as port the export flow writes the encoded bundle through — the native analogue of the web
 * `downloadSettingsBundle` blob download. The host backs it with a downloads-folder writer (MediaStore on
 * API 29+, the app downloads dir on older releases); tests pass a fake. Returns a non-throwing [Result] so a
 * write failure surfaces as an honest error toast rather than a false "exported" confirmation.
 */
fun interface SettingsBundleSaver {
    /** Writes [json] to the downloads folder as [filename]; failure is reported, never thrown. */
    suspend fun save(
        filename: String,
        json: String,
    ): Result<Unit>
}

/**
 * Binds the surface to the shared **S8** holder — the app-wide [SettingsBackupStore] every export/import screen
 * shares, which caches the last export/import result and owns the [Clock]-derived filename. The mutations route
 * through the store so its `lastExport`/`lastImport` state stays consistent (web `setQueryData`).
 */
fun settingsExportImportViewSource(store: SettingsBackupStore): SettingsExportImportViewSource =
    object : SettingsExportImportViewSource {
        override suspend fun exportSettings(): Result<SettingsBundle> = store.exportSettings()

        override suspend fun dryRunImport(bundle: SettingsBundle): Result<SettingsImportResult> = store.dryRunImport(bundle)

        override suspend fun applyImport(bundle: SettingsBundle): Result<SettingsImportResult> = store.applyImport(bundle)

        override fun defaultExportFilename(): String = store.defaultExportFilename()
    }

/**
 * Binds the surface directly to the shared **S7** [SettingsBackupRepository] + a [Clock] — the binding to use
 * when a host does not share a single app-wide store. The filename is derived from the clock's UTC "now" via
 * the shared [defaultExportFilename], exactly as the store does.
 */
fun settingsExportImportViewSource(
    repository: SettingsBackupRepository,
    clock: Clock,
): SettingsExportImportViewSource =
    object : SettingsExportImportViewSource {
        override suspend fun exportSettings(): Result<SettingsBundle> = repository.exportSettings()

        override suspend fun dryRunImport(bundle: SettingsBundle): Result<SettingsImportResult> = repository.dryRunImport(bundle)

        override suspend fun applyImport(bundle: SettingsBundle): Result<SettingsImportResult> = repository.applyImport(bundle)

        override fun defaultExportFilename(): String = defaultExportFilename(clock.nowMillis())
    }
