//
//  NotificationFilterBar.swift
//  TeslaSync — P4 feature view · 0189 · NotificationFilterBar (Apple)
//
//  The notifications inbox filter bar — the SwiftUI parity of
//  features/notifications/components/NotificationFilterBar.tsx. Fades in on appear
//  (web `FadeIn`), then switches over the bound model's phase so every prompt-required
//  state renders (loading / empty / error / content, with the stale + offline freshness
//  branches inside content) — never a blank box. Binds through `NotificationFilterModel`
//  (P1/S8); no networking lives here.
//

import SwiftUI

/// The notifications inbox filter bar — the SwiftUI parity of the web
/// `NotificationFilterBar`, binding through `NotificationFilterModel` (P1/S8).
public struct NotificationFilterBar: View {
    @State private var model: NotificationFilterModel

    public init(model: NotificationFilterModel) {
        _model = State(initialValue: model)
    }

    public var body: some View {
        TSFadeIn(delay: 0.1) {
            content
                .frame(maxWidth: .infinity, alignment: .leading)
        }
        .onAppear { model.start() }
        .onDisappear { model.stop() }
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Text(verbatim: model.accessibilitySummary))
    }

    /// The top-level branch: the bar presents the vehicle + rule options, so loading /
    /// failed without a cache map to skeleton / retry, no options resolve to the
    /// friendly empty, and otherwise the controlled filter controls render (with the
    /// stale + offline banner + freshness chip inside).
    @ViewBuilder
    private var content: some View {
        switch model.phase {
        case .loading:
            NotificationFilterLoadingState()
        case let .error(message):
            NotificationFilterErrorState(message: message) { model.refresh() }
        case .empty:
            NotificationFilterEmptyState()
        case .content:
            NotificationFilterContent(model: model)
        }
    }
}

// MARK: - Surface identity

public extension NotificationFilterBar {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    static var surfaceSlug: String {
        NotificationFilterSurface.slug
    }
}
