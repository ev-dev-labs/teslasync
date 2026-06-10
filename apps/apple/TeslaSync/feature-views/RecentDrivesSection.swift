//
//  RecentDrivesSection.swift
//  TeslaSync — P4 feature view · 0297 · RecentDrivesSection (Apple)
//
//  The recent-drives section — the SwiftUI parity of
//  features/vehicles/components/vehicle-detail/RecentDrivesSection.tsx. Fades in on appear (web
//  `FadeIn`) inside a `TSGlassPanel` (web `GlassPanel`), shows the always-on header (route glyph
//  + "Recent Drives" + freshness chip + "View all" link), surfaces a cached-data banner when
//  the bound live-state is not fresh, and switches over the model's resolved phase so every
//  prompt-required state renders (loading / empty / error / content, with the inline-error +
//  stale + offline branches) — never a blank box. Binds through `RecentDrivesModel` (P1/S8); no
//  networking lives here.
//

import SwiftUI

/// The recent-drives section view, binding through `RecentDrivesModel` (P1/S8).
public struct RecentDrivesSection: View {
    @State private var model: RecentDrivesModel

    public init(model: RecentDrivesModel) {
        _model = State(initialValue: model)
    }

    public var body: some View {
        TSFadeIn(delay: 0.05) {
            TSGlassPanel {
                VStack(alignment: .leading, spacing: TSSpacing.lg) {
                    if model.connection != .live {
                        RecentDrivesConnectivityBanner(connection: model.connection)
                    }
                    RecentDrivesHeader(model: model)
                    body(for: model.phase)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
            }
        }
        .onAppear { model.start() }
        .onDisappear { model.stop() }
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Text(verbatim: model.accessibilitySummary))
    }

    /// The web body branch under the header: the populated table for `.content`, else the
    /// loading / empty / error envelopes so no state is hidden behind a blank panel.
    @ViewBuilder
    private func body(for phase: RecentDrivesPhase) -> some View {
        switch phase {
        case .loading:
            RecentDrivesLoadingState()
        case .empty:
            RecentDrivesEmptyState()
        case let .error(message):
            RecentDrivesErrorState(message: message) { model.refresh() }
        case .content:
            RecentDrivesContent(model: model)
        }
    }
}

// MARK: - Surface identity

public extension RecentDrivesSection {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    static var surfaceSlug: String {
        RecentDrivesSurface.slug
    }
}
