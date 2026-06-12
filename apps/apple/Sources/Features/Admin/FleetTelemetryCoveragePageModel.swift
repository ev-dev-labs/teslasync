import Foundation
import Observation

// MARK: - Wire value types (web `FleetTelemetryFieldCoverage` / `…CategoryCoverage` / `…CoverageResponse`)

/// One routed Tesla telemetry field — the native peer of the web
/// `FleetTelemetryFieldCoverage` (`web/src/api/types.ts`). Field names/types mirror
/// the snake_case wire 1:1 so the production KMP-backed source maps straight across.
/// These are routing-metadata strings + flags, NOT SI-unit-bearing measurements, so
/// they round-trip verbatim with no unit conversion.
public struct FleetTelemetryFieldCoverage: Hashable, Sendable {
    public let field: String
    public let destination: String
    public let column: String?
    public let alsoSignalLog: Bool
    public let subscribed: Bool

    public init(
        field: String,
        destination: String,
        column: String? = nil,
        alsoSignalLog: Bool = false,
        subscribed: Bool
    ) {
        self.field = field
        self.destination = destination
        self.column = column
        self.alsoSignalLog = alsoSignalLog
        self.subscribed = subscribed
    }
}

/// A single protomodel Category bucket (web `FleetTelemetryCategoryCoverage`): the
/// category name, its total routed field count, per-destination counts, and the rows.
public struct FleetTelemetryCategoryCoverage: Hashable, Sendable {
    public let category: String
    public let totalFields: Int
    public let destinations: [String: Int]
    public let fields: [FleetTelemetryFieldCoverage]

    public init(
        category: String,
        totalFields: Int,
        destinations: [String: Int],
        fields: [FleetTelemetryFieldCoverage]
    ) {
        self.category = category
        self.totalFields = totalFields
        self.destinations = destinations
        self.fields = fields
    }
}

/// The package-derived routing snapshot (web `FleetTelemetryCoverageResponse`): the
/// per-category buckets, the global per-destination fan-out totals, and the orphan
/// fields (routing.yaml entries with no matching proto field — a drift alert).
public struct FleetTelemetryCoverageResponse: Hashable, Sendable {
    public let categories: [FleetTelemetryCategoryCoverage]
    public let destinationTotals: [String: Int]
    public let orphanFields: [String]

    public init(
        categories: [FleetTelemetryCategoryCoverage],
        destinationTotals: [String: Int],
        orphanFields: [String]
    ) {
        self.categories = categories
        self.destinationTotals = destinationTotals
        self.orphanFields = orphanFields
    }
}

// MARK: - Summary roll-ups (web `summarise` / `SummaryStats`)

/// The five global summary counts the stat cards render (web `SummaryStats`).
public struct FleetTelemetryCoverageStats: Equatable, Sendable {
    public let totalCategories: Int
    public let totalRoutedFields: Int
    public let subscribedFields: Int
    public let unsubscribedRoutedFields: Int
    public let orphanFields: Int

    public static let zero = FleetTelemetryCoverageStats(
        totalCategories: 0,
        totalRoutedFields: 0,
        subscribedFields: 0,
        unsubscribedRoutedFields: 0,
        orphanFields: 0
    )

    public init(
        totalCategories: Int,
        totalRoutedFields: Int,
        subscribedFields: Int,
        unsubscribedRoutedFields: Int,
        orphanFields: Int
    ) {
        self.totalCategories = totalCategories
        self.totalRoutedFields = totalRoutedFields
        self.subscribedFields = subscribedFields
        self.unsubscribedRoutedFields = unsubscribedRoutedFields
        self.orphanFields = orphanFields
    }

    /// Web `summarise(data)` — sums routed/subscribed fields across categories.
    public init(response: FleetTelemetryCoverageResponse) {
        var routed = 0
        var subscribed = 0
        for category in response.categories {
            routed += category.fields.count
            subscribed += category.fields.reduce(0) { $0 + ($1.subscribed ? 1 : 0) }
        }
        self.init(
            totalCategories: response.categories.count,
            totalRoutedFields: routed,
            subscribedFields: subscribed,
            unsubscribedRoutedFields: routed - subscribed,
            orphanFields: response.orphanFields.count
        )
    }
}

// MARK: - Data source seam (web `useFleetTelemetryCoverage`, GET /tesla/fleet-telemetry/coverage)

/// Supplies the routing snapshot the page renders. The production implementation binds
/// the shared KMP coverage feed (ADR-004 — the view holds no networking); previews and
/// tests inject doubles to drive the loading / empty / error / success states. Mirrors
/// the `DiskForecastDataSource` seam used by the sibling admin pages.
public protocol FleetTelemetryCoverageDataSource: Sendable {
    func load() async throws -> FleetTelemetryCoverageResponse
}

// MARK: - Page state (web PageContainer query phases + empty)

/// The page's data state for the coverage source. `.empty` is a successful load with
/// zero categories (web `categories.length === 0`); `.error` is a retryable failure
/// (web `query.error`); `.loaded` carries the snapshot.
public enum FleetTelemetryCoverageState: Equatable, Sendable {
    case loading
    case empty
    case error(String)
    case loaded(FleetTelemetryCoverageResponse)
}

// MARK: - Page model

/// The `@Observable` state holder the page binds to (ADR-004 — no networking in the
/// view). Owns the load state + the filter query, and derives the summary roll-ups,
/// sorted destination totals, orphans, and the filtered category/field views from the
/// loaded snapshot, reading it through the injected `FleetTelemetryCoverageDataSource`.
@MainActor
@Observable
public final class FleetTelemetryCoveragePageModel {
    public private(set) var state: FleetTelemetryCoverageState = .loading

    /// Whether a background refetch is in flight while content is already shown
    /// (web `isFetching && !isLoading` — drives the Refresh button's spinner).
    public private(set) var isRefreshing = false

    /// The free-text filter applied to categories + fields (web `filter` useState).
    public var filter: String = ""

    @ObservationIgnored private let dataSource: any FleetTelemetryCoverageDataSource

    public init(dataSource: any FleetTelemetryCoverageDataSource = SampleFleetTelemetryCoverageDataSource()) {
        self.dataSource = dataSource
    }

    /// The loaded snapshot, or nil unless the state is `.loaded`.
    public var response: FleetTelemetryCoverageResponse? {
        if case let .loaded(response) = state { return response }
        return nil
    }

    /// The five global summary counts (web `stats`). Zeros until a snapshot loads.
    public var stats: FleetTelemetryCoverageStats {
        guard let response else { return .zero }
        return FleetTelemetryCoverageStats(response: response)
    }

    /// Global per-destination totals sorted by count desc, then name asc for stable
    /// ordering (web `sortedDestinations`).
    public var sortedDestinationTotals: [(destination: String, count: Int)] {
        Self.sortedCounts(response?.destinationTotals ?? [:])
    }

    /// The orphan fields (web `orphans`) — empty unless loaded.
    public var orphans: [String] {
        response?.orphanFields ?? []
    }

    /// Whether the orphan-drift panel renders (web `orphans.length > 0`).
    public var hasOrphans: Bool {
        !orphans.isEmpty
    }

    /// All categories in the snapshot (web `categories`).
    public var categories: [FleetTelemetryCategoryCoverage] {
        response?.categories ?? []
    }

    /// The categories matching the current filter (web `filteredCategories`): a
    /// category is kept when its name matches or any of its fields match.
    public var filteredCategories: [FleetTelemetryCategoryCoverage] {
        let query = normalizedFilter
        guard !query.isEmpty else { return categories }
        return categories.filter { category in
            if category.category.lowercased().contains(query) { return true }
            return category.fields.contains { Self.fieldMatches($0, query: query) }
        }
    }

    /// The fields within a category matching the current filter (web per-category
    /// `filtered`). Returns all fields when the filter is empty.
    public func filteredFields(in category: FleetTelemetryCategoryCoverage) -> [FleetTelemetryFieldCoverage] {
        let query = normalizedFilter
        guard !query.isEmpty else { return category.fields }
        return category.fields.filter { Self.fieldMatches($0, query: query) }
    }

    /// Per-category destination counts sorted desc by count (web `destEntries`).
    public func sortedDestinations(in category: FleetTelemetryCategoryCoverage) -> [(destination: String, count: Int)] {
        Self.sortedCounts(category.destinations)
    }

    /// Loads the snapshot and resolves the terminal state (web `useFleetTelemetryCoverage`).
    public func load() async {
        state = .loading
        await fetch()
    }

    /// Re-runs the load while keeping current content visible (web refetch).
    public func refresh() async {
        isRefreshing = true
        await fetch()
        isRefreshing = false
    }

    private func fetch() async {
        do {
            let response = try await dataSource.load()
            state = response.categories.isEmpty ? .empty : .loaded(response)
        } catch {
            state = .error(error.localizedDescription)
        }
    }

    private var normalizedFilter: String {
        filter.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
    }

    /// Web field predicate: matches the field name, destination, or column.
    private static func fieldMatches(_ field: FleetTelemetryFieldCoverage, query: String) -> Bool {
        field.field.lowercased().contains(query)
            || field.destination.lowercased().contains(query)
            || (field.column ?? "").lowercased().contains(query)
    }

    /// Sorts a destination→count map by count desc, then key asc (deterministic).
    private static func sortedCounts(_ counts: [String: Int]) -> [(destination: String, count: Int)] {
        counts
            .sorted { lhs, rhs in
                lhs.value == rhs.value ? lhs.key < rhs.key : lhs.value > rhs.value
            }
            .map { (destination: $0.key, count: $0.value) }
    }
}

// MARK: - Display-boundary formatter (web `fmtInt`)

/// Pure display formatter ported from `web/src/lib/numberFormat.ts` `fmtInt`: en-US
/// grouping, zero fraction digits. Counts are unit-agnostic control-plane integers, so
/// no SI conversion applies — they format verbatim at the display boundary.
public enum FleetTelemetryCoverageFormat {
    /// The em-dash shown for a missing typed column (web `column ? … : '—'`).
    public static let emptyValue = "—"

    /// Web `fmtInt(value)`: locale-grouped (en-US), no decimals.
    public static func int(_ value: Int) -> String {
        let formatter = NumberFormatter()
        formatter.locale = Locale(identifier: "en_US")
        formatter.numberStyle = .decimal
        formatter.usesGroupingSeparator = true
        formatter.maximumFractionDigits = 0
        return formatter.string(from: NSNumber(value: value)) ?? String(value)
    }
}
