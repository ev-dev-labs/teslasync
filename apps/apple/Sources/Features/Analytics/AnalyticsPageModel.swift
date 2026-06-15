import Foundation
import Observation

// MARK: - Tabs (web `TAB_KEYS` + `TabNav` tabs: overview / driving / charging / battery)

/// The four analytics tabs (web `TabKey`). Each carries its localized title key (web `t('analytics.
/// tabs.*')`) and an SF Symbol standing in for the web Lucide icon, so the tab bar reads identically
/// across platforms.
public enum AnalyticsTab: String, CaseIterable, Identifiable, Sendable {
    case overview
    case driving
    case charging
    case battery

    public var id: String {
        rawValue
    }

    /// Web `t('analytics.tabs.<key>')` — the localized tab label key.
    public var titleKey: String {
        "analytics.tabs.\(rawValue)"
    }

    /// SF Symbol mirroring the web Lucide icon (BarChart3 / Car / Zap / Battery).
    public var systemImage: String {
        switch self {
        case .overview: "chart.bar.fill"
        case .driving: "car.fill"
        case .charging: "bolt.fill"
        case .battery: "battery.100"
        }
    }
}

// MARK: - Data source seam (web hook: `useFleetAnalytics({ start, end })` → GET /analytics/fleet)

/// Supplies the single payload the page renders (web `useFleetAnalytics`). The production
/// implementation binds the shared KMP repositories/use-cases (ADR-004 — the view holds no
/// networking); previews and tests inject doubles to drive the loading / empty / error / success
/// states. The method name is kept at the Swift call site per the parity manifest
/// (`useFleetAnalytics`).
public protocol AnalyticsDataSource: Sendable {
    func loadFleetAnalytics(range: AnalyticsRange) async throws -> FleetAnalyticsData?
}

// MARK: - Range (web `useRangeState` + `RangePicker` presetIds 7d/30d/90d/1y/all)

/// The trailing window the fleet query is scoped to (web `RangePicker` presets). `day30` is the
/// default (web `defaultPresetId: '30d'`); the chosen preset re-keys the query, mirroring the web
/// `useFleetAnalytics({ start, end })` refetch.
public enum AnalyticsRange: String, CaseIterable, Identifiable, Sendable {
    case day7
    case day30
    case day90
    case year1
    case all

    public var id: String {
        rawValue
    }

    /// Web `presetIds` value (`'7d'`, `'30d'`, …) — the stable wire id for the preset.
    public var presetID: String {
        switch self {
        case .day7: "7d"
        case .day30: "30d"
        case .day90: "90d"
        case .year1: "1y"
        case .all: "all"
        }
    }

    /// Trailing window length in days, or `nil` for the unbounded "all" preset (web full history).
    public var days: Int? {
        switch self {
        case .day7: 7
        case .day30: 30
        case .day90: 90
        case .year1: 365
        case .all: nil
        }
    }
}

// MARK: - Page phase (web `PageContainer` loading / error props + `data` presence)

/// The page's terminal phase, driven by the single fleet query (web `fleetQuery`). `.ready` carries
/// the populated payload (web `data` present → hero + tabs render); `.empty` is a successful load
/// that yielded no payload (defensive — web would spin its skeletons); `.error` is a retryable
/// failure (web `PageContainer error` region); `.loading` is the initial fetch (web `isLoading`).
public enum AnalyticsPhase: Equatable, Sendable {
    case loading
    case empty
    case error(String)
    case ready
}

// MARK: - Derived view-models (web `useMemo` derivations in the tab sub-components)

/// One efficiency-leaderboard row (web `OverviewVehicleComparison.leaderboard`): the vehicle, its
/// Wh/km, and its share of the least-efficient vehicle's value (the bar fill fraction 0…1).
public struct AnalyticsLeaderboardEntry: Identifiable, Hashable, Sendable {
    public let id: Int64
    public let name: String
    public let efficiencyWhKm: Double
    public let fraction: Double

    public init(id: Int64, name: String, efficiencyWhKm: Double, fraction: Double) {
        self.id = id
        self.name = name
        self.efficiencyWhKm = efficiencyWhKm
        self.fraction = fraction
    }
}

/// One vehicle's normalized radar profile (web `OverviewVehicleComparison.radarData`): each metric
/// scaled 0…1 against the fleet maximum, efficiency inverted so lower Wh/km scores higher.
public struct AnalyticsRadarVehicle: Identifiable, Hashable, Sendable {
    public let id: Int64
    public let name: String
    public let colorIndex: Int
    public let distanceFraction: Double
    public let energyFraction: Double
    public let drivesFraction: Double
    public let efficiencyFraction: Double

    public init(
        id: Int64,
        name: String,
        colorIndex: Int,
        distanceFraction: Double,
        energyFraction: Double,
        drivesFraction: Double,
        efficiencyFraction: Double
    ) {
        self.id = id
        self.name = name
        self.colorIndex = colorIndex
        self.distanceFraction = distanceFraction
        self.energyFraction = energyFraction
        self.drivesFraction = drivesFraction
        self.efficiencyFraction = efficiencyFraction
    }
}

/// One charger-brand leaderboard row (web `ChargingDetailSection.brandLeaderboard`): the brand, its
/// session count, and its share of the top brand's count (the bar fill fraction 0…1).
public struct AnalyticsBrandEntry: Identifiable, Hashable, Sendable {
    public let brand: String
    public let count: Int
    public let fraction: Double

    public var id: String {
        brand
    }

    public init(brand: String, count: Int, fraction: Double) {
        self.brand = brand
        self.count = count
        self.fraction = fraction
    }
}

/// One cost-by-charger-type row (web `ChargingDetailSection` cost-by-type): the type, its session
/// count, its share of all sessions (0…1), and a stable palette index for the bar color.
public struct AnalyticsCostTypeEntry: Identifiable, Hashable, Sendable {
    public let type: String
    public let count: Int
    public let fraction: Double
    public let colorIndex: Int

    public var id: String {
        type
    }

    public init(type: String, count: Int, fraction: Double, colorIndex: Int) {
        self.type = type
        self.count = count
        self.fraction = fraction
        self.colorIndex = colorIndex
    }
}

// MARK: - Page model

/// The `@Observable` state holder the page binds to (ADR-004 — no networking in the view). Owns the
/// single fleet payload (driving the page phase), the active tab (web `activeTab` `useState`), the
/// trailing range (web `useRangeState`), and the load freshness (web `DataFreshnessAuto`). Derives
/// the leaderboards, the per-vehicle radar profiles, the charger-brand + cost-by-type breakdowns,
/// and the comparison visibility from the payload. Reads everything through the injected
/// `AnalyticsDataSource`.
@MainActor
@Observable
public final class AnalyticsPageModel {
    public private(set) var phase: AnalyticsPhase = .loading

    /// Whether a background refetch is in flight while content is already shown (web
    /// `isFetching && !isLoading`).
    public private(set) var isRefreshing = false

    public private(set) var data: FleetAnalyticsData?
    public var activeTab: AnalyticsTab = .overview
    public private(set) var range: AnalyticsRange = .day30

    /// When the payload last loaded successfully (web `DataFreshnessAuto` `dataUpdatedAt`).
    public private(set) var lastUpdated: Date?

    @ObservationIgnored private let dataSource: any AnalyticsDataSource
    @ObservationIgnored private let now: @Sendable () -> Date

    public init(
        dataSource: any AnalyticsDataSource = SampleAnalyticsDataSource(),
        now: @escaping @Sendable () -> Date = { Date() }
    ) {
        self.dataSource = dataSource
        self.now = now
    }

    // MARK: Loading (web `useFleetAnalytics` query lifecycle)

    /// Loads the fleet payload for the current range and resolves the page phase (web `fleetQuery`).
    public func load() async {
        phase = .loading
        await fetch()
    }

    /// Re-runs the load while keeping current content visible (web refetch / Retry).
    public func refresh() async {
        isRefreshing = true
        await fetch()
        isRefreshing = false
    }

    /// Switches the visible tab (web `setActiveTab`). Pure UI state — no refetch.
    public func selectTab(_ tab: AnalyticsTab) {
        activeTab = tab
    }

    /// Changes the trailing window and re-keys the query (web `RangePicker.onChange` → new
    /// `useFleetAnalytics` bounds). Keeps current content visible during the refetch.
    public func selectRange(_ newRange: AnalyticsRange) async {
        guard newRange != range else { return }
        range = newRange
        isRefreshing = true
        await fetch()
        isRefreshing = false
    }

    private func fetch() async {
        do {
            let payload = try await dataSource.loadFleetAnalytics(range: range)
            data = payload
            if payload == nil {
                phase = .empty
            } else {
                phase = .ready
                lastUpdated = now()
            }
        } catch {
            phase = .error(error.localizedDescription)
        }
    }

    // MARK: Freshness (web `DataFreshnessAuto` — staleness after 2 min, ADR-013)

    /// Seconds since the payload last loaded, or `nil` before the first success.
    public var secondsSinceUpdate: TimeInterval? {
        lastUpdated.map { now().timeIntervalSince($0) }
    }

    /// Web `DataFreshnessAuto` staleness — live values older than two minutes are flagged (ADR-013).
    public var isStale: Bool {
        (secondsSinceUpdate ?? 0) > 120
    }

    // MARK: Derived — vehicle comparison (web Overview sub-component `useMemo`s)

    /// Whether the radar comparison renders (web `radarData` requires `vehicles.length >= 2`).
    public var showsComparison: Bool {
        (data?.vehicleComparison.count ?? 0) > 1
    }

    /// Web `OverviewVehicleComparison.leaderboard`: vehicles sorted by ascending Wh/km, each scored
    /// as a share of the least-efficient vehicle's value (the bar fill fraction).
    public var efficiencyLeaderboard: [AnalyticsLeaderboardEntry] {
        guard let vehicles = data?.vehicleComparison, !vehicles.isEmpty else { return [] }
        let sorted = vehicles.sorted { $0.efficiencyWhKm < $1.efficiencyWhKm }
        let maxEff = sorted.last?.efficiencyWhKm ?? 1
        return sorted.map { vehicle in
            AnalyticsLeaderboardEntry(
                id: vehicle.id,
                name: vehicle.name,
                efficiencyWhKm: vehicle.efficiencyWhKm,
                fraction: maxEff > 0 ? vehicle.efficiencyWhKm / maxEff : 0
            )
        }
    }

    /// Web `OverviewVehicleComparison.radarData`: per-vehicle normalized Distance / Energy / Drives /
    /// Efficiency (efficiency inverted), only when there are at least two vehicles to compare.
    public var radarVehicles: [AnalyticsRadarVehicle] {
        guard let vehicles = data?.vehicleComparison, vehicles.count > 1 else { return [] }
        let maxDistance = Swift.max(vehicles.map(\.distanceM).max() ?? 1, 1)
        let maxEnergy = Swift.max(vehicles.map(\.energyWh).max() ?? 1, 1)
        let maxDrives = Swift.max(Double(vehicles.map(\.drives).max() ?? 1), 1)
        let maxEff = Swift.max(vehicles.map(\.efficiencyWhKm).max() ?? 1, 1)
        return vehicles.enumerated().map { index, vehicle in
            AnalyticsRadarVehicle(
                id: vehicle.id,
                name: vehicle.name,
                colorIndex: index,
                distanceFraction: vehicle.distanceM / maxDistance,
                energyFraction: vehicle.energyWh / maxEnergy,
                drivesFraction: Double(vehicle.drives) / maxDrives,
                efficiencyFraction: (maxEff - vehicle.efficiencyWhKm) / maxEff
            )
        }
    }

    // MARK: Derived — charging breakdowns (web `ChargingDetailSection` `useMemo`s)

    /// Web `ChargingDetailSection.brandLeaderboard`: each brand scored as a share of the top brand's
    /// session count (the bar fill fraction).
    public var chargerBrandLeaderboard: [AnalyticsBrandEntry] {
        let brands = data?.chargingAnalytics.chargerBrands ?? []
        let maxCount = Swift.max(Double(brands.map(\.count).max() ?? 0), 1)
        return brands.map { bucket in
            AnalyticsBrandEntry(brand: bucket.label, count: bucket.count, fraction: Double(bucket.count) / maxCount)
        }
    }

    /// Web `ChargingDetailSection` cost-by-type: each charger type scored as a share of all sessions
    /// (the bar fill fraction), with a stable palette index per row.
    public var costByType: [AnalyticsCostTypeEntry] {
        let types = data?.chargingAnalytics.chargerTypes ?? []
        let total = Double(types.reduce(0) { $0 + $1.count })
        return types.enumerated().map { index, bucket in
            AnalyticsCostTypeEntry(
                type: bucket.label,
                count: bucket.count,
                fraction: total > 0 ? Double(bucket.count) / total : 0,
                colorIndex: index
            )
        }
    }
}
