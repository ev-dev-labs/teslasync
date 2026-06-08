//
//  ActiveSessionsSection.swift
//  TeslaSync — P4 feature view · 0197 · ActiveSessionsSection (Apple)
//
//  Active sessions / device management — the SwiftUI parity of
//  features/settings/components/ActiveSessionsSection.tsx. Fades in on appear (web
//  `<FadeIn>`) inside a GlassPanel-equivalent card, shows the cached-data banner when
//  the bound live-state is not fresh, and switches over the model's resolved phase so
//  every prompt-required state renders (loading / open-mode / empty / error / content,
//  with the inline-error + stale + offline branches) — never a blank box. The two
//  destructive confirmations are attached once and bind through `ActiveSessionsModel`
//  (P1/S8); no networking lives here.
//

import SwiftUI

/// The active-sessions / device-management section — the SwiftUI parity of the web
/// `ActiveSessionsSection`, binding through `ActiveSessionsModel` (P1/S8).
public struct ActiveSessionsSection: View {
    @State private var model: ActiveSessionsModel

    public init(model: ActiveSessionsModel) {
        _model = State(initialValue: model)
    }

    public var body: some View {
        TSFadeIn(delay: 0.05) {
            VStack(alignment: .leading, spacing: TSSpacing.lg) {
                if model.connection != .live {
                    ActiveSessionsConnectivityBanner(connection: model.connection)
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
        .activeSessionsConfirmations(model: model)
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Text(verbatim: model.accessibilitySummary))
    }

    /// The web top-level branch ladder (loading → open-mode → forward-auth), widened
    /// with the empty + error envelopes so no state is hidden behind a blank panel.
    @ViewBuilder
    private var content: some View {
        switch model.phase {
        case .loading:
            ActiveSessionsLoadingState()
        case .openMode:
            ActiveSessionsOpenModeState()
        case let .error(message):
            ActiveSessionsErrorState(message: message) { model.refresh() }
        case .empty, .content:
            ActiveSessionsContent(model: model)
        }
    }
}

// MARK: - Surface identity

public extension ActiveSessionsSection {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    static var surfaceSlug: String {
        ActiveSessionsSurface.slug
    }
}
