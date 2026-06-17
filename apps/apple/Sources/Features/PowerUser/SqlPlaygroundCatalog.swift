import Foundation

/// One column descriptor in the curated schema catalog — the native port of the web
/// `CuratedColumn` interface (`web/src/features/power-user/pages/SqlPlaygroundPage.tsx`). The
/// `name` / `type` / `detail` are SQL/schema identifiers and English metadata kept verbatim (the
/// web page renders them literally from the `CURATED_CATALOG` constant, not through i18n), so the
/// view voices them with `Text(verbatim:)`.
public struct SqlCatalogColumn: Identifiable, Hashable, Sendable {
    /// The column name (web `name`).
    public let name: String
    /// The SQL type (web `type`).
    public let type: String
    /// The one-line column description (web `description`).
    public let detail: String

    public var id: String {
        name
    }

    public init(name: String, type: String, detail: String) {
        self.name = name
        self.type = type
        self.detail = detail
    }
}

/// One table descriptor in the curated schema catalog — the native port of the web `CuratedTable`
/// interface. Like the web source it is an install-wide-static descriptor (it does not vary per
/// user / vehicle / tenant), so it is a compiled constant here rather than an API fetch; a future
/// dynamic catalog can swap `SqlPlaygroundCatalog.tables` for a hook response without churning the
/// page's render tree (the same rationale the web source documents).
public struct SqlCatalogTable: Identifiable, Hashable, Sendable {
    /// The table name (web `name`).
    public let name: String
    /// The one-line table description (web `description`).
    public let summary: String
    /// The table's columns (web `columns`).
    public let columns: [SqlCatalogColumn]

    public var id: String {
        name
    }

    public init(name: String, summary: String, columns: [SqlCatalogColumn]) {
        self.name = name
        self.summary = summary
        self.columns = columns
    }
}

/// The curated schema catalog — the native mirror of the web `CURATED_CATALOG` constant (which
/// itself mirrors the Go-side `nlSqlPlaygroundCuratedCatalog`). Duplicated here, exactly as the
/// web page duplicates it, because the catalog is install-wide-static: fetching it would add a
/// round-trip with no dynamism. Every distance/energy/speed column is SI on disk
/// (`distance_m` / `energy_used_wh` / `avg_speed_mps` …), per the Phase-42/48 SI canon.
public enum SqlPlaygroundCatalog {
    /// The catalog tables in declaration order (web `CURATED_CATALOG`).
    public static let tables: [SqlCatalogTable] = [
        SqlCatalogTable(
            name: "drives",
            summary: "Per-trip aggregates for completed drives",
            columns: [
                SqlCatalogColumn(name: "id", type: "bigint", detail: "primary key"),
                SqlCatalogColumn(name: "vehicle_id", type: "bigint", detail: "vehicle this drive belongs to"),
                SqlCatalogColumn(name: "started_at", type: "timestamptz", detail: "drive start UTC"),
                SqlCatalogColumn(name: "ended_at", type: "timestamptz", detail: "drive end UTC"),
                SqlCatalogColumn(name: "distance_m", type: "double precision", detail: "distance meters (SI)"),
                SqlCatalogColumn(name: "duration_s", type: "double precision", detail: "duration seconds (SI)"),
                SqlCatalogColumn(name: "energy_used_wh", type: "double precision", detail: "energy watt-hours (SI)"),
                SqlCatalogColumn(name: "regen_wh", type: "double precision", detail: "regen watt-hours"),
                SqlCatalogColumn(name: "avg_speed_mps", type: "double precision", detail: "avg speed m/s (SI)"),
                SqlCatalogColumn(name: "max_speed_mps", type: "double precision", detail: "max speed m/s")
            ]
        ),
        SqlCatalogTable(
            name: "charging_sessions",
            summary: "Per-charge aggregates for completed charging sessions",
            columns: [
                SqlCatalogColumn(name: "id", type: "bigint", detail: "primary key"),
                SqlCatalogColumn(name: "vehicle_id", type: "bigint", detail: "vehicle being charged"),
                SqlCatalogColumn(name: "started_at", type: "timestamptz", detail: "session start UTC"),
                SqlCatalogColumn(name: "ended_at", type: "timestamptz", detail: "session end UTC"),
                SqlCatalogColumn(
                    name: "energy_added_wh",
                    type: "double precision",
                    detail: "energy added watt-hours (SI)"
                ),
                SqlCatalogColumn(name: "cost_cents", type: "bigint", detail: "session cost in user-currency cents"),
                SqlCatalogColumn(name: "charger_kind", type: "text", detail: "home, supercharger, third_party"),
                SqlCatalogColumn(name: "max_power_w", type: "double precision", detail: "peak power watts")
            ]
        ),
        SqlCatalogTable(
            name: "vehicles",
            summary: "Vehicle metadata",
            columns: [
                SqlCatalogColumn(name: "id", type: "bigint", detail: "primary key"),
                SqlCatalogColumn(name: "vin", type: "text", detail: "Tesla VIN (PII)"),
                SqlCatalogColumn(name: "display_name", type: "text", detail: "user-chosen display name (PII)"),
                SqlCatalogColumn(name: "model", type: "text", detail: "model code"),
                SqlCatalogColumn(name: "color", type: "text", detail: "exterior color slug")
            ]
        ),
        SqlCatalogTable(
            name: "alerts",
            summary: "User-defined alerts that have fired",
            columns: [
                SqlCatalogColumn(name: "id", type: "bigint", detail: "primary key"),
                SqlCatalogColumn(name: "vehicle_id", type: "bigint", detail: "vehicle the alert fired for"),
                SqlCatalogColumn(name: "alert_rule_id", type: "bigint", detail: "alert rule that fired"),
                SqlCatalogColumn(name: "fired_at", type: "timestamptz", detail: "fire timestamp UTC"),
                SqlCatalogColumn(name: "level", type: "text", detail: "info, warn, critical")
            ]
        ),
        SqlCatalogTable(
            name: "signal_log_view",
            summary: "Telemetry signal history exposed as a stable view",
            columns: [
                SqlCatalogColumn(name: "vehicle_id", type: "bigint", detail: "vehicle the signal belongs to"),
                SqlCatalogColumn(name: "signal_name", type: "text", detail: "canonical signal name"),
                SqlCatalogColumn(name: "ts", type: "timestamptz", detail: "sample timestamp UTC"),
                SqlCatalogColumn(
                    name: "num_value",
                    type: "double precision",
                    detail: "numeric value (SI), null if non-numeric"
                ),
                SqlCatalogColumn(name: "str_value", type: "text", detail: "string value, null if numeric")
            ]
        )
    ]

    /// The catalog sorted by table name, case-insensitive — the native parity of the web
    /// `sortedTables` memo (`[...CURATED_CATALOG].sort((a, b) => a.name.localeCompare(b.name))`).
    public static var sorted: [SqlCatalogTable] {
        tables.sorted { $0.name.localizedCaseInsensitiveCompare($1.name) == .orderedAscending }
    }
}
