import Foundation
import Observation

// MARK: - Data-source seam (P1/S8 state-holder layer; never HTTP from the view)

/// The currently-selected vehicle the widget renders (web `useVehicles` result).
public struct TwinVehicle: Equatable, Sendable {
    public var id: Int64
    public var name: String
    public var exteriorColor: String?

    public init(id: Int64, name: String, exteriorColor: String? = nil) {
        self.id = id
        self.name = name
        self.exteriorColor = exteriorColor
    }
}

/// Seam the view model binds to. A facade-backed implementation is supplied by
/// the app composition root (`AppContainer`); previews and tests inject an
/// in-memory source. The view never performs I/O itself.
public protocol DigitalTwinMiniDataSource: Sendable {
    /// Resolves the vehicle to render — the `preferred` id when present, else the
    /// first available vehicle, or `nil` when the account has none.
    func currentVehicle(preferred vehicleID: Int64?) async throws -> TwinVehicle?
    /// The latest security + vehicle-state + charging snapshot for a vehicle.
    func snapshot(vehicleID: Int64) async throws -> DigitalTwinMiniInputs
}

/// Default source used until the composition root injects a live, facade-backed
/// one. It reports no vehicle, so the widget renders its honest empty state
/// rather than fabricated data.
public struct DigitalTwinMiniUnconfiguredSource: DigitalTwinMiniDataSource {
    public init() {}
    public func currentVehicle(preferred _: Int64?) async throws -> TwinVehicle? {
        nil
    }

    public func snapshot(vehicleID _: Int64) async throws -> DigitalTwinMiniInputs {
        DigitalTwinMiniInputs()
    }
}

/// In-memory source for previews and tests.
public struct DigitalTwinMiniStaticSource: DigitalTwinMiniDataSource {
    public var vehicle: TwinVehicle?
    public var inputs: DigitalTwinMiniInputs
    public var failure: FacadeError?

    public init(
        vehicle: TwinVehicle?,
        inputs: DigitalTwinMiniInputs = DigitalTwinMiniInputs(),
        failure: FacadeError? = nil
    ) {
        self.vehicle = vehicle
        self.inputs = inputs
        self.failure = failure
    }

    public func currentVehicle(preferred _: Int64?) async throws -> TwinVehicle? {
        if let failure { throw failure }
        return vehicle
    }

    public func snapshot(vehicleID _: Int64) async throws -> DigitalTwinMiniInputs {
        if let failure { throw failure }
        return inputs
    }
}

// MARK: - View model

/// `@Observable` view model that drives the widget through every state. It binds
/// the source's result into the shared-facade `LoadableState` and layers
/// freshness (stale / offline) on top, exactly as the web widget forwards
/// `isStale` / `isError` to `WidgetShell`.
@MainActor
@Observable
public final class DigitalTwinMiniModel {
    public private(set) var state: LoadableState<DigitalTwinMiniData> = .idle
    public private(set) var vehicle: TwinVehicle?
    public private(set) var hasVehicle = true
    public private(set) var lastUpdated: Date?
    public private(set) var isFetching = false
    public private(set) var isOffline = false
    public private(set) var didLoadOnce = false

    private let vehicleID: Int64?
    private let source: any DigitalTwinMiniDataSource
    private let telemetry: @Sendable (_ event: String, _ surface: String) -> Void
    private let now: @Sendable () -> Date
    private let stalenessWindow: TimeInterval
    private var didEmitOpen = false
    private var refreshTask: Task<Void, Never>?

    public init(
        vehicleID: Int64? = nil,
        source: any DigitalTwinMiniDataSource,
        telemetry: @escaping @Sendable (_ event: String, _ surface: String) -> Void = DigitalTwinMiniTelemetry.osLog,
        now: @escaping @Sendable () -> Date = { Date() },
        stalenessWindow: TimeInterval = 12
    ) {
        self.vehicleID = vehicleID
        self.source = source
        self.telemetry = telemetry
        self.now = now
        self.stalenessWindow = stalenessWindow
    }

    /// Visible data is older than the freshness window.
    public var isStale: Bool {
        guard let lastUpdated else { return false }
        return now().timeIntervalSince(lastUpdated) > stalenessWindow
    }

    /// Whether the widget should replace its body with a retryable error surface
    /// (a hard failure with nothing cached and the network reachable).
    public var showsErrorSurface: Bool {
        state.error != nil && state.value == nil && !isOffline
    }

    /// Emits the diagnostics `view.opened` once and kicks off the first load.
    public func onAppear() {
        if !didEmitOpen {
            didEmitOpen = true
            telemetry("view.opened", DigitalTwinMiniSurface.slug)
        }
        refresh()
    }

    public func onDisappear() {
        refreshTask?.cancel()
        refreshTask = nil
    }

    public func refresh() {
        refreshTask?.cancel()
        refreshTask = Task { await self.load() }
    }

    public func load() async {
        isFetching = true
        defer {
            isFetching = false
            didLoadOnce = true
        }
        do {
            let resolved = try await source.currentVehicle(preferred: vehicleID)
            guard let resolved else {
                hasVehicle = false
                vehicle = nil
                isOffline = false
                state = .empty(stale: false)
                return
            }
            hasVehicle = true
            vehicle = resolved
            let inputs = try await source.snapshot(vehicleID: resolved.id)
            isOffline = false
            if let data = DigitalTwinMiniAdapter.project(inputs) {
                lastUpdated = data.lastUpdated ?? now()
                state = .loaded(data, stale: isStale)
            } else {
                state = .empty(stale: false)
            }
        } catch let error as FacadeError where error == .offline {
            isOffline = true
            state = .failed(.offline, cached: state.value, stale: true)
        } catch let error as FacadeError {
            isOffline = false
            state = .failed(error, cached: state.value, stale: isStale)
        } catch is CancellationError {
            // A superseded refresh — keep whatever is already on screen.
        } catch {
            isOffline = false
            state = .failed(.from(error), cached: state.value, stale: isStale)
        }
    }
}
