import Foundation
import Observation

// MARK: - Vehicle value type (web `Vehicle`, trimmed to this unit's render set)

/// One vehicle offered in the inspector's picker. A pure value type carrying only
/// the fields this parity unit renders (id, display name, VIN). Mirrors the web
/// `useVehicles` row this page consumes for its `<Select>` options.
public struct InspectorVehicle: Identifiable, Hashable, Sendable {
    public let id: Int64
    public let displayName: String?
    public let vin: String?

    public init(id: Int64, displayName: String? = nil, vin: String? = nil) {
        self.id = id
        self.displayName = displayName
        self.vin = vin
    }

    /// The option label — the Swift port of the web expression
    /// `v.display_name || v.vin || `Vehicle ${v.id}``.
    public var label: String {
        if let displayName, !displayName.isEmpty { return displayName }
        if let vin, !vin.isEmpty { return vin }
        return "Vehicle \(id)"
    }
}

// MARK: - Vehicle source seam (web `useVehicles` → GET /vehicles)

/// Supplies the vehicle list the picker offers. The production app binds the shared
/// KMP vehicles feed (ADR-004 — no networking in the view); previews and tests inject
/// doubles to drive the loading / empty / error / success states. Mirrors the
/// `ApiEndpointCatalogProviding` / `DiskForecastDataSource` seams on the sibling pages.
public protocol LiveSignalInspectorVehicleSource: Sendable {
    func load() async throws -> [InspectorVehicle]
}

// MARK: - Live-signals model factory (web `useVehicleLiveSignals(vehicleID)`)

/// Builds the per-vehicle `LiveSignalsTableModel` the snapshot panel embeds. The web
/// page re-keys `useVehicleLiveSignals` on the selected vehicle id; here a factory
/// yields a fresh model (bound to that vehicle's live source) whenever the selection
/// changes. The default wires the sample source; production injects the live store.
@MainActor
public protocol LiveSignalInspectorLiveSignalsFactory: Sendable {
    func make(vehicleID: Int64) -> LiveSignalsTableModel
}

// MARK: - Vehicles data state (web `useVehicles` query phases + empty list)

/// The page's data state for the vehicles source (web `useQuery` phases plus the
/// empty-list case). Drives the controls panel's loading / empty / error / success
/// branches.
public enum LiveSignalInspectorVehiclesState: Equatable, Sendable {
    case loading
    case empty
    case error(String)
    case loaded([InspectorVehicle])
}

// MARK: - Page model

/// The `@Observable` state holder the page binds to (ADR-004 — no networking in the
/// view). Owns the vehicles load state (web `useVehicles`) and the selected vehicle,
/// and vends the per-vehicle `LiveSignalsTableModel` (web `useVehicleLiveSignals`) the
/// snapshot panel renders. Reads the vehicle list through the injected seam.
@MainActor
@Observable
public final class LiveSignalInspectorPageModel {
    public private(set) var vehiclesState: LiveSignalInspectorVehiclesState = .loading
    /// The selected vehicle id, or `nil` for the "select a vehicle" prompt (web
    /// `vehicleId` state, initialised to `null`).
    public private(set) var selectedVehicleID: Int64?
    /// The live-signals model for the current selection, or `nil` when none is picked
    /// (web `useVehicleLiveSignals(vehicleId ?? undefined, { enabled: vehicleId !== null })`).
    public private(set) var liveSignals: LiveSignalsTableModel?

    @ObservationIgnored private let vehicleSource: any LiveSignalInspectorVehicleSource
    @ObservationIgnored private let liveSignalsFactory: any LiveSignalInspectorLiveSignalsFactory

    public init(
        vehicleSource: any LiveSignalInspectorVehicleSource = SampleLiveSignalInspectorVehicleSource(),
        liveSignalsFactory: any LiveSignalInspectorLiveSignalsFactory = SampleLiveSignalInspectorLiveSignalsFactory()
    ) {
        self.vehicleSource = vehicleSource
        self.liveSignalsFactory = liveSignalsFactory
    }

    /// The loaded vehicles (empty unless the state is `.loaded`).
    public var vehicles: [InspectorVehicle] {
        if case let .loaded(list) = vehiclesState { return list }
        return []
    }

    /// Whether a vehicle is selected (web `vehicleId !== null`). Gates the no-vehicle
    /// prompt vs. the live snapshot panel and the header live indicator.
    public var hasSelection: Bool {
        selectedVehicleID != nil
    }

    /// Loads the vehicle list and resolves the terminal state (web `useVehicles` query).
    public func load() async {
        vehiclesState = .loading
        do {
            let list = try await vehicleSource.load()
            vehiclesState = list.isEmpty ? .empty : .loaded(list)
        } catch {
            vehiclesState = .error(error.localizedDescription)
        }
    }

    /// Re-runs the vehicle-list load (web error-retry / refetch).
    public func refresh() async {
        await load()
    }

    /// Selects a vehicle (or clears the selection with `nil`) — the web
    /// `setVehicleId`. Building a fresh `LiveSignalsTableModel` for the new id mirrors
    /// re-keying `useVehicleLiveSignals`; clearing tears the snapshot down. The
    /// embedded `LiveSignalsTable` view owns the model's start/stop lifecycle.
    public func selectVehicle(_ id: Int64?) {
        guard id != selectedVehicleID else { return }
        liveSignals?.stop()
        selectedVehicleID = id
        if let id {
            liveSignals = liveSignalsFactory.make(vehicleID: id)
        } else {
            liveSignals = nil
        }
    }
}
