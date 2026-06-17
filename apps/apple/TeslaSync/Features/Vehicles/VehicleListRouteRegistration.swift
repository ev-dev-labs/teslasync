import SwiftUI

/// Navigation registration for the Vehicles **Fleet list** page. The web route `/vehicles` is
/// value-less, so it is modeled natively as a typed `NavigationDestination` marker: a host stack
/// adopts `.vehicleListDestination()` and pushes a `VehicleListLink()` to open the page, so it is
/// reachable + deep-linkable on the macOS / iPad detail column and the iPhone stack (ADR-002/006)
/// without widening the shared `AppRoute` enum. Mirrors the sibling `VehicleDetailRouteRegistration`
/// shape (the `@Observable` model is built inside the main-actor view builder, keeping the escaping
/// destination / data-source / navigation closures free of business logic, ADR-004).
public struct VehicleListLink: Hashable, Sendable {
    public init() {}
}

public extension View {
    /// Registers `VehicleListPage` as the `NavigationDestination` for a `VehicleListLink`, so any host
    /// stack can deep-link into the Fleet list (web `/vehicles`). `onOpenVehicle` opens one vehicle's
    /// detail (web row `Link to={/vehicles/:id}`); `onCompare` opens the pre-filled comparison (web
    /// `navigate('/vehicle-comparison?leftId=&rightId=')`).
    func vehicleListDestination(
        dataSource: @escaping @Sendable () -> any VehicleListDataSource = { SampleVehicleListDataSource() },
        onOpenVehicle: @escaping (Int64) -> Void = { _ in },
        onCompare: @escaping (Int64, Int64) -> Void = { _, _ in }
    ) -> some View {
        navigationDestination(for: VehicleListLink.self) { _ in
            VehicleListPage(
                dataSource: dataSource(),
                onOpenVehicle: onOpenVehicle,
                onCompare: onCompare
            )
        }
    }
}

/// Factory namespace mirroring the routed pages' `…RouteRegistration` shape, for hosts that want a
/// ready-built screen without constructing the model, plus a forwarder that resolves the web
/// `/vehicles` path to a `VehicleListLink`.
public enum VehicleListRouteRegistration {
    /// Builds the Fleet list screen for the given data source + navigation callbacks (default = sample).
    @MainActor
    public static func make(
        dataSource: any VehicleListDataSource = SampleVehicleListDataSource(),
        onOpenVehicle: @escaping (Int64) -> Void = { _ in },
        onCompare: @escaping (Int64, Int64) -> Void = { _, _ in }
    ) -> VehicleListPage {
        VehicleListPage(dataSource: dataSource, onOpenVehicle: onOpenVehicle, onCompare: onCompare)
    }

    /// Resolves the web route `/vehicles` (with optional trailing slash / query) to a
    /// `VehicleListLink`; any other path (including the `/vehicles/:id` detail route) returns `nil`.
    public static func link(forPath rawPath: String) -> VehicleListLink? {
        let withoutQuery = rawPath.split(separator: "?", maxSplits: 1).first.map(String.init) ?? rawPath
        var normalized = withoutQuery
        while normalized.count > 1, normalized.hasSuffix("/") {
            normalized.removeLast()
        }
        return normalized == "/vehicles" ? VehicleListLink() : nil
    }
}
