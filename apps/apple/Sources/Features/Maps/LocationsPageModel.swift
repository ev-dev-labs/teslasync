import Foundation
import Observation

// MARK: - Data source seam (web hooks: useSelectedVehicle / useQuery(['visited-locations']))

/// Supplies every datum the page renders. The production implementation binds the shared KMP
/// repositories/use-cases (ADR-004 — the view holds no networking); previews and tests inject
/// doubles to drive the loading / empty / error / success states. Mirrors the data-source seam
/// used by the sibling feature pages.
///
/// Method ↔ web hook map: `loadVehicles` ← `useSelectedVehicle`/`GET /vehicles`;
/// `loadLocations` ← `useQuery(['visited-locations'])` → `GET /locations?vehicle_id&limit&offset`.
public protocol LocationsDataSource: Sendable {
    func loadVehicles() async throws -> [LocationsPageVehicle]
    func loadLocations(vehicleID: Int64, limit: Int, offset: Int) async throws -> [VisitedLocation]
}

// MARK: - Page phase (web `PageContainer` loading / error; empty + success render in-place)

/// The page's terminal phase, driven by the visited-locations query (web `locationsQuery`).
/// `.error` is a retryable failure of the query; `.ready` carries the fetched page (possibly empty
/// — the empty state renders inside the always-present list + chart panels, mirroring the web,
/// which never replaces the whole surface with a blank).
public enum LocationsPhase: Equatable, Sendable {
    case loading
    case error(String)
    case ready
}

// MARK: - Chart datum (web `visitsChartData` / `timeChartData`)

/// One bar in a Top-Locations chart: the truncated address label (web
/// `name.length > 25 ? slice(0,22)+'…' : name`) plus its plotted value (visit count or hours).
public struct LocationsChartBar: Identifiable, Hashable, Sendable {
    public let id: Int64
    public let label: String
    public let value: Double

    public init(id: Int64, label: String, value: Double) {
        self.id = id
        self.label = label
        self.value = value
    }
}

// MARK: - Page model

/// The `@Observable` state holder the page binds to (ADR-004 — no networking in the view). Owns the
/// vehicle list + selection, the fetched visited-locations page (driving the phase), the search +
/// pagination, the client-side `last_visited` range filter (web `locations` memo), and the applied
/// AI-name hand-off. All summary stats + chart series are derived from the filtered list exactly as
/// the web page derives them.
@MainActor
@Observable
public final class LocationsPageModel {
    public private(set) var phase: LocationsPhase = .loading

    /// Whether a background refetch is in flight while content is already shown (web
    /// `isFetching && !isLoading`).
    public private(set) var isRefreshing = false

    public private(set) var vehicles: [LocationsPageVehicle] = []
    public private(set) var selectedVehicleID: Int64?

    /// The current fetched page of visited locations (web `rawLocations`), in the API's rank order.
    public private(set) var rawLocations: [VisitedLocation] = []

    /// Web `q` URL state — the address search filter.
    public var search: String = ""

    /// Web `page` URL state (1-based) + the fixed `pageSize = 50`.
    public private(set) var page: Int = 1
    public static let pageSize = 50

    /// Web `useRangeState({ defaultPresetId: 'all' })` — the `last_visited` window the list is
    /// narrowed to. Defaults to all-time; rows with a null `last_visited` are excluded (web
    /// `if (!l.last_visited) return false`).
    public private(set) var rangeStart: Date = .distantPast
    public private(set) var rangeEnd: Date = .distantFuture

    /// Web `appliedName` — the AI-proposed name parked for hand-off, shown as a "ready to save"
    /// confirmation under its row.
    public private(set) var appliedName: AppliedLocationName?

    @ObservationIgnored private let dataSource: any LocationsDataSource

    /// Memoized per-location AI name-draft models (web renders an `AIAutoNameUnnamedLocations`
    /// child per unnamed row). Cached so a row's streaming model survives list re-renders. Ignored
    /// by Observation — mutating the cache must not invalidate the view.
    @ObservationIgnored private var nameDraftModels: [Int64: AINameDraftModel] = [:]

    public init(dataSource: any LocationsDataSource = SampleLocationsDataSource()) {
        self.dataSource = dataSource
    }

    /// The (memoized) AI name-draft model for an unnamed location, wired so applying a proposal
    /// parks it via `applyName` (web `<AIAutoNameUnnamedLocations onApplyName={…} />`). Built with
    /// the in-memory source — no networking — so it is safe inside a list. `@MainActor`-isolated,
    /// matching the model.
    public func nameDraftModel(for location: VisitedLocation) -> AINameDraftModel {
        if let existing = nameDraftModels[location.id] { return existing }
        let input = AINameDraftInput(gate: .on, locationID: location.id, currentName: location.addressName)
        let source = InMemoryAINameDraftSource(initial: input)
        let draft = AINameDraftModel(source: source) { [weak self] name in
            self?.applyName(locationID: location.id, name: name)
        }
        nameDraftModels[location.id] = draft
        return draft
    }

    // MARK: Selection

    public var selectedVehicle: LocationsPageVehicle? {
        selectedVehicleID.flatMap { id in vehicles.first { $0.id == id } }
    }

    // MARK: Loading

    /// Loads the vehicle list then the selected vehicle's first page of locations (web
    /// `useSelectedVehicle` + the per-vehicle locations query).
    public func load() async {
        phase = .loading
        await fetchAll()
    }

    /// Re-runs the load while keeping current content visible (web refetch / pull-to-refresh).
    public func refresh() async {
        isRefreshing = true
        await fetchAll()
        isRefreshing = false
    }

    private func fetchAll() async {
        vehicles = await (try? dataSource.loadVehicles()) ?? []
        if selectedVehicleID == nil || !vehicles.contains(where: { $0.id == selectedVehicleID }) {
            selectedVehicleID = vehicles.first?.id
        }
        await loadLocations()
    }

    /// Selects a vehicle (web header `Select`), resets to the first page, and reloads (web
    /// `onPickVehicle` + the query re-running with the new `vehicle_id`).
    public func selectVehicle(_ id: Int64) async {
        guard id != selectedVehicleID, vehicles.contains(where: { $0.id == id }) else { return }
        selectedVehicleID = id
        page = 1
        phase = .loading
        await loadLocations()
    }

    /// Moves to a 1-based page (web `Pagination.onPageChange`) and reloads its window.
    public func setPage(_ newPage: Int) async {
        let clamped = max(1, newPage)
        guard clamped != page else { return }
        page = clamped
        phase = .loading
        await loadLocations()
    }

    private func loadLocations() async {
        guard let id = selectedVehicleID else {
            rawLocations = []
            phase = .ready
            return
        }
        do {
            let offset = (page - 1) * Self.pageSize
            rawLocations = try await dataSource.loadLocations(vehicleID: id, limit: Self.pageSize, offset: offset)
            phase = .ready
        } catch {
            rawLocations = []
            phase = .error(error.localizedDescription)
        }
    }

    // MARK: Search

    /// Sets the address search filter (web `setSearch`). Client-side only — no refetch.
    public func setSearch(_ text: String) {
        search = text
    }

    /// Clears the search filter (web `Clear search` action + the filter chip remove).
    public func clearSearch() {
        search = ""
    }

    // MARK: AI name hand-off (web `setAppliedName` / `appliedName`)

    /// Parks an AI-proposed name for a location (web `onApplyName` → `setAppliedName`). The page
    /// shows the "ready to save" confirmation; nothing is persisted here.
    public func applyName(locationID: Int64, name: String) {
        appliedName = AppliedLocationName(locationID: locationID, name: name)
    }

    /// The applied name parked for a given location, if any (web `appliedName?.id === loc.id`).
    public func appliedName(for locationID: Int64) -> String? {
        appliedName?.locationID == locationID ? appliedName?.name : nil
    }

    // MARK: Derived — filtered list (web `locations` memo + `filteredLocations`)

    /// Web `locations` memo: the fetched page narrowed to rows whose `last_visited` falls inside the
    /// picked window (rows with a null `last_visited` are dropped). With the default all-time range
    /// this keeps every dated row in API rank order.
    public var locations: [VisitedLocation] {
        guard !rawLocations.isEmpty else { return [] }
        return rawLocations.filter { location in
            guard let visited = location.lastVisited else { return false }
            return visited >= rangeStart && visited <= rangeEnd
        }
    }

    /// Web `filteredLocations` (`useFilteredList` over `address_name`): the range-filtered list
    /// further narrowed by the case-insensitive address search.
    public var filteredLocations: [VisitedLocation] {
        let query = search.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        guard !query.isEmpty else { return locations }
        return locations.filter { $0.addressName.lowercased().contains(query) }
    }

    // MARK: Derived — summary stats (web reducers)

    /// Web `locations.reduce((s, l) => s + l.visit_count, 0)`.
    public var totalVisits: Int {
        locations.reduce(0) { $0 + $1.visitCount }
    }

    /// Web `locations.reduce((s, l) => s + l.total_duration_s, 0)` — SI seconds.
    public var totalTimeS: Double {
        locations.reduce(0) { $0 + $1.totalDurationS }
    }

    /// Web `locations?.length`.
    public var uniquePlaces: Int {
        locations.count
    }

    /// Web `topLocation = locations?.[0]` — the most-visited place (API rank order).
    public var topLocation: VisitedLocation? {
        locations.first
    }

    /// Web `totalVisits > 0 ? totalTime / totalVisits : 0` — mean dwell per visit (SI seconds).
    public var averageDurationS: Double {
        totalVisits > 0 ? totalTimeS / Double(totalVisits) : 0
    }

    /// Web `uniqueCities` memo: distinct trailing address segment, dropping the `"Unknown"`
    /// sentinel.
    public var uniqueCities: Int {
        var cities = Set<String>()
        for location in locations {
            if let city = LocationsNaming.city(of: location.addressName) {
                cities.insert(city)
            }
        }
        return cities.count
    }

    // MARK: Derived — chart series (web `visitsChartData` / `timeChartData`)

    /// Web `visitsChartData`: the top 15 places (API rank order) as (truncated label, visit count).
    public var visitsChartData: [LocationsChartBar] {
        locations.prefix(15).map { location in
            LocationsChartBar(
                id: location.id,
                label: LocationsFormat.chartLabel(location.addressName),
                value: Double(location.visitCount)
            )
        }
    }

    /// Web `timeChartData`: the top 10 places as (truncated label, hours = duration/3600, 1 dp).
    public var timeChartData: [LocationsChartBar] {
        locations.prefix(10).map { location in
            LocationsChartBar(
                id: location.id,
                label: LocationsFormat.chartLabel(location.addressName),
                value: LocationsFormat.hours(location.totalDurationS)
            )
        }
    }

    // MARK: Derived — pagination (web `Pagination`)

    /// Whether a previous page exists (web pager — `page > 1`).
    public var hasPreviousPage: Bool {
        page > 1
    }

    /// Whether another page likely exists: a full page came back (web `locations.length < pageSize`
    /// inverted — a short page means the list is exhausted).
    public var hasNextPage: Bool {
        rawLocations.count >= Self.pageSize
    }
}
