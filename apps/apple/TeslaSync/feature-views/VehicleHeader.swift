//
//  VehicleHeader.swift
//  TeslaSync — P4 feature view · 0301 · VehicleHeader (Apple)
//
//  The vehicle-detail header — the SwiftUI parity of
//  features/vehicles/components/vehicle-detail/VehicleHeader.tsx. Renders the web
//  source's composition (the back button, the status badge with its state dot, the
//  neutral model/trim badge, the monospaced VIN, and the "Wake Up" button) plus the P4
//  leaf contract states. Binds through `VehicleHeaderModel` (P1/S8); no networking lives
//  here.
//
//  States (every one renders — no hidden surface):
//    • loading  — initial fetch → skeleton chrome (web parent `isLoading`).
//    • empty    — resolved with no vehicle → friendly "Vehicle unavailable", never a
//                 blank box.
//    • error    — parent query failure → retry affordance (web `QueryError` peer).
//    • data     — the full header (back · status + model badges · VIN · Wake Up).
//    • stale / offline — the orthogonal `connection` axis → freshness chip beneath the
//                 header with a one-shot auto-refresh on the stale transition.
//

import SwiftUI

// MARK: - VehicleHeader (the feature surface)

/// The vehicle-detail header — the SwiftUI parity of
/// `features/vehicles/components/vehicle-detail/VehicleHeader.tsx`. Renders every state
/// from the web source plus the P4 leaf freshness states, binding through
/// `VehicleHeaderModel`.
public struct VehicleHeader: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let surfaceSlug = VehicleHeaderSurface.slug

    @State private var model: VehicleHeaderModel

    public init(model: VehicleHeaderModel) {
        _model = State(initialValue: model)
    }

    public var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.sm) {
            content
            if model.connection != .live {
                VehicleHeaderFreshnessChip(connection: model.connection) {
                    model.refresh()
                }
            }
        }
        .vehicleHeaderSurface()
        .onAppear { model.start() }
        .onDisappear { model.stop() }
        .accessibilityElement(children: .contain)
    }

    @ViewBuilder
    private var content: some View {
        switch model.resolved.phase {
        case .loading:
            VehicleHeaderLoadingView(onBack: { model.goBack() })
        case .empty:
            VehicleHeaderEmptyView(onBack: { model.goBack() })
        case let .error(message):
            VehicleHeaderErrorView(
                message: message,
                onBack: { model.goBack() },
                onRetry: { model.refresh() }
            )
        case .data:
            VehicleHeaderDataRow(
                resolved: model.resolved,
                onWake: { model.wake() },
                onBack: { model.goBack() }
            )
        }
    }
}
