// Pure, framework-free model + projection for the DataExportPage system surface — the native analogue of
// everything the web page derives before it returns JSX (web/src/features/system/pages/DataExportPage.tsx, the
// data-export console). No Compose, no Android framework, no HTTP lives here: every type is exercised off-device,
// keeping the composable a thin render layer.
//
// It owns the client-side derivations the web component does inline: the stats row reductions (total exports,
// summed file size, the most-exported type, the most-recent export instant), the drives/charging data overview,
// the active-job count, the export-type → column-catalog mapping, the column-selector allowlist arithmetic
// (web `toggleColumn`/`handleClear`/`effectiveSelected`), and the two submit payload builders (wizard
// `/export/jobs` + account `/export/jobs/account`). File sizes are raw bytes and counts are integers — none are
// unit-bearing — so there is no SI conversion here; byte/relative-time formatting is applied at the render
// boundary (S5).
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory (com/teslasync/system —
// the P3 prompt's allowed-files path) cannot form the package the rest of the app's `io.teslasync.android.*`
// namespace uses, so the package intentionally diverges from the path — exactly as the sibling surfaces do.
// `MatchingDeclarationName` is suppressed for the co-located types.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.system.dataexport

import io.teslasync.shared.core.api.generated.Vehicle
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.presentation.exports.CreateAccountExportPayload
import io.teslasync.shared.core.presentation.exports.CreateExportPayload
import io.teslasync.shared.core.presentation.exports.ExportColumnsResponse
import io.teslasync.shared.core.presentation.exports.ExportJobSummary
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneOffset
import java.time.format.DateTimeFormatter

/** Em dash used as the universal "no value" marker, matching the web `'—'` fallback. */
internal const val EM_DASH: String = "\u2014"

/**
 * Canonical metadata for this surface: the navigation [ROUTE_ID] / [WEB_PATH] the host wires and the diagnostics
 * [SLUG] emitted with the one-shot `view.opened` event (P1/S11).
 */
object DataExportPageRegistration {
    /** The navigation destination id (Destinations.kt `page("dataExport", "/data-export", …)`). */
    const val ROUTE_ID: String = "dataExport"

    /** The web route this surface mirrors (deep-link target). */
    const val WEB_PATH: String = "/data-export"

    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). */
    const val SLUG: String = "DataExportPage"
}

/** The seven export-data domains the wizard can request (web `ExportType`). [wire] is the byte-exact API value. */
enum class ExportType(val wire: String) {
    Drives("drives"),
    Charging("charging"),
    Trips("trips"),
    Analytics("analytics"),
    FullBackup("full_backup"),
    Maintenance("maintenance"),
    Energy("energy"),
}

/** The two output encodings (web `ExportFormat`). [wire] is the byte-exact API value. */
enum class ExportFormat(val wire: String) {
    Csv("csv"),
    Json("json"),
}

/** Lifecycle of one export job (web `ExportStatus`). [Unknown] keeps decode lenient for an unrecognised value. */
enum class ExportStatus {
    Queued,
    Processing,
    Ready,
    Failed,
    Expired,
    Unknown,
    ;

    internal companion object {
        /** Maps the lenient server string to a status, falling back to [Unknown] (web default branch). */
        fun fromWire(value: String): ExportStatus =
            when (value.lowercase()) {
                "queued" -> Queued
                "processing" -> Processing
                "ready" -> Ready
                "failed" -> Failed
                "expired" -> Expired
                else -> Unknown
            }
    }
}

/** A relative date-range quick pick (web `DATE_PRESETS`). [days] `0` means "all time" (no range sent). */
enum class DatePreset(val days: Int) {
    Last7(7),
    Last30(30),
    Last90(90),
    LastYear(365),
    AllTime(0),
}

/**
 * The combined render-ready payload the surface binds to: the current [jobs] (drives the stats row + history +
 * overview) and the enrolled [vehicles] (drives the wizard + account vehicle selectors). [isEmpty] gates the
 * native Empty phase — the server returned no export jobs yet.
 */
data class DataExportData(
    val jobs: List<ExportJobSummary>,
    val vehicles: List<Vehicle>,
) {
    val isEmpty: Boolean get() = jobs.isEmpty()

    internal companion object {
        val EMPTY: DataExportData = DataExportData(emptyList(), emptyList())
    }
}

/** The four stat-row reductions (web `StatsRow`). [mostRecentCreatedAt] is a raw ISO instant for the boundary. */
data class ExportStats(
    val totalExports: Int,
    val totalSizeBytes: Long,
    val mostExportedType: String,
    val mostRecentCreatedAt: String?,
)

/** The drives / charging record-count rollup (web `DataOverview`). */
data class DataOverview(
    val drives: Long,
    val chargingSessions: Long,
)

/** Reduces the stat-row values from [jobs] (web `StatsRow` memos). Empty jobs collapse to zeros + em-dash. */
fun exportStats(jobs: List<ExportJobSummary>): ExportStats =
    ExportStats(
        totalExports = jobs.size,
        totalSizeBytes = jobs.sumOf { it.fileSize ?: 0L },
        mostExportedType = mostExportedType(jobs),
        mostRecentCreatedAt = mostRecentJob(jobs)?.createdAt?.takeIf { it.isNotBlank() },
    )

/** The most frequent job type with `_` rendered as a space (web `mostExportedType`), or em-dash when empty. */
fun mostExportedType(jobs: List<ExportJobSummary>): String {
    if (jobs.isEmpty()) return EM_DASH
    val counts = LinkedHashMap<String, Int>()
    for (job in jobs) {
        val key = job.type
        counts[key] = (counts[key] ?: 0) + 1
    }
    val top = counts.entries.maxByOrNull { it.value } ?: return EM_DASH
    return top.key.replace('_', ' ').ifBlank { EM_DASH }
}

/** The most recently created job (web `[...jobs].sort(byCreatedAtDesc)[0]`), or null when there are none. */
fun mostRecentJob(jobs: List<ExportJobSummary>): ExportJobSummary? = jobs.maxByOrNull { it.createdAt }

/** The drives / charging record-count rollup over [jobs] (web `dataOverview` memo). */
fun dataOverview(jobs: List<ExportJobSummary>): DataOverview {
    var drives = 0L
    var charging = 0L
    for (job in jobs) {
        val records = job.recordCount ?: 0L
        when (job.type) {
            ExportType.Drives.wire -> drives += records
            ExportType.Charging.wire -> charging += records
        }
    }
    return DataOverview(drives = drives, chargingSessions = charging)
}

/** Jobs still queued or processing (web `activeJobs`), surfaced as the "N Active" history badge. */
fun activeJobCount(jobs: List<ExportJobSummary>): Int =
    jobs.count {
        val status = ExportStatus.fromWire(it.status)
        status == ExportStatus.Queued || status == ExportStatus.Processing
    }

/** A vehicle's display label (web `display_name || vin`), falling back to the VIN then a numeric id. */
fun vehicleLabel(vehicle: Vehicle): String = vehicle.displayName.ifBlank { vehicle.vin.ifBlank { "Vehicle ${vehicle.id}" } }

// ── Column selector (web ColumnPickerSection) ───────────────────────────────────────────────────────────────

/**
 * Maps a wizard [ExportType] to its backend column-catalog identifier (web `catalogTypeFor`). Only `drives` and
 * `charging` publish a fixed catalog; every other type returns `""` so the picker short-circuits + hides.
 */
fun catalogTypeFor(type: ExportType): String =
    when (type) {
        ExportType.Drives -> "drives"
        ExportType.Charging -> "charging"
        else -> ""
    }

/** Whether the picker should render for this type + catalog (web: `supports_selection` and a non-empty catalog). */
fun supportsColumnPicker(
    catalogType: String,
    columns: ExportColumnsResponse?,
): Boolean = catalogType.isNotEmpty() && columns != null && columns.supportsSelection && columns.columns.isNotEmpty()

/** Every column name in catalog order (web `allColumnNames`). */
fun allColumnNames(columns: ExportColumnsResponse): List<String> = columns.columns.map { it.name }

/** The required (always-included) column names (web `requiredSet`). */
fun requiredColumnNames(columns: ExportColumnsResponse): Set<String> =
    columns.columns.filter { it.alwaysIncluded }.map { it.name }.toSet()

/** The effective selection driving the checkboxes: the explicit allowlist, or every column by default. */
fun effectiveSelectedColumns(
    selected: List<String>?,
    all: List<String>,
): List<String> = selected ?: all

/** Whether every column is selected (web `allSelected`) — disables the "Select all" affordance. */
fun isAllColumnsSelected(
    selected: List<String>?,
    all: List<String>,
): Boolean {
    val effective = effectiveSelectedColumns(selected, all).toSet()
    return effective.size == all.size && all.all { it in effective }
}

/**
 * Toggles [name] in the current selection, preserving catalog order, refusing to drop a required column, and
 * collapsing to `null` (the legacy "all selected") when every column is re-selected (web `toggleColumn`).
 */
fun toggleColumn(
    selected: List<String>?,
    all: List<String>,
    required: Set<String>,
    name: String,
): List<String>? {
    if (name in required) return selected
    val effective = effectiveSelectedColumns(selected, all).toMutableSet()
    if (name in effective) effective.remove(name) else effective.add(name)
    val ordered = all.filter { it in effective }
    return if (ordered.size == all.size) null else ordered
}

/**
 * The "Clear" action: leaves the required columns selected (the backend re-adds them anyway), collapsing to
 * `null` when every column happens to be required (web `handleClear`).
 */
fun clearedColumns(
    all: List<String>,
    required: Set<String>,
): List<String>? {
    val keep = all.filter { it in required }
    return if (keep.size == all.size) null else keep
}

// ── Submit payload builders (web handleSubmit / account handleStart) ─────────────────────────────────────────

private val ISO_DATE: DateTimeFormatter = DateTimeFormatter.ISO_LOCAL_DATE
private val ISO_INSTANT: DateTimeFormatter = DateTimeFormatter.ISO_INSTANT

/** Today's UTC date as `yyyy-MM-dd` (web `new Date().toISOString().split('T')[0]`). */
fun todayIso(nowMillis: Long): String = Instant.ofEpochMilli(nowMillis).atZone(ZoneOffset.UTC).toLocalDate().format(ISO_DATE)

/** The UTC date [days] before now as `yyyy-MM-dd` (web `daysAgo`). */
fun daysAgoIso(
    days: Int,
    nowMillis: Long,
): String =
    Instant
        .ofEpochMilli(nowMillis)
        .atZone(ZoneOffset.UTC)
        .toLocalDate()
        .minusDays(days.toLong())
        .format(ISO_DATE)

/** Promotes a `yyyy-MM-dd` picker value to a UTC ISO instant (web `new Date(date).toISOString()`); blank → null. */
fun dateToIsoInstant(date: String): String? {
    val trimmed = date.trim()
    if (trimmed.isEmpty()) return null
    return runCatching {
        LocalDate
            .parse(trimmed, ISO_DATE)
            .atStartOfDay(ZoneOffset.UTC)
            .toInstant()
            .let { ISO_INSTANT.format(it) }
    }.getOrNull()
}

/**
 * Builds the `POST /export/jobs` body from the wizard snapshot (web `handleSubmit`): a numeric vehicle id when
 * one is chosen, a date range from either the custom inputs or the active preset, and the explicit column
 * allowlist only when the user narrowed it.
 */
@Suppress("LongParameterList")
fun buildExportPayload(
    type: ExportType,
    format: ExportFormat,
    vehicleId: String,
    useCustomRange: Boolean,
    customStart: String,
    customEnd: String,
    presetDays: Int,
    selectedColumns: List<String>?,
    nowMillis: Long,
): CreateExportPayload {
    val vehicle = vehicleId.takeIf { it.isNotBlank() }?.toLongOrNull()
    var start: String? = null
    var end: String? = null
    if (useCustomRange && customStart.isNotBlank()) {
        start = customStart
        end = customEnd.ifBlank { todayIso(nowMillis) }
    } else if (presetDays > 0) {
        start = daysAgoIso(presetDays, nowMillis)
        end = todayIso(nowMillis)
    }
    val columns = selectedColumns?.takeIf { it.isNotEmpty() }
    return CreateExportPayload(
        type = type.wire,
        format = format.wire,
        vehicleId = vehicle,
        start = start,
        end = end,
        columns = columns,
    )
}

/**
 * Builds the `POST /export/jobs/account` body from the account-panel snapshot (web `handleStart`): a numeric
 * vehicle id unless "all" is selected, and the optional ISO date bounds.
 */
fun buildAccountPayload(
    vehicleId: String,
    startDate: String,
    endDate: String,
): CreateAccountExportPayload {
    val vehicle = if (vehicleId == ACCOUNT_ALL_VEHICLES) null else vehicleId.toLongOrNull()
    return CreateAccountExportPayload(
        vehicleId = vehicle,
        start = dateToIsoInstant(startDate),
        end = dateToIsoInstant(endDate),
    )
}

/** The sentinel "all vehicles" value for the account-panel selector (web `'all'`). */
const val ACCOUNT_ALL_VEHICLES: String = "all"

/** Emits the one PII-safe `view.opened` diagnostic with the surface slug (P1/S11); carries no export content. */
internal fun recordDataExportPageOpened(logger: Logger) {
    logger.info("view.opened", mapOf("surface" to DataExportPageRegistration.SLUG))
}
