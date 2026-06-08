import Foundation
import Observation
import Shared

// MARK: - Diagnostics seam

/// The P1/S11 diagnostics contract surface this widget needs: a single
/// `view.opened` signal carrying the surface slug. The host injects a real
/// emitter; previews and the default path use the no-op.
public protocol DestinationETADiagnostics {
    /// Records that the surface became visible (the generic `view.opened` event).
    @MainActor func recordViewOpened(surface: String)
}

/// Default emitter used when the host wires no diagnostics (and in previews).
public struct NoopDestinationETADiagnostics: DestinationETADiagnostics {
    public init() {}
    @MainActor public func recordViewOpened(surface _: String) {}
}

/// Bridges the `view.opened` signal onto the shared-core typed analytics taxonomy
/// (`Telemetry.track(ScreenView)`), which is consent-gated and redacted in core.
public struct SharedTelemetryDestinationETADiagnostics: DestinationETADiagnostics {
    private let telemetry: Telemetry
    private let platform: String
    private let appVersion: String

    public init(
        telemetry: Telemetry,
        platform: String = Shared.Platform.shared.name,
        appVersion: String = (Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String) ?? "0"
    ) {
        self.telemetry = telemetry
        self.platform = platform
        self.appVersion = appVersion
    }

    @MainActor public func recordViewOpened(surface: String) {
        telemetry.track(
            event: TelemetryEventScreenView(screen: surface, platform: platform, appVersion: appVersion)
        )
    }
}

// MARK: - Live binding

/// Owns the shared-core feeds (location snapshot + the vehicles list used for the
/// "no explicit vehicle → first vehicle" fallback the web hook performs) and
/// projects them into an observable `LoadableState`. Mirrors `VehicleSettingsModel`.
@MainActor
@Observable
final class DestinationETALiveBinding {
    @ObservationIgnored private let store: VehiclesStore
    @ObservationIgnored private let explicitVehicleID: Int64?
    @ObservationIgnored private var vehiclesHolder: StateHolderModel<[Int64]>?
    @ObservationIgnored private var snapshotHolder: StateHolderModel<LoadableState<DestinationETASnapshot>>?
    @ObservationIgnored private var boundVehicleID: Int64?

    init(store: VehiclesStore, explicitVehicleID: Int64?) {
        self.store = store
        self.explicitVehicleID = explicitVehicleID
    }

    var state: LoadableState<DestinationETASnapshot> {
        snapshotHolder?.state ?? .idle
    }

    func start() {
        if vehiclesHolder == nil {
            vehiclesHolder = StateHolderModel(flow: store.vehicles()) { raw in
                DestinationETALiveBinding.projectVehicleIDs(raw)
            }
        }
        vehiclesHolder?.start()
        bindSnapshot(for: effectiveVehicleID())
        observeVehiclesForFallback()
    }

    func stop() {
        snapshotHolder?.stop()
        vehiclesHolder?.stop()
    }

    func refresh() {
        bindSnapshot(for: boundVehicleID ?? effectiveVehicleID())
    }

    private func effectiveVehicleID() -> Int64 {
        explicitVehicleID ?? vehiclesHolder?.state?.first ?? 0
    }

    private func bindSnapshot(for vehicleID: Int64) {
        snapshotHolder?.stop()
        boundVehicleID = vehicleID
        let holder = StateHolderModel<LoadableState<DestinationETASnapshot>>(
            flow: store.locationSnapshotLatest(vehicleId: vehicleID)
        ) { raw in
            guard let resource = raw as? Resource else { return nil }
            return LoadableState.from(resource) { DestinationETASnapshot.fromSharedJSON($0) }
        }
        snapshotHolder = holder
        holder.start()
    }

    /// Re-binds the snapshot feed once the vehicles list resolves a first id, but
    /// only when no explicit vehicle was supplied by the host.
    private func observeVehiclesForFallback() {
        guard explicitVehicleID == nil else { return }
        withObservationTracking {
            _ = vehiclesHolder?.state
        } onChange: {
            Task { @MainActor [weak self] in
                guard let self else { return }
                let resolved = effectiveVehicleID()
                if resolved != boundVehicleID {
                    bindSnapshot(for: resolved)
                }
                observeVehiclesForFallback()
            }
        }
    }

    private static func projectVehicleIDs(_ raw: Any) -> [Int64]? {
        guard let success = raw as? Shared.ResourceSuccess<AnyObject> else { return [] }
        guard let list = success.data as? [Any] else { return [] }
        return list.compactMap { ($0 as? Shared.Vehicle)?.id }
    }
}

// MARK: - Model

/// `@Observable` view model for `DestinationETAWidget`. Binds the shared S8 feeds
/// in production, or holds a fixed `LoadableState` for previews and tests, and
/// emits the `view.opened` diagnostics signal once per appearance.
@MainActor
@Observable
public final class DestinationETAWidgetModel {
    public var unitPreferences: UnitPreferences

    @ObservationIgnored private let diagnostics: DestinationETADiagnostics
    @ObservationIgnored private let surfaceSlug: String
    @ObservationIgnored private var didRecordOpen = false
    @ObservationIgnored private let backing: Backing

    private enum Backing {
        case fixed(LoadableState<DestinationETASnapshot>)
        case live(DestinationETALiveBinding)
    }

    /// Production initializer — binds the shared `VehiclesStore` feeds.
    public init(
        store: VehiclesStore,
        vehicleID: Int64?,
        unitPreferences: UnitPreferences,
        diagnostics: DestinationETADiagnostics = NoopDestinationETADiagnostics(),
        surfaceSlug: String = DestinationETAWidget.registry.surfaceSlug
    ) {
        self.unitPreferences = unitPreferences
        self.diagnostics = diagnostics
        self.surfaceSlug = surfaceSlug
        backing = .live(DestinationETALiveBinding(store: store, explicitVehicleID: vehicleID))
    }

    /// Fixed-state initializer for previews, snapshots, and unit tests.
    public init(
        state: LoadableState<DestinationETASnapshot>,
        unitPreferences: UnitPreferences = .metric,
        diagnostics: DestinationETADiagnostics = NoopDestinationETADiagnostics(),
        surfaceSlug: String = DestinationETAWidget.registry.surfaceSlug
    ) {
        self.unitPreferences = unitPreferences
        self.diagnostics = diagnostics
        self.surfaceSlug = surfaceSlug
        backing = .fixed(state)
    }

    public var snapshotState: LoadableState<DestinationETASnapshot> {
        switch backing {
        case let .fixed(state): state
        case let .live(binding): binding.state
        }
    }

    /// The render model, or `nil` when there is no snapshot value to show.
    public var viewState: DestinationETAViewState? {
        guard let snapshot = snapshotState.value else { return nil }
        return DestinationETAViewState(snapshot: snapshot)
    }

    public var freshness: DestinationETAFreshness {
        DestinationETAFreshness(state: snapshotState)
    }

    /// Whether the chrome should show the loading skeleton (nothing to display yet).
    public var isInitialLoading: Bool {
        if snapshotState.value != nil { return false }
        if case .idle = snapshotState { return true }
        return snapshotState.isLoading
    }

    /// The error to surface when there is no cached value to keep on screen.
    public var blockingError: FacadeError? {
        snapshotState.value == nil ? snapshotState.error : nil
    }

    /// The display distance in the user's preferred unit (SI converted at render).
    public func displayDistance(meters: Double) -> Double {
        Units.convertDistance(meters, unitPreferences)
    }

    public func start() {
        if !didRecordOpen {
            didRecordOpen = true
            diagnostics.recordViewOpened(surface: surfaceSlug)
        }
        if case let .live(binding) = backing { binding.start() }
    }

    public func stop() {
        if case let .live(binding) = backing { binding.stop() }
    }

    public func refresh() {
        if case let .live(binding) = backing { binding.refresh() }
    }
}
