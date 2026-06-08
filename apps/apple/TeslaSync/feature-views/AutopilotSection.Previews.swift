//
//  AutopilotSection.Previews.swift
//  TeslaSync — P4 feature view · 0165 · AutopilotSection (Apple)
//
//  #if DEBUG previews exercising every state the surface renders (content / partial content / loading /
//  empty / error / stale / offline), so it can be eyeballed in Xcode without the live store.
//

#if DEBUG
    import SwiftUI

    private enum AutopilotSectionPreviewData {
        /// All three values present (mph display): 27.3 m/s ≈ 61 mph, 29.06 m/s ≈ 65 mph, 7-bar follow.
        static let full = AutopilotInput(
            speedMetersPerSecond: 27.3,
            cruiseSetMetersPerSecond: 29.06,
            followDistanceRaw: "FollowDistance7"
        )

        /// Only current speed present (the other two tiles render the em-dash).
        static let partial = AutopilotInput(speedMetersPerSecond: 18.0)

        static let mph = AutopilotUnitPrefs(speed: "mph", locale: "en_US")

        @MainActor
        static func model(_ update: AutopilotSectionUpdate) -> AutopilotSectionModel {
            AutopilotSectionModel(
                source: InMemoryAutopilotSectionSource(initial: update),
                copy: .fallback
            )
        }

        static func loaded(
            _ input: AutopilotInput = full,
            connection: AutopilotConnection = .live
        ) -> AutopilotSectionUpdate {
            AutopilotSectionUpdate(
                status: .loaded,
                input: input,
                unitPrefs: mph,
                connection: connection,
                updatedAt: Date()
            )
        }
    }

    private struct AutopilotSectionPreviewStage: View {
        let model: AutopilotSectionModel

        var body: some View {
            ScrollView {
                AutopilotSection(model: model)
                    .padding(TSSpacing.lg)
            }
            .background(Color.TS.bg)
        }
    }

    #Preview("Content") {
        AutopilotSectionPreviewStage(model: AutopilotSectionPreviewData.model(AutopilotSectionPreviewData.loaded()))
    }

    #Preview("Partial (current speed only)") {
        AutopilotSectionPreviewStage(
            model: AutopilotSectionPreviewData.model(
                AutopilotSectionPreviewData.loaded(AutopilotSectionPreviewData.partial)
            )
        )
    }

    #Preview("Loading") {
        AutopilotSectionPreviewStage(
            model: AutopilotSectionPreviewData.model(AutopilotSectionUpdate(status: .loading, input: nil))
        )
    }

    #Preview("Empty") {
        AutopilotSectionPreviewStage(
            model: AutopilotSectionPreviewData.model(AutopilotSectionUpdate(status: .loaded, input: nil))
        )
    }

    #Preview("Error") {
        AutopilotSectionPreviewStage(
            model: AutopilotSectionPreviewData.model(
                AutopilotSectionUpdate(status: .failed("Network unavailable"), input: nil)
            )
        )
    }

    #Preview("Stale") {
        AutopilotSectionPreviewStage(
            model: AutopilotSectionPreviewData.model(AutopilotSectionPreviewData.loaded(connection: .stale))
        )
    }

    #Preview("Offline") {
        AutopilotSectionPreviewStage(
            model: AutopilotSectionPreviewData.model(AutopilotSectionPreviewData.loaded(connection: .offline))
        )
    }
#endif
