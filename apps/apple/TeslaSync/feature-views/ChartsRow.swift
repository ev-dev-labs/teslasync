//
//  ChartsRow.swift
//  TeslaSync — P4 feature view · 0099 · ChartsRow (Apple)
//
//  The charging-list charts row — the SwiftUI parity of the web
//  features/charging/components/charging-list/ChartsRow.tsx. Renders the two glass
//  panels (Energy & Cost Trend area+line chart, Charger Breakdown donut + cost-by-type
//  legend) in a responsive 1-up / 2-up grid (web `grid-cols-1 lg:grid-cols-2`), each
//  faded in (web `FadeIn`), and every state (loading / loaded / per-panel empty / error
//  / stale / offline) — binding through `ChartsRowModel` (P1/S8). No networking lives
//  here — the web component takes the three arrays as props; the native model is fed by
//  a `ChartsRowSource`.
//

import SwiftUI

// MARK: - String facade `Text` helper (kept here so the Model layer stays SwiftUI-free)

public extension ChartsRowStrings {
    /// A `Text` for a facade key, rendered verbatim so the resolved (possibly localized)
    /// value is never re-interpreted as a SwiftUI string key.
    static func text(_ key: String, _ fallback: String) -> Text {
        Text(verbatim: string(key, fallback))
    }
}

// MARK: - ChartsRow (the feature surface)

/// The charging charts row. Switches over the model's render phase and, in the loaded
/// phase, composes the two panels (each self-empties rather than hiding, matching the
/// web) in a responsive grid above an optional freshness banner.
public struct ChartsRow: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let surfaceSlug = "ChartsRow"

    @State private var model: ChartsRowModel

    /// - Parameter model: the bound view-model (built over a `ChartsRowSource`).
    public init(model: ChartsRowModel) {
        _model = State(initialValue: model)
    }

    public var body: some View {
        content
            .frame(maxWidth: .infinity, alignment: .leading)
            .onAppear { model.start() }
            .onDisappear { model.stop() }
            .accessibilityElement(children: .contain)
            .accessibilityLabel(ChartsRowStrings.text("charging.charts.a11y", "Charging charts"))
    }

    @ViewBuilder
    private var content: some View {
        switch model.phase {
        case .loading:
            ChartsRowSkeleton()
        case let .error(message):
            ChartsRowErrorView(message: message) { model.refresh() }
        case .loaded:
            loadedContent
        }
    }

    private var loadedContent: some View {
        VStack(alignment: .leading, spacing: TSSpacing.lg) {
            if model.connection != .live {
                ChartsRowFreshnessBanner(connection: model.connection) { model.refresh() }
            }
            LazyVGrid(columns: Self.gridColumns, alignment: .leading, spacing: TSSpacing.lg) {
                TSFadeIn(delay: 0.10) {
                    ChartsRowEnergyPanel(
                        points: model.energyTrend,
                        scale: model.energyScale,
                        localize: model.localize,
                        formatting: model.formatting
                    )
                }
                TSFadeIn(delay: 0.15) {
                    ChartsRowBreakdownPanel(
                        donut: model.donut,
                        rows: model.costByType,
                        localize: model.localize,
                        formatting: model.formatting
                    )
                }
            }
        }
    }

    /// Web `grid-cols-1 lg:grid-cols-2`: a single column when the surface is narrow
    /// (iPhone portrait), two columns once there is room (iPad / macOS / regular width).
    /// Shared with `ChartsRowSkeleton` so the loading chrome matches the loaded layout.
    static let gridColumns = [
        GridItem(.adaptive(minimum: 340), spacing: TSSpacing.lg, alignment: .top)
    ]
}
