//
//  VehicleHeader.swift
//  TeslaSync — P4 feature view · 0305 · VehicleHeader (Apple)
//
//  The vehicle header — the SwiftUI parity of
//  features/vehicles/components/VehicleHeader.tsx. Renders the web source's composition
//  (the `FadeIn` wrapper, the back button, the `h1` display-name title, the shared
//  `StatusBadge`, the muted `model · trim · VIN` subtitle, and the "Wake Up" button)
//  plus the P4 leaf contract states. Binds through `VehicleHeaderModel` (P1/S8); no
//  networking lives here.
//
//  States (every one renders — no hidden surface):
//    • loading  — initial fetch → skeleton chrome (web parent `isLoading`).
//    • empty    — resolved with no vehicle → friendly "Vehicle unavailable", never a
//                 blank box.
//    • error    — parent query failure → retry affordance (web `QueryError` peer).
//    • data     — the full header (back · title + status · subtitle · Wake Up).
//    • stale / offline — the orthogonal `connection` axis → freshness chip beneath the
//                 header with a one-shot auto-refresh on the stale transition.
//

import SwiftUI

// MARK: - VehicleHeader (the feature surface)

/// The vehicle header — the SwiftUI parity of
/// `features/vehicles/components/VehicleHeader.tsx`. Renders every state from the web
/// source plus the P4 leaf freshness states, binding through `VehicleHeaderModel`.
public struct VehicleHeader: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let surfaceSlug = VehicleHeaderSurface.slug

    @State private var model: VehicleHeaderModel

    public init(model: VehicleHeaderModel) {
        _model = State(initialValue: model)
    }

    public var body: some View {
        // Web `<FadeIn>` wraps the entire header; the freshness chip is the P4 leaf
        // addition rendered beneath the row when the feed is not live.
        TSFadeIn {
            VStack(alignment: .leading, spacing: TSSpacing.sm) {
                content
                if model.connection != .live {
                    VehicleHeaderFreshnessChip(connection: model.connection) {
                        model.refresh()
                    }
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
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
