// Pure, framework-free model + projection for the GDPRExportPage admin surface — the native analogue of
// everything the web page derives before it returns JSX (web/src/features/admin/pages/GDPRExportPage.tsx, the
// GDPR export artifact inspector). No Compose, no Android framework, no HTTP lives here: every type is
// exercised off-device, keeping the composable a thin render layer.
//
// The single feed arrives as the typed [GDPRExportArtifact] the shared S8 OperatorConfidenceStore exposes
// (`GET /admin/gdpr/exports/{id}` ▸ gdprExport(id), web `useGDPRExport`). So this file owns the client-side
// derivations the web component does inline: the status → badge-tone map (web `STATUS_VARIANT`), the
// byte-size formatting (web `formatBytes`), the date/relative formatting (web `formatDateTime`/
// `formatRelative`), the queued/running poll predicate (web `refetchInterval`), the download-availability
// branch + the binary download URL (web `downloadUrl`). The only unit-bearing value is the byte count, which
// the backend already reports in bytes (SI); it is formatted at the display boundary, never converted.
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/admin — the P3 prompt's allowed-files path) cannot form the package the rest of the app's
// `io.teslasync.android.*` namespace uses, so the package intentionally diverges from the path — exactly as
// the sibling admin surfaces (apilogs/feedback) do. `MatchingDeclarationName` is suppressed for the
// co-located types.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.admin.gdpr

import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.presentation.operatorconfidence.GDPRExportArtifact
import java.net.URLEncoder
import java.time.Instant
import java.time.OffsetDateTime
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.time.format.FormatStyle
import java.util.Locale

/** Em dash used as the universal "no value" marker, matching the web `'—'` fallback. */
internal const val EM_DASH: String = "\u2014"

/**
 * Canonical metadata for this surface. The web page is a top-level admin route, not a draggable dashboard
 * widget, so there is no web registry row to mirror — this object carries the cross-cutting concerns the
 * surface owes: the navigation [ROUTE_ID] / [WEB_PATH] the host wires, the diagnostics [SLUG] emitted with
 * the one-shot `view.opened` event (P1/S11), and the [POLL_INTERVAL_MS] the web polls while the export is
 * still being produced (web `refetchInterval: INTERVALS.FAST`).
 */
object GDPRExportPageRegistration {
    /** The navigation destination id (Destinations.kt `page("adminGdprExports", "/admin/gdpr-exports", …)`). */
    const val ROUTE_ID: String = "adminGdprExports"

    /** The web route this surface mirrors (deep-link target). */
    const val WEB_PATH: String = "/admin/gdpr-exports"

    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). */
    const val SLUG: String = "GDPRExportPage"

    /** Re-poll cadence while the artifact is queued/running — the web `refetchInterval: INTERVALS.FAST` (10s). */
    const val POLL_INTERVAL_MS: Long = 10_000L
}

// Status tokens (web `GDPRArtifactStatus`). Carried as raw strings so an unexpected server token round-trips.
internal const val STATUS_QUEUED: String = "queued"
internal const val STATUS_RUNNING: String = "running"
internal const val STATUS_COMPLETE: String = "complete"
internal const val STATUS_FAILED: String = "failed"
internal const val STATUS_EXPIRED: String = "expired"

/** Semantic tone for the status badge, mapped to the design-system badge palette at the render boundary. */
enum class GdprStatusTone { Info, Success, Warning, Danger, Neutral }

/** Status → badge tone (web `STATUS_VARIANT`): queued/running info, complete success, failed danger, expired warning. */
fun statusTone(status: String): GdprStatusTone =
    when (status.lowercase(Locale.ROOT)) {
        STATUS_QUEUED, STATUS_RUNNING -> GdprStatusTone.Info
        STATUS_COMPLETE -> GdprStatusTone.Success
        STATUS_FAILED -> GdprStatusTone.Danger
        STATUS_EXPIRED -> GdprStatusTone.Warning
        else -> GdprStatusTone.Neutral
    }

/** Whether the artifact is still being produced — the web polls (`refetchInterval`) while queued/running. */
fun isPolling(status: String): Boolean =
    status.equals(STATUS_QUEUED, ignoreCase = true) || status.equals(STATUS_RUNNING, ignoreCase = true)

/** The Download-panel state (web download branch): the live button, or the wait/expired/failed caption. */
enum class DownloadAvailability { Available, Wait, Expired, Failed }

/**
 * Resolves the Download panel's state from the artifact status, mirroring the web:
 * complete ⇒ the bundle is downloadable; queued/running ⇒ "becomes available once complete"; expired ⇒
 * "no longer downloadable"; anything else (failed/unknown) ⇒ "no bundle available — see the error".
 */
fun downloadAvailability(artifact: GDPRExportArtifact): DownloadAvailability =
    when {
        artifact.status.equals(STATUS_COMPLETE, ignoreCase = true) -> DownloadAvailability.Available
        isPolling(artifact.status) -> DownloadAvailability.Wait
        artifact.status.equals(STATUS_EXPIRED, ignoreCase = true) -> DownloadAvailability.Expired
        else -> DownloadAvailability.Failed
    }

/**
 * The binary download URL for a completed artifact, or `null` when it is not downloadable. The web builds
 * `/api/v1/admin/gdpr/exports/{id}/download` client-side and lets the browser resolve it against the current
 * origin; Android has no ambient origin, so an absolute server-provided [GDPRExportArtifact.downloadUrl] is
 * preferred (it resolves in an Intent), falling back to the same relative path the web constructs.
 */
fun downloadUrl(artifact: GDPRExportArtifact): String? {
    if (!artifact.status.equals(STATUS_COMPLETE, ignoreCase = true)) return null
    val server = artifact.downloadUrl?.trim()
    if (!server.isNullOrEmpty()) return server
    return "/api/v1/admin/gdpr/exports/${encodePathSegment(artifact.id)}/download"
}

/** Percent-encodes one URL path segment the way the web `encodeURIComponent` does (space ⇒ %20, not +). */
private fun encodePathSegment(value: String): String =
    URLEncoder.encode(value, "UTF-8").replace("+", "%20")

// ---- Byte-size formatting (web `formatBytes`) ---------------------------------------------------------------

private const val BYTES_KB: Long = 1024L
private const val BYTES_MB: Long = BYTES_KB * 1024
private const val BYTES_GB: Long = BYTES_MB * 1024
private const val KB_DIVISOR: Double = 1024.0
private const val MB_DIVISOR: Double = 1024.0 * 1024.0
private const val GB_DIVISOR: Double = 1024.0 * 1024.0 * 1024.0

/**
 * Human-readable byte size (web `formatBytes`): `B` under 1 KiB, then KB/MB/GB to one decimal. A `null`
 * count yields the em-dash, mirroring the web `bytes != null ? formatBytes(bytes) : '—'`. Decimals use a
 * fixed `.` separator to match the web `toFixed(1)` verbatim (the count is a raw byte total, not a localized
 * metric).
 */
fun formatBytes(bytes: Long?): String {
    if (bytes == null) return EM_DASH
    return when {
        bytes < BYTES_KB -> "$bytes B"
        bytes < BYTES_MB -> "${oneDecimal(bytes / KB_DIVISOR)} KB"
        bytes < BYTES_GB -> "${oneDecimal(bytes / MB_DIVISOR)} MB"
        else -> "${oneDecimal(bytes / GB_DIVISOR)} GB"
    }
}

private fun oneDecimal(value: Double): String = String.format(Locale.US, "%.1f", value)

// ---- Date / relative formatting (web `formatDateTime` / `formatRelative`) -----------------------------------

/** Readable localized date-time (web `formatDateTime`), em-dash on a blank/unparseable stamp. */
fun formatDateTime(iso: String, locale: Locale): String {
    val instant = parseInstant(iso) ?: return EM_DASH
    return instant.atZone(ZoneId.systemDefault()).format(localizedDateTime(locale))
}

/**
 * Relative time (web `formatRelative`): `just now` / `Nm ago` / `Nh ago` / `Nd ago` for the first week, then
 * the absolute date. [nowMs] is the wall clock injected at the render boundary so this stays a pure function.
 */
fun formatRelative(iso: String, nowMs: Long, locale: Locale): String {
    val instant = parseInstant(iso) ?: return EM_DASH
    val seconds = (nowMs - instant.toEpochMilli()) / 1000
    return when {
        seconds < SECONDS_PER_MINUTE -> RELATIVE_JUST_NOW
        seconds < SECONDS_PER_HOUR -> "${seconds / SECONDS_PER_MINUTE}m ago"
        seconds < SECONDS_PER_DAY -> "${seconds / SECONDS_PER_HOUR}h ago"
        seconds < SECONDS_PER_WEEK -> "${seconds / SECONDS_PER_DAY}d ago"
        else -> instant.atZone(ZoneId.systemDefault()).format(localizedDate(locale))
    }
}

private fun parseInstant(iso: String): Instant? {
    if (iso.isBlank()) return null
    return runCatching { OffsetDateTime.parse(iso).toInstant() }
        .recoverCatching { Instant.parse(iso) }
        .getOrNull()
}

private fun localizedDateTime(locale: Locale): DateTimeFormatter =
    DateTimeFormatter.ofLocalizedDateTime(FormatStyle.MEDIUM, FormatStyle.SHORT).withLocale(locale)

private fun localizedDate(locale: Locale): DateTimeFormatter =
    DateTimeFormatter.ofLocalizedDate(FormatStyle.MEDIUM).withLocale(locale)

private const val RELATIVE_JUST_NOW: String = "just now"
private const val SECONDS_PER_MINUTE: Long = 60
private const val SECONDS_PER_HOUR: Long = 60 * 60
private const val SECONDS_PER_DAY: Long = 24 * 60 * 60
private const val SECONDS_PER_WEEK: Long = 7 * 24 * 60 * 60

// ---- Diagnostics --------------------------------------------------------------------------------------------

/** Emits the one PII-safe `view.opened` diagnostic with the surface slug (P1/S11); carries no artifact data. */
internal fun recordGdprExportPageOpened(logger: Logger) {
    logger.info("view.opened", mapOf("surface" to GDPRExportPageRegistration.SLUG))
}
