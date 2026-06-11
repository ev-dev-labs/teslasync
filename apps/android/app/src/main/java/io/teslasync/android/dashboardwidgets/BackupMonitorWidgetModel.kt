package io.teslasync.android.dashboardwidgets

import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.doubleOrNull
import kotlinx.serialization.json.longOrNull
import java.time.Instant
import java.time.OffsetDateTime
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.util.Locale
import kotlin.math.ln
import kotlin.math.pow
import kotlin.math.roundToLong

/*
 * Native, framework-free model + projection for the Backup Monitor dashboard surface — the Android
 * port of the data/`useMemo`/formatter logic in
 * web/src/features/dashboard/widgets/BackupMonitorWidget.tsx (and the C# port in
 * apps/windows/TeslaSync.App/dashboard-widgets/BackupMonitorWidget). Everything here is pure Kotlin
 * (no Compose, no Android) so the projection is exhaustively unit-tested off-device in the
 * `:android:testReleaseUnitTest` gate. The Compose layer ([BackupMonitorWidget]) resolves every
 * label through the i18n catalog and only renders this projected model.
 */

/** Semantic tone of a backup run — web `statusVariant` ≡ `statusDotColor` (3 buckets). */
enum class BackupStatusTone { Success, Warning, Danger }

/** The localized status label a run maps to — web `statusLabel` (4 buckets). Resolved via i18n at render. */
enum class BackupStatusText { Success, Running, Queued, Failed }

/** Em-dash fallback for an absent value (web `'—'`). A symbol, not English, so it needs no i18n key. */
internal const val EMPTY_VALUE = "\u2014"

/**
 * One database backup run from `GET /backup/runs` (web `useBackupRuns`, shape `BackupRun` in
 * web/src/api/types.ts). Only the fields the widget renders are projected; timestamps are kept as
 * raw wire strings (parsed on demand, web parity) and parsing is null-tolerant so a partial row
 * never throws.
 */
data class BackupRun(
    val id: Long,
    val status: String?,
    val backupType: String?,
    val fileSizeBytes: Double,
    val createdAt: String?,
    val completedAt: String?,
    val durationMs: Long?,
) {
    /** Completion instant in epoch millis, or `null` when absent/unparseable. */
    val completedAtMillis: Long? get() = parseTimestampMillis(completedAt)

    /** Creation instant in epoch millis, or `null` when absent/unparseable. */
    val createdAtMillis: Long? get() = parseTimestampMillis(createdAt)

    /** Instant used to order + timestamp the run (web `completedAt ?? createdAt`). */
    val sortMillis: Long? get() = completedAtMillis ?: createdAtMillis

    companion object {
        /** Project a single backup-run JSON object into a [BackupRun] (null-tolerant). */
        fun fromJson(obj: JsonObject): BackupRun =
            BackupRun(
                id = longField(obj, "id") ?: 0L,
                status = stringField(obj, "status"),
                backupType = stringField(obj, "backup_type"),
                fileSizeBytes = doubleField(obj, "file_size") ?: 0.0,
                createdAt = stringField(obj, "created_at"),
                completedAt = stringField(obj, "completed_at"),
                durationMs = longField(obj, "duration_ms"),
            )
    }
}

/**
 * The parsed backup-runs payload backing the widget — the list of [runs] from `GET /backup/runs`.
 * [hasData] distinguishes a fetched payload (even an empty one ⇒ the "no backup data" surface) from
 * the absent-body fallback used before the first emission.
 */
data class BackupMonitorSnapshot(
    val runs: List<BackupRun>,
    val hasData: Boolean = true,
) {
    /** True when at least one backup run is present (web `runs.length > 0`). */
    val hasRuns: Boolean get() = runs.isNotEmpty()

    companion object {
        /** The absent-body fallback (no payload yet). */
        val EMPTY: BackupMonitorSnapshot = BackupMonitorSnapshot(emptyList(), hasData = false)

        /** Project a backup-runs JSON array (web `data ?? []`) into a tolerant snapshot. */
        fun fromJson(element: JsonElement?): BackupMonitorSnapshot {
            val array = element as? JsonArray ?: return BackupMonitorSnapshot(emptyList())
            val runs = array.mapNotNull { item -> (item as? JsonObject)?.let(BackupRun::fromJson) }
            return BackupMonitorSnapshot(runs)
        }
    }
}

/**
 * The widget's grid footprint (columns × rows). Mirrors web `WidgetProps.size` plus the
 * `isCompact` / `isWide` branches: a single column shows the compact status line; two columns show
 * the 2×2 stat grid; four-plus columns add the newest-first "Recent Runs" feed.
 */
data class BackupMonitorSize(
    val cols: Int,
    val rows: Int,
) {
    /** True at a single column (web `isCompact = size.cols <= 1`). */
    val isCompact: Boolean get() = cols <= 1

    /** True at four-plus columns (web `isWide = size.cols >= 4`). */
    val isWide: Boolean get() = cols >= COLS_WIDE
}

/** Latest-run summary rendered by the compact line + the 2×2 stat grid (web `latestRun`). */
data class BackupLatest(
    val lastBackupValue: String,
    val sizeValue: String,
    val typeValue: String,
    val statusTone: BackupStatusTone,
    val statusText: BackupStatusText,
    val isFailed: Boolean,
)

/** One projected row of the wide "Recent Runs" feed (web `sortedRuns.slice(0, 5)`). */
data class BackupRunRow(
    val id: Long,
    val timeText: String,
    val subText: String,
    val statusTone: BackupStatusTone,
    val statusText: BackupStatusText,
)

/**
 * The fully projected, render-ready view — the native analogue of everything the web component
 * computes before returning JSX: the latest run's relative time / size / type / status and the
 * newest-first capped "Recent Runs" feed. Pure data so the projection is unit-tested directly.
 */
data class BackupMonitorDisplay(
    val hasRuns: Boolean,
    val latest: BackupLatest,
    val recentRuns: List<BackupRunRow>,
) {
    companion object {
        /** The all-default display used while loading / on a hard error (web `latestRun ?? defaults`). */
        val EMPTY: BackupMonitorDisplay =
            BackupMonitorDisplay(
                hasRuns = false,
                latest =
                    BackupLatest(
                        lastBackupValue = EMPTY_VALUE,
                        sizeValue = "0 B",
                        typeValue = EMPTY_VALUE,
                        statusTone = BackupStatusTone.Danger,
                        statusText = BackupStatusText.Failed,
                        isFailed = true,
                    ),
                recentRuns = emptyList(),
            )
    }
}

/**
 * Pure projection from a parsed [BackupMonitorSnapshot] to [BackupMonitorDisplay] — the native port
 * of the `sortedRuns`/`latestRun` work plus the `fmtBytes`, `fmtRelativeTime`, `statusVariant`,
 * `statusLabel` and `statusDotColor` helpers in the web source. `nowMillis` and `formatTimestamp`
 * are injected so the relative-time tiers and absolute row times are deterministic in tests.
 */
object BackupMonitorProjection {
    private const val STATUS_COMPLETED = "completed"
    private const val STATUS_RUNNING = "running"
    private const val STATUS_QUEUED = "queued"
    private const val STATUS_FAILED = "failed"

    /** Maximum rows in the wide "Recent Runs" feed (web `sortedRuns.slice(0, 5)`). */
    const val RECENT_RUNS_CAP = 5

    /** Order runs newest-first by completion-or-creation time (web `sortedRuns`). */
    fun sortedRuns(runs: List<BackupRun>): List<BackupRun> = runs.sortedByDescending { it.sortMillis ?: Long.MIN_VALUE }

    /** Map a wire status to its semantic tone (web `statusVariant`). */
    fun toneFor(status: String?): BackupStatusTone =
        when (status) {
            STATUS_COMPLETED -> BackupStatusTone.Success
            STATUS_RUNNING, STATUS_QUEUED -> BackupStatusTone.Warning
            else -> BackupStatusTone.Danger
        }

    /** Map a wire status to its localized label bucket (web `statusLabel`). */
    fun textFor(status: String?): BackupStatusText =
        when (status) {
            STATUS_COMPLETED -> BackupStatusText.Success
            STATUS_RUNNING -> BackupStatusText.Running
            STATUS_QUEUED -> BackupStatusText.Queued
            else -> BackupStatusText.Failed
        }

    /** Project [data] at [nowMillis], formatting absolute row times via [formatTimestamp]. */
    fun project(
        data: BackupMonitorSnapshot,
        nowMillis: Long,
        formatTimestamp: (Long) -> String = ::formatTimestampDefault,
    ): BackupMonitorDisplay {
        val sorted = sortedRuns(data.runs)
        val latestRun = sorted.firstOrNull()
        val latestStatusRaw = latestRun?.status ?: STATUS_FAILED

        val latest =
            BackupLatest(
                lastBackupValue = formatRelativeTime(latestRun?.sortMillis, nowMillis),
                sizeValue = formatBytes(latestRun?.fileSizeBytes ?: 0.0),
                typeValue = latestRun?.backupType?.takeIf { it.isNotEmpty() } ?: EMPTY_VALUE,
                statusTone = toneFor(latestRun?.status),
                statusText = textFor(latestRun?.status),
                isFailed = latestStatusRaw == STATUS_FAILED,
            )

        return BackupMonitorDisplay(
            hasRuns = sorted.isNotEmpty(),
            latest = latest,
            recentRuns = sorted.take(RECENT_RUNS_CAP).map { projectRow(it, formatTimestamp) },
        )
    }

    private fun projectRow(
        run: BackupRun,
        formatTimestamp: (Long) -> String,
    ): BackupRunRow {
        val timeText = run.sortMillis?.let(formatTimestamp) ?: EMPTY_VALUE
        val size = formatBytes(run.fileSizeBytes)
        val subText = run.durationMs?.let { "$size \u00B7 ${it}ms" } ?: size
        return BackupRunRow(
            id = run.id,
            timeText = timeText,
            subText = subText,
            statusTone = toneFor(run.status),
            statusText = textFor(run.status),
        )
    }
}

// ── Pure formatters (web `fmtBytes` / `fmtRelativeTime`) ─────────────────────────────────────────

private val BYTE_UNITS = listOf("B", "KB", "MB", "GB", "TB")
private const val BYTES_PER_STEP = 1024.0
private const val BYTE_DECIMAL_CUTOFF = 10.0
private const val MILLIS_PER_MINUTE = 60_000L
private const val MINUTES_PER_HOUR = 60L
private const val HOURS_PER_DAY = 24L
private const val COLS_WIDE = 4

private val ROW_TIMESTAMP_FORMAT: DateTimeFormatter = DateTimeFormatter.ofPattern("MMM d, HH:mm", Locale.US)

/**
 * Format a byte count exactly as the web `fmtBytes` helper does: "0 B" for non-positive input;
 * otherwise the largest fitting unit (B/KB/MB/GB/TB) with one decimal below 10 (e.g. "1.5 GB") and a
 * rounded integer at or above 10 (e.g. "450 MB"). [Locale.US] keeps it locale-independent like
 * `toFixed`/`Math.round`.
 */
fun formatBytes(bytes: Double): String {
    if (bytes.isNaN() || bytes <= 0.0) return "0 B"
    val exponent = (ln(bytes) / ln(BYTES_PER_STEP)).toInt().coerceIn(0, BYTE_UNITS.lastIndex)
    val value = bytes / BYTES_PER_STEP.pow(exponent)
    val num =
        if (value < BYTE_DECIMAL_CUTOFF) {
            String.format(Locale.US, "%.1f", value)
        } else {
            value.roundToLong().toString()
        }
    return "$num ${BYTE_UNITS[exponent]}"
}

/**
 * Format an instant as relative time exactly as the web `fmtRelativeTime` helper does: the em-dash
 * for a null value, "just now" for the present (or a future instant), then "{m}m ago" (under an
 * hour), "{h}h ago" (under a day) and "{d}d ago". Deterministic against [nowMillis].
 */
fun formatRelativeTime(
    instantMillis: Long?,
    nowMillis: Long,
): String {
    if (instantMillis == null) return EMPTY_VALUE
    val mins = (nowMillis - instantMillis) / MILLIS_PER_MINUTE
    val hrs = mins / MINUTES_PER_HOUR
    val days = hrs / HOURS_PER_DAY
    return when {
        // A zero/negative delta (present or a future instant) reads as "just now" (web `fmtRelativeTime`).
        mins < 1L -> "just now"
        mins < MINUTES_PER_HOUR -> "${mins}m ago"
        hrs < HOURS_PER_DAY -> "${hrs}h ago"
        else -> "${days}d ago"
    }
}

/** Tolerant RFC3339/ISO-8601 → epoch-millis parse (Go serializes timestamps as RFC3339). */
internal fun parseTimestampMillis(raw: String?): Long? {
    if (raw.isNullOrBlank()) return null
    return runCatching { OffsetDateTime.parse(raw).toInstant().toEpochMilli() }
        .recoverCatching { Instant.parse(raw).toEpochMilli() }
        .getOrNull()
}

/** Default absolute row-time formatter (UTC) used by tests / before the locale formatter is wired. */
internal fun formatTimestampDefault(millis: Long): String =
    ROW_TIMESTAMP_FORMAT.format(OffsetDateTime.ofInstant(Instant.ofEpochMilli(millis), ZoneId.of("UTC")))

// ── Tolerant JSON field readers (web defensive `?? 0` / `?? null`) ───────────────────────────────

private fun stringField(
    obj: JsonObject,
    name: String,
): String? {
    val primitive = obj[name] as? JsonPrimitive ?: return null
    return if (primitive.isString) primitive.contentOrNull else null
}

private fun longField(
    obj: JsonObject,
    name: String,
): Long? = (obj[name] as? JsonPrimitive)?.longOrNull

private fun doubleField(
    obj: JsonObject,
    name: String,
): Double? = (obj[name] as? JsonPrimitive)?.doubleOrNull
