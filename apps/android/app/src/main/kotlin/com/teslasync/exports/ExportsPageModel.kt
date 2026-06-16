// Pure, framework-free model + projections for the ExportsPage system surface — the native analogue of
// everything the web page derives before composing its panels (web/src/features/exports/pages/ExportsPage.tsx).
// No Compose, no Android UI, no HTTP: every declaration here is plain Kotlin (it references only the shared-core
// ExportJobSummary DTO and the JDK time/format APIs), so the composable stays a thin render layer.
//
// The web page is a stale-list view: it loads `useExportJobs()`, derives the visible id set + the bulk-selection
// master tri-state, maps each job to a status Badge variant, and formats the file size + created timestamp at the
// render boundary (formatBytes / formatDateTime). This file ports those derivations verbatim so they are asserted
// off-device and the screen only resolves i18n + draws.
//
// No field here is unit-bearing (file sizes are raw bytes, timestamps are ISO strings), so there is no SI
// conversion at this layer — display formatting (bytes → KB/MB/GB, ISO → localized date-time) is the only
// transformation, exactly as the web page does inside formatBytes/formatDateTime (ADR-013 keeps payloads raw).
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/exports) diverges
// from the `io.teslasync.android.*` package the rest of the app uses, exactly as the sibling A7 pages do.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.exports.exports

import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.presentation.exports.ExportJobSummary
import java.time.Instant
import java.time.OffsetDateTime
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.time.format.FormatStyle
import java.util.Locale

/**
 * Identity of the surface for the navigation registry + diagnostics (P1/S11) — the native mirror of the web
 * `ExportsPage` route. [ROUTE_ID] matches the [io.teslasync.android.navigation.Destinations] entry
 * `page("exports", "/exports", …)`, so [io.teslasync.android.navigation.PageHosts] binds this surface to that
 * destination (and its `/exports` deep link) without the nav module depending on it.
 */
object ExportsPageRegistration {
    /** The navigation destination id (Destinations.kt `page("exports", "/exports", …)`). */
    const val ROUTE_ID: String = "exports"

    /** The web route this surface mirrors (deep-link target). */
    const val WEB_PATH: String = "/exports"

    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). Carries no job id. */
    const val SLUG: String = "ExportsPage"
}

/**
 * The semantic tone of an export job's status — the framework-free port of the web `statusVariant` switch
 * (`ready` → success, `failed` → danger, `processing`/`queued` → info, else neutral). Kept Compose-free so it is
 * unit-testable; the render layer maps it to the shared `Badge` variant.
 */
enum class ExportStatusTone { Success, Danger, Info, Neutral }

/**
 * The bulk-selection master checkbox tri-state — the framework-free port of the web `useBulkSelection`
 * `masterState(visibleIds)` (`'all'` / `'some'` / `'none'`). The render layer maps it to a Compose
 * `ToggleableState` for the select-all header.
 */
enum class MasterSelection { None, Some, All }

/**
 * Maps a job status to its [ExportStatusTone] — the verbatim port of the web `statusVariant(status)`:
 * `ready` is a success, `failed` a danger, `processing`/`queued` an in-flight info, anything else neutral.
 */
fun exportStatusTone(status: String): ExportStatusTone =
    when (status) {
        "ready" -> ExportStatusTone.Success
        "failed" -> ExportStatusTone.Danger
        "processing", "queued" -> ExportStatusTone.Info
        else -> ExportStatusTone.Neutral
    }

/**
 * The select-all master tri-state for [visibleIds] given the current [selectedIds] — the port of the web
 * `useBulkSelection.masterState`: every visible row selected ⇒ [MasterSelection.All]; at least one ⇒
 * [MasterSelection.Some]; none ⇒ [MasterSelection.None]. An empty visible set is [MasterSelection.None].
 */
fun masterSelection(
    selectedIds: Set<String>,
    visibleIds: List<String>,
): MasterSelection {
    if (visibleIds.isEmpty()) return MasterSelection.None
    val selectedVisible = visibleIds.count { it in selectedIds }
    return when (selectedVisible) {
        0 -> MasterSelection.None
        visibleIds.size -> MasterSelection.All
        else -> MasterSelection.Some
    }
}

/**
 * The next selection after toggling the master checkbox — the port of the web `toggleAll(visibleIds)`: if every
 * visible row is already selected they are all removed, otherwise every visible row is added (preserving any
 * selection outside the visible set). Mirrors the indeterminate→all→none cycle of the header checkbox.
 */
fun toggleAllSelection(
    selectedIds: Set<String>,
    visibleIds: List<String>,
): Set<String> =
    if (visibleIds.isNotEmpty() && visibleIds.all { it in selectedIds }) {
        selectedIds - visibleIds.toSet()
    } else {
        selectedIds + visibleIds
    }

/**
 * The em-dash fallback the web page renders for a null/absent file size or timestamp
 * (`j.file_size != null ? formatBytes(j.file_size) : '—'`). Centralised so every "no value" cell is identical.
 */
const val EXPORT_EMPTY_VALUE: String = "\u2014"

private const val BYTES_KB = 1024.0
private const val BYTES_MB = 1024.0 * 1024.0
private const val BYTES_GB = 1024.0 * 1024.0 * 1024.0

/**
 * Formats a raw byte count exactly as the web `formatBytes` helper (web/src/lib/numberFormat.ts): a null or
 * non-finite value is the em-dash, `< 1 KiB` is `"$bytes B"`, then one decimal place for KB / MB / GB. Kept
 * Locale-explicit so the decimal separator is deterministic in tests.
 */
fun formatExportBytes(bytes: Long?): String {
    if (bytes == null) return EXPORT_EMPTY_VALUE
    val b = bytes * 1.0
    if (b.isNaN() || b.isInfinite()) return EXPORT_EMPTY_VALUE
    return when {
        b < BYTES_KB -> "$bytes B"
        b < BYTES_MB -> "${oneDecimal(b / BYTES_KB)} KB"
        b < BYTES_GB -> "${oneDecimal(b / BYTES_MB)} MB"
        else -> "${oneDecimal(b / BYTES_GB)} GB"
    }
}

private fun oneDecimal(value: Double): String = String.format(Locale.US, "%.1f", value)

/**
 * Formats an ISO-8601 timestamp string as a localized "MMM d, yyyy, h:mm a"-style date-time — the port of the
 * web `formatDateTime` (Intl `toLocaleString` with short month + numeric day/year + 2-digit hour/minute). A
 * blank or unparseable value degrades to the em-dash (the web `isNaN(d.getTime())` guard). Parsing tolerates a
 * trailing `Z`/offset (instant) or a plain local date-time, in that order, so any server shape round-trips.
 */
fun formatExportDateTime(
    iso: String?,
    zone: ZoneId,
    locale: Locale,
): String {
    if (iso.isNullOrBlank()) return EXPORT_EMPTY_VALUE
    val instant =
        runCatching { Instant.parse(iso) }.getOrNull()
            ?: runCatching { OffsetDateTime.parse(iso).toInstant() }.getOrNull()
            ?: runCatching { java.time.LocalDateTime.parse(iso).atZone(zone).toInstant() }.getOrNull()
            ?: return EXPORT_EMPTY_VALUE
    val formatter =
        DateTimeFormatter
            .ofLocalizedDateTime(FormatStyle.MEDIUM, FormatStyle.SHORT)
            .withLocale(locale)
            .withZone(zone)
    return formatter.format(instant)
}

// ── Diagnostics (P1/S11) ──────────────────────────────────────────────────────────────────────────────────────

/**
 * Emits the one PII-safe `view.opened` diagnostic with the surface [ExportsPageRegistration.SLUG] (P1/S11).
 * Kept free of Compose so it is unit-testable with a recording [Logger]; the page calls it from its first
 * composition. Carries no job id, file name, or size.
 */
fun recordExportsPageOpened(logger: Logger) {
    logger.info("view.opened", mapOf("surface" to ExportsPageRegistration.SLUG))
}
