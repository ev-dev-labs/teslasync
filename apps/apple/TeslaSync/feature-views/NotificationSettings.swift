//
//  NotificationSettings.swift
//  TeslaSync — P4 feature view · 0208 · NotificationSettings (Apple)
//
//  The composable settings "Notifications" feature view — the SwiftUI parity of
//  features/settings/components/NotificationSettings.tsx. Renders inside a GlassPanel fading in on appear
//  (web `<FadeIn delay={0.13}>`), and switches over the bound model's phase so every prompt-required state
//  renders (loading / empty / error / content), with stale / offline carried on the freshness chip +
//  banner. Binds through `NotificationSettingsModel` (P1/S8); no networking lives here.
//

import SwiftUI

/// The composable "Notifications" settings section — the SwiftUI parity of the web `NotificationSettings`,
/// binding through `NotificationSettingsModel` (P1/S8). The body is the browser-notification authorization
/// area, the tab-signal toggles, and the per-channel sound controls or, when the read is in flight / failed
/// / empty, the matching load-envelope chrome.
public struct NotificationSettings: View {
    @State private var model: NotificationSettingsModel

    public init(model: NotificationSettingsModel) {
        _model = State(initialValue: model)
    }

    public var body: some View {
        TSFadeIn(delay: 0.13) {
            NotificationSettingsGlassPanel {
                VStack(alignment: .leading, spacing: TSSpacing.xl) {
                    NotificationSettingsHeader(connection: model.connection)
                    if model.connection != .live {
                        NotificationSettingsConnectivityBanner(connection: model.connection)
                    }
                    content
                }
            }
        }
        .onAppear { model.start() }
        .onDisappear { model.stop() }
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Text(verbatim: model.accessibilitySummary))
    }

    /// The web panel body, widened to the full load envelope (loading / error / empty / content) so no state
    /// is hidden behind a blank panel.
    @ViewBuilder
    private var content: some View {
        switch model.phase {
        case .loading:
            NotificationSettingsLoading()
        case let .error(message):
            NotificationSettingsErrorView(message: message) { model.refresh() }
        case .empty:
            NotificationSettingsEmpty()
        case .content:
            VStack(alignment: .leading, spacing: TSSpacing.xl) {
                NotificationAuthorizationSection(model: model)
                Divider().overlay(Color.TS.border)
                NotificationTabSignalsSection(model: model)
                Divider().overlay(Color.TS.border)
                NotificationSoundsSection(model: model)
            }
        }
    }
}
