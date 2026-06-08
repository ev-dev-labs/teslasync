//
//  ActiveOrdersSection.Previews.swift
//  TeslaSync — P4 feature view · 0196 · ActiveOrdersSection (Apple)
//
//  Xcode previews — one per state the surface produces: content (a populated order
//  grid), empty-after-sync (web `noOrders`), no-data (web `noData`), loading
//  (skeleton chrome), error (fetch failed → retry), and the stale / offline
//  freshness variants. Preview-only; excluded from release builds via `#if DEBUG`.
//

#if DEBUG
    import SwiftUI

    /// A no-op telemetry sink so previews don't emit diagnostics.
    private struct SilentOrdersTelemetry: ActiveOrdersTelemetry {
        func viewOpened(surface _: String) {}
    }

    /// A no-op toast sink so previews don't present toasts.
    private struct SilentOrdersToast: ActiveOrdersToast {
        func success(_: String) {}
        func error(_: String, _: String) {}
    }

    /// Sample orders + a fixed sync timestamp for the populated previews.
    private enum OrdersPreviewData {
        static let syncedAt = Date(timeIntervalSince1970: 1_775_000_000)

        static let orders: [TeslaOrderDTO] = [
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
        ]
    }

    @MainActor
    private func ordersPreview(_ update: OrdersUpdate) -> ActiveOrdersSection {
        ActiveOrdersSection(
            model: ActiveOrdersModel(
                source: InMemoryActiveOrdersSource(initial: update),
                telemetry: SilentOrdersTelemetry(),
                toast: SilentOrdersToast()
            )
        )
    }

    #Preview("Content") {
        ordersPreview(
            OrdersUpdate(
                status: .loaded,
                orders: OrdersPreviewData.orders,
                fetchedAt: OrdersPreviewData.syncedAt,
                connection: .live
            )
        )
        .padding()
        .frame(maxWidth: 640)
    }

    #Preview("Empty (synced)") {
        ordersPreview(
            OrdersUpdate(status: .loaded, orders: [], fetchedAt: OrdersPreviewData.syncedAt, connection: .live)
        )
        .padding()
        .frame(maxWidth: 640)
    }

    #Preview("Empty (no data)") {
        ordersPreview(OrdersUpdate(status: .loaded, orders: [], fetchedAt: nil, connection: .live))
            .padding()
            .frame(maxWidth: 640)
    }

    #Preview("Loading") {
        ordersPreview(OrdersUpdate(status: .loading, orders: [], fetchedAt: nil, connection: .live))
            .padding()
            .frame(maxWidth: 640)
    }

    #Preview("Error") {
        ordersPreview(
            OrdersUpdate(status: .failed("Request timed out"), orders: [], fetchedAt: nil, connection: .live)
        )
        .padding()
        .frame(maxWidth: 640)
    }

    #Preview("Stale") {
        ordersPreview(
            OrdersUpdate(
                status: .loaded,
                orders: OrdersPreviewData.orders,
                fetchedAt: OrdersPreviewData.syncedAt,
                connection: .stale
            )
        )
        .padding()
        .frame(maxWidth: 640)
    }

    #Preview("Offline") {
        ordersPreview(
            OrdersUpdate(
                status: .loaded,
                orders: OrdersPreviewData.orders,
                fetchedAt: OrdersPreviewData.syncedAt,
                connection: .offline
            )
        )
        .padding()
        .frame(maxWidth: 640)
    }
#endif
