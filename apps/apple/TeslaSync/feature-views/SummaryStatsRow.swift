//
//  SummaryStatsRow.swift
//  TeslaSync — P4 feature view · 0048 · SummaryStatsRow (Apple)
//
//  The composable security-access summary stats row — the SwiftUI parity of
//  features/admin/components/security-access/SummaryStatsRow.tsx. Binds through
//  `SummaryStatsModel` (no networking in the view) and renders both branches the
//  web leaf has: the in-flight skeleton row (web `isLoading`) and the resolved row
//  of four metric tiles (current status · last lock change · sentry uptime · total
//  events). The web component is a pure presentational leaf fed by its parent
//  (SecurityStatusCards), so error / empty / stale / offline lifecycle chrome is
//  owned by the parent surface and is intentionally not duplicated at this leaf;
//  the only per-value "no data" case — a missing last-lock timestamp — is rendered
//  as the web's em-dash sentinel rather than a blank tile.
//

import SwiftUI

/// The composable security-access summary stats row — the SwiftUI parity of
/// `features/admin/components/security-access/SummaryStatsRow.tsx`. Renders the
/// loading and resolved branches from the web source, binding through
/// `SummaryStatsModel` (P1/S8). No networking lives here.
public struct SummaryStatsRow: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let surfaceSlug = "SummaryStatsRow"

    @State private var model: SummaryStatsModel

    public init(model: SummaryStatsModel) {
        _model = State(initialValue: model)
    }

    public var body: some View {
        content
            .frame(maxWidth: .infinity, alignment: .leading)
            .onAppear { model.start() }
            .onDisappear { model.stop() }
            .accessibilityElement(children: .contain)
    }

    @ViewBuilder
    private var content: some View {
        switch model.phase {
        case .loading:
            SSRLoadingRow()
        case .data:
            SSRStatsRow(tiles: model.tiles)
        }
    }
}
