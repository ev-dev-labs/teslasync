// Pure, framework-free model + projections for the GrafanaPanelPage power-user surface — the native analogue of
// everything the web page owns before it composes its panels (web/src/features/power-user/pages/GrafanaPanelPage.tsx).
// No Compose, no Android framework, no HTTP: every declaration here is plain Kotlin (it references only the shared
// AINLGrafanaPanel draft model for the apply-to-editor projection), so the composable stays a thin render layer and
// the whole fold is asserted off-device in the :android:testDebugUnitTest gate.
//
// The web page renders no API data of its own (manifest: "no API data sources — renders from navigation args /
// local state"): the manual JSON editor is local state persisted to localStorage, and the three curated catalogs
// (panel types / datasource types / table catalog) are install-wide-static arrays duplicated from the Go-side
// nlGrafanaPanelCuratedPanelTypes / DatasourceTypes / Tables. This file ports those catalogs verbatim plus the
// page-local derivations (name sort, the apply-to-editor JSON.stringify, the copy-outcome status), so the screen
// only resolves i18n + draws.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/poweruser) diverges
// from the `io.teslasync.android.*` package the rest of the app uses, exactly as the sibling A7 pages do.
// `MatchingDeclarationName` is suppressed for the co-located registration + recorder + helpers.
@file:Suppress("InvalidPackageDeclaration", "MatchingDeclarationName")

package io.teslasync.android.poweruser.grafanapanel

import io.teslasync.android.sharedsurfaces.ainlgrafanapanel.GrafanaPanelEnvelope
import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.addJsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import kotlinx.serialization.json.putJsonArray
import kotlinx.serialization.json.putJsonObject

/**
 * Identity of the surface for the navigation registry + diagnostics (P1/S11) — the native mirror of the web
 * `GrafanaPanelPage` route. [ROUTE_ID] matches the [io.teslasync.android.navigation.Destinations] entry
 * `page("powerGrafana", "/power/grafana", …)`, so [io.teslasync.android.navigation.PageHosts] binds this surface
 * to that destination (and its `/power/grafana` deep link) without the nav module depending on it.
 */
object GrafanaPanelPageRegistration {
    /** The navigation destination id (Destinations.kt `page("powerGrafana", "/power/grafana", …)`). */
    const val ROUTE_ID: String = "powerGrafana"

    /** The web route this surface mirrors (deep-link target). */
    const val WEB_PATH: String = "/power/grafana"

    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). Carries no draft content. */
    const val SLUG: String = "GrafanaPanelPage"

    /** The canonical persistence key for the editor draft (web `GRAFANA_PANEL_DRAFT_KEY = 'ai.grafanaPanel.draft'`). */
    const val DRAFT_STORE_KEY: String = "ai.grafanaPanel.draft"

    /** The AI feature id gating the embedded Helix drafter (web `withAiFeature('nl-grafana-panel', …)`). */
    const val AI_FEATURE: String = "nl-grafana-panel"
}

// ── Curated catalog model — the native mirror of the web CuratedPanelType / CuratedDatasourceType / CuratedTable
//    shapes (web/src/features/power-user/pages/GrafanaPanelPage.tsx), themselves duplicated from the Go-side
//    AINLGrafanaPanel*Entry catalogs. The catalogs are install-wide-static, so they are constants here too. ──────

/** One curated panel type (web `CuratedPanelType`). */
data class CuratedPanelType(
    val name: String,
    val description: String,
)

/** One curated datasource type with its canonical UID (web `CuratedDatasourceType`). */
data class CuratedDatasourceType(
    val name: String,
    val uid: String,
    val description: String,
)

/** One curated table column (web `CuratedColumn`). */
data class CuratedColumn(
    val name: String,
    val type: String,
    val description: String,
)

/** One curated postgres-target table with its columns (web `CuratedTable`). */
data class CuratedTable(
    val name: String,
    val description: String,
    val columns: List<CuratedColumn>,
)

/** The curated panel types the catalog exposes (web `CURATED_PANEL_TYPES`). */
val CURATED_PANEL_TYPES: List<CuratedPanelType> =
    listOf(
        CuratedPanelType("timeseries", "time-series chart (default for any time-vs-value query)"),
        CuratedPanelType("stat", "single-value big-number stat panel (latest sample of one metric)"),
        CuratedPanelType("gauge", "single-value gauge with min/max bounds"),
        CuratedPanelType("table", "tabular result of an SQL/PromQL query"),
        CuratedPanelType("barchart", "categorical bar chart"),
        CuratedPanelType("heatmap", "two-dimensional heatmap (e.g. histograms over time)"),
        CuratedPanelType("piechart", "categorical pie chart"),
        CuratedPanelType("logs", "log-line stream (for text-shaped data)"),
    )

/** The curated datasource types the catalog exposes (web `CURATED_DATASOURCE_TYPES`). */
val CURATED_DATASOURCE_TYPES: List<CuratedDatasourceType> =
    listOf(
        CuratedDatasourceType(
            name = "postgres",
            uid = "tesla-postgres",
            description = "TimescaleDB postgres instance — for queries against the curated table catalog below",
        ),
        CuratedDatasourceType(
            name = "prometheus",
            uid = "tesla-prometheus",
            description = "Prometheus instance — for PromQL queries against TeslaSync's metrics endpoint",
        ),
    )

/** The curated postgres-target tables the catalog exposes (web `CURATED_TABLES`). */
val CURATED_TABLES: List<CuratedTable> =
    listOf(
        CuratedTable(
            name = "drives",
            description = "Per-trip aggregates for completed drives",
            columns =
                listOf(
                    CuratedColumn("id", "bigint", "primary key"),
                    CuratedColumn("vehicle_id", "bigint", "vehicle this drive belongs to"),
                    CuratedColumn("started_at", "timestamptz", "drive start UTC"),
                    CuratedColumn("ended_at", "timestamptz", "drive end UTC"),
                    CuratedColumn("distance_m", "double precision", "distance meters (SI)"),
                    CuratedColumn("duration_s", "double precision", "duration seconds (SI)"),
                    CuratedColumn("energy_used_wh", "double precision", "energy watt-hours (SI)"),
                    CuratedColumn("regen_wh", "double precision", "regen watt-hours"),
                    CuratedColumn("avg_speed_mps", "double precision", "avg speed m/s (SI)"),
                    CuratedColumn("max_speed_mps", "double precision", "max speed m/s"),
                ),
        ),
        CuratedTable(
            name = "charging_sessions",
            description = "Per-charge aggregates for completed charging sessions",
            columns =
                listOf(
                    CuratedColumn("id", "bigint", "primary key"),
                    CuratedColumn("vehicle_id", "bigint", "vehicle being charged"),
                    CuratedColumn("started_at", "timestamptz", "session start UTC"),
                    CuratedColumn("ended_at", "timestamptz", "session end UTC"),
                    CuratedColumn("energy_added_wh", "double precision", "energy added watt-hours (SI)"),
                    CuratedColumn("cost_cents", "bigint", "session cost in user-currency cents"),
                    CuratedColumn("charger_kind", "text", "home, supercharger, third_party"),
                    CuratedColumn("max_power_w", "double precision", "peak power watts"),
                ),
        ),
        CuratedTable(
            name = "vehicles",
            description = "Vehicle metadata",
            columns =
                listOf(
                    CuratedColumn("id", "bigint", "primary key"),
                    CuratedColumn("vin", "text", "Tesla VIN (PII)"),
                    CuratedColumn("display_name", "text", "user-chosen display name (PII)"),
                    CuratedColumn("model", "text", "model code"),
                    CuratedColumn("color", "text", "exterior color slug"),
                ),
        ),
        CuratedTable(
            name = "alerts",
            description = "User-defined alerts that have fired",
            columns =
                listOf(
                    CuratedColumn("id", "bigint", "primary key"),
                    CuratedColumn("vehicle_id", "bigint", "vehicle the alert fired for"),
                    CuratedColumn("alert_rule_id", "bigint", "alert rule that fired"),
                    CuratedColumn("fired_at", "timestamptz", "fire timestamp UTC"),
                    CuratedColumn("level", "text", "info, warn, critical"),
                ),
        ),
        CuratedTable(
            name = "signal_log_view",
            description = "Telemetry signal history exposed as a stable view",
            columns =
                listOf(
                    CuratedColumn("vehicle_id", "bigint", "vehicle the signal belongs to"),
                    CuratedColumn("signal_name", "text", "canonical signal name"),
                    CuratedColumn("ts", "timestamptz", "sample timestamp UTC"),
                    CuratedColumn("num_value", "double precision", "numeric value (SI), null if non-numeric"),
                    CuratedColumn("str_value", "text", "string value, null if numeric"),
                ),
        ),
    )

/** Web `sortedPanelTypes` — the catalog ordered by name (a.name.localeCompare(b.name)). */
val SORTED_PANEL_TYPES: List<CuratedPanelType> = CURATED_PANEL_TYPES.sortedBy { it.name }

/** Web `sortedDatasourceTypes` — the catalog ordered by name. */
val SORTED_DATASOURCE_TYPES: List<CuratedDatasourceType> = CURATED_DATASOURCE_TYPES.sortedBy { it.name }

/** Web `sortedTables` — the table catalog ordered by name (columns keep their declared order). */
val SORTED_TABLES: List<CuratedTable> = CURATED_TABLES.sortedBy { it.name }

/**
 * The copy-to-clipboard outcome the editor surfaces below the action row (web `statusMessage`). Modelled as a
 * closed set so the message text resolves from the string catalog at the render boundary (ADR-014) rather than
 * being held as a literal in state, and so every branch is exhaustively rendered.
 */
enum class GrafanaCopyStatus {
    /** Web `copyEmpty` — copy attempted with a blank editor. */
    Empty,

    /** Web `copyUnavailable` — the platform clipboard is not reachable. */
    Unavailable,

    /** Web `copySuccess` — the JSON was copied to the clipboard. */
    Success,

    /** Web `copyFailed` — the clipboard write threw. */
    Failed,
}

/**
 * The immutable surface state the [GrafanaPanelPageViewModel] exposes. The page has no API feed, so this is the
 * local editor draft (web `panelJson`) plus the most recent copy [status] (web `statusMessage`). The render
 * boundary always draws the deterministic editor + catalog content from this state — the single declared
 * "success" data state — so no region is ever blank (ADR-011).
 *
 * @property panelJson the manual editor contents (web `panelJson`), persisted across navigation.
 * @property status the last copy-to-clipboard outcome, or `null` before any copy attempt.
 */
data class GrafanaPanelUiState(
    val panelJson: String = "",
    val status: GrafanaCopyStatus? = null,
) {
    /** Web `canCopy = panelJson.trim().length > 0`: enables the Copy + Clear actions. */
    val canCopy: Boolean get() = panelJson.trim().isNotEmpty()
}

/**
 * The persistence seam for the editor draft — the native analogue of the web `loadPersistedJson` /
 * `persistJson` localStorage pair (key `ai.grafanaPanel.draft`). The view-model depends on this abstraction
 * (a SharedPreferences adapter in production, an in-memory fake in tests), never on the Android framework, so
 * the model + view-model stay framework-free and unit-tested off-device.
 */
interface GrafanaDraftStore {
    /** Load the persisted draft, or the empty string when nothing is stored (web `loadPersistedJson`). */
    fun load(): String

    /** Persist [value], or clear the entry when it is empty (web `persistJson`). */
    fun save(value: String)
}

private val PRETTY_JSON: Json =
    Json {
        prettyPrint = true
        prettyPrintIndent = "  "
    }

/**
 * Renders [panel] as the pretty-printed JSON envelope the user pastes into Grafana — the native port of the web
 * `JSON.stringify(draft.panel, null, 2)` the page runs when the Helix drafter's "Apply to editor" fires. The key
 * set + order (title, type, datasource, targets, grid_pos) and the snake_case wire names (`ref_id`, `raw_sql`,
 * `grid_pos`) match the web `GrafanaPanelEnvelope` exactly, so the produced document round-trips with
 * `parseGrafanaPanelDraft` and is Grafana-ready.
 */
fun prettyPrintPanelEnvelope(panel: GrafanaPanelEnvelope): String {
    val obj: JsonObject =
        buildJsonObject {
            put("title", panel.title)
            put("type", panel.type)
            putJsonObject("datasource") {
                put("type", panel.datasource.type)
                put("uid", panel.datasource.uid)
            }
            putJsonArray("targets") {
                panel.targets.forEach { target ->
                    addJsonObject {
                        put("ref_id", target.refId)
                        target.rawSql?.let { put("raw_sql", it) }
                        target.expr?.let { put("expr", it) }
                        target.format?.let { put("format", it) }
                    }
                }
            }
            putJsonObject("grid_pos") {
                put("x", panel.gridPos.x)
                put("y", panel.gridPos.y)
                put("w", panel.gridPos.w)
                put("h", panel.gridPos.h)
            }
        }
    return PRETTY_JSON.encodeToString(JsonObject.serializer(), obj)
}

/** Emits the one PII-safe `view.opened` diagnostic with the surface slug (P1/S11); carries no draft content. */
internal fun recordGrafanaPanelPageOpened(logger: Logger) {
    logger.info(EVENT_VIEW_OPENED, mapOf(FIELD_SURFACE to GrafanaPanelPageRegistration.SLUG))
}

private const val EVENT_VIEW_OPENED = "view.opened"
private const val FIELD_SURFACE = "surface"
