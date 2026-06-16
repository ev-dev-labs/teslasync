import SwiftUI

/// Navigation registration for the **unrouted** `TriggerConfigurator` parity unit.
///
/// The web source is `(unrouted)` — `TriggerConfigurator` is a composable section the `/automations`
/// builder page renders inline, not a standalone route. So rather than claim a top-level `AppRoute`
/// (which would hijack a sibling unit's route), this exposes the screen as a typed
/// `NavigationDestination` (a deep-link value) any `NavigationStack` can host: a host adopts
/// `.triggerConfiguratorDestination()` and pushes a `TriggerConfiguratorPageLink` to surface the
/// full-screen trigger editor. The model is built by the seam's geofence provider (default = local
/// state), keeping the escaping destination closure free of business logic.
public struct TriggerConfiguratorPageLink: Hashable, Sendable {
    public init() {}
}

public extension View {
    /// Registers the `TriggerConfigurator` screen as a `NavigationDestination` for a
    /// `TriggerConfiguratorPageLink` value, so any host stack can deep-link into it.
    func triggerConfiguratorDestination(
        geofenceProvider: @escaping @Sendable () -> any TriggerConfiguratorGeofenceProviding = {
            DefaultTriggerConfiguratorGeofenceData()
        }
    ) -> some View {
        navigationDestination(for: TriggerConfiguratorPageLink.self) { _ in
            TriggerConfiguratorPage(model: TriggerConfiguratorPageModel(geofenceProvider: geofenceProvider()))
        }
    }
}

/// Factory namespace mirroring the routed pages' `…RouteRegistration` shape, for hosts that want a
/// ready-built screen (e.g., the macOS detail column) without constructing the model.
public enum TriggerConfiguratorPageRouteRegistration {
    /// Builds the screen with the given trigger seed + geofence provider (default = local state).
    @MainActor
    public static func make(
        trigger: AutomationTrigger = .createDefault(.geofence),
        geofenceProvider: any TriggerConfiguratorGeofenceProviding = DefaultTriggerConfiguratorGeofenceData()
    ) -> TriggerConfiguratorPage {
        TriggerConfiguratorPage(model: TriggerConfiguratorPageModel(
            trigger: trigger,
            geofenceProvider: geofenceProvider
        ))
    }
}
