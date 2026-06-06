import Foundation
import Observation
import Shared

/// Representative typed domain facade: vehicle settings.
///
/// Demonstrates the pattern every domain follows — an `@Observable` model that
/// adapts an injected shared-core holder (`VehicleSettingsStore`), projecting its
/// `StateFlow<Resource<VehicleSettingsResponse>>` into a native `LoadableState`
/// and exposing actions as `async`. The store is injected (built by
/// `AppContainer`), so this type never names a shared-core constructor.
///
/// The remaining ~60 domains bind through this exact shape (or the generic
/// `StateHolderModel`) as their pages land in P7 — no bespoke per-DTO wrappers.
@MainActor
@Observable
public final class VehicleSettingsModel {
    @ObservationIgnored private let store: SharedVehicleSettingsStore
    @ObservationIgnored private let vehicleID: String
    @ObservationIgnored private let holder: StateHolderModel<LoadableState<SharedVehicleSettingsResponse>>

    public init(store: SharedVehicleSettingsStore, vehicleID: String) {
        self.store = store
        self.vehicleID = vehicleID
        let flow = store.vehicleSettings(vehicleId: vehicleID)
        holder = StateHolderModel(flow: flow) { raw in
            guard let resource = raw as? SharedResource else { return nil }
            return LoadableState.from(resource) { $0 as? SharedVehicleSettingsResponse }
        }
    }

    /// The current cache-then-network state for this vehicle's settings.
    public var settings: LoadableState<SharedVehicleSettingsResponse> {
        holder.state ?? .idle
    }

    /// Begins observing the settings feed.
    public func start() {
        holder.start()
    }

    /// Stops observing and closes the upstream subscription.
    public func stop() {
        holder.stop()
    }

    /// Forces a network refresh of the settings feed (cache stays visible).
    public func refresh() {
        store.refreshSettingsFeed(vehicleId: vehicleID)
    }
}
