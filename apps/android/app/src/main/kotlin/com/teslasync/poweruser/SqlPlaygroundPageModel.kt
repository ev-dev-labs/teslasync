// Pure, framework-free metadata + domain model for the SqlPlaygroundPage power-user surface — the native
// analogue of the cross-cutting concerns + static data the web page owns
// (web/src/features/power-user/pages/SqlPlaygroundPage.tsx, the manual SQL editor + curated schema catalog mounted
// at /power/sql). No Compose, no Android framework, no HTTP lives here, so the route identity, the curated catalog,
// and the Run-action reduction are all exercised off-device and the composable stays a thin render layer.
//
// The web page renders no API data of its own — it edits an in-memory query string against a static, install-wide
// curated catalog and surfaces a deterministic Run help message (there is no browser SQL-execution endpoint). This
// model therefore carries: the navigation identity ([SqlPlaygroundPageRegistration]) + the one PII-safe
// `view.opened` diagnostic, the [CuratedTable]/[CuratedColumn] descriptors (mirroring the web `CURATED_CATALOG`
// const verbatim — these are language-neutral schema identifiers/SQL types + technical descriptions the web itself
// hardcodes, not i18n keys), the [RunOutcome] reduction (web `handleRun`), and the immutable [SqlPlaygroundUiState]
// the ViewModel exposes.
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory (com/teslasync/poweruser —
// the P3 prompt's allowed-files path) cannot form the package the rest of the app's `io.teslasync.android.*`
// namespace uses, so the package intentionally diverges from the path — exactly as the sibling admin / notifications
// page surfaces do. `MatchingDeclarationName` is suppressed for the co-located registration + recorder + model.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.poweruser.sqlplayground

import io.teslasync.shared.core.diagnostics.Logger

/**
 * Canonical metadata for the SqlPlaygroundPage surface. The web page is a top-level power-user route, not a
 * draggable dashboard widget, so there is no web registry row to mirror — this object carries the cross-cutting
 * concerns the surface owes: the navigation [ROUTE_ID] / [WEB_PATH] the host wires (already a metadata-only
 * destination at Destinations.kt `page("powerSql", "/power/sql", …)`) and the diagnostics [SLUG] emitted with the
 * one-shot `view.opened` event (P1/S11). There is no feed metadata because the page renders no API data of its own.
 */
object SqlPlaygroundPageRegistration {
    /** The navigation destination id (Destinations.kt `page("powerSql", "/power/sql", NavGroup.PowerUser)`). */
    const val ROUTE_ID: String = "powerSql"

    /** The web route this surface mirrors (deep-link target). */
    const val WEB_PATH: String = "/power/sql"

    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). */
    const val SLUG: String = "SqlPlaygroundPage"
}

/** Emits the one PII-safe `view.opened` diagnostic with the surface slug (P1/S11); carries no query text. */
internal fun recordSqlPlaygroundPageOpened(logger: Logger) {
    logger.info(EVENT_VIEW_OPENED, mapOf(FIELD_SURFACE to SqlPlaygroundPageRegistration.SLUG))
}

private const val EVENT_VIEW_OPENED = "view.opened"
private const val FIELD_SURFACE = "surface"

/**
 * One curated column descriptor — the native mirror of the web `CuratedColumn` interface: the column [name], its
 * SQL [type], and a short human [description]. Schema identifiers + types are language-neutral; the web hardcodes
 * them (no i18n key), so this port mirrors them verbatim for parity.
 */
data class CuratedColumn(
    val name: String,
    val type: String,
    val description: String,
)

/**
 * One curated table descriptor — the native mirror of the web `CuratedTable` interface: the table [name], a short
 * [description], and its [columns]. The curated catalog is install-wide-static (it does not vary per
 * user/vehicle/tenant), so — exactly like the web component — it is a static structure rather than an API fetch.
 */
data class CuratedTable(
    val name: String,
    val description: String,
    val columns: List<CuratedColumn>,
)

/**
 * The curated schema catalog — a verbatim port of the web `CURATED_CATALOG` const (which itself mirrors the Go-side
 * `nlSqlPlaygroundCuratedCatalog`). Stored SI throughout (distance_m, duration_s, …_wh, …_mps, …_w), matching the
 * Phase-42 SI-on-disk contract. [sortedTables] is the by-name ordering the web `sortedTables` memo renders.
 */
object SqlPlaygroundCatalog {
    val tables: List<CuratedTable> =
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

    /** The by-name ordering the web `sortedTables` memo renders (locale-independent identifier sort). */
    val sortedTables: List<CuratedTable> = tables.sortedBy { it.name }
}

/**
 * The deterministic outcome of pressing Run — the native reduction of the web `handleRun` branch. The web page has
 * no browser SQL-execution endpoint, so Run never executes anything; it only surfaces a help message:
 *  - [None]        — no Run pressed yet (web `runMessage === ''`).
 *  - [Empty]       — Run pressed with a blank query (web `powerSql.editor.runEmpty`).
 *  - [Unavailable] — Run pressed with a non-blank query (web `powerSql.editor.runUnavailable`).
 *
 * The render boundary maps each non-[None] outcome to its i18n string, so every state renders a non-blank region.
 */
enum class RunOutcome { None, Empty, Unavailable }

/**
 * Reduces a Run press for [sql] into a [RunOutcome] (web `handleRun`: blank -> runEmpty help, otherwise
 * runUnavailable help). `isBlank()` matches the web `sql.trim()` emptiness test.
 */
fun runOutcomeFor(sql: String): RunOutcome = if (sql.isBlank()) RunOutcome.Empty else RunOutcome.Unavailable

/** Whether Run/Clear are enabled — the web `canRun = sql.trim().length > 0`. */
fun canRunSql(sql: String): Boolean = sql.isNotBlank()

/**
 * The immutable success surface the ViewModel exposes and the screen renders. The web page has a single data state
 * (success): it is always interactive against the static catalog, with no remote feed to load/empty/error.
 *
 * @param sql the in-memory query string (web `sql`); held in the ViewModel so it survives recomposition + config
 *   changes (the native analogue of the web localStorage `ai.sqlPlayground.draft` persistence).
 * @param runOutcome the latest Run reduction (web `runMessage`).
 * @param tables the by-name-sorted curated catalog the catalog panel renders (web `sortedTables`).
 */
data class SqlPlaygroundUiState(
    val sql: String = "",
    val runOutcome: RunOutcome = RunOutcome.None,
    val tables: List<CuratedTable> = SqlPlaygroundCatalog.sortedTables,
) {
    /** Whether the Run + Clear actions are enabled (web `canRun`). */
    val canRun: Boolean get() = canRunSql(sql)
}
