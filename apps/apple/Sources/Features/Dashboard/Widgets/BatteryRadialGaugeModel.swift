import Foundation
import Observation
import Shared

/// `@Observable` adapter that binds the shared P1/S8 Vehicles state holder to the
/// BatteryRadialGauge widget. It resolves the effective vehicle id (explicit prop,
/// else the first enrolled vehicle — the web `vehicleId ?? vehicles?.[0]?.id ?? 0`),
/// republishes the cache-then-network `VehicleState` as a `LoadableState`, and
/// projects it at the render boundary. No HTTP lives here — everything routes
/// through `VehiclesStore`.
@MainActor
@Observable
public final class BatteryRadialGaugeModel {
    @ObservationIgnored private let store: VehiclesStore
    @ObservationIgnored private let explicitVehicleID: Int64?
    @ObservationIgnored private let telemetry: DashboardWidgetTelemetry

    @ObservationIgnored private let vehiclesHolder: StateHolderModel<LoadableState<[Vehicle]>>
    @ObservationIgnored private var stateHolder: StateHolderModel<LoadableState<VehicleStateEnvelope>>?
    @ObservationIgnored private var boundVehicleID: Int64?

    public init(
        store: VehiclesStore,
        vehicleID: Int64?,
        telemetry: DashboardWidgetTelemetry = NoopDashboardWidgetTelemetry()
    ) {
        self.store = store
        explicitVehicleID = vehicleID
        self.telemetry = telemetry
        vehiclesHolder = StateHolderModel(flow: store.vehicles()) { raw in
            guard let resource = raw as? Resource else { return nil }
            return LoadableState.from(resource) { $0 as? [Vehicle] }
        }
    }

    /// The effective vehicle id: the explicit prop, else the first enrolled
    /// vehicle, else `0` (no vehicle yet). Observed, so it tracks the list load.
    public var resolvedVehicleID: Int64 {
        if let explicitVehicleID { return explicitVehicleID }
        let vehicles = vehiclesHolder.state?.value ?? []
        return vehicles.first?.id ?? 0
    }

    /// The fully-resolved render input the view switches over.
    public var renderState: BatteryRadialGaugeRenderState {
        guard let loadable = stateHolder?.state else {
            // No vehicle bound yet: skeleton while the list loads, else empty.
            let vehiclesLoading = vehiclesHolder.state?.isLoading ?? true
            return BatteryRadialGaugeRenderState(
                phase: vehiclesLoading ? .loading : .content,
                projection: nil,
                isStale: false,
                isOffline: false,
                isFetching: false
            )
        }
        return BatteryRadialGaugeRenderState.resolve(
            projection: Self.project(loadable.value),
            isLoading: loadable.isLoading,
            error: Self.classify(loadable.error),
            isStale: loadable.isStale,
            isFetching: Self.isFetching(loadable)
        )
    }

    /// Begins observing: emits the `view.opened` diagnostic, starts the vehicle
    /// list feed, and binds the state feed for the currently-resolved vehicle.
    public func start() {
        BatteryRadialGaugeWidget.reportOpen(to: telemetry)
        vehiclesHolder.start()
        bindState(to: resolvedVehicleID)
    }

    /// Stops observing and tears down both upstream subscriptions.
    public func stop() {
        vehiclesHolder.stop()
        stateHolder?.stop()
    }

    /// (Re)binds the state feed when the resolved vehicle changes. A no-op for an
    /// unresolved (`0`) id or when already bound to [id].
    public func bindState(to id: Int64) {
        guard id > 0, boundVehicleID != id else { return }
        rebind(to: id)
    }

    /// Re-subscribes the current state feed (the web `refetch()` affordance):
    /// replays the cached value immediately and re-pulls cache-then-network.
    public func refresh() {
        let id = boundVehicleID ?? resolvedVehicleID
        guard id > 0 else { return }
        rebind(to: id)
    }

    private func rebind(to id: Int64) {
        stateHolder?.stop()
        let holder = makeStateHolder(for: id)
        holder.start()
        stateHolder = holder
        boundVehicleID = id
    }

    private func makeStateHolder(for id: Int64) -> StateHolderModel<LoadableState<VehicleStateEnvelope>> {
        StateHolderModel(flow: store.vehicleState(vehicleId: id, asOf: nil)) { raw in
            guard let resource = raw as? Resource else { return nil }
            return LoadableState.from(resource) { $0 as? VehicleStateEnvelope }
        }
    }

    /// Projects the SI `VehicleState` envelope into the pure display model.
    ///
    /// `charge_limit_soc` is absent from the frozen OpenAPI contract
    /// (`api/openapi/teslasync.openapi.json` → `VehicleState`), so there is no
    /// typed source for the charge-limit ring on native; it stays `nil` until the
    /// contract adds the field (the projection still supports it for parity).
    static func project(_ envelope: VehicleStateEnvelope?) -> BatteryGaugeProjection? {
        guard let state = envelope?.state else { return nil }
        return BatteryGaugeProjection(
            batteryLevel: Double(state.batteryLevel),
            chargeLimitSoc: nil,
            isCharging: state.isCharging
        )
    }

    private static func classify(_ error: FacadeError?) -> BatteryGaugeLoadError? {
        guard let error else { return nil }
        if error == .offline { return .offline }
        return error.isRetryable ? .retryable : .fatal
    }

    private static func isFetching(_ state: LoadableState<VehicleStateEnvelope>) -> Bool {
        if case let .loading(cached, _) = state { return cached != nil }
        return false
    }
}
