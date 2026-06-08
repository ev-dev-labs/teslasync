//
//  AdvancedSettings.Previews.swift
//  TeslaSync — P4 feature view · 0198 · AdvancedSettings (Apple)
//
//  #if DEBUG previews exercising every state the surface renders (content / empty / loading / error /
//  stale / offline), so the "Restore confirmation prompts" panel can be eyeballed in Xcode without the
//  persisted store.
//

#if DEBUG
    import SwiftUI

    private enum AdvancedSettingsPreviewData {
        /// A known id + an unknown id, so the preview shows both the friendly label and the raw-key
        /// forward-compat fallback (web `default: return key`).
        static let keys = [
            AdvancedSettingsConfig.discardDraftKey,
            AdvancedSettingsConfig.unsavedNavigationKey,
            "remove-widget"
        ]

        @MainActor
        static func model(
            keys: [String] = keys,
            status: AdvancedSettingsLoadStatus = .loaded,
            connection: AdvancedSettingsConnection = .live
        ) -> AdvancedSettingsModel {
            AdvancedSettingsModel(
                store: InMemoryConfirmSilenceStore(keys: keys, status: status, connection: connection),
                copy: .fallback
            )
        }
    }

    private struct AdvancedSettingsPreviewStage: View {
        let model: AdvancedSettingsModel

        var body: some View {
            ScrollView {
                AdvancedSettings(model: model)
                    .padding(TSSpacing.lg)
            }
            .background(Color.TS.bg)
        }
    }

    #Preview("Content") {
        AdvancedSettingsPreviewStage(model: AdvancedSettingsPreviewData.model())
    }

    #Preview("Empty") {
        AdvancedSettingsPreviewStage(model: AdvancedSettingsPreviewData.model(keys: []))
    }

    #Preview("Loading") {
        AdvancedSettingsPreviewStage(model: AdvancedSettingsPreviewData.model(status: .loading))
    }

    #Preview("Error") {
        AdvancedSettingsPreviewStage(
            model: AdvancedSettingsPreviewData.model(status: .failed("Couldn't read saved preferences"))
        )
    }

    #Preview("Stale") {
        AdvancedSettingsPreviewStage(model: AdvancedSettingsPreviewData.model(connection: .stale))
    }

    #Preview("Offline") {
        AdvancedSettingsPreviewStage(model: AdvancedSettingsPreviewData.model(connection: .offline))
    }
#endif
