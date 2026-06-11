//
//  LiveStateIndicators.swift
//  TeslaSync — P4 feature view · 0292 · LiveStateIndicators (Apple)
//
//  The live state indicators surface — the SwiftUI parity of
//  features/vehicles/components/vehicle-detail/LiveStateIndicators.tsx. Renders the web
//  source's row of five status chips (Speed · Lock · Sentry · Climate · Charging) in a
//  wrapping flow, plus the P4 leaf-contract states. Binds through
//  `LiveStateIndicatorsModel` (P1/S8); no networking lives here.
//
//  States (every one renders — no hidden surface):
//    • loading  — initial fetch → skeleton chips (web parent `!state` skeleton).
//    • empty    — no reading resolved → friendly empty state, never a blank box.
//    • error    — parent query failure → retry affordance (web `SectionErrorBoundary`).
//    • data     — the full row of five badges.
//    • stale / offline — the orthogonal `connection` axis → freshness chip + banner
//                 with a one-shot auto-refresh on the stale transition.
//

import SwiftUI

// MARK: - LiveStateIndicators (the feature surface)

/// The live state indicators surface — the SwiftUI parity of
/// `features/vehicles/components/vehicle-detail/LiveStateIndicators.tsx`. Renders every
/// state from the web source plus the P4 leaf freshness states, binding through
/// `LiveStateIndicatorsModel`.
public struct LiveStateIndicators: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let surfaceSlug = "LiveStateIndicators"

    @State private var model: LiveStateIndicatorsModel

    public init(model: LiveStateIndicatorsModel) {
        _model = State(initialValue: model)
    }

    public var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.sm) {
            if model.connection != .live {
                LiveStateIndicatorsConnectivityBanner(connection: model.connection)
            }
            content
                .frame(maxWidth: .infinity, alignment: .leading)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .onAppear { model.start() }
        .onDisappear { model.stop() }
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Text(verbatim: LiveStateIndicatorsStrings.string(
            "liveState.a11yLabel",
            "Live state indicators"
        )))
    }
}

// MARK: - Content states (web row + the P4 leaf contract)

private extension LiveStateIndicators {
    @ViewBuilder
    var content: some View {
        switch model.phase {
        case .loading:
            LiveStateIndicatorsLoadingView()
        case .empty:
            LiveStateIndicatorsEmptyView()
        case let .error(message):
            LiveStateIndicatorsErrorView(message: message) { model.refresh() }
        case let .data(projection):
            LiveStateIndicatorsRow(projection: projection)
        }
    }
}
