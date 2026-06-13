// Pure, framework-free model + diagnostics for the ListExportMenu shared surface — the native analogue of every
// decision the web component makes (web/src/components/forms/ListExportMenu.tsx) before it paints its overflow
// menu. No Compose, no Android, no HTTP: every declaration here is unit-tested off-device in the
// :android:testReleaseUnitTest gate, keeping the composable a thin render layer.
//
// What the web source is (and therefore the COMPLETE branch set this surface reproduces):
//   • A PURE PRESENTATIONAL menu. Its only hook is `useTranslation` (mapped to the P1/S10 i18n catalog). The
//     parent owns the row-serialisation callbacks (`onExportCsv` / `onExportJson`, each receiving the chosen
//     [ExportScope]) and the `selectedCount` / `visibleCount` / `disabled` props. So there is no data port to
//     bind (no P1/S8 state holder, no Source/ViewModel) — modelling one would invent a fetch the web spec does
//     not have (honesty covenant: no scope narrowing, no silent drift). The closest precedent is the sibling
//     ChartExportMenu surface (composable + model, no Source/ViewModel), referenced by name in the web source.
//   • A single download trigger toggles an overflow menu. When `selectedCount > 0` a scope chooser appears first
//     — a "Visible (N)" radio + a "Selected (M)" radio — letting the user pick which rows the export covers;
//     when `selectedCount == 0` the chooser is omitted and every export covers the visible result set. Two
//     file-format rows always follow: "Download as CSV" then "Download as JSON". That ordering + visibility is
//     reduced here in [listExportShowScopeChooser] / [listExportFormats].
//   • The chosen scope initialises to `selected` when rows are selected, else `visible` (web `useState`
//     initialiser) — [listExportInitialScope]. If the selection later drops to zero while "Selected" is chosen,
//     the scope snaps back to "Visible" so the chosen scope can never be unselectable (web snap-back effect) —
//     [listExportResolvedScope].
//   • The trigger's accessible label is the localized "Export list" normally, or "No data to export" while
//     disabled (web `triggerLabel` ternary) — [listExportTriggerLabel]. The "Visible" row reads its count form
//     "Visible (N)" only when `visibleCount` is supplied, else the bare "Visible" (web `visibleLabel` ternary)
//     — [listExportVisibleUsesCount].
//   • The menu can open only when requested AND not disabled (web `{open && !disabled && (...)}`) —
//     [listExportMenuOpen].
//
// Why the generic data-surface states (loading / error / stale / offline) are intentionally absent: this surface
// fetches nothing — it is the list-controls export affordance for a table whose rows already loaded. Its real,
// fully-reproduced states are the ready trigger, the disabled trigger ("No data to export"), the open menu
// without a scope chooser (no selection), the open menu with the scope chooser (a selection), and the scope
// snap-back — each reduced here and asserted in the off-device test.
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/shared-surfaces/ListExportMenu — the P3 prompt's allowed-files path) cannot form a valid
// Kotlin package (a hyphen and a PascalCase segment are illegal in a package identifier), so the package
// intentionally diverges from the path — exactly as the sibling shared surfaces do.
// `MatchingDeclarationName` is suppressed for the co-located supporting declarations.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.listexportmenu

import io.teslasync.shared.core.diagnostics.Logger

/**
 * Diagnostics surface slug emitted with the `view.opened` event (P1/S11). A constant identifier carrying no row
 * data, file name, or callback payload, so a diagnostics line can never leak what the operator exported.
 */
const val LIST_EXPORT_MENU_SLUG: String = "ListExportMenu"

/**
 * Which rows an export covers — the native mirror of the web `ExportScope` union (`'visible' | 'selected'`).
 * Handed verbatim to the parent's `onExportCsv` / `onExportJson` callbacks so the caller serialises the right
 * row set.
 */
enum class ExportScope {
    /** Every visible (filtered) row — the always-available default (web `'visible'`). */
    Visible,

    /** Only the currently-selected rows — offered only while the selection is non-empty (web `'selected'`). */
    Selected,
}

/**
 * The two file formats the menu can export — the native mirror of the web menu's CSV / JSON rows. Always offered
 * in this order ([listExportFormats]); both hand the resolved [ExportScope] to their parent callback.
 */
enum class ListExportFormat {
    /** "Download as CSV" — the first file-format row (web `onExportCsv`). */
    Csv,

    /** "Download as JSON" — the second file-format row (web `onExportJson`). */
    Json,
}

/**
 * The scope the chooser starts on — a 1:1 port of the web `useState` initialiser
 * (`selectedCount > 0 ? 'selected' : 'visible'`): default to "Selected" when rows are selected (the likely
 * intent), otherwise "Visible". Pure so the initial selection is asserted off-device.
 */
fun listExportInitialScope(selectedCount: Int): ExportScope = if (selectedCount > 0) ExportScope.Selected else ExportScope.Visible

/**
 * The scope actually applied for a [requested] choice given the live [selectedCount] — a 1:1 port of the web
 * snap-back effect (`if (selectedCount === 0 && scope === 'selected') setScope('visible')`): once the selection
 * empties, "Selected" can no longer be the chosen scope, so it resolves to "Visible". For every other case the
 * requested scope passes through unchanged. Pure so the snap-back rule is asserted off-device.
 */
fun listExportResolvedScope(
    requested: ExportScope,
    selectedCount: Int,
): ExportScope = if (selectedCount == 0 && requested == ExportScope.Selected) ExportScope.Visible else requested

/**
 * Whether the overflow menu may be expanded — a 1:1 port of the web `{open && !disabled && (...)}` guard. The
 * trigger toggles the requested-open intent, but a disabled menu can never open.
 */
fun listExportMenuOpen(
    requestedOpen: Boolean,
    disabled: Boolean,
): Boolean = requestedOpen && !disabled

/**
 * Whether the scope chooser (the "Visible" / "Selected" radios) is shown — a 1:1 port of the web
 * `{selectedCount > 0 && (<fieldset/>)}` guard. With no selection the menu omits the chooser and every export
 * covers the visible result set.
 */
fun listExportShowScopeChooser(selectedCount: Int): Boolean = selectedCount > 0

/**
 * The localized accessible label for the trigger — a 1:1 port of the web `triggerLabel` ternary: the
 * [disabledTooltip] ("No data to export") while [disabled], otherwise the [menuLabel] ("Export list"). Pure so
 * the label selection is asserted off-device; the view passes the catalog strings in.
 */
fun listExportTriggerLabel(
    disabled: Boolean,
    menuLabel: String,
    disabledTooltip: String,
): String = if (disabled) disabledTooltip else menuLabel

/**
 * Whether the "Visible" row uses its count form "Visible (N)" rather than the bare "Visible" — a 1:1 port of the
 * web `visibleCount != null ? visibleWithCount : visible` ternary. Pure so the branch is asserted off-device;
 * the view supplies the count to the resource when this returns true.
 */
fun listExportVisibleUsesCount(visibleCount: Int?): Boolean = visibleCount != null

/**
 * The ordered file-format rows the menu always offers — CSV first, then JSON (web menu order). A function (not a
 * constant) so the list is fresh per call and trivially asserted off-device.
 */
fun listExportFormats(): List<ListExportFormat> = listOf(ListExportFormat.Csv, ListExportFormat.Json)

/**
 * The one PII-safe diagnostic this surface emits (P1/S11). Carries only the surface [SLUG] — never row data, a
 * file name, or the chosen scope — so a diagnostics line can never leak what the operator exported.
 */
object ListExportMenuDiagnostics {
    /** Diagnostics surface slug emitted with the `view.opened` event. */
    const val SLUG: String = LIST_EXPORT_MENU_SLUG

    private const val VIEW_OPENED = "view.opened"
    private const val SURFACE_KEY = "surface"

    /** Emits the `view.opened` diagnostic for this surface. Call from the composable's first-composition effect. */
    fun recordViewOpened(logger: Logger) {
        logger.info(VIEW_OPENED, mapOf(SURFACE_KEY to SLUG))
    }
}
