//
//  RateLimitStatusPanel.swift
//  TeslaSync — P4 feature view · 0038 · RateLimitStatusPanel (Apple)
//
//  The composable Rate-limit budgets feature view — the SwiftUI parity of
//  features/admin/components/RateLimitStatusPanel.tsx. Binds through `RateLimitModel`
//  (no networking in the view) and renders every state the web source has: loading ·
//  error · empty · data (one labeled bar per scope) plus the P4 freshness / offline
//  overlays (the stale + offline chips the auto-refreshing web hook implies). The
//  always-visible header + Refresh sits above the state body, exactly like the web
//  `GlassPanel`.
//

import SwiftUI

/// The composable Rate-limit budgets panel — the SwiftUI parity of
/// `features/admin/components/RateLimitStatusPanel.tsx`. Renders every state from the
/// web source, binding through `RateLimitModel` (P1/S8). No networking lives here.
public struct RateLimitStatusPanel: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let surfaceSlug = "RateLimitStatusPanel"

    @State private var model: RateLimitModel

    public init(model: RateLimitModel) {
        _model = State(initialValue: model)
    }

    public var body: some View {
        TSGlassPanel {
            VStack(alignment: .leading, spacing: TSSpacing.lg) {
                RLPanelHeader(
                    updatedLabel: updatedLabel,
                    isFetching: model.isFetching,
                    isStale: model.isStale,
                    isOffline: model.isOffline,
                    onRefresh: { model.refresh() }
                )
                stateBody
            }
        }
        .onAppear { model.start() }
        .onDisappear { model.stop() }
        .accessibilityElement(children: .contain)
    }

    @ViewBuilder
    private var stateBody: some View {
        switch model.phase {
        case .loading:
            RLLoadingView()
        case let .error(message):
            RLErrorView(message: message) { model.refresh() }
        case .empty:
            RLEmptyView()
        case .data:
            RLRowsView(rows: model.rows)
        }
    }

    /// The "Updated …" caption (web `t('rateLimitStatus.lastUpdated', …,
    /// { when: formatRelative(generated_at) })`), nil until the first payload lands.
    private var updatedLabel: String? {
        guard let generatedAt = model.generatedAt else { return nil }
        return RLStrings.format("rateLimitStatus.lastUpdated", "Updated {{when}}", [
            "when": RateLimitRelative.format(generatedAt)
        ])
    }
}
