//
//  VehicleGauges.swift
//  TeslaSync — P4 feature view · 0304 · VehicleGauges (Apple)
//
//  The vehicle-detail gauges cluster — the SwiftUI parity of
//  features/vehicles/components/VehicleGauges.tsx. Renders the web source's composition (the
//  car visualization, the four radial gauges, the battery / range / charge-rate metric bars,
//  and the lock / sentry / climate / software chips) plus the P4 leaf contract states. Binds
//  through `VehicleGaugesModel` (P1/S8); no networking lives here.
//
//  States (every one renders — no hidden surface):
//    • loading  — initial fetch, no snapshot yet → skeleton chrome (web parent `isLoading`).
//    • empty    — resolved with no vehicle state → friendly empty state, never a blank box.
//    • error    — parent query failure with no cached state → retry affordance (web
//                 `QueryError` peer).
//    • data     — the car viz + gauges + bars + chips projected from the vehicle state.
//    • stale / offline — the orthogonal `connection` axis → a banner with a refresh affordance
//                 and a one-shot auto-refresh on the stale transition; cached content stays
//                 visible beneath it.
//

import SwiftUI

// MARK: - VehicleGauges (the feature surface)

/// The vehicle-detail gauges cluster — the SwiftUI parity of
/// `features/vehicles/components/VehicleGauges.tsx`. Renders every state from the web source
/// plus the P4 leaf freshness states, binding through `VehicleGaugesModel`.
public struct VehicleGauges: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let surfaceSlug = VehicleGaugesSurface.slug

    @State private var model: VehicleGaugesModel

    public init(model: VehicleGaugesModel) {
        _model = State(initialValue: model)
    }

    public var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.lg) {
            if model.connection != .live {
                VehicleGaugesConnectivityBanner(connection: model.connection) { model.refresh() }
            }
            content
        }
        .vehicleGaugesSurface()
        .onAppear { model.start() }
        .onDisappear { model.stop() }
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Text(verbatim: VehicleGaugesStrings.string("vehicleGauges.title", "Vehicle gauges")))
    }

    @ViewBuilder
    private var content: some View {
        switch model.phase {
        case .loading:
            VehicleGaugesLoadingView()
        case .empty:
            VehicleGaugesEmptyView()
        case let .error(message):
            VehicleGaugesErrorView(message: message) { model.refresh() }
        case .data:
            if let content = model.content {
                VehicleGaugesContentView(content: content)
            } else {
                VehicleGaugesEmptyView()
            }
        }
    }
}
