// Pure, framework-free model + projection + diagnostics for the ChartExportMenu shared surface — the native
// analogue of every decision the web component makes (web/src/components/charts/ChartExportMenu.tsx) before it
// paints its overflow menu. No Compose, no Android, no HTTP: every declaration here is unit-tested off-device in
// the :android:testReleaseUnitTest gate, keeping the composable a thin render layer.
//
// What the web source is (and therefore the COMPLETE branch set this surface reproduces):
//   • A PURE PRESENTATIONAL menu. Its only hooks are `useTranslation` (mapped to the P1/S10 i18n catalog) and
//     `useOptionalToast` (the ambient toast controller, which the web menu calls and which returns null outside
//     a ToastProvider). The parent owns the capture/file-IO callbacks (`onExportPNG` / `onExportSVG` /
//     `onCopyImage` / optional `onExportCsv`) and the `disabled` / `busy` flags. So there is no data port to
//     bind (no P1/S8 state holder, no Source/ViewModel) — modelling one would invent a fetch the web spec does
//     not have (honesty covenant: no scope narrowing, no silent drift). The closest precedents are the equally
//     presentational AiLimitBanner and RouteAnnouncer surfaces (composable + model, no Source/ViewModel).
//   • A single download-icon trigger toggles an overflow menu. The menu lists — in order — an optional
//     "Download data as CSV" row (only when `onExportCsv` is supplied), then "Save as PNG", "Save as SVG", and
//     "Copy image to clipboard". The CSV row stays enabled even while a snapshot is in flight; the three image
//     rows are disabled while `busy` (they depend on the chart canvas). The trigger is disabled — and the menu
//     cannot open — while `disabled`. All of that ordering + enablement is reduced here in [chartExportMenuItems]
//     / [chartExportMenuOpen].
//   • The trigger's accessible label is the localized "Export chart" normally, or "Chart not ready to export"
//     while disabled (web `triggerLabel` ternary) — reduced here in [chartExportTriggerLabel].
//   • On copy the menu awaits a [ClipboardOutcome] and announces it through the ambient toast: `copied` →
//     success, `fallback` → info, `failed` → error (web `toast.success` / `toast.info` / `toast.error`). The
//     outcome → severity mapping is reduced here in [copyToastSeverity]; the view maps that severity onto the
//     shared toast Tone + the localized message and degrades gracefully when no toast sink is wired (mirroring
//     `useOptionalToast()` returning null).
//
// Why the generic data-surface states (loading / error / stale / offline) are intentionally absent: this
// surface fetches nothing — it is the title-bar export affordance for a chart whose data already loaded. Its
// real, fully-reproduced states are the closed trigger, the open menu (with/without the CSV row), the disabled
// trigger, the busy menu (image rows disabled), and the three copy-outcome announcements — each reduced here and
// asserted in the off-device test.
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/shared-surfaces/ChartExportMenu — the P3 prompt's allowed-files path) cannot form a valid
// Kotlin package (a hyphen and a PascalCase segment are illegal in a package identifier), so the package
// intentionally diverges from the path — exactly as the sibling shared surfaces do.
// `MatchingDeclarationName` is suppressed for the co-located supporting declarations.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.chartexportmenu

import io.teslasync.shared.core.diagnostics.Logger

/**
 * Diagnostics surface slug emitted with the `view.opened` event (P1/S11). A constant identifier carrying no
 * chart title, file name, or callback payload, so a diagnostics line can never leak what the operator exported.
 */
const val CHART_EXPORT_MENU_SLUG: String = "ChartExportMenu"

/**
 * The result of the clipboard copy the parent runs — the native mirror of the web `ClipboardOutcome`
 * (web/src/hooks/useChartExport.ts). Drives which toast the menu announces via [copyToastSeverity].
 */
enum class ClipboardOutcome {
    /** The image was written to the clipboard (web `'copied'` → success toast). */
    Copied,

    /** The clipboard image API was unavailable, so the image was downloaded instead (web `'fallback'` → info). */
    Fallback,

    /** The snapshot itself failed (web `'failed'` → error toast). */
    Failed,
}

/**
 * The toast severity a copy outcome announces — the native mirror of the web `toast.success` / `toast.info` /
 * `toast.error` calls. Kept separate from the shared UI `Tone` so this model stays free of the components layer;
 * the view maps each severity onto a `Tone` + the localized message.
 */
enum class CopyToastSeverity {
    /** A confirmation toast (web `toast.success`). */
    Success,

    /** An informational toast (web `toast.info`). */
    Info,

    /** An error toast (web `toast.error`). */
    Error,
}

/**
 * Map a [ClipboardOutcome] to the toast severity the menu announces — a 1:1 port of the web outcome switch
 * (`copied` → success, `fallback` → info, `failed` → error).
 */
fun copyToastSeverity(outcome: ClipboardOutcome): CopyToastSeverity =
    when (outcome) {
        ClipboardOutcome.Copied -> CopyToastSeverity.Success
        ClipboardOutcome.Fallback -> CopyToastSeverity.Info
        ClipboardOutcome.Failed -> CopyToastSeverity.Error
    }

/**
 * The export actions the overflow menu can offer — the native mirror of the web menu items. [Csv] is optional
 * (shown only when the parent supplies a CSV handler) and always enabled; the three image actions are disabled
 * while a snapshot is in flight.
 */
enum class ChartExportAction {
    /** "Download data as CSV" — optional first row; independent of the chart canvas, so never busy-disabled. */
    Csv,

    /** "Save as PNG" — rasterized snapshot of the chart. */
    Png,

    /** "Save as SVG" — vector snapshot of the chart. */
    Svg,

    /** "Copy image to clipboard" — clipboard write that resolves to a [ClipboardOutcome]. */
    Copy,
}

/**
 * One render-ready overflow-menu row: the [action] it triggers and whether it is currently [enabled] (a busy
 * snapshot disables the image rows; the CSV row stays enabled).
 */
data class ChartExportMenuItem(
    val action: ChartExportAction,
    val enabled: Boolean,
)

/**
 * Build the ordered overflow-menu rows for the current parent intent — a 1:1 port of the web menu composition.
 * When [hasCsv] the optional "Download data as CSV" row is prepended (web renders it first); the three image
 * rows always follow. While [busy] the image rows are disabled (web `disabled={busy}`) but the CSV row stays
 * enabled (web omits `busy` on the CSV item because CSV export does not depend on the chart canvas).
 */
fun chartExportMenuItems(
    hasCsv: Boolean,
    busy: Boolean,
): List<ChartExportMenuItem> =
    buildList {
        if (hasCsv) add(ChartExportMenuItem(ChartExportAction.Csv, enabled = true))
        add(ChartExportMenuItem(ChartExportAction.Png, enabled = !busy))
        add(ChartExportMenuItem(ChartExportAction.Svg, enabled = !busy))
        add(ChartExportMenuItem(ChartExportAction.Copy, enabled = !busy))
    }

/**
 * Whether the overflow menu may be expanded — a 1:1 port of the web `{open && !disabled && (...)}` guard. The
 * trigger toggles the requested-open intent, but a disabled menu can never open.
 */
fun chartExportMenuOpen(
    requestedOpen: Boolean,
    disabled: Boolean,
): Boolean = requestedOpen && !disabled

/**
 * The localized accessible label for the trigger — a 1:1 port of the web `triggerLabel` ternary: the
 * [disabledTooltip] ("Chart not ready to export") while [disabled], otherwise the [menuLabel] ("Export chart").
 * Pure so the label selection is asserted off-device; the view passes the catalog strings in.
 */
fun chartExportTriggerLabel(
    disabled: Boolean,
    menuLabel: String,
    disabledTooltip: String,
): String = if (disabled) disabledTooltip else menuLabel

/**
 * The one PII-safe diagnostic this surface emits (P1/S11). Carries only the surface [SLUG] — never a chart
 * title, file name, or copy outcome — so a diagnostics line can never leak what the operator exported.
 */
object ChartExportMenuDiagnostics {
    /** Diagnostics surface slug emitted with the `view.opened` event. */
    const val SLUG: String = CHART_EXPORT_MENU_SLUG

    private const val VIEW_OPENED = "view.opened"
    private const val SURFACE_KEY = "surface"

    /** Emits the `view.opened` diagnostic for this surface. Call from the composable's first-composition effect. */
    fun recordViewOpened(logger: Logger) {
        logger.info(VIEW_OPENED, mapOf(SURFACE_KEY to SLUG))
    }
}
