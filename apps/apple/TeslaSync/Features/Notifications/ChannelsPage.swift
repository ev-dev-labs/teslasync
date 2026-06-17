//
//  ChannelsPage.swift
//  TeslaSync — P4-APPLE P7 · page:notifications/Channels (Apple)
//
//  Native SwiftUI / HIG parity of `web/src/features/notifications/pages/ChannelsPage.tsx`
//  (web route `/notifications/channels`). The web page is a thin `PageContainer`
//  (title + subtitle + `copyLink`) wrapper around `<NotificationChannelsView/>`; this page
//  reproduces that exactly — the localized title + subtitle + a copy-link affordance, then hosts
//  the already-shipped `NotificationChannelsView` feature view (its own P4 parity unit,
//  `TeslaSync/feature-views/NotificationChannelsView`) driven by the page model's
//  `NotificationChannelsModel`. The section itself renders every web data state
//  (loading / empty / error / stale / offline / content) — never a blank region.
//
//  All copy resolves from `Localizable.xcstrings` with the web key names
//  (`notifications.channels.title` / `.subtitle`); the section binds through the `@Observable`
//  model (no networking in the view, ADR-004). Adaptive across macOS/iPad (regular) + iPhone
//  (compact) via the shared P2 tokens + P3 components (ADR-002/006/013/014/015).
//

import SwiftUI

public struct ChannelsPage: View {
    @State private var model: ChannelsPageModel

    public init(model: ChannelsPageModel) {
        _model = State(initialValue: model)
    }

    public var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: TSSpacing.x2xl) {
                header
                NotificationChannelsView(model: model.section)
            }
            .padding(TSSpacing.lg)
            .frame(maxWidth: 1024, alignment: .leading) // web `PageContainer` centered column
            .frame(maxWidth: .infinity)
        }
        .background(Color.TS.bg.ignoresSafeArea())
    }

    // MARK: - Header (web PageContainer title + subtitle + copyLink)

    private var header: some View {
        let shareURL = model.shareURL
        return HStack(alignment: .top, spacing: TSSpacing.md) {
            VStack(alignment: .leading, spacing: TSSpacing.xs) {
                TSPageTitle(model.titleKey)
                Text(model.subtitleKey)
                    .font(Font.TS.body)
                    .foregroundStyle(Color.TS.textSecondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            CopyLinkButton(url: { shareURL })
        }
        .accessibilityElement(children: .contain)
    }
}

#if DEBUG
    #Preview("Loaded") {
        ChannelsPage(model: ChannelsPageModel())
            .teslaSyncTheme()
    }

    #Preview("Empty") {
        ChannelsPage(
            model: ChannelsPageModel(
                source: InMemoryNotificationChannelsSource(
                    initial: NotifChannelsInput(channels: [], stats: nil, connection: .live)
                )
            )
        )
        .teslaSyncTheme()
    }

    #Preview("Error") {
        ChannelsPage(
            model: ChannelsPageModel(
                source: InMemoryNotificationChannelsSource(
                    initial: NotifChannelsInput(errorMessage: "Couldn’t reach the server.")
                )
            )
        )
        .teslaSyncTheme()
    }
#endif
