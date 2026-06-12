import SwiftUI

/// Registers the native Active Orders surface for the `.teslaOrders` route so the app
/// shell's route host renders it (web `/tesla-orders`). Mirrors
/// `SchemaDriftRouteRegistration` / `DiskForecastRouteRegistration`: the `@Observable`
/// `ActiveOrdersModel` is built on the main actor here and captured, so the escaping
/// registry closure never constructs an isolated type.
///
/// `/tesla-orders` is a top-level web route in the Account side-nav group, so it maps
/// directly to the `.teslaOrders` `AppRoute` — the parser keys on the first path
/// segment, so no alias is needed — and is reachable via the Account-group sidebar
/// entry and any `/tesla-orders` deep link.
///
/// The bound `ActiveOrdersSource` defaults to a representative local seed (mirroring
/// the sibling Disk Forecast's `SampleDiskForecastDataSource` default) so the page
/// renders its populated state out of the box. It is NOT production telemetry:
/// production composition injects the shared P1/S8 source over the KMP core (web
/// `useTeslaUserOrders` + `useRefreshTeslaOrders`).
public enum TeslaOrdersRouteRegistration {
    @MainActor
    public static func registry(
        base: AppRouteHostRegistry = AppRouteHostRegistry(),
        source: (any ActiveOrdersSource)? = nil
    ) -> AppRouteHostRegistry {
        var registry = base
        let model = ActiveOrdersModel(source: source ?? sampleSource())
        registry.register(.teslaOrders) {
            TeslaOrdersPage(model: model)
        }
        return registry
    }

    /// A representative local seed used as the page default until the KMP-backed
    /// source is injected at composition time. Seeds two active orders + a sync
    /// timestamp so the populated grid renders out of the box; NOT production data.
    @MainActor
    static func sampleSource() -> any ActiveOrdersSource {
        InMemoryActiveOrdersSource(
            initial: OrdersUpdate(
                status: .loaded,
                orders: [
                    TeslaOrderDTO(
                        id: 1,
                        orderID: "RN401234567",
                        model: "Model 3",
                        status: "IN_PRODUCTION",
                        deliveryDate: "2026-04-15",
                        vin: nil,
                        isUpgradable: true
                    ),
                    TeslaOrderDTO(
                        id: 2,
                        orderID: "RN409876543",
                        model: "Model Y",
                        status: "READY_FOR_DELIVERY",
                        deliveryDate: "2026-05-02",
                        vin: "5YJ3E1EA7PF000000",
                        isUpgradable: false
                    )
                ],
                fetchedAt: Date(timeIntervalSince1970: 1_775_000_000),
                connection: .live
            )
        )
    }
}
