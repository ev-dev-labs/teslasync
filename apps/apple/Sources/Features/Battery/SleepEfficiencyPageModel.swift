import Foundation
import Observation

// MARK: - Date range (web canonical `RangePicker` presets → the `days` query param)

/// The lookback window the header range picker offers (web `RangePicker` presets, default
/// `30d`). Each maps to the `days` count the `/analytics/sleep` query takes; the web also
/// sends explicit start/end, but the window length is what drives the aggregate.
public enum SleepRange: String, CaseIterable, Identifiable, Sendable {
    case week
    case month
    case quarter
    case year

    public var id: String { rawValue }

    /// The rolling-window day count sent as `days` (web `useRangeState` → `days`).
    public var days: Int {
        switch self {
        case .week: 7
        case .month: 30
        case .quarter: 90
        case .year: 365
        }
    }

    /// The string-catalog key for the preset's menu label.
    public var labelKey: String {
        "sleep.range.\(rawValue)"
    }
}

// MARK: - Data source seam (web `useSelectedVehicle` + the `useSleepEfficiency` query)

/// Supplies every datum the page renders. The production implementation binds the shared
/// KMP repositories/use-cases (ADR-004 — the view holds no networking); previews and
/// tests inject doubles to drive the loading / empty / error / success states. Mirrors
/// the sibling Battery `*DataSource` seams.
///
/// Method ↔ web map: `loadVehicles` ← `useSelectedVehicle` / `GET /vehicles`;
/// `loadSleep` ← `useSleepEfficiency` → `GET /analytics/sleep?vehicle_id&days`.
public protocol SleepEfficiencyDataSource: Sendable {
    func loadVehicles() async throws -> [BatteryVehicle]
    func loadSleep(vehicleID: Int64, days: Int) async throws -> SleepEfficiencyData?
}

// MARK: - Page phase (web `isLoading ? Skeleton : error ? errorRegion : !data ? empty : body`)

/// The page's terminal phase, driven by the `useSleepEfficiency` query. `.empty` is a
/// successful load that yielded no data (web `!sleep && !isLoading`); `.error` is a
/// retryable failure (web `PageContainer error`); `.ready` carries the snapshot.
public enum SleepEfficiencyPhase: Equatable, Sendable {
    case loading
    case empty
    case error(String)
    case ready
}

// MARK: - Page model

/// The `@Observable` state holder the page binds to (ADR-004 — no networking in the
/// view). Owns the vehicle list + selection (web header `VehicleSelect` /
/// `useSelectedVehicle`), the lookback range (web header `RangePicker` / `useRangeState`),
/// the per-vehicle sleep snapshot (web `sleep`, which drives the phase), and the currency
/// symbol the cost cards format with (web `useFormatting().formatCurrency`). Every panel /
/// chart / table reads its derived data from the bound state (web's `useMemo`s, now pure
/// model + `SleepEfficiencyData` derivations).
@MainActor
@Observable
public final class SleepEfficiencyPageModel {
    public private(set) var phase: SleepEfficiencyPhase = .loading

    /// Whether a background refetch is in flight while content is already shown
    /// (web `isFetching && !isLoading`).
    public private(set) var isRefreshing = false

    public private(set) var vehicles: [BatteryVehicle] = []
    public private(set) var selectedVehicleID: Int64?
    public private(set) var range: SleepRange
    public private(set) var sleep: SleepEfficiencyData?

    /// Web `settings.currency_symbol` (default `'$'`) — the prefix `formatCurrency` applies.
    public let currencySymbol: String

    @ObservationIgnored private let dataSource: any SleepEfficiencyDataSource

    public init(
        dataSource: any SleepEfficiencyDataSource = SampleSleepEfficiencyDataSource(),
        range: SleepRange = .month,
        currencySymbol: String = "$"
    ) {
        self.dataSource = dataSource
        self.range = range
        self.currencySymbol = currencySymbol
    }

    // MARK: Selection

    public var selectedVehicle: BatteryVehicle? {
        selectedVehicleID.flatMap { id in vehicles.first { $0.id == id } }
    }

    // MARK: Loading

    /// Loads the vehicle list then the selected vehicle's sleep snapshot (web
    /// `useVehicles` + the per-vehicle query). The sleep source resolves the page phase.
    public func load() async {
        phase = .loading
        await fetchAll()
    }

    /// Re-runs the load while keeping current content visible (web refetch).
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
        await loadSleep()
    }

    /// Selects a vehicle (web header picker `setVehicleId`) and reloads its snapshot.
    public func selectVehicle(_ id: Int64) async {
        guard id != selectedVehicleID, vehicles.contains(where: { $0.id == id }) else { return }
        selectedVehicleID = id
        phase = .loading
        await loadSleep()
    }

    /// Changes the lookback window (web `RangePicker onChange` → new `days`) and reloads
    /// the snapshot for that window (a fresh query, so the page returns to loading).
    public func selectRange(_ newRange: SleepRange) async {
        guard newRange != range else { return }
        range = newRange
        phase = .loading
        await loadSleep()
    }

    private func loadSleep() async {
        guard let id = selectedVehicleID else {
            sleep = nil
            phase = .empty
            return
        }

        // The sleep source resolves the page phase: throw → error region (web `error`),
        // nil → no-data empty (web `!sleep`), value → ready.
        do {
            let snapshot = try await dataSource.loadSleep(vehicleID: id, days: range.days)
            sleep = snapshot
            phase = snapshot == nil ? .empty : .ready
        } catch {
            sleep = nil
            phase = .error(error.localizedDescription)
        }
    }
}
