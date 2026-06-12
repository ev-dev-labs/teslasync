import SwiftUI

/// Native SwiftUI parity of `web/src/features/admin/pages/TeslaOrdersPage.tsx`
/// (route `/tesla-orders`). The web page is a thin `PageContainer` wrapper — a page
/// title + subtitle — around the shared `<ActiveOrdersSection />`. This reproduces
/// that 1:1: the web `PageContainer` chrome (title + subtitle) above the embedded
/// `ActiveOrdersSection`, which owns all of the data, the header refresh action, and
/// every load state (loading / content / the two empty messages / error / stale /
/// offline) through its `@Observable ActiveOrdersModel` (P1/S8). No networking lives
/// here — exactly like the web page, which has no state of its own.
///
/// Adaptive (ADR-002/006): a single leading-aligned column inside a `ScrollView` that
/// fills the regular-width macOS/iPad canvas and the compact iPhone width alike; the
/// embedded section lays its own order grid out adaptively. All copy resolves from
/// `Localizable.xcstrings` with the web key names — `orders.title` →
/// `translation.orders.title`, `orders.subtitle` → `translation.orders.subtitle` —
/// so there are zero hardcoded literals. Units (none on this surface) would format at
/// the display boundary via the shared SI converters (P1/S5).
public struct TeslaOrdersPage: View {
    @State private var model: ActiveOrdersModel

    public init(model: ActiveOrdersModel) {
        _model = State(initialValue: model)
    }

    public var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: TSSpacing.x2xl) {
                header
                ActiveOrdersSection(model: model)
            }
            .padding(TSSpacing.lg)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .background(Color.TS.bg.ignoresSafeArea())
    }

    // MARK: - Header (web PageContainer title + subtitle)

    private var header: some View {
        VStack(alignment: .leading, spacing: TSSpacing.xs) {
            TSPageTitle("translation.orders.title")
            Text("translation.orders.subtitle")
                .font(Font.TS.body)
                .foregroundStyle(Color.TS.textSecondary)
                .fixedSize(horizontal: false, vertical: true)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .combine)
    }
}

#if DEBUG
    /// A representative populated snapshot reused across the previews.
    @MainActor
    private func ordersPreviewModel(_ update: OrdersUpdate) -> ActiveOrdersModel {
        ActiveOrdersModel(source: InMemoryActiveOrdersSource(initial: update))
    }

    private let ordersPreviewOrders: [TeslaOrderDTO] = [
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

    #Preview("Content") {
        TeslaOrdersPage(
            model: ordersPreviewModel(
                OrdersUpdate(
                    status: .loaded,
                    orders: ordersPreviewOrders,
                    fetchedAt: Date(timeIntervalSince1970: 1_775_000_000),
                    connection: .live
                )
            )
        )
        .teslaSyncTheme()
    }

    #Preview("Empty (no data)") {
        TeslaOrdersPage(
            model: ordersPreviewModel(OrdersUpdate(status: .loaded, orders: [], fetchedAt: nil, connection: .live))
        )
        .teslaSyncTheme()
    }

    #Preview("Loading") {
        TeslaOrdersPage(
            model: ordersPreviewModel(OrdersUpdate(status: .loading, orders: [], fetchedAt: nil, connection: .live))
        )
        .teslaSyncTheme()
    }

    #Preview("Error") {
        TeslaOrdersPage(
            model: ordersPreviewModel(
                OrdersUpdate(status: .failed("Request timed out"), orders: [], fetchedAt: nil, connection: .live)
            )
        )
        .teslaSyncTheme()
    }
#endif
