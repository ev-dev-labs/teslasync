//
//  NotificationChannelsView.Previews.swift
//  TeslaSync — P4 feature view · 0188 · NotificationChannelsView (Apple)
//
//  #if DEBUG previews — one per state of the web source: data (multiple channels) /
//  loading / empty / error / stale / offline, plus the add + edit form sheets. Previews
//  drive the surface through `InMemoryNotificationChannelsSource` (no network, no real
//  store) and render the English fallbacks through the P1/S10 facade.
//

#if DEBUG
    import SwiftUI

    @MainActor
    private enum NotifChannelsPreview {
        static func channels() -> [NotificationChannelData] {
            [
                NotificationChannelData(
                    id: 1,
                    kind: .discord,
                    name: "Ops Discord",
                    enabled: true,
                    config: [ChannelConfigEntry(key: "webhook_url", value: "https://discord.com/api/webhooks/123/abc")]
                ),
                NotificationChannelData(
                    id: 2,
                    kind: .telegram,
                    name: "Alerts Bot",
                    enabled: true,
                    config: [
                        ChannelConfigEntry(key: "bot_token", value: "123456:ABC-DEF"),
                        ChannelConfigEntry(key: "chat_id", value: "-1001234567890")
                    ]
                ),
                NotificationChannelData(
                    id: 3,
                    kind: .email,
                    name: "On-call Email",
                    enabled: false,
                    config: [
                        ChannelConfigEntry(key: "smtp_host", value: "smtp.gmail.com"),
                        ChannelConfigEntry(key: "smtp_port", value: "587"),
                        ChannelConfigEntry(key: "smtp_password", value: "super-secret")
                    ]
                )
            ]
        }

        static let stats = NotifChannelStats(
            sent: 1284,
            failed: 12,
            pending: 3,
            enabledChannels: 2,
            totalChannels: 3
        )

        static func model(_ input: NotifChannelsInput) -> NotificationChannelsModel {
            NotificationChannelsModel(source: InMemoryNotificationChannelsSource(initial: input))
        }

        static func surface(_ input: NotifChannelsInput) -> some View {
            NotificationChannelsView(model: model(input)).background(Color.TS.bg)
        }

        static func form(editing channel: NotificationChannelData?) -> some View {
            let source = InMemoryNotificationChannelsSource()
            let formModel = ChannelFormModel(source: source, editing: channel, onSaved: {})
            return ScrollView {
                NotificationChannelForm(model: formModel, onCancel: {})
                    .padding(TSSpacing.lg)
            }
            .background(Color.TS.bg)
        }
    }

    #Preview("Data · channels") {
        NotifChannelsPreview.surface(
            NotifChannelsInput(channels: NotifChannelsPreview.channels(), stats: NotifChannelsPreview.stats)
        )
    }

    #Preview("Loading") {
        NotifChannelsPreview.surface(NotifChannelsInput(isLoading: true))
    }

    #Preview("Empty") {
        NotifChannelsPreview.surface(NotifChannelsInput(channels: [], stats: NotifChannelsPreview.stats))
    }

    #Preview("Error") {
        NotifChannelsPreview.surface(
            NotifChannelsInput(stats: NotifChannelsPreview.stats, errorMessage: "Couldn’t reach the server.")
        )
    }

    #Preview("Stale") {
        NotifChannelsPreview.surface(
            NotifChannelsInput(
                channels: NotifChannelsPreview.channels(),
                stats: NotifChannelsPreview.stats,
                connection: .stale
            )
        )
    }

    #Preview("Offline") {
        NotifChannelsPreview.surface(
            NotifChannelsInput(
                channels: NotifChannelsPreview.channels(),
                stats: NotifChannelsPreview.stats,
                connection: .offline
            )
        )
    }

    #Preview("Form · Add") {
        NotifChannelsPreview.form(editing: nil)
    }

    #Preview("Form · Edit") {
        NotifChannelsPreview.form(editing: NotifChannelsPreview.channels()[1])
    }
#endif
