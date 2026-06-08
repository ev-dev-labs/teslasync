//
//  FeatureToggles.swift
//  TeslaSync — P4 feature view · 0205 · FeatureToggles (Apple)
//
//  The Tesla "Feature Flags" surface — SwiftUI parity of
//  features/settings/components/FeatureToggles.tsx. Renders inside a glass panel
//  (web `<GlassPanel className="p-6 space-y-4">`) fading in on appear (web
//  `<FadeIn delay={0.03}>`), with the icon + title + subtitle + "Synced …" + a
//  Refresh button header, and a body that switches over the bound model's phase
//  so every prompt state renders (loading / empty / error / stale / offline /
//  content) — never a blank box. Binds through `FeatureTogglesModel` (P1/S8); no
//  networking lives here.
//

import SwiftUI

/// The Tesla account "Feature Flags" surface — the SwiftUI parity of the web
/// `FeatureToggles`, binding through `FeatureTogglesModel` (P1/S8).
public struct FeatureToggles: View {
    @State private var model: FeatureTogglesModel

    public init(model: FeatureTogglesModel) {
        _model = State(initialValue: model)
    }

    public var body: some View {
        TSFadeIn(delay: 0.03) {
            VStack(alignment: .leading, spacing: TSSpacing.lg) {
                FeatureTogglesHeader(
                    syncedLabel: model.syncedLabel,
                    refreshing: model.refreshing,
                    onRefresh: { model.refresh() }
                )
                if model.connection != .live {
                    FeatureTogglesConnectivityBanner(connection: model.connection)
                }
                content
            }
            .padding(TSSpacing.x2xl)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(
                Color.TS.surfaceGlass,
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

    /// The web `featureEntries.length > 0 ? <grid> : <EmptyState>` branch, widened
    /// to the full load envelope so no state is hidden behind a blank panel.
    @ViewBuilder
    private var content: some View {
        switch model.phase {
        case .loading:
            FeatureTogglesLoading()
        case .empty:
            FeatureTogglesEmpty()
        case let .error(message):
            FeatureTogglesError(message: message) { model.refresh() }
        case .content:
            FeatureTogglesTable(entries: model.projection.entries)
        }
    }
}
