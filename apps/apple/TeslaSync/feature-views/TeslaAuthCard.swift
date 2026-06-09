//
//  TeslaAuthCard.swift
//  TeslaSync — P4 feature view · 0258 · TeslaAuthCard (Apple)
//
//  The operator-grade Tesla-auth status card — the SwiftUI parity of
//  features/system/components/status/TeslaAuthCard.tsx. The card is always rendered (operator-grade
//  visibility); the accent intensifies as the situation worsens (connected → amber when expiring
//  within 7 days → red when expired / disconnected). Binds through `TeslaAuthModel` (P1/S8); no
//  networking lives here.
//
//  States (every one renders — no hidden surface):
//    • loading  — initial fetch → card silhouette skeleton.
//    • empty    — web 'unknown' (resolved, no concrete auth value) → neutral card, never blank.
//    • error    — fetch failure → retryable "couldn't load" (P4 leaf).
//    • data     — the four concrete severities (connected / expiring / expired / disconnected).
//    • stale / offline — the orthogonal `connection` axis → freshness chip + banner with a one-shot
//                 auto-refresh on the stale transition.
//

import SwiftUI

// MARK: - TeslaAuthCard (the feature surface)

/// The Tesla-account status card — renders every state from the web source plus the P4 leaf
/// freshness states, binding through `TeslaAuthModel`. The "Manage / Re-authenticate" CTA navigates
/// to the Tesla account surface (web `<Link to="/tesla-account">`) via the injected `onManage`.
public struct TeslaAuthCard: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let surfaceSlug = "TeslaAuthCard"

    /// Canonical web destination for the CTA (web `<Link to="/tesla-account">`). The host wires the
    /// closure to its navigation graph; the surface stays decoupled from the route table.
    public static let accountPath = "/tesla-account"

    @State private var model: TeslaAuthModel
    private let onManage: () -> Void

    public init(model: TeslaAuthModel, onManage: @escaping () -> Void = {}) {
        _model = State(initialValue: model)
        self.onManage = onManage
    }

    public var body: some View {
        card
            .onAppear { model.start() }
            .onDisappear { model.stop() }
    }
}

// MARK: - Card chrome

private extension TeslaAuthCard {
    var card: some View {
        VStack(alignment: .leading, spacing: 0) {
            TeslaAuthAccentBar(accent: model.presentation?.accent ?? .neutral)
            VStack(alignment: .leading, spacing: TSSpacing.md) {
                header
                if model.connection != .live {
                    TeslaAuthConnectivityBanner(connection: model.connection)
                }
                content
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
            .padding(TSSpacing.md)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(
            Color.TS.surfaceGlass,
            in: RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
        )
        .overlay(
            RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
                .strokeBorder(Color.TS.border, lineWidth: 1)
        )
        .clipShape(RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous))
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Text(verbatim: TeslaAuthStrings.string("teslaAuth.title", "Tesla account")))
    }

    var header: some View {
        HStack(spacing: TSSpacing.sm) {
            TeslaAuthFreshnessChip(connection: model.connection)
            Spacer(minLength: TSSpacing.sm)
            TeslaAuthRefreshButton { model.refresh() }
        }
    }
}

// MARK: - Content states (web body + the P4 leaf contract)

private extension TeslaAuthCard {
    @ViewBuilder
    var content: some View {
        switch model.phase {
        case .loading:
            TeslaAuthLoadingView()
        case let .error(message):
            TeslaAuthErrorView(message: message) { model.refresh() }
        case let .empty(presentation):
            TSFadeIn {
                TeslaAuthCardBody(presentation: presentation, onManage: onManage)
            }
        case let .data(presentation):
            TSFadeIn {
                TeslaAuthCardBody(presentation: presentation, onManage: onManage)
            }
        }
    }
}
