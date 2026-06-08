//
//  SessionListSection.swift
//  TeslaSync — P4 feature view · 0106 · SessionListSection (Apple)
//
//  The composable charging "All Sessions" list — the SwiftUI parity of
//  features/charging/components/charging-list/SessionListSection.tsx. Fades in on
//  appear (web `<FadeIn>`) inside a GlassPanel-equivalent card, shows the cached-data
//  banner when the live state is not fresh, and switches over the bound model's phase
//  so every prompt-required state renders (loading / empty / error / content, with
//  the inner no-matches + stale + offline branches) — never a blank box. Binds
//  through `SessionListModel` (P1/S8); no networking lives here.
//

import SwiftUI

/// The composable charging session-list section — the SwiftUI parity of the web
/// `SessionListSection`, binding through `SessionListModel` (P1/S8).
public struct SessionListSection: View {
    @State private var model: SessionListModel

    public init(model: SessionListModel) {
        _model = State(initialValue: model)
    }

    public var body: some View {
        TSFadeIn(delay: 0.2) {
            VStack(alignment: .leading, spacing: TSSpacing.x2xl) {
                if model.connection != .live {
                    SessionConnectivityBanner(connection: model.connection)
                }
                content
            }
            .padding(TSSpacing.lg)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(
                Color.TS.surface,
                in: RoundedRectangle(cornerRadius: TSRadius.lg, style: .continuous)
            )
            .overlay(
                RoundedRectangle(cornerRadius: TSRadius.lg, style: .continuous)
                    .strokeBorder(Color.TS.border, lineWidth: 1)
            )
        }
        .onAppear { model.start() }
        .onDisappear { model.stop() }
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Text(verbatim: model.accessibilitySummary))
    }

    /// The web top-level branch (`isLoading` → skeletons; `!sessions.length` →
    /// EmptyState; otherwise the controls + list), widened with the error envelope
    /// the parent page owns so no state is hidden behind a blank panel.
    @ViewBuilder
    private var content: some View {
        switch model.phase {
        case .loading:
            SessionLoadingState()
        case let .error(message):
            SessionErrorState(message: message) { model.refresh() }
        case .empty:
            SessionEmptyState()
        case .content:
            SessionListContent(model: model)
        }
    }
}

// MARK: - Surface identity

public extension SessionListSection {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    static var surfaceSlug: String {
        SessionListSurface.slug
    }
}
