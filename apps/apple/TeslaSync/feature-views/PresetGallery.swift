//
//  PresetGallery.swift
//  TeslaSync — P4 feature view · 0085 · AutomationPresetGallery (Apple)
//
//  The automation preset gallery — the SwiftUI parity of
//  features/automations/pages/PresetGallery.tsx. Fades in on appear (web `<FadeIn>`),
//  shows the cached-data banner when the bound live-state is not fresh, and switches over
//  the model's resolved phase so every prompt-required state renders (loading / empty /
//  error / content, plus the stale + offline freshness branches) — never a blank box. The
//  Install action binds through `AutomationPresetGalleryModel` (P1/S8); no networking lives here.
//

import SwiftUI

/// The automation preset gallery — the SwiftUI parity of the web `PresetGallery`, binding
/// through `AutomationPresetGalleryModel` (P1/S8).
public struct AutomationPresetGallery: View {
    @State private var model: AutomationPresetGalleryModel

    public init(model: AutomationPresetGalleryModel) {
        _model = State(initialValue: model)
    }

    public var body: some View {
        TSFadeIn(delay: 0.05) {
            VStack(alignment: .leading, spacing: TSSpacing.lg) {
                if model.connection != .live {
                    AutomationPresetGalleryConnectivityBanner(connection: model.connection)
                }
                content
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .onAppear { model.start() }
        .onDisappear { model.stop() }
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Text(verbatim: model.accessibilitySummary))
    }

    /// The web top-level branch ladder (loading → empty → loaded), widened with the error
    /// envelope so no state is hidden behind a blank panel.
    @ViewBuilder
    private var content: some View {
        switch model.phase {
        case .loading:
            AutomationPresetGalleryLoadingState()
        case let .error(message):
            AutomationPresetGalleryErrorState(message: message) { model.refresh() }
        case .empty:
            AutomationPresetGalleryEmptyState()
        case .content:
            AutomationPresetGalleryContent(model: model)
        }
    }
}

// MARK: - Surface identity

public extension AutomationPresetGallery {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    static var surfaceSlug: String {
        AutomationPresetGallerySurface.slug
    }
}
