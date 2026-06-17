import SwiftUI

// MARK: - Parity string keys (web `t(key, default)` — Localizable.xcstrings)

/// Every visible literal the Trips list page resolves, centralized so the views and the parity tests
/// agree on the web key names (verbatim). Defaults ship in `Localizable.xcstrings`. The keys are
/// computed (not stored) properties because `LocalizedStringKey` is not `Sendable`; under the app's
/// Swift 6 `complete` strict-concurrency mode a stored `static let` of it would be a
/// non-concurrency-safe global. Computed accessors hold no shared state, so they are safe. The
/// count-interpolated keys are exposed as pure `static func` formatters that resolve through
/// `String(localized:)` / `String(format:)` so the integer argument is honored.
public enum TripListStrings {
    public static var title: LocalizedStringKey {
        "trips.title"
    }

    public static var subtitle: LocalizedStringKey {
        "trips.subtitle"
    }

    // MARK: Summary stat cards (web `MetricCard label`)
    // The shared `MetricCard` takes a resolved `String` label, so these resolve eagerly.

    public static var statsDistance: String {
        String(localized: "trips.stats.distance")
    }

    public static var statsEnergy: String {
        String(localized: "trips.stats.energy")
    }

    public static var statsCost: String {
        String(localized: "trips.stats.cost")
    }

    public static var statsTotal: String {
        String(localized: "trips.stats.total")
    }

    /// Distance card subtitle (web `t('trips.stats.tripCount', '{{count}} trips', { count })`).
    public static func statsTripCount(_ count: Int) -> String {
        String(format: String(localized: "trips.stats.tripCount"), count)
    }

    /// Energy card subtitle (web `t('trips.stats.driveCount', '{{count}} drives', { count })`).
    public static func statsDriveCount(_ count: Int) -> String {
        String(format: String(localized: "trips.stats.driveCount"), count)
    }

    /// Total-trips card subtitle (web `t('trips.stats.totalDrives', '{{count}} total drives')`).
    public static func statsTotalDrives(_ count: Int) -> String {
        String(format: String(localized: "trips.stats.totalDrives"), count)
    }

    // MARK: Top-trips chart (web `ChartContainer` + `BarChart`)

    public static var chartTitle: LocalizedStringKey {
        "trips.chart.title"
    }

    /// The chart's accessible name (web `ariaLabel`).
    public static var chartTitleAria: String {
        String(localized: "trips.chart.title.aria")
    }

    /// The bare "Distance" label (web `t('trips.chart.distance', 'Distance')`).
    public static var chartDistance: String {
        String(localized: "trips.chart.distance")
    }

    /// The unit-suffixed axis / series label (web `${t('trips.chart.distance')} (${unit})`).
    public static func chartDistance(unit: String) -> String {
        "\(chartDistance) (\(unit))"
    }

    public static var chartEmpty: LocalizedStringKey {
        "trips.chart.empty"
    }

    /// The fallback-table "Trip" column header (web `t('trips.chart.col.trip', 'Trip')`).
    public static var chartColTrip: String {
        String(localized: "trips.chart.col.trip")
    }

    // MARK: Export actions (web `Button` CSV / JSON)

    public static var exportCsv: LocalizedStringKey {
        "trips.export.csv"
    }

    public static var exportJson: LocalizedStringKey {
        "trips.export.json"
    }

    // MARK: Trip list (web `GlassPanel` "All Trips")

    public static var listHeading: LocalizedStringKey {
        "trips.list.heading"
    }

    public static var listEmpty: LocalizedStringKey {
        "trips.list.empty"
    }

    // MARK: Trip row (web `TripRow`)

    /// The auto-generated trip fallback label (web `${t('trips.row.trip', 'Trip')} #${id}`). Also
    /// used for the chart's per-bar name fallback (web `trip.name ?? \`Trip ${trip.id}\``).
    public static func tripFallback(id: Int64) -> String {
        "\(String(localized: "trips.row.trip")) #\(id)"
    }

    /// The drive-count line (web `t('trips.row.drives', '{{count}} drives', { count })`).
    public static func rowDrives(_ count: Int) -> String {
        String(format: String(localized: "trips.row.drives"), count)
    }

    /// The charge-count chip (web `t('trips.row.charges', '{{count}} charges', { count })`).
    public static func rowCharges(_ count: Int) -> String {
        String(format: String(localized: "trips.row.charges"), count)
    }

    public static var rowCost: LocalizedStringKey {
        "trips.row.cost"
    }

    // MARK: Parity coverage

    /// The 22 web key names, for the parity coverage test.
    public static let rawKeys: [String] = [
        "trips.chart.col.trip",
        "trips.chart.distance",
        "trips.chart.empty",
        "trips.chart.title",
        "trips.chart.title.aria",
        "trips.export.csv",
        "trips.export.json",
        "trips.list.empty",
        "trips.list.heading",
        "trips.row.charges",
        "trips.row.cost",
        "trips.row.drives",
        "trips.row.trip",
        "trips.stats.cost",
        "trips.stats.distance",
        "trips.stats.driveCount",
        "trips.stats.energy",
        "trips.stats.total",
        "trips.stats.totalDrives",
        "trips.stats.tripCount",
        "trips.subtitle",
        "trips.title"
    ]
}
