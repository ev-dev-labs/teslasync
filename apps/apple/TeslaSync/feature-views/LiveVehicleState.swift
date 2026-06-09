//
//  LiveVehicleState.swift
//  TeslaSync — P4 feature view · 0044 · LiveVehicleState (Apple)
//
//  The composable Live Vehicle State surface — the SwiftUI parity of
//  features/admin/components/security-access/LiveVehicleState.tsx. Renders the web
//  source's glass panel (the "Live Vehicle State" header with the green pulsing
//  "Live" pill, and the responsive grid of ten live-signal cells) bound through
//  `LiveVehicleStateModel` (P1/S8); no networking lives here. Reproduces every state
//  from the web source — the resolved grid and the `EmptyState` fallback — extended
//  with the Apple HIG states contract: a loading skeleton grid, a QueryError-style
//  failure state with retry, and a freshness chip + banner that keep the last-known
//  grid visible while reconnecting (stale) or offline.
//
//  States (every one renders — no hidden surface):
//    • loading  — initial fetch, no cached event → skeleton grid.
//    • empty    — event resolved with no live signals → web `EmptyState` peer.
//    • error    — fetch failed, no cached event → retry affordance (web `QueryError`).
//    • content  — the full ten-cell grid + the green "Live" pill.
//    • stale / offline — the orthogonal `connection` axis → freshness chip + banner
//                 with a one-shot auto-refresh on the stale transition.
//

import SwiftUI

// MARK: - LiveVehicleState (the security-access surface)

/// The composable Live Vehicle State surface — the SwiftUI parity of
/// `features/admin/components/security-access/LiveVehicleState.tsx`, binding through
/// `LiveVehicleStateModel` (P1/S8). No networking lives here.
public struct LiveVehicleState: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let surfaceSlug = "LiveVehicleState"

    @State private var model: LiveVehicleStateModel

    public init(model: LiveVehicleStateModel) {
        _model = State(initialValue: model)
    }

    public var body: some View {
        TSFadeIn(delay: 0.17) {
            TSGlassPanel {
                VStack(alignment: .leading, spacing: TSSpacing.lg) {
                    header
                    if model.connection != .live {
                        LiveVehicleStateConnectivityBanner(connection: model.connection)
                    }
                    content
                        .frame(maxWidth: .infinity, alignment: .leading)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
            }
        }
        .onAppear { model.start() }
        .onDisappear { model.stop() }
        .accessibilityElement(children: .contain)
        .accessibilityLabel(LiveVehicleStateStrings.text("admin.security.liveState", "Live Vehicle State"))
    }
}

// MARK: - Header (web `<h2>` title + green "Live" pill / freshness chip)

private extension LiveVehicleState {
    /// The always-visible panel header: the web `<h2>{t('admin.security.liveState',
    /// …)}</h2>` title with the green "Live" pill trailing when an event is present
    /// and live, or the freshness chip when the bound source is stale / offline.
    var header: some View {
        HStack(alignment: .firstTextBaseline, spacing: TSSpacing.sm) {
            LiveVehicleStateStrings.text("admin.security.liveState", "Live Vehicle State")
                .font(Font.TS.panel)
                .fontWeight(.semibold)
                .foregroundStyle(Color.TS.textPrimary)
                .accessibilityAddTraits(.isHeader)
            Spacer(minLength: TSSpacing.sm)
            headerTrailing
        }
    }

    /// Web parity: the green pulsing "Live" pill renders only when `latest` is present
    /// (render phase `.content`) and the source is live. When the source is stale /
    /// offline the freshness chip takes its place over the cached grid.
    @ViewBuilder
    var headerTrailing: some View {
        if model.connection != .live {
            LiveVehicleStateFreshnessChip(connection: model.connection)
        } else if model.hasLatest {
            LiveVehicleStateLivePill()
        }
    }
}

// MARK: - Content states (web shell + the P4 leaf contract)

private extension LiveVehicleState {
    @ViewBuilder
    var content: some View {
        switch model.phase {
        case .loading:
            LiveVehicleStateLoadingGrid()
        case .empty:
            LiveVehicleStateEmptyView()
        case let .error(message):
            LiveVehicleStateErrorView(message: message) { model.refresh() }
        case .content:
            LiveVehicleStateGrid(signals: model.signals)
        }
    }
}
