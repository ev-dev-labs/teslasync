//
//  AnomalyInlineRow.swift
//  TeslaSync — P4 feature view · 0238 · AnomalyInlineRow (Apple)
//
//  The anomaly inline-row surface — the SwiftUI parity of
//  features/system/components/status/AnomalyInlineRow.tsx. The web component reads the
//  first vehicle as a sample, queries the 24h anomalies summary, and renders a single
//  `HealthRow` for the most-recent anomaly (or nothing). This surface binds through
//  `AnomalyInlineRowModel` (P1/S8) and switches over the resolved phase so every
//  prompt-required state renders — loading / content / empty / error, with the stale +
//  offline freshness chip — never a blank box. No networking lives here; the
//  click-through routes through the model's activation seam (web `to`).
//

import SwiftUI

/// The anomaly inline Health row — the SwiftUI parity of the web `AnomalyInlineRow`,
/// binding through `AnomalyInlineRowModel` (P1/S8).
public struct AnomalyInlineRow: View {
    @State private var model: AnomalyInlineRowModel

    public init(model: AnomalyInlineRowModel) {
        _model = State(initialValue: model)
    }

    public var body: some View {
        content
            .onAppear { model.start() }
            .onDisappear { model.stop() }
            .accessibilityElement(children: .contain)
    }

    /// The web outcome (a `HealthRow` or `null`), widened with the loading + friendly
    /// empty + error envelopes so no state is hidden behind a blank row.
    @ViewBuilder
    private var content: some View {
        switch model.phase {
        case .loading:
            AnomalyInlineRowLoadingState()
        case let .content(content):
            AnomalyInlineRowContentRow(
                content: content,
                connection: model.connection,
                activate: { model.activate(content.destination) }
            )
        case .empty:
            AnomalyInlineRowEmptyState()
        case let .error(message):
            AnomalyInlineRowErrorState(message: message) { model.refresh() }
        }
    }
}

// MARK: - Surface identity

public extension AnomalyInlineRow {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    static var surfaceSlug: String {
        AnomalyInlineRowSurface.slug
    }
}
