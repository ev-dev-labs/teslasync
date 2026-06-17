import Foundation

/// One curated dashboard panel descriptor — the native port of the web `CuratedDashboardPanel`
/// interface (`web/src/features/power-user/pages/DashboardsPage.tsx`). The `name` / `summary` are
/// the curated panel id and its English metadata, kept verbatim (the web page renders them
/// literally from the `CURATED_DASHBOARD_PANELS` constant, not through i18n), so the view voices
/// them with `Text(verbatim:)`. (`summary` rather than `description` follows the sibling
/// `SqlCatalogTable` house naming, avoiding the `CustomStringConvertible` footgun.)
public struct CuratedDashboardPanel: Identifiable, Hashable, Sendable {
    /// The curated panel id (web `name`) — also used as the deterministic catalog sort key.
    public let name: String
    /// The one-line panel description (web `description`).
    public let summary: String

    public var id: String {
        name
    }

    public init(name: String, summary: String) {
        self.name = name
        self.summary = summary
    }
}

/// The curated dashboard-panel catalog — the native mirror of the web `CURATED_DASHBOARD_PANELS`
/// constant (which itself mirrors the Go-side `AINLDashboardComposerPanelEntry` catalog in
/// `internal/api/ai_nl_dashboard_composer_handler.go`). Duplicated here, exactly as the web page
/// duplicates it, because the catalog is install-wide-static: fetching it would add a round-trip
/// with no useful dynamism. Every aggregate column referenced is SI-canonical on disk
/// (`distance_m` / `energy_used_wh`), per the Phase-42/48 SI canon.
public enum DashboardsPanelCatalog {
    /// The catalog panels in declaration order (web `CURATED_DASHBOARD_PANELS`).
    public static let panels: [CuratedDashboardPanel] = [
        CuratedDashboardPanel(
            name: "drives_per_day_timeseries",
            summary: "Timeseries panel: SUM(distance_m)/day from the drives table"
        ),
        CuratedDashboardPanel(
            name: "battery_soc_stat",
            summary: "Stat panel: latest BatteryLevel sample from signal_log_view"
        ),
        CuratedDashboardPanel(
            name: "charging_sessions_table",
            summary: "Table panel: recent rows from the charging_sessions table"
        ),
        CuratedDashboardPanel(
            name: "alerts_count_stat",
            summary: "Stat panel: count of alerts fired in the last 7 days"
        ),
        CuratedDashboardPanel(
            name: "vehicles_table",
            summary: "Table panel: vehicles metadata overview (id, model, color)"
        ),
        CuratedDashboardPanel(
            name: "energy_used_per_day_barchart",
            summary: "Barchart panel: SUM(energy_used_wh)/day from the drives table"
        )
    ]

    /// The catalog sorted by panel name, case-insensitive — the native parity of the web
    /// `sortedPanels` memo (`[...CURATED_DASHBOARD_PANELS].sort((a, b) => a.name.localeCompare(b.name))`).
    public static var sorted: [CuratedDashboardPanel] {
        panels.sorted { $0.name.localizedCaseInsensitiveCompare($1.name) == .orderedAscending }
    }
}
