// Pure, framework-free model + projection for the BackupActionsCard feature view — the native analogue of
// everything the web component derives before returning JSX
// (web/src/features/system/components/status/BackupActionsCard.tsx) plus the backup-status DefList its parent
// hands it as `children` (web/src/features/system/pages/SystemStatusPage.tsx). No Compose, no Android UI, no
// HTTP: every declaration here is exercised off-device in the :android:testReleaseUnitTest gate, keeping the
// composable a thin render layer.
//
// The web component is MUTATION-CENTRIC — it owns a single `useMutation(triggerQuickBackup)` plus `useToast` /
// `useQueryClient`, and renders `{children}` (a backup-status DefList) above a "Run quick backup now" button +
// a "Manage backups & restore" link. Its parent owns the backup feed (`getBackupConfigs` / `getBackupRuns`)
// and renders the DefList rows. Because the children ARE a data feed (unlike the static `ResetSection`), the
// native surface folds that feed in as a cache-then-network [UiState] so it can honestly render loading /
// content / empty / error / stale / offline — exactly the sibling [UserImpersonateButton] pattern. This file
// owns the pure parts: the backup-status projection from the raw configs/runs JSON ([BackupActionsCardProjection.parse]),
// the surface-state selection ([BackupActionsCardProjection.selectSurface]), the mutation error → toast-key
// classification (web's 401/403 vs generic branch), the registry + PII-safe diagnostics ids, and the i18n key
// constants. Label resolution + date formatting are render concerns the composable owns.
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/feature-views/BackupActionsCard — the P3 prompt's allowed-files path) cannot form a valid
// Kotlin package (a hyphen and a PascalCase segment are illegal in a package identifier), so the package
// intentionally diverges from the path — exactly as the sibling feature-view surfaces do.
// `MatchingDeclarationName` is suppressed for the co-located supporting types.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.backupactionscard

import io.teslasync.android.data.UiState
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.net.ApiError
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.longOrNull
import java.time.Instant
import java.time.OffsetDateTime

/** Diagnostics + registry identifiers for the surface (P1/S11). */
object BackupActionsCardRegistration {
    /** Stable surface id. */
    const val ID: String = "backup-actions-card"

    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). */
    const val SLUG: String = "BackupActionsCard"
}

/**
 * PII-safe diagnostics for the surface (P1/S11). Every event carries ONLY the surface slug — never a backup
 * file name, path, size, or run id — so a diagnostics line can never leak what was backed up or where. Kept
 * free of Compose so it is unit-tested with a recording [Logger].
 */
object BackupActionsCardDiagnostics {
    /** The one-shot view-open diagnostic event name. */
    const val EVENT_VIEW_OPENED: String = "view.opened"

    /** Logged when a quick backup is confirmed (web `mutation.mutate()` → `triggerQuickBackup`). */
    const val EVENT_RUN_QUICK_BACKUP: String = "backup.quickRun"

    /** The diagnostics field carrying the surface slug. */
    const val FIELD_SURFACE: String = "surface"

    /** Emits the one-shot `view.opened` diagnostic with the surface slug and nothing else. */
    fun recordViewOpened(logger: Logger) {
        logger.info(EVENT_VIEW_OPENED, mapOf(FIELD_SURFACE to BackupActionsCardRegistration.SLUG))
    }

    /** Emits the PII-safe quick-backup diagnostic (surface slug only — never a file name/size). */
    fun recordRunQuickBackup(logger: Logger) {
        logger.info(EVENT_RUN_QUICK_BACKUP, mapOf(FIELD_SURFACE to BackupActionsCardRegistration.SLUG))
    }
}

/**
 * The i18n catalog key for the success toast (web `toast.success('Quick backup started')`). The render boundary
 * resolves it (ADR-014); the matching `translation.backup.quickStarted` already exists in the P1/S10 catalog
 * with the verbatim copy "Quick backup started".
 */
const val BACKUP_STARTED_KEY: String = "backup.quickStarted"

/**
 * The i18n catalog key for the generic mutation-failure toast (web `toast.error("Backup failed: …")`). Mapped
 * to the existing localized `translation.backup.quickFailed` ("Quick backup failed") — the raw error text the
 * web interpolates is intentionally dropped (no English literal, no PII leak through a server message).
 */
const val BACKUP_FAILED_KEY: String = "backup.quickFailed"

/**
 * The i18n catalog key for the permission-denied toast (web `toast.error('Quick backup requires admin
 * permission.')` on a 401/403). The P1/S10 catalog has no dedicated "admin permission" key and `strings.xml`
 * is outside this surface's allowed files, so the closest existing localized authorization message
 * (`translation.error.unauthorized.message`) is raised — behaviourally faithful (a permission failure surfaces
 * its own distinct toast) and fully localized, mirroring the `ResetSection` precedent for absent keys.
 */
const val BACKUP_PERMISSION_KEY: String = "error.unauthorized.message"

/** The backend run status that marks a successful, completed backup (web `r.status === 'completed'`). */
const val RUN_STATUS_COMPLETED: String = "completed"

/** The backend run status that marks a failed backup (web `r.status === 'failed'`). */
const val RUN_STATUS_FAILED: String = "failed"

private const val JSON_KEY_STATUS = "status"
private const val JSON_KEY_COMPLETED_AT = "completed_at"
private const val JSON_KEY_FILE_SIZE = "file_size"
private const val HTTP_UNAUTHORIZED = 401
private const val HTTP_FORBIDDEN = 403

/**
 * The render-ready backup status — the native projection of the parent's `getBackupConfigs` + `getBackupRuns`
 * feeds that produce the web DefList rows. Pure data (no Compose), so the row derivation is fully covered by
 * the off-device unit gate; the localized labels + date/size formatting are resolved at the Compose boundary.
 *
 * @property configuredSchedules count of configured backup schedules (web `backupConfigs?.length ?? 0`).
 * @property totalRuns count of recorded backup runs (web `backupRuns?.length ?? 0`).
 * @property lastSuccessfulAtMillis epoch-ms of the latest `completed` run's `completed_at`, or `null`.
 * @property lastSuccessfulSizeBytes the latest `completed` run's positive `file_size`, or `null`.
 * @property recentFailures count of runs with status `failed` (web `.filter(r => r.status === 'failed')`).
 */
data class BackupStatus(
    val configuredSchedules: Int,
    val totalRuns: Int,
    val lastSuccessfulAtMillis: Long?,
    val lastSuccessfulSizeBytes: Long?,
    val recentFailures: Int,
) {
    /** True when nothing is configured and nothing has run — the friendly "no backups yet" empty surface. */
    val hasNothing: Boolean get() = configuredSchedules == 0 && totalRuns == 0
}

/**
 * The mutually-exclusive surface the card renders, derived by [BackupActionsCardProjection.selectSurface]. Each
 * maps to a render branch so no state is ever a blank box:
 *  - [Content] — backup status loaded: the DefList rows + the action row (run quick backup + manage backups).
 *  - [Loading] — first-load in flight with nothing cached: skeleton chrome.
 *  - [Empty]   — resolved with no schedules and no runs: a friendly "no backups yet" affordance + action row.
 *  - [Error]   — hard failure with nothing cached: an error surface with a retry affordance.
 *  - [Stale]   — cached status past its freshness window but still online: stale chip + auto-refresh + rows.
 *  - [Offline] — cached status served because the refresh failed: offline chip + last-known rows.
 */
enum class BackupActionsSurface {
    Content,
    Loading,
    Empty,
    Error,
    Stale,
    Offline,
}

/**
 * Localized microcopy the surface renders — every region the web component shows (its hard-coded English copy
 * is reproduced through existing P1/S10 catalog keys, since the web source itself uses no `t()` calls) plus the
 * backup-status DefList row labels the parent supplies and the lifecycle-chrome strings the folded feed
 * implies. Pure data so the composable stays a thin render layer and tests pass a deterministic instance.
 */
data class BackupActionsCardStrings(
    val title: String,
    val subtitle: String,
    val runBackup: String,
    val running: String,
    val manageBackups: String,
    val rowConfiguredSchedules: String,
    val rowTotalRuns: String,
    val rowLastSuccessful: String,
    val rowLastSuccessfulSize: String,
    val rowFailures: String,
    val emptyTitle: String,
    val emptyMessage: String,
    val errorTitle: String,
    val errorMessage: String,
    val retry: String,
    val loading: String,
    val offline: String,
    val emDash: String,
)

/**
 * The pure surface-state + backup-status projection the composable renders. Stateless and side-effect-free so
 * it is fully covered by the off-device unit gate.
 */
object BackupActionsCardProjection {
    /** Stable, web-parity test tag for the primary "Run quick backup now" button. */
    const val RUN_BACKUP_TEST_TAG: String = "backup-actions-run"

    /** Stable test tag for the "Manage backups & restore" affordance (web `<Link to="/backup">`). */
    const val MANAGE_BACKUPS_TEST_TAG: String = "backup-actions-manage"

    /**
     * Projects the parent's raw `getBackupConfigs` + `getBackupRuns` payloads (P1/S8) onto a [BackupStatus].
     * Both are array-guarded (the shared `safeArray` contract): a non-array or `null` collapses to empty, so
     * the surface never crashes on a malformed feed. The latest `completed` run drives the last-successful
     * row (web `backupRuns.find(r => r.status === 'completed')`), and failures are counted across all runs.
     */
    fun parse(
        configs: JsonElement?,
        runs: JsonElement?,
    ): BackupStatus {
        val configList = configs.asObjectArray()
        val runList = runs.asObjectArray()
        val lastSuccessful = runList.firstOrNull { it.stringOrNull(JSON_KEY_STATUS) == RUN_STATUS_COMPLETED }
        return BackupStatus(
            configuredSchedules = configList.size,
            totalRuns = runList.size,
            lastSuccessfulAtMillis = lastSuccessful?.stringOrNull(JSON_KEY_COMPLETED_AT)?.let(::parseIsoMillis),
            lastSuccessfulSizeBytes = lastSuccessful?.longFieldOrNull(JSON_KEY_FILE_SIZE)?.takeIf { it > 0L },
            recentFailures = runList.count { it.stringOrNull(JSON_KEY_STATUS) == RUN_STATUS_FAILED },
        )
    }

    /**
     * Selects the [BackupActionsSurface] from the folded backup-status [state] (P1/S8), honouring the ADR-013
     * freshness contract: a first load is [BackupActionsSurface.Loading]; a hard failure with no cache is
     * [BackupActionsSurface.Error]; a resolved no-schedules/no-runs feed is [BackupActionsSurface.Empty];
     * cached-after-failure is [BackupActionsSurface.Offline]; merely-stale-but-online is
     * [BackupActionsSurface.Stale]; otherwise the loaded [BackupActionsSurface.Content].
     */
    fun selectSurface(state: UiState<BackupStatus>): BackupActionsSurface =
        when {
            state.isLoading -> BackupActionsSurface.Loading
            state.isError -> BackupActionsSurface.Error
            state.isEmpty -> BackupActionsSurface.Empty
            state.stale && state.hasError -> BackupActionsSurface.Offline
            state.stale -> BackupActionsSurface.Stale
            else -> BackupActionsSurface.Content
        }

    /**
     * Classifies a failed quick-backup mutation into its toast i18n key — the native mirror of the web
     * `onError` branch: an [ApiError.Http] 401/403 raises the permission key, anything else the generic
     * backup-failure key. Pure so the routing is unit-tested without a UI host.
     */
    fun errorMessageKey(error: Throwable?): String =
        when ((error as? ApiError.Http)?.status) {
            HTTP_UNAUTHORIZED, HTTP_FORBIDDEN -> BACKUP_PERMISSION_KEY
            else -> BACKUP_FAILED_KEY
        }

    /** The domain emptiness predicate fed to `toUiState` — empty when nothing is configured and nothing ran. */
    fun isEmpty(status: BackupStatus): Boolean = status.hasNothing
}

/** Array guard ported from the shared `safeArray`: a non-array / null collapses to an empty object list. */
private fun JsonElement?.asObjectArray(): List<JsonObject> = (this as? JsonArray)?.mapNotNull { it as? JsonObject } ?: emptyList()

/** Reads a string field, treating a JSON-null or non-primitive as absent. */
private fun JsonObject.stringOrNull(key: String): String? = (this[key] as? JsonPrimitive)?.contentOrNull

/** Reads a long field, treating a JSON-null or non-numeric as absent. */
private fun JsonObject.longFieldOrNull(key: String): Long? = (this[key] as? JsonPrimitive)?.longOrNull

/** Parses an ISO-8601 timestamp to epoch-ms (API 26+ `java.time`), tolerating both offset and `Z` forms. */
private fun parseIsoMillis(iso: String): Long? =
    runCatching { OffsetDateTime.parse(iso).toInstant().toEpochMilli() }
        .recoverCatching { Instant.parse(iso).toEpochMilli() }
        .getOrNull()
