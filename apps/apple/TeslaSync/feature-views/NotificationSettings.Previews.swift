//
//  NotificationSettings.Previews.swift
//  TeslaSync — P4 feature view · 0208 · NotificationSettings (Apple)
//
//  #if DEBUG previews exercising every state the surface renders (content variants by authorization +
//  sound-master, loading / empty / error / stale / offline), so it can be eyeballed in Xcode without the
//  live store.
//

#if DEBUG
    import SwiftUI

    private enum NotificationSettingsPreviewData {
        /// Granted, sounds on, mid volume — the fullest content state.
        static let granted = NotificationSettingsInput(
            authorization: .granted,
            eventPrefs: NotificationEventPrefs(alerts: true, exportCompletions: false),
            tabSettings: TabSignalSettings(badgeEnabled: true, criticalFlashEnabled: false),
            soundPrefs: NotificationSoundPrefs(enabled: true, volume: 0.6)
        )

        /// Not yet asked — the enable affordance, sounds off.
        static let notDetermined = NotificationSettingsInput(authorization: .notDetermined)

        /// Blocked at the OS level — the deep-link-to-Settings line.
        static let denied = NotificationSettingsInput(authorization: .denied)

        /// No notification capability — the unsupported line.
        static let unsupported = NotificationSettingsInput(
            authorization: .unsupported,
            soundPrefs: NotificationSoundPrefs(enabled: true, volume: 0.4)
        )

        @MainActor
        static func model(
            status: NotificationSettingsLoadStatus = .loaded,
            input: NotificationSettingsInput? = granted,
            connection: NotificationSettingsConnection = .live
        ) -> NotificationSettingsModel {
            let source = InMemoryNotificationSettingsSource(
                status: status,
                input: input,
                connection: connection,
                updatedAt: Date()
            )
            return NotificationSettingsModel(source: source, copy: .fallback)
        }
    }

    private struct NotificationSettingsPreviewStage: View {
        let model: NotificationSettingsModel

        var body: some View {
            ScrollView {
                NotificationSettings(model: model)
                    .padding(TSSpacing.lg)
                    .frame(maxWidth: 460)
            }
            .background(Color.TS.bg)
        }
    }

    #Preview("Granted · sounds on") {
        NotificationSettingsPreviewStage(model: NotificationSettingsPreviewData.model())
    }

    #Preview("Default (enable)") {
        NotificationSettingsPreviewStage(
            model: NotificationSettingsPreviewData.model(input: NotificationSettingsPreviewData.notDetermined)
        )
    }

    #Preview("Denied (blocked)") {
        NotificationSettingsPreviewStage(
            model: NotificationSettingsPreviewData.model(input: NotificationSettingsPreviewData.denied)
        )
    }

    #Preview("Unsupported") {
        NotificationSettingsPreviewStage(
            model: NotificationSettingsPreviewData.model(input: NotificationSettingsPreviewData.unsupported)
        )
    }

    #Preview("Loading") {
        NotificationSettingsPreviewStage(
            model: NotificationSettingsPreviewData.model(status: .loading, input: nil)
        )
    }

    #Preview("Empty") {
        NotificationSettingsPreviewStage(
            model: NotificationSettingsPreviewData.model(status: .loaded, input: nil)
        )
    }

    #Preview("Error") {
        NotificationSettingsPreviewStage(
            model: NotificationSettingsPreviewData.model(status: .failed("Network unavailable"), input: nil)
        )
    }

    #Preview("Stale") {
        NotificationSettingsPreviewStage(model: NotificationSettingsPreviewData.model(connection: .stale))
    }

    #Preview("Offline") {
        NotificationSettingsPreviewStage(model: NotificationSettingsPreviewData.model(connection: .offline))
    }
#endif
