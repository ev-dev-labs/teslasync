// Pure, framework-free model + projection for the BackupRestorePage admin surface — the native analogue of
// everything the web page derives before it returns JSX (web/src/features/admin/pages/BackupRestorePage.tsx,
// the "Backup & Restore" management screen). No Compose, no Android UI, no HTTP lives here: the configs/runs
// feeds arrive as the shared S8 raw-JSON payloads (`GET /backup/configs` / `GET /backup/runs`), so this file
// owns only the client-side derivations the web component does inline — the typed config/run projections, the
// four summary stats (web `useMemo` over runs), the recent-failures slice (web `failedRuns`), the restore
// preview projection, the config-form ⇄ request-body mapping, the provider/status/type lookups, the surface's
// navigation identity, the PII-safe `view.opened` diagnostic, and the toast i18n keys. Byte/size/date
// formatting that needs a locale is a render concern the composable owns.
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory (com/teslasync/admin — the
// P3 prompt's allowed-files path) cannot form the package the rest of the app's `io.teslasync.android.*`
// namespace uses, so the package intentionally diverges from the path — exactly as the sibling admin surfaces
// do. `MatchingDeclarationName` is suppressed for the co-located derivations + recorder.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.admin.backuprestore

import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.intOrNull
import kotlinx.serialization.json.longOrNull
import kotlinx.serialization.json.put
import java.time.Instant
import java.time.OffsetDateTime

/**
 * Canonical metadata for this surface. The web page is registered at `/backup`, but the Android navigation
 * registry ([io.teslasync.android.navigation.Destinations]) is generated from the canonical web route taxonomy
 * and frozen by a coverage test, so this surface — added outside that generated set — carries a reserved
 * forward-looking [ROUTE_ID] that [BackupRestorePageHost] wires dormantly until the route lands, plus the
 * diagnostics [SLUG] emitted with the one-shot `view.opened` event (P1/S11).
 */
object BackupRestorePageRegistration {
    /** The navigation destination id reserved for this surface; wired dormantly (no generated Destinations row). */
    const val ROUTE_ID: String = "backupRestore"

    /** The web route this surface mirrors. */
    const val WEB_PATH: String = "/backup"

    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). Carries no backup file/path. */
    const val SLUG: String = "BackupRestorePage"
}

/**
 * PII-safe diagnostics for the surface (P1/S11). Every event carries ONLY the surface slug — never a backup file
 * name, path, size, or run id — so a diagnostics line can never leak what was backed up or where. Kept free of
 * Compose so it is unit-tested with a recording [Logger].
 */
object BackupRestorePageDiagnostics {
    const val EVENT_VIEW_OPENED: String = "view.opened"
    const val FIELD_SURFACE: String = "surface"

    /** Emits the one-shot `view.opened` diagnostic with the surface slug and nothing else. */
    fun recordViewOpened(logger: Logger) {
        logger.info(EVENT_VIEW_OPENED, mapOf(FIELD_SURFACE to BackupRestorePageRegistration.SLUG))
    }
}

/**
 * The i18n catalog keys for the surface's one-shot toasts (web `toast.success(...)` / `toast.error(...)`). The
 * render boundary resolves each (ADR-014); these mirror the web `t()` keys verbatim so the localized copy is
 * identical. The raw server error text the web interpolates is intentionally dropped (no English literal, no PII
 * leak through a server message), exactly as the sibling BackupActionsCard surface does.
 */
object BackupRestoreToastKeys {
    const val CONFIG_CREATED: String = "backup.configCreated"
    const val CONFIG_CREATE_FAILED: String = "backup.configCreateFailed"
    const val CONFIG_UPDATED: String = "backup.configUpdated"
    const val CONFIG_UPDATE_FAILED: String = "backup.configUpdateFailed"
    const val CONFIG_DELETED: String = "backup.configDeleted"
    const val CONFIG_DELETE_FAILED: String = "backup.configDeleteFailed"
    const val TRIGGERED: String = "backup.triggered"
    const val TRIGGER_FAILED: String = "backup.triggerFailed"
    const val QUICK_STARTED: String = "backup.quickStarted"
    const val QUICK_FAILED: String = "backup.quickFailed"
    const val CHECKSUM_VERIFIED: String = "backup.checksumVerified"
    const val CHECKSUM_MISMATCH: String = "backup.checksumMismatch"
    const val VERIFY_FAILED: String = "backup.verifyFailed"
    const val PREVIEW_FAILED: String = "backup.previewFailed"
}

/** The backend run status that marks a successful, completed backup (web `r.status === 'completed'`). */
const val RUN_STATUS_COMPLETED: String = "completed"

/** The backend run status that marks a failed backup (web `r.status === 'failed'`). */
const val RUN_STATUS_FAILED: String = "failed"

/** The backend run status for an in-progress backup (web `running`); its status icon spins. */
const val RUN_STATUS_RUNNING: String = "running"

/** The `full` backup type (web `backup_type === 'full'`). */
const val BACKUP_TYPE_FULL: String = "full"

/** The em dash shown for an absent value (web `—`). */
const val EM_DASH: String = "\u2014"

private const val MAX_RECENT_FAILURES = 5
private const val MIN_FREQUENCY_DAYS = 1
private const val MIN_RETENTION = 1
private const val DEFAULT_RETENTION = 7

// ── Typed projections of the raw S8 JSON ─────────────────────────────────────────────────────────────────────

/**
 * One configured backup schedule — the typed projection of a `GET /backup/configs` row (web `BackupConfig`).
 * Timestamps are pre-parsed to epoch-ms so the composable formats them at the locale boundary.
 */
data class BackupConfig(
    val id: Long,
    val name: String,
    val enabled: Boolean,
    val backupType: String,
    val frequencyDays: Int,
    val maxRetention: Int,
    val provider: String,
    val providerConfig: Map<String, String>,
    val compress: Boolean,
    val encrypt: Boolean,
    val lastRunAtMillis: Long?,
    val nextRunAtMillis: Long?,
)

/**
 * One recorded backup run — the typed projection of a `GET /backup/runs` row (web `BackupRun`). Timestamps are
 * pre-parsed to epoch-ms; the file name / error message are nullable exactly as the web fields are.
 */
data class BackupRun(
    val id: Long,
    val runType: String,
    val status: String,
    val provider: String,
    val fileName: String?,
    val fileSize: Long,
    val recordCount: Long,
    val durationMs: Long,
    val errorMessage: String?,
    val createdAtMillis: Long?,
    val completedAtMillis: Long?,
)

/** The restore-preview payload (web `RestorePreview`) — the verified checksum flag, metadata, and per-table rows. */
data class RestorePreview(
    val tables: List<PreviewTable>,
    val metadata: List<Pair<String, String>>,
    val checksumVerified: Boolean,
)

/** One table row inside a restore preview (web `{ name, rows }`). */
data class PreviewTable(
    val name: String,
    val rows: Long,
)

/**
 * The four summary metrics the page header renders (web `useMemo` over the configs/runs feeds): the configured
 * schedule count, the total recorded runs, the latest completed run's timestamp, and the cumulative size across
 * every run.
 */
data class BackupStats(
    val totalConfigs: Int,
    val totalBackups: Int,
    val lastBackupAtMillis: Long?,
    val totalSizeBytes: Long,
)

// ── Config-form state (web `ConfigFormData`) ─────────────────────────────────────────────────────────────────

/** The create/edit config form state (web `ConfigFormData`); [EMPTY] mirrors the web `EMPTY_FORM`. */
data class ConfigFormState(
    val name: String = "",
    val enabled: Boolean = true,
    val backupType: String = BACKUP_TYPE_FULL,
    val frequencyDays: Int = MIN_FREQUENCY_DAYS,
    val maxRetention: Int = DEFAULT_RETENTION,
    val provider: String = PROVIDER_LOCAL,
    val providerConfig: Map<String, String> = mapOf(PROVIDER_FIELD_PATH to DEFAULT_LOCAL_PATH),
    val compress: Boolean = true,
    val encrypt: Boolean = false,
) {
    /** True once the name is non-blank — the web `disabled={!form.name.trim()}` save guard. */
    val canSave: Boolean get() = name.isNotBlank()

    companion object {
        val EMPTY: ConfigFormState = ConfigFormState()
    }
}

/** Seeds the form from an existing config for the edit modal (web `openEdit`). */
fun BackupConfig.toFormState(): ConfigFormState =
    ConfigFormState(
        name = name,
        enabled = enabled,
        backupType = backupType,
        frequencyDays = frequencyDays,
        maxRetention = maxRetention,
        provider = provider,
        providerConfig = providerConfig,
        compress = compress,
        encrypt = encrypt,
    )

/** Builds the create/update request body (web JSON body: snake_case keys + the provider_config object). */
fun ConfigFormState.toRequestBody(): JsonObject =
    buildJsonObject {
        put("name", name)
        put("enabled", enabled)
        put("backup_type", backupType)
        put("frequency_days", frequencyDays)
        put("max_retention", maxRetention)
        put("provider", provider)
        put(
            "provider_config",
            buildJsonObject { providerConfig.forEach { (key, value) -> put(key, value) } },
        )
        put("compress", compress)
        put("encrypt", encrypt)
    }

/** Clamps a typed frequency/retention field to its web minimum (web `Math.max(1, Number(...))`). */
fun clampPositive(
    raw: String,
    minimum: Int,
): Int = (raw.trim().toIntOrNull() ?: minimum).coerceAtLeast(minimum)

/** The retention-field clamp (web `Math.max(1, …)`). */
fun clampRetention(raw: String): Int = clampPositive(raw, MIN_RETENTION)

/** The frequency-field clamp (web `Math.max(1, …)`). */
fun clampFrequency(raw: String): Int = clampPositive(raw, MIN_FREQUENCY_DAYS)

// ── Provider catalog (web `PROVIDERS` / `PROVIDER_FIELDS`) ────────────────────────────────────────────────────

const val PROVIDER_LOCAL: String = "local"
private const val PROVIDER_S3 = "s3"
private const val PROVIDER_AZURE = "azure"
private const val PROVIDER_GCS = "gcs"
private const val PROVIDER_FIELD_PATH = "path"
private const val DEFAULT_LOCAL_PATH = "/backups"

/** A selectable storage provider — its API value + its brand display label (web `PROVIDERS`). */
data class ProviderOption(
    val value: String,
    val label: String,
)

/** The selectable providers (web `PROVIDERS`); the labels are vendor brands, language-neutral like the web. */
val PROVIDER_OPTIONS: List<ProviderOption> =
    listOf(
        ProviderOption(PROVIDER_LOCAL, "Local"),
        ProviderOption(PROVIDER_S3, "Amazon S3"),
        ProviderOption(PROVIDER_AZURE, "Azure Blob"),
        ProviderOption(PROVIDER_GCS, "Google Cloud"),
    )

/** The brand label for a provider value, falling back to the raw value (web `PROVIDERS.find(...)?.label`). */
fun providerLabel(value: String): String = PROVIDER_OPTIONS.firstOrNull { it.value == value }?.label ?: value

/**
 * One dynamic provider-settings field (web `PROVIDER_FIELDS[provider]`). The display label is derived from the
 * [key] at the render boundary ([humanizeFieldKey]) so no English UI literal is hard-coded; [example] carries
 * the web example value (a language-neutral sample like `us-east-1`).
 */
data class ProviderField(
    val key: String,
    val required: Boolean = false,
    val secret: Boolean = false,
    val multiline: Boolean = false,
    val example: String? = null,
)

/** The per-provider dynamic settings fields (web `PROVIDER_FIELDS`). */
val PROVIDER_FIELDS: Map<String, List<ProviderField>> =
    mapOf(
        PROVIDER_LOCAL to listOf(ProviderField(PROVIDER_FIELD_PATH, required = true, example = DEFAULT_LOCAL_PATH)),
        PROVIDER_S3 to
            listOf(
                ProviderField("bucket", required = true, example = "my-backup-bucket"),
                ProviderField("region", required = true, example = "us-east-1"),
                ProviderField("access_key", required = true),
                ProviderField("secret_key", required = true, secret = true),
                ProviderField("endpoint", example = "https://s3.amazonaws.com"),
                ProviderField("prefix", example = "backups/"),
            ),
        PROVIDER_AZURE to
            listOf(
                ProviderField("account_name", required = true),
                ProviderField("account_key", required = true, secret = true),
                ProviderField("container_name", required = true),
                ProviderField("prefix", example = "backups/"),
            ),
        PROVIDER_GCS to
            listOf(
                ProviderField("bucket", required = true, example = "my-backup-bucket"),
                ProviderField("credentials_json", required = true, multiline = true),
                ProviderField("prefix", example = "backups/"),
            ),
    )

/** Humanizes a snake_case config key into a Title-Case field label (`access_key` ⇒ `Access Key`). */
fun humanizeFieldKey(key: String): String =
    key.split('_').filter { it.isNotEmpty() }.joinToString(" ") { part ->
        part.replaceFirstChar { it.uppercaseChar() }
    }

// ── Parsing (the shared `safeArray` array-guard) ─────────────────────────────────────────────────────────────

/** Projects the raw `GET /backup/configs` payload into typed configs; a non-array collapses to empty. */
fun JsonElement?.asBackupConfigs(): List<BackupConfig> =
    asObjectArray().map { row ->
        BackupConfig(
            id = row.longField("id") ?: 0L,
            name = row.stringField("name").orEmpty(),
            enabled = row.boolField("enabled") ?: false,
            backupType = row.stringField("backup_type").orEmpty(),
            frequencyDays = row.intField("frequency_days") ?: MIN_FREQUENCY_DAYS,
            maxRetention = row.intField("max_retention") ?: DEFAULT_RETENTION,
            provider = row.stringField("provider").orEmpty(),
            providerConfig = row.stringMapField("provider_config"),
            compress = row.boolField("compress") ?: false,
            encrypt = row.boolField("encrypt") ?: false,
            lastRunAtMillis = row.stringField("last_run_at")?.let(::parseIsoMillis),
            nextRunAtMillis = row.stringField("next_run_at")?.let(::parseIsoMillis),
        )
    }

/** Projects the raw `GET /backup/runs` payload into typed runs; a non-array collapses to empty. */
fun JsonElement?.asBackupRuns(): List<BackupRun> =
    asObjectArray().map { row ->
        BackupRun(
            id = row.longField("id") ?: 0L,
            runType = row.stringField("run_type").orEmpty(),
            status = row.stringField("status").orEmpty(),
            provider = row.stringField("provider").orEmpty(),
            fileName = row.stringField("file_name"),
            fileSize = row.longField("file_size") ?: 0L,
            recordCount = row.longField("record_count") ?: 0L,
            durationMs = row.longField("duration_ms") ?: 0L,
            errorMessage = row.stringField("error_message"),
            createdAtMillis = row.stringField("created_at")?.let(::parseIsoMillis),
            completedAtMillis = row.stringField("completed_at")?.let(::parseIsoMillis),
        )
    }

/** Projects the raw `GET /backup/runs/{id}/preview` payload into a typed [RestorePreview]. */
fun JsonElement.asRestorePreview(): RestorePreview {
    val obj = this as? JsonObject ?: return RestorePreview(emptyList(), emptyList(), checksumVerified = false)
    val tables =
        (obj["tables"] as? JsonArray).orEmptyArray().mapNotNull { element ->
            val table = element as? JsonObject ?: return@mapNotNull null
            val name = table.stringField("name") ?: return@mapNotNull null
            PreviewTable(name = name, rows = table.longField("rows") ?: 0L)
        }
    val metadata =
        (obj["metadata"] as? JsonObject).orEmptyObject().entries.map { (key, value) ->
            key to ((value as? JsonPrimitive)?.contentOrNull ?: value.toString())
        }
    return RestorePreview(
        tables = tables,
        metadata = metadata,
        checksumVerified = obj.boolField("checksum_verified") ?: false,
    )
}

// ── Derivations (web `useMemo`) ──────────────────────────────────────────────────────────────────────────────

/**
 * The four summary metrics from the configs + runs lists (web `stats` `useMemo`): total configs, total runs, the
 * latest completed run's timestamp (its `completed_at`, else `created_at`), and the cumulative run size.
 */
fun backupStats(
    configs: List<BackupConfig>,
    runs: List<BackupRun>,
): BackupStats {
    val lastCompleted = runs.firstOrNull { it.status == RUN_STATUS_COMPLETED }
    return BackupStats(
        totalConfigs = configs.size,
        totalBackups = runs.size,
        lastBackupAtMillis = lastCompleted?.let { it.completedAtMillis ?: it.createdAtMillis },
        totalSizeBytes = runs.sumOf { it.fileSize },
    )
}

/** The recent failed runs with a message, capped at five (web `failedRuns` `useMemo`). */
fun recentFailedRuns(runs: List<BackupRun>): List<BackupRun> =
    runs.filter { it.status == RUN_STATUS_FAILED && !it.errorMessage.isNullOrBlank() }.take(MAX_RECENT_FAILURES)

// ── Formatting (pure; the locale-aware relative-time formatting is a render concern the page owns) ───────────

private const val BYTES_PER_UNIT = 1024.0
private const val MILLIS_PER_SECOND = 1000L
private const val MILLIS_PER_MINUTE = 60_000L
private const val SECONDS_PER_MINUTE = 60L
private const val MINUTES_PER_HOUR = 60L

private val SIZE_UNITS = listOf("B", "KB", "MB", "GB", "TB", "PB")

/** Human byte size, 1024-based with up-to-two decimals (web `formatBytes`). */
fun formatBytes(bytes: Long): String {
    if (bytes <= 0L) return "0 ${SIZE_UNITS.first()}"
    var value = 1.0 * bytes
    var unit = 0
    while (value >= BYTES_PER_UNIT && unit < SIZE_UNITS.lastIndex) {
        value /= BYTES_PER_UNIT
        unit += 1
    }
    val pattern = if (unit == 0) "#,##0" else "#,##0.##"
    return "${groupedFormat(pattern).format(value)} ${SIZE_UNITS[unit]}"
}

/** Thousands-grouped integer (web `fmtInt`). */
fun formatCount(value: Long): String = groupedFormat("#,##0").format(value)

/** Thousands-grouped integer (web `fmtInt`). */
fun formatCount(value: Int): String = formatCount(value.toLong())

/** Compact duration from milliseconds (web `formatDurationMsCompact`); abbreviations are universal SI-style. */
fun formatDurationCompact(ms: Long): String {
    if (ms <= 0L) return "0s"
    if (ms < MILLIS_PER_SECOND) return "${ms}ms"
    val totalSeconds = ms / MILLIS_PER_SECOND
    if (totalSeconds < SECONDS_PER_MINUTE) {
        val seconds = 1.0 * ms / MILLIS_PER_SECOND
        return "${groupedFormat("0.#").format(seconds)}s"
    }
    val totalMinutes = ms / MILLIS_PER_MINUTE
    val hours = totalMinutes / MINUTES_PER_HOUR
    val minutes = totalMinutes % MINUTES_PER_HOUR
    val seconds = (ms % MILLIS_PER_MINUTE) / MILLIS_PER_SECOND
    return when {
        hours > 0L -> "${hours}h ${minutes}m"
        seconds > 0L -> "${minutes}m ${seconds}s"
        else -> "${minutes}m"
    }
}

private fun groupedFormat(pattern: String): java.text.DecimalFormat =
    java.text.DecimalFormat(pattern, java.text.DecimalFormatSymbols(java.util.Locale.US))

// ── JSON helpers (ported from the shared `safeArray` + primitive guards) ─────────────────────────────────────

private fun JsonElement?.asObjectArray(): List<JsonObject> =
    (this as? JsonArray)?.mapNotNull { it as? JsonObject } ?: emptyList()

private fun JsonArray?.orEmptyArray(): List<JsonElement> = this ?: emptyList()

private fun JsonObject?.orEmptyObject(): JsonObject = this ?: JsonObject(emptyMap())

private fun JsonObject.stringField(key: String): String? =
    (this[key] as? JsonPrimitive)?.takeIf { it !is JsonNull }?.contentOrNull

private fun JsonObject.longField(key: String): Long? = (this[key] as? JsonPrimitive)?.longOrNull

private fun JsonObject.intField(key: String): Int? = (this[key] as? JsonPrimitive)?.intOrNull

private fun JsonObject.boolField(key: String): Boolean? = (this[key] as? JsonPrimitive)?.booleanOrNull

private fun JsonObject.stringMapField(key: String): Map<String, String> =
    (this[key] as? JsonObject)?.entries
        ?.mapNotNull { (k, v) -> (v as? JsonPrimitive)?.contentOrNull?.let { k to it } }
        ?.toMap()
        ?: emptyMap()

/** Parses an ISO-8601 timestamp to epoch-ms (API 26+ `java.time`), tolerating both offset and `Z` forms. */
internal fun parseIsoMillis(iso: String): Long? =
    runCatching { OffsetDateTime.parse(iso).toInstant().toEpochMilli() }
        .recoverCatching { Instant.parse(iso).toEpochMilli() }
        .getOrNull()
