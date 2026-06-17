//
//  SignalGapDetectorPageModel.swift
//  TeslaSync — P4-APPLE · P7 · page:telemetry/SignalGapDetector (Apple)
//
//  The @Observable state-holder for the native SignalGapDetector page — the SwiftUI parity of
//  web/src/features/telemetry/pages/SignalGapDetectorPage.tsx (route /signal-gaps). The web page
//  is a thin wrapper: it reads the global `useSelectedVehicle()` scope and either shows the
//  "select a vehicle" EmptyState (no scope) or mounts `<SignalCatalogPanel vehicleId>`.
//
//  This model reproduces that contract for the native shell:
//    • it owns the current vehicle scope (web `vehicleId`, `!vehicleId || vehicleId <= 0` → empty),
//    • it feeds the header `VehicleSelect` surface a live fleet snapshot (web `<VehicleSelect/>`),
//    • it vends the bound `SignalCatalogPanelModel` for the chosen vehicle (web catalog mount).
//
//  No networking/business logic lives in the view. The fleet feed (`SignalGapDetectorVehicleSource`)
//  and the catalog binding (`SignalGapDetectorCatalogProviding`) are injected seams (P1/S8): the
//  composition root binds them to the shared KMP core + live signal store; previews/tests inject
//  doubles, and the registration ships the sample seams below until the live store is wired (the
//  same staging the sibling LiveSignalInspector page uses).
//

import Foundation
import Observation

// MARK: - Fleet source seam (web `useVehicles` feed for the header picker)

/// The read seam the model loads the fleet through, so the header `VehicleSelect` can render its
/// options (web `useVehicles()`). The production app binds this to the shared vehicles feed;
/// previews/tests inject a double; the registration default is `SampleSignalGapDetectorVehicleSource`.
@MainActor
public protocol SignalGapDetectorVehicleSource: AnyObject {
    func load() async throws -> [VehicleSelectVehicle]
}

// MARK: - Catalog binding seam (web `<SignalCatalogPanel vehicleId>`)

/// The seam that vends a bound ``SignalCatalogPanelModel`` for a chosen vehicle — the native peer of
/// the web page mounting `<SignalCatalogPanel vehicleId>`. The production app binds the model over
/// the shared live signal store keyed by `vehicleID`; the registration default is
/// `SampleSignalGapDetectorCatalogProvider`.
@MainActor
public protocol SignalGapDetectorCatalogProviding: AnyObject {
    func makeModel(vehicleID: Int) -> SignalCatalogPanelModel
}

// MARK: - View-model

/// The page's observable view-model. Owns the vehicle scope (web `vehicleId`), the fleet feed for
/// the header picker, and the bound catalog model for the current scope. Drives the empty-vs-catalog
/// branch the web page renders.
@MainActor
@Observable
public final class SignalGapDetectorPageModel {
    /// The fleet-load lifecycle for the header picker (web `useVehicles` fetch state). The picker
    /// surface renders each one; the page body only consults `hasSelection`.
    public enum VehiclesPhase: Equatable {
        case loading
        case loaded
        case empty
        case error(String)
    }

    public private(set) var vehiclesPhase: VehiclesPhase = .loading
    /// The current vehicle scope (web `vehicleId`); `nil` when nothing is selected.
    public private(set) var selectedVehicleID: Int?
    /// The loaded fleet (web `vehicles`), in display order.
    public private(set) var vehicles: [VehicleSelectVehicle] = []

    /// The live snapshot source the header `VehicleSelect` binds to — re-emitted whenever the fleet
    /// or the selection changes. Held so the model can push updates without rebuilding the picker.
    @ObservationIgnored public let vehicleSelectSource: LiveVehicleSelectSource

    /// The header `VehicleSelect` state-holder, built once over `vehicleSelectSource` so the picker keeps
    /// a single subscription (the source's `onUpdate`) across re-renders. The view binds it via
    /// `VehicleSelect(model:)`; chosen ids route back through `selectVehicle` (web `setVehicleId`).
    @ObservationIgnored public private(set) lazy var vehicleSelectModel = VehicleSelectModel(
        source: vehicleSelectSource,
        onSelect: { [weak self] id in self?.selectVehicle(id) }
    )

    @ObservationIgnored private let vehicleSource: any SignalGapDetectorVehicleSource
    @ObservationIgnored private let catalogProvider: any SignalGapDetectorCatalogProviding
    @ObservationIgnored private var boundCatalogModel: SignalCatalogPanelModel?
    @ObservationIgnored private var didLoad = false

    public init(
        vehicleSource: any SignalGapDetectorVehicleSource = SampleSignalGapDetectorVehicleSource(),
        catalogProvider: any SignalGapDetectorCatalogProviding = SampleSignalGapDetectorCatalogProvider(),
        initialVehicleID: Int? = nil
    ) {
        self.vehicleSource = vehicleSource
        self.catalogProvider = catalogProvider
        let scope = Self.normalize(initialVehicleID)
        selectedVehicleID = scope
        vehicleSelectSource = LiveVehicleSelectSource(
            snapshot: VehicleSelectSnapshot(vehicles: [], selectedId: scope, isLoading: true)
        )
        refreshBoundCatalogModel()
    }

    // MARK: Derived reads

    /// Whether a vehicle scope is set — the inverse of the web `!vehicleId || vehicleId <= 0` guard
    /// that decides between the EmptyState and the catalog.
    public var hasSelection: Bool {
        (selectedVehicleID ?? 0) > 0
    }

    /// The bound catalog model for the current scope (web `<SignalCatalogPanel vehicleId>`), or `nil`
    /// when no vehicle is selected. Cached so the panel keeps its live subscription across re-renders;
    /// re-key the hosting view on `selectedVehicleID`.
    public var catalogModel: SignalCatalogPanelModel? {
        boundCatalogModel
    }

    // MARK: Intents

    /// Loads the fleet for the header picker (web `useVehicles`). Idempotent once loaded.
    public func load() async {
        if didLoad, case .loaded = vehiclesPhase { return }
        vehiclesPhase = .loading
        pushSnapshot(isLoading: true, errorMessage: nil)
        do {
            let fleet = try await vehicleSource.load()
            vehicles = fleet
            didLoad = true
            vehiclesPhase = fleet.isEmpty ? .empty : .loaded
            pushSnapshot(isLoading: false, errorMessage: nil)
        } catch {
            vehiclesPhase = .error(error.localizedDescription)
            pushSnapshot(isLoading: false, errorMessage: error.localizedDescription)
        }
    }

    /// Re-fetches the fleet (the picker error-state retry / pull-to-refresh).
    public func refresh() async {
        didLoad = false
        await load()
    }

    /// Commits a chosen vehicle scope — the web `<VehicleSelect>` `onChange` → `setVehicleId`. A `nil`
    /// or non-positive id clears the scope (back to the EmptyState).
    public func selectVehicle(_ id: Int?) {
        let normalized = Self.normalize(id)
        guard normalized != selectedVehicleID else { return }
        selectedVehicleID = normalized
        refreshBoundCatalogModel()
        pushSnapshot(isLoading: false, errorMessage: nil)
    }

    // MARK: Helpers

    private func refreshBoundCatalogModel() {
        if let id = selectedVehicleID, id > 0 {
            boundCatalogModel = catalogProvider.makeModel(vehicleID: id)
        } else {
            boundCatalogModel = nil
        }
    }

    private func pushSnapshot(isLoading: Bool, errorMessage: String?) {
        vehicleSelectSource.update(VehicleSelectSnapshot(
            vehicles: vehicles,
            selectedId: selectedVehicleID,
            isLoading: isLoading,
            errorMessage: errorMessage,
            connection: .live
        ))
    }

    private static func normalize(_ id: Int?) -> Int? {
        guard let id, id > 0 else { return nil }
        return id
    }
}

// MARK: - Sample seams (registration defaults until the live store is wired, P1/S8)

/// The fleet seam default — a small representative fleet so the header picker renders real options.
/// It does NOT auto-select a vehicle, so the page opens on the "select a vehicle" EmptyState (the
/// web initial state for a user whose global scope is unset). The composition root replaces this with
/// the shared vehicles feed.
@MainActor
public final class SampleSignalGapDetectorVehicleSource: SignalGapDetectorVehicleSource {
    public init() {}

    public func load() async throws -> [VehicleSelectVehicle] {
        [
            VehicleSelectVehicle(id: 1, displayName: "Model 3", vin: "5YJ3E1EA7KF000001"),
            VehicleSelectVehicle(id: 2, displayName: "Model Y", vin: "5YJYGDEE5MF000002")
        ]
    }
}

/// The catalog seam default — binds a ``SignalCatalogPanelModel`` over an in-memory snapshot so the
/// mounted catalog renders a representative staleness spread (active / aging / stale / never), the
/// same staging the sibling LiveSignalInspector page ships until the live signal store is wired.
@MainActor
public final class SampleSignalGapDetectorCatalogProvider: SignalGapDetectorCatalogProviding {
    public init() {}

    public func makeModel(vehicleID _: Int) -> SignalCatalogPanelModel {
        SignalCatalogPanelModel(source: InMemorySignalCatalogPanelSource(initial: Self.snapshot()))
    }

    private static func snapshot() -> SignalCatalogPanelUpdate {
        SignalCatalogPanelUpdate(
            status: .loaded,
            connection: .live,
            entries: entries(),
            updatedAt: Date()
        )
    }

    private static func entries() -> [SignalCatalogPanelEntry] {
        [
            SignalCatalogPanelEntry(name: "vehicle_speed", payload: .envelope(value: .number(0), timestamp: iso(4))),
            SignalCatalogPanelEntry(name: "battery_level", payload: .envelope(value: .number(72), timestamp: iso(18))),
            SignalCatalogPanelEntry(
                name: "charging_state",
                payload: .envelope(value: .string("Disconnected"), timestamp: iso(90))
            ),
            SignalCatalogPanelEntry(
                name: "est_battery_range",
                payload: .envelope(value: .number(214), timestamp: iso(640))
            ),
            SignalCatalogPanelEntry(name: "tpms_fl", payload: .envelope(value: .null, timestamp: iso(6))),
            SignalCatalogPanelEntry(name: "odometer", payload: .bare(.number(45120)))
        ]
    }

    private static func iso(_ secondsAgo: TimeInterval) -> String {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime]
        return formatter.string(from: Date().addingTimeInterval(-secondsAgo))
    }
}
