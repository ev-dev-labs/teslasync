//
//  CostHeatmap.swift
//  TeslaSync — P4 feature view · 0100 · CostHeatmap (Apple)
//
//  The charging cost-heatmap surface — the SwiftUI parity of the web
//  features/charging/components/charging-list/CostHeatmap.tsx. Renders the glass
//  panel (clock-titled "Charging Cost Heatmap", the 7×24 day×hour grid, the
//  cheap→expensive legend) and every state (loading / loaded / empty / error /
//  stale / offline), binding through `CostHeatmapModel` (P1/S8). No networking lives
//  here — the web component takes `heatmap` + `peakCostPerKwh` as props; the native
//  model is fed by a `CostHeatmapSource`.
//

import SwiftUI

// MARK: - String facade `Text` helper (kept here so the Model layer stays SwiftUI-free)

public extension CostHeatmapStrings {
    /// A `Text` for a facade key, rendered verbatim so the resolved (possibly
    /// localized) value is never re-interpreted as a SwiftUI string key.
    static func text(_ key: String, _ fallback: String) -> Text {
        Text(verbatim: string(key, fallback))
    }
}

// MARK: - CostHeatmap (the feature surface)

/// The charging cost-heatmap surface. Switches over the model's render phase and, in
/// the loaded phase, composes an optional freshness banner above the heatmap panel
/// (which self-empties rather than hiding, matching the web).
public struct CostHeatmap: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let surfaceSlug = "CostHeatmap"

    @State private var model: CostHeatmapModel

    /// - Parameter model: the bound view-model (built over a `CostHeatmapSource`).
    public init(model: CostHeatmapModel) {
        _model = State(initialValue: model)
    }

    public var body: some View {
        content
            .frame(maxWidth: .infinity, alignment: .leading)
            .onAppear { model.start() }
            .onDisappear { model.stop() }
            .accessibilityElement(children: .contain)
            .accessibilityLabel(CostHeatmapStrings.text("charging.optimizer.heatmap.a11y", "Charging cost heatmap"))
    }

    @ViewBuilder
    private var content: some View {
        switch model.phase {
        case .loading:
            CostHeatmapSkeleton()
        case let .error(message):
            CostHeatmapErrorView(message: message) { model.refresh() }
        case .loaded:
            loadedContent
        }
    }

    private var loadedContent: some View {
        VStack(alignment: .leading, spacing: TSSpacing.md) {
            if model.connection != .live {
                CostHeatmapFreshnessBanner(connection: model.connection) { model.refresh() }
            }
            CostHeatmapPanel(model: model)
        }
    }
}
