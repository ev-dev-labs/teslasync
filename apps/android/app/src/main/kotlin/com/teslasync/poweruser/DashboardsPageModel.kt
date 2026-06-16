// Pure, framework-free model + projections for the DashboardsPage power-user surface — the native analogue of
// everything the web page owns before it composes its panels (web/src/features/power-user/pages/DashboardsPage.tsx,
// the manual Grafana dashboard-JSON composer at /power/dashboards). No Compose, no Android UI, no HTTP: every
// declaration here is plain Kotlin, so the composable stays a thin render layer and all of this is exercised
// off-device by the :android:testDebugUnitTest gate.
//
// The web page owns these concerns this file ports: (1) the install-wide static curated-panel catalog
// ([CURATED_DASHBOARD_PANELS], the web `CURATED_DASHBOARD_PANELS` constant that mirrors the Go-side
// AINLDashboardComposerPanelEntry catalog — fetching it would add a round-trip with no useful dynamism); (2) the
// alphabetical catalog sort the web `useMemo(() => [...].sort(a.name.localeCompare(b.name)))` performs; and (3) the
// copy-to-clipboard outcome state machine the web `handleCopy` owns (empty guard → unavailable guard → success/fail),
// modelled as the pure [evaluateCopyStatus] over a [ClipboardTarget] seam so every branch is unit-testable.
//
// The panel name/description pairs are technical reference data (the `panel_name` identifiers must match the Go
// catalog verbatim), hardcoded as literals in the web source too — they are NOT i18n strings and are intentionally
// not in this surface's parity string set. Only the 13 chrome/editor/catalog labels resolve from the generated
// res/values catalog (ADR-014).
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/poweruser) diverges from
// the `io.teslasync.android.*` package the rest of the app uses, exactly as the sibling A7 pages do.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.poweruser.dashboards

import io.teslasync.shared.core.diagnostics.Logger

/**
 * Identity of the surface for the navigation registry + diagnostics (P1/S11) — the native mirror of the web
 * `DashboardsPage` route. [ROUTE_ID] matches the [io.teslasync.android.navigation.Destinations] entry
 * `page("powerDashboards", "/power/dashboards", …)`, so the host binds this surface to that destination (and its
 * `/power/dashboards` deep link) without the navigation module depending on it.
 */
object DashboardsPageRegistration {
    /** The navigation destination id (Destinations.kt `page("powerDashboards", "/power/dashboards", …)`). */
    const val ROUTE_ID: String = "powerDashboards"

    /** The web route this surface mirrors (deep-link target). */
    const val WEB_PATH: String = "/power/dashboards"

    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). Carries no draft content. */
    const val SLUG: String = "DashboardsPage"
}

/**
 * One entry in the install-wide curated panel catalog — the native mirror of the web `CuratedDashboardPanel`
 * (`{ name, description }`). [name] is the Grafana `panel_name` identifier (must match the Go catalog verbatim) and
 * [description] is its human-readable summary. Both are static reference data, hardcoded exactly like the web source.
 */
data class CuratedDashboardPanel(
    val name: String,
    val description: String,
)

/**
 * The curated catalog the surface exposes, verbatim from the web `CURATED_DASHBOARD_PANELS` constant. Static and
 * install-wide: the Helix natural-language composer refuses any `panel_name` outside this list, and each dashboard
 * may use each `panel_name` at most once.
 */
val CURATED_DASHBOARD_PANELS: List<CuratedDashboardPanel> =
    listOf(
        CuratedDashboardPanel(
            name = "drives_per_day_timeseries",
            description = "Timeseries panel: SUM(distance_m)/day from the drives table",
        ),
        CuratedDashboardPanel(
            name = "battery_soc_stat",
            description = "Stat panel: latest BatteryLevel sample from signal_log_view",
        ),
        CuratedDashboardPanel(
            name = "charging_sessions_table",
            description = "Table panel: recent rows from the charging_sessions table",
        ),
        CuratedDashboardPanel(
            name = "alerts_count_stat",
            description = "Stat panel: count of alerts fired in the last 7 days",
        ),
        CuratedDashboardPanel(
            name = "vehicles_table",
            description = "Table panel: vehicles metadata overview (id, model, color)",
        ),
        CuratedDashboardPanel(
            name = "energy_used_per_day_barchart",
            description = "Barchart panel: SUM(energy_used_wh)/day from the drives table",
        ),
    )

/** The catalog sorted by `panel_name` (web `useMemo(() => [...].sort((a, b) => a.name.localeCompare(b.name)))`). */
fun sortedCuratedPanels(): List<CuratedDashboardPanel> = CURATED_DASHBOARD_PANELS.sortedBy { it.name }

/**
 * The always-present "success" payload this surface renders — the static curated catalog. The page has no async data
 * source (the manifest declares the single `success` state), so this is immediately available content; the
 * interactive JSON draft + copy outcome are separate UI state owned by the view-model.
 */
data class DashboardsCatalog(
    val panels: List<CuratedDashboardPanel>,
) {
    companion object {
        /** The default catalog content: the curated panels, alphabetically sorted. */
        val DEFAULT: DashboardsCatalog = DashboardsCatalog(sortedCuratedPanels())
    }
}

/**
 * The outcome of a copy-to-clipboard attempt — the native mirror of the four mutually-exclusive status messages the
 * web `handleCopy` sets. [None] is the initial / cleared state (web empty `statusMessage`); the rest map 1:1 to the
 * `powerDashboards.editor.copy*` strings the render boundary resolves.
 */
enum class CopyStatus {
    /** No status to show (web `statusMessage === ''`). */
    None,

    /** The editor is empty/blank (web `copyEmpty`). */
    Empty,

    /** No clipboard access on this platform (web `copyUnavailable`). */
    Unavailable,

    /** The trimmed envelope was copied (web `copySuccess`). */
    Success,

    /** The clipboard write threw (web `copyFailed`). */
    Failed,
}

/**
 * The clipboard seam [evaluateCopyStatus] writes through so the outcome logic stays framework-free and unit-testable
 * (real `LocalClipboardManager`-backed impl at the Compose boundary ↔ a fake in tests). Mirrors the web `navigator.
 * clipboard` capability check + `writeText` call.
 */
interface ClipboardTarget {
    /** Whether clipboard access exists (web `typeof navigator !== 'undefined' && !!navigator.clipboard`). */
    val isAvailable: Boolean

    /** Writes [text] to the clipboard, returning `true` on success (web `await navigator.clipboard.writeText`). */
    fun write(text: String): Boolean
}

/**
 * The pure copy-to-clipboard state machine the web `handleCopy` owns, reproduced verbatim: trim the [rawDraft]; an
 * empty result is [CopyStatus.Empty] (no write); an unavailable [clipboard] is [CopyStatus.Unavailable]; otherwise
 * the trimmed envelope is written and the result is [CopyStatus.Success] or [CopyStatus.Failed]. Trimming matches the
 * web `dashboardJson.trim()` so the copied payload never carries leading/trailing whitespace.
 */
fun evaluateCopyStatus(
    rawDraft: String,
    clipboard: ClipboardTarget,
): CopyStatus {
    val trimmed = rawDraft.trim()
    return when {
        trimmed.isEmpty() -> CopyStatus.Empty
        !clipboard.isAvailable -> CopyStatus.Unavailable
        clipboard.write(trimmed) -> CopyStatus.Success
        else -> CopyStatus.Failed
    }
}

/**
 * Emits the one PII-safe `view.opened` diagnostic with the surface [DashboardsPageRegistration.SLUG] (P1/S11). Kept
 * free of Compose so it is unit-testable with a recording [Logger]; the page calls it from its first composition.
 * Carries no draft / dashboard JSON payload.
 */
fun recordDashboardsOpened(logger: Logger) {
    logger.info("view.opened", mapOf("surface" to DashboardsPageRegistration.SLUG))
}
