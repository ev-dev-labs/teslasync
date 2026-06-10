package io.teslasync.shared.core.data.repo

import io.teslasync.shared.core.presentation.settingsbackup.ImportSummary
import io.teslasync.shared.core.presentation.settingsbackup.SettingsBundle
import io.teslasync.shared.core.presentation.settingsbackup.SettingsImportResult
import kotlinx.datetime.TimeZone
import kotlinx.datetime.toLocalDateTime
import kotlin.time.Instant

/**
 * The S7 data port for the settings backup feature — the cross-platform analogue of the web
 * `useSettingsBackup` hook domain (web/src/api/hooks/useSettingsBackup.ts). Every native
 * export/import surface (Android/Apple via KMP, Windows via the C# port) reaches the backend
 * exclusively through this interface, so a single fake stands in for the whole domain in the S8
 * state-holder tests.
 *
 * All three surfaces are mutations (the web hooks are `useMutation`, not `useQuery`, because the
 * user explicitly clicks Export / Preview / Apply — there is no polling case), so the port has NO
 * cache-then-network read and touches no durable cache. The web hooks instead prime the in-memory
 * query cache via `setQueryData` (`settingsBackupKeys.lastExport` / `.lastImport`); that "last
 * result" state is the S8 state holder's job ([io.teslasync.shared.core.presentation.settingsbackup.SettingsBackupStore]),
 * not this layer's.
 *
 *  - [exportSettings] — `GET /settings/export` (web `useExportSettings`); returns the bundle in
 *    memory so a screen can both preview it and trigger a save-as download.
 *  - [dryRunImport] — `POST /settings/import { dry_run: true, bundle }` (web `useDryRunImport`);
 *    returns the per-section {added, updated, skipped} preview.
 *  - [applyImport] — `POST /settings/import { dry_run: false, bundle }` (web `useApplyImport`);
 *    applies the bundle. The shared client transparently handles the backend's SUDO step-up.
 *
 * No bundle field is unit-bearing, so payloads round-trip verbatim with no SI conversion; display
 * formatting is the render boundary's job (S5).
 */
public interface SettingsBackupRepository {
    /** `GET /settings/export` — the in-memory settings bundle (web `useExportSettings`). */
    public suspend fun exportSettings(): Result<SettingsBundle>

    /**
     * `POST /settings/import` with `{ dry_run: true, bundle }` — the preview diff (web
     * `useDryRunImport`). Reads only; no data is written server-side.
     */
    public suspend fun dryRunImport(bundle: SettingsBundle): Result<SettingsImportResult>

    /**
     * `POST /settings/import` with `{ dry_run: false, bundle }` — applies the bundle (web
     * `useApplyImport`). May trip the backend's RequireSudo step-up, handled transparently by the
     * shared client.
     */
    public suspend fun applyImport(bundle: SettingsBundle): Result<SettingsImportResult>
}

/**
 * The web `settingsBackupKeys.root` tuple first segment (`['settings', 'backup']`). The settings
 * backup keys are flat parents the web hooks prime with `setQueryData`; their KMP analogue is the
 * "last result" state the S8 store exposes, but the keys are mirrored here so the C# port and KMP
 * agree on the cache namespace. Locked by golden vectors shared with the C# port.
 */
public const val SETTINGS_BACKUP_PREFIX: String = "settings:backup"

/** Cache key for the last export bundle — the web `settingsBackupKeys.lastExport`. */
public fun settingsLastExportKey(): String = "$SETTINGS_BACKUP_PREFIX:last-export"

/** Cache key for the last import result — the web `settingsBackupKeys.lastImport`. */
public fun settingsLastImportKey(): String = "$SETTINGS_BACKUP_PREFIX:last-import"

/**
 * Builds the user-facing export filename — the port of the web `defaultExportFilename`
 * (web/src/lib/settingsImportSchema.ts). The UTC calendar date keeps multiple exports
 * distinguishable in the downloads folder without exposing the (locale-confusing) hour, so the
 * format is `teslasync-settings-YYYYMMDD.json` with month/day zero-padded to two digits. [nowEpochMillis]
 * is interpreted in UTC, exactly as the web helper uses `getUTCFullYear`/`getUTCMonth`/`getUTCDate`.
 * Locked by golden vectors shared with the C# port.
 */
public fun defaultExportFilename(nowEpochMillis: Long): String {
    val date = Instant.fromEpochMilliseconds(nowEpochMillis).toLocalDateTime(TimeZone.UTC).date
    val yyyy = date.year.toString().padStart(4, '0')
    val mm = date.monthNumber.toString().padStart(2, '0')
    val dd = date.day.toString().padStart(2, '0')
    return "teslasync-settings-$yyyy$mm$dd.json"
}

/**
 * Folds a [SettingsImportResult] into a single [ImportSummary] — the port of the web
 * `summariseImportResult` (web/src/lib/settingsImportSchema.ts). [ImportSummary.total] is
 * `added + updated` (skipped is summed but NOT counted in total), mirroring the web helper the page
 * uses to label "Apply N changes". A `null`/absent section contributes nothing. Locked by golden
 * vectors shared with the C# port.
 */
public fun summariseImportResult(result: SettingsImportResult): ImportSummary {
    var added = 0
    var updated = 0
    var skipped = 0
    for (section in result.sections.values) {
        added += section.added
        updated += section.updated
        skipped += section.skipped
    }
    return ImportSummary(added = added, updated = updated, skipped = skipped, total = added + updated)
}
