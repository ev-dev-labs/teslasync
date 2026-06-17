import Foundation
import Observation

// MARK: - Page model (web `useTrips` + summary memos + export handlers)

/// The `@Observable` state holder the page binds to (ADR-004 — no networking in the view). Owns the
/// trip list (web `useTrips({ vehicle_id, limit, offset, start, end })`), derives the four summary
/// aggregates (web `totalDist` / `totalEnergy` / `totalCost` / `totalDrives`), the top-ten-by-distance
/// chart slice (web `chartData`), and serializes the CSV / JSON exports (web `handleExportCSV` /
/// `handleExportJSON`). Every aggregate stays SI; unit + currency conversion happens at the SwiftUI
/// render boundary via `Units` / `TripListFormat`.
@MainActor
@Observable
public final class TripListPageModel {
    /// The fetch parameters (web `UseTripParams`).
    public let query: TripListQuery
    /// The user's currency symbol (web `useFormatting().currencySymbol`).
    public let currencySymbol: String
    /// The user's locale for number grouping (web global formatter locale).
    public let locale: Locale

    public private(set) var state: TripListState = .loading
    /// Whether a background refetch is in flight while content already shows (web refetch).
    public private(set) var isRefreshing = false
    public private(set) var trips: [TripListItem] = []

    @ObservationIgnored private let dataSource: any TripListDataSource

    /// The number of top trips the bar chart plots (web `chartData` `.slice(0, 10)`).
    static let chartLimit = 10

    public init(
        query: TripListQuery = TripListQuery(),
        currencySymbol: String = CurrencyMeta.defaultCurrencySymbol,
        locale: Locale = .autoupdatingCurrent,
        dataSource: any TripListDataSource = SampleTripListDataSource()
    ) {
        self.query = query
        self.currencySymbol = currencySymbol
        self.locale = locale
        self.dataSource = dataSource
    }

    // MARK: Derived (web memos)

    /// Whether the fetch yielded any trips (web `allTrips.length > 0`).
    public var hasTrips: Bool { !trips.isEmpty }

    /// The number of trips on the page (web `allTrips.length`).
    public var tripCount: Int { trips.count }

    /// Sum of SI distances (web `totalDist`).
    public var totalDistanceM: Double { trips.reduce(0) { $0 + $1.totalDistanceM } }

    /// Sum of SI energy (web `totalEnergy`).
    public var totalEnergyWh: Double { trips.reduce(0) { $0 + $1.totalEnergyWh } }

    /// Sum of trip cost in the user's currency (web `totalCost`).
    public var totalCost: Double { trips.reduce(0) { $0 + $1.totalCost } }

    /// Sum of drive counts (web `totalDrives`).
    public var totalDrives: Int { trips.reduce(0) { $0 + $1.driveCount } }

    /// The top trips by SI distance, descending, capped at ten (web `chartData` sort + slice). Kept SI
    /// so the chart view converts to the user's distance unit at the render boundary.
    public var topTripsByDistance: [TripListItem] {
        Array(trips.sorted { $0.totalDistanceM > $1.totalDistanceM }.prefix(Self.chartLimit))
    }

    /// Whether the chart has anything to plot (web `chartData.length > 0`).
    public var hasChartData: Bool { !topTripsByDistance.isEmpty }

    // MARK: Loading

    /// Loads the trips (web `useTrips`). A failure surfaces the retryable error region.
    public func load() async {
        state = .loading
        await fetch()
    }

    /// Re-runs the load while keeping current content visible (web refetch / pull-to-refresh).
    public func refresh() async {
        isRefreshing = true
        await fetch()
        isRefreshing = false
    }

    private func fetch() async {
        do {
            trips = try await dataSource.loadTrips(query: query)
            state = .ready
        } catch {
            state = .error(error.localizedDescription)
        }
    }

    // MARK: Export (web `handleExportCSV` / `handleExportJSON`)

    /// The CSV export (web `handleExportCSV`): the id / name / dates / SI distance + energy / cost /
    /// counts columns, header row first, RFC-4180-quoted. Raw SI is exported (web exports
    /// `distance_m` / `energy_wh`), so the file is unit-neutral.
    public var csvContent: String {
        let header = ["id", "name", "start_date", "end_date", "distance_m", "energy_wh", "cost", "drives", "charges"]
        var lines = [header.joined(separator: ",")]
        for trip in trips {
            let cells = [
                String(trip.id),
                trip.name ?? TripListStrings.tripFallback(id: trip.id),
                Self.iso(trip.startDate),
                trip.endDate.map(Self.iso) ?? "",
                Self.csvNumber(trip.totalDistanceM),
                Self.csvNumber(trip.totalEnergyWh),
                Self.csvNumber(trip.totalCost),
                String(trip.driveCount),
                String(trip.chargeCount)
            ]
            lines.append(cells.map(Self.csvEscape).joined(separator: ","))
        }
        return lines.joined(separator: "\n")
    }

    /// The JSON export (web `exportAsJSON(allTrips)`): the trips serialized as a snake_case array
    /// matching the web `Trip` shape, with SI fields preserved verbatim.
    public var jsonContent: String {
        let dtos = trips.map(TripExportDTO.init)
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys, .withoutEscapingSlashes]
        encoder.dateEncodingStrategy = .iso8601
        guard let data = try? encoder.encode(dtos), let text = String(data: data, encoding: .utf8) else {
            return "[]"
        }
        return text
    }

    private static func iso(_ date: Date) -> String {
        date.ISO8601Format()
    }

    private static func csvNumber(_ value: Double) -> String {
        String(format: "%g", value)
    }

    private static func csvEscape(_ field: String) -> String {
        guard field.contains(",") || field.contains("\"") || field.contains("\n") else { return field }
        return "\"\(field.replacingOccurrences(of: "\"", with: "\"\""))\""
    }
}

// MARK: - Export DTO (web `Trip` JSON shape)

/// The snake_case projection serialized by the JSON export — the native peer of the web `Trip` JSON
/// the page hands to `exportAsJSON`. SI fields are emitted verbatim (metres, watt-hours, seconds);
/// the camelCase Swift properties map to the web snake_case keys via `CodingKeys`.
private struct TripExportDTO: Encodable {
    let id: Int64
    let vehicleID: Int64
    let name: String?
    let startDate: Date
    let endDate: Date?
    let totalDistanceM: Double
    let totalEnergyWh: Double
    let totalDurationS: Double
    let totalCost: Double
    let driveCount: Int
    let chargeCount: Int

    enum CodingKeys: String, CodingKey {
        case id
        case vehicleID = "vehicle_id"
        case name
        case startDate = "start_date"
        case endDate = "end_date"
        case totalDistanceM = "total_distance_m"
        case totalEnergyWh = "total_energy_wh"
        case totalDurationS = "total_duration_s"
        case totalCost = "total_cost"
        case driveCount = "drive_count"
        case chargeCount = "charge_count"
    }

    init(_ trip: TripListItem) {
        id = trip.id
        vehicleID = trip.vehicleID
        name = trip.name
        startDate = trip.startDate
        endDate = trip.endDate
        totalDistanceM = trip.totalDistanceM
        totalEnergyWh = trip.totalEnergyWh
        totalDurationS = trip.totalDurationS
        totalCost = trip.totalCost
        driveCount = trip.driveCount
        chargeCount = trip.chargeCount
    }
}
