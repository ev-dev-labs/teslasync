//
//  MoreDetailsPanel.swift
//  TeslaSync — P4 feature view · 0145 · MoreDetailsPanel (Apple)
//
//  The composable "More Details" drive-detail feature view — the SwiftUI parity of
//  features/driving/components/drive-detail/MoreDetailsPanel.tsx. Renders every state from the
//  native state shell (loading / empty / error / stale / offline / content) around the two web
//  stat grids (Odometer, Range, Elevation, Energy Consumed/Recovered, Consumption · Avg Power,
//  Avg Outside/Inside Temp, Min Speed, Battery Used, Net Consumption), bound through
//  `MoreDetailsModel` (P1/S8). No networking lives here; the freshness chip + banner reflect the
//  bound source's live-state. The web wraps the panel in `FadeIn` + `GlassPanel`; the native
//  surface maps those to `TSFadeIn` + the `tsGlassPanel()` material.
//

import SwiftUI

/// The composable "More Details" drive-detail surface — the SwiftUI parity of
/// `features/driving/components/drive-detail/MoreDetailsPanel.tsx`, binding through
/// `MoreDetailsModel` (P1/S8). No networking lives here.
public struct MoreDetailsPanel: View {
    @State private var model: MoreDetailsModel

    public init(model: MoreDetailsModel) {
        _model = State(initialValue: model)
    }

    public var body: some View {
        TSFadeIn {
            VStack(alignment: .leading, spacing: TSSpacing.lg) {
                header
                if model.connection != .live {
                    MoreDetailsConnectivityBanner(connection: model.connection)
                }
                content
            }
            .padding(TSSpacing.xl)
            .frame(maxWidth: .infinity, alignment: .leading)
            .tsGlassPanel()
        }
        .onAppear { model.start() }
        .onDisappear { model.stop() }
        .accessibilityElement(children: .contain)
    }
}

// MARK: - Header (web `<h3>` Activity icon + title, freshness chip trailing)

private extension MoreDetailsPanel {
    var header: some View {
        HStack(spacing: TSSpacing.sm) {
            Image(systemName: "waveform.path.ecg")
                .font(.system(size: 15, weight: .semibold))
                .foregroundStyle(Color.TS.accent)
                .accessibilityHidden(true)
            MoreDetailsStrings.text("driveDetail.moreDetails", "More Details")
                .font(Font.TS.panel)
                .fontWeight(.semibold)
                .foregroundStyle(Color.TS.textPrimary)
                .accessibilityAddTraits(.isHeader)
            Spacer(minLength: TSSpacing.sm)
            MoreDetailsFreshnessChip(connection: model.connection)
        }
    }
}

// MARK: - Content (phase switch)

private extension MoreDetailsPanel {
    @ViewBuilder
    var content: some View {
        switch model.phase {
        case .loading:
            MoreDetailsSkeleton()
        case .empty:
            VStack(alignment: .leading, spacing: TSSpacing.md) {
                MoreDetailsBody(tiles: model.tiles)
                MoreDetailsEmptyHint()
            }
        case let .error(message):
            MoreDetailsErrorState(message: message) { model.refresh() }
        case .content:
            MoreDetailsBody(tiles: model.tiles)
        }
    }
}
