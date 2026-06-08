//
//  LifetimeSummary.swift
//  TeslaSync — P4 feature view · 0114 · LifetimeSummary (Apple)
//
//  The composable cost-analysis Lifetime Summary section — the SwiftUI parity of
//  features/charging/components/cost-analysis/LifetimeSummary.tsx. Binds through
//  `LifetimeSummaryModel` (no networking in the view) and renders every state the P4
//  surface contract requires: loading · error · empty ("No data") · data (the seven
//  lifetime-metric tiles) plus the stale / offline overlays. The always-visible header
//  sits above the state body, exactly like the web `GlassPanel` title row.
//

import SwiftUI

/// The composable cost-analysis Lifetime Summary section — the SwiftUI parity of
/// `features/charging/components/cost-analysis/LifetimeSummary.tsx`. Renders every state
/// from the surface contract, binding through `LifetimeSummaryModel` (P1/S8). No
/// networking lives here.
public struct LifetimeSummary: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let surfaceSlug = "LifetimeSummary"

    @State private var model: LifetimeSummaryModel

    public init(model: LifetimeSummaryModel) {
        _model = State(initialValue: model)
    }

    public var body: some View {
        TSFadeIn(delay: 0.2) {
            VStack(alignment: .leading, spacing: TSSpacing.lg) {
                LSSectionHeader(
                    isFetching: model.isFetching,
                    isStale: model.isStale,
                    isOffline: model.isOffline
                )
                stateBody
            }
            .padding(TSSpacing.lg)
            .frame(maxWidth: .infinity, alignment: .leading)
            .tsGlassPanel()
        }
        .onAppear { model.start() }
        .onDisappear { model.stop() }
        .accessibilityElement(children: .contain)
    }

    @ViewBuilder
    private var stateBody: some View {
        switch model.phase {
        case .loading:
            LSLoadingBody()
        case let .error(message):
            LSErrorBody(message: message) { model.refresh() }
        case .empty:
            LSEmptyBody()
        case .data:
            LSDataBody(tiles: model.tiles)
        }
    }
}
