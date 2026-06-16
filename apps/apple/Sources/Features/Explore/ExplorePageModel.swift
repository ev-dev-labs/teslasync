import Foundation
import Observation

// MARK: - Data source seam (web hooks: useVehicles / useIsForwardAuth + the recentPages registry)

/// Supplies the gating inputs the hub renders from. The production implementation binds the shared
/// KMP repositories/use-cases (ADR-004 — the view holds no networking); previews and tests inject
/// doubles to drive the loading / empty / error / success states.
///
/// Method ↔ web map (names kept at the Swift call sites per the parity manifest):
/// `useVehicles` ← `useVehicles`/`GET /vehicles`; `useIsForwardAuth` ← `useIsForwardAuth`;
/// `recentRoutePaths` ← the `lib/recentPages` localStorage registry the command palette maintains.
public protocol ExploreDataSource: Sendable {
    func useVehicles() async throws -> [ExploreVehicle]
    func useIsForwardAuth() async -> Bool
    func recentRoutePaths() async -> [String]
}

/// The minimal vehicle shape the hub needs — only the count drives gating (web `vehicles.length`).
public struct ExploreVehicle: Identifiable, Sendable, Equatable {
    public let id: Int64
    public let displayName: String

    public init(id: Int64, displayName: String) {
        self.id = id
        self.displayName = displayName
    }
}

// MARK: - Page phase (web PageContainer phases)

/// The page's terminal phase. `.error` is a total gating-load failure (`useVehicles` threw) with a
/// retry; `.ready` always renders the full hub, whose own empty branch (no search match) is the
/// data-empty state. There is no global empty collapse — the chrome is never hidden.
public enum ExplorePhase: Equatable, Sendable {
    case loading
    case error(String)
    case ready
}

// MARK: - Page model

/// The `@Observable` state holder the hub binds to (ADR-004 — no networking in the view). Owns the
/// search term (web URL `?q=`), the gating inputs (vehicle count + ForwardAuth), and the recently
/// visited paths, then derives the visible / filtered / grouped catalog, the recent strip, and the
/// empty-state suggestions through the pure `ExploreCatalog` operations.
@MainActor
@Observable
public final class ExplorePageModel {
    /// The load state (web TanStack `isLoading` / `error` / success).
    public enum LoadState: Equatable, Sendable {
        case loading
        case loaded
        case failed(String)
    }

    public private(set) var loadState: LoadState = .loading

    /// Whether a background refetch is in flight while content is already shown (web refetch).
    public private(set) var isRefreshing = false

    /// Web `useVehicles` result — only the count gates the catalog.
    public private(set) var vehicles: [ExploreVehicle] = []
    /// Web `useIsForwardAuth` result — gates the privileged admin/system features.
    public private(set) var isForwardAuth = false
    /// Web `getRecentPages()` snapshot — resolved against the visible catalog for the recent strip.
    public private(set) var recentPaths: [String] = []

    /// Web `?q=` search term — bound to the sticky search field; an empty term shows the full hub.
    public var query: String = ""

    @ObservationIgnored private let dataSource: any ExploreDataSource
    @ObservationIgnored private let catalog: [ExploreEntry]
    @ObservationIgnored public let recentLimit: Int

    public init(
        dataSource: any ExploreDataSource = SampleExploreDataSource(),
        recentLimit: Int = 6
    ) {
        self.dataSource = dataSource
        self.recentLimit = recentLimit
        catalog = ExploreCatalog.build()
    }

    // MARK: Phase

    /// The displayed phase (web `PageContainer`): loading from the gating sources, error on a total
    /// failure, else ready (the full hub with its own no-match empty branch).
    public var phase: ExplorePhase {
        switch loadState {
        case .loading: .loading
        case let .failed(message): .error(message)
        case .loaded: .ready
        }
    }

    // MARK: Loading

    /// Loads the gating inputs (web `useVehicles` + `useIsForwardAuth`) and the recent-pages snapshot.
    public func load() async {
        loadState = .loading
        await fetchAll()
    }

    /// Re-runs the load while keeping current content visible (web refetch).
    public func refresh() async {
        isRefreshing = true
        await fetchAll()
        isRefreshing = false
    }

    private func fetchAll() async {
        do {
            vehicles = try await dataSource.useVehicles()
        } catch {
            vehicles = []
            isForwardAuth = await dataSource.useIsForwardAuth()
            recentPaths = await dataSource.recentRoutePaths()
            loadState = .failed(error.localizedDescription)
            return
        }
        isForwardAuth = await dataSource.useIsForwardAuth()
        recentPaths = await dataSource.recentRoutePaths()
        loadState = .loaded
    }

    // MARK: Search (web `?q=` URL state)

    public func setQuery(_ next: String) {
        query = next
    }

    public func clearQuery() {
        query = ""
    }

    // MARK: Derivations (web useMemo blocks, via `ExploreCatalog`)

    public var vehicleCount: Int { vehicles.count }

    /// Whether the user is actively filtering (web `query` truthiness).
    public var hasQuery: Bool {
        !query.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    /// Web `visibleCatalog`: the sidebar-gated subset of the full catalog.
    public var visibleCatalog: [ExploreEntry] {
        ExploreCatalog.visible(catalog, vehicleCount: vehicleCount, isForwardAuth: isForwardAuth)
    }

    /// Web `filtered`: the visible catalog narrowed by the query.
    public var filtered: [ExploreEntry] {
        ExploreCatalog.filter(visibleCatalog, query: query)
    }

    /// Web `grouped`: the filtered catalog bucketed into ordered sections.
    public var grouped: [ExploreSection] {
        ExploreCatalog.group(filtered)
    }

    public var totalFeatures: Int { visibleCatalog.count }
    public var matchCount: Int { filtered.count }

    /// Web `grouped.length === 0` — the empty data state (no feature matches the query).
    public var isEmptyResult: Bool { grouped.isEmpty }

    /// Web `recentResolved`: recent paths mapped onto visible entries, de-duped and capped.
    public var recentEntries: [ExploreEntry] {
        let byPath = Dictionary(visibleCatalog.map { ($0.path, $0) }, uniquingKeysWith: { first, _ in first })
        var seen = Set<AppRoute>()
        var out: [ExploreEntry] = []
        for path in recentPaths {
            guard let entry = byPath[path], !seen.contains(entry.route) else { continue }
            seen.insert(entry.route)
            out.append(entry)
            if out.count >= recentLimit { break }
        }
        return out
    }

    /// Web: the recent strip shows only when not filtering and there is something to show.
    public var showsRecent: Bool { !hasQuery && !recentEntries.isEmpty }

    /// Web `suggestions`: the nearest visible routes to a missed query (capped at five).
    public var suggestions: [ExploreSuggestion] {
        ExploreCatalog.closestRoutes(query: query, in: visibleCatalog, limit: 5)
    }
}
