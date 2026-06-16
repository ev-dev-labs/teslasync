import Foundation

// Value types + pure, SI-native derivations for the Charging Patterns surface (web
// `web/src/features/charging/pages/ChargingHeatmapPage.tsx`, route `/charging-heatmap`).
// Every measurement stays SI exactly as the API serves it — energy is watt-hours, cost is a
// plain decimal, timestamps are ISO-8601 wire strings — and the user-facing kWh / minute
// display units are applied only at the SwiftUI render boundary (ADR-005). Field names mirror
// the snake_case wire (`total_energy_added_wh`, `cost_decimal`, `start_place`, `started_at`,
// `ended_at`) so the production KMP-backed data source maps straight across. The pure
// `useMemo` derivations the web computes (`stats`, `buildGrid`, `locationData`) live in
// `ChargingHeatmapDerivations`; the display formatters live in `ChargingHeatmapFormat.swift`.

// MARK: - Vehicle (web `useSelectedVehicle` → GET /vehicles)

/// One selectable vehicle (web `vehicle.display_name || vehicle.vin`). Identity + label
/// strings only, so they round-trip verbatim (no SI measurements here).
public struct ChargingHeatmapVehicle: Identifiable, Hashable, Sendable {
    public let id: Int64
    public let displayName: String
    public let vin: String

    public init(id: Int64, displayName: String, vin: String) {
        self.id = id
        self.displayName = displayName
        self.vin = vin
    }

    /// Web `vehicle.display_name || vehicle.vin` — the label shown in the selector.
    public var name: String {
        displayName.isEmpty ? vin : displayName
    }
}

// MARK: - Charging session (web `useChargingSessionsPaginated` → GET /charging)

/// One charging session row (web `ChargingSession`). Energy is watt-hours and cost is a plain
/// decimal; nullable wire fields stay optional so a derivation reads an em dash / "Unknown"
/// rather than a fabricated value. `startedAt` / `endedAt` are the ISO-8601 wire timestamps
/// (`new Date(started_at)` on the web); the local weekday / hour are derived at use, never
/// stored.
public struct ChargingHeatmapSession: Identifiable, Equatable, Sendable {
    public let id: Int64
    public let startedAt: String
    public let endedAt: String?
    public let totalEnergyAddedWh: Double
    public let costDecimal: Double?
    public let startPlace: String?

    public init(
        id: Int64,
        startedAt: String,
        endedAt: String?,
        totalEnergyAddedWh: Double,
        costDecimal: Double?,
        startPlace: String?
    ) {
        self.id = id
        self.startedAt = startedAt
        self.endedAt = endedAt
        self.totalEnergyAddedWh = totalEnergyAddedWh
        self.costDecimal = costDecimal
        self.startPlace = startPlace
    }
}

// MARK: - Summary stats (web `stats` useMemo)

/// The four header metrics the web `stats` memo computes from the session list: the session
/// count, the SI total energy added, the total cost (plain decimal), and the average session
/// duration in SI seconds. `nil` mirrors the web `if (!sessions?.length) return null` — the
/// stat cards then render zeros, exactly like the web `stats?.count ?? 0`.
public struct ChargingHeatmapStats: Equatable, Sendable {
    public let count: Int
    public let totalEnergyWh: Double
    public let totalCost: Double
    public let avgDurationSeconds: Double

    public init(count: Int, totalEnergyWh: Double, totalCost: Double, avgDurationSeconds: Double) {
        self.count = count
        self.totalEnergyWh = totalEnergyWh
        self.totalCost = totalCost
        self.avgDurationSeconds = avgDurationSeconds
    }
}

// MARK: - Heatmap grid (web `buildGrid`)

/// One day×hour cell of the weekly heatmap (web `HeatCell`): the session count and the SI
/// total energy that landed in that hour-of-week bucket.
public struct ChargingHeatCell: Equatable, Sendable {
    public let count: Int
    public let energyWh: Double

    public init(count: Int = 0, energyWh: Double = 0) {
        self.count = count
        self.energyWh = energyWh
    }

    /// Whether any session landed in this bucket (web `cell.count > 0`); compared against the
    /// zero cell so the check reads without a literal count-to-zero comparison.
    public var hasCharging: Bool {
        self != ChargingHeatCell()
    }
}

/// The full 7×24 weekly heatmap plus the busiest bucket (web `buildGrid` return). `cells` is
/// row-major `[day][hour]` (day 0 = Sunday, matching web `getDay()`); `maxCount` scales the
/// colour ramp and `favDay` / `favHour` are the first bucket to reach that max in session
/// order (web's `if (count > maxCount)` strict-greater update).
public struct ChargingHeatGrid: Equatable, Sendable {
    public let cells: [[ChargingHeatCell]]
    public let maxCount: Int
    public let favDay: Int
    public let favHour: Int

    public init(cells: [[ChargingHeatCell]], maxCount: Int, favDay: Int, favHour: Int) {
        self.cells = cells
        self.maxCount = maxCount
        self.favDay = favDay
        self.favHour = favHour
    }

    /// The all-zero 7×24 grid (web `{ grid: [], maxCount: 0, favDay: 0, favHour: 0 }` when
    /// there are no sessions). A populated zero grid (rather than an empty array) lets the
    /// view always render the grid structure instead of a blank region.
    public static let empty = ChargingHeatGrid(
        cells: Array(repeating: Array(repeating: ChargingHeatCell(), count: 24), count: 7),
        maxCount: 0,
        favDay: 0,
        favHour: 0
    )

    /// Web `maxCount > 0` — whether any session landed in the grid, gating the favorite panel.
    public var hasData: Bool { maxCount > 0 }

    /// Safe cell accessor (web `grid[day]?.[hour] ?? { count: 0, totalEnergy: 0 }`).
    public func cell(day: Int, hour: Int) -> ChargingHeatCell {
        guard cells.indices.contains(day), cells[day].indices.contains(hour) else {
            return ChargingHeatCell()
        }
        return cells[day][hour]
    }
}

// MARK: - Top location (web `locationData`)

/// One aggregated charging location (web `locationData[]`): the place name and its session
/// count, for the Top-Charging-Locations bar chart.
public struct ChargingLocation: Identifiable, Equatable, Sendable {
    public let name: String
    public let count: Int

    public var id: String { name }

    public init(name: String, count: Int) {
        self.name = name
        self.count = count
    }
}

// MARK: - Heat colour tier (web `heatColor`)

/// The five-step intensity ramp the web `heatColor(count, max)` maps a cell to. Kept as a
/// SwiftUI-free classification so it is unit-testable; the view resolves each tier to its
/// colour at render time (web rgba steps: faint-cyan → cyan → green → amber → red).
public enum ChargingHeatTier: Int, CaseIterable, Equatable, Sendable {
    case none, low, medium, high, peak

    /// Web `heatColor`: zero / no-max → `none`; ratio <0.25 → `low`; <0.5 → `medium`;
    /// <0.75 → `high`; otherwise → `peak`.
    public static func tier(count: Int, max: Int) -> ChargingHeatTier {
        guard count > 0, max > 0 else { return .none }
        let ratio = Double(count) / Double(max)
        if ratio < 0.25 { return .low }
        if ratio < 0.5 { return .medium }
        if ratio < 0.75 { return .high }
        return .peak
    }
}

// MARK: - Page phase (web `isLoading ? Skeleton : error ? errorRegion : body`)

/// The page's terminal phase. `.ready` is the web body — the stat cards, the favorite panel,
/// the heatmap grid, and the locations panel always render, each resolving its own
/// success/empty content from the session list (web shows no page-level empty). `.error` is a
/// retryable failure of the sessions query (web `PageContainer error`); `.loading` is the
/// initial fetch (web `Skeleton`).
public enum ChargingHeatmapPhase: Equatable, Sendable {
    case loading
    case error(String)
    case ready
}

// MARK: - Derivations (web `stats` / `buildGrid` / `locationData` memos)

/// Pure, unit-tested derivations — the SwiftUI port of every `useMemo` in
/// `ChargingHeatmapPage.tsx`. Kept SwiftUI-free and SI-native so the view only converts to
/// kWh / minutes at the render boundary. Each helper guards empty/zero inputs the same way the
/// web does (`!sessions?.length` → null/empty, `count > maxCount` strict-greater).
public enum ChargingHeatmapDerivations {
    /// Minimum sessions for a location to appear in the Top-Locations chart (web
    /// `.filter(([, c]) => c >= 2)`).
    public static let minLocationSessions = 2

    /// Maximum locations shown (web `.slice(0, 10)`).
    public static let maxLocations = 10

    /// Web `start_place ?? 'Unknown'` fallback bucket name.
    public static let unknownPlace = "Unknown"

    // MARK: Summary stats (web `stats` memo)

    /// Web `stats`: `null` when there are no sessions, else the count, the SI total energy
    /// (`Σ total_energy_added_wh`), the total cost (`Σ cost_decimal ?? 0`), and the average SI
    /// session duration (`Σ durationSeconds / count`).
    public static func stats(
        _ sessions: [ChargingHeatmapSession],
        calendar: Calendar = .current
    ) -> ChargingHeatmapStats? {
        guard !sessions.isEmpty else { return nil }
        let totalEnergyWh = sessions.reduce(0) { $0 + $1.totalEnergyAddedWh }
        let totalCost = sessions.reduce(0) { $0 + ($1.costDecimal ?? 0) }
        let totalDuration = sessions.reduce(0.0) { $0 + durationSeconds($1.startedAt, $1.endedAt, calendar: calendar) }
        return ChargingHeatmapStats(
            count: sessions.count,
            totalEnergyWh: totalEnergyWh,
            totalCost: totalCost,
            avgDurationSeconds: totalDuration / Double(sessions.count)
        )
    }

    // MARK: Weekly grid (web `buildGrid`)

    /// Web `buildGrid`: buckets every session into its local day-of-week × hour cell, summing
    /// the count and the SI energy, and tracks the first bucket (in session order) to reach the
    /// running max (web's `if (grid[day][hour].count > maxCount)` strict-greater update). With
    /// no sessions it returns the all-zero grid so the view still renders the structure.
    public static func buildGrid(
        _ sessions: [ChargingHeatmapSession],
        calendar: Calendar = .current
    ) -> ChargingHeatGrid {
        guard !sessions.isEmpty else { return .empty }
        var cells = Array(repeating: Array(repeating: ChargingHeatCell(), count: 24), count: 7)
        var maxCount = 0
        var favDay = 0
        var favHour = 0

        for session in sessions {
            guard let day = weekday(fromISO: session.startedAt, calendar: calendar),
                  let hour = hour(fromISO: session.startedAt, calendar: calendar) else { continue }
            let previous = cells[day][hour]
            let updated = ChargingHeatCell(
                count: previous.count + 1,
                energyWh: previous.energyWh + session.totalEnergyAddedWh
            )
            cells[day][hour] = updated
            if updated.count > maxCount {
                maxCount = updated.count
                favDay = day
                favHour = hour
            }
        }

        return ChargingHeatGrid(cells: cells, maxCount: maxCount, favDay: favDay, favHour: favHour)
    }

    // MARK: Top locations (web `locationData`)

    /// Web `locationData`: counts sessions per `start_place` (nil → "Unknown"), keeps places
    /// with ≥2 sessions, sorts by count descending, and takes the top 10. Empty mirrors the web
    /// `if (!sessions?.length) return []`.
    public static func locations(_ sessions: [ChargingHeatmapSession]) -> [ChargingLocation] {
        guard !sessions.isEmpty else { return [] }
        var order: [String] = []
        var counts: [String: Int] = [:]
        for session in sessions {
            let name = session.startPlace ?? unknownPlace
            if counts[name] == nil { order.append(name) }
            counts[name, default: 0] += 1
        }
        return order
            .map { ChargingLocation(name: $0, count: counts[$0] ?? 0) }
            .filter { $0.count >= minLocationSessions }
            .sorted { $0.count > $1.count }
            .prefix(maxLocations)
            .map { $0 }
    }

    // MARK: Timestamp helpers (web `new Date(started_at).getDay()/getHours()`)

    /// The local weekday index (0 = Sunday … 6 = Saturday) of an ISO-8601 wire timestamp, using
    /// the supplied calendar (web `getDay()`). `nil` when the timestamp can't be parsed.
    public static func weekday(fromISO raw: String, calendar: Calendar = .current) -> Int? {
        guard let date = parseDate(raw) else { return nil }
        // Calendar `.weekday` is 1 = Sunday … 7 = Saturday; web `getDay()` is 0 = Sunday.
        return calendar.component(.weekday, from: date) - 1
    }

    /// The local hour (0…23) of an ISO-8601 wire timestamp (web `getHours()`). `nil` when the
    /// timestamp can't be parsed.
    public static func hour(fromISO raw: String, calendar: Calendar = .current) -> Int? {
        guard let date = parseDate(raw) else { return nil }
        return calendar.component(.hour, from: date)
    }

    /// SI session duration in seconds (web `durationMinutes` × 60, before the minute rounding):
    /// `0` when there is no end timestamp, either timestamp is unparseable, or the end is not
    /// after the start (web `end <= start → 0`). Stored as seconds so nothing non-SI is held.
    public static func durationSeconds(
        _ startedAt: String,
        _ endedAt: String?,
        calendar: Calendar = .current
    ) -> Double {
        guard let endedAt, let start = parseDate(startedAt), let end = parseDate(endedAt) else { return 0 }
        let seconds = end.timeIntervalSince(start)
        return seconds.isFinite && seconds > 0 ? seconds : 0
    }

    /// Parses an ISO-8601 wire timestamp, accepting both the plain and fractional-seconds forms
    /// (mirrors the sibling Energy surface's `hour(fromISO:)`).
    static func parseDate(_ raw: String) -> Date? {
        let plain = ISO8601DateFormatter()
        plain.formatOptions = [.withInternetDateTime]
        let fractional = ISO8601DateFormatter()
        fractional.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return plain.date(from: raw) ?? fractional.date(from: raw)
    }
}
