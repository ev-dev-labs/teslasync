// Pure, framework-free model + projection for the ExportModal modal/dialog surface — the native analogue of
// everything the web component derives before it returns JSX (web/src/features/dashboard/components/ExportModal.tsx).
// No Compose, no Android, no HTTP: every declaration here is exercised off-device by the
// :android:testReleaseUnitTest gate, so the composable (ExportModal.kt) stays a thin render layer over these
// pure functions.
//
// The web component is the dashboard-layout export sheet. It is a *controlled* dialog whose only data
// dependencies are `useTranslation` (i18n, P1/S10) and `useDateFormat` (the locale/tz formatter, P1/S10) — it
// binds NO fetch and owns NO store: the `dashboard: SavedDashboard` is handed in by the owning page. So (exactly
// like the sibling ConfirmDialog surface) the cache-then-network lifecycle (loading / empty-fetch / error /
// stale / offline) belongs to the OWNING surface that decides to raise the sheet, not here; modelling those
// phases would invent behaviour the web spec does not have (drift). The branches the web source actually
// defines are the complete state set this surface renders, and each is projected here:
//   1. the populated layout — the mini-grid preview tiles, the widget count + JSON size chips, the "Updated …"
//      line, and all three export actions enabled,
//   2. the empty layout (web `dashboard.widgets.length === 0`) — the count chip reads "0 widgets" and the
//      mini-grid has no tiles (the composable renders a friendly empty grid, never a blank box),
//   3. the share-URL-too-long branch (web `shareUrlTooLong = shareUrl.length > 2000`) — the "Copy Shareable URL"
//      action is disabled and the warning [ExportProjection.shareUrlLength] surfaces the `export.urlTooLong` banner.
//
// SI/units note: this surface carries no physical quantities — only a byte count (B/KB, a storage unit the web
// hardcodes the same way) and a layout-export blob — so there is no SI display-boundary conversion here.
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/modals-dialogs/ExportModal — the P3 prompt's allowed-files path) cannot form a valid Kotlin
// package (a hyphen and a PascalCase segment are illegal in a package identifier), so the package intentionally
// diverges from the path — exactly as the sibling modal surfaces do. `MatchingDeclarationName` is suppressed for
// the co-located supporting declarations.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.modalsdialogs.exportmodal

import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.serialization.Serializable
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import java.time.Instant
import java.time.LocalDateTime
import java.time.OffsetDateTime
import java.time.ZoneOffset
import java.util.Base64
import java.util.Locale

/**
 * A single placed widget on a saved dashboard — the native analogue of web `WidgetInstance` (`{ id, widgetId,
 * config? }`). [config] is an arbitrary settings object preserved verbatim through the minimal share export
 * (web spreads `...(config ? { config } : {})`); it is omitted from the JSON when absent.
 */
@Serializable
data class WidgetInstance(
    val id: String,
    val widgetId: String,
    val config: JsonObject? = null,
)

/**
 * A react-grid-layout position+size item — the native analogue of web `RGLLayout`. Only the five always-present
 * coordinates the preview + export need are modelled (`i, x, y, w, h`); the optional min/max hints the web type
 * also allows are absent after layout sanitization and are omitted from the export when unset.
 */
@Serializable
data class LayoutItem(
    val i: String,
    val x: Int = 0,
    val y: Int = 0,
    val w: Int = 1,
    val h: Int = 1,
)

/**
 * A saved dashboard layout — the native analogue of web `SavedDashboard`. [layouts] is keyed by breakpoint
 * string (`lg`/`md`/`sm`/`xs`) exactly as react-grid-layout keys them; the mini-grid preview reads the `lg`
 * breakpoint (web `dashboard.layouts.lg ?? []`).
 */
@Serializable
data class SavedDashboard(
    val id: String,
    val name: String,
    val widgets: List<WidgetInstance> = emptyList(),
    val layouts: Map<String, List<LayoutItem>> = emptyMap(),
    val createdAt: String = "",
    val updatedAt: String = "",
    val isDefault: Boolean = false,
)

/** One normalized preview tile — fractions in `[0,1]` of the mini-grid's width/height (web absolute %). */
data class MiniGridBox(
    val xFraction: Float,
    val yFraction: Float,
    val wFraction: Float,
    val hFraction: Float,
)

/**
 * The mini-grid preview geometry — the native analogue of the derivations web `MiniGridPreview` performs:
 * the container [aspectRatio] (`cols / safeMaxY`) and the per-widget [boxes]. An empty layout yields no boxes
 * and the default `4 / 2` aspect ratio (web `safeMaxY` fallback of 2).
 */
data class MiniGrid(
    val aspectRatio: Float,
    val boxes: List<MiniGridBox>,
)

/**
 * The fully-derived render inputs for the surface — the native analogue of the values the web component computes
 * with `useMemo` before returning JSX. Produced once by [ExportModalProjection.project] and consumed by the
 * composable; every field is a pure function of the input [SavedDashboard] (+ the share `origin`).
 *
 * @property dashboardJson the pretty-printed full-dashboard JSON copied by "Copy to Clipboard" (web `dashboardJson`).
 * @property jsonSize the human byte size of [dashboardJson] (web `jsonSize`: "B" under 1 KiB, else "X.X KB").
 * @property widgetCount the placed-widget count shown in the count chip (web `dashboard.widgets.length`).
 * @property updatedAt the parsed last-modified instant for the "Updated …" line, or null when unparseable.
 * @property updatedAtRaw the raw `updatedAt` string, the graceful fallback when [updatedAt] cannot be parsed.
 * @property shareUrl the deep link copied by "Copy Shareable URL" (web `shareUrl`).
 * @property shareUrlLength the share URL length, surfaced in the too-long warning (web `shareUrl.length`).
 * @property shareUrlTooLong whether the share URL exceeds the 2000-char ceiling (web `shareUrlTooLong`).
 * @property miniGrid the mini-grid preview geometry (web `MiniGridPreview` derivations).
 */
data class ExportProjection(
    val dashboardJson: String,
    val jsonSize: String,
    val widgetCount: Int,
    val updatedAt: Instant?,
    val updatedAtRaw: String,
    val shareUrl: String,
    val shareUrlLength: Int,
    val shareUrlTooLong: Boolean,
    val miniGrid: MiniGrid,
)

/**
 * Pure projection from a [SavedDashboard] to the surface's render decisions — a 1:1 port of the derivations the
 * web component performs inline (`JSON.stringify(dashboard, null, 2)`, the Blob byte-size formatter,
 * `buildMinimalExport`, `toUrlSafeBase64`, the `shareUrl` template, the `shareUrlTooLong` ceiling, and the
 * `MiniGridPreview` geometry). No Compose, no Android, no side effects.
 */
object ExportModalProjection {
    /** Grid columns at the `lg` breakpoint (web `GRID_COLS.lg`). */
    const val GRID_COLUMNS: Int = 4

    /** The share-URL length ceiling above which clipboard/file export is required (web `> 2000`). */
    const val MAX_SHARE_URL_LENGTH: Int = 2000

    /** The `safeMaxY` fallback when a layout is empty or degenerate (web `maxY` fallback of 2). */
    const val DEFAULT_GRID_ROWS: Int = 2

    private const val BYTES_PER_KIB: Int = 1024

    // The full-dashboard copy payload: pretty-printed with a 2-space indent (web `JSON.stringify(d, null, 2)`),
    // omitting absent (null) optional fields exactly as `JSON.stringify` skips `undefined`.
    private val prettyJson =
        Json {
            prettyPrint = true
            prettyPrintIndent = "  "
            explicitNulls = false
            encodeDefaults = true
        }

    // The compact minimal-export payload that backs the share URL (web `JSON.stringify(minimal)` — no indent).
    private val compactJson =
        Json {
            explicitNulls = false
            encodeDefaults = true
        }

    /** The trimmed share-export shape — name + widgets (id/widgetId/config) + layouts (web `buildMinimalExport`). */
    @Serializable
    private data class MinimalExport(
        val name: String,
        val widgets: List<MinimalWidget>,
        val layouts: Map<String, List<LayoutItem>>,
    )

    @Serializable
    private data class MinimalWidget(
        val id: String,
        val widgetId: String,
        val config: JsonObject? = null,
    )

    /** The full pretty-printed dashboard JSON copied to the clipboard (web `dashboardJson`). */
    fun dashboardJson(dashboard: SavedDashboard): String = prettyJson.encodeToString(dashboard)

    /**
     * Human byte size of [json] — under 1 KiB shown in whole bytes ("512 B"), otherwise in KiB to one decimal
     * ("1.2 KB"), matching the web `jsonSize` Blob-byte formatter. Sized over UTF-8 bytes (web `Blob` size), not
     * char count, and formatted with [Locale.US] so the decimal separator is a dot (web `.toFixed(1)`).
     */
    fun jsonSize(json: String): String {
        val bytes = json.toByteArray(Charsets.UTF_8).size
        if (bytes < BYTES_PER_KIB) return "$bytes B"
        val kib = 1.0 * bytes / BYTES_PER_KIB
        return String.format(Locale.US, "%.1f KB", kib)
    }

    /** The trimmed share payload JSON — name + widgets + layouts, no timestamps/ids (web `buildMinimalExport`). */
    fun buildMinimalExport(dashboard: SavedDashboard): String {
        val minimal =
            MinimalExport(
                name = dashboard.name,
                widgets = dashboard.widgets.map { MinimalWidget(it.id, it.widgetId, it.config) },
                layouts = dashboard.layouts,
            )
        return compactJson.encodeToString(minimal)
    }

    /**
     * URL-safe, unpadded base64 of [value]'s UTF-8 bytes — the native analogue of web `toUrlSafeBase64`
     * (base64 with `+`→`-`, `/`→`_`, trailing `=` stripped). Uses [Base64.getUrlEncoder] (JDK, API 26+), which
     * emits the `-`/`_` alphabet directly; `withoutPadding` drops the `=` tail.
     */
    fun toUrlSafeBase64(value: String): String =
        Base64
            .getUrlEncoder()
            .withoutPadding()
            .encodeToString(value.toByteArray(Charsets.UTF_8))

    /** The shareable deep link (web `${origin}/dashboard#import=${encoded}`). */
    fun shareUrl(
        origin: String,
        dashboard: SavedDashboard,
    ): String = "$origin/dashboard#import=" + toUrlSafeBase64(buildMinimalExport(dashboard))

    /** Whether [shareUrl] exceeds the share ceiling (web `shareUrl.length > 2000`). */
    fun isShareUrlTooLong(shareUrl: String): Boolean = shareUrl.length > MAX_SHARE_URL_LENGTH

    /**
     * The mini-grid preview geometry from a dashboard's `lg` layout (web `MiniGridPreview`). `maxY` is the tallest
     * `y + h` (web `Math.max`), falling back to [DEFAULT_GRID_ROWS] when the layout is empty; the aspect ratio is
     * `cols / safeMaxY` and each tile is normalized to fractions of the grid (web absolute `%` positioning).
     */
    fun miniGrid(dashboard: SavedDashboard): MiniGrid {
        val lgLayout = dashboard.layouts["lg"].orEmpty()
        val maxY = if (lgLayout.isEmpty()) DEFAULT_GRID_ROWS else lgLayout.maxOf { it.y + it.h }
        val safeMaxY = if (maxY > 0) maxY else DEFAULT_GRID_ROWS
        val boxes =
            lgLayout.map { item ->
                MiniGridBox(
                    xFraction = item.x.toFloat() / GRID_COLUMNS,
                    yFraction = item.y.toFloat() / safeMaxY,
                    wFraction = item.w.toFloat() / GRID_COLUMNS,
                    hFraction = item.h.toFloat() / safeMaxY,
                )
            }
        return MiniGrid(aspectRatio = GRID_COLUMNS.toFloat() / safeMaxY, boxes = boxes)
    }

    /**
     * Tolerantly parses an ISO-8601 last-modified string into an [Instant] (web `formatDate` accepts the same
     * RFC-3339 / offset / local forms), returning null for a blank or unparseable value so the composable can
     * fall back to the raw string. Mirrors the decode chain the sibling NotificationBellPopover surface uses.
     */
    fun parseUpdatedAt(raw: String): Instant? {
        if (raw.isBlank()) return null
        return runCatching { Instant.parse(raw) }
            .recoverCatching { OffsetDateTime.parse(raw).toInstant() }
            .recoverCatching { LocalDateTime.parse(raw).toInstant(ZoneOffset.UTC) }
            .getOrNull()
    }

    /**
     * Aggregates every render input for the surface from the [dashboard] and the share [origin] (the deployed web
     * app origin the deep link targets). The single entry point the composable calls; equivalent to the bundle of
     * `useMemo` derivations the web component performs on mount.
     */
    fun project(
        dashboard: SavedDashboard,
        origin: String,
    ): ExportProjection {
        val json = dashboardJson(dashboard)
        val url = shareUrl(origin, dashboard)
        return ExportProjection(
            dashboardJson = json,
            jsonSize = jsonSize(json),
            widgetCount = dashboard.widgets.size,
            updatedAt = parseUpdatedAt(dashboard.updatedAt),
            updatedAtRaw = dashboard.updatedAt,
            shareUrl = url,
            shareUrlLength = url.length,
            shareUrlTooLong = isShareUrlTooLong(url),
            miniGrid = miniGrid(dashboard),
        )
    }
}

/** Diagnostics + registry identifiers for the surface (P1/S11). */
object ExportModalRegistration {
    /** Stable surface id. */
    const val ID: String = "export-modal"

    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). */
    const val SLUG: String = "ExportModal"
}

/**
 * The one PII-safe diagnostic this surface emits (P1/S11). Carries only the surface
 * [ExportModalRegistration.SLUG] — never the dashboard name, its widgets, the export JSON, or the share URL — so a
 * diagnostics line can never leak what the user is exporting. Kept free of Compose so it is unit-tested with a
 * recording [Logger]; the composable calls it from its first-composition effect.
 */
object ExportModalDiagnostics {
    private const val VIEW_OPENED = "view.opened"
    private const val SURFACE_KEY = "surface"

    /** Emits the `view.opened` diagnostic for this surface. Call from the composable's first-composition effect. */
    fun recordViewOpened(logger: Logger) {
        logger.info(VIEW_OPENED, mapOf(SURFACE_KEY to ExportModalRegistration.SLUG))
    }
}
