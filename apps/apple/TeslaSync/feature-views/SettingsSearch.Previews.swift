//
//  SettingsSearch.Previews.swift
//  TeslaSync — P4 feature view · 0215 · SettingsSearch (Apple)
//
//  #if DEBUG previews exercising every state the surface renders (content / idle / loading / empty /
//  error / stale / offline), so the settings find-as-you-type box can be eyeballed in Xcode without the
//  live store. The preview index is the real catalog resolved through the English fallback localizer.
//

#if DEBUG
    import SwiftUI

    private enum SettingsSearchPreviewData {
        /// The real settings index, resolved with the web English fallbacks (no bundle needed).
        static let entries: [SettingsEntry] = SettingsCatalog.entries { _, fallback in fallback }

        @MainActor
        static func model(query: String, update: SettingsSearchUpdate) -> SettingsSearchModel {
            SettingsSearchModel(
                source: InMemorySettingsSearchSource(initial: update),
                copy: .fallback,
                initialQuery: query
            )
        }

        static func loaded(connection: SettingsSearchConnection = .live) -> SettingsSearchUpdate {
            SettingsSearchUpdate(status: .loaded, entries: entries, connection: connection, updatedAt: Date())
        }
    }

    private struct SettingsSearchPreviewStage: View {
        let model: SettingsSearchModel

        var body: some View {
            ScrollView {
                SettingsSearch(model: model)
                    .padding(TSSpacing.lg)
            }
            .background(Color.TS.bg)
        }
    }

    #Preview("Content") {
        SettingsSearchPreviewStage(
            model: SettingsSearchPreviewData.model(
                query: "lang",
                update: SettingsSearchPreviewData.loaded()
            )
        )
    }

    #Preview("Idle (type to search)") {
        SettingsSearchPreviewStage(
            model: SettingsSearchPreviewData.model(
                query: "",
                update: SettingsSearchPreviewData.loaded()
            )
        )
    }

    #Preview("Loading") {
        SettingsSearchPreviewStage(
            model: SettingsSearchPreviewData.model(
                query: "",
                update: SettingsSearchUpdate(status: .loading)
            )
        )
    }

    #Preview("Empty (no matches)") {
        SettingsSearchPreviewStage(
            model: SettingsSearchPreviewData.model(
                query: "zzzzz",
                update: SettingsSearchPreviewData.loaded()
            )
        )
    }

    #Preview("Error") {
        SettingsSearchPreviewStage(
            model: SettingsSearchPreviewData.model(
                query: "",
                update: SettingsSearchUpdate(status: .failed("Network unavailable"))
            )
        )
    }

    #Preview("Stale") {
        SettingsSearchPreviewStage(
            model: SettingsSearchPreviewData.model(
                query: "psi",
                update: SettingsSearchPreviewData.loaded(connection: .stale)
            )
        )
    }

    #Preview("Offline") {
        SettingsSearchPreviewStage(
            model: SettingsSearchPreviewData.model(
                query: "psi",
                update: SettingsSearchPreviewData.loaded(connection: .offline)
            )
        )
    }
#endif
